const tls = require('tls');
const { shell } = require('electron');
const vault = require('./vault');

const isHttp = u => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch { return false; } };

function openUrl(u) {
  if (!isHttp(u)) return { error: 'Only http/https URLs can be opened' };
  shell.openExternal(u);
  return { ok: true };
}

function certDays(url) {
  return new Promise(resolve => {
    const u = new URL(url);
    const s = tls.connect({ host: u.hostname, port: Number(u.port) || 443, servername: u.hostname, timeout: 6000 }, () => {
      const c = s.getPeerCertificate();
      s.end();
      resolve(c && c.valid_to ? Math.floor((new Date(c.valid_to) - Date.now()) / 864e5) : null);
    });
    s.on('error', () => resolve(null));
    s.on('timeout', () => { s.destroy(); resolve(null); });
  });
}

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function parseHeaders(projectId, text) {
  const headers = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(':');
    const name = i > 0 ? line.slice(0, i).trim() : '';
    if (!/^[\w-]+$/.test(name)) return { error: `Invalid header: ${line.slice(0, 40)}` };
    const v = vault.resolveText(projectId, line.slice(i + 1).trim());
    if (v.error) return { error: v.error };
    headers[name] = v.text;
  }
  return { headers };
}

async function readCapped(r, cap) {
  if (!r.body) return { text: '', size: 0, truncated: false };
  const reader = r.body.getReader();
  const chunks = [];
  let size = 0, truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    chunks.push(value);
    if (size >= cap) { truncated = true; reader.cancel().catch(() => {}); break; }
  }
  return { text: Buffer.concat(chunks).toString('utf8').slice(0, cap), size, truncated };
}

/** Sends a request to the app and returns its status (code, timing, headers, JSON body) */
async function check(spec) {
  const { url, method = 'GET', headers = '', body, expect, keyword, projectId = '', full } = spec || {};
  const fail = error => ({ ok: false, error, at: Date.now() });
  if (!isHttp(url)) return fail('Invalid URL');
  const m = String(method).toUpperCase();
  if (!METHODS.has(m)) return fail('Invalid method');
  const hr = parseHeaders(projectId, headers);
  if (hr.error) return fail(hr.error);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: m, redirect: 'follow', signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'ProdKeeper/1.0', ...hr.headers },
      body: m === 'GET' || m === 'HEAD' ? undefined : (body || undefined),
    });
    const ms = Date.now() - t0;
    const { text, size, truncated } = await readCapped(r, 65536);
    const ct = r.headers.get('content-type') || '';
    let json;
    if (/json/i.test(ct) || /^\s*[{[]/.test(text)) { try { json = JSON.parse(text); } catch { /* not JSON */ } }
    const res = {
      status: r.status, statusText: r.statusText, ms, total: Date.now() - t0, size, truncated, at: Date.now(),
      contentType: ct, finalUrl: r.url, method: m, headers: Object.fromEntries([...r.headers].slice(0, 40)),
      body: text.slice(0, full ? 65536 : 4000),
    };
    res.ok = expect ? r.status === Number(expect) : r.status < 400;
    if (keyword) { res.keywordOk = text.includes(keyword); if (!res.keywordOk) res.ok = false; }
    if (json !== undefined && JSON.stringify(json).length < 30000) res.json = json;
    if (url.startsWith('https:')) res.certDays = await certDays(url);
    return res;
  } catch (e) {
    return fail((e.cause && e.cause.code) || e.message);
  }
}

/* ---------- GitHub Actions ---------- */
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
async function gh({ repo, tokenId }, method, p, body) {
  if (!REPO_RE.test(repo || '')) return { error: 'Repository must be in the form owner/repo' };
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ProdKeeper/1.0' };
  if (tokenId) {
    const s = vault.getSecret(tokenId);
    if (s.error) return { error: s.error };
    headers.Authorization = `Bearer ${s.secret}`;
  }
  if (body) headers['Content-Type'] = 'application/json';
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    if (r.status === 204 || r.status === 201 && !(r.headers.get('content-type') || '').includes('json')) return { data: {} };
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const hint = r.status === 404 && !tokenId ? ' (a token is required for private repositories)' : r.status === 401 ? ' (invalid token)' : '';
      return { error: `GitHub ${r.status}: ${data.message || 'error'}${hint}` };
    }
    return { data };
  } catch (e) { return { error: 'Could not connect to GitHub: ' + ((e.cause && e.cause.code) || e.message) }; }
}

async function ciRuns(cfg, branch) {
  const q = branch && /^[\w./@+-]+$/.test(branch) ? `&branch=${encodeURIComponent(branch)}` : '';
  const r = await gh(cfg, 'GET', `/actions/runs?per_page=12${q}`);
  if (r.error) return r;
  return {
    runs: (r.data.workflow_runs || []).map(w => ({
      id: w.id, name: w.name, branch: w.head_branch, event: w.event, status: w.status, conclusion: w.conclusion,
      url: w.html_url, title: (w.display_title || (w.head_commit && w.head_commit.message) || '').split('\n')[0],
      actor: w.actor && w.actor.login, started: Date.parse(w.run_started_at || w.created_at), updated: Date.parse(w.updated_at),
    })),
  };
}
async function ciWorkflows(cfg) {
  const r = await gh(cfg, 'GET', '/actions/workflows');
  if (r.error) return r;
  return { workflows: (r.data.workflows || []).filter(w => w.state === 'active').map(w => ({ id: w.id, name: w.name, path: w.path })) };
}
async function ciAction(cfg, action, p) {
  if (action === 'dispatch') {
    if (!Number.isInteger(p.workflowId) || !/^[\w./@+-]+$/.test(p.ref || '')) return { error: 'Invalid input' };
    const r = await gh(cfg, 'POST', `/actions/workflows/${p.workflowId}/dispatches`, { ref: p.ref });
    return r.error ? r : { ok: true };
  }
  if (!Number.isInteger(p.runId)) return { error: 'Invalid run id' };
  const path = { rerun: `/actions/runs/${p.runId}/rerun`, rerunFailed: `/actions/runs/${p.runId}/rerun-failed-jobs`, cancel: `/actions/runs/${p.runId}/cancel` }[action];
  if (!path) return { error: 'Unknown operation' };
  const r = await gh(cfg, 'POST', path);
  return r.error ? r : { ok: true };
}

module.exports = { openUrl, check, ciRuns, ciWorkflows, ciAction };
