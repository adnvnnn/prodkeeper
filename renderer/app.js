'use strict';

/* ======================= App state ======================= */
const KINDS = { server: 'Server / SSH', db: 'Database', api: 'API key / token', env: 'Environment variable', web: 'Panel / website', other: 'Other' };

let S = null; // persisted data: projects, history, settings
const C = { git: {}, gd: {}, tb: {}, health: {}, ci: {}, wf: {}, backups: {}, vault: [] }; // transient cache
const V = { name: 'projects', pid: null, tab: 'tasks', bfilter: 'all', hKind: '', hProj: '', vProj: '', runId: null };
const RUN = {}; // jobs in flight: id -> {h}

const blank = () => ({ version: 2, projects: [], history: [], runlog: [], archive: [], checks: {}, settings: { theme: 'dark', healthMin: 5, notified: '', autoLockMin: 15, notifyOn: true, wip: T_WIP_DEFAULT }, pet: normPet() });
const normProject = p => normTasks({
  repoPath: '', ...p, desc: undefined, notes: undefined, color: undefined,
  priority: [0, 1, 2].includes(p.priority) ? p.priority : 1,
  envs: p.envs || [], deploys: p.deploys || [], backups: p.backups || [], tasks: p.tasks || [], ops: p.ops || [],
  ci: { repo: '', tokenId: '', ...(p.ci || {}) },
  run: { command: '', shell: 'cmd', url: '', envSpec: '', dbId: '', ...(p.run || {}) },
  build: { command: '', shell: 'cmd', envSpec: '', dbId: '', ...(p.build || {}) },
  sprints: Array.isArray(p.sprints) ? p.sprints : [],
  taskSeq: p.taskSeq || 0,
});
/** Fills in the fields tasks got when backlog / sprints / estimates / git links were added, and numbers old tasks */
function normTasks(p) {
  let seq = Math.max(p.taskSeq || 0, ...p.tasks.map(t => t.num || 0));
  for (const t of p.tasks) {
    if (!['backlog', 'todo', 'doing', 'done'].includes(t.status)) t.status = 'todo';
    if (!t.num) t.num = ++seq;
    t.estimate = t.estimate || 0; t.sprintId = t.sprintId || ''; t.branch = t.branch || ''; t.branchAt = t.branchAt || 0;
  }
  p.taskSeq = seq;
  return p;
}
function normalize(d) {
  const b = blank();
  if (!d || typeof d !== 'object') return b;
  const out = {
    ...b, version: 2,
    projects: (Array.isArray(d.projects) ? d.projects : []).map(normProject),
    history: Array.isArray(d.history) ? d.history : [],
    runlog: Array.isArray(d.runlog) ? d.runlog : [],
    archive: Array.isArray(d.archive) ? d.archive : [],
    checks: d.checks && typeof d.checks === 'object' ? d.checks : {},
    settings: { ...b.settings, ...(d.settings || {}) },
    pet: normPet(d.pet),
  };
  if (!['system', 'light', 'dark'].includes(out.settings.theme)) out.settings.theme = 'dark';
  if (!(out.settings.wip >= 0)) { // the WIP limit used to be set per app: keep the first one that was set
    const old = out.projects.find(p => p.wip >= 0);
    out.settings.wip = old ? old.wip : T_WIP_DEFAULT;
  }
  out.settings.wip = Math.round(out.settings.wip);
  return out;
}

let saveTimer = null;
let NOSAVE = false; // if the data file was corrupt we do not write over it
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (!NOSAVE) native.data.save(S); pushPopup(); }, 200); }
window.addEventListener('beforeunload', () => { if (!NOSAVE && S) native.data.saveSync(S); });

const proj = id => S.projects.find(p => p.id === id);
/** Display order of projects: by priority, high first (stable; drag order is kept within each priority) */
const orderedProjects = () => [...S.projects].sort((a, b) => b.priority - a.priority);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function addHistory(h) {
  S.history.unshift(h);
  if (S.history.length > 400) S.history.length = 400;
  logRun(h);
  save();
}

/* The history above is capped and can be cleared, so finished operations are also kept as a compact, long-lived log
 * (S.runlog). Reports read from it; a quarterly report would otherwise lose most of its deploys and backups.
 * a = 1 marks runs the app started by itself (scheduled backups), which are not "you at work". */
const RUNLOG_MAX = 20000;
const runlogIds = new Set();
function logRun(h) {
  if (!h || h.status === 'running' || runlogIds.has(h.id)) return;
  runlogIds.add(h.id);
  S.runlog.push({ id: h.id, t: h.start, d: h.end ? h.end - h.start : 0, pid: h.projectId, k: h.kind, s: h.status, n: String(h.title || '').slice(0, 80), a: h.auto ? 1 : 0 });
  if (S.runlog.length > RUNLOG_MAX) S.runlog.splice(0, S.runlog.length - RUNLOG_MAX);
}
/** On startup: index the log and add any finished history that is not in it yet (data from before the log existed) */
function syncRunlog() {
  runlogIds.clear();
  S.runlog.forEach(r => runlogIds.add(r.id));
  for (const h of [...S.history].reverse()) {
    if (h.kind === 'backup' && h.auto === undefined) { // older runs: a backup with a schedule was most likely started by it
      const b = (proj(h.projectId) || { backups: [] }).backups.find(x => x.id === h.refId);
      h.auto = !!(b && b.everyHours > 0);
    }
    logRun(h);
  }
}
const lastRun = (refId, kind) => S.history.find(h => h.refId === refId && (!kind || h.kind === kind) && h.status !== 'running');
const isRunning = refId => Object.values(RUN).some(r => r.h.refId === refId && r.h.status === 'running');

/* ======================= Loading statuses ======================= */
async function loadGit(p) {
  if (!p.repoPath) { delete C.git[p.id]; return; }
  C.git[p.id] = await native.git('status', p.repoPath);
}
async function loadGitDetail(p) {
  if (!p.repoPath) return;
  const [br, lg, tg] = await Promise.all([native.git('branches', p.repoPath), native.git('log', p.repoPath, { n: 15 }), native.git('tags', p.repoPath)]);
  C.gd[p.id] = { br, lg, tg };
}
const ciCfg = p => ({ repo: p.ci.repo, tokenId: p.ci.tokenId || '' });
async function loadCI(p) {
  if (!p.ci.repo) { delete C.ci[p.id]; return; }
  C.ci[p.id] = { ...(await native.ci.runs(ciCfg(p), null)), at: Date.now() };
}
async function loadWf(p) { if (p.ci.repo) C.wf[p.id] = await native.ci.workflows(ciCfg(p)); }
/** Sends a request to an environment's monitoring URL and records the result in memory and in the light history (for uptime) */
async function checkEnv(p, e) {
  const r = await native.net.check({
    url: e.checkUrl || e.url, method: e.method || 'GET', headers: e.headers || '',
    expect: e.expect || '', keyword: e.keyword || '', projectId: p.id,
  });
  C.health[e.id] = r;
  const arr = S.checks[e.id] || (S.checks[e.id] = []);
  arr.push({ t: r.at, ok: !!r.ok, ms: r.ms || 0, s: r.status || 0 });
  if (arr.length > 120) arr.splice(0, arr.length - 120);
  save();
  return r;
}
async function loadHealth(p) {
  await Promise.all(p.envs.filter(e => e.url || e.checkUrl).map(e => checkEnv(p, e)));
}
async function loadBackups(b) {
  if (b.destDir) C.backups[b.id] = await native.job.backups(b.destDir, b.name);
}
async function loadVault() {
  C.vault = await native.vault.list();
}

async function refreshAll(manual) {
  await Promise.all(S.projects.map(p => Promise.all([loadGit(p), loadCI(p), loadHealth(p)])));
  await refreshTaskBranches();
  softRender();
  if (manual) toast('Statuses refreshed');
}
async function enterTab() {
  const p = proj(V.pid);
  if (!p) return;
  const t = V.tab, jobs = [loadGit(p)];
  if (t === 'git' || t === 'ci') jobs.push(loadGitDetail(p));
  if (t === 'tasks') jobs.push(loadTaskBranches(p));
  if (t === 'ci' || t === 'tasks') jobs.push(loadCI(p));
  if (t === 'ci') jobs.push(loadWf(p));
  if (t === 'status') jobs.push(loadHealth(p));
  if (t === 'backup') p.backups.forEach(b => jobs.push(loadBackups(b)));
  await Promise.all(jobs);
  softRender();
}
function openProject(pid, tab = 'tasks') {
  go('project', { pid, tab });
  enterTab();
}

/* ======================= Alerts ======================= */
function backupMaxAgeH(b) { return b.everyHours > 0 ? b.everyHours * 2 : 24 * 7; }
/* Every important item in the app comes from here: the alert bell at the top, the menu counter, the tray icon and Windows notifications.
 * Any new important state added to the app must also create an alert here. */
function computeAlerts() {
  const A = [];
  const iso = t => '⁨' + t + '⁩'; // direction is derived from the text itself so trailing characters of a URL (like /) do not jump around
  const add = (p, sev, text, tab) => A.push({ pid: p ? p.id : '', name: p ? p.name : 'Vault', sev, text, tab });
  for (const p of S.projects) {
    const g = C.git[p.id];
    if (p.repoPath && g) {
      if (g.error) add(p, 'warn', 'git repository: ' + g.error, 'git');
      else {
        if (g.dirty) add(p, 'warn', `${num(g.dirty)} changed files not committed`, 'git');
        if (g.ahead) add(p, 'warn', `${num(g.ahead)} unpushed commits on ${g.branch}`, 'git');
        if (g.behind) add(p, 'warn', `${num(g.behind)} new commits on the remote (pull needed)`, 'git');
      }
    }
    const ci = C.ci[p.id];
    if (ci && ci.runs) {
      const def = C.git[p.id] && C.git[p.id].default;
      const last = ci.runs.find(r => r.status === 'completed' && (!def || r.branch === def)) || ci.runs.find(r => r.status === 'completed');
      if (last && last.conclusion === 'failure') add(p, 'bad', `CI failed: ${last.name} on ${last.branch}`, 'ci');
    }
    const sp = activeSprint(p);
    if (sp && diffDays(sp.end) < 0) add(p, 'warn', `Sprint "${iso(sp.name)}" ended ${num(-diffDays(sp.end))} days ago — close it and run the retro`, 'tasks');
    if (wipLimit(p) && doingCount(p) > wipLimit(p)) add(p, 'warn', `${num(doingCount(p))} tasks in progress (WIP limit ${num(wipLimit(p))})`, 'tasks');
    for (const t of p.tasks) {
      const run = t.status === 'doing' && branchRun(p, t);
      if (run && run.status === 'completed' && run.conclusion === 'failure') add(p, 'warn', `CI failed on ${iso(t.branch)} (${taskKey(p, t)} ${iso(t.title)})`, 'tasks');
    }
    for (const e of p.envs) {
      const h = C.health[e.id];
      if (!h) continue;
      if (!h.ok) add(p, 'bad', `${iso(e.name || e.url)} is unhealthy (${h.error || (h.keywordOk === false ? 'expected text was not in the response' : 'HTTP ' + h.status)})`, 'status');
      else if (h.certDays != null && h.certDays <= 14) add(p, h.certDays <= 3 ? 'bad' : 'warn', `SSL certificate for "${iso(e.name || e.url)}" expires in ${num(Math.max(h.certDays, 0))} days`, 'status');
    }
    for (const d of p.deploys) {
      const r = lastRun(d.id, 'deploy');
      if (r && r.status === 'fail') add(p, 'bad', `The last deploy "${iso(d.name)}" failed`, 'deploy');
    }
    for (const o of p.ops) {
      const r = lastRun(o.id, o.type === 'db' ? 'dbupdate' : 'publish');
      if (r && r.status === 'fail') add(p, 'bad', `The last ${o.type === 'db' ? 'database update' : 'publish'} "${iso(o.name)}" failed`, 'deploy');
    }
    for (const b of p.backups) {
      const r = lastRun(b.id, 'backup');
      const ok = S.history.find(h => h.refId === b.id && h.status === 'ok');
      if (r && r.status === 'fail') add(p, 'bad', `The last backup "${iso(b.name)}" failed`, 'backup');
      else if (!ok) add(p, 'warn', `No successful backup of "${iso(b.name)}" yet`, 'backup');
      else if (Date.now() - ok.start > backupMaxAgeH(b) * 3600e3) add(p, 'warn', `Backup "${iso(b.name)}" is stale (${ago(ok.start)})`, 'backup');
    }
  }
  for (const v of C.vault) {
    if (!v.expires) continue;
    const d = diffDays(v.expires), p = proj(v.projectId);
    if (d < 0) add(p, 'bad', `"${iso(v.label)}" has expired`, 'vault');
    else if (d <= 30) add(p, 'warn', `"${iso(v.label)}" expires in ${num(d)} days`, 'vault');
  }
  return A.sort((a, b) => (a.sev === 'bad' ? 0 : 1) - (b.sev === 'bad' ? 0 : 1));
}
function projSeverity(pid) {
  const A = computeAlerts().filter(a => a.pid === pid);
  if (A.some(a => a.sev === 'bad')) return 'bad';
  if (A.length) return 'warn';
  return C.git[pid] || S.projects.find(p => p.id === pid)?.envs.some(e => C.health[e.id]) ? 'ok' : 'none';
}

/* ======================= Rendering ======================= */
/* Back / forward history (mouse side buttons, Alt+Left / Alt+Right): one entry per page, project tab or task view */
const NAV = { stack: [], i: -1, restoring: false };
const navKey = () => `${V.name}|${V.pid}|${V.tab}|${V.tview}`;
function navPush() {
  if (NAV.restoring) return;
  const cur = NAV.stack[NAV.i];
  if (cur && cur.key === navKey()) return;
  NAV.stack.length = NAV.i + 1;
  NAV.stack.push({ key: navKey(), name: V.name, pid: V.pid, tab: V.tab, tview: V.tview });
  if (NAV.stack.length > 100) NAV.stack.shift();
  NAV.i = NAV.stack.length - 1;
}
navPush(); // the starting page
function navMove(step) {
  const i = NAV.i + step;
  if (i < 0 || i >= NAV.stack.length || !$('#modal').hidden) return;
  NAV.i = i;
  const { name, pid, tab, tview } = NAV.stack[i];
  Object.assign(V, { name, pid, tab, tview });
  NAV.restoring = true;
  try {
    if (name === 'vault') loadVault().then(softRender);
    render();
    $('#main').scrollTop = 0;
    if (name === 'project') enterTab();
  } finally { NAV.restoring = false; }
}
function go(name, extra = {}) {
  Object.assign(V, { name }, extra);
  navPush();
  render();
  $('#main').scrollTop = 0;
}
function render() {
  if (typeof locking !== 'undefined' && locking) return; // do not rebuild content while locking
  renderTopbar();
  const views = { projects: viewProjects, tasks: viewTasksAll, project: viewProject, history: viewHistory, reports: viewReports, vault: viewVault, settings: viewSettings };
  $('#main').innerHTML = (views[V.name] || viewProjects)();
  if (V.name === 'settings') fillSettings();
}
function softRender() {
  if (typeof dragState !== 'undefined' && dragState) return; // do not rebuild the page under a drag in progress
  const ae = document.activeElement;
  if (!$('#modal').hidden || (ae && $('#main').contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) || $('#main form.setf[data-dirty]')) { renderTopbar(); return; } // never rebuild a form with unsaved edits
  const m = $('#main'), y = m.scrollTop;
  render();
  m.scrollTop = y;
}

/* ======================= Running jobs ======================= */
function runChip(h) {
  const m = { ok: ['okc', 'Success'], fail: ['late', 'Failed'], running: ['soon', 'Running…'], killed: ['today', 'Stopped'], interrupted: ['today', 'Interrupted'] }[h.status] || ['', h.status];
  return `<span class="chip ${m[0]}">${m[1]}</span>`;
}
function openRunModal(id, finished) {
  const h = finished ? S.history.find(x => x.id === id) : RUN[id].h;
  if (!h) return;
  V.runId = finished ? null : id;
  openModal(`<header><span>${esc(h.title)}</span><span id="runStatus" style="margin-inline:12px">${runChip(h)}</span><button class="iconbtn" data-action="close">${I.x}</button></header>
    <div class="body"><pre id="runLog" class="console"></pre></div>
    <footer>${h.status === 'running' ? `<button class="btn danger" id="runStop" data-action="job-kill" data-id="${id}">${I.stop}Stop</button>` : ''}<span class="grow"></span><button class="btn" data-action="close">Close</button></footer>`, { wide: true });
  const pre = $('#runLog');
  pre.textContent = h.log || '';
  pre.scrollTop = pre.scrollHeight;
  onModalClose = () => { V.runId = null; };
}
function appendLog(id, text) {
  const r = RUN[id];
  if (!r) return;
  r.h.log += text;
  const pre = $('#runLog');
  if (pre && V.runId === id) { pre.append(text); pre.scrollTop = pre.scrollHeight; }
}
native.job.onOutput(({ id, text }) => appendLog(id, text));

async function runJob({ pid, kind, refId, title, spec, silent, auto }) {
  if (isRunning(refId)) return toast('This job is already running', true);
  const id = uid();
  const h = { id, projectId: pid, kind, refId, title, start: Date.now(), status: 'running', log: '' };
  if (auto) h.auto = true;
  RUN[id] = { h };
  addHistory(h);
  if (!silent) openRunModal(id);
  renderTopbar();
  const res = await native.job.run({ ...spec, id, kind, projectId: pid });
  h.end = Date.now();
  h.code = res.code;
  if (res.error && res.code === undefined) { h.status = 'fail'; h.error = res.error; appendLog(id, '✗ ' + res.error + '\n'); }
  else {
    h.status = res.killed ? 'killed' : res.code === 0 ? 'ok' : 'fail';
    if (res.error) { h.error = res.error; appendLog(id, '✗ ' + res.error + '\n'); }
    appendLog(id, `\n— Finished with code ${res.code} after ${fmtSec((h.end - h.start) / 1000)}\n`);
  }
  if (res.file) { h.file = res.file; h.size = res.size; }
  logRun(h);
  const finalLog = h.log.length > 24000 ? '…\n' + h.log.slice(-24000) : h.log;
  h.log = finalLog;
  save();
  delete RUN[id];
  if (V.runId === id || $('#runStatus')) {
    const st = $('#runStatus'), stop = $('#runStop');
    if (st && (V.runId === id)) st.innerHTML = runChip(h);
    if (stop && V.runId === id) stop.remove();
  }
  if (!silent) toast(`${title}: ${h.status === 'ok' ? 'success' : h.status === 'killed' ? 'stopped' : 'failed'}`, h.status !== 'ok' && h.status !== 'killed');
  if (kind === 'backup') { const p = proj(pid), b = p && p.backups.find(x => x.id === refId); if (b) await loadBackups(b); }
  if (kind === 'deploy' && h.status === 'ok') postDeployHealth(pid, refId, id, h);
  petEvent('job', { kind, status: h.status, title, auto: !!auto });
  softRender();
  return h;
}
async function postDeployHealth(pid, did, runId, h) {
  const p = proj(pid), d = p && p.deploys.find(x => x.id === did), e = d && p.envs.find(x => x.id === d.envId);
  if (!e || !e.url || d.noHealth) return;
  await sleep(4000);
  const r = await checkEnv(p, e);
  const line = `\nPost-deploy health check (${e.name || e.url}): ${r.ok ? `✓ up (HTTP ${r.status}, ${r.ms}ms)` : '✗ ' + (r.error || 'HTTP ' + r.status)}\n`;
  h.log += line;
  const pre = $('#runLog');
  if (pre && $('#modal').hidden === false && $('#runStatus')) { pre.append(line); pre.scrollTop = pre.scrollHeight; }
  save();
  if (!r.ok) toast(`Warning: ${e.name || e.url} is not responding after the deploy`, true);
  softRender();
}
/** Opens the app's URL in the browser as soon as it answers (any HTTP status); gives up after 3 minutes or when the app stops */
async function openWhenReady(p) {
  const url = p.run.url;
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    if (!isRunning(p.id)) return;
    const r = await native.net.check({ url, method: 'GET', headers: '', expect: '', keyword: '', projectId: p.id });
    if (r && r.status) {
      const o = await native.shell.openUrl(url);
      if (o && o.error) toast(o.error, true);
      return;
    }
  }
  if (isRunning(p.id)) toast(`${p.name}: ${url} did not respond within 3 minutes`, true);
}
function deploySpec(p, d) {
  return { command: d.command, shell: d.shell, cwd: d.cwd || p.repoPath || '', envSpec: d.envSpec || '', dbId: d.dbId || '' };
}
function backupSpec(p, b) {
  return { cwd: b.cwd || p.repoPath || '', envSpec: b.envSpec || '', dbId: b.dbId || '', backup: { name: b.name, type: b.type, source: b.source, destDir: b.destDir, command: b.command, shell: b.shell, exclude: b.exclude, keep: b.keep } };
}
const runBackup = (p, b, silent, auto) => runJob({ pid: p.id, kind: 'backup', refId: b.id, title: `Backup: ${b.name}`, spec: backupSpec(p, b), silent, auto });

/** Pre-deploy checks: branch, uncommitted changes, unpushed commits, CI status */
async function deployClick(pid, did) {
  const p = proj(pid), d = p.deploys.find(x => x.id === did);
  const items = [];
  if (p.repoPath) {
    await loadGit(p);
    const g = C.git[pid];
    if (g && !g.error) {
      if (d.branch && g.branch !== d.branch) items.push(['warn', `The current branch is "${g.branch}"; this deploy expects "${d.branch}"`]);
      else items.push(['ok', `Current branch: ${g.branch}`]);
      if (g.dirty) items.push(['warn', `${num(g.dirty)} changed files without a commit`]);
      if (g.ahead) items.push(['warn', `${num(g.ahead)} commits not pushed yet`]);
      if (g.behind) items.push(['warn', `${num(g.behind)} new commits on the remote that are not pulled`]);
      if (!g.dirty && !g.ahead && !g.behind) items.push(['ok', 'The repository is clean and in sync with the remote']);
    } else if (g) items.push(['warn', 'Could not read git status: ' + g.error]);
  }
  if (p.ci.repo) {
    const r = await native.ci.runs(ciCfg(p), d.branch || (C.git[pid] && C.git[pid].branch) || null);
    if (r.runs && r.runs[0]) {
      const x = r.runs[0];
      if (x.status !== 'completed') items.push(['warn', `CI is still running (${x.name})`]);
      else if (x.conclusion === 'success') items.push(['ok', `The last CI run succeeded (${x.name}, ${ago(x.updated)})`]);
      else items.push(['warn', `The last CI run ended with "${x.conclusion}" (${x.name})`]);
    } else if (r.error) items.push(['warn', 'Could not read CI status: ' + r.error]);
  }
  const warn = items.some(i => i[0] === 'warn');
  const env = p.envs.find(e => e.id === d.envId);
  openModal(`<header><span>Deploy "${esc(d.name)}"${env ? ' to ' + esc(env.name) : ''}</span><button class="iconbtn" data-action="close">${I.x}</button></header>
    <div class="body">${items.length ? items.map(([k, t]) => `<div class="check-item ${k}">${k === 'ok' ? I.tick : I.alert}<span>${esc(t)}</span></div>`).join('') : '<div class="sub">No automatic checks are configured.</div>'}
      <code class="cmd">${esc(d.command)}</code></div>
    <footer><button class="btn ${warn ? 'danger' : 'primary'}" data-action="deploy-go" data-id="${did}">${warn ? 'Run anyway' : 'Run'}</button><span class="grow"></span><button class="btn" data-action="close">Cancel</button></footer>`, { small: true });
}

/* ======================= Git ======================= */
async function gitOp(pid, op, params, label, { quiet } = {}) {
  const p = proj(pid);
  toast(label + '…');
  const r = await native.git(op, p.repoPath, params);
  addHistory({ id: uid(), projectId: pid, kind: 'git', title: label, start: Date.now(), end: Date.now(), status: r.error ? 'fail' : 'ok', log: r.error || r.output || '' });
  if (r.error) showError(label, r.error);
  else if (!quiet) toast(label + ' ✓');
  await Promise.all([loadGit(p), loadGitDetail(p)]);
  softRender();
  return r;
}
function showError(title, text) {
  openModal(`<header><span>${esc(title)} — error</span><button class="iconbtn" data-action="close">${I.x}</button></header>
    <div class="body"><pre class="console">${esc(text)}</pre></div><footer><span class="grow"></span><button class="btn" data-action="close">Close</button></footer>`, { wide: true });
}

/* ======================= Vault ======================= */
const guarded = fn => fn();
function genPassword(len = 24) {
  const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+';
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, n => set[n % set.length]).join('');
}

/* ======================= Forms ======================= */
function readRows(form, sel, fields) {
  return [...form.querySelectorAll(sel)].map(r => {
    const o = { id: r.dataset.id || uid() };
    fields.forEach(f => (o[f] = r.querySelector(`[name=${f}]`).value.trim()));
    return o;
  }).filter(o => fields.some(f => o[f]));
}

async function saveProject(form) {
  const fd = new FormData(form), id = form.dataset.id;
  const name = String(fd.get('name')).trim();
  if (!name) return;
  const data = {
    name,
    repoPath: String(fd.get('repoPath')).trim(), priority: Number(fd.get('priority')),
  };
  let p;
  if (id) { p = proj(id); Object.assign(p, data); }
  else { p = normProject({ id: uid(), createdAt: Date.now(), ...data }); S.projects.push(p); }
  if (p.repoPath && !p.ci.repo) {
    const st = await native.git('status', p.repoPath);
    const m = st && st.remote && st.remote.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    if (m) p.ci.repo = m[1];
  }
  save(); closeModal();
  if (!id) openProject(p.id); else { render(); enterTab(); }
  toast('Saved');
}
/** The Settings tab: run, build, websites and CI each have their own form */
function saveProjSettings(form) {
  const p = proj(form.dataset.pid), fd = new FormData(form), v = n => String(fd.get(n) ?? '').trim();
  if (form.id === 'runForm') p.run = { command: v('command'), url: v('url'), shell: v('shell'), envSpec: v('envSpec'), dbId: v('dbId') };
  else if (form.id === 'buildForm') p.build = { command: v('command'), shell: v('shell'), envSpec: v('envSpec'), dbId: v('dbId') };
  else if (form.id === 'envForm') {
    form.querySelectorAll('.envrow').forEach(r => { if (!r.dataset.id) r.dataset.id = uid(); }); // keep ids stable if this form is not re-rendered
    p.envs = readRows(form, '.envrow', ['name', 'url', 'checkUrl', 'method', 'expect', 'keyword', 'headers']).filter(e => e.name || e.url);
  } else if (form.id === 'ciForm') p.ci = { repo: v('repo'), tokenId: v('token') };
  save(); delete form.dataset.dirty;
  if (!$('#main form.setf[data-dirty]')) render(); // a card with unsaved edits is never rebuilt under the user
  enterTab(); toast('Saved');
}
function saveDeploy(form) {
  const fd = new FormData(form), p = proj(form.dataset.pid), did = form.dataset.id;
  const name = String(fd.get('name')).trim(), command = String(fd.get('command')).trim();
  if (!name || !command) return;
  const data = { name, command, envId: fd.get('envId'), shell: fd.get('shell'), cwd: String(fd.get('cwd')).trim(), branch: String(fd.get('branch')).trim(), envSpec: String(fd.get('envSpec') ?? '').trim(), dbId: String(fd.get('dbId') || ''), noHealth: !fd.get('health') };
  if (did) Object.assign(p.deploys.find(x => x.id === did), data); else p.deploys.push({ id: uid(), ...data });
  save(); closeModal(); render(); toast('Saved');
}
function saveBackup(form) {
  const fd = new FormData(form), p = proj(form.dataset.pid), bid = form.dataset.id;
  const name = String(fd.get('name')).trim(), destDir = String(fd.get('destDir')).trim();
  if (!name || !destDir) return;
  const data = {
    name, type: fd.get('type'), source: String(fd.get('source')).trim(), destDir, command: String(fd.get('command')).trim(),
    shell: fd.get('shell'), cwd: String(fd.get('cwd')).trim(), exclude: String(fd.get('exclude')).trim(),
    keep: Math.max(0, Math.round(Number(fd.get('keep')) || 0)), everyHours: Math.max(0, Number(fd.get('everyHours')) || 0), envSpec: String(fd.get('envSpec') ?? '').trim(), dbId: String(fd.get('dbId') || ''),
  };
  if (data.type === 'folder' && !data.source) return toast('Set the source folder', true);
  if (data.type === 'command' && !data.command) return toast('Enter the backup command', true);
  let b;
  if (bid) { b = p.backups.find(x => x.id === bid); Object.assign(b, data); } else { b = { id: uid(), ...data }; p.backups.push(b); }
  save(); closeModal(); render(); loadBackups(b).then(softRender); toast('Saved');
}
async function saveVault(form) {
  const fd = new FormData(form), id = form.dataset.id;
  const label = String(fd.get('label')).trim();
  if (!label) return;
  const secret = String(fd.get('secret'));
  if (!id && !secret) return toast('Enter the secret value', true);
  const envName = String(fd.get('envName') || '').trim();
  if (envName && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) return toast('The variable name may only contain letters, digits and _', true);
  const entry = { id, label, kind: fd.get('kind'), projectId: fd.get('projectId'), username: String(fd.get('username')).trim(), url: String(fd.get('url')).trim(), expires: (VAULT_FIELDS[fd.get('kind')] || {}).exp ? readDate(form, 'expires') : '', envName };
  const r = await native.vault.save(entry, secret);
  if (r.error) return toast(r.error, true);
  closeModal(); await loadVault(); render(); toast('Saved to the vault');
}

/* ======================= Events ======================= */
const markDirty = el => { const f = el.closest && el.closest('form.setf'); if (f) f.dataset.dirty = '1'; };
document.addEventListener('input', e => markDirty(e.target));
document.addEventListener('change', e => markDirty(e.target));
const actions = {
  close: closeModal,
  go: el => { go(el.dataset.to); if (el.dataset.to === 'vault') loadVault().then(softRender); },
  'open-project': el => openProject(el.dataset.id, el.dataset.tab || 'tasks'),
  'set-tab': el => { V.tab = el.dataset.tab; navPush(); render(); enterTab(); },
  'new-project': () => projectModal(),
  'edit-project': el => projectModal(el.dataset.id),
  'del-project': async el => {
    const p = proj(el.dataset.id);
    const n = C.vault.filter(v => v.projectId === p.id).length;
    if (!(await askConfirm(`Remove the project "${p.name}" from the app?\n(Only the settings inside this app are deleted, not your files or repository)\n${n ? `${num(n)} vault items of this project will be deleted too.` : ''}`))) return;
    await native.vault.removeByProject(p.id);
    S.projects = S.projects.filter(x => x.id !== p.id);
    S.history = S.history.filter(h => h.projectId !== p.id);
    S.runlog = S.runlog.filter(r => r.pid !== p.id);
    S.archive = S.archive.filter(a => a.pid !== p.id);
    save(); closeModal(); await loadVault(); go('projects');
  },
  'refresh-all': () => refreshAll(true),
  'refresh-project': async () => { await enterTab(); toast('Refreshed'); },
  'open-folder': async el => { const err = await native.shell.openFolder(el.dataset.path); if (err) toast(err, true); },
  'open-url': el => native.shell.openUrl(el.dataset.url).then(r => r && r.error && toast(r.error, true)),
  'pick-folder': async el => {
    const p = await native.shell.pickFolder();
    if (p) el.closest('form').querySelector(`[name=${el.dataset.target}]`).value = p;
  },
  'row-add': el => { el.previousElementSibling.insertAdjacentHTML('beforeend', envRow({}, '')); markDirty(el); },
  'row-del': el => { markDirty(el); el.closest('.envrow').remove(); },
  'date-clear': el => el.closest('.datef').querySelectorAll('select').forEach(s => { s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); }),
  'env-check': async el => {
    const p = proj(V.pid), e = p.envs.find(x => x.id === el.dataset.id);
    await checkEnv(p, e);
    softRender();
  },
  'env-full': el => {
    const r = C.health[el.dataset.id];
    if (r) showResponse(el.dataset.name || 'Response', r);
  },
  'req-new': () => requestModal(),

  /* git */
  'git-fetch': el => gitOp(el.dataset.id, 'fetch', {}, 'Fetch'),
  'git-pull': el => gitOp(el.dataset.id, 'pull', {}, 'Pull'),
  'git-push': el => {
    const g = C.git[el.dataset.id];
    return gitOp(el.dataset.id, 'push', { branch: g.branch, setUpstream: !g.upstream }, `Push ${g.branch}`);
  },
  'git-checkout': el => gitOp(V.pid, 'checkout', { name: el.dataset.name, remote: el.dataset.remote === '1' }, `Checkout ${el.dataset.name}`),
  'git-merge': async el => {
    const g = C.git[V.pid];
    if (!(await askConfirm(`Merge branch "${el.dataset.name}" into "${g.branch}"?`, 'Merge', false))) return;
    const r = await gitOp(V.pid, 'merge', { name: el.dataset.name }, `Merge ${el.dataset.name} → ${g.branch}`);
    if (r.error && /CONFLICT|conflict/.test(r.error) && await askConfirm('The merge hit a conflict. Abort the merge?', 'Abort merge', false)) gitOp(V.pid, 'abortMerge', {}, 'Merge --abort');
  },
  'git-del': async el => {
    const n = el.dataset.name;
    if (!(await askConfirm(`Delete the local branch "${n}"?`))) return;
    const r = await gitOp(V.pid, 'deleteBranch', { name: n }, `Delete branch ${n}`, { quiet: true });
    if (r.error && /not fully merged/.test(r.error) && await askConfirm(`"${n}" is not fully merged and deleting it will discard its changes. Force delete?`, 'Force delete'))
      gitOp(V.pid, 'deleteBranch', { name: n, force: true }, `Force delete ${n}`);
  },
  'git-del-remote': async el => {
    const n = el.dataset.name.replace(/^origin\//, '');
    if (!(await askConfirm(`Delete the branch "${n}" from the remote (origin)? This affects the shared repository.`))) return;
    gitOp(V.pid, 'deleteRemoteBranch', { name: n }, `Delete remote ${n}`);
  },
  'git-new-branch': () => branchModal(),
  'git-tag-new': () => tagModal(),
  'git-tag-push': el => gitOp(V.pid, 'pushTag', { name: el.dataset.name }, `Push tag ${el.dataset.name}`),
  bfilter: el => { V.bfilter = el.dataset.v; render(); },

  /* Deploy */
  'deploy-new': () => deployModal(),
  'deploy-edit': el => deployModal(el.dataset.id),
  'deploy-run': el => deployClick(V.pid, el.dataset.id),
  'deploy-go': el => {
    closeModal();
    const p = proj(V.pid), d = p.deploys.find(x => x.id === el.dataset.id);
    runJob({ pid: p.id, kind: 'deploy', refId: d.id, title: `Deploy: ${d.name}`, spec: deploySpec(p, d) });
  },
  'deploy-del': async el => {
    if (!(await askConfirm('Delete this deploy definition?'))) return;
    const p = proj(V.pid); p.deploys = p.deploys.filter(x => x.id !== el.dataset.id);
    save(); closeModal(); render();
  },
  tpl: el => { document.querySelector('#deployForm [name=command]').value = TEMPLATES[el.dataset.i].cmd; },

  /* Backup */
  'backup-new': () => backupModal(),
  'backup-edit': el => backupModal(el.dataset.id),
  'backup-run': el => { const p = proj(V.pid); runBackup(p, p.backups.find(b => b.id === el.dataset.id)); },
  'backup-del': async el => {
    if (!(await askConfirm('Delete this backup definition? (Existing backup files are not deleted)'))) return;
    const p = proj(V.pid); p.backups = p.backups.filter(x => x.id !== el.dataset.id);
    save(); closeModal(); render();
  },
  'btype': () => syncBackupType(),

  /* CI/CD */
  'ci-refresh': async () => { const p = proj(V.pid); await Promise.all([loadCI(p), loadWf(p)]); softRender(); },
  'ci-rerun': async el => {
    const r = await native.ci.action(ciCfg(proj(V.pid)), el.dataset.failed === '1' ? 'rerunFailed' : 'rerun', { runId: Number(el.dataset.id) });
    if (r.error) return toast(r.error, true);
    toast('Re-run requested'); await sleep(1500); actions['ci-refresh']();
  },
  'ci-cancel': async el => {
    const r = await native.ci.action(ciCfg(proj(V.pid)), 'cancel', { runId: Number(el.dataset.id) });
    if (r.error) return toast(r.error, true);
    toast('Cancel requested'); await sleep(1500); actions['ci-refresh']();
  },
  'ci-dispatch': async () => {
    const wid = Number($('#wfSel').value), ref = $('#wfRef').value.trim();
    if (!wid || !ref) return toast('Choose a workflow and a branch', true);
    if (!(await askConfirm(`Run the workflow on "${ref}"?`, 'Run', false))) return;
    const r = await native.ci.action(ciCfg(proj(V.pid)), 'dispatch', { workflowId: wid, ref });
    if (r.error) return toast(r.error, true);
    toast('Run request submitted'); await sleep(2500); actions['ci-refresh']();
  },

  /* Jobs and history */
  'job-kill': async el => { await native.job.kill(el.dataset.id); },
  'app-run': () => {
    const p = proj(V.pid);
    if (!p.run.command) { toast('Set the run command first', true); return actions['set-tab']({ dataset: { tab: 'settings' } }); }
    runJob({ pid: p.id, kind: 'run', refId: p.id, title: `Run: ${p.name}`, spec: { command: p.run.command, shell: p.run.shell, cwd: p.repoPath || '', envSpec: p.run.envSpec, dbId: p.run.dbId } });
    softRender();
    const closeRun = onModalClose;
    onModalClose = () => { if (closeRun) closeRun(); render(); };
    if (p.run.url) openWhenReady(p);
  },
  'app-build': () => {
    const p = proj(V.pid);
    if (!p.build.command) { toast('Set the build command first', true); return actions['set-tab']({ dataset: { tab: 'settings' } }); }
    runJob({ pid: p.id, kind: 'build', refId: p.id + ':build', title: `Build: ${p.name}`, spec: { command: p.build.command, shell: p.build.shell, cwd: p.repoPath || '', envSpec: p.build.envSpec, dbId: p.build.dbId } });
    const closeRun = onModalClose;
    onModalClose = () => { if (closeRun) closeRun(); render(); };
  },
  'app-stop': async () => { const r = Object.values(RUN).find(x => x.h.refId === V.pid); if (r) await native.job.kill(r.h.id); },
  'app-log': () => { const r = Object.values(RUN).find(x => x.h.refId === V.pid); if (r) openRunModal(r.h.id); },
  'bell': () => { V.bell = !V.bell; renderTopbar(); },
  'run-open': () => { const id = Object.keys(RUN)[0]; if (id) openRunModal(id); },
  'log-open': el => openRunModal(el.dataset.id, true),
  'hist-clear': async () => {
    if (!(await askConfirm('Clear the history of all operations?'))) return;
    S.history = S.history.filter(h => h.status === 'running'); save(); render();
  },

  /* Vault */
  'v-new': () => vaultModal(),
  'v-edit': el => vaultModal(el.dataset.id),
  'v-del': async el => {
    if (!(await askConfirm('Delete this item from the vault?'))) return;
    await native.vault.remove(el.dataset.id); closeModal(); await loadVault(); render();
  },
  'v-reveal': async el => {
    const box = document.querySelector(`[data-secret="${el.dataset.id}"]`);
    const hide = () => { clearTimeout(box.hideTimer); box.textContent = '••••••••••'; box.classList.remove('shown'); };
    if (box.classList.contains('shown')) return hide(); // clicking the eye again hides the secret
    const r = await guarded(() => native.vault.reveal(el.dataset.id));
    if (!r) return;
    if (r.error) return toast(r.error, true);
    box.textContent = r.secret; box.classList.add('shown');
    box.hideTimer = setTimeout(() => { if (box.isConnected) hide(); }, 15000);
  },
  'v-copy': async el => {
    const r = await guarded(() => native.vault.copy(el.dataset.id));
    if (r) r.error ? toast(r.error, true) : toast(`Copied; it will be cleared from the clipboard in ${num(r.clearAfter)} seconds`);
  },
  'v-gen': el => { const i = el.closest('form').querySelector('[name=secret]'); i.value = genPassword(); i.type = 'text'; },
  'v-tpl': el => { const i = el.closest('form').querySelector('[name=secret]'); i.value = DB_TEMPLATES[el.dataset.i].cs; i.type = 'text'; },
  'v-toggle': el => { const i = el.closest('form').querySelector('[name=secret]'); i.type = i.type === 'password' ? 'text' : 'password'; },
  'lock-now': () => lockNow(),
  'pw-change': () => pwModal(),
  theme: el => { S.settings.theme = el.dataset.v; applyTheme(); save(); render(); },

  /* Settings */
  export: async () => {
    await native.data.save(S);
    const r = await native.sec.export();
    if (r.error) toast(r.error, true); else if (r.ok) toast('Encrypted backup saved');
  },
  import: async () => {
    const pw = await askPassword('Enter the master password of the backup file. After confirming you will choose the file, and the current data will be replaced by it.');
    if (pw === null) return;
    const r = await native.sec.import(pw);
    if (r.canceled) return;
    if (r.error) return toast(r.error, true);
    location.reload();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  const wasOpen = V.bell;
  if (el) { const fn = actions[el.dataset.action]; if (fn) { e.preventDefault(); fn(el); } }
  // the alert panel closes when clicking anywhere else (or on an alert)
  if (wasOpen && V.bell && !(el && el.dataset.action === 'bell')) { V.bell = false; renderTopbar(); }
});
document.addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); if (e.button === 3 || e.button === 4) e.preventDefault(); });
document.addEventListener('mouseup', e => { if (e.button === 3 || e.button === 4) { e.preventDefault(); navMove(e.button === 3 ? -1 : 1); } });
document.addEventListener('keydown', e => { if (e.altKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); navMove(e.key === 'ArrowLeft' ? -1 : 1); } });
document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'projForm') saveProject(f);
  else if (f.classList.contains('setf')) saveProjSettings(f);
  else if (f.id === 'deployForm') saveDeploy(f);
  else if (f.id === 'backupForm') saveBackup(f);
  else if (f.id === 'vaultForm') saveVault(f);
  else if (f.id === 'reqForm') sendRequest(f);
  else if (f.id === 'pwForm') {
    const np = f.elements.np.value;
    if (np !== f.elements.np2.value) { $('#formErr').textContent = 'The passwords do not match'; return; }
    const r = await native.sec.change(f.elements.op.value, np);
    if (r.error) { $('#formErr').textContent = r.error; return; }
    closeModal(); toast('Master password changed and all data was re-encrypted');
  } else if (f.id === 'branchForm') {
    const name = f.elements.name.value.trim(), from = f.elements.from.value;
    closeModal();
    gitOp(V.pid, 'createBranch', { name, from: from || undefined }, `Create branch ${name}`);
  } else if (f.id === 'tagForm') {
    const name = f.elements.name.value.trim(), message = f.message.value.trim(), push = f.push.checked;
    closeModal();
    const r = await gitOp(V.pid, 'createTag', { name, message }, `Create tag ${name}`, { quiet: push });
    if (!r.error && push) gitOp(V.pid, 'pushTag', { name }, `Push tag ${name}`);
  }
});
/** Appends NAME=@label for the chosen vault item to the environment-variables box next to the picker */
function pickVaultItem(sel) {
  const v = C.vault.find(x => x.id === sel.value), ta = sel.closest('.field').querySelector('textarea[name=envSpec]');
  if (v && ta) {
    const name = v.envName || (v.kind === 'db' ? 'ConnectionStrings__Default' : v.label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^(\d)/, '_$1'));
    ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, '\n') : '') + `${name}=@${v.label}`;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  sel.selectedIndex = 0;
  ddSync(sel);
}
document.addEventListener('change', e => {
  if (e.target.name === 'type' && e.target.closest('#backupForm')) syncBackupType();
  if (e.target.name === 'kind' && e.target.closest('#vaultForm')) syncVaultKind();
  if (e.target.classList.contains('vpick')) pickVaultItem(e.target);
  if (e.target.dataset.setting === 'autoLockMin') { S.settings.autoLockMin = Number(e.target.value); save(); }
  if (e.target.dataset.setting === 'notifyOn') { S.settings.notifyOn = e.target.checked; save(); }
  if (e.target.dataset.setting === 'wip') { S.settings.wip = Number(e.target.value) || 0; save(); renderTopbar(); syncAlerts(); }
  if (e.target.dataset.pref) native.app.setPrefs({ [e.target.dataset.pref]: e.target.checked });
  if (e.target.dataset.setting === 'healthMin') { S.settings.healthMin = Number(e.target.value); save(); startHealthTimer(); }
  if (e.target.dataset.hf) { V[e.target.dataset.hf] = e.target.value; render(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#confirm').hidden) $('#cNo').click();
    else if (!$('#modal').hidden) closeModal();
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); projectModal(); }
});

/* ======================= Startup ======================= */
function applyTheme() { setTheme(S.settings.theme); native.app.setPrefs({ theme: S.settings.theme }); }
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => setTheme(curTheme));

let healthTimer = null;
function startHealthTimer() {
  clearInterval(healthTimer);
  const m = S.settings.healthMin;
  if (m > 0) healthTimer = setInterval(async () => {
    await Promise.all(S.projects.map(p => Promise.all([loadGit(p), loadHealth(p)])));
    await refreshTaskBranches();
    softRender();
    syncAlerts();
  }, m * 60000);
}

// Scheduled backups (only while the app is open)
function scheduleTick() {
  for (const p of S.projects) {
    for (const b of p.backups) {
      if (!(b.everyHours > 0) || isRunning(b.id)) continue;
      const last = S.history.find(h => h.refId === b.id && h.status !== 'running');
      if (!last || Date.now() - last.start >= b.everyHours * 3600e3) runBackup(p, b, true, true);
    }
  }
}

/* ======================= Reminders and notifications ======================= */
const pushNote = (title, body, nav) => { try { native.app.notify({ title, body, nav }); } catch { /* notifications unavailable */ } };
const seenAlerts = new Set();   // important alerts that were already notified; they leave the set once resolved

/** Updates the tray icon and sends a notification for each new important alert */
function syncAlerts(first) {
  if (!S) return;
  const A = computeAlerts(), bad = A.filter(a => a.sev === 'bad');
  native.app.status({ bad: bad.length, warn: A.length - bad.length });
  const keys = new Set(bad.map(a => a.pid + '|' + a.text));
  const fresh = bad.filter(a => !seenAlerts.has(a.pid + '|' + a.text));
  for (const k of [...seenAlerts]) if (!keys.has(k)) seenAlerts.delete(k);
  keys.forEach(k => seenAlerts.add(k));
  petEvent('alerts', { bad: bad.length, warn: A.length - bad.length, fresh });
  if (!fresh.length || !S.settings.notifyOn) return;
  if (first && S.settings.notified === todayISO()) return; // after the app opens, do not repeat today's earlier alerts
  if (first) { S.settings.notified = todayISO(); save(); }
  const nav = fresh[0].pid ? { pid: fresh[0].pid, tab: fresh[0].tab } : {};
  pushNote(fresh.length > 1 ? `${num(fresh.length)} critical alerts` : 'Critical alert', fresh.length > 1 ? fresh.slice(0, 3).map(a => `${a.name}: ${a.text}`).join('\n') : `${fresh[0].name} — ${fresh[0].text}`, nav);
}

native.app.onNavigate(n => {
  if (!n) return;
  if (n.lock) { lockNow(); return; }
  if (n.pid && proj(n.pid)) openProject(n.pid, n.tab || 'tasks'); else go('projects');
});

/* ======================= Lock and master password ======================= */
let locking = false, lastActive = Date.now();
['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));

function askPassword(msg) {
  return new Promise(res => {
    const c = $('#confirm');
    c.innerHTML = `<form class="dialog small"><div class="body" style="padding-top:22px"><div>${esc(msg)}</div><input type="password" id="apw" autocomplete="off"></div>
      <footer><button class="btn primary" id="aYes">Confirm</button><button type="button" class="btn" id="aNo">Cancel</button></footer></form>`;
    c.hidden = false;
    const done = v => { c.hidden = true; c.innerHTML = ''; res(v); };
    c.querySelector('form').onsubmit = e => { e.preventDefault(); done($('#apw').value); };
    $('#aNo').onclick = () => done(null);
    $('#apw').focus();
  });
}

/** Screen for creating the master password (first run) or unlocking; resolves when done */
function lockScreen(st) {
  return new Promise(resolve => {
    const el = $('#lock'), host = $('#lockHost'), setup = st.state === 'setup';
    el.hidden = false;
    host.innerHTML = `<form id="lockScreenForm" class="lockbox">
      <h2>${setup ? 'Create master password' : 'Unlock'}</h2>
      ${setup ? `<p class="sub">This password is the encryption key (AES-256) for all your data and is stored nowhere. <b>If you forget it there is no way to recover it.</b> At least 8 characters; a long passphrase is better.</p>
        ${st.legacy ? '<p class="sub" style="color:var(--ok)">Your previous data was found; it will be encrypted after you create a password and the plaintext copy will be deleted.</p>' : ''}` : '<p class="sub">Your data is encrypted; enter the master password to continue.</p>'}
      <input type="password" name="pw" placeholder="Master password" autocomplete="off">
      ${setup ? '<input type="password" name="pw2" placeholder="Repeat password" autocomplete="off">' : ''}
      <div class="err" id="lockErr"></div>
      <button class="btn primary" style="justify-content:center">${setup ? 'Create password and sign in' : 'Unlock'}</button></form>`;
    const f = $('#lockScreenForm');
    f.elements.pw.focus();
    const finish = () => { el.hidden = true; host.innerHTML = ''; resolve(); };
    // the pet says the messages; if it is turned off they are shown as text under the form, as before
    const say = (text, kind) => { $('#lockErr').textContent = petLockSay(text, kind) ? '' : text; };
    if (st.waitSec) say(`Too many failed attempts; wait ${num(st.waitSec)} seconds`, 'err');
    else say(setup ? 'hi! create a master password for me to guard. if you forget it, nobody can recover it.' : 'welcome back. enter your master password.', 'info');
    f.onsubmit = async e => {
      e.preventDefault();
      const pw = f.elements.pw.value;
      if (setup) {
        if (pw.length < 8) { say('The password must be at least 8 characters', 'err'); return; }
        if (pw !== f.elements.pw2.value) { say('The passwords do not match', 'err'); return; }
      }
      say('Checking…', 'info');
      const r = setup ? await native.sec.setup(pw) : await native.sec.unlock(pw);
      if (r.error) { say(r.error, 'err'); f.elements.pw.select(); return; }
      finish();
    };
  });
}

/** Lock: the key is wiped from memory and the screen stays hidden until the password is entered */
async function lockNow() {
  if (locking) return;
  locking = true;
  if (!NOSAVE) await native.data.save(S);
  await native.sec.lock();
  pushPopup(true);
  closeModal();
  $('#confirm').hidden = true;
  $('#main').innerHTML = '';
  $('#nav').innerHTML = '';
  C.vault = [];
  await lockScreen(await native.sec.status());
  await loadVault();
  if (!NOSAVE) await native.data.save(S);
  render();
  pushPopup();
  lastActive = Date.now();
  locking = false;
}
setInterval(() => {
  const m = S && S.settings.autoLockMin;
  if (m > 0 && !locking && Date.now() - lastActive > m * 60000) lockNow();
}, 15000);

// starts on load so every script (tasks, sprints, daily, ...) is defined before the first render
async function init() {
    try { setTheme((await native.app.prefs()).theme); } catch { /* keep the mirrored theme */ } // lock screen follows the saved choice
  const st = await native.sec.status();
  if (st.state !== 'unlocked') await lockScreen(st);
  const ld = await native.data.load();
  if (ld && ld.error) {
    NOSAVE = true;
    S = blank();
    await askConfirm('The data file is corrupt or has been tampered with. For now the app will not write anything to it; you can use "Restore from file" in Settings or the daily copies in the backups folder.', 'Got it', false);
  } else S = normalize(ld && ld.data);
  S.history.forEach(h => { if (h.status === 'running') { h.status = 'interrupted'; h.end = h.end || h.start; } });
  syncRunlog();
  applyTheme();
  await loadVault();
  render();
  pushPopup();
  petInit();
  await refreshAll();
  startHealthTimer();
  syncAlerts(true);
  setTimeout(scheduleTick, 20000);
  setInterval(scheduleTick, 60000);
  setInterval(() => {
    const p = V.name === 'project' && V.tab === 'ci' && proj(V.pid);
    const c = p && C.ci[p.id];
    if (c && c.runs && c.runs.some(r => r.status !== 'completed')) loadCI(p).then(softRender);
  }, 20000);
}
addEventListener('load', init);
