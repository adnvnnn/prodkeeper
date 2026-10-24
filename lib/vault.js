const { clipboard } = require('electron');
const crypto = require('crypto');
const secure = require('./secure');

// Vault: every item (label, username, URL, note and secret) is encrypted inside vault.enc (AES-256-GCM with a key derived from the master password).
// Secrets are only decrypted in memory when shown, copied or used in commands.
const LOCKED = 'The app is locked';
const CLIP_CLEAR = 20 * 1000;
let lastCopied = null;

const entries = () => (secure.vault() ? secure.vault().entries : null);
const strip = ({ secret, ...rest }) => ({ ...rest, hasSecret: !!secret });

function status() { return { unlocked: secure.isUnlocked() }; }
function list() { const e = entries(); return e ? e.map(strip) : []; }

function save(e, secret) {
  const all = entries();
  if (!all) return { error: LOCKED };
  const now = Date.now();
  let entry = all.find(x => x.id === e.id);
  if (!entry) { entry = { id: crypto.randomUUID(), createdAt: now }; all.push(entry); }
  for (const k of ['projectId', 'label', 'kind', 'username', 'url', 'notes', 'expires']) entry[k] = String(e[k] ?? '');
  if (typeof secret === 'string' && secret !== '') entry.secret = secret;
  entry.updatedAt = now;
  secure.saveVault();
  return { ok: true, id: entry.id };
}
function remove(id) {
  const v = secure.vault();
  if (!v) return { error: LOCKED };
  v.entries = v.entries.filter(x => x.id !== id);
  secure.saveVault();
  return { ok: true };
}
function removeByProject(projectId) {
  const v = secure.vault();
  if (!v) return { error: LOCKED };
  v.entries = v.entries.filter(x => x.projectId !== projectId);
  secure.saveVault();
  return { ok: true };
}

function getSecret(id) {
  const all = entries();
  if (!all) return { error: LOCKED };
  const e = all.find(x => x.id === id);
  if (!e || !e.secret) return { error: 'No secret is stored' };
  return { secret: e.secret };
}
const reveal = getSecret;
function copy(id) {
  const r = getSecret(id);
  if (r.error) return r;
  clipboard.writeText(r.secret);
  lastCopied = r.secret;
  setTimeout(clearClipboard, CLIP_CLEAR);
  return { ok: true, clearAfter: CLIP_CLEAR / 1000 };
}
/** Clear the clipboard if it still holds that secret (also called on lock and quit) */
function clearClipboard() {
  if (lastCopied && clipboard.readText() === lastCopied) clipboard.clear();
  lastCopied = null;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const find = (projectId, label) => (entries() || []).find(x => x.label.toLowerCase() === label.toLowerCase() && (x.projectId === projectId || x.projectId === ''));

/** Lines NAME=value or NAME=@label; secrets is the list of confidential values so they are masked in logs */
function resolveEnv(projectId, spec) {
  const env = {}, secrets = [];
  for (const raw of String(spec || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) return { error: `Invalid line in environment variables: ${line}` };
    const name = line.slice(0, i).trim(), val = line.slice(i + 1).trim();
    if (!ENV_NAME.test(name)) return { error: `Invalid variable name: ${name}` };
    if (val.startsWith('@')) {
      if (!entries()) return { error: LOCKED };
      const e = find(projectId, val.slice(1).trim());
      if (!e || !e.secret) return { error: `Item "${val.slice(1)}" was not found in the vault` };
      env[name] = e.secret;
      secrets.push(e.secret);
    } else env[name] = val;
  }
  return { env, secrets };
}

/** In the text, every @label that exists in the vault is replaced with its value (for request headers) */
function resolveText(projectId, text) {
  let err = null;
  const out = String(text).replace(/@([\w.-]+)/g, (m, label) => {
    if (err) return m;
    if (!entries()) { err = LOCKED; return m; }
    const e = find(projectId, label);
    return e && e.secret ? e.secret : m;
  });
  return err ? { error: err } : { text: out };
}

/** Removes confidential values from the output text */
function mask(text, secrets) {
  let t = String(text);
  for (const s of secrets) if (s && s.length >= 4) t = t.split(s).join('••••••');
  return t;
}

module.exports = { status, list, save, remove, removeByProject, reveal, copy, clearClipboard, getSecret, resolveEnv, resolveText, mask, LOCKED };
