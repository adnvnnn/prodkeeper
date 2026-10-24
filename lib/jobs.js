const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const vault = require('./vault');

const running = new Map(); // jobId -> child

// Windows tar (bsdtar) supports zip; git's GNU tar does not, so we pass the system path explicitly
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
  if (running.has(id)) return { error: 'This job is already running' };
  const envR = vault.resolveEnv(projectId, spec.envSpec);
  if (envR.error) return { error: envR.error };
  const env = { ...process.env, ...envR.env };
  const rawSend = send;
  send = m => rawSend({ id: m.id, text: vault.mask(m.text, envR.secrets || []) });
  const cwd = spec.cwd && fs.existsSync(spec.cwd) ? spec.cwd : undefined;
  if (spec.cwd && !cwd) return { error: 'Working folder not found: ' + spec.cwd };

  if (kind === 'backup') return runBackup(spec, env, cwd, send);
  if (kind === 'publish') return runPublish(spec, env, cwd, send);
  if (!spec.command || !String(spec.command).trim()) return { error: 'No command is defined' };
  const sh = shellArgs(spec.shell, spec.command);
  send({ id, text: `> ${spec.command}\n\n` });
  return spawnJob(id, sh.file, sh.args, { ...sh.opts, cwd, env }, send);
}

async function runBackup(spec, env, cwd, send) {
  const { id } = spec, b = spec.backup || {};
  if (!b.destDir) return { error: 'Destination folder is not set' };
  try { fs.mkdirSync(b.destDir, { recursive: true }); } catch (e) { return { error: 'Cannot create destination folder: ' + e.message }; }
  const prefix = safe(b.name), st = stamp();
  let result;
  let file;
  if (b.type === 'command') {
    if (!b.command || !b.command.trim()) return { error: 'No backup command is defined' };
    const sh = shellArgs(b.shell, b.command);
    send({ id, text: `> ${b.command}\n\n` });
    result = await spawnJob(id, sh.file, sh.args, { ...sh.opts, cwd, env: { ...env, BACKUP_DIR: b.destDir, BACKUP_STAMP: st, BACKUP_PREFIX: prefix } }, send);
  } else {
    if (!b.source || !fs.existsSync(b.source)) return { error: 'Source folder not found' };
    const src = path.resolve(b.source), dst = path.resolve(b.destDir);
    if ((dst + path.sep).toLowerCase().startsWith((src + path.sep).toLowerCase())) return { error: 'The destination folder must not be inside the source folder' };
    file = path.join(b.destDir, `${prefix}-${st}.zip`);
    const ex = String(b.exclude || '').split(/[,،\n]/).map(s => s.trim()).filter(Boolean).map(s => `--exclude=${s}`);
    send({ id, text: `Compressing ${src}\nto ${file}\n` });
    result = await spawnJob(id, TAR, ['-a', '-c', '-f', file, ...ex, '-C', src, '.'], { env }, send);
  }
  if (result.code === 0) {
    if (file) {
      try { result.size = fs.statSync(file).size; result.file = file; } catch { return { ...result, code: -1, error: 'Backup file was not created' }; }
      if (result.size === 0) return { ...result, code: -1, error: 'Backup file is empty' };
    } else {
      // for custom commands: the newest file created with the prefix
      const made = fs.readdirSync(b.destDir).filter(f => f.startsWith(prefix + '-')).map(f => ({ f, s: fs.statSync(path.join(b.destDir, f)) })).sort((x, y) => y.s.mtimeMs - x.s.mtimeMs)[0];
      if (made && Date.now() - made.s.mtimeMs < 6 * 3600 * 1000) { result.file = path.join(b.destDir, made.f); result.size = made.s.size; }
      else send({ id, text: `\n⚠ No file with the prefix "${prefix}-" was found in the destination folder. The command must write its output as %BACKUP_DIR%\\%BACKUP_PREFIX%-%BACKUP_STAMP%.ext\n` });
    }
    result.pruned = prune(b.destDir, prefix, Number(b.keep));
    if (result.pruned.length) send({ id, text: `\nOlder copies were removed (${result.pruned.length}).\n` });
  }
  return result;
}

function dirStats(dir, acc = { files: 0, size: 0 }) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) dirStats(p, acc);
    else { acc.files++; try { acc.size += fs.statSync(p).size; } catch { /* file was deleted concurrently */ } }
  }
  return acc;
}

/** Publish to a folder: the user's command writes its output to %PUBLISH_DIR%; versioned mode creates a fresh timestamped subfolder each run */
async function runPublish(spec, env, cwd, send) {
  const { id } = spec, b = spec.publish || {};
  if (!b.destDir) return { error: 'Publish destination folder is not set' };
  if (!spec.command || !String(spec.command).trim()) return { error: 'No publish command is defined' };
  const prefix = safe(b.name), st = stamp();
  const out = b.versioned ? path.join(b.destDir, `${prefix}-${st}`) : path.resolve(b.destDir);
  if (cwd && path.resolve(cwd).toLowerCase() === path.resolve(out).toLowerCase()) return { error: 'The destination folder must not be the same as the command working folder (the project)' };
  try { fs.mkdirSync(out, { recursive: true }); } catch (e) { return { error: 'Cannot create destination folder: ' + e.message }; }
  const sh = shellArgs(spec.shell, spec.command);
  send({ id, text: `> ${spec.command}\nPUBLISH_DIR=${out}\n\n` });
  const result = await spawnJob(id, sh.file, sh.args, { ...sh.opts, cwd, env: { ...env, PUBLISH_DIR: out, PUBLISH_STAMP: st, PUBLISH_NAME: prefix } }, send);
  if (result.code !== 0) return result;
  const stats = dirStats(out);
  if (!stats.files) return { ...result, code: -1, error: 'The command finished but the destination folder is empty; it must write its output to %PUBLISH_DIR%' };
  result.file = out;
  result.size = stats.size;
  send({ id, text: `\n✓ ${stats.files} files in ${out}\n` });
  if (b.versioned) {
    result.pruned = prune(path.resolve(b.destDir), prefix, Number(b.keep));
    if (result.pruned.length) send({ id, text: `Older copies were removed (${result.pruned.length}).\n` });
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
