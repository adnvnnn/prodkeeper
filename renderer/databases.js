'use strict';

/* ======================= Databases tab =======================
 * A database is defined once here and everything about it hangs off its card.
 * Stored as before, so deploys, alerts, history and reports keep working:
 *   - the connection string is a Database item in the Vault (url = "server/database", username = login, so the card can show them without decrypting)
 *   - its backup is a p.backups entry of type "database" with dbId = the vault item
 *   - its update is a p.ops entry of type "db" with dbId = the vault item
 * SQL Server only (sqlcmd). */
const DB_TEST = {}; // vault id -> { ok, message, ts, busy }

/** Databases of a project: its own Database vault items, plus global ones that its backups or updates still point to */
function dbList(p) {
  const used = new Set([...p.backups, ...p.ops].map(x => x.dbId).filter(Boolean));
  return C.vault.filter(v => v.kind === 'db' && (v.projectId === p.id || used.has(v.id)));
}
const dbBackupOf = (p, v) => p.backups.find(b => b.type === 'database' && b.dbId === v.id);
const dbUpdateOf = (p, v) => p.ops.find(o => o.type === 'db' && o.dbId === v.id);
const dbBackupIds = p => new Set(p.backups.filter(b => b.type === 'database').map(b => b.id));

function parseCs(cs) {
  const kv = {};
  for (const part of String(cs || '').split(';')) { const i = part.indexOf('='); if (i > 0) kv[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim(); }
  const integrated = /^(true|yes|sspi)$/i.test(kv.trusted_connection || kv['integrated security'] || '');
  return {
    server: kv.server || kv['data source'] || kv.address || kv.addr || kv['network address'] || '',
    database: kv.database || kv['initial catalog'] || '',
    integrated, user: integrated ? '' : (kv['user id'] || kv.uid || kv.user || ''), password: kv.password || kv.pwd || '',
    trust: /^(true|yes)$/i.test(kv.trustservercertificate || ''),
  };
}
function buildCs(c) {
  return [`Server=${c.server}`, `Database=${c.database}`, c.integrated ? 'Trusted_Connection=True' : `User Id=${c.user};Password=${c.password}`, c.trust ? 'TrustServerCertificate=True' : ''].filter(Boolean).join(';');
}

function dbCard(p, v) {
  const b = dbBackupOf(p, v), u = dbUpdateOf(p, v), t = DB_TEST[v.id];
  const br = b && lastRun(b.id, 'backup'), ur = u && lastRun(u.id, 'dbupdate');
  const bRun = b && isRunning(b.id), uRun = u && isRunning(u.id), rRun = isRunning(v.id + ':restore');
  const files = b ? ((C.backups[b.id] && C.backups[b.id].files) || []).filter(f => /\.bak$/i.test(f.name)) : [];
  const testChip = t ? (t.busy ? chip('Testing…', 'soon') : t.ok ? chip(`Connected${t.message ? ' · ' + esc(t.message) : ''}`, 'okc') : chip(`Failed: ${esc(t.message)}`, 'late')) : '';
  return `<div class="card section">
    <div class="row between"><h2 style="margin:0">${I.db}${esc(v.label)} ${v.username ? chip(esc(v.username), '') : chip('Windows login', '')}</h2>
      <div class="row"><button class="btn" data-action="db-test" data-id="${v.id}" ${t && t.busy ? 'disabled' : ''}>Test connection</button>
        <button class="iconbtn" data-action="db-edit" data-pid="${p.id}" data-id="${v.id}" title="Edit">${I.edit}</button></div></div>
    <div class="sub" style="margin:6px 0">${v.url ? `<code>${esc(v.url)}</code>` : 'Connection details are in the vault'} ${testChip}</div>

    <div style="margin-top:14px"><div class="row between"><b>Backup</b>
      ${b ? `<div class="row"><button class="iconbtn" data-action="open-folder" data-path="${esc(b.destDir)}" title="Open backup folder">${I.folder}</button>
        <button class="btn primary" data-action="backup-run" data-id="${b.id}" ${bRun ? 'disabled' : ''}>${I.play}${bRun ? 'Running…' : 'Back up now'}</button></div>`
      : `<button class="btn" data-action="db-edit" data-pid="${p.id}" data-id="${v.id}">Set up backup</button>`}</div>
      ${b ? `<div class="sub" style="margin-top:4px"><code>${esc(b.destDir)}</code> · keeping ${b.keep ? 'last ' + num(b.keep) + ' copies' : 'all'} · ${b.everyHours > 0 ? `every ${num(b.everyHours)} h while the app is open` : 'manual'}</div>
        <div class="sub" style="margin-top:4px">${br ? `Last run: ${runChip(br)} ${ago(br.start)}${dur(br)}${br.size ? ' · ' + fmtSize(br.size) : ''}` : 'Never run'}</div>`
      : '<div class="sub" style="margin-top:4px">No backup yet: choose a folder and this database can be backed up in one click or on a schedule.</div>'}
      ${files.length ? `<details style="margin-top:8px" open><summary>Backup files (${num(files.length)})</summary><div class="files">${files.slice(0, 6).map(f => `<div class="row between"><code>${esc(f.name)}</code>
        <span class="row"><span class="sub">${fmtSize(f.size)} · ${ago(f.ts)}</span><button class="btn sm danger" data-action="db-restore" data-pid="${p.id}" data-id="${v.id}" data-file="${esc(f.name)}" ${rRun ? 'disabled' : ''}>${rRun ? 'Restoring…' : 'Restore'}</button></span></div>`).join('')}</div></details>` : ''}</div>

    <div style="margin-top:14px"><div class="row between"><b>Update</b>
      ${u ? `<button class="btn primary" data-action="op-run" data-pid="${p.id}" data-id="${u.id}" ${uRun ? 'disabled' : ''}>${I.play}${uRun ? 'Running…' : 'Update'}</button>`
      : `<button class="btn" data-action="db-edit" data-pid="${p.id}" data-id="${v.id}">Set up update</button>`}</div>
      ${u ? `<code class="cmd" style="margin-top:6px">${esc(u.command)}</code>
        <div class="sub" style="margin-top:4px">${u.backupId ? 'A backup is taken first; the update stops if it fails · ' : 'No backup before the update · '}${ur ? `Last run: ${runChip(ur)} ${ago(ur.start)}${dur(ur)}` : 'Never run'}</div>`
      : '<div class="sub" style="margin-top:4px">Add the migration command (e.g. <code>dotnet ef database update</code>) to run it in one click.</div>'}</div></div>`;
}

function tabDatabases(p) {
  const list = dbList(p), ids = new Set([...dbBackupIds(p), ...p.ops.filter(o => o.type === 'db').map(o => o.id), ...list.map(v => v.id + ':restore')]);
  const hist = S.history.filter(h => h.projectId === p.id && ['backup', 'dbupdate', 'dbrestore'].includes(h.kind) && ids.has(h.refId)).slice(0, 8);
  return `<div class="page-head" style="margin-top:0"><h2 style="margin:0;display:flex;align-items:center;gap:8px">${I.db}Databases</h2>
      <span class="sub">SQL Server. Connection details are stored encrypted in the Vault. Test a restore at least once.</span><span class="grow"></span>
      <button class="btn primary" data-action="db-new" data-pid="${p.id}">${I.plus}Add database</button></div>
    ${list.length ? `<div class="stack">${list.map(v => dbCard(p, v)).join('')}</div>`
      : notSet('No database defined yet', '<p class="sub">Add the server and database name once; backup, update and restore then all live on its card.</p>')}
    ${hist.length ? `<div class="card section" style="margin-top:16px"><h2>Database history</h2>${hist.map(histRow).join('')}</div>` : ''}`;
}

async function dbModal(pid, vid) {
  const p = proj(pid), v = vid ? C.vault.find(x => x.id === vid) : null;
  let c = { server: '', database: '', integrated: true, user: '', password: '', trust: true }, note = '';
  if (v) {
    const r = await native.vault.reveal(v.id);
    if (r.error) return toast(r.error, true);
    c = parseCs(r.secret);
    if (!c.server || !c.database) { note = 'This connection string is not in SQL Server format; enter the connection details again to replace it.'; c = { ...c, integrated: true, trust: true }; }
  }
  const b = v && dbBackupOf(p, v), u = v && dbUpdateOf(p, v);
  const bk = b || { destDir: '', keep: 7, everyHours: 24 }, up = u || { command: '', shell: 'cmd', cwd: '', backupId: 'yes' };
  openModal(`<form id="dbForm" data-pid="${p.id}" data-id="${vid || ''}">${modalHead(vid ? 'Edit database' : 'Add database')}
    <div class="body">
      ${note ? `<div class="check-item warn">${I.alert}<span>${note}</span></div>` : ''}
      <div class="field"><label>Name</label><input type="text" name="label" value="${esc(v ? v.label : '')}" required placeholder="Production DB"></div>
      <div class="two"><div class="field"><label>Server</label><input type="text" name="server" value="${esc(c.server)}" dir="ltr" required placeholder="localhost\\SQLEXPRESS"></div>
        <div class="field"><label>Database</label><input type="text" name="database" value="${esc(c.database)}" dir="ltr" required placeholder="MyDb"></div></div>
      <div class="two"><div class="field"><label>Login</label><select name="auth"><option value="windows" ${c.integrated ? 'selected' : ''}>Windows login</option><option value="sql" ${c.integrated ? '' : 'selected'}>SQL Server login</option></select></div>
        <div class="field"><label>&nbsp;</label><label class="chk"><input type="checkbox" name="trust" ${c.trust ? 'checked' : ''}> Trust the server certificate</label></div></div>
      <div class="two" data-sql><div class="field"><label>User</label><input type="text" name="user" value="${esc(c.user)}" dir="ltr" autocomplete="off"></div>
        <div class="field"><label>Password${vid ? ' (empty = unchanged)' : ''}</label><input type="password" name="password" dir="ltr" autocomplete="new-password" placeholder="${vid && c.password ? '••••••••' : ''}"></div></div>
      <h3 style="margin:18px 0 6px">Backup</h3>
      ${folderField('Backup folder (empty = no backup for this database)', 'destDir', bk.destDir, 'D:\\Backups\\my-db')}
      <div class="two"><div class="field"><label>Copies to keep (0 = all)</label><input type="number" name="keep" min="0" value="${bk.keep}"></div>
        <div class="field"><label>Run automatically every N hours (0 = manual)</label><input type="number" name="everyHours" min="0" value="${bk.everyHours}"></div></div>
      <div class="sub">The folder is written by the SQL Server machine, so it must be a path that machine can write to.</div>
      <h3 style="margin:18px 0 6px">Update</h3>
      <div class="field"><label>Update command (empty = no update for this database)</label><textarea name="command" dir="ltr" style="min-height:64px;font-family:Consolas,monospace">${esc(up.command)}</textarea>
        <div class="row">${OP_TEMPLATES.db.map((t, i) => `<button type="button" class="btn sm" data-action="dbtpl" data-i="${i}">${t.t}</button>`).join('')}</div>
        <div class="sub">The connection string is passed to the command as an environment variable (<code>${esc((v && v.envName) || DB_ENV_DEFAULT)}</code>).</div></div>
      <div class="two"><div class="field"><label>Shell</label>${shellSel(up.shell)}</div><div class="field"><label>&nbsp;</label><label class="chk"><input type="checkbox" name="backupFirst" ${up.backupId ? 'checked' : ''}> Take a backup first (needs a backup folder)</label></div></div>
      ${folderField('Working folder (default: repository folder)', 'cwd', up.cwd, '')}
    </div>${footerBtns(vid ? `<button type="button" class="btn danger" data-action="db-del" data-pid="${p.id}" data-id="${vid}">${I.trash}Delete</button>` : '')}</form>`);
  syncDbAuth();
}
function syncDbAuth() {
  const f = $('#dbForm');
  if (f) f.querySelector('[data-sql]').hidden = f.elements.auth.value !== 'sql';
}

/** The names the deploy form lists: database backups and updates are marked so they are not mistaken for file backups */
const dbRefLabel = (p, o, isBackup) => (o.dbId && (isBackup ? o.type === 'database' : o.type === 'db') ? `Database · ${o.name}` : o.name);

async function saveDb(f) {
  const fd = new FormData(f), p = proj(f.dataset.pid), vid = f.dataset.id, g = n => String(fd.get(n) ?? '').trim();
  const label = g('label');
  const old = vid ? C.vault.find(x => x.id === vid) : null;
  const cur = old ? parseCs((await native.vault.reveal(old.id)).secret) : null;
  const c = { server: g('server'), database: g('database'), integrated: g('auth') === 'windows', user: g('user'), trust: !!fd.get('trust'), password: String(fd.get('password') || '') || (cur ? cur.password : '') };
  if (!label || !c.server || !c.database) return toast('Enter the name, server and database', true);
  if (!c.integrated && (!c.user || !c.password)) return toast('A SQL Server login needs a user and a password', true);
  if ([c.server, c.database, c.user, c.password].some(x => x.includes(';') || /["%\r\n]/.test(x))) return toast('The connection details contain an unsupported character (; " %)', true);
  const r = await native.vault.save({ ...(old || {}), id: vid, projectId: old ? old.projectId : p.id, label, kind: 'db', username: c.integrated ? '' : c.user, url: `${c.server}/${c.database}` }, buildCs(c));
  if (r.error) return toast(r.error, true);
  const id = r.id;

  const destDir = g('destDir');
  let b = p.backups.find(x => x.type === 'database' && x.dbId === id);
  if (destDir) {
    const data = { name: label, type: 'database', dbId: id, destDir, keep: Math.max(0, Math.round(Number(fd.get('keep')) || 0)), everyHours: Math.max(0, Number(fd.get('everyHours')) || 0), source: '', command: '', shell: 'cmd', cwd: '', exclude: '', envSpec: '' };
    if (b) Object.assign(b, data); else p.backups.push(b = { id: uid(), ...data });
  } else if (b) { p.backups = p.backups.filter(x => x !== b); p.deploys.forEach(d => { if (d.backupId === b.id) d.backupId = ''; }); b = null; }

  const command = g('command');
  let u = p.ops.find(x => x.type === 'db' && x.dbId === id);
  if (command) {
    const data = { type: 'db', name: label, command, shell: fd.get('shell'), cwd: g('cwd'), envSpec: '', dbId: id, backupId: b && fd.get('backupFirst') ? b.id : '' };
    if (u) Object.assign(u, data); else p.ops.push(u = { id: uid(), ...data });
  } else if (u) { p.ops = p.ops.filter(x => x !== u); p.deploys.forEach(d => { if (d.dbUpdateId === u.id) d.dbUpdateId = ''; }); }

  save(); await loadVault(); closeModal(); render();
  if (b) loadBackups(b).then(softRender);
  toast('Saved');
}

Object.assign(actions, {
  'db-new': el => dbModal(el.dataset.pid),
  'db-edit': el => dbModal(el.dataset.pid, el.dataset.id),
  dbtpl: el => { document.querySelector('#dbForm [name=command]').value = OP_TEMPLATES.db[el.dataset.i].cmd; },
  'db-test': async el => {
    const id = el.dataset.id;
    DB_TEST[id] = { busy: true }; render();
    const r = await native.db.test(id);
    DB_TEST[id] = { ok: r.ok, message: r.message, ts: Date.now() };
    softRender();
  },
  'db-restore': async el => {
    const p = proj(el.dataset.pid), v = C.vault.find(x => x.id === el.dataset.id), b = v && dbBackupOf(p, v), name = el.dataset.file;
    if (!b || !/^[^\\/]+\.bak$/i.test(name)) return;
    if (!(await askConfirm(`Restore "${v.label}" from ${name}?\n\nThe current data of this database will be OVERWRITTEN with the contents of this backup, and everyone connected is disconnected. This cannot be undone: take a fresh backup first if you may need the current data.`, 'Restore'))) return;
    runJob({ pid: p.id, kind: 'dbrestore', refId: v.id + ':restore', title: `Restore: ${v.label}`, spec: { dbId: v.id, restore: { destDir: b.destDir, file: b.destDir.replace(/[\\/]+$/, '') + '\\' + name } } });
  },
  'db-del': async el => {
    const p = proj(el.dataset.pid), v = C.vault.find(x => x.id === el.dataset.id);
    if (!v || !(await askConfirm(`Delete "${v.label}"?\n\nThe stored connection details, its backup schedule and its update command are removed. Backup files and history are kept.`))) return;
    const b = dbBackupOf(p, v), u = dbUpdateOf(p, v);
    p.deploys.forEach(d => { if (b && d.backupId === b.id) d.backupId = ''; if (u && d.dbUpdateId === u.id) d.dbUpdateId = ''; });
    p.backups = p.backups.filter(x => x !== b); p.ops = p.ops.filter(x => x !== u);
    await native.vault.remove(v.id);
    save(); await loadVault(); closeModal(); render(); toast('Deleted');
  },
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'dbForm') return;
  e.preventDefault();
  saveDb(e.target);
});
document.addEventListener('change', e => { if (e.target.name === 'auth' && e.target.closest('#dbForm')) syncDbAuth(); });
