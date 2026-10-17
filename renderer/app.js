'use strict';

/* ======================= وضعیت برنامه ======================= */
const COLORS = ['#4f6bff', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#64748b'];
const KINDS = { server: 'سرور / SSH', db: 'دیتابیس', api: 'کلید API / توکن', env: 'متغیر محیطی', web: 'پنل / وب‌سایت', other: 'سایر' };

let S = null; // داده‌های ذخیره‌شده: پروژه‌ها، تاریخچه، تنظیمات
const C = { git: {}, gd: {}, health: {}, ci: {}, wf: {}, backups: {}, vault: [] }; // حافظهٔ موقت
const V = { name: 'dashboard', pid: null, tab: 'overview', bfilter: 'all', hKind: '', hProj: '', vProj: '', runId: null };
const RUN = {}; // اجراهای در جریان: id -> {h}

const blank = () => ({ version: 2, projects: [], history: [], checks: {}, settings: { theme: 'system', healthMin: 5, notified: '', autoLockMin: 15 } });
const normProject = p => ({
  desc: '', color: COLORS[0], repoPath: '', notes: '', ...p,
  envs: p.envs || [], deploys: p.deploys || [], backups: p.backups || [],
  ci: { repo: '', tokenId: '', ...(p.ci || {}) },
});
function normalize(d) {
  const b = blank();
  if (!d || typeof d !== 'object') return b;
  return {
    ...b, version: 2,
    projects: (Array.isArray(d.projects) ? d.projects : []).map(normProject),
    history: Array.isArray(d.history) ? d.history : [],
    checks: d.checks && typeof d.checks === 'object' ? d.checks : {},
    settings: { ...b.settings, ...(d.settings || {}) },
  };
}

let saveTimer = null;
let NOSAVE = false; // اگر فایل داده خراب بود، رویش نمی‌نویسیم
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (!NOSAVE) native.data.save(S); }, 200); }
window.addEventListener('beforeunload', () => { if (!NOSAVE && S) native.data.saveSync(S); });

const proj = id => S.projects.find(p => p.id === id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function addHistory(h) {
  S.history.unshift(h);
  if (S.history.length > 400) S.history.length = 400;
  save();
}
const lastRun = (refId, kind) => S.history.find(h => h.refId === refId && (!kind || h.kind === kind) && h.status !== 'running');
const isRunning = refId => Object.values(RUN).some(r => r.h.refId === refId && r.h.status === 'running');

/* ======================= بارگذاری وضعیت‌ها ======================= */
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
/** ارسال درخواست به آدرس پایش محیط و ثبت نتیجه در حافظه و تاریخچهٔ سبک (برای آپتایم) */
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
  softRender();
  if (manual) toast('وضعیت‌ها به‌روز شد');
}
async function enterTab() {
  const p = proj(V.pid);
  if (!p) return;
  const t = V.tab, jobs = [loadGit(p)];
  if (t === 'git') jobs.push(loadGitDetail(p));
  if (t === 'ci' || t === 'overview') jobs.push(loadCI(p));
  if (t === 'ci') jobs.push(loadWf(p));
  if (t === 'overview' || t === 'status') jobs.push(loadHealth(p));
  if (t === 'backup') p.backups.forEach(b => jobs.push(loadBackups(b)));
  await Promise.all(jobs);
  softRender();
}
function openProject(pid, tab = 'overview') {
  go('project', { pid, tab });
  enterTab();
}

/* ======================= هشدارها ======================= */
function backupMaxAgeH(b) { return b.everyHours > 0 ? b.everyHours * 2 : 24 * 7; }
function computeAlerts() {
  const A = [];
  const add = (p, sev, text, tab) => A.push({ pid: p ? p.id : '', name: p ? p.name : 'گاوصندوق', sev, text, tab });
  for (const p of S.projects) {
    const g = C.git[p.id];
    if (p.repoPath && g) {
      if (g.error) add(p, 'warn', 'مخزن git: ' + g.error, 'git');
      else {
        if (g.dirty) add(p, 'warn', `${fa(g.dirty)} فایل تغییریافته که کامیت نشده`, 'git');
        if (g.ahead) add(p, 'warn', `${fa(g.ahead)} کامیت پوش‌نشده روی ${g.branch}`, 'git');
        if (g.behind) add(p, 'warn', `${fa(g.behind)} کامیت جدید روی ریموت (نیاز به pull)`, 'git');
      }
    }
    const ci = C.ci[p.id];
    if (ci && ci.runs) {
      const def = C.git[p.id] && C.git[p.id].default;
      const last = ci.runs.find(r => r.status === 'completed' && (!def || r.branch === def)) || ci.runs.find(r => r.status === 'completed');
      if (last && last.conclusion === 'failure') add(p, 'bad', `CI ناموفق: ${last.name} روی ${last.branch}`, 'ci');
    }
    for (const e of p.envs) {
      const h = C.health[e.id];
      if (!h) continue;
      if (!h.ok) add(p, 'bad', `${e.name || e.url} سالم نیست (${h.error || (h.keywordOk === false ? 'متن مورد انتظار در پاسخ نبود' : 'HTTP ' + h.status)})`, 'status');
      else if (h.certDays != null && h.certDays <= 14) add(p, h.certDays <= 3 ? 'bad' : 'warn', `گواهی SSL «${e.name || e.url}» تا ${fa(Math.max(h.certDays, 0))} روز دیگر منقضی می‌شود`, 'status');
    }
    for (const d of p.deploys) {
      const r = lastRun(d.id, 'deploy');
      if (r && r.status === 'fail') add(p, 'bad', `آخرین استقرار «${d.name}» ناموفق بود`, 'deploy');
    }
    for (const b of p.backups) {
      const r = lastRun(b.id, 'backup');
      const ok = S.history.find(h => h.refId === b.id && h.status === 'ok');
      if (r && r.status === 'fail') add(p, 'bad', `آخرین بک‌آپ «${b.name}» ناموفق بود`, 'backup');
      else if (!ok) add(p, 'warn', `از «${b.name}» هنوز بک‌آپ موفقی گرفته نشده`, 'backup');
      else if (Date.now() - ok.start > backupMaxAgeH(b) * 3600e3) add(p, 'warn', `بک‌آپ «${b.name}» قدیمی است (${ago(ok.start)})`, 'backup');
    }
  }
  for (const v of C.vault) {
    if (!v.expires) continue;
    const d = diffDays(v.expires), p = proj(v.projectId);
    if (d < 0) add(p, 'bad', `«${v.label}» منقضی شده است`, 'vault');
    else if (d <= 30) add(p, 'warn', `«${v.label}» تا ${fa(d)} روز دیگر منقضی می‌شود`, 'vault');
  }
  return A.sort((a, b) => (a.sev === 'bad' ? 0 : 1) - (b.sev === 'bad' ? 0 : 1));
}
function projSeverity(pid) {
  const A = computeAlerts().filter(a => a.pid === pid);
  if (A.some(a => a.sev === 'bad')) return 'bad';
  if (A.length) return 'warn';
  return C.git[pid] || S.projects.find(p => p.id === pid)?.envs.some(e => C.health[e.id]) ? 'ok' : 'none';
}

/* ======================= رندر ======================= */
function go(name, extra = {}) {
  Object.assign(V, { name }, extra);
  render();
  $('#main').scrollTop = 0;
}
function render() {
  if (typeof locking !== 'undefined' && locking) return; // هنگام قفل، محتوا دوباره ساخته نشود
  renderSidebar();
  renderTopbar();
  const views = { dashboard: viewDashboard, project: viewProject, history: viewHistory, vault: viewVault, settings: viewSettings };
  $('#main').innerHTML = (views[V.name] || viewDashboard)();
  if (V.name === 'settings') fillSettings();
}
function softRender() {
  const ae = document.activeElement;
  if (!$('#modal').hidden || (ae && $('#main').contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName))) { renderSidebar(); renderTopbar(); return; }
  const m = $('#main'), y = m.scrollTop;
  render();
  m.scrollTop = y;
}

/* ======================= اجرای کارها ======================= */
function runChip(h) {
  const m = { ok: ['okc', 'موفق'], fail: ['late', 'ناموفق'], running: ['soon', 'در حال اجرا…'], killed: ['today', 'متوقف شد'], interrupted: ['today', 'نیمه‌کاره ماند'] }[h.status] || ['', h.status];
  return `<span class="chip ${m[0]}">${m[1]}</span>`;
}
function openRunModal(id, finished) {
  const h = finished ? S.history.find(x => x.id === id) : RUN[id].h;
  if (!h) return;
  V.runId = finished ? null : id;
  openModal(`<header><span>${esc(h.title)}</span><span id="runStatus" style="margin-inline:12px">${runChip(h)}</span><button class="iconbtn" data-action="close">${I.x}</button></header>
    <div class="body"><pre id="runLog" class="console"></pre></div>
    <footer>${h.status === 'running' ? `<button class="btn danger" id="runStop" data-action="job-kill" data-id="${id}">${I.stop}توقف</button>` : ''}<span class="grow"></span><button class="btn" data-action="close">بستن</button></footer>`, { wide: true });
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

async function runJob({ pid, kind, refId, title, spec, silent }) {
  if (isRunning(refId)) return toast('این کار همین حالا در حال اجراست', true);
  const id = uid();
  const h = { id, projectId: pid, kind, refId, title, start: Date.now(), status: 'running', log: '' };
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
    appendLog(id, `\n— پایان با کد ${res.code} پس از ${fmtSec((h.end - h.start) / 1000)}\n`);
  }
  if (res.file) { h.file = res.file; h.size = res.size; }
  const finalLog = h.log.length > 24000 ? '…\n' + h.log.slice(-24000) : h.log;
  h.log = finalLog;
  save();
  delete RUN[id];
  if (V.runId === id || $('#runStatus')) {
    const st = $('#runStatus'), stop = $('#runStop');
    if (st && (V.runId === id)) st.innerHTML = runChip(h);
    if (stop && V.runId === id) stop.remove();
  }
  if (!silent) toast(`${title}: ${h.status === 'ok' ? 'موفق' : 'ناموفق'}`, h.status !== 'ok');
  if (kind === 'backup') { const p = proj(pid), b = p && p.backups.find(x => x.id === refId); if (b) await loadBackups(b); }
  if (kind === 'deploy' && h.status === 'ok') postDeployHealth(pid, refId, id, h);
  softRender();
  return h;
}
async function postDeployHealth(pid, did, runId, h) {
  const p = proj(pid), d = p && p.deploys.find(x => x.id === did), e = d && p.envs.find(x => x.id === d.envId);
  if (!e || !e.url || d.noHealth) return;
  await sleep(4000);
  const r = await checkEnv(p, e);
  const line = `\nبررسی سلامت پس از استقرار (${e.name || e.url}): ${r.ok ? `✓ بالا (HTTP ${r.status}، ${r.ms}ms)` : '✗ ' + (r.error || 'HTTP ' + r.status)}\n`;
  h.log += line;
  const pre = $('#runLog');
  if (pre && $('#modal').hidden === false && $('#runStatus')) { pre.append(line); pre.scrollTop = pre.scrollHeight; }
  save();
  if (!r.ok) toast(`هشدار: ${e.name || e.url} بعد از استقرار پاسخ نمی‌دهد`, true);
  softRender();
}
function deploySpec(p, d) {
  return { command: d.command, shell: d.shell, cwd: d.cwd || p.repoPath || '', envSpec: d.envSpec || '' };
}
function backupSpec(p, b) {
  return { cwd: b.cwd || p.repoPath || '', envSpec: b.envSpec || '', backup: { name: b.name, type: b.type, source: b.source, destDir: b.destDir, command: b.command, shell: b.shell, exclude: b.exclude, keep: b.keep } };
}
const runBackup = (p, b, silent) => runJob({ pid: p.id, kind: 'backup', refId: b.id, title: `بک‌آپ: ${b.name}`, spec: backupSpec(p, b), silent });

/** بررسی‌های پیش از استقرار: شاخه، تغییرات ناقص، پوش‌نشده، وضعیت CI */
async function deployClick(pid, did) {
  const p = proj(pid), d = p.deploys.find(x => x.id === did);
  const items = [];
  if (p.repoPath) {
    await loadGit(p);
    const g = C.git[pid];
    if (g && !g.error) {
      if (d.branch && g.branch !== d.branch) items.push(['warn', `شاخهٔ فعلی «${g.branch}» است؛ برای این استقرار «${d.branch}» انتظار می‌رود`]);
      else items.push(['ok', `شاخهٔ فعلی: ${g.branch}`]);
      if (g.dirty) items.push(['warn', `${fa(g.dirty)} فایل تغییریافته بدون کامیت`]);
      if (g.ahead) items.push(['warn', `${fa(g.ahead)} کامیت هنوز پوش نشده`]);
      if (g.behind) items.push(['warn', `${fa(g.behind)} کامیت جدید روی ریموت هست که pull نشده`]);
      if (!g.dirty && !g.ahead && !g.behind) items.push(['ok', 'مخزن تمیز و هم‌گام با ریموت است']);
    } else if (g) items.push(['warn', 'وضعیت git خوانده نشد: ' + g.error]);
  }
  if (p.ci.repo) {
    const r = await native.ci.runs(ciCfg(p), d.branch || (C.git[pid] && C.git[pid].branch) || null);
    if (r.runs && r.runs[0]) {
      const x = r.runs[0];
      if (x.status !== 'completed') items.push(['warn', `CI هنوز در حال اجراست (${x.name})`]);
      else if (x.conclusion === 'success') items.push(['ok', `آخرین CI موفق بود (${x.name}، ${ago(x.updated)})`]);
      else items.push(['warn', `آخرین CI نتیجهٔ «${x.conclusion}» داشت (${x.name})`]);
    } else if (r.error) items.push(['warn', 'وضعیت CI خوانده نشد: ' + r.error]);
  }
  const warn = items.some(i => i[0] === 'warn');
  const env = p.envs.find(e => e.id === d.envId);
  openModal(`<header><span>استقرار «${esc(d.name)}»${env ? ' روی ' + esc(env.name) : ''}</span><button class="iconbtn" data-action="close">${I.x}</button></header>
    <div class="body">${items.length ? items.map(([k, t]) => `<div class="check-item ${k}">${k === 'ok' ? I.tick : I.alert}<span>${esc(t)}</span></div>`).join('') : '<div class="sub">بررسی خودکاری تنظیم نشده است.</div>'}
      <code class="cmd">${esc(d.command)}</code></div>
    <footer><button class="btn ${warn ? 'danger' : 'primary'}" data-action="deploy-go" data-id="${did}">${warn ? 'با این وجود اجرا کن' : 'اجرا کن'}</button><span class="grow"></span><button class="btn" data-action="close">انصراف</button></footer>`, { small: true });
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
  openModal(`<header><span>${esc(title)} — خطا</span><button class="iconbtn" data-action="close">${I.x}</button></header>
    <div class="body"><pre class="console">${esc(text)}</pre></div><footer><span class="grow"></span><button class="btn" data-action="close">بستن</button></footer>`, { wide: true });
}

/* ======================= گاوصندوق ======================= */
const guarded = fn => fn();
function genPassword(len = 24) {
  const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+';
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, n => set[n % set.length]).join('');
}

/* ======================= فرم‌ها ======================= */
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
    name, desc: String(fd.get('desc')).trim(), color: fd.get('color') || COLORS[0],
    repoPath: String(fd.get('repoPath')).trim(), notes: String(fd.get('notes')).trim(),
    envs: readRows(form, '.envrow', ['name', 'url', 'checkUrl', 'method', 'expect', 'keyword', 'headers']).filter(e => e.name || e.url),
    ci: { repo: String(fd.get('ciRepo')).trim(), tokenId: String(fd.get('ciToken')) },
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
  toast('ذخیره شد');
}
function saveDeploy(form) {
  const fd = new FormData(form), p = proj(form.dataset.pid), did = form.dataset.id;
  const name = String(fd.get('name')).trim(), command = String(fd.get('command')).trim();
  if (!name || !command) return;
  const data = { name, command, envId: fd.get('envId'), shell: fd.get('shell'), cwd: String(fd.get('cwd')).trim(), branch: String(fd.get('branch')).trim(), envSpec: String(fd.get('envSpec')).trim(), noHealth: !fd.get('health') };
  if (did) Object.assign(p.deploys.find(x => x.id === did), data); else p.deploys.push({ id: uid(), ...data });
  save(); closeModal(); render(); toast('ذخیره شد');
}
function saveBackup(form) {
  const fd = new FormData(form), p = proj(form.dataset.pid), bid = form.dataset.id;
  const name = String(fd.get('name')).trim(), destDir = String(fd.get('destDir')).trim();
  if (!name || !destDir) return;
  const data = {
    name, type: fd.get('type'), source: String(fd.get('source')).trim(), destDir, command: String(fd.get('command')).trim(),
    shell: fd.get('shell'), cwd: String(fd.get('cwd')).trim(), exclude: String(fd.get('exclude')).trim(),
    keep: Math.max(0, Math.round(Number(fd.get('keep')) || 0)), everyHours: Math.max(0, Number(fd.get('everyHours')) || 0), envSpec: String(fd.get('envSpec')).trim(),
  };
  if (data.type === 'folder' && !data.source) return toast('پوشهٔ مبدأ را مشخص کنید', true);
  if (data.type === 'command' && !data.command) return toast('دستور بک‌آپ را وارد کنید', true);
  let b;
  if (bid) { b = p.backups.find(x => x.id === bid); Object.assign(b, data); } else { b = { id: uid(), ...data }; p.backups.push(b); }
  save(); closeModal(); render(); loadBackups(b).then(softRender); toast('ذخیره شد');
}
async function saveVault(form) {
  const fd = new FormData(form), id = form.dataset.id;
  const label = String(fd.get('label')).trim();
  if (!label) return;
  const secret = String(fd.get('secret'));
  if (!id && !secret) return toast('مقدار رمز را وارد کنید', true);
  const entry = { id, label, kind: fd.get('kind'), projectId: fd.get('projectId'), username: String(fd.get('username')).trim(), url: String(fd.get('url')).trim(), notes: String(fd.get('notes')).trim(), expires: readDate(form, 'expires') };
  const r = await native.vault.save(entry, secret);
  if (r.error) return toast(r.error, true);
  closeModal(); await loadVault(); render(); toast('در گاوصندوق ذخیره شد');
}

/* ======================= رویدادها ======================= */
const actions = {
  close: closeModal,
  go: el => { go(el.dataset.to); if (el.dataset.to === 'vault') loadVault().then(softRender); },
  'open-project': el => openProject(el.dataset.id, el.dataset.tab || 'overview'),
  'set-tab': el => { V.tab = el.dataset.tab; render(); enterTab(); },
  'new-project': () => projectModal(),
  'edit-project': el => projectModal(el.dataset.id),
  'del-project': async el => {
    const p = proj(el.dataset.id);
    const n = C.vault.filter(v => v.projectId === p.id).length;
    if (!(await askConfirm(`پروژهٔ «${p.name}» از برنامه حذف شود؟\n(فقط تنظیمات داخل این برنامه پاک می‌شود، نه فایل‌ها و مخزن شما)\n${n ? `${fa(n)} مورد گاوصندوق این پروژه هم پاک می‌شود.` : ''}`))) return;
    await native.vault.removeByProject(p.id);
    S.projects = S.projects.filter(x => x.id !== p.id);
    S.history = S.history.filter(h => h.projectId !== p.id);
    save(); closeModal(); await loadVault(); go('dashboard');
  },
  'refresh-all': () => refreshAll(true),
  'refresh-project': async () => { await enterTab(); toast('به‌روز شد'); },
  'open-folder': async el => { const err = await native.shell.openFolder(el.dataset.path); if (err) toast(err, true); },
  'open-url': el => native.shell.openUrl(el.dataset.url).then(r => r && r.error && toast(r.error, true)),
  'pick-folder': async el => {
    const p = await native.shell.pickFolder();
    if (p) el.closest('form').querySelector(`[name=${el.dataset.target}]`).value = p;
  },
  'row-add': el => el.previousElementSibling.insertAdjacentHTML('beforeend', envRow({}, '')),
  'row-del': el => el.closest('.envrow').remove(),
  'date-clear': el => el.closest('.datef').querySelectorAll('select').forEach(s => { s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); }),
  'env-check': async el => {
    const p = proj(V.pid), e = p.envs.find(x => x.id === el.dataset.id);
    await checkEnv(p, e);
    softRender();
  },
  'env-full': el => {
    const r = C.health[el.dataset.id];
    if (r) showResponse(el.dataset.name || 'پاسخ', r);
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
    if (!(await askConfirm(`شاخهٔ «${el.dataset.name}» داخل «${g.branch}» ادغام شود؟`, 'ادغام', false))) return;
    const r = await gitOp(V.pid, 'merge', { name: el.dataset.name }, `Merge ${el.dataset.name} → ${g.branch}`);
    if (r.error && /CONFLICT|conflict/.test(r.error) && await askConfirm('ادغام به تضاد خورد. ادغام لغو شود؟', 'لغو ادغام', false)) gitOp(V.pid, 'abortMerge', {}, 'Merge --abort');
  },
  'git-del': async el => {
    const n = el.dataset.name;
    if (!(await askConfirm(`شاخهٔ محلی «${n}» حذف شود؟`))) return;
    const r = await gitOp(V.pid, 'deleteBranch', { name: n }, `حذف شاخه ${n}`, { quiet: true });
    if (r.error && /not fully merged/.test(r.error) && await askConfirm(`«${n}» کامل ادغام نشده و این حذف تغییراتش را از بین می‌برد. با زور حذف شود؟`, 'حذف اجباری'))
      gitOp(V.pid, 'deleteBranch', { name: n, force: true }, `حذف اجباری ${n}`);
  },
  'git-del-remote': async el => {
    const n = el.dataset.name.replace(/^origin\//, '');
    if (!(await askConfirm(`شاخهٔ «${n}» از ریموت (origin) حذف شود؟ این کار روی مخزن مشترک اثر می‌گذارد.`))) return;
    gitOp(V.pid, 'deleteRemoteBranch', { name: n }, `حذف ریموت ${n}`);
  },
  'git-new-branch': () => branchModal(),
  'git-tag-new': () => tagModal(),
  'git-tag-push': el => gitOp(V.pid, 'pushTag', { name: el.dataset.name }, `Push tag ${el.dataset.name}`),
  bfilter: el => { V.bfilter = el.dataset.v; render(); },

  /* استقرار */
  'deploy-new': () => deployModal(),
  'deploy-edit': el => deployModal(el.dataset.id),
  'deploy-run': el => deployClick(V.pid, el.dataset.id),
  'deploy-go': el => {
    closeModal();
    const p = proj(V.pid), d = p.deploys.find(x => x.id === el.dataset.id);
    runJob({ pid: p.id, kind: 'deploy', refId: d.id, title: `استقرار: ${d.name}`, spec: deploySpec(p, d) });
  },
  'deploy-del': async el => {
    if (!(await askConfirm('این تعریف استقرار حذف شود؟'))) return;
    const p = proj(V.pid); p.deploys = p.deploys.filter(x => x.id !== el.dataset.id);
    save(); closeModal(); render();
  },
  tpl: el => { document.querySelector('#deployForm [name=command]').value = TEMPLATES[el.dataset.i].cmd; },

  /* بک‌آپ */
  'backup-new': () => backupModal(),
  'backup-edit': el => backupModal(el.dataset.id),
  'backup-run': el => { const p = proj(V.pid); runBackup(p, p.backups.find(b => b.id === el.dataset.id)); },
  'backup-del': async el => {
    if (!(await askConfirm('این تعریف بک‌آپ حذف شود؟ (فایل‌های بک‌آپ‌شده پاک نمی‌شوند)'))) return;
    const p = proj(V.pid); p.backups = p.backups.filter(x => x.id !== el.dataset.id);
    save(); closeModal(); render();
  },
  'btype': () => syncBackupType(),

  /* CI/CD */
  'ci-refresh': async () => { const p = proj(V.pid); await Promise.all([loadCI(p), loadWf(p)]); softRender(); },
  'ci-rerun': async el => {
    const r = await native.ci.action(ciCfg(proj(V.pid)), el.dataset.failed === '1' ? 'rerunFailed' : 'rerun', { runId: Number(el.dataset.id) });
    if (r.error) return toast(r.error, true);
    toast('اجرای مجدد درخواست شد'); await sleep(1500); actions['ci-refresh']();
  },
  'ci-cancel': async el => {
    const r = await native.ci.action(ciCfg(proj(V.pid)), 'cancel', { runId: Number(el.dataset.id) });
    if (r.error) return toast(r.error, true);
    toast('لغو درخواست شد'); await sleep(1500); actions['ci-refresh']();
  },
  'ci-dispatch': async () => {
    const wid = Number($('#wfSel').value), ref = $('#wfRef').value.trim();
    if (!wid || !ref) return toast('گردش‌کار و شاخه را مشخص کنید', true);
    if (!(await askConfirm(`گردش‌کار روی «${ref}» اجرا شود؟`, 'اجرا', false))) return;
    const r = await native.ci.action(ciCfg(proj(V.pid)), 'dispatch', { workflowId: wid, ref });
    if (r.error) return toast(r.error, true);
    toast('درخواست اجرا ثبت شد'); await sleep(2500); actions['ci-refresh']();
  },

  /* اجرای کارها و تاریخچه */
  'job-kill': async el => { await native.job.kill(el.dataset.id); },
  'run-open': () => { const id = Object.keys(RUN)[0]; if (id) openRunModal(id); },
  'log-open': el => openRunModal(el.dataset.id, true),
  'hist-clear': async () => {
    if (!(await askConfirm('تاریخچهٔ همهٔ عملیات پاک شود؟'))) return;
    S.history = S.history.filter(h => h.status === 'running'); save(); render();
  },

  /* گاوصندوق */
  'v-new': () => vaultModal(),
  'v-edit': el => vaultModal(el.dataset.id),
  'v-del': async el => {
    if (!(await askConfirm('این مورد از گاوصندوق حذف شود؟'))) return;
    await native.vault.remove(el.dataset.id); closeModal(); await loadVault(); render();
  },
  'v-reveal': async el => {
    const r = await guarded(() => native.vault.reveal(el.dataset.id));
    if (!r) return;
    if (r.error) return toast(r.error, true);
    const box = document.querySelector(`[data-secret="${el.dataset.id}"]`);
    box.textContent = r.secret; box.classList.add('shown');
    setTimeout(() => { if (box.isConnected) { box.textContent = '••••••••••'; box.classList.remove('shown'); } }, 15000);
  },
  'v-copy': async el => {
    const r = await guarded(() => native.vault.copy(el.dataset.id));
    if (r) r.error ? toast(r.error, true) : toast(`کپی شد؛ ${fa(r.clearAfter)} ثانیهٔ دیگر از کلیپ‌بورد پاک می‌شود`);
  },
  'v-copyuser': async el => { const v = C.vault.find(x => x.id === el.dataset.id); if (v && (await copyText(v.username))) toast('نام کاربری کپی شد'); },
  'v-gen': el => { const i = el.closest('form').querySelector('[name=secret]'); i.value = genPassword(); i.type = 'text'; },
  'v-toggle': el => { const i = el.closest('form').querySelector('[name=secret]'); i.type = i.type === 'password' ? 'text' : 'password'; },
  'lock-now': () => lockNow(),
  'pw-change': () => pwModal(),

  /* تنظیمات */
  theme: el => { S.settings.theme = el.dataset.v; applyTheme(); save(); render(); },
  export: async () => {
    await native.data.save(S);
    const r = await native.sec.export();
    if (r.error) toast(r.error, true); else if (r.ok) toast('پشتیبان رمزنگاری‌شده ذخیره شد');
  },
  import: async () => {
    const pw = await askPassword('رمز اصلیِ فایل پشتیبان را وارد کنید. بعد از تأیید، فایل را انتخاب می‌کنید و اطلاعات فعلی با آن جایگزین می‌شود.');
    if (pw === null) return;
    const r = await native.sec.import(pw);
    if (r.canceled) return;
    if (r.error) return toast(r.error, true);
    location.reload();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'projForm') saveProject(f);
  else if (f.id === 'deployForm') saveDeploy(f);
  else if (f.id === 'backupForm') saveBackup(f);
  else if (f.id === 'vaultForm') saveVault(f);
  else if (f.id === 'reqForm') sendRequest(f);
  else if (f.id === 'pwForm') {
    const np = f.elements.np.value;
    if (np !== f.elements.np2.value) { $('#formErr').textContent = 'تکرار رمز یکسان نیست'; return; }
    const r = await native.sec.change(f.elements.op.value, np);
    if (r.error) { $('#formErr').textContent = r.error; return; }
    closeModal(); toast('رمز اصلی تغییر کرد و همهٔ اطلاعات دوباره رمزنگاری شد');
  } else if (f.id === 'branchForm') {
    const name = f.elements.name.value.trim(), from = f.elements.from.value;
    closeModal();
    gitOp(V.pid, 'createBranch', { name, from: from || undefined }, `ساخت شاخه ${name}`);
  } else if (f.id === 'tagForm') {
    const name = f.elements.name.value.trim(), message = f.message.value.trim(), push = f.push.checked;
    closeModal();
    const r = await gitOp(V.pid, 'createTag', { name, message }, `ساخت تگ ${name}`, { quiet: push });
    if (!r.error && push) gitOp(V.pid, 'pushTag', { name }, `Push tag ${name}`);
  }
});
document.addEventListener('change', e => {
  if (e.target.name === 'type' && e.target.closest('#backupForm')) syncBackupType();
  if (e.target.dataset.setting === 'autoLockMin') { S.settings.autoLockMin = Number(e.target.value); save(); }
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

/* ======================= شروع برنامه ======================= */
function applyTheme() {
  const th = S.settings.theme;
  const dark = th === 'dark' || (th === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => S && applyTheme());

let healthTimer = null;
function startHealthTimer() {
  clearInterval(healthTimer);
  const m = S.settings.healthMin;
  if (m > 0) healthTimer = setInterval(async () => {
    await Promise.all(S.projects.map(p => Promise.all([loadGit(p), loadHealth(p)])));
    softRender();
  }, m * 60000);
}

// بک‌آپ‌های زمان‌بندی‌شده (فقط وقتی برنامه باز است)
function scheduleTick() {
  for (const p of S.projects) {
    for (const b of p.backups) {
      if (!(b.everyHours > 0) || isRunning(b.id)) continue;
      const last = S.history.find(h => h.refId === b.id && h.status !== 'running');
      if (!last || Date.now() - last.start >= b.everyHours * 3600e3) runBackup(p, b, true);
    }
  }
}

function notifyAlerts() {
  const bad = computeAlerts().filter(a => a.sev === 'bad');
  if (!bad.length || S.settings.notified === todayISO()) return;
  S.settings.notified = todayISO(); save();
  try { new Notification('AppWarden', { body: `${fa(bad.length)} هشدار مهم: ${bad[0].name} — ${bad[0].text}` }); } catch { /* اعلان در دسترس نیست */ }
}

/* ======================= قفل و رمز اصلی ======================= */
let locking = false, lastActive = Date.now();
['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));

function askPassword(msg) {
  return new Promise(res => {
    const c = $('#confirm');
    c.innerHTML = `<form class="dialog small"><div class="body" style="padding-top:22px"><div>${esc(msg)}</div><input type="password" id="apw" autocomplete="off"></div>
      <footer><button class="btn primary" id="aYes">تأیید</button><button type="button" class="btn" id="aNo">انصراف</button></footer></form>`;
    c.hidden = false;
    const done = v => { c.hidden = true; c.innerHTML = ''; res(v); };
    c.querySelector('form').onsubmit = e => { e.preventDefault(); done($('#apw').value); };
    $('#aNo').onclick = () => done(null);
    $('#apw').focus();
  });
}

/** صفحهٔ ساخت رمز اصلی (بار اول) یا باز کردن قفل؛ وقتی کار تمام شد resolve می‌شود */
function lockScreen(st) {
  return new Promise(resolve => {
    const el = $('#lock'), setup = st.state === 'setup';
    el.hidden = false;
    el.innerHTML = `<form id="lockScreenForm" class="lockbox">
      <div class="logo big">${I.lock}</div>
      <h2>${setup ? 'ساخت رمز اصلی' : 'باز کردن قفل'}</h2>
      ${setup ? `<p class="sub">این رمز کلید رمزنگاری (AES-256) همهٔ اطلاعات شماست و هیچ‌جا ذخیره نمی‌شود. <b>اگر فراموشش کنید راهی برای بازیابی نیست.</b> دست‌کم ۸ نویسه؛ یک عبارت طولانی بهتر است.</p>
        ${st.legacy ? '<p class="sub" style="color:var(--ok)">اطلاعات قبلی شما پیدا شد؛ بعد از ساخت رمز رمزنگاری می‌شود و نسخهٔ متن‌ساده پاک می‌شود.</p>' : ''}` : '<p class="sub">اطلاعات رمزنگاری شده‌اند؛ برای ادامه رمز اصلی را وارد کنید.</p>'}
      <input type="password" name="pw" placeholder="رمز اصلی" autocomplete="off">
      ${setup ? '<input type="password" name="pw2" placeholder="تکرار رمز" autocomplete="off">' : ''}
      <div class="err" id="lockErr">${st.waitSec ? `تلاش‌های ناموفق زیاد بود؛ ${fa(st.waitSec)} ثانیه صبر کنید` : ''}</div>
      <button class="btn primary" style="justify-content:center">${setup ? 'ایجاد رمز و ورود' : 'باز کردن'}</button>
      ${setup ? '' : '<div class="row" style="justify-content:center"><button type="button" class="btn sm" id="lsImport">بازیابی از پشتیبان</button><button type="button" class="btn sm danger" id="lsReset">فراموشی رمز…</button></div>'}</form>`;
    const f = $('#lockScreenForm');
    f.elements.pw.focus();
    const finish = () => { el.hidden = true; el.innerHTML = ''; resolve(); };
    f.onsubmit = async e => {
      e.preventDefault();
      const err = $('#lockErr'), pw = f.elements.pw.value;
      if (setup) {
        if (pw.length < 8) { err.textContent = 'رمز باید دست‌کم ۸ نویسه باشد'; return; }
        if (pw !== f.elements.pw2.value) { err.textContent = 'تکرار رمز یکسان نیست'; return; }
      }
      err.textContent = 'در حال بررسی…';
      const r = setup ? await native.sec.setup(pw) : await native.sec.unlock(pw);
      if (r.error) { err.textContent = r.error; f.elements.pw.select(); return; }
      finish();
    };
    if (!setup) {
      $('#lsImport').onclick = async () => {
        const pw = await askPassword('رمز اصلیِ فایل پشتیبان را وارد کنید؛ سپس فایل را انتخاب کنید.');
        if (pw === null) return;
        const r = await native.sec.import(pw);
        if (r.canceled) return;
        if (r.error) { $('#lockErr').textContent = r.error; return; }
        location.reload();
      };
      $('#lsReset').onclick = async () => {
        if (!(await askConfirm('همهٔ اطلاعات رمزنگاری‌شده (پروژه‌ها، رمزها و تاریخچه) برای همیشه پاک می‌شود و برنامه از صفر شروع می‌کند. فقط اگر رمز را فراموش کرده‌اید و پشتیبان ندارید ادامه دهید.', 'پاک کن'))) return;
        await native.sec.reset();
        location.reload();
      };
    }
  });
}

/** قفل کردن: کلید از حافظهٔ اصلی پاک می‌شود و صفحه تا ورود رمز پنهان می‌ماند */
async function lockNow() {
  if (locking) return;
  locking = true;
  if (!NOSAVE) await native.data.save(S);
  await native.sec.lock();
  closeModal();
  $('#confirm').hidden = true;
  $('#main').innerHTML = '';
  $('#sidebar').innerHTML = '';
  C.vault = [];
  await lockScreen(await native.sec.status());
  await loadVault();
  if (!NOSAVE) await native.data.save(S);
  render();
  lastActive = Date.now();
  locking = false;
}
setInterval(() => {
  const m = S && S.settings.autoLockMin;
  if (m > 0 && !locking && Date.now() - lastActive > m * 60000) lockNow();
}, 15000);

(async function init() {
  document.querySelector('[data-action="refresh-all"]').innerHTML = `${I.refresh}بررسی مجدد`;
  document.querySelector('[data-action="new-project"]').innerHTML = `${I.plus}پروژهٔ جدید`;
  document.querySelector('[data-action="lock-now"]').innerHTML = `${I.lock}قفل`;
  const st = await native.sec.status();
  if (st.state !== 'unlocked') await lockScreen(st);
  const ld = await native.data.load();
  if (ld && ld.error) {
    NOSAVE = true;
    S = blank();
    await askConfirm('فایل داده خراب یا دست‌کاری شده است. برنامه فعلاً چیزی روی آن نمی‌نویسد؛ می‌توانید از «بازیابی از پشتیبان» یا نسخه‌های روزانهٔ پوشهٔ backups استفاده کنید.', 'متوجه شدم', false);
  } else S = normalize(ld && ld.data);
  S.history.forEach(h => { if (h.status === 'running') { h.status = 'interrupted'; h.end = h.end || h.start; } });
  document.querySelector('[data-action="refresh-all"]').innerHTML = `${I.refresh}بررسی مجدد`;
  document.querySelector('[data-action="new-project"]').innerHTML = `${I.plus}پروژهٔ جدید`;
  applyTheme();
  await loadVault();
  render();
  await refreshAll();
  startHealthTimer();
  setTimeout(notifyAlerts, 1000);
  setTimeout(scheduleTick, 20000);
  setInterval(scheduleTick, 60000);
  setInterval(() => {
    const p = V.name === 'project' && V.tab === 'ci' && proj(V.pid);
    const c = p && C.ci[p.id];
    if (c && c.runs && c.runs.some(r => r.status !== 'completed')) loadCI(p).then(softRender);
  }, 20000);
})();
