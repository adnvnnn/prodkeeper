const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const vault = require('./vault');

const running = new Map(); // jobId -> child

// tar ویندوز (bsdtar) از فرمت zip پشتیبانی می‌کند؛ tar گیت (GNU) نه، پس مسیر سیستمی را صریح می‌دهیم
const sysTar = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe');
const TAR = fs.existsSync(sysTar) ? sysTar : 'tar.exe';

const pad = n => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
const safe = s => String(s || 'backup').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60);

function spawnJob(id, file, args, opts, send) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(file, args, { windowsHide: true, ...opts }); }
    catch (e) { return resolve({ code: -1, error: e.message }); }
    running.set(id, child);
    const emit = b => send({ id, text: b.toString('utf8') });
    child.stdout.on('data', emit);
    child.stderr.on('data', emit);
    child.on('error', e => { running.delete(id); resolve({ code: -1, error: e.message }); });
    child.on('close', (code, signal) => { running.delete(id); resolve({ code: code ?? -1, killed: signal != null || undefined }); });
  });
}

function shellArgs(shell, command) {
  if (shell === 'powershell') {
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + command], opts: {} };
  }
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"chcp 65001>nul & ${command}"`], opts: { windowsVerbatimArguments: true } };
}

function prune(dir, prefix, keep) {
  if (!(keep > 0)) return [];
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix + '-'))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const old = files.slice(keep).map(x => x.f);
  old.forEach(f => { try { fs.rmSync(path.join(dir, f), { recursive: true, force: true }); } catch { /* ignore */ } });
  return old;
}

async function run(spec, send) {
  const { id, kind, projectId } = spec;
  if (running.has(id)) return { error: 'این کار همین حالا در حال اجراست' };
  const envR = vault.resolveEnv(projectId, spec.envSpec);
  if (envR.error) return { error: envR.error };
  const env = { ...process.env, ...envR.env };
  const rawSend = send;
  send = m => rawSend({ id: m.id, text: vault.mask(m.text, envR.secrets || []) });
  const cwd = spec.cwd && fs.existsSync(spec.cwd) ? spec.cwd : undefined;
  if (spec.cwd && !cwd) return { error: 'پوشهٔ اجرا پیدا نشد: ' + spec.cwd };

  if (kind === 'backup') return runBackup(spec, env, cwd, send);
  if (!spec.command || !String(spec.command).trim()) return { error: 'دستوری تعریف نشده است' };
  const sh = shellArgs(spec.shell, spec.command);
  send({ id, text: `> ${spec.command}\n\n` });
  return spawnJob(id, sh.file, sh.args, { ...sh.opts, cwd, env }, send);
}

async function runBackup(spec, env, cwd, send) {
  const { id } = spec, b = spec.backup || {};
  if (!b.destDir) return { error: 'پوشهٔ مقصد مشخص نشده است' };
  try { fs.mkdirSync(b.destDir, { recursive: true }); } catch (e) { return { error: 'ساخت پوشهٔ مقصد ممکن نیست: ' + e.message }; }
  const prefix = safe(b.name), st = stamp();
  let result;
  let file;
  if (b.type === 'command') {
    if (!b.command || !b.command.trim()) return { error: 'دستور بک‌آپ تعریف نشده است' };
    const sh = shellArgs(b.shell, b.command);
    send({ id, text: `> ${b.command}\n\n` });
    result = await spawnJob(id, sh.file, sh.args, { ...sh.opts, cwd, env: { ...env, BACKUP_DIR: b.destDir, BACKUP_STAMP: st, BACKUP_PREFIX: prefix } }, send);
  } else {
    if (!b.source || !fs.existsSync(b.source)) return { error: 'پوشهٔ مبدأ پیدا نشد' };
    const src = path.resolve(b.source), dst = path.resolve(b.destDir);
    if ((dst + path.sep).toLowerCase().startsWith((src + path.sep).toLowerCase())) return { error: 'پوشهٔ مقصد نباید داخل پوشهٔ مبدأ باشد' };
    file = path.join(b.destDir, `${prefix}-${st}.zip`);
    const ex = String(b.exclude || '').split(/[,،\n]/).map(s => s.trim()).filter(Boolean).map(s => `--exclude=${s}`);
    send({ id, text: `فشرده‌سازی ${src}\nبه ${file}\n` });
    result = await spawnJob(id, TAR, ['-a', '-c', '-f', file, ...ex, '-C', src, '.'], { env }, send);
  }
  if (result.code === 0) {
    if (file) {
      try { result.size = fs.statSync(file).size; result.file = file; } catch { return { ...result, code: -1, error: 'فایل بک‌آپ ساخته نشد' }; }
      if (result.size === 0) return { ...result, code: -1, error: 'فایل بک‌آپ خالی است' };
    } else {
      // برای دستور سفارشی: جدیدترین فایلی که با پیشوند ساخته شده
      const made = fs.readdirSync(b.destDir).filter(f => f.startsWith(prefix + '-')).map(f => ({ f, s: fs.statSync(path.join(b.destDir, f)) })).sort((x, y) => y.s.mtimeMs - x.s.mtimeMs)[0];
      if (made && Date.now() - made.s.mtimeMs < 6 * 3600 * 1000) { result.file = path.join(b.destDir, made.f); result.size = made.s.size; }
      else send({ id, text: `\n⚠ فایلی با پیشوند «${prefix}-» در پوشهٔ مقصد پیدا نشد. دستور باید خروجی را با نام %BACKUP_DIR%\\%BACKUP_PREFIX%-%BACKUP_STAMP%.ext بسازد.\n` });
    }
    result.pruned = prune(b.destDir, prefix, Number(b.keep));
    if (result.pruned.length) send({ id, text: `\nنسخه‌های قدیمی‌تر پاک شد (${result.pruned.length} مورد).\n` });
  }
  return result;
}

function kill(id) {
  const c = running.get(id);
  if (!c) return { ok: false };
  spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true });
  return { ok: true };
}

function listBackups(destDir, name) {
  try {
    const prefix = safe(name) + '-';
    return {
      files: fs.readdirSync(destDir).filter(f => f.startsWith(prefix)).map(f => {
        const s = fs.statSync(path.join(destDir, f));
        return { name: f, size: s.isDirectory() ? 0 : s.size, ts: s.mtimeMs };
      }).sort((a, b) => b.ts - a.ts),
    };
  } catch { return { files: [] }; }
}

module.exports = { run, kill, listBackups, isRunning: id => running.has(id) };
