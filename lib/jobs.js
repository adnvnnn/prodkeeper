const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vault = require('./vault');

const running = new Map(); // jobId -> child
const servers = new Set(); // ids of "Run app" jobs: long-lived, stopped when ProdKeeper quits

// Windows tar (bsdtar) supports zip; git's GNU tar does not, so we pass the system path explicitly
const sysTar = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe');
const TAR = fs.existsSync(sysTar) ? sysTar : 'tar.exe';

const pad = n => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
const safe = s => String(s || 'backup').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60);

/** Top-level entries of a folder: passed to tar instead of '.', because entries named './x' make Windows Explorer show the zip as empty */
const topEntries = dir => fs.readdirSync(dir);

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
  if (spec.dbId) {
    const d = vault.dbEnv(spec.dbId);
    if (d.error) return { error: d.error };
    envR.env[d.name] = d.value;
    (envR.secrets || (envR.secrets = [])).push(d.value);
  }
  const env = { ...process.env, ...envR.env };
  const rawSend = send;
  send = m => rawSend({ id: m.id, text: vault.mask(m.text, envR.secrets || []) });
  const cwd = spec.cwd && fs.existsSync(spec.cwd) ? spec.cwd : undefined;
  if (spec.cwd && !cwd) return { error: 'Working folder not found: ' + spec.cwd };

  if (kind === 'backup') return runBackup(spec, env, cwd, send);
  if (kind === 'dbrestore') return runRestore(spec, env, send);
  if (kind === 'publish') return runPublish(spec, env, cwd, send);
  if (!spec.command || !String(spec.command).trim()) return { error: 'No command is defined' };
  const sh = shellArgs(spec.shell, spec.command);
  send({ id, text: `> ${spec.command}\n\n` });
  if (kind === 'run') servers.add(id);
  const result = await spawnJob(id, sh.file, sh.args, { ...sh.opts, cwd, env }, send);
  servers.delete(id);
  return result;
}

/** The parts of a SQL Server connection string kept in the vault, for sqlcmd: the password goes through SQLCMDPASSWORD instead of the command line */
function sqlConn(dbId) {
  const d = vault.dbEnv(dbId);
  if (d.error) return { error: d.error };
  const kv = {};
  for (const part of d.value.split(';')) { const i = part.indexOf('='); if (i > 0) kv[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim(); }
  const server = kv.server || kv['data source'] || kv.address || kv.addr || kv['network address'];
  const db = kv.database || kv['initial catalog'];
  if (!server || !db) return { error: 'The connection string needs a Server and a Database (SQL Server format)' };
  const integrated = /^(true|yes|sspi)$/i.test(kv.trusted_connection || kv['integrated security'] || '');
  const user = integrated ? '' : (kv['user id'] || kv.uid || kv.user || '');
  if ([server, db, user].some(x => /["%\r\n]/.test(x))) return { error: 'The server, database or user name contains an unsupported character' };
  const pwd = kv.password || kv.pwd || '';
  return { server, db, user, trust: /^(true|yes)$/i.test(kv.trustservercertificate || ''), env: user ? { SQLCMDPASSWORD: pwd } : {}, secrets: [pwd] };
}
const sqlcmdAuth = c => ['-S', c.server, ...(c.user ? ['-U', c.user] : ['-E']), ...(c.trust ? ['-C'] : [])];
const sqlId = name => `[${name.replace(/]/g, ']]')}]`;
const sqlStr = s => `N'${s.replace(/'/g, "''")}'`;

/** SQL Server backup built from a vault connection string: sqlcmd, file name taken from the backup variables */
function databaseBackup(dbId) {
  const c = sqlConn(dbId);
  if (c.error) return c;
  const sql = `BACKUP DATABASE ${sqlId(c.db)} TO DISK='%BACKUP_DIR%\\%BACKUP_PREFIX%-%BACKUP_STAMP%.bak' WITH INIT`;
  return { command: `sqlcmd -S "${c.server}" ${c.user ? `-U "${c.user}"` : '-E'}${c.trust ? ' -C' : ''} -b -Q "${sql}"`, env: c.env };
}

/** Connection check: connects with the stored connection string and reads the server version */
function testDatabase(dbId) {
  const c = sqlConn(dbId);
  if (c.error) return Promise.resolve({ ok: false, message: c.error });
  return new Promise(resolve => {
    let out = '', child;
    try { child = spawn('sqlcmd', [...sqlcmdAuth(c), '-d', c.db, '-b', '-l', '10', '-h', '-1', '-W', '-Q', 'SET NOCOUNT ON; SELECT @@VERSION'], { windowsHide: true, env: { ...process.env, ...c.env } }); }
    catch (e) { return resolve({ ok: false, message: e.message }); }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, 20000);
    child.stdout.on('data', b => (out += b));
    child.stderr.on('data', b => (out += b));
    child.on('error', e => { clearTimeout(timer); resolve({ ok: false, message: e.code === 'ENOENT' ? 'sqlcmd was not found. Install the SQL Server command line utilities.' : e.message }); });
    child.on('close', code => {
      clearTimeout(timer);
      const msg = vault.mask(out.trim(), c.secrets).split(/\r?\n/).filter(Boolean)[0] || '';
      resolve(code === 0 ? { ok: true, message: msg.replace(/\s+/g, ' ').slice(0, 120) } : { ok: false, message: msg || `sqlcmd exited with code ${code}` });
    });
  });
}

/** Restore a .bak taken by this app's backup of the same database; the file must be inside the backup folder */
async function runRestore(spec, env, send) {
  const { id } = spec, r = spec.restore || {};
  const c = sqlConn(spec.dbId);
  if (c.error) return { error: c.error };
  if (!r.destDir || !r.file) return { error: 'No backup file was chosen' };
  const dir = path.resolve(r.destDir), file = path.resolve(r.file);
  if (!(file + path.sep).toLowerCase().startsWith((dir + path.sep).toLowerCase()) || path.extname(file).toLowerCase() !== '.bak') return { error: 'The file must be a .bak inside the backup folder' };
  if (!fs.existsSync(file)) return { error: 'Backup file not found: ' + file };
  const db = sqlId(c.db);
  const script = `SET NOCOUNT ON;
BEGIN TRY
  IF DB_ID(${sqlStr(c.db)}) IS NOT NULL ALTER DATABASE ${db} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
  RESTORE DATABASE ${db} FROM DISK=${sqlStr(file)} WITH REPLACE, RECOVERY;
  ALTER DATABASE ${db} SET MULTI_USER;
END TRY
BEGIN CATCH
  IF DB_ID(${sqlStr(c.db)}) IS NOT NULL ALTER DATABASE ${db} SET MULTI_USER;
  THROW;
END CATCH
`;
  const tmp = path.join(os.tmpdir(), `prodkeeper-restore-${stamp()}.sql`);
  try { fs.writeFileSync(tmp, script, 'utf8'); } catch (e) { return { error: 'Cannot write the restore script: ' + e.message }; }
  send({ id, text: `Restoring ${c.db} on ${c.server}\nfrom ${file}\n(the SQL Server machine reads this path, so it must be reachable from it)\n\n` });
  try { return await spawnJob(id, 'sqlcmd', [...sqlcmdAuth(c), '-b', '-i', tmp], { env: { ...env, ...c.env } }, send); }
  finally { fs.rmSync(tmp, { force: true }); }
}

async function runBackup(spec, env, cwd, send) {
  const { id } = spec;
  let b = spec.backup || {};
  if (b.type === 'database') {
    const d = databaseBackup(spec.dbId);
    if (d.error) return { error: d.error };
    b = { ...b, type: 'command', command: d.command, shell: 'cmd' };
    env = { ...env, ...d.env };
  }
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
    result = await spawnJob(id, TAR, ['-a', '-c', '-f', file, ...ex, '-C', src, ...topEntries(src)], { env }, send);
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
  const dest = path.resolve(b.destDir);
  const zipFile = b.zip ? path.join(dest, b.versioned ? `${prefix}-${st}.zip` : `${prefix}.zip`) : '';
  // zip mode: the command writes to a temporary staging folder that is zipped into the destination afterwards
  const out = zipFile ? path.join(os.tmpdir(), `prodkeeper-publish-${prefix}-${st}`) : b.versioned ? path.join(dest, `${prefix}-${st}`) : dest;
  if (cwd && path.resolve(cwd).toLowerCase() === path.resolve(out).toLowerCase()) return { error: 'The destination folder must not be the same as the command working folder (the project)' };
  try { fs.mkdirSync(zipFile ? dest : out, { recursive: true }); if (zipFile) fs.mkdirSync(out, { recursive: true }); } catch (e) { return { error: 'Cannot create destination folder: ' + e.message }; }
  const sh = shellArgs(spec.shell, spec.command);
  send({ id, text: `> ${spec.command}\nPUBLISH_DIR=${out}\n\n` });
  try {
    const result = await spawnJob(id, sh.file, sh.args, { ...sh.opts, cwd, env: { ...env, PUBLISH_DIR: out, PUBLISH_STAMP: st, PUBLISH_NAME: prefix } }, send);
    if (result.code !== 0) return result;
    const stats = dirStats(out);
    if (!stats.files) return { ...result, code: -1, error: 'The command finished but the destination folder is empty; it must write its output to %PUBLISH_DIR%' };
    if (zipFile) {
      const part = path.join(dest, `.${prefix}-${st}.partial.zip`);
      send({ id, text: `\nCompressing ${stats.files} files\nto ${zipFile}\n` });
      const z = await spawnJob(id, TAR, ['-a', '-c', '-f', part, '-C', out, ...topEntries(out)], { env }, send);
      try {
        if (z.code !== 0) return { ...z, error: 'Compressing the output failed' };
        fs.renameSync(part, zipFile);
        result.size = fs.statSync(zipFile).size;
      } catch (e) { return { ...z, code: -1, error: 'Zip file was not created: ' + e.message }; }
      finally { fs.rmSync(part, { force: true }); }
      result.file = zipFile;
      send({ id, text: `✓ ${stats.files} files in ${zipFile}\n` });
    } else {
      result.file = out;
      result.size = stats.size;
      send({ id, text: `\n✓ ${stats.files} files in ${out}\n` });
    }
    if (b.versioned) {
      result.pruned = prune(dest, prefix, Number(b.keep));
      if (result.pruned.length) send({ id, text: `Older copies were removed (${result.pruned.length}).\n` });
    }
    return result;
  } finally {
    if (zipFile) try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* temp folder, cleaned up later by the OS */ }
  }
}

function kill(id) {
  const c = running.get(id);
  if (!c) return { ok: false };
  spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true });
  return { ok: true };
}

/** Synchronous so it finishes before the process exits */
function killServers() {
  for (const id of servers) {
    const c = running.get(id);
    if (c) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true });
  }
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

module.exports = { run, kill, testDatabase, killServers, listBackups, isRunning: id => running.has(id) };
