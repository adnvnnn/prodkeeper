'use strict';

/* ======================= Daily routines: database updates and publishing to a folder =======================
 * Each routine (p.ops) is a command that runs from a button and is logged in the history; the "done today" state comes from that history.
 * Database update (type=db): asks for confirmation before running and can first take one of the app's backups.
 * Publish (type=publish): the command writes its output to %PUBLISH_DIR%; versioned mode creates a fresh subfolder every time. */
const OP_TYPES = {
  db: { kind: 'dbupdate', label: 'Database update', icon: I.db },
  publish: { kind: 'publish', label: 'Publish to folder', icon: I.folder },
};
const OP_TEMPLATES = {
  db: [
    { t: 'EF Core', cmd: 'dotnet ef database update' },
    { t: 'EF Core with projects', cmd: 'dotnet ef database update --project src\\Data --startup-project src\\Web' },
    { t: 'Prisma', cmd: 'npx prisma migrate deploy' },
    { t: 'Laravel', cmd: 'php artisan migrate --force' },
    { t: 'Flyway', cmd: 'flyway migrate' },
    { t: 'SQL Server script', cmd: 'sqlcmd -S . -d MyDb -i scripts\\update.sql -b' },
  ],
  publish: [
    { t: 'dotnet publish', cmd: 'dotnet publish -c Release -o "%PUBLISH_DIR%"' },
    { t: 'dotnet publish (x64)', cmd: 'dotnet publish -c Release -r win-x64 --self-contained false -o "%PUBLISH_DIR%"' },
    { t: 'npm build + copy', cmd: 'npm ci && npm run build && xcopy dist "%PUBLISH_DIR%\\" /E /I /Y /Q' },
  ],
};

const opDoneToday = o => { const h = S.history.find(x => x.refId === o.id && x.status === 'ok'); return !!h && toISO(new Date(h.start)) === todayISO(); };
const opLastRun = o => lastRun(o.id, OP_TYPES[o.type].kind);

function opStatusChip(o) {
  const r = opLastRun(o);
  if (isRunning(o.id)) return chip('Running…', 'soon');
  if (r && r.status === 'fail') return chip('Last run failed', 'late');
  return opDoneToday(o) ? chip('Done today', 'okc', I.tick) : chip('Not yet today', 'today');
}

/** One daily routine row; used both in the app overview and on the dashboard */
function dailyRow(p, o, showProject) {
  const r = opLastRun(o), run = isRunning(o.id), T = OP_TYPES[o.type];
  return `<div class="trow" style="cursor:default"><span class="tt">${showProject ? `<span class="sub">${esc(p.name)} ·</span> ` : ''}<b>${esc(o.name)}</b> ${chip(T.label, '', T.icon)}</span>
    ${opStatusChip(o)}${r && !opDoneToday(o) ? `<span class="sub">${ago(r.start)}</span>` : ''}
    <button class="btn sm primary" data-action="op-run" data-pid="${p.id}" data-id="${o.id}" ${run ? 'disabled' : ''}>${I.play}${run ? 'Running…' : 'Run'}</button></div>`;
}
function dailyCardLine(p) {
  const done = p.ops.filter(opDoneToday).length;
  return chip(`${num(done)} of ${num(p.ops.length)} today`, done === p.ops.length ? 'okc' : 'today');
}
function dailyDashCard() {
  const projects = orderedProjects().filter(p => p.ops.length);
  if (!projects.length) return '';
  const left = projects.reduce((n, p) => n + p.ops.filter(o => !opDoneToday(o)).length, 0);
  return `<div class="card section" style="margin-bottom:18px"><h2>${I.clock}Today's routines ${left ? '' : chip('All done', 'okc')}</h2>
    ${projects.map(p => p.ops.map(o => dailyRow(p, o, true)).join('')).join('')}</div>`;
}

function opCard(p, o) {
  const r = opLastRun(o), run = isRunning(o.id), T = OP_TYPES[o.type];
  const cwd = o.cwd || p.repoPath;
  return `<div class="card section">
    <div class="row between"><h2 style="margin:0">${T.icon}${esc(o.name)} ${opStatusChip(o)}${o.type === 'publish' && o.versioned ? chip('Versioned', 'soon') : ''}</h2>
      <div class="row">${o.type === 'publish' && o.destDir ? `<button class="iconbtn" data-action="open-folder" data-path="${esc((r && r.file) || o.destDir)}" title="Open output folder">${I.folder}</button>` : ''}
        <button class="iconbtn" data-action="op-edit" data-pid="${p.id}" data-id="${o.id}" title="Edit">${I.edit}</button>
        <button class="btn primary" data-action="op-run" data-pid="${p.id}" data-id="${o.id}" ${run ? 'disabled' : ''}>${I.play}${run ? 'Running…' : o.type === 'db' ? 'Update' : 'Publish'}</button></div></div>
    <code class="cmd">${esc(o.command)}</code>
    <div class="sub" style="margin-top:8px">${o.type === 'publish' ? `Destination: <code>${esc(o.destDir)}</code>${o.versioned ? ` · keeping ${o.keep ? 'last ' + num(o.keep) + ' versions' : 'all'}` : ''} · ` : ''}${cwd ? `Runs in <code>${esc(cwd)}</code>` : 'No working folder'}</div>
    <div class="sub" style="margin-top:4px">${r ? `Last run: ${runChip(r)} ${ago(r.start)}${dur(r)}${r.size ? ' · ' + fmtSize(r.size) : ''}` : 'Never run'}</div></div>`;
}

function tabDaily(p) {
  const section = type => {
    const T = OP_TYPES[type], list = p.ops.filter(o => o.type === type);
    return `<div class="page-head" style="margin-top:${type === 'db' ? 0 : 20}px"><h2 style="margin:0;display:flex;align-items:center;gap:8px">${T.icon}${T.label}</h2><span class="grow"></span>
        <button class="btn primary" data-action="op-new" data-pid="${p.id}" data-type="${type}">${I.plus}Add ${T.label}</button></div>
      ${list.length ? `<div class="stack">${list.map(o => opCard(p, o)).join('')}</div>`
        : notSet(`No ${T.label} defined yet`, `<p class="sub">${type === 'db' ? 'Define the update command (e.g. <code>dotnet ef database update</code>) to run it in one click, with a backup taken first.' : 'Define the publish command (e.g. <code>dotnet publish -o "%PUBLISH_DIR%"</code>) and the destination folder.'}</p>`)}`;
  };
  const hist = S.history.filter(h => h.projectId === p.id && (h.kind === 'dbupdate' || h.kind === 'publish')).slice(0, 8);
  return `<div class="page-head" style="margin-top:0"><span class="sub">Chores you do on this app every day; each runs in one click, is logged in the history and shows as "Done today" on the dashboard.</span></div>
    ${section('db')}${section('publish')}
    ${hist.length ? `<div class="card section" style="margin-top:16px"><h2>Recent history</h2>${hist.map(histRow).join('')}</div>` : ''}`;
}

function opModal(pid, type, oid) {
  const p = proj(pid), o = oid ? p.ops.find(x => x.id === oid) : { type, name: '', command: '', shell: 'cmd', cwd: '', envSpec: '', backupId: '', destDir: '', versioned: false, keep: 5, openAfter: true };
  type = o.type;
  const T = OP_TYPES[type];
  openModal(`<form id="opForm" data-pid="${p.id}" data-id="${oid || ''}" data-type="${type}">${modalHead(oid ? `Edit ${T.label}` : `Add ${T.label}`)}
    <div class="body">
      <div class="two"><div class="field"><label>Name${type === 'publish' ? ' (also used in versioned folder names)' : ''}</label><input type="text" name="name" value="${esc(o.name)}" required placeholder="${type === 'db' ? 'Production DB' : 'Web'}"></div>
        <div class="field"><label>Shell</label>${shellSel(o.shell)}</div></div>
      <div class="field"><label>Command</label><textarea name="command" dir="ltr" style="min-height:80px;font-family:Consolas,monospace" required>${esc(o.command)}</textarea>
        <div class="row">${OP_TEMPLATES[type].map((t, i) => `<button type="button" class="btn sm" data-action="optpl" data-type="${type}" data-i="${i}">${t.t}</button>`).join('')}</div>
        ${type === 'publish' ? '<div class="sub">Write the output to <code>%PUBLISH_DIR%</code> (in PowerShell: <code>$env:PUBLISH_DIR</code>). The variables <code>PUBLISH_STAMP</code> and <code>PUBLISH_NAME</code> are also available.</div>' : ''}</div>
      ${type === 'publish' ? `${folderField('Publish destination folder', 'destDir', o.destDir, 'D:\\Publish\\my-app')}
        <label class="chk"><input type="checkbox" name="versioned" ${o.versioned ? 'checked' : ''}> Publish into a fresh subfolder each time (name-date-time)</label>
        <div class="two"><div class="field"><label>Versions to keep in versioned mode (0 = all)</label><input type="number" name="keep" min="0" value="${o.keep}"></div>
          <div class="field"><label>&nbsp;</label><label class="chk"><input type="checkbox" name="openAfter" ${o.openAfter ? 'checked' : ''}> Open the folder after success</label></div></div>`
      : `<div class="field"><label>Backup before the update (if it fails, the update does not run)</label><select name="backupId"><option value="">— No backup —</option>${p.backups.map(b => `<option value="${b.id}" ${o.backupId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
          ${p.backups.length ? '' : '<div class="sub">First define a backup (e.g. mysqldump) in the "Backup" tab.</div>'}</div>`}
      ${folderField('Working folder (default: repository folder)', 'cwd', o.cwd, '')}
      <div class="field"><label>Environment variables (${ENV_HINT})</label><textarea name="envSpec" dir="ltr" style="min-height:50px;font-family:Consolas,monospace" placeholder="ConnectionStrings__Default=@db-prod">${esc(o.envSpec)}</textarea></div>
    </div>${footerBtns(oid ? `<button type="button" class="btn danger" data-action="op-del" data-pid="${p.id}" data-id="${oid}">${I.trash}Delete</button>` : '')}</form>`);
}

function opSpec(p, o) {
  const spec = { command: o.command, shell: o.shell, cwd: o.cwd || p.repoPath || '', envSpec: o.envSpec || '' };
  if (o.type === 'publish') spec.publish = { name: o.name, destDir: o.destDir, versioned: !!o.versioned, keep: o.keep };
  return spec;
}
const runOp = (p, o) => runJob({ pid: p.id, kind: OP_TYPES[o.type].kind, refId: o.id, title: `${OP_TYPES[o.type].label}: ${o.name}`, spec: opSpec(p, o) });

/** Database update: if selected, takes a backup first and only continues if it succeeds */
async function runDbUpdate(p, o, withBackup) {
  const b = withBackup && p.backups.find(x => x.id === o.backupId);
  if (b) {
    toast(`Backup "${b.name}" before the update…`);
    const bh = await runBackup(p, b, true);
    if (!bh || bh.status !== 'ok') return toast('The pre-update backup failed; the database update did not run', true);
  }
  return runOp(p, o);
}

function dbConfirm(p, o) {
  const b = p.backups.find(x => x.id === o.backupId);
  openModal(`<header><span>Database update "${esc(o.name)}" — ${esc(p.name)}</span><button class="iconbtn" data-action="close">${I.x}</button></header>
    <div class="body">${b ? `<label class="chk"><input type="checkbox" id="opBackup" checked> Take backup "${esc(b.name)}" first (if the backup fails, the update does not run)</label>`
      : `<div class="check-item warn">${I.alert}<span>No pre-update backup is defined; this change will be applied without a backup copy.</span></div>`}
      <code class="cmd">${esc(o.command)}</code></div>
    <footer><button class="btn ${b ? 'primary' : 'danger'}" data-action="op-go" data-pid="${p.id}" data-id="${o.id}">Run update</button><span class="grow"></span><button class="btn" data-action="close">Cancel</button></footer>`, { small: true });
}

Object.assign(actions, {
  'op-new': el => opModal(el.dataset.pid, el.dataset.type),
  'op-edit': el => opModal(el.dataset.pid, '', el.dataset.id),
  'op-run': async el => {
    const p = proj(el.dataset.pid), o = p.ops.find(x => x.id === el.dataset.id);
    if (o.type === 'db') return dbConfirm(p, o);
    const h = await runOp(p, o);
    if (h && h.status === 'ok' && o.openAfter && h.file) native.shell.openFolder(h.file);
  },
  'op-go': el => {
    const p = proj(el.dataset.pid), o = p.ops.find(x => x.id === el.dataset.id), box = $('#opBackup');
    const withBackup = !box || box.checked;
    closeModal();
    runDbUpdate(p, o, withBackup);
  },
  'op-del': async el => {
    if (!(await askConfirm('Delete this daily routine? (Output files are not deleted)'))) return;
    const p = proj(el.dataset.pid);
    p.ops = p.ops.filter(x => x.id !== el.dataset.id);
    save(); closeModal(); render();
  },
  optpl: el => { document.querySelector('#opForm [name=command]').value = OP_TEMPLATES[el.dataset.type][el.dataset.i].cmd; },
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.id !== 'opForm') return;
  e.preventDefault();
  const fd = new FormData(f), p = proj(f.dataset.pid), type = f.dataset.type;
  const data = { type, name: String(fd.get('name')).trim(), command: String(fd.get('command')).trim(), shell: fd.get('shell'), cwd: String(fd.get('cwd')).trim(), envSpec: String(fd.get('envSpec')).trim() };
  if (!data.name || !data.command) return;
  if (type === 'db') data.backupId = String(fd.get('backupId') || '');
  else {
    Object.assign(data, { destDir: String(fd.get('destDir')).trim(), versioned: !!fd.get('versioned'), keep: Math.max(0, Math.round(Number(fd.get('keep')) || 0)), openAfter: !!fd.get('openAfter') });
    if (!data.destDir) return toast('Set the publish destination folder', true);
  }
  if (f.dataset.id) Object.assign(p.ops.find(x => x.id === f.dataset.id), data); else p.ops.push({ id: uid(), ...data });
  save(); closeModal(); render(); toast('Saved');
});
