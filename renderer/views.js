'use strict';

const chip = (text, cls = '', icon = '') => `<span class="chip ${cls}">${icon}${text}</span>`;
const TABS = [['overview', 'Overview', I.grid], ['daily', 'Daily routines', I.clock], ['tasks', 'Tasks', I.tick], ['status', 'Live status', I.globe], ['git', 'Git & branches', I.branch], ['deploy', 'Deploy', I.deploy], ['backup', 'Backup', I.db], ['ci', 'CI/CD', I.activity], ['vault', 'Vault', I.key]];
const TEMPLATES = [
  { t: 'SSH + git pull + pm2', cmd: 'ssh user@host "cd /var/www/app && git pull && npm ci --omit=dev && pm2 restart app"' },
  { t: 'Docker Compose on a server', cmd: 'ssh user@host "cd /srv/app && docker compose pull && docker compose up -d"' },
  { t: 'Build and copy with scp', cmd: 'npm ci && npm run build && scp -r dist/* user@host:/var/www/app/' },
  { t: 'npm run deploy', cmd: 'npm run deploy' },
];
const lastOfProject = (p, kind) => S.history.find(h => h.projectId === p.id && h.kind === kind && h.status !== 'running');
const dur = h => (h.end ? ' · ' + fmtSec((h.end - h.start) / 1000) : '');
const notSet = (msg, btn) => `<div class="empty card">${I.alert}<h3>${msg}</h3>${btn || ''}</div>`;

/* ---------- Chrome: minimal top menu ---------- */
const NAV_ITEMS = [['dashboard', 'Dashboard'], ['tasks', 'Tasks'], ['history', 'History'], ['vault', 'Vault'], ['settings', 'Settings']];
function renderTopbar() {
  const A = computeAlerts(), bad = A.filter(a => a.sev === 'bad').length;
  const p = V.name === 'project' && proj(V.pid);
  $('#nav').innerHTML = NAV_ITEMS.map(([name, label]) => `<button class="nav ${V.name === name ? 'active' : ''}" data-action="go" data-to="${name}">${label}</button>`).join('')
    + (p ? `<span class="crumb"><span class="sdot ${projSeverity(p.id)}"></span>${esc(p.name)}</span>` : '');
  $('#bellBox').innerHTML = `<button class="tbtn ${A.length ? 'alerting' : ''}" data-action="bell" title="Alerts">${I.bell}${A.length ? `<span class="badge ${bad ? 'bad' : ''}">${num(A.length)}</span>` : ''}</button>
    ${V.bell ? `<div class="bellpanel"><div class="bellhead">Alerts</div>
      <div class="bellbody">${A.length ? A.map(a => alertRow(a)).join('') : `<div class="okline">${I.tick}Nothing needs attention.</div>`}</div></div>` : ''}`;
  const n = Object.keys(RUN).length;
  $('#runBox').innerHTML = n ? `<button class="btn sm" data-action="run-open"><span class="rec"></span>Running</button>` : '';
}

/* ---------- Dashboard ---------- */
function alertRow(a, hideName) {
  const act = a.pid ? `data-action="open-project" data-id="${a.pid}" data-tab="${a.tab}"` : 'data-action="go" data-to="vault"';
  return `<div class="alert ${a.sev}" ${act}>${I.alert}${hideName ? '' : `<b>${esc(a.name)}</b>`}<span${hideName ? ' style="color:var(--text)"' : ''}>${esc(a.text)}</span></div>`;
}
function viewDashboard() {
  if (!S.projects.length) {
    return `<div class="empty card" style="margin-top:20px">${I.deploy.replace('<svg', '<svg style="width:40px;height:40px"')}
      <h3>Add your first app</h3>
      <p>Give each app its git repository, site URL, deploy command, backup and CI, and run everything from one place. Secrets stay encrypted in the vault.</p>
      <button class="btn primary" data-action="new-project">${I.plus}Add app</button></div>`;
  }
  const list = orderedProjects(), AL = computeAlerts();
  // when there is more than one priority level, each group gets a heading
  const grouped = new Set(list.map(p => p.priority)).size > 1;
  let body;
  if (grouped) {
    body = [2, 1, 0].filter(k => list.some(p => p.priority === k)).map(k => `<div class="group">${T_PRIO[k]} priority</div><div class="apps">${list.filter(p => p.priority === k).map(p => prow(p, AL)).join('')}</div>`).join('');
  } else body = `<div class="apps">${list.map(p => prow(p, AL)).join('')}</div>`;
  return `
    <div class="page-head"><h1>Apps</h1><span class="grow"></span>
      <button class="btn" data-action="refresh-all" title="Re-check all apps">${I.refresh}Refresh</button>
      <button class="btn primary" data-action="new-project">${I.plus}New app</button></div>
    ${dailyDashCard()}
    ${body}`;
}
function ciChip(p) {
  const c = C.ci[p.id];
  if (!c) return '';
  if (c.error) return chip('CI: error', 'today');
  const r = c.runs && c.runs[0];
  return r ? `<span title="${esc(r.name)}">${ciBadge(r)}</span>` : '';
}
const SEV_LABEL = { ok: 'Healthy', warn: 'Attention', bad: 'Critical', none: '' };
/** One app: loud only when something is wrong, otherwise quiet */
function prow(p, AL) {
  const g = C.git[p.id], sev = projSeverity(p.id), mine = AL.filter(a => a.pid === p.id);
  const line = mine.length ? esc(mine[0].text) + (mine.length > 1 ? ` <span class="sub">and ${num(mine.length - 1)} more</span>` : '')
    : sev === 'none' ? (p.repoPath || p.envs.length ? 'Checking…' : 'Not configured') : `Operational${g && !g.error ? ' · ' + esc(g.branch) : ''}`;
  const envs = p.envs.map(e => { const h = C.health[e.id]; return `<span class="${h && !h.ok ? 'down' : ''}"><span class="sdot ${h ? (h.ok ? 'ok' : 'bad') : ''}"></span><bdi>${esc(e.name || e.url)}</bdi></span>`; }).join('');
  const dep = lastOfProject(p, 'deploy');
  return `<div class="app sev-${sev}" data-action="open-project" data-id="${p.id}" draggable="true" data-dnd="project" data-axis="y" data-did="${p.id}">
    <div><div class="an">${esc(p.name)}</div><div class="al">${line}</div></div>
    <div class="ae">${envs}</div>
    <div class="at">${dep ? `Deployed ${ago(dep.start)}` : ''}</div></div>`;
}
function ciBadge(r) {
  if (r.status !== 'completed') return chip(r.status === 'queued' ? 'Queued' : 'Running', 'soon');
  const m = { success: ['okc', 'Success'], failure: ['late', 'Failed'], cancelled: ['today', 'Cancelled'], skipped: ['', 'Skipped'], timed_out: ['late', 'Timed out'] }[r.conclusion] || ['', r.conclusion || '—'];
  return chip(m[1], m[0]);
}

/* ---------- Project page ---------- */
function viewProject() {
  const p = proj(V.pid);
  if (!p) { V.name = 'dashboard'; return viewDashboard(); }
  const tabs = { overview: tabOverview, daily: tabDaily, tasks: tabTasks, status: tabStatus, git: tabGit, deploy: tabDeploy, backup: tabBackup, ci: tabCI, vault: p => vaultSection(p.id, false) };
  return `
    <div class="page-head"><h1>${esc(p.name)}</h1>
      ${SEV_LABEL[projSeverity(p.id)] ? `<span class="st ${projSeverity(p.id)}">${SEV_LABEL[projSeverity(p.id)]}</span>` : ''}
      ${chip(`<span class="pdot p${p.priority}"></span>${T_PRIO[p.priority]} priority`, '')}
      <span class="grow"></span>
      <button class="btn" data-action="refresh-project">${I.refresh}Refresh</button>
      ${p.repoPath ? `<button class="btn" data-action="open-folder" data-path="${esc(p.repoPath)}">${I.folder}Folder</button>` : ''}
      <button class="btn" data-action="edit-project" data-id="${p.id}">${I.edit}Edit</button></div>
    <div class="tabs">${TABS.map(([k, l, ic]) => `<button class="${V.tab === k ? 'on' : ''}" data-action="set-tab" data-tab="${k}">${ic}${l}</button>`).join('')}</div>
    ${(tabs[V.tab] || tabOverview)(p)}`;
}

function tabOverview(p) {
  const A = computeAlerts().filter(a => a.pid === p.id);
  const g = C.git[p.id], ci = C.ci[p.id];
  const gitTile = !p.repoPath ? `<div class="sub">Repository path is not set.</div>` : !g ? '<div class="sub">Checking…</div>' : g.error ? `<div class="sub">${esc(g.error)}</div>`
    : `<div class="row">${chip(esc(g.branch), '', I.branch)}${g.upstream ? `<span class="sub">← ${esc(g.upstream)}</span>` : chip('No upstream', 'today')}${g.dirty ? chip(`${num(g.dirty)} changed`, 'today') : ''}${g.ahead ? chip(num(g.ahead), 'soon', I.up) : ''}${g.behind ? chip(num(g.behind), 'today', I.down) : ''}</div>
      ${g.last ? `<div class="sub" style="margin-top:6px">${esc(g.last.hash)} · ${esc(g.last.subject)} <span class="sub">(${ago(g.last.ts)})</span></div>` : ''}
      <div class="row" style="margin-top:10px"><button class="btn sm" data-action="git-fetch" data-id="${p.id}">Fetch</button><button class="btn sm" data-action="git-pull" data-id="${p.id}">Pull</button></div>`;
  const envTile = p.envs.length ? p.envs.map(e => {
    const h = C.health[e.id];
    return `<div class="trow" style="cursor:default"><span class="tt"><b><bdi>${esc(e.name)}</bdi></b> <a class="lnk" data-action="open-url" data-url="${esc(e.url)}">${esc(e.url)}</a></span>
      ${h ? (h.ok ? chip(`HTTP ${num(h.status)} · ${num(h.ms)}ms`, 'okc') : chip(esc(h.error || (h.keywordOk === false ? 'Expected text was missing' : 'HTTP ' + h.status)), 'late')) : ''}${h && h.certDays != null ? chip(`SSL ${num(h.certDays)} days`, h.certDays <= 14 ? 'today' : '') : ''}
      <button class="iconbtn" data-action="env-check" data-id="${e.id}" title="Check now">${I.refresh}</button></div>`;
  }).join('') : '<div class="sub">Add the environment URLs (production/staging) in the project editor to monitor their health.</div>';
  const depTile = p.deploys.length ? p.deploys.map(d => { const r = lastRun(d.id, 'deploy'); return `<div class="trow" style="cursor:default"><span class="tt">${esc(d.name)}</span>${r ? runChip(r) + `<span class="sub">${ago(r.start)}</span>` : ''}<button class="btn sm" data-action="open-project" data-id="${p.id}" data-tab="deploy">Open</button></div>`; }).join('') : '<div class="sub">No deploy defined yet.</div>';
  const bakTile = p.backups.length ? p.backups.map(b => { const r = lastRun(b.id, 'backup'); return `<div class="trow" style="cursor:default"><span class="tt">${esc(b.name)}</span>${r ? runChip(r) + `<span class="sub">${ago(r.start)}</span>` : chip('Never run', 'today')}<button class="btn sm" data-action="backup-run" data-id="${b.id}">${I.play}Run now</button></div>`; }).join('') : '<div class="sub">No backup defined yet.</div>';
  const ciTile = !p.ci.repo ? '<div class="sub">GitHub repository is not set.</div>' : !ci ? '<div class="sub">Checking…</div>' : ci.error ? `<div class="sub">${esc(ci.error)}</div>`
    : (ci.runs.slice(0, 3).map(r => `<div class="trow" data-action="open-url" data-url="${esc(r.url)}"><span class="tt">${esc(r.name)} <span class="sub">${esc(r.branch)}</span></span>${ciBadge(r)}</div>`).join('') || '<div class="sub">No runs recorded.</div>');
  const tile = (title, icon, tab, body) => `<div class="card section"><h2>${icon}${title}<span class="grow"></span><button class="btn sm" data-action="set-tab" data-tab="${tab}">Details</button></h2>${body}</div>`;
  return `
    ${A.length ? `<div class="card section" style="margin-bottom:16px">${A.map(a => alertRow(a, true)).join('')}</div>` : ''}
    <div class="cols2">
      <div class="stack">${p.ops.length ? tile('Daily routines', I.clock, 'daily', p.ops.map(o => dailyRow(p, o)).join('')) : ''}${tile('Git', I.branch, 'git', gitTile)}${tile('Deploy', I.deploy, 'deploy', depTile)}${tile('Backup', I.db, 'backup', bakTile)}</div>
      <div class="stack"><div class="card section"><h2>${I.globe}Environments and health</h2>${envTile}</div>${tile('CI/CD', I.activity, 'ci', ciTile)}</div>
    </div>`;
}

/* ---------- Git ---------- */
function tabGit(p) {
  if (!p.repoPath) return notSet('The git repository path is not set for this app', `<button class="btn primary" data-action="edit-project" data-id="${p.id}">Set path</button>`);
  const g = C.git[p.id];
  if (!g) return '<div class="empty card">Loading…</div>';
  if (g.error) return notSet(esc(g.error), `<button class="btn" data-action="edit-project" data-id="${p.id}">Edit path</button>`);
  const gd = C.gd[p.id];
  const head = `<div class="card section" style="margin-bottom:16px">
    <div class="row between"><div class="row"><b style="font-size:17px">${I.branch.replace('<svg', '<svg style="vertical-align:-3px"')} ${esc(g.branch)}</b>
      ${g.upstream ? `<span class="sub">← ${esc(g.upstream)}${g.gone ? ' (deleted on the remote)' : ''}</span>` : chip('No upstream', 'today')}
      ${g.ahead ? chip(`${num(g.ahead)} unpushed`, 'soon', I.up) : ''}${g.behind ? chip(`${num(g.behind)} behind remote`, 'today', I.down) : ''}${g.dirty ? chip(`${num(g.dirty)} changed`, 'today') : chip('Clean', 'okc')}</div>
      <div class="row"><button class="btn sm" data-action="git-fetch" data-id="${p.id}">${I.refresh}Fetch</button><button class="btn sm" data-action="git-pull" data-id="${p.id}">${I.down}Pull</button>
      ${g.ahead || !g.upstream ? `<button class="btn sm primary" data-action="git-push" data-id="${p.id}">${I.up}Push</button>` : ''}<button class="btn sm" data-action="git-new-branch">${I.plus}New branch</button></div></div>
    ${g.remote ? `<div class="sub" style="margin-top:6px;direction:ltr;text-align:left">${esc(g.remote)}</div>` : ''}
    ${g.dirty ? `<details style="margin-top:10px"><summary>Changed files (${num(g.dirty)})</summary><div class="files">${g.files.map(f => `<div><code>${esc(f.xy)}</code> ${esc(f.path)}</div>`).join('')}${g.dirty > g.files.length ? '<div class="sub">…</div>' : ''}</div></details>` : ''}</div>`;
  if (!gd) return head + '<div class="empty card">Loading branches…</div>';

  const br = gd.br.branches || [];
  const rows = br.filter(b => V.bfilter === 'merged' ? b.merged && !b.current : V.bfilter === 'remote' ? b.isRemote : true)
    .sort((a, b) => (b.current - a.current) || b.date - a.date);
  const brRow = b => `<div class="trow brow" style="cursor:default">
    <span class="tt"><b>${esc(b.name)}</b>
      ${b.current ? chip('Current', 'okc') : ''}${b.isRemote ? chip('Remote only', '') : ''}${b.merged ? chip('Merged', 'soon') : ''}${b.gone ? chip('Deleted on remote', 'today') : ''}${!b.isRemote && !b.upstream ? chip('Local only', 'today') : ''}
      ${b.ahead ? chip(num(b.ahead), 'soon', I.up) : ''}${b.behind ? chip(num(b.behind), 'today', I.down) : ''}
      <div class="sub" style="font-size:12px">${esc(b.subject)} · ${esc(b.author)} · ${ago(b.date)}</div></span>
    ${b.current ? '' : b.isRemote
      ? `<button class="btn sm" data-action="git-checkout" data-name="${esc(b.name)}" data-remote="1">Checkout</button><button class="iconbtn" title="Delete from remote" data-action="git-del-remote" data-name="${esc(b.name)}">${I.trash}</button>`
      : `<button class="btn sm" data-action="git-checkout" data-name="${esc(b.name)}">Checkout</button><button class="btn sm" title="Merge into the current branch" data-action="git-merge" data-name="${esc(b.name)}">${I.merge}Merge</button><button class="iconbtn" title="Delete branch" data-action="git-del" data-name="${esc(b.name)}">${I.trash}</button>`}</div>`;
  const mergedCount = br.filter(b => b.merged && !b.current).length;
  const commits = (gd.lg.commits || []).map(c => `<div class="trow" style="cursor:default"><code>${esc(c.hash)}</code><span class="tt">${esc(c.subject)}${c.refs ? ` <span class="sub">(${esc(c.refs)})</span>` : ''}</span><span class="sub">${esc(c.author)} · ${ago(c.ts)}</span></div>`).join('');
  const tags = (gd.tg.tags || []).map(t => `<div class="trow" style="cursor:default">${I.tag}<b>${esc(t.name)}</b><span class="tt sub">${esc(t.subject || '')}</span><span class="sub">${ago(t.ts)}</span><button class="btn sm" data-action="git-tag-push" data-name="${esc(t.name)}">Push</button></div>`).join('');
  return head + `
    <div class="card section" style="margin-bottom:16px"><h2>Branches <span class="grow"></span>
      <div class="seg"><button class="${V.bfilter === 'all' ? 'on' : ''}" data-action="bfilter" data-v="all">All (${num(br.length)})</button><button class="${V.bfilter === 'merged' ? 'on' : ''}" data-action="bfilter" data-v="merged">Merged — can be cleaned up (${num(mergedCount)})</button><button class="${V.bfilter === 'remote' ? 'on' : ''}" data-action="bfilter" data-v="remote">Remote only</button></div></h2>
      ${gd.br.error ? `<div class="sub">${esc(gd.br.error)}</div>` : rows.map(brRow).join('') || '<div class="empty" style="padding:20px">No branches</div>'}</div>
    <div class="cols2"><div class="card section"><h2>Recent commits</h2>${commits || '<div class="sub">—</div>'}</div>
      <div class="card section"><h2>Tags (releases) <span class="grow"></span><button class="btn sm" data-action="git-tag-new">${I.plus}New tag</button></h2>${tags || '<div class="sub">No tags</div>'}</div></div>`;
}

/* ---------- Deploy ---------- */
function tabDeploy(p) {
  const hist = S.history.filter(h => h.projectId === p.id && h.kind === 'deploy').slice(0, 8);
  const cards = p.deploys.map(d => {
    const r = lastRun(d.id, 'deploy'), env = p.envs.find(e => e.id === d.envId), run = isRunning(d.id);
    return `<div class="card section">
      <div class="row between"><h2 style="margin:0">${I.deploy}${esc(d.name)} ${env ? chip(esc(env.name), 'soon', I.globe) : ''}${d.branch ? chip(esc(d.branch), '', I.branch) : ''}</h2>
        <div class="row"><button class="iconbtn" data-action="deploy-edit" data-id="${d.id}" title="Edit">${I.edit}</button><button class="btn primary" data-action="deploy-run" data-id="${d.id}" ${run ? 'disabled' : ''}>${I.play}${run ? 'Running…' : 'Deploy'}</button></div></div>
      <code class="cmd">${esc(d.command)}</code>
      <div class="sub" style="margin-top:8px">${r ? `Last run: ${runChip(r)} ${ago(r.start)}${dur(r)}` : 'Never run'}</div></div>`;
  }).join('');
  return `<div class="page-head" style="margin-top:0"><span class="sub">Your deploy commands; git and CI status are checked and shown before running.</span><span class="grow"></span><button class="btn primary" data-action="deploy-new">${I.plus}Add deploy</button></div>
    ${cards ? `<div class="stack">${cards}</div>` : notSet('No deploy defined yet', `<p class="sub">Define a command (e.g. ssh + git pull + restart) to run and log it in one click.</p>`)}
    ${hist.length ? `<div class="card section" style="margin-top:16px"><h2>Deploy history</h2>${hist.map(histRow).join('')}</div>` : ''}`;
}

/* ---------- Backup ---------- */
function tabBackup(p) {
  const cards = p.backups.map(b => {
    const r = lastRun(b.id, 'backup'), run = isRunning(b.id), files = (C.backups[b.id] && C.backups[b.id].files) || [];
    return `<div class="card section">
      <div class="row between"><h2 style="margin:0">${I.db}${esc(b.name)} ${chip(b.type === 'folder' ? 'Folder → zip' : 'Custom command', '')}${b.everyHours > 0 ? chip(`Every ${num(b.everyHours)} h`, 'soon', I.clock) : chip('Manual', '')}</h2>
        <div class="row"><button class="iconbtn" data-action="open-folder" data-path="${esc(b.destDir)}" title="Open destination folder">${I.folder}</button><button class="iconbtn" data-action="backup-edit" data-id="${b.id}" title="Edit">${I.edit}</button>
        <button class="btn primary" data-action="backup-run" data-id="${b.id}" ${run ? 'disabled' : ''}>${I.play}${run ? 'Running…' : 'Back up now'}</button></div></div>
      <div class="sub" style="margin:6px 0">${b.type === 'folder' ? esc(b.source) + ' → ' : ''}<code>${esc(b.destDir)}</code> · keeping ${b.keep ? 'last ' + num(b.keep) + ' copies' : 'all'}</div>
      <div class="sub">${r ? `Last run: ${runChip(r)} ${ago(r.start)}${dur(r)}${r.size ? ' · ' + fmtSize(r.size) : ''}` : 'Never run'}</div>
      ${files.length ? `<details style="margin-top:10px" open><summary>Existing files (${num(files.length)})</summary><div class="files">${files.slice(0, 8).map(f => `<div class="row between"><code>${esc(f.name)}</code><span class="sub">${fmtSize(f.size)} · ${ago(f.ts)}</span></div>`).join('')}</div></details>` : ''}</div>`;
  }).join('');
  const hist = S.history.filter(h => h.projectId === p.id && h.kind === 'backup').slice(0, 8);
  return `<div class="page-head" style="margin-top:0"><span class="sub">Scheduled backups only run while the app is open. Be sure to test a restore at least once.</span><span class="grow"></span><button class="btn primary" data-action="backup-new">${I.plus}Add backup</button></div>
    ${cards ? `<div class="stack">${cards}</div>` : notSet('No backup defined yet', `<p class="sub">You can zip a folder or store the output of a command such as mysqldump / pg_dump.</p>`)}
    ${hist.length ? `<div class="card section" style="margin-top:16px"><h2>Backup history</h2>${hist.map(histRow).join('')}</div>` : ''}`;
}

/* ---------- CI/CD ---------- */
function tabCI(p) {
  if (!p.ci.repo) return notSet('The GitHub repository for CI is not set', `<p class="sub">In the project editor enter the repository as <code>owner/repo</code> (filled in automatically if your remote is on GitHub).</p><button class="btn primary" data-action="edit-project" data-id="${p.id}">Edit project</button>`);
  const c = C.ci[p.id], wf = C.wf[p.id], g = C.git[p.id];
  const tokenInfo = p.ci.tokenId ? chip('With token', 'okc', I.key) : chip('No token (public repositories only)', 'today');
  const runs = c && c.runs ? c.runs.map(r => `<div class="trow" style="cursor:default">${ciBadge(r)}
    <span class="tt"><b>${esc(r.name)}</b> <span class="sub">${esc(r.title)}</span><div class="sub" style="font-size:12px">${chip(esc(r.branch || ''), '', I.branch)} ${esc(r.event)} · ${esc(r.actor || '')} · ${ago(r.started)}${r.status === 'completed' ? ' · ' + fmtSec((r.updated - r.started) / 1000) : ''}</div></span>
    ${r.status !== 'completed' ? `<button class="btn sm" data-action="ci-cancel" data-id="${r.id}">Cancel</button>` : `<button class="btn sm" data-action="ci-rerun" data-id="${r.id}" data-failed="${r.conclusion === 'failure' ? 1 : 0}">Re-run${r.conclusion === 'failure' ? ' (failed jobs)' : ''}</button>`}
    <button class="iconbtn" data-action="open-url" data-url="${esc(r.url)}" title="Open on GitHub">${I.ext}</button></div>`).join('') : '';
  const dispatch = wf && wf.workflows && wf.workflows.length ? `<div class="card section" style="margin-bottom:16px"><h2>Run a workflow manually</h2>
    <div class="row"><select id="wfSel">${wf.workflows.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>
    <input type="text" id="wfRef" value="${esc((g && g.branch) || (g && g.default) || 'main')}" dir="ltr" style="width:180px" placeholder="branch">
    <button class="btn primary" data-action="ci-dispatch">${I.play}Run</button></div>
    <div class="sub" style="margin-top:6px">Only workflows that have <code>workflow_dispatch</code> can be run manually. The token needs <code>actions:write</code> access.</div></div>` : '';
  return `<div class="page-head" style="margin-top:0"><b>${esc(p.ci.repo)}</b>${tokenInfo}<span class="grow"></span>
      <button class="btn" data-action="open-url" data-url="https://github.com/${esc(p.ci.repo)}/actions">${I.ext}GitHub Actions</button><button class="btn" data-action="ci-refresh">${I.refresh}Refresh</button></div>
    ${dispatch}
    <div class="card section"><h2>Recent runs</h2>${!c ? '<div class="sub">Loading…</div>' : c.error ? `<div class="alert bad">${I.alert}<span>${esc(c.error)}</span></div>` : runs || '<div class="sub">No runs recorded yet</div>'}</div>`;
}

/* ---------- History ---------- */
function histRow(h) {
  const p = proj(h.projectId), kind = { deploy: 'Deploy', backup: 'Backup', dbupdate: 'Database update', publish: 'Publish', git: 'Git' }[h.kind] || h.kind;
  return `<div class="trow" data-action="log-open" data-id="${h.id}">${runChip(h)}<span class="tt">${esc(h.title)}</span>
    ${p ? chip(esc(p.name), '') : ''}<span class="sub">${fmtTs(h.start)}${dur(h)}</span></div>`;
}
function viewHistory() {
  let list = S.history.filter(h => (!V.hKind || h.kind === V.hKind) && (!V.hProj || h.projectId === V.hProj));
  const sel = (k, opts, val) => `<select data-hf="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="page-head"><h1>Operation history</h1><span class="sub">${num(list.length)} ${list.length === 1 ? 'entry' : 'entries'}</span><span class="grow"></span><button class="btn danger" data-action="hist-clear">Clear</button></div>
    <div class="filters">${sel('hKind', [['', 'All types'], ['deploy', 'Deploy'], ['backup', 'Backup'], ['dbupdate', 'Database update'], ['publish', 'Publish'], ['git', 'Git']], V.hKind)}
    ${sel('hProj', [['', 'All apps'], ...S.projects.map(p => [p.id, p.name])], V.hProj)}</div>
    <div class="card section">${list.length ? list.slice(0, 150).map(histRow).join('') : '<div class="empty">No operations recorded yet</div>'}</div>`;
}

/* ---------- Vault ---------- */
function vaultSection(pid, global) {

  const list = C.vault.filter(v => global ? (!V.vProj || v.projectId === (V.vProj === '-' ? '' : V.vProj)) : v.projectId === pid || v.projectId === '');
  const banner = `<div class="sub" style="margin-bottom:10px">${I.lock.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"')} All items are encrypted with your master password and AES-256, and are only decrypted in memory when shown, copied or used in a command.</div>`;
  const row = v => {
    const p = proj(v.projectId), d = v.expires ? diffDays(v.expires) : null;
    return `<div class="trow vrow" style="cursor:default">
      ${chip(KINDS[v.kind] || v.kind, 'soon')}
      <span class="tt"><b>${esc(v.label)}</b> ${global && p ? chip(esc(p.name), '') : ''}${!p ? chip('Global', '') : ''}
        <div class="sub" style="font-size:12px">${v.username ? `${esc(v.username)} · ` : ''}${v.url ? `<a class="lnk" data-action="open-url" data-url="${esc(v.url)}">${esc(v.url)}</a>` : ''}</div></span>
      ${d != null ? chip(d < 0 ? 'Expired' : `Expires in ${num(d)} days`, d < 0 ? 'late' : d <= 30 ? 'today' : '', I.cal) : ''}
      <code class="secret" data-secret="${v.id}">${v.hasSecret ? '••••••••••' : '—'}</code>
      ${v.hasSecret ? `<button class="iconbtn" data-action="v-reveal" data-id="${v.id}" title="Show / hide the secret (hides automatically after 15 seconds)">${I.eye}</button><button class="iconbtn" data-action="v-copy" data-id="${v.id}" title="Copy secret">${I.copy}</button>` : ''}
      <button class="iconbtn" data-action="v-edit" data-id="${v.id}" title="Edit">${I.edit}</button></div>`;
  };
  const filter = global ? `<select data-hf="vProj"><option value="">All apps</option><option value="-" ${V.vProj === '-' ? 'selected' : ''}>Global</option>${S.projects.map(p => `<option value="${p.id}" ${V.vProj === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : '';
  return `${global ? `<div class="page-head"><h1>Password vault</h1>${filter}<span class="grow"></span><button class="btn primary" data-action="v-new">${I.plus}New item</button></div>` : `<div class="page-head" style="margin-top:0"><span class="sub">Secrets for this app and global items</span><span class="grow"></span><button class="btn primary" data-action="v-new">${I.plus}New item</button></div>`}
    ${banner}<div class="card section">${list.length ? list.map(row).join('') : `<div class="empty">${I.key}<h3>The vault is empty</h3><p>Keep server, database, token and key secrets here. You can use them in deploy and backup commands as <code>NAME=@label</code>.</p></div>`}</div>`;
}
const viewVault = () => vaultSection('', true);

/* ---------- Settings ---------- */
function viewSettings() {
  const th = S.settings.theme, al = S.settings.autoLockMin;
  const opt = (arr, cur) => arr.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="page-head"><h1>Settings</h1></div>
    <div class="set-grid">
      <div class="card"><h2>Appearance</h2><div class="seg">${[['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button class="${th === v ? 'on' : ''}" data-action="theme" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="card"><h2>${I.lock.replace('<svg', '<svg style="vertical-align:-3px"')} Security and master password</h2>
        <p class="sub">All data (projects, commands, logs and secrets) is encrypted on disk with <b>AES-256-GCM</b>. The key is derived from your master password with scrypt, is stored nowhere and is wiped from memory on lock. Tampering with the files is also detected.</p>
        <div class="row"><button class="btn primary" data-action="lock-now">${I.lock}Lock now</button><button class="btn" data-action="pw-change">Change master password</button></div>
        <div class="field" style="margin-top:14px"><label>Auto-lock after inactivity</label>
          <select data-setting="autoLockMin" style="max-width:220px">${opt([[0, 'Never'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']], al)}</select></div></div>
      <div class="card"><h2>Health monitoring</h2><p class="sub">How often should sites (and git) be checked automatically?</p>
        <select data-setting="healthMin">${opt([[0, 'Off'], [1, 'Every 1 minute'], [5, 'Every 5 minutes'], [15, 'Every 15 minutes'], [60, 'Every hour']], S.settings.healthMin)}</select></div>
      <div class="card"><h2>${I.clock}Background and reminders</h2>
        <p class="sub">When the window is closed the app stays next to the Windows clock (tray) and monitoring and notifications continue. Global show/hide shortcut: <b>Ctrl+Alt+W</b></p>
        <label class="row" style="gap:8px;margin:6px 0"><input type="checkbox" data-pref="keepRunning" id="prefKeep"> Closing the window keeps the app running in the background</label>
        <label class="row" style="gap:8px;margin:6px 0"><input type="checkbox" data-pref="autoStart" id="prefAuto"> Start automatically with Windows (built portable version only)</label>
        <label class="row" style="gap:8px;margin:6px 0"><input type="checkbox" data-setting="notifyOn" ${S.settings.notifyOn ? 'checked' : ''}> Windows notifications for critical alerts and reminders</label>
        <div class="two" style="margin-top:10px"><div class="field"><label>Remind about daily routines from</label><input type="time" data-setting="dailyAt" value="${esc(S.settings.dailyAt || '')}" style="max-width:160px"></div>
          <div class="field"><label>Repeat the reminder until done</label><select data-setting="nagMin">${opt([[0, 'Only once'], [30, 'Every 30 minutes'], [60, 'Every hour'], [120, 'Every 2 hours']], S.settings.nagMin)}</select></div></div></div>
      <div class="card"><h2>Encrypted backup</h2>
        <p class="sub">The backup file contains all your data and secrets, <b>but fully encrypted</b>, and opens on any computer only with your master password. A daily automatic (encrypted) copy is also kept in the data folder.</p>
        <div class="row"><button class="btn primary" data-action="export">Save backup</button><button class="btn" data-action="import">Restore from file</button></div></div>
      <div class="card"><h2>System information</h2><p class="sub" style="margin:0">Data folder: <code id="dataPath">…</code></p><p class="sub" style="margin:6px 0 0">Git: <code id="gitVer">…</code></p>
        <p class="sub" style="margin:10px 0 0">This app sends no data to any third-party server; it only makes requests to the URLs you define and to GitHub (for CI).</p></div>
    </div>`;
}
async function fillSettings() {
  const dp = $('#dataPath'), gv = $('#gitVer');
  if (dp) dp.textContent = await native.data.path();
  const pr = await native.app.prefs();
  if ($('#prefKeep')) $('#prefKeep').checked = pr.keepRunning;
  if ($('#prefAuto')) { $('#prefAuto').checked = pr.autoStart; $('#prefAuto').disabled = !pr.packaged; }
  const r = await native.git('version', '');
  if (gv) gv.textContent = r.version || r.error || '—';
}

/* ======================= Edit dialogs ======================= */
const envRow = e => `<div class="envrow" data-id="${esc(e.id || '')}">
  <div class="row1"><input type="text" name="name" value="${esc(e.name || '')}" placeholder="production" style="width:34%"><input type="text" name="url" value="${esc(e.url || '')}" dir="ltr" placeholder="https://example.com"><button type="button" class="iconbtn" data-action="row-del">${I.x}</button></div>
  <details ${e.checkUrl || e.expect || e.keyword || e.headers || (e.method && e.method !== 'GET') ? 'open' : ''}><summary>Monitoring request settings (optional)</summary>
    <div class="two" style="margin-top:8px"><input type="text" name="checkUrl" value="${esc(e.checkUrl || '')}" dir="ltr" placeholder="Health URL, e.g. https://example.com/health">
      <select name="method">${['GET', 'HEAD', 'POST'].map(m => `<option ${((e.method || 'GET') === m) ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
    <div class="two" style="margin-top:8px"><input type="text" name="expect" value="${esc(e.expect || '')}" dir="ltr" placeholder="Expected status code (e.g. 200)"><input type="text" name="keyword" value="${esc(e.keyword || '')}" dir="ltr" placeholder="Expected text in the response"></div>
    <textarea name="headers" dir="ltr" style="margin-top:8px;min-height:50px;font-family:Consolas,monospace;width:100%" placeholder="Authorization: Bearer @api-token">${esc(e.headers || '')}</textarea>
  </details></div>`;

/* ---------- Live status ---------- */
function flatJson(o, prefix = '', out = [], depth = 0) {
  if (out.length >= 16) return out;
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v)) out.push([prefix + k, `[${v.length} items]`]);
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
  return `<div class="spark">${arr.map(c => `<i class="${c.ok ? '' : 'bad'}" style="height:${c.ok ? Math.max(10, Math.round((c.ms / max) * 100)) : 100}%" title="${fmtTs(c.t)} · ${c.ok ? num(c.ms) + 'ms' : 'failed'}"></i>`).join('')}</div>`;
}
function uptimePct(id) {
  const a = S.checks[id] || [];
  return a.length ? Math.round((a.filter(c => c.ok).length / a.length) * 1000) / 10 : null;
}
function tabStatus(p) {
  const envs = p.envs.filter(e => e.url || e.checkUrl);
  const cards = envs.map(e => {
    const r = C.health[e.id], up = uptimePct(e.id), target = e.checkUrl || e.url;
    const badge = !r ? chip('Not checked', '') : r.ok ? chip('Healthy', 'okc') : chip('Has problems', 'late');
    const metrics = !r ? '<div class="sub">No request has been sent yet.</div>' : `
      <div class="metrics">
        <div><span>Status code</span><b class="${r.ok ? 'g' : 'r'}">${r.status ? 'HTTP ' + num(r.status) : '—'}</b><small>${esc(r.statusText || r.error || '')}</small></div>
        <div><span>Response time</span><b>${r.ms != null ? num(r.ms) + ' ms' : '—'}</b>${r.total ? `<small>Total: ${num(r.total)}ms</small>` : ''}</div>
        <div><span>Uptime (${num((S.checks[e.id] || []).length)} checks)</span><b class="${up >= 99 ? 'g' : up >= 90 ? '' : 'r'}">${up == null ? '—' : num(up) + '%'}</b></div>
        <div><span>SSL certificate</span><b class="${r.certDays != null && r.certDays <= 14 ? 'r' : ''}">${r.certDays != null ? num(r.certDays) + ' days' : '—'}</b></div>
        <div><span>Response size</span><b>${r.size != null ? fmtSize(r.size) : '—'}</b></div>
        <div><span>Last check</span><b style="font-size:13px">${ago(r.at)}</b></div>
      </div>
      ${r.keywordOk === false ? `<div class="alert bad" style="cursor:default">${I.alert}<span>The text "${esc(e.keyword)}" was not found in the response.</span></div>` : ''}
      ${r.error ? `<div class="alert bad" style="cursor:default">${I.alert}<span>${esc(r.error)}</span></div>` : ''}
      ${r.json !== undefined ? `<div class="jgrid">${flatJson(r.json).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v.length > 60 ? v.slice(0, 60) + '…' : v)}</b></div>`).join('')}</div>` : ''}
      ${sparkHtml(e.id)}`;
    return `<div class="card section">
      <div class="row between"><h2 style="margin:0">${I.globe}<bdi>${esc(e.name || target)}</bdi> ${badge}${chip(esc((e.method || 'GET') + (e.expect ? ' → ' + e.expect : '')), '')}</h2>
        <div class="row"><button class="btn sm" data-action="env-check" data-id="${e.id}">${I.refresh}Send request</button><button class="btn sm" data-action="env-full" data-id="${e.id}" data-name="${esc(e.name || '')}" ${r ? '' : 'disabled'}>Full response</button></div></div>
      <div style="margin:6px 0 10px"><a class="lnk" data-action="open-url" data-url="${esc(target)}">${esc(target)}</a></div>
      ${metrics}</div>`;
  }).join('');
  return `<div class="page-head" style="margin-top:0"><span class="sub">The app sends requests automatically (per the monitoring setting) and you see the result here; if the response is JSON its fields are shown too.</span><span class="grow"></span>
    <button class="btn" data-action="req-new">${I.term}Custom request</button><button class="btn primary" data-action="refresh-project">${I.refresh}Send all requests</button></div>
    ${cards ? `<div class="stack">${cards}</div>` : notSet('No monitoring URL defined', `<p class="sub">In the project editor enter the environment URLs (and, if needed, the /health URL, headers and expected status code).</p><button class="btn primary" data-action="edit-project" data-id="${p.id}">Edit project</button>`)}`;
}

function formatResponse(r) {
  if (r.error && !r.status) return `✗ ${r.error}`;
  const head = `${r.method || 'GET'} ${r.finalUrl || ''}\nHTTP ${r.status} ${r.statusText || ''}  ·  ${r.ms}ms  ·  ${fmtSize(r.size)}${r.truncated ? ' (truncated)' : ''}\n\n`;
  const hdrs = Object.entries(r.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  let body = r.body || '';
  if (r.json !== undefined) { try { body = JSON.stringify(r.json, null, 2); } catch { /* keep the plain text */ } }
  return `${head}${hdrs}\n\n${body}`;
}
function showResponse(title, r) {
  openModal(`<header><span>${esc(title)}</span><button class="iconbtn" data-action="close">${I.x}</button></header>
    <div class="body"><pre class="console">${esc(formatResponse(r))}</pre></div><footer><span class="grow"></span><button class="btn" data-action="close">Close</button></footer>`, { wide: true });
}
function requestModal() {
  const p = proj(V.pid), e = p.envs.find(x => x.url || x.checkUrl) || {};
  openModal(`<form id="reqForm">${modalHead('Send a custom request')}
    <div class="body">
      <div class="folder-row"><select name="method" style="width:110px">${['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map(m => `<option>${m}</option>`).join('')}</select><input type="text" name="url" dir="ltr" value="${esc(e.checkUrl || e.url || '')}" placeholder="https://example.com/api/status"></div>
      <div class="field"><label>Headers (one Name: value per line — for secrets: <code>Authorization: Bearer @label</code>)</label><textarea name="headers" dir="ltr" style="min-height:56px;font-family:Consolas,monospace"></textarea></div>
      <div class="field"><label>Request body (for POST/PUT/PATCH)</label><textarea name="body" dir="ltr" style="min-height:56px;font-family:Consolas,monospace"></textarea></div>
      <pre class="console" id="reqOut" style="height:30vh">The response is shown here.</pre></div>
    <footer><button class="btn primary">${I.play}Send</button><span class="grow"></span><button type="button" class="btn" data-action="close">Close</button></footer></form>`, { wide: true });
}
async function sendRequest(f) {
  const method = f.elements.method.value;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !(await askConfirm(`Send a ${method} request to ${f.elements.url.value}? It may change data.`, 'Send', false))) return;
  const out = $('#reqOut');
  out.textContent = 'Sending…';
  const r = await native.net.check({ url: f.elements.url.value.trim(), method, headers: f.elements.headers.value, body: f.elements.body.value, projectId: V.pid, full: true });
  out.textContent = formatResponse(r);
}
const footerBtns = (delAttr) => `<footer>${delAttr || ''}<span class="grow"></span><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary">Save</button></footer>`;
const modalHead = t => `<header><span>${t}</span><button type="button" class="iconbtn" data-action="close">${I.x}</button></header>`;
const folderField = (label, name, val, ph) => `<div class="field"><label>${label}</label><div class="folder-row"><input type="text" name="${name}" value="${esc(val || '')}" dir="ltr" placeholder="${ph || ''}"><button type="button" class="btn" data-action="pick-folder" data-target="${name}">Browse…</button></div></div>`;
const shellSel = v => `<select name="shell"><option value="cmd" ${v !== 'powershell' ? 'selected' : ''}>cmd</option><option value="powershell" ${v === 'powershell' ? 'selected' : ''}>PowerShell</option></select>`;
const ENV_HINT = 'one per line: NAME=@vault-label  or  NAME=value';

function projectModal(id) {
  const p = id ? proj(id) : normProject({ name: '' });
  const tokens = C.vault.filter(v => v.hasSecret && (v.projectId === id || v.projectId === ''));
  openModal(`<form id="projForm" data-id="${id || ''}">${modalHead(id ? 'Edit app' : 'New app')}
    <div class="body">
      <div class="field"><label>App name</label><input type="text" name="name" value="${esc(p.name)}" required placeholder="e.g. Online store"></div>
      <div class="field"><label>App priority (display order on the dashboard and menu)</label><select name="priority">${T_PRIO.map((l, i) => `<option value="${i}" ${p.priority === i ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${folderField('Git repository folder (on this computer)', 'repoPath', p.repoPath, 'C:\\Projects\\my-app')}
      <div class="field"><label>Environments and URLs (for health and SSL monitoring)</label><div id="envRows" class="stack-sm">${(p.envs.length ? p.envs : [{}]).map(envRow).join('')}</div><button type="button" class="btn sm" data-action="row-add" style="justify-self:start">${I.plus}Environment</button></div>
      <div class="two"><div class="field"><label>GitHub repository for CI (owner/repo)</label><input type="text" name="ciRepo" value="${esc(p.ci.repo)}" dir="ltr" placeholder="owner/repo"></div>
        <div class="field"><label>GitHub token (from the vault)</label><select name="ciToken"><option value="">— No token —</option>${tokens.map(t => `<option value="${t.id}" ${p.ci.tokenId === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></div></div>
    </div>${footerBtns(id ? `<button type="button" class="btn danger" data-action="del-project" data-id="${id}">${I.trash}Remove from app</button>` : '')}</form>`);
}

function deployModal(did) {
  const p = proj(V.pid), d = did ? p.deploys.find(x => x.id === did) : { name: '', command: '', shell: 'cmd', cwd: '', branch: 'main', envId: '', envSpec: '', noHealth: false };
  openModal(`<form id="deployForm" data-pid="${p.id}" data-id="${did || ''}">${modalHead(did ? 'Edit deploy' : 'Add deploy')}
    <div class="body">
      <div class="two"><div class="field"><label>Name</label><input type="text" name="name" value="${esc(d.name)}" required placeholder="Production"></div>
        <div class="field"><label>Target environment</label><select name="envId"><option value="">—</option>${p.envs.map(e => `<option value="${e.id}" ${d.envId === e.id ? 'selected' : ''}>${esc(e.name || e.url)}</option>`).join('')}</select></div></div>
      <div class="field"><label>Command</label><textarea name="command" dir="ltr" style="min-height:80px;font-family:Consolas,monospace" required>${esc(d.command)}</textarea>
        <div class="row">${TEMPLATES.map((t, i) => `<button type="button" class="btn sm" data-action="tpl" data-i="${i}">${t.t}</button>`).join('')}</div></div>
      <div class="two"><div class="field"><label>Expected branch (warns before running)</label><input type="text" name="branch" value="${esc(d.branch)}" dir="ltr"></div>
        <div class="field"><label>Shell</label>${shellSel(d.shell)}</div></div>
      ${folderField('Working folder (default: repository folder)', 'cwd', d.cwd, '')}
      <div class="field"><label>Environment variables (${ENV_HINT})</label><textarea name="envSpec" dir="ltr" style="min-height:60px;font-family:Consolas,monospace" placeholder="DB_PASSWORD=@db-prod">${esc(d.envSpec)}</textarea></div>
      <label class="chk"><input type="checkbox" name="health" ${d.noHealth ? '' : 'checked'}> After a successful deploy, check the health of the target environment's site</label>
    </div>${footerBtns(did ? `<button type="button" class="btn danger" data-action="deploy-del" data-id="${did}">${I.trash}Delete</button>` : '')}</form>`);
}

function backupModal(bid) {
  const p = proj(V.pid), b = bid ? p.backups.find(x => x.id === bid) : { name: '', type: 'folder', source: p.repoPath, destDir: '', command: '', shell: 'cmd', cwd: '', exclude: 'node_modules,.git', keep: 7, everyHours: 24, envSpec: '' };
  openModal(`<form id="backupForm" data-pid="${p.id}" data-id="${bid || ''}">${modalHead(bid ? 'Edit backup' : 'Add backup')}
    <div class="body">
      <div class="two"><div class="field"><label>Name (used in file names)</label><input type="text" name="name" value="${esc(b.name)}" required placeholder="files"></div>
        <div class="field"><label>Type</label><select name="type"><option value="folder" ${b.type === 'folder' ? 'selected' : ''}>Compress a folder (zip)</option><option value="command" ${b.type === 'command' ? 'selected' : ''}>Custom command (database, etc.)</option></select></div></div>
      <div class="bk-folder">${folderField('Source folder', 'source', b.source, '')}
        <div class="field" style="margin-top:12px"><label>Exclusions (comma-separated)</label><input type="text" name="exclude" value="${esc(b.exclude)}" dir="ltr"></div></div>
      <div class="bk-cmd"><div class="field"><label>Backup command</label><textarea name="command" dir="ltr" style="min-height:70px;font-family:Consolas,monospace" placeholder='mysqldump -u root mydb > "%BACKUP_DIR%\\%BACKUP_PREFIX%-%BACKUP_STAMP%.sql"'>${esc(b.command)}</textarea>
        <div class="sub">The output must be named <code>%BACKUP_DIR%\\%BACKUP_PREFIX%-%BACKUP_STAMP%.ext</code> so that retention of old copies works.</div></div>
        <div class="two" style="margin-top:12px"><div class="field"><label>Shell</label>${shellSel(b.shell)}</div><div></div></div>
        ${folderField('Working folder (optional)', 'cwd', b.cwd, '')}</div>
      ${folderField('Backup destination folder', 'destDir', b.destDir, 'D:\\Backups\\my-app')}
      <div class="two"><div class="field"><label>Copies to keep (0 = all)</label><input type="number" name="keep" min="0" value="${b.keep}"></div>
        <div class="field"><label>Run automatically every N hours (0 = manual)</label><input type="number" name="everyHours" min="0" value="${b.everyHours}"></div></div>
      <div class="field"><label>Environment variables (${ENV_HINT})</label><textarea name="envSpec" dir="ltr" style="min-height:50px;font-family:Consolas,monospace" placeholder="MYSQL_PWD=@db-prod">${esc(b.envSpec)}</textarea></div>
    </div>${footerBtns(bid ? `<button type="button" class="btn danger" data-action="backup-del" data-id="${bid}">${I.trash}Delete</button>` : '')}</form>`);
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
  openModal(`<form id="vaultForm" data-id="${id || ''}">${modalHead(id ? 'Edit item' : 'New vault item')}
    <div class="body">
      <div class="two"><div class="field"><label>Label</label><input type="text" name="label" value="${esc(v.label)}" required placeholder="db-prod"></div>
        <div class="field"><label>Type</label><select name="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${v.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="field"><label>Belongs to</label><select name="projectId"><option value="">— Global —</option>${S.projects.map(p => `<option value="${p.id}" ${v.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="two"><div class="field"><label>Username</label><input type="text" name="username" value="${esc(v.username)}" dir="ltr"></div>
        <div class="field"><label>URL / host</label><input type="text" name="url" value="${esc(v.url)}" dir="ltr"></div></div>
      <div class="field"><label>Secret / token ${id ? '(empty = unchanged)' : ''}</label>
        <div class="folder-row"><input type="password" name="secret" dir="ltr" autocomplete="new-password" placeholder="${v.hasSecret ? '••••••••' : ''}"><button type="button" class="btn" data-action="v-toggle">${I.eye}</button><button type="button" class="btn" data-action="v-gen">Generate</button></div></div>
      <div class="field"><label>Expiry or rotation date (optional; warns 30 days before)</label>${dateField('expires', v.expires)}</div>
      <div class="field"><label>Notes</label><textarea name="notes">${esc(v.notes)}</textarea></div>
    </div>${footerBtns(id ? `<button type="button" class="btn danger" data-action="v-del" data-id="${id}">${I.trash}Delete</button>` : '')}</form>`);
}

function pwModal() {
  openModal(`<form id="pwForm">${modalHead('Change master password')}
    <div class="body">
      <div class="field"><label>Current password</label><input type="password" name="op" autocomplete="off"></div>
      <div class="field"><label>New master password (at least 8 characters)</label><input type="password" name="np" autocomplete="new-password"></div>
      <div class="field"><label>Repeat new password</label><input type="password" name="np2" autocomplete="new-password"></div>
      <div class="sub">Changing the password re-encrypts all data with the new key. The password cannot be recovered.</div>
      <div class="err" id="formErr"></div></div>${footerBtns()}</form>`, { small: true });
}

function branchModal() {
  const p = proj(V.pid), gd = C.gd[p.id], g = C.git[p.id];
  const locals = ((gd && gd.br.branches) || []).filter(b => !b.isRemote);
  openModal(`<form id="branchForm">${modalHead('New branch')}
    <div class="body"><div class="field"><label>Branch name</label><input type="text" name="name" dir="ltr" required placeholder="feature/my-change"></div>
      <div class="field"><label>Create from</label><select name="from"><option value="">Current branch (${esc(g.branch)})</option>${locals.filter(b => !b.current).map(b => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('')}</select></div></div>
    ${footerBtns().replace('Save', 'Create')}</form>`, { small: true });
}
function tagModal() {
  openModal(`<form id="tagForm">${modalHead('New tag on the current branch')}
    <div class="body"><div class="field"><label>Tag name</label><input type="text" name="name" dir="ltr" required placeholder="v1.2.0"></div>
      <div class="field"><label>Message</label><input type="text" name="message" placeholder="Release 1.2.0"></div>
      <label class="chk"><input type="checkbox" name="push" checked> Also push to the remote after creating</label></div>
    ${footerBtns().replace('Save', 'Create')}</form>`, { small: true });
}
