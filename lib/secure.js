const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/*
 * ذخیرهٔ رمزنگاری‌شده:
 *  - کلید = scrypt(رمز اصلی, salt)  — هیچ‌جا ذخیره نمی‌شود و فقط تا زمانی که برنامه باز است در حافظه می‌ماند
 *  - data.enc و vault.enc با AES-256-GCM (IV تصادفی برای هر نوشتن) رمزنگاری می‌شوند؛ دست‌کاری فایل شناسایی می‌شود
 *  - security.json فقط پارامترهای KDF و یک «نمونهٔ رمزشده» برای راستی‌آزمایی رمز دارد
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

/** حذف فایل متن‌ساده: اول با صفر بازنویسی می‌شود (روی SSD تضمین کامل نیست) */
function shred(file) {
  if (!fs.existsSync(file)) return;
  try { fs.writeFileSync(file, Buffer.alloc(fs.statSync(file).size)); } catch { /* حتی اگر بازنویسی نشد، حذف را امتحان می‌کنیم */ }
  try { fs.rmSync(file, { force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* بعداً در ورود بعدی دوباره تلاش می‌شود */ }
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
      if (secret) { try { plain = safeStorage.decryptString(Buffer.from(secret, 'base64')); } catch { /* قابل خواندن نبود */ } }
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
  } catch { /* پوشه نیست */ }
}

function setup(pw) {
  if (fs.existsSync(P.sec())) return { error: 'رمز اصلی قبلاً تنظیم شده است' };
  if (String(pw).length < 8) return { error: 'رمز اصلی باید دست‌کم ۸ نویسه باشد' };
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
  if (Date.now() < blockedUntil) return { error: `تلاش‌های ناموفق زیاد بود؛ ${Math.ceil((blockedUntil - Date.now()) / 1000)} ثانیه صبر کنید` };
  const sec = readJson(P.sec());
  if (!sec) return { error: 'برنامه هنوز راه‌اندازی نشده است' };
  try {
    const k = derive(pw, sec.kdf.salt, sec.kdf);
    openEnv(k, sec.check);
    key = k;
    P._sec = sec;
  } catch {
    fails++;
    if (fails >= 5) { blockedUntil = Date.now() + Math.min(30000 * (fails - 4), 600000); }
    return { error: 'رمز اشتباه است' };
  }
  fails = 0;
  const env = readJson(P.vault());
  try { vaultData = env ? openEnv(key, env) : { entries: [] }; } catch { lock(); return { error: 'فایل گاوصندوق آسیب دیده یا دست‌کاری شده است' }; }
  try { reconcileLegacy(); } catch { /* ورود نباید به خاطر پاک‌سازی فایل قدیمی شکست بخورد */ }
  return { ok: true };
}

/** اگر فایل متن‌سادهٔ قدیمی هنوز مانده باشد (مثلاً حذفش در مهاجرت شکست خورده)، موارد جاافتاده را در نسخهٔ رمزنگاری‌شده ادغام و فایل را پاک می‌کند */
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
      if (secret) { try { plain = safeStorage.decryptString(Buffer.from(secret, 'base64')); } catch { /* قابل خواندن نبود */ } }
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
  try { return { ok: true, data: openEnv(key, env) }; } catch { return { error: 'فایل داده آسیب دیده یا دست‌کاری شده است' }; }
}
function dailyBackup() {
  try {
    if (!fs.existsSync(P.data())) return;
    fs.mkdirSync(P.backups(), { recursive: true });
    const target = path.join(P.backups(), `data-${new Date().toISOString().slice(0, 10)}.enc`);
    if (!fs.existsSync(target)) fs.copyFileSync(P.data(), target);
    const old = fs.readdirSync(P.backups()).filter(f => /^data-.*\.enc$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - 14)).forEach(f => fs.unlinkSync(path.join(P.backups(), f)));
  } catch { /* پشتیبان‌گیری نباید مانع ذخیره شود */ }
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
  try { openEnv(derive(oldPw, sec.kdf.salt, sec.kdf), sec.check); } catch { return { error: 'رمز فعلی اشتباه است' }; }
  if (String(newPw).length < 8) return { error: 'رمز جدید باید دست‌کم ۸ نویسه باشد' };
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

/** پشتیبان کامل رمزنگاری‌شده؛ روی هر کامپیوتر فقط با همان رمز اصلی باز می‌شود */
function exportBundle() {
  if (!key) return null;
  return { kind: 'appwarden-backup', v: 2, security: readJson(P.sec()), data: readJson(P.data()), vault: readJson(P.vault()) };
}
function importBundle(b, pw) {
  if (!b || !['appwarden-backup', 'project-control-backup'].includes(b.kind) || !b.security || !b.vault) return { error: 'فایل پشتیبان معتبر نیست' };
  let k;
  try { k = derive(pw, b.security.kdf.salt, b.security.kdf); openEnv(k, b.security.check); } catch { return { error: 'رمز اصلیِ این پشتیبان اشتباه است' }; }
  try { openEnv(k, b.vault); if (b.data) openEnv(k, b.data); } catch { return { error: 'محتوای پشتیبان آسیب دیده است' }; }
  lock();
  writeJson(P.sec(), b.security);
  if (b.data) writeJson(P.data(), b.data);
  writeJson(P.vault(), b.vault);
  return unlock(pw);
}

module.exports = { status, isUnlocked, setup, unlock, lock, loadData, saveData, vault, saveVault, changePassword, reset, exportBundle, importBundle };
