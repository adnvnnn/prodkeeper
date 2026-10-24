const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/*
 * Encrypted storage:
 *  - key = scrypt(master password, salt) — never stored anywhere and kept in memory only while the app is open
 *  - data.enc and vault.enc are encrypted with AES-256-GCM (random IV on every write); tampering with the files is detected
 *  - security.json only holds the KDF parameters and an encrypted "check sample" used to verify the password
 */
const KDF = { N: 65536, r: 8, p: 1 };
const dir = () => app.getPath('userData');
const P = {
  sec: () => path.join(dir(), 'security.json'),
  data: () => path.join(dir(), 'data.enc'),
  vault: () => path.join(dir(), 'vault.enc'),
  oldData: () => path.join(dir(), 'data.json'),
  oldVault: () => path.join(dir(), 'vault.json'),
  backups: () => path.join(dir(), 'backups'),
};

let key = null;
let vaultData = null;
let fails = 0, blockedUntil = 0;

const derive = (pw, salt, kdf = KDF) =>
  crypto.scryptSync(Buffer.from(String(pw), 'utf8'), Buffer.from(salt, 'base64'), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 });

function seal(k, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { v: 2, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
function openEnv(k, env) {
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(env.iv, 'base64'));
  d.setAuthTag(Buffer.from(env.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(env.ct, 'base64')), d.final()]).toString('utf8'));
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(obj), 'utf8');
  fs.renameSync(file + '.tmp', file);
}
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** Delete a plaintext file: first overwrite it with zeros (not fully guaranteed on SSDs) */
function shred(file) {
  if (!fs.existsSync(file)) return;
  try { fs.writeFileSync(file, Buffer.alloc(fs.statSync(file).size)); } catch { /* even if overwriting failed, still try to delete */ }
  try { fs.rmSync(file, { force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* retried on the next sign-in */ }
}

function status() {
  const hasSec = fs.existsSync(P.sec());
  return {
    state: key ? 'unlocked' : hasSec ? 'locked' : 'setup',
    legacy: !hasSec && (fs.existsSync(P.oldData()) || fs.existsSync(P.oldVault())),
    waitSec: Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000)),
  };
}
const isUnlocked = () => !!key;

function persistAll(dataObj) {
  writeJson(P.sec(), P._sec);
  if (dataObj) writeJson(P.data(), seal(key, dataObj));
  writeJson(P.vault(), seal(key, vaultData || { entries: [] }));
}

function migrateLegacy() {
  let data = null;
  const od = readJson(P.oldData());
  if (od && typeof od === 'object') data = od;
  const ov = readJson(P.oldVault());
  const entries = [];
  if (ov && Array.isArray(ov.entries)) {
    for (const e of ov.entries) {
      const { secret, ...rest } = e;
      let plain = '';
      if (secret) { try { plain = safeStorage.decryptString(Buffer.from(secret, 'base64')); } catch { /* could not be read */ } }
      entries.push({ ...rest, secret: plain });
    }
  }
  return { data, entries };
}
function purgeLegacy() {
  shred(P.oldData());
  shred(P.oldVault());
  try {
    for (const f of fs.readdirSync(P.backups())) if (/^data-.*\.json$/.test(f)) shred(path.join(P.backups(), f));
  } catch { /* folder does not exist */ }
}

function setup(pw) {
  if (fs.existsSync(P.sec())) return { error: 'The master password is already set' };
  if (String(pw).length < 8) return { error: 'The master password must be at least 8 characters' };
  const salt = crypto.randomBytes(16).toString('base64');
  key = derive(pw, salt);
  P._sec = { v: 2, kdf: { ...KDF, salt }, check: seal(key, { ok: true }) };
  const m = migrateLegacy();
  vaultData = { entries: m.entries };
  persistAll(m.data);
  purgeLegacy();
  fails = 0;
  return { ok: true, migrated: !!(m.data || m.entries.length) };
}

function unlock(pw) {
  if (Date.now() < blockedUntil) return { error: `Too many failed attempts; wait ${Math.ceil((blockedUntil - Date.now()) / 1000)} seconds` };
  const sec = readJson(P.sec());
  if (!sec) return { error: 'The app has not been set up yet' };
  try {
    const k = derive(pw, sec.kdf.salt, sec.kdf);
    openEnv(k, sec.check);
    key = k;
    P._sec = sec;
  } catch {
    fails++;
    if (fails >= 5) { blockedUntil = Date.now() + Math.min(30000 * (fails - 4), 600000); }
    return { error: 'Wrong password' };
  }
  fails = 0;
  const env = readJson(P.vault());
  try { vaultData = env ? openEnv(key, env) : { entries: [] }; } catch { lock(); return { error: 'The vault file is damaged or has been tampered with' }; }
  try { reconcileLegacy(); } catch { /* sign-in must not fail because of cleaning up an old file */ }
  return { ok: true };
}

/** If an old plaintext file is still around (e.g. deleting it failed during migration), merge any missing items into the encrypted copy and delete the file */
function reconcileLegacy() {
  const od = readJson(P.oldData()), ov = readJson(P.oldVault());
  if (od && typeof od === 'object') {
    const cur = loadData().data;
    if (!cur) writeJson(P.data(), seal(key, od));
    else {
      const ids = new Set((cur.projects || []).map(p => p.id));
      const missing = (od.projects || []).filter(p => !ids.has(p.id));
      if (missing.length) { cur.projects = [...(cur.projects || []), ...missing]; writeJson(P.data(), seal(key, cur)); }
    }
  }
  if (ov && Array.isArray(ov.entries)) {
    const have = new Set(vaultData.entries.map(e => e.id));
    let added = false;
    for (const e of ov.entries) {
      if (have.has(e.id)) continue;
      const { secret, ...rest } = e;
      let plain = '';
      if (secret) { try { plain = safeStorage.decryptString(Buffer.from(secret, 'base64')); } catch { /* could not be read */ } }
      vaultData.entries.push({ ...rest, secret: plain });
      added = true;
    }
    if (added) writeJson(P.vault(), seal(key, vaultData));
  }
  purgeLegacy();
}

function lock() {
  if (key) key.fill(0);
  key = null;
  vaultData = null;
  return { ok: true };
}

function loadData() {
  if (!key) return { locked: true };
  const env = readJson(P.data());
  if (!env) return { ok: true, data: null };
  try { return { ok: true, data: openEnv(key, env) }; } catch { return { error: 'The data file is damaged or has been tampered with' }; }
}
function dailyBackup() {
  try {
    if (!fs.existsSync(P.data())) return;
    fs.mkdirSync(P.backups(), { recursive: true });
    const target = path.join(P.backups(), `data-${new Date().toISOString().slice(0, 10)}.enc`);
    if (!fs.existsSync(target)) fs.copyFileSync(P.data(), target);
    const old = fs.readdirSync(P.backups()).filter(f => /^data-.*\.enc$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - 14)).forEach(f => fs.unlinkSync(path.join(P.backups(), f)));
  } catch { /* a failed backup must not block saving */ }
}
function saveData(obj) {
  if (!key || !obj || typeof obj !== 'object') return false;
  dailyBackup();
  writeJson(P.data(), seal(key, obj));
  return true;
}

const vault = () => vaultData;
function saveVault() {
  if (!key || !vaultData) return false;
  writeJson(P.vault(), seal(key, vaultData));
  return true;
}

function changePassword(oldPw, newPw) {
  const sec = readJson(P.sec());
  try { openEnv(derive(oldPw, sec.kdf.salt, sec.kdf), sec.check); } catch { return { error: 'The current password is wrong' }; }
  if (String(newPw).length < 8) return { error: 'The new password must be at least 8 characters' };
  const cur = loadData();
  const salt = crypto.randomBytes(16).toString('base64');
  const nk = derive(newPw, salt);
  if (key) key.fill(0);
  key = nk;
  P._sec = { v: 2, kdf: { ...KDF, salt }, check: seal(key, { ok: true }) };
  persistAll(cur.data || null);
  return { ok: true };
}

function reset() {
  lock();
  for (const f of [P.sec(), P.data(), P.vault(), P.oldData(), P.oldVault()]) shred(f);
  try { for (const f of fs.readdirSync(P.backups())) shred(path.join(P.backups(), f)); } catch { /* ok */ }
  fails = 0; blockedUntil = 0;
  return { ok: true };
}

/** Full encrypted backup; on any computer it can only be opened with the same master password */
function exportBundle() {
  if (!key) return null;
  return { kind: 'prodkeeper-backup', v: 2, security: readJson(P.sec()), data: readJson(P.data()), vault: readJson(P.vault()) };
}
function importBundle(b, pw) {
  if (!b || b.kind !== 'prodkeeper-backup' || !b.security || !b.vault) return { error: 'Not a valid backup file' };
  let k;
  try { k = derive(pw, b.security.kdf.salt, b.security.kdf); openEnv(k, b.security.check); } catch { return { error: 'Wrong master password for this backup' }; }
  try { openEnv(k, b.vault); if (b.data) openEnv(k, b.data); } catch { return { error: 'The backup content is damaged' }; }
  lock();
  writeJson(P.sec(), b.security);
  if (b.data) writeJson(P.data(), b.data);
  writeJson(P.vault(), b.vault);
  return unlock(pw);
}

module.exports = { status, isUnlocked, setup, unlock, lock, loadData, saveData, vault, saveVault, changePassword, reset, exportBundle, importBundle };
