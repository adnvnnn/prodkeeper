'use strict';

const chip = (text, cls = '', icon = '') => `<span class="chip ${cls}">${icon}${text}</span>`;
const TABS = [['overview', 'نمای کلی', I.grid], ['status', 'وضعیت زنده', I.globe], ['git', 'Git و شاخه‌ها', I.branch], ['deploy', 'استقرار', I.deploy], ['backup', 'بک‌آپ', I.db], ['ci', 'CI/CD', I.activity], ['vault', 'گاوصندوق', I.key]];
const TEMPLATES = [
  { t: 'SSH + git pull + pm2', cmd: 'ssh user@host "cd /var/www/app && git pull && npm ci --omit=dev && pm2 restart app"' },
  { t: 'Docker Compose روی سرور', cmd: 'ssh user@host "cd /srv/app && docker compose pull && docker compose up -d"' },
  { t: 'بیلد و کپی با scp', cmd: 'npm ci && npm run build && scp -r dist/* user@host:/var/www/app/' },
  { t: 'npm run deploy', cmd: 'npm run deploy' },
];
const lastOfProject = (p, kind) => S.history.find(h => h.projectId === p.id && h.kind === kind && h.status !== 'running');
const dur = h => (h.end ? ' · ' + fmtSec((h.end - h.start) / 1000) : '');
const notSet = (msg, btn) => `<div class="empty card">${I.alert}<h3>${msg}</h3>${btn || ''}</div>`;

/* ---------- نوار کناری و بالا ---------- */
function renderSidebar() {
  const A = computeAlerts(), bad = A.filter(a => a.sev === 'bad').length;
  const nav = (name, icon, label, badge) => `<button class="nav ${V.name === name ? 'active' : ''}" data-action="go" data-to="${name}">${icon}<span class="nm">${label}</span>${badge ? `<span class="count bad">${fa(badge)}</span>` : ''}</button>`;
  $('#sidebar').innerHTML = `
    <div class="brand"><div class="logo">${I.deploy}</div>AppWarden</div>
    ${nav('dashboard', I.grid, 'داشبورد', bad)}
    ${nav('history', I.activity, 'تاریخچهٔ عملیات')}
    ${nav('vault', I.key, 'گاوصندوق رمزها')}
    ${nav('settings', I.sliders, 'تنظیمات')}
    <div class="side-title"><span>برنامه‌ها</span><button data-action="new-project" title="پروژهٔ جدید (Ctrl+N)">${I.plus}</button></div>
    ${S.projects.map(p => `<button class="nav ${V.name === 'project' && V.pid === p.id ? 'active' : ''}" data-action="open-project" data-id="${p.id}">
        <span class="sdot ${projSeverity(p.id)}"></span><span class="nm">${esc(p.name)}</span></button>`).join('') || '<div class="sub" style="padding:6px 12px;font-size:13px">هنوز برنامه‌ای اضافه نشده</div>'}`;
}
function renderTopbar() {
  const names = { dashboard: 'داشبورد', history: 'تاریخچهٔ عملیات', vault: 'گاوصندوق رمزها', settings: 'تنظیمات' };
  const p = V.name === 'project' && proj(V.pid);
  $('#crumb').innerHTML = `<b>${esc(p ? p.name : names[V.name] || '')}</b>`;
  const n = Object.keys(RUN).length;
  $('#runBox').innerHTML = n ? `<button class="btn sm" data-action="run-open"><span class="rec"></span>${fa(n)} کار در حال اجرا</button>` : '';
}

/* ---------- داشبورد ---------- */
function alertRow(a) {
  const act = a.pid ? `data-action="open-project" data-id="${a.pid}" data-tab="${a.tab}"` : 'data-action="go" data-to="vault"';
  return `<div class="alert ${a.sev}" ${act}>${I.alert}<b>${esc(a.name)}</b><span>${esc(a.text)}</span></div>`;
}
function viewDashboard() {
  if (!S.projects.length) {
    return `<div class="empty card" style="margin-top:20px">${I.deploy.replace('<svg', '<svg style="width:48px;height:48px"')}
      <h3>برنامه‌های خود را اضافه کنید</h3>
      <p>برای هر برنامه مسیر مخزن git، آدرس سایت، دستور استقرار، بک‌آپ و CI را تعریف کنید و همه‌چیز را از یک‌جا کنترل کنید. رمزها هم رمزنگاری‌شده در گاوصندوق می‌مانند.</p>
      <button class="btn primary" data-action="new-project">${I.plus}افزودن اولین برنامه</button></div>`;
  }
  const A = computeAlerts();
  return `
    <div class="page-head"><h1>وضعیت کلی</h1><span class="sub">${fa(S.projects.length)} برنامه</span></div>
    <div class="card section" style="margin-bottom:18px"><h2>${I.alert}هشدارها ${A.length ? chip(fa(A.length), A.some(a => a.sev === 'bad') ? 'late' : 'today') : ''}</h2>
      ${A.length ? A.map(alertRow).join('') : `<div class="okline">${I.tick}همه‌چیز مرتب است؛ هشدار فعالی وجود ندارد.</div>`}</div>
    <div class="grid">${S.projects.map(pcard).join('')}</div>`;
}
function ciChip(p) {
  const c = C.ci[p.id];
  if (!c) return '';
  if (c.error) return chip('CI: خطا', 'today');
  const r = c.runs && c.runs[0];
  return r ? `<span title="${esc(r.name)}">CI ${ciBadge(r)}</span>` : '';
}
function pcard(p) {
  const g = C.git[p.id], sev = projSeverity(p.id);
  const gitLine = !p.repoPath ? '' : !g ? '<span class="sub">در حال بررسی git…</span>'
    : g.error ? chip('git: ' + esc(g.error), 'today')
    : `${chip(esc(g.branch), '', I.branch)}${g.dirty ? chip(`${fa(g.dirty)} تغییر`, 'today') : ''}${g.ahead ? chip(fa(g.ahead), 'soon', I.up) : ''}${g.behind ? chip(fa(g.behind), 'today', I.down) : ''}`;
  const envs = p.envs.map(e => { const h = C.health[e.id]; return chip(esc(e.name || e.url), h ? (h.ok ? 'okc' : 'late') : '', I.globe); }).join('');
  const dep = lastOfProject(p, 'deploy'), bak = lastOfProject(p, 'backup');
  const kv = (l, v) => `<div class="kv"><span>${l}</span><span>${v}</span></div>`;
  return `<div class="card pcard" style="--c:${p.color}" data-action="open-project" data-id="${p.id}">
    <div class="row between"><h3><span class="sdot ${sev}"></span> ${esc(p.name)}</h3></div>
    ${p.desc ? `<div class="desc">${esc(p.desc)}</div>` : ''}
    <div class="row">${gitLine}${ciChip(p)}</div>
    ${envs ? `<div class="row">${envs}</div>` : ''}
    ${kv('آخرین استقرار', dep ? `${runChip(dep)} ${ago(dep.start)}` : '<span class="sub">—</span>')}
    ${kv('آخرین بک‌آپ', bak ? `${runChip(bak)} ${ago(bak.start)}` : '<span class="sub">—</span>')}
  </div>`;
}
function ciBadge(r) {
  if (r.status !== 'completed') return chip(r.status === 'queued' ? 'در صف' : 'در حال اجرا', 'soon');
  const m = { success: ['okc', 'موفق'], failure: ['late', 'ناموفق'], cancelled: ['today', 'لغو شد'], skipped: ['', 'رد شد'], timed_out: ['late', 'زمان‌گذشت'] }[r.conclusion] || ['', r.conclusion || '—'];
  return chip(m[1], m[0]);
}

/* ---------- صفحهٔ پروژه ---------- */
function viewProject() {
  const p = proj(V.pid);
  if (!p) { V.name = 'dashboard'; return viewDashboard(); }
  const tabs = { overview: tabOverview, status: tabStatus, git: tabGit, deploy: tabDeploy, backup: tabBackup, ci: tabCI, vault: p => vaultSection(p.id, false) };
  return `
    <div class="page-head"><span class="pdot" style="background:${p.color};width:14px;height:14px"></span><h1>${esc(p.name)}</h1>
      <span class="grow"></span>
      <button class="btn" data-action="refresh-project">${I.refresh}به‌روزرسانی</button>
      ${p.repoPath ? `<button class="btn" data-action="open-folder" data-path="${esc(p.repoPath)}">${I.folder}پوشه</button>` : ''}
      <button class="btn" data-action="edit-project" data-id="${p.id}">${I.edit}ویرایش</button></div>
    <div class="tabs">${TABS.map(([k, l, ic]) => `<button class="${V.tab === k ? 'on' : ''}" data-action="set-tab" data-tab="${k}">${ic}${l}</button>`).join('')}</div>
    ${(tabs[V.tab] || tabOverview)(p)}`;
}

function tabOverview(p) {
  const A = computeAlerts().filter(a => a.pid === p.id);
  const g = C.git[p.id], ci = C.ci[p.id];
  const gitTile = !p.repoPath ? `<div class="sub">مسیر مخزن تنظیم نشده است.</div>` : !g ? '<div class="sub">در حال بررسی…</div>' : g.error ? `<div class="sub">${esc(g.error)}</div>`
    : `<div class="row">${chip(esc(g.branch), '', I.branch)}${g.upstream ? `<span class="sub">← ${esc(g.upstream)}</span>` : chip('بدون upstream', 'today')}${g.dirty ? chip(`${fa(g.dirty)} تغییر`, 'today') : ''}${g.ahead ? chip(fa(g.ahead), 'soon', I.up) : ''}${g.behind ? chip(fa(g.behind), 'today', I.down) : ''}</div>
      ${g.last ? `<div class="sub" style="margin-top:6px">${esc(g.last.hash)} · ${esc(g.last.subject)} <span class="sub">(${ago(g.last.ts)})</span></div>` : ''}
      <div class="row" style="margin-top:10px"><button class="btn sm" data-action="git-fetch" data-id="${p.id}">Fetch</button><button class="btn sm" data-action="git-pull" data-id="${p.id}">Pull</button></div>`;
  const envTile = p.envs.length ? p.envs.map(e => {
    const h = C.health[e.id];
    return `<div class="trow" style="cursor:default"><span class="tt"><b>${esc(e.name)}</b> <a class="lnk" data-action="open-url" data-url="${esc(e.url)}">${esc(e.url)}</a></span>
      ${h ? (h.ok ? chip(`HTTP ${fa(h.status)} · ${fa(h.ms)}ms`, 'okc') : chip(esc(h.error || (h.keywordOk === false ? 'متن مورد انتظار نبود' : 'HTTP ' + h.status)), 'late')) : ''}${h && h.certDays != null ? chip(`SSL ${fa(h.certDays)} روز`, h.certDays <= 14 ? 'today' : '') : ''}
      <button class="iconbtn" data-action="env-check" data-id="${e.id}" title="بررسی الان">${I.refresh}</button></div>`;
  }).join('') : '<div class="sub">آدرس محیط‌ها (production/staging) را در ویرایش پروژه اضافه کنید تا سلامتشان پایش شود.</div>';
  const depTile = p.deploys.length ? p.deploys.map(d => { const r = lastRun(d.id, 'deploy'); return `<div class="trow" style="cursor:default"><span class="tt">${esc(d.name)}</span>${r ? runChip(r) + `<span class="sub">${ago(r.start)}</span>` : ''}<button class="btn sm" data-action="open-project" data-id="${p.id}" data-tab="deploy">باز کردن</button></div>`; }).join('') : '<div class="sub">هنوز استقراری تعریف نشده.</div>';
  const bakTile = p.backups.length ? p.backups.map(b => { const r = lastRun(b.id, 'backup'); return `<div class="trow" style="cursor:default"><span class="tt">${esc(b.name)}</span>${r ? runChip(r) + `<span class="sub">${ago(r.start)}</span>` : chip('هنوز اجرا نشده', 'today')}<button class="btn sm" data-action="backup-run" data-id="${b.id}">${I.play}الان</button></div>`; }).join('') : '<div class="sub">هنوز بک‌آپی تعریف نشده.</div>';
  const ciTile = !p.ci.repo ? '<div class="sub">مخزن GitHub تنظیم نشده است.</div>' : !ci ? '<div class="sub">در حال بررسی…</div>' : ci.error ? `<div class="sub">${esc(ci.error)}</div>`
    : (ci.runs.slice(0, 3).map(r => `<div class="trow" data-action="open-url" data-url="${esc(r.url)}"><span class="tt">${esc(r.name)} <span class="sub">${esc(r.branch)}</span></span>${ciBadge(r)}</div>`).join('') || '<div class="sub">اجرایی ثبت نشده.</div>');
  const tile = (title, icon, tab, body) => `<div class="card section"><h2>${icon}${title}<span class="grow"></span><button class="btn sm" data-action="set-tab" data-tab="${tab}">جزئیات</button></h2>${body}</div>`;
  return `
    ${A.length ? `<div class="card section" style="margin-bottom:16px">${A.map(alertRow).join('')}</div>` : ''}
    ${p.envs.length ? `<div class="row" style="margin-bottom:14px">${p.envs.map(e => { const h = C.health[e.id]; return h ? `<span class="chip ${h.ok ? 'okc' : 'late'}" style="font-size:13px;padding:2px 10px">${esc(e.name)}: ${h.ok ? 'HTTP ' + fa(h.status) : esc(h.error || 'HTTP ' + h.status)}</span>` : ''; }).join('')}<button class="btn sm" data-action="set-tab" data-tab="status">وضعیت زنده</button></div>` : ''}
    ${p.desc ? `<p class="sub" style="margin-top:0">${esc(p.desc)}</p>` : ''}
    <div class="cols2">
      <div class="stack">${tile('Git', I.branch, 'git', gitTile)}${tile('استقرار', I.deploy, 'deploy', depTile)}${tile('بک‌آپ', I.db, 'backup', bakTile)}</div>
      <div class="stack"><div class="card section"><h2>${I.globe}محیط‌ها و سلامت</h2>${envTile}</div>${tile('CI/CD', I.activity, 'ci', ciTile)}
        ${p.notes ? `<div class="card section"><h2>یادداشت</h2><div style="white-space:pre-wrap">${esc(p.notes)}</div></div>` : ''}</div>
    </div>`;
}

/* ---------- Git ---------- */
function tabGit(p) {
  if (!p.repoPath) return notSet('مسیر مخزن git برای این برنامه تنظیم نشده', `<button class="btn primary" data-action="edit-project" data-id="${p.id}">تنظیم مسیر</button>`);
  const g = C.git[p.id];
  if (!g) return '<div class="empty card">در حال بارگذاری…</div>';
  if (g.error) return notSet(esc(g.error), `<button class="btn" data-action="edit-project" data-id="${p.id}">ویرایش مسیر</button>`);
  const gd = C.gd[p.id];
  const head = `<div class="card section" style="margin-bottom:16px">
    <div class="row between"><div class="row"><b style="font-size:17px">${I.branch.replace('<svg', '<svg style="vertical-align:-3px"')} ${esc(g.branch)}</b>
      ${g.upstream ? `<span class="sub">← ${esc(g.upstream)}${g.gone ? ' (در ریموت حذف شده)' : ''}</span>` : chip('بدون upstream', 'today')}
      ${g.ahead ? chip(`${fa(g.ahead)} پوش‌نشده`, 'soon', I.up) : ''}${g.behind ? chip(`${fa(g.behind)} عقب از ریموت`, 'today', I.down) : ''}${g.dirty ? chip(`${fa(g.dirty)} تغییر`, 'today') : chip('تمیز', 'okc')}</div>
      <div class="row"><button class="btn sm" data-action="git-fetch" data-id="${p.id}">${I.refresh}Fetch</button><button class="btn sm" data-action="git-pull" data-id="${p.id}">${I.down}Pull</button>
      ${g.ahead || !g.upstream ? `<button class="btn sm primary" data-action="git-push" data-id="${p.id}">${I.up}Push</button>` : ''}<button class="btn sm" data-action="git-new-branch">${I.plus}شاخهٔ جدید</button></div></div>
    ${g.remote ? `<div class="sub" style="margin-top:6px;direction:ltr;text-align:right">${esc(g.remote)}</div>` : ''}
    ${g.dirty ? `<details style="margin-top:10px"><summary>فایل‌های تغییریافته (${fa(g.dirty)})</summary><div class="files">${g.files.map(f => `<div><code>${esc(f.xy)}</code> ${esc(f.path)}</div>`).join('')}${g.dirty > g.files.length ? '<div class="sub">…</div>' : ''}</div></details>` : ''}</div>`;
  if (!gd) return head + '<div class="empty card">در حال بارگذاری شاخه‌ها…</div>';

  const br = gd.br.branches || [];
  const rows = br.filter(b => V.bfilter === 'merged' ? b.merged && !b.current : V.bfilter === 'remote' ? b.isRemote : true)
    .sort((a, b) => (b.current - a.current) || b.date - a.date);
  const brRow = b => `<div class="trow brow" style="cursor:default">
    <span class="tt"><b>${esc(b.name)}</b>
      ${b.current ? chip('فعلی', 'okc') : ''}${b.isRemote ? chip('فقط ریموت', '') : ''}${b.merged ? chip('ادغام‌شده', 'soon') : ''}${b.gone ? chip('در ریموت حذف شده', 'today') : ''}${!b.isRemote && !b.upstream ? chip('فقط محلی', 'today') : ''}
      ${b.ahead ? chip(fa(b.ahead), 'soon', I.up) : ''}${b.behind ? chip(fa(b.behind), 'today', I.down) : ''}
      <div class="sub" style="font-size:12px">${esc(b.subject)} · ${esc(b.author)} · ${ago(b.date)}</div></span>
    ${b.current ? '' : b.isRemote
      ? `<button class="btn sm" data-action="git-checkout" data-name="${esc(b.name)}" data-remote="1">Checkout</button><button class="iconbtn" title="حذف از ریموت" data-action="git-del-remote" data-name="${esc(b.name)}">${I.trash}</button>`
      : `<button class="btn sm" data-action="git-checkout" data-name="${esc(b.name)}">Checkout</button><button class="btn sm" title="ادغام در شاخهٔ فعلی" data-action="git-merge" data-name="${esc(b.name)}">${I.merge}ادغام</button><button class="iconbtn" title="حذف شاخه" data-action="git-del" data-name="${esc(b.name)}">${I.trash}</button>`}</div>`;
  const mergedCount = br.filter(b => b.merged && !b.current).length;
  const commits = (gd.lg.commits || []).map(c => `<div class="trow" style="cursor:default"><code>${esc(c.hash)}</code><span class="tt">${esc(c.subject)}${c.refs ? ` <span class="sub">(${esc(c.refs)})</span>` : ''}</span><span class="sub">${esc(c.author)} · ${ago(c.ts)}</span></div>`).join('');
  const tags = (gd.tg.tags || []).map(t => `<div class="trow" style="cursor:default">${I.tag}<b>${esc(t.name)}</b><span class="tt sub">${esc(t.subject || '')}</span><span class="sub">${ago(t.ts)}</span><button class="btn sm" data-action="git-tag-push" data-name="${esc(t.name)}">Push</button></div>`).join('');
  return head + `
    <div class="card section" style="margin-bottom:16px"><h2>شاخه‌ها <span class="grow"></span>
      <div class="seg"><button class="${V.bfilter === 'all' ? 'on' : ''}" data-action="bfilter" data-v="all">همه (${fa(br.length)})</button><button class="${V.bfilter === 'merged' ? 'on' : ''}" data-action="bfilter" data-v="merged">ادغام‌شده — قابل پاک‌سازی (${fa(mergedCount)})</button><button class="${V.bfilter === 'remote' ? 'on' : ''}" data-action="bfilter" data-v="remote">فقط ریموت</button></div></h2>
      ${gd.br.error ? `<div class="sub">${esc(gd.br.error)}</div>` : rows.map(brRow).join('') || '<div class="empty" style="padding:20px">شاخه‌ای نیست</div>'}</div>
    <div class="cols2"><div class="card section"><h2>آخرین کامیت‌ها</h2>${commits || '<div class="sub">—</div>'}</div>
      <div class="card section"><h2>تگ‌ها (نسخه‌ها) <span class="grow"></span><button class="btn sm" data-action="git-tag-new">${I.plus}تگ جدید</button></h2>${tags || '<div class="sub">تگی نیست</div>'}</div></div>`;
}

/* ---------- استقرار ---------- */
function tabDeploy(p) {
  const hist = S.history.filter(h => h.projectId === p.id && h.kind === 'deploy').slice(0, 8);
  const cards = p.deploys.map(d => {
    const r = lastRun(d.id, 'deploy'), env = p.envs.find(e => e.id === d.envId), run = isRunning(d.id);
    return `<div class="card section">
      <div class="row between"><h2 style="margin:0">${I.deploy}${esc(d.name)} ${env ? chip(esc(env.name), 'soon', I.globe) : ''}${d.branch ? chip(esc(d.branch), '', I.branch) : ''}</h2>
        <div class="row"><button class="iconbtn" data-action="deploy-edit" data-id="${d.id}" title="ویرایش">${I.edit}</button><button class="btn primary" data-action="deploy-run" data-id="${d.id}" ${run ? 'disabled' : ''}>${I.play}${run ? 'در حال اجرا…' : 'استقرار'}</button></div></div>
      <code class="cmd">${esc(d.command)}</code>
      <div class="sub" style="margin-top:8px">${r ? `آخرین اجرا: ${runChip(r)} ${ago(r.start)}${dur(r)}` : 'هنوز اجرا نشده'}</div></div>`;
  }).join('');
  return `<div class="page-head" style="margin-top:0"><span class="sub">دستورهای استقرار شما؛ قبل از اجرا وضعیت git و CI بررسی و نمایش داده می‌شود.</span><span class="grow"></span><button class="btn primary" data-action="deploy-new">${I.plus}تعریف استقرار</button></div>
    ${cards ? `<div class="stack">${cards}</div>` : notSet('هنوز استقراری تعریف نشده', `<p class="sub">یک دستور (مثلاً ssh + git pull + restart) تعریف کنید تا با یک کلیک اجرا و ثبت شود.</p>`)}
    ${hist.length ? `<div class="card section" style="margin-top:16px"><h2>تاریخچهٔ استقرارها</h2>${hist.map(histRow).join('')}</div>` : ''}`;
}

/* ---------- بک‌آپ ---------- */
function tabBackup(p) {
  const cards = p.backups.map(b => {
    const r = lastRun(b.id, 'backup'), run = isRunning(b.id), files = (C.backups[b.id] && C.backups[b.id].files) || [];
    return `<div class="card section">
      <div class="row between"><h2 style="margin:0">${I.db}${esc(b.name)} ${chip(b.type === 'folder' ? 'پوشه ← zip' : 'دستور سفارشی', '')}${b.everyHours > 0 ? chip(`هر ${fa(b.everyHours)} ساعت`, 'soon', I.clock) : chip('دستی', '')}</h2>
        <div class="row"><button class="iconbtn" data-action="open-folder" data-path="${esc(b.destDir)}" title="باز کردن پوشهٔ مقصد">${I.folder}</button><button class="iconbtn" data-action="backup-edit" data-id="${b.id}" title="ویرایش">${I.edit}</button>
        <button class="btn primary" data-action="backup-run" data-id="${b.id}" ${run ? 'disabled' : ''}>${I.play}${run ? 'در حال اجرا…' : 'بک‌آپ بگیر'}</button></div></div>
      <div class="sub" style="margin:6px 0">${b.type === 'folder' ? esc(b.source) + ' ← ' : ''}<code>${esc(b.destDir)}</code> · نگهداری ${b.keep ? fa(b.keep) + ' نسخهٔ آخر' : 'همه'}</div>
      <div class="sub">${r ? `آخرین اجرا: ${runChip(r)} ${ago(r.start)}${dur(r)}${r.size ? ' · ' + fmtSize(r.size) : ''}` : 'هنوز اجرا نشده'}</div>
      ${files.length ? `<details style="margin-top:10px" open><summary>فایل‌های موجود (${fa(files.length)})</summary><div class="files">${files.slice(0, 8).map(f => `<div class="row between"><code>${esc(f.name)}</code><span class="sub">${fmtSize(f.size)} · ${ago(f.ts)}</span></div>`).join('')}</div></details>` : ''}</div>`;
  }).join('');
  const hist = S.history.filter(h => h.projectId === p.id && h.kind === 'backup').slice(0, 8);
  return `<div class="page-head" style="margin-top:0"><span class="sub">بک‌آپ زمان‌بندی‌شده فقط وقتی برنامه باز است اجرا می‌شود. حتماً دست‌کم یک‌بار نسخهٔ بازیابی را آزمایش کنید.</span><span class="grow"></span><button class="btn primary" data-action="backup-new">${I.plus}تعریف بک‌آپ</button></div>
    ${cards ? `<div class="stack">${cards}</div>` : notSet('هنوز بک‌آپی تعریف نشده', `<p class="sub">می‌توانید یک پوشه را zip کنید یا خروجی دستوری مثل mysqldump / pg_dump را ذخیره کنید.</p>`)}
    ${hist.length ? `<div class="card section" style="margin-top:16px"><h2>تاریخچهٔ بک‌آپ‌ها</h2>${hist.map(histRow).join('')}</div>` : ''}`;
}

/* ---------- CI/CD ---------- */
function tabCI(p) {
  if (!p.ci.repo) return notSet('مخزن GitHub برای CI تنظیم نشده', `<p class="sub">در ویرایش پروژه مخزن را به شکل <code>owner/repo</code> بنویسید (اگر remote شما GitHub باشد خودکار پر می‌شود).</p><button class="btn primary" data-action="edit-project" data-id="${p.id}">ویرایش پروژه</button>`);
  const c = C.ci[p.id], wf = C.wf[p.id], g = C.git[p.id];
  const tokenInfo = p.ci.tokenId ? chip('با توکن', 'okc', I.key) : chip('بدون توکن (فقط مخزن عمومی)', 'today');
  const runs = c && c.runs ? c.runs.map(r => `<div class="trow" style="cursor:default">${ciBadge(r)}
    <span class="tt"><b>${esc(r.name)}</b> <span class="sub">${esc(r.title)}</span><div class="sub" style="font-size:12px">${chip(esc(r.branch || ''), '', I.branch)} ${esc(r.event)} · ${esc(r.actor || '')} · ${ago(r.started)}${r.status === 'completed' ? ' · ' + fmtSec((r.updated - r.started) / 1000) : ''}</div></span>
    ${r.status !== 'completed' ? `<button class="btn sm" data-action="ci-cancel" data-id="${r.id}">لغو</button>` : `<button class="btn sm" data-action="ci-rerun" data-id="${r.id}" data-failed="${r.conclusion === 'failure' ? 1 : 0}">اجرای مجدد${r.conclusion === 'failure' ? ' (شکست‌خورده‌ها)' : ''}</button>`}
    <button class="iconbtn" data-action="open-url" data-url="${esc(r.url)}" title="باز کردن در GitHub">${I.ext}</button></div>`).join('') : '';
  const dispatch = wf && wf.workflows && wf.workflows.length ? `<div class="card section" style="margin-bottom:16px"><h2>اجرای دستی گردش‌کار</h2>
    <div class="row"><select id="wfSel">${wf.workflows.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>
    <input type="text" id="wfRef" value="${esc((g && g.branch) || (g && g.default) || 'main')}" dir="ltr" style="width:180px" placeholder="branch">
    <button class="btn primary" data-action="ci-dispatch">${I.play}اجرا</button></div>
    <div class="sub" style="margin-top:6px">فقط گردش‌کارهایی که <code>workflow_dispatch</code> دارند قابل اجرای دستی هستند. توکن به دسترسی <code>actions:write</code> نیاز دارد.</div></div>` : '';
  return `<div class="page-head" style="margin-top:0"><b>${esc(p.ci.repo)}</b>${tokenInfo}<span class="grow"></span>
      <button class="btn" data-action="open-url" data-url="https://github.com/${esc(p.ci.repo)}/actions">${I.ext}GitHub Actions</button><button class="btn" data-action="ci-refresh">${I.refresh}به‌روزرسانی</button></div>
    ${dispatch}
    <div class="card section"><h2>اجراهای اخیر</h2>${!c ? '<div class="sub">در حال بارگذاری…</div>' : c.error ? `<div class="alert bad">${I.alert}<span>${esc(c.error)}</span></div>` : runs || '<div class="sub">هنوز اجرایی ثبت نشده</div>'}</div>`;
}

/* ---------- تاریخچه ---------- */
function histRow(h) {
  const p = proj(h.projectId), kind = { deploy: 'استقرار', backup: 'بک‌آپ', git: 'Git' }[h.kind] || h.kind;
  return `<div class="trow" data-action="log-open" data-id="${h.id}">${runChip(h)}<span class="tt">${esc(h.title)}</span>
    ${p ? chip(esc(p.name), '') : ''}<span class="sub">${fmtTs(h.start)}${dur(h)}</span></div>`;
}
function viewHistory() {
  let list = S.history.filter(h => (!V.hKind || h.kind === V.hKind) && (!V.hProj || h.projectId === V.hProj));
  const sel = (k, opts, val) => `<select data-hf="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="page-head"><h1>تاریخچهٔ عملیات</h1><span class="sub">${fa(list.length)} مورد</span><span class="grow"></span><button class="btn danger" data-action="hist-clear">پاک‌کردن</button></div>
    <div class="filters">${sel('hKind', [['', 'همهٔ انواع'], ['deploy', 'استقرار'], ['backup', 'بک‌آپ'], ['git', 'Git']], V.hKind)}
    ${sel('hProj', [['', 'همهٔ برنامه‌ها'], ...S.projects.map(p => [p.id, p.name])], V.hProj)}</div>
    <div class="card section">${list.length ? list.slice(0, 150).map(histRow).join('') : '<div class="empty">هنوز عملیاتی ثبت نشده</div>'}</div>`;
}

/* ---------- گاوصندوق ---------- */
function vaultSection(pid, global) {

  const list = C.vault.filter(v => global ? (!V.vProj || v.projectId === (V.vProj === '-' ? '' : V.vProj)) : v.projectId === pid || v.projectId === '');
  const banner = `<div class="sub" style="margin-bottom:10px">${I.lock.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"')} همهٔ موارد با رمز اصلی شما و AES-256 رمزنگاری شده‌اند و فقط هنگام نمایش، کپی یا اجرای دستور در حافظه باز می‌شوند.</div>`;
  const row = v => {
    const p = proj(v.projectId), d = v.expires ? diffDays(v.expires) : null;
    return `<div class="trow vrow" style="cursor:default">
      ${chip(KINDS[v.kind] || v.kind, 'soon')}
      <span class="tt"><b>${esc(v.label)}</b> ${global && p ? chip(esc(p.name), '') : ''}${!p ? chip('عمومی', '') : ''}
        <div class="sub" style="font-size:12px">${v.username ? `${esc(v.username)} · ` : ''}${v.url ? `<a class="lnk" data-action="open-url" data-url="${esc(v.url)}">${esc(v.url)}</a>` : ''}</div></span>
      ${d != null ? chip(d < 0 ? 'منقضی شده' : `انقضا ${fa(d)} روز دیگر`, d < 0 ? 'late' : d <= 30 ? 'today' : '', I.cal) : ''}
      <code class="secret" data-secret="${v.id}">${v.hasSecret ? '••••••••••' : '—'}</code>
      ${v.username ? `<button class="iconbtn" data-action="v-copyuser" data-id="${v.id}" title="کپی نام کاربری">${I.copy}</button>` : ''}
      ${v.hasSecret ? `<button class="iconbtn" data-action="v-reveal" data-id="${v.id}" title="نمایش ۱۵ ثانیه‌ای">${I.eye}</button><button class="btn sm" data-action="v-copy" data-id="${v.id}">${I.copy}رمز</button>` : ''}
      <button class="iconbtn" data-action="v-edit" data-id="${v.id}" title="ویرایش">${I.edit}</button></div>`;
  };
  const filter = global ? `<select data-hf="vProj"><option value="">همهٔ برنامه‌ها</option><option value="-" ${V.vProj === '-' ? 'selected' : ''}>عمومی</option>${S.projects.map(p => `<option value="${p.id}" ${V.vProj === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : '';
  return `${global ? `<div class="page-head"><h1>گاوصندوق رمزها</h1>${filter}<span class="grow"></span><button class="btn primary" data-action="v-new">${I.plus}مورد جدید</button></div>` : `<div class="page-head" style="margin-top:0"><span class="sub">رمزهای این برنامه و موارد عمومی</span><span class="grow"></span><button class="btn primary" data-action="v-new">${I.plus}مورد جدید</button></div>`}
    ${banner}<div class="card section">${list.length ? list.map(row).join('') : `<div class="empty">${I.key}<h3>گاوصندوق خالی است</h3><p>رمز سرور، دیتابیس، توکن‌ها و کلیدها را اینجا نگه دارید. می‌توانید در دستورهای استقرار و بک‌آپ به‌صورت <code>NAME=@برچسب</code> از آن‌ها استفاده کنید.</p></div>`}</div>`;
}
const viewVault = () => vaultSection('', true);

/* ---------- تنظیمات ---------- */
function viewSettings() {
  const th = S.settings.theme, al = S.settings.autoLockMin;
  const opt = (arr, cur) => arr.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="page-head"><h1>تنظیمات</h1></div>
    <div class="set-grid">
      <div class="card"><h2>ظاهر</h2><div class="seg">${[['system', 'مطابق سیستم'], ['light', 'روشن'], ['dark', 'تیره']].map(([v, l]) => `<button class="${th === v ? 'on' : ''}" data-action="theme" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="card"><h2>${I.lock.replace('<svg', '<svg style="vertical-align:-3px"')} امنیت و رمز اصلی</h2>
        <p class="sub">همهٔ اطلاعات (پروژه‌ها، دستورها، لاگ‌ها و رمزها) روی دیسک با <b>AES-256-GCM</b> رمزنگاری می‌شوند. کلید از رمز اصلی شما با scrypt ساخته می‌شود، جایی ذخیره نمی‌شود و با قفل‌شدن از حافظه پاک می‌شود. دست‌کاری فایل‌ها هم شناسایی می‌شود.</p>
        <div class="row"><button class="btn primary" data-action="lock-now">${I.lock}قفل کن همین حالا</button><button class="btn" data-action="pw-change">تغییر رمز اصلی</button></div>
        <div class="field" style="margin-top:14px"><label>قفل خودکار بعد از بی‌کاری</label>
          <select data-setting="autoLockMin" style="max-width:220px">${opt([[0, 'هرگز'], [5, '۵ دقیقه'], [10, '۱۰ دقیقه'], [15, '۱۵ دقیقه'], [30, '۳۰ دقیقه'], [60, '۱ ساعت']], al)}</select></div></div>
      <div class="card"><h2>پایش سلامت</h2><p class="sub">هر چند دقیقه وضعیت سایت‌ها (و git) خودکار بررسی شود؟</p>
        <select data-setting="healthMin">${opt([[0, 'خاموش'], [1, 'هر ۱ دقیقه'], [5, 'هر ۵ دقیقه'], [15, 'هر ۱۵ دقیقه'], [60, 'هر ساعت']], S.settings.healthMin)}</select></div>
      <div class="card"><h2>پشتیبان رمزنگاری‌شده</h2>
        <p class="sub">فایل پشتیبان شامل همهٔ اطلاعات و رمزهاست، <b>ولی کاملاً رمزنگاری‌شده</b> و فقط با رمز اصلی شما روی هر کامپیوتری باز می‌شود. هر روز یک نسخهٔ خودکار (رمزنگاری‌شده) هم در پوشهٔ داده نگه داشته می‌شود.</p>
        <div class="row"><button class="btn primary" data-action="export">ذخیرهٔ پشتیبان</button><button class="btn" data-action="import">بازیابی از فایل</button></div></div>
      <div class="card"><h2>اطلاعات سیستم</h2><p class="sub" style="margin:0">پوشهٔ داده: <code id="dataPath">…</code></p><p class="sub" style="margin:6px 0 0">Git: <code id="gitVer">…</code></p>
        <p class="sub" style="margin:10px 0 0">این برنامه هیچ داده‌ای به سرور شخص ثالث نمی‌فرستد؛ فقط به آدرس‌هایی که خودتان تعریف می‌کنید و GitHub (برای CI) درخواست می‌زند.</p></div>
    </div>`;
}
async function fillSettings() {
  const dp = $('#dataPath'), gv = $('#gitVer');
  if (dp) dp.textContent = await native.data.path();
  const r = await native.git('version', '');
  if (gv) gv.textContent = r.version || r.error || '—';
}

/* ======================= پنجره‌های ویرایش ======================= */
const envRow = e => `<div class="envrow" data-id="${esc(e.id || '')}">
  <div class="row1"><input type="text" name="name" value="${esc(e.name || '')}" placeholder="production" style="width:34%"><input type="text" name="url" value="${esc(e.url || '')}" dir="ltr" placeholder="https://example.com"><button type="button" class="iconbtn" data-action="row-del">${I.x}</button></div>
  <details ${e.checkUrl || e.expect || e.keyword || e.headers || (e.method && e.method !== 'GET') ? 'open' : ''}><summary>تنظیمات درخواست پایش (اختیاری)</summary>
    <div class="two" style="margin-top:8px"><input type="text" name="checkUrl" value="${esc(e.checkUrl || '')}" dir="ltr" placeholder="آدرس سلامت، مثلاً https://example.com/health">
      <select name="method">${['GET', 'HEAD', 'POST'].map(m => `<option ${((e.method || 'GET') === m) ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
    <div class="two" style="margin-top:8px"><input type="text" name="expect" value="${esc(e.expect || '')}" dir="ltr" placeholder="کد مورد انتظار (مثلاً 200)"><input type="text" name="keyword" value="${esc(e.keyword || '')}" dir="ltr" placeholder="متن مورد انتظار در پاسخ"></div>
    <textarea name="headers" dir="ltr" style="margin-top:8px;min-height:50px;font-family:Consolas,monospace;width:100%" placeholder="Authorization: Bearer @api-token">${esc(e.headers || '')}</textarea>
  </details></div>`;

/* ---------- وضعیت زنده ---------- */
function flatJson(o, prefix = '', out = [], depth = 0) {
  if (out.length >= 16) return out;
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v)) out.push([prefix + k, `[${v.length} مورد]`]);
      else if (v && typeof v === 'object') { if (depth < 2) flatJson(v, prefix + k + '.', out, depth + 1); }
      else out.push([prefix + k, String(v)]);
      if (out.length >= 16) break;
    }
  } else out.push(['value', String(o)]);
  return out;
}
function sparkHtml(id) {
  const arr = (S.checks[id] || []).slice(-40);
  if (!arr.length) return '';
  const max = Math.max(...arr.map(c => c.ms || 0), 100);
  return `<div class="spark">${arr.map(c => `<i class="${c.ok ? '' : 'bad'}" style="height:${c.ok ? Math.max(10, Math.round((c.ms / max) * 100)) : 100}%" title="${fmtTs(c.t)} · ${c.ok ? fa(c.ms) + 'ms' : 'ناموفق'}"></i>`).join('')}</div>`;
}
function uptimePct(id) {
  const a = S.checks[id] || [];
  return a.length ? Math.round((a.filter(c => c.ok).length / a.length) * 1000) / 10 : null;
}
function tabStatus(p) {
  const envs = p.envs.filter(e => e.url || e.checkUrl);
  const cards = envs.map(e => {
    const r = C.health[e.id], up = uptimePct(e.id), target = e.checkUrl || e.url;
    const badge = !r ? chip('بررسی نشده', '') : r.ok ? chip('سالم', 'okc') : chip('مشکل دارد', 'late');
    const metrics = !r ? '<div class="sub">هنوز درخواستی ارسال نشده.</div>' : `
      <div class="metrics">
        <div><span>کد پاسخ</span><b class="${r.ok ? 'g' : 'r'}">${r.status ? 'HTTP ' + fa(r.status) : '—'}</b><small>${esc(r.statusText || r.error || '')}</small></div>
        <div><span>زمان پاسخ</span><b>${r.ms != null ? fa(r.ms) + ' ms' : '—'}</b>${r.total ? `<small>کل: ${fa(r.total)}ms</small>` : ''}</div>
        <div><span>آپ‌تایم (${fa((S.checks[e.id] || []).length)} بررسی)</span><b class="${up >= 99 ? 'g' : up >= 90 ? '' : 'r'}">${up == null ? '—' : fa(up) + '٪'}</b></div>
        <div><span>گواهی SSL</span><b class="${r.certDays != null && r.certDays <= 14 ? 'r' : ''}">${r.certDays != null ? fa(r.certDays) + ' روز' : '—'}</b></div>
        <div><span>حجم پاسخ</span><b>${r.size != null ? fmtSize(r.size) : '—'}</b></div>
        <div><span>آخرین بررسی</span><b style="font-size:13px">${ago(r.at)}</b></div>
      </div>
      ${r.keywordOk === false ? `<div class="alert bad" style="cursor:default">${I.alert}<span>متن «${esc(e.keyword)}» در پاسخ پیدا نشد.</span></div>` : ''}
      ${r.error ? `<div class="alert bad" style="cursor:default">${I.alert}<span>${esc(r.error)}</span></div>` : ''}
      ${r.json !== undefined ? `<div class="jgrid">${flatJson(r.json).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v.length > 60 ? v.slice(0, 60) + '…' : v)}</b></div>`).join('')}</div>` : ''}
      ${sparkHtml(e.id)}`;
    return `<div class="card section">
      <div class="row between"><h2 style="margin:0">${I.globe}${esc(e.name || target)} ${badge}${chip(esc((e.method || 'GET') + (e.expect ? ' → ' + e.expect : '')), '')}</h2>
        <div class="row"><button class="btn sm" data-action="env-check" data-id="${e.id}">${I.refresh}ارسال درخواست</button><button class="btn sm" data-action="env-full" data-id="${e.id}" data-name="${esc(e.name || '')}" ${r ? '' : 'disabled'}>پاسخ کامل</button></div></div>
      <div style="margin:6px 0 10px"><a class="lnk" data-action="open-url" data-url="${esc(target)}">${esc(target)}</a></div>
      ${metrics}</div>`;
  }).join('');
  return `<div class="page-head" style="margin-top:0"><span class="sub">برنامه به‌صورت خودکار (طبق تنظیم پایش) درخواست می‌گیرد و وضعیتش را اینجا می‌بینید؛ در صورت JSON بودن پاسخ، فیلدهای آن هم نمایش داده می‌شود.</span><span class="grow"></span>
    <button class="btn" data-action="req-new">${I.term}درخواست دلخواه</button><button class="btn primary" data-action="refresh-project">${I.refresh}ارسال همهٔ درخواست‌ها</button></div>
    ${cards ? `<div class="stack">${cards}</div>` : notSet('آدرسی برای پایش تعریف نشده', `<p class="sub">در ویرایش پروژه، آدرس محیط‌ها (و در صورت نیاز آدرس /health، هدرها و کد مورد انتظار) را وارد کنید.</p><button class="btn primary" data-action="edit-project" data-id="${p.id}">ویرایش پروژه</button>`)}`;
}

function formatResponse(r) {
  if (r.error && !r.status) return `✗ ${r.error}`;
  const head = `${r.method || 'GET'} ${r.finalUrl || ''}\nHTTP ${r.status} ${r.statusText || ''}  ·  ${r.ms}ms  ·  ${fmtSize(r.size)}${r.truncated ? ' (بریده شد)' : ''}\n\n`;
  const hdrs = Object.entries(r.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  let body = r.body || '';
  if (r.json !== undefined) { try { body = JSON.stringify(r.json, null, 2); } catch { /* همان متن */ } }
  return `${head}${hdrs}\n\n${body}`;
}
function showResponse(title, r) {
  openModal(`<header><span>${esc(title)}</span><button class="iconbtn" data-action="close">${I.x}</button></header>
    <div class="body"><pre class="console">${esc(formatResponse(r))}</pre></div><footer><span class="grow"></span><button class="btn" data-action="close">بستن</button></footer>`, { wide: true });
}
function requestModal() {
  const p = proj(V.pid), e = p.envs.find(x => x.url || x.checkUrl) || {};
  openModal(`<form id="reqForm">${modalHead('ارسال درخواست دلخواه')}
    <div class="body">
      <div class="folder-row"><select name="method" style="width:110px">${['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map(m => `<option>${m}</option>`).join('')}</select><input type="text" name="url" dir="ltr" value="${esc(e.checkUrl || e.url || '')}" placeholder="https://example.com/api/status"></div>
      <div class="field"><label>هدرها (هر خط Name: value — برای رمز: <code>Authorization: Bearer @برچسب</code>)</label><textarea name="headers" dir="ltr" style="min-height:56px;font-family:Consolas,monospace"></textarea></div>
      <div class="field"><label>بدنهٔ درخواست (برای POST/PUT/PATCH)</label><textarea name="body" dir="ltr" style="min-height:56px;font-family:Consolas,monospace"></textarea></div>
      <pre class="console" id="reqOut" style="height:30vh">پاسخ اینجا نمایش داده می‌شود.</pre></div>
    <footer><button class="btn primary">${I.play}ارسال</button><span class="grow"></span><button type="button" class="btn" data-action="close">بستن</button></footer></form>`, { wide: true });
}
async function sendRequest(f) {
  const method = f.elements.method.value;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !(await askConfirm(`درخواست ${method} به ${f.elements.url.value} ارسال شود؟ این درخواست می‌تواند داده را تغییر دهد.`, 'ارسال', false))) return;
  const out = $('#reqOut');
  out.textContent = 'در حال ارسال…';
  const r = await native.net.check({ url: f.elements.url.value.trim(), method, headers: f.elements.headers.value, body: f.elements.body.value, projectId: V.pid, full: true });
  out.textContent = formatResponse(r);
}
const footerBtns = (delAttr) => `<footer>${delAttr || ''}<span class="grow"></span><button type="button" class="btn" data-action="close">انصراف</button><button class="btn primary">ذخیره</button></footer>`;
const modalHead = t => `<header><span>${t}</span><button type="button" class="iconbtn" data-action="close">${I.x}</button></header>`;
const folderField = (label, name, val, ph) => `<div class="field"><label>${label}</label><div class="folder-row"><input type="text" name="${name}" value="${esc(val || '')}" dir="ltr" placeholder="${ph || ''}"><button type="button" class="btn" data-action="pick-folder" data-target="${name}">انتخاب…</button></div></div>`;
const shellSel = v => `<select name="shell"><option value="cmd" ${v !== 'powershell' ? 'selected' : ''}>cmd</option><option value="powershell" ${v === 'powershell' ? 'selected' : ''}>PowerShell</option></select>`;
const ENV_HINT = 'هر خط: NAME=@برچسب-گاوصندوق  یا  NAME=مقدار';

function projectModal(id) {
  const p = id ? proj(id) : normProject({ name: '', color: COLORS[S.projects.length % COLORS.length] });
  const tokens = C.vault.filter(v => v.hasSecret && (v.projectId === id || v.projectId === ''));
  openModal(`<form id="projForm" data-id="${id || ''}">${modalHead(id ? 'ویرایش برنامه' : 'برنامهٔ جدید')}
    <div class="body">
      <div class="field"><label>نام برنامه</label><input type="text" name="name" value="${esc(p.name)}" required placeholder="مثلاً: فروشگاه آنلاین"></div>
      <div class="field"><label>توضیح کوتاه</label><input type="text" name="desc" value="${esc(p.desc)}"></div>
      <div class="field"><label>رنگ</label><div class="swatches">${COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${p.color === c ? 'checked' : ''}><span style="--c:${c}"></span></label>`).join('')}</div></div>
      ${folderField('پوشهٔ مخزن git (روی همین کامپیوتر)', 'repoPath', p.repoPath, 'C:\\Projects\\my-app')}
      <div class="field"><label>محیط‌ها و آدرس‌ها (برای پایش سلامت و SSL)</label><div id="envRows" class="stack-sm">${(p.envs.length ? p.envs : [{}]).map(envRow).join('')}</div><button type="button" class="btn sm" data-action="row-add" style="justify-self:start">${I.plus}محیط</button></div>
      <div class="two"><div class="field"><label>مخزن GitHub برای CI (owner/repo)</label><input type="text" name="ciRepo" value="${esc(p.ci.repo)}" dir="ltr" placeholder="owner/repo"></div>
        <div class="field"><label>توکن GitHub (از گاوصندوق)</label><select name="ciToken"><option value="">— بدون توکن —</option>${tokens.map(t => `<option value="${t.id}" ${p.ci.tokenId === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></div></div>
      <div class="field"><label>یادداشت</label><textarea name="notes">${esc(p.notes)}</textarea></div>
    </div>${footerBtns(id ? `<button type="button" class="btn danger" data-action="del-project" data-id="${id}">${I.trash}حذف از برنامه</button>` : '')}</form>`);
}

function deployModal(did) {
  const p = proj(V.pid), d = did ? p.deploys.find(x => x.id === did) : { name: '', command: '', shell: 'cmd', cwd: '', branch: 'main', envId: '', envSpec: '', noHealth: false };
  openModal(`<form id="deployForm" data-pid="${p.id}" data-id="${did || ''}">${modalHead(did ? 'ویرایش استقرار' : 'تعریف استقرار')}
    <div class="body">
      <div class="two"><div class="field"><label>نام</label><input type="text" name="name" value="${esc(d.name)}" required placeholder="Production"></div>
        <div class="field"><label>محیط مقصد</label><select name="envId"><option value="">—</option>${p.envs.map(e => `<option value="${e.id}" ${d.envId === e.id ? 'selected' : ''}>${esc(e.name || e.url)}</option>`).join('')}</select></div></div>
      <div class="field"><label>دستور</label><textarea name="command" dir="ltr" style="min-height:80px;font-family:Consolas,monospace" required>${esc(d.command)}</textarea>
        <div class="row">${TEMPLATES.map((t, i) => `<button type="button" class="btn sm" data-action="tpl" data-i="${i}">${t.t}</button>`).join('')}</div></div>
      <div class="two"><div class="field"><label>شاخهٔ مورد انتظار (برای هشدار پیش از اجرا)</label><input type="text" name="branch" value="${esc(d.branch)}" dir="ltr"></div>
        <div class="field"><label>مفسر دستور</label>${shellSel(d.shell)}</div></div>
      ${folderField('پوشهٔ اجرا (پیش‌فرض: پوشهٔ مخزن)', 'cwd', d.cwd, '')}
      <div class="field"><label>متغیرهای محیطی (${ENV_HINT})</label><textarea name="envSpec" dir="ltr" style="min-height:60px;font-family:Consolas,monospace" placeholder="DB_PASSWORD=@db-prod">${esc(d.envSpec)}</textarea></div>
      <label class="chk"><input type="checkbox" name="health" ${d.noHealth ? '' : 'checked'}> بعد از استقرار موفق، سلامت سایت محیط مقصد را بررسی کن</label>
    </div>${footerBtns(did ? `<button type="button" class="btn danger" data-action="deploy-del" data-id="${did}">${I.trash}حذف</button>` : '')}</form>`);
}

function backupModal(bid) {
  const p = proj(V.pid), b = bid ? p.backups.find(x => x.id === bid) : { name: '', type: 'folder', source: p.repoPath, destDir: '', command: '', shell: 'cmd', cwd: '', exclude: 'node_modules,.git', keep: 7, everyHours: 24, envSpec: '' };
  openModal(`<form id="backupForm" data-pid="${p.id}" data-id="${bid || ''}">${modalHead(bid ? 'ویرایش بک‌آپ' : 'تعریف بک‌آپ')}
    <div class="body">
      <div class="two"><div class="field"><label>نام (در نام فایل‌ها می‌آید)</label><input type="text" name="name" value="${esc(b.name)}" required placeholder="files"></div>
        <div class="field"><label>نوع</label><select name="type"><option value="folder" ${b.type === 'folder' ? 'selected' : ''}>فشرده‌سازی یک پوشه (zip)</option><option value="command" ${b.type === 'command' ? 'selected' : ''}>دستور سفارشی (دیتابیس و ...)</option></select></div></div>
      <div class="bk-folder">${folderField('پوشهٔ مبدأ', 'source', b.source, '')}
        <div class="field" style="margin-top:12px"><label>استثناها (با ویرگول)</label><input type="text" name="exclude" value="${esc(b.exclude)}" dir="ltr"></div></div>
      <div class="bk-cmd"><div class="field"><label>دستور بک‌آپ</label><textarea name="command" dir="ltr" style="min-height:70px;font-family:Consolas,monospace" placeholder='mysqldump -u root mydb > "%BACKUP_DIR%\\%BACKUP_PREFIX%-%BACKUP_STAMP%.sql"'>${esc(b.command)}</textarea>
        <div class="sub">خروجی باید با نام <code>%BACKUP_DIR%\\%BACKUP_PREFIX%-%BACKUP_STAMP%.ext</code> ساخته شود تا نگهداری نسخه‌ها کار کند.</div></div>
        <div class="two" style="margin-top:12px"><div class="field"><label>مفسر</label>${shellSel(b.shell)}</div><div></div></div>
        ${folderField('پوشهٔ اجرا (اختیاری)', 'cwd', b.cwd, '')}</div>
      ${folderField('پوشهٔ مقصد بک‌آپ', 'destDir', b.destDir, 'D:\\Backups\\my-app')}
      <div class="two"><div class="field"><label>تعداد نسخهٔ نگه‌داری‌شده (۰ = همه)</label><input type="number" name="keep" min="0" value="${b.keep}"></div>
        <div class="field"><label>اجرای خودکار هر چند ساعت (۰ = دستی)</label><input type="number" name="everyHours" min="0" value="${b.everyHours}"></div></div>
      <div class="field"><label>متغیرهای محیطی (${ENV_HINT})</label><textarea name="envSpec" dir="ltr" style="min-height:50px;font-family:Consolas,monospace" placeholder="MYSQL_PWD=@db-prod">${esc(b.envSpec)}</textarea></div>
    </div>${footerBtns(bid ? `<button type="button" class="btn danger" data-action="backup-del" data-id="${bid}">${I.trash}حذف</button>` : '')}</form>`);
  syncBackupType();
}
function syncBackupType() {
  const f = $('#backupForm');
  if (!f) return;
  const t = f.elements.type.value;
  f.querySelector('.bk-folder').hidden = t !== 'folder';
  f.querySelector('.bk-cmd').hidden = t !== 'command';
}

function vaultModal(id) {
  const v = id ? C.vault.find(x => x.id === id) : { label: '', kind: 'server', projectId: V.name === 'project' ? V.pid : '', username: '', url: '', notes: '', expires: '', hasSecret: false };
  openModal(`<form id="vaultForm" data-id="${id || ''}">${modalHead(id ? 'ویرایش مورد' : 'مورد جدید در گاوصندوق')}
    <div class="body">
      <div class="two"><div class="field"><label>برچسب</label><input type="text" name="label" value="${esc(v.label)}" required placeholder="db-prod"></div>
        <div class="field"><label>نوع</label><select name="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${v.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="field"><label>متعلق به</label><select name="projectId"><option value="">— عمومی —</option>${S.projects.map(p => `<option value="${p.id}" ${v.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="two"><div class="field"><label>نام کاربری</label><input type="text" name="username" value="${esc(v.username)}" dir="ltr"></div>
        <div class="field"><label>آدرس / میزبان</label><input type="text" name="url" value="${esc(v.url)}" dir="ltr"></div></div>
      <div class="field"><label>رمز / توکن ${id ? '(خالی = بدون تغییر)' : ''}</label>
        <div class="folder-row"><input type="password" name="secret" dir="ltr" autocomplete="new-password" placeholder="${v.hasSecret ? '••••••••' : ''}"><button type="button" class="btn" data-action="v-toggle">${I.eye}</button><button type="button" class="btn" data-action="v-gen">تولید</button></div></div>
      <div class="field"><label>تاریخ انقضا یا تعویض (اختیاری؛ ۳۰ روز قبل هشدار می‌دهد)</label>${dateField('expires', v.expires)}</div>
      <div class="field"><label>یادداشت</label><textarea name="notes">${esc(v.notes)}</textarea></div>
    </div>${footerBtns(id ? `<button type="button" class="btn danger" data-action="v-del" data-id="${id}">${I.trash}حذف</button>` : '')}</form>`);
}

function pwModal() {
  openModal(`<form id="pwForm">${modalHead('تغییر رمز اصلی')}
    <div class="body">
      <div class="field"><label>رمز فعلی</label><input type="password" name="op" autocomplete="off"></div>
      <div class="field"><label>رمز اصلی جدید (دست‌کم ۸ نویسه)</label><input type="password" name="np" autocomplete="new-password"></div>
      <div class="field"><label>تکرار رمز جدید</label><input type="password" name="np2" autocomplete="new-password"></div>
      <div class="sub">با تغییر رمز، همهٔ اطلاعات با کلید جدید دوباره رمزنگاری می‌شود. رمز قابل بازیابی نیست.</div>
      <div class="err" id="formErr"></div></div>${footerBtns()}</form>`, { small: true });
}

function branchModal() {
  const p = proj(V.pid), gd = C.gd[p.id], g = C.git[p.id];
  const locals = ((gd && gd.br.branches) || []).filter(b => !b.isRemote);
  openModal(`<form id="branchForm">${modalHead('شاخهٔ جدید')}
    <div class="body"><div class="field"><label>نام شاخه</label><input type="text" name="name" dir="ltr" required placeholder="feature/my-change"></div>
      <div class="field"><label>ساخت از روی</label><select name="from"><option value="">شاخهٔ فعلی (${esc(g.branch)})</option>${locals.filter(b => !b.current).map(b => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('')}</select></div></div>
    ${footerBtns().replace('ذخیره', 'بساز')}</form>`, { small: true });
}
function tagModal() {
  openModal(`<form id="tagForm">${modalHead('تگ جدید روی شاخهٔ فعلی')}
    <div class="body"><div class="field"><label>نام تگ</label><input type="text" name="name" dir="ltr" required placeholder="v1.2.0"></div>
      <div class="field"><label>پیام</label><input type="text" name="message" placeholder="انتشار نسخهٔ ۱٫۲٫۰"></div>
      <label class="chk"><input type="checkbox" name="push" checked> بعد از ساخت به ریموت هم ارسال شود</label></div>
    ${footerBtns().replace('ذخیره', 'بساز')}</form>`, { small: true });
}
