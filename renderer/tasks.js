'use strict';

/* ======================= Tasks: backlog, kanban board, estimates, WIP limit, git link =======================
 * A task moves Backlog -> To do -> In progress -> Done. "To do" is what the current sprint (or, with no sprint, "now")
 * has committed to. Sprints and retrospectives live in sprint.js. */
const T_PRIO = ['Low', 'Medium', 'High'];
const T_STATUS = { backlog: 'Backlog', todo: 'To do', doing: 'In progress', done: 'Done' };
const T_COLS = ['backlog', 'todo', 'doing', 'done'];
const T_POINTS = [1, 2, 3, 5, 8, 13];
const T_WIP_DEFAULT = 3;
const T_DONE_VISIBLE_DAYS = 7; // with no active sprint the Done column only shows recent work

const byPrio = (a, b) => b.priority - a.priority;
const taskKey = (p, t) => `T-${t.num}`;
const isNow = t => t.status === 'todo' || t.status === 'doing';
const openTasks = p => p.tasks.filter(t => t.status !== 'done');
/** The WIP limit is one app-wide setting (Settings > Tasks); 0 = off */
const wipLimit = () => S.settings.wip;

/** Finds a task (and its app) by id across all apps */
function findTask(id) {
  for (const p of S.projects) { const t = p.tasks.find(x => x.id === id); if (t) return { p, t }; }
  return null;
}

/** The one place new tasks are created, so numbering and defaults stay consistent */
function makeTask(p, fields) {
  p.taskSeq = Math.max(p.taskSeq || 0, ...p.tasks.map(t => t.num || 0)) + 1;
  const t = { id: uid(), num: p.taskSeq, createdAt: Date.now(), doneAt: null, status: 'backlog', priority: 1, estimate: 0, sprintId: '', branch: '', branchAt: 0, ...fields };
  p.tasks.push(t);
  if (t.status !== 'backlog') setTaskStatus(p, t, t.status);
  return t;
}

/** Change status; keeps the sprint link, done time and start time in step */
function setTaskStatus(p, t, status) {
  const sp = activeSprint(p), was = t.status;
  t.status = status;
  t.doneAt = status === 'done' ? Date.now() : null;
  if (status === 'backlog') t.sprintId = '';
  else if (!t.sprintId && sp) t.sprintId = sp.id;
  if (status === 'doing' && !t.startedAt) t.startedAt = Date.now();
  if (status === 'done' && was !== 'done') petEvent('task-done', { p, t });
}

/** Deleting a finished task must not erase it from the reports, so the facts the reports use are kept */
function archiveTask(p, t) {
  S.archive.push({ pid: p.id, app: p.name, t: { num: t.num, title: t.title, status: 'done', priority: t.priority, estimate: t.estimate || 0, createdAt: t.createdAt || 0, startedAt: t.startedAt || 0, doneAt: t.doneAt } });
  if (S.archive.length > 5000) S.archive.splice(0, S.archive.length - 5000);
}

/* ---------- WIP limit ---------- */
const doingCount = p => p.tasks.filter(t => t.status === 'doing').length;
async function wipAllows(p, t, toStatus) {
  const lim = wipLimit(p);
  if (toStatus !== 'doing' || t.status === 'doing' || !lim || doingCount(p) < lim) return true;
  return askConfirm(`"${p.name}" already has ${num(doingCount(p))} tasks in progress (limit ${num(lim)}).\nFinishing work before starting new work keeps things moving.`, 'Move anyway', false);
}

/* ---------- Rendering: cards and rows ---------- */
function taskChips(p, t) {
  const out = [];
  if (t.estimate) out.push(chip(`${num(t.estimate)} pt`, ''));
  if (t.branch) {
    const b = branchOf(p, t), run = branchRun(p, t);
    out.push(chip(`<bdi>${esc(t.branch)}</bdi>`, b && b.merged ? 'okc' : '', I.branch));
    if (run && run.status === 'completed' && run.conclusion === 'failure') out.push(chip('CI failed', 'late'));
    else if (run && run.status !== 'completed') out.push(chip('CI running', 'soon'));
    else if (run && run.conclusion === 'success') out.push(chip('CI passed', 'okc'));
  }
  return out.join('');
}

function taskRowHtml(p, t, showProject) {
  const done = t.status === 'done';
  return `<div class="trow ${done ? 'done' : ''}" data-action="task-edit" data-pid="${p.id}" data-id="${t.id}">
    <button class="check ${done ? 'on' : ''}" data-action="task-toggle" data-pid="${p.id}" data-id="${t.id}" title="${done ? 'Reopen' : 'Mark done'}">${done ? I.tick : ''}</button>
    <span class="pdot p${t.priority}" title="${T_PRIO[t.priority]} priority"></span>
    <span class="tk">${taskKey(p, t)}</span>
    <span class="tt">${esc(t.title)}</span>
    ${showProject ? chip(esc(p.name), '') : ''}
    ${taskChips(p, t)}
    ${t.status === 'doing' ? chip('In progress', 'soon') : t.status === 'backlog' ? chip('Backlog', '') : ''}
  </div>`;
}

function cardHtml(p, t) {
  const done = t.status === 'done';
  return `<div class="kcard ${done ? 'done' : ''}" draggable="true" data-dnd="task" data-did="${t.id}" data-pid="${p.id}" data-action="task-edit" data-id="${t.id}">
    <div class="kt"><button class="check ${done ? 'on' : ''}" data-action="task-toggle" data-pid="${p.id}" data-id="${t.id}" title="${done ? 'Reopen' : 'Mark done'}">${done ? I.tick : ''}</button>
      <span class="tt">${esc(t.title)}</span></div>
    <div class="km"><span class="pdot p${t.priority}" title="${T_PRIO[t.priority]} priority"></span><span class="tk">${taskKey(p, t)}</span>${taskChips(p, t)}</div>
  </div>`;
}

/** Tasks shown in a board column (Done is trimmed to the current sprint, or to recent work) */
function colTasks(p, col) {
  let list = p.tasks.filter(t => t.status === col);
  if (col === 'done') {
    const sp = activeSprint(p), since = Date.now() - T_DONE_VISIBLE_DAYS * 864e5;
    list = list.filter(t => sp ? t.sprintId === sp.id : t.doneAt > since);
  }
  return list;
}

function boardHtml(p) {
  const lim = wipLimit(p);
  const col = c => {
    const list = colTasks(p, c), over = c === 'doing' && lim && doingCount(p) > lim;
    const head = `<div class="col-h"><span>${T_STATUS[c]}</span><span class="cnt">${num(list.length)}${c === 'doing' && lim ? ` / ${num(lim)}` : ''}</span></div>`;
    const add = c === 'backlog' ? `<div class="quick-add"><input type="text" data-tquick="${p.id}" placeholder="Add to backlog…"></div>` : '';
    return `<div class="col ${over ? 'over' : ''} ${c === 'backlog' ? 'backlog' : ''}" data-col="${c}" data-pid="${p.id}">${head}${add}
      <div class="col-b">${list.map(t => cardHtml(p, t)).join('')}</div></div>`;
  };
  return `<div class="board">${T_COLS.map(col).join('')}</div>`;
}

/* ---------- Project tab ---------- */
const TASK_FILTERS = [['open', 'Open'], ['backlog', 'Backlog'], ['done', 'Done'], ['all', 'All']];
const filterTasks = (list, f) => list.filter(t => f === 'all' ? true : f === 'open' ? isNow(t) : t.status === f);

function tabTasks(p) {
  const view = V.tview || 'board';
  const seg = (v, l) => `<button class="${view === v ? 'on' : ''}" data-action="tview" data-v="${v}">${l}</button>`;
  const head = `<div class="page-head" style="margin-top:0"><div class="seg">${seg('board', 'Board')}${seg('list', 'List')}${seg('sprints', 'Sprints')}</div>
      <span class="grow"></span>
      <button class="btn primary" data-action="task-new" data-pid="${p.id}">${I.plus}New task</button></div>`;
  if (view === 'sprints') return head + sprintsHtml(p);
  if (view === 'list') {
    const f = V.tfilter || 'open';
    const list = filterTasks(p.tasks, f).sort((a, b) => (a.status === 'done') - (b.status === 'done') || byPrio(a, b));
    const fseg = ([v, l]) => `<button class="${f === v ? 'on' : ''}" data-action="tfilter" data-v="${v}">${l}</button>`;
    return head + `<div class="card section">
      <div class="row between" style="margin-bottom:10px"><div class="seg">${TASK_FILTERS.map(fseg).join('')}</div></div>
      <div class="quick-add"><input type="text" data-tquick="${p.id}" placeholder="Add to backlog (e.g. renew SSL, update packages, test backup restore) and press Enter"></div>
      ${list.length ? list.map(t => taskRowHtml(p, t, false)).join('') : `<div class="empty" style="padding:24px">Nothing here</div>`}
    </div>`;
  }
  return head + sprintBanner(p) + boardHtml(p);
}

function viewTasksAll() {
  const f = V.tfilter || 'open';
  const groups = S.projects.map(p => ({ p, list: filterTasks(p.tasks, f).sort(byPrio) })).filter(g => g.list.length);
  const seg = ([v, l]) => `<button class="${f === v ? 'on' : ''}" data-action="tfilter" data-v="${v}">${l}</button>`;
  return `<div class="page-head"><h1>Tasks</h1><div class="seg">${TASK_FILTERS.map(seg).join('')}</div><span class="grow"></span>
      <button class="btn primary" data-action="task-new">${I.plus}New task</button></div>
    ${groups.length ? groups.map(({ p, list }) => `<div class="card section" style="margin-bottom:14px"><h2>${esc(p.name)}<span class="grow"></span><button class="btn sm" data-action="open-project" data-id="${p.id}" data-tab="tasks">Board</button></h2>${list.map(t => taskRowHtml(p, t, false)).join('')}</div>`).join('')
      : `<div class="empty card">${I.tick}<h3>${S.projects.length ? 'No tasks' : 'Add an app first'}</h3></div>`}`;
}

/* ---------- Edit dialog ---------- */
function taskModal(pid, tid) {
  if (!S.projects.length) { toast('Create an app first', true); return; }
  const p = proj(pid) || proj(V.pid) || S.projects[0];
  const t = tid ? p.tasks.find(x => x.id === tid) : { title: '', status: 'backlog', priority: 1, estimate: 0, branch: '', projectId: p.id };
  const opt = (arr, cur) => arr.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`).join('');
  const branches = ((C.tb[p.id] || {}).branches || []).filter(b => !b.isRemote).map(b => `<option value="${esc(b.name)}">`).join('');
  const canStart = tid && p.repoPath && t.status !== 'done';
  openModal(`<form id="taskForm" data-pid="${p.id}" data-id="${tid || ''}">${modalHead(tid ? `${taskKey(p, t)} · Edit task` : 'New task')}
    <div class="body">
      <div class="field"><label>Title</label><input type="text" name="title" value="${esc(t.title)}" required placeholder="What needs to be done?"></div>
      <div class="two"><div class="field"><label>App</label><select name="projectId">${S.projects.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Status</label><select name="status">${opt(Object.entries(T_STATUS), t.status)}</select></div></div>
      <div class="two"><div class="field"><label>Priority</label><select name="priority">${opt(T_PRIO.map((l, i) => [i, l]), t.priority)}</select></div>
        <div class="field"><label>Estimate (story points)</label><select name="estimate">${opt([[0, 'None'], ...T_POINTS.map(n => [n, n])], t.estimate || 0)}</select></div></div>
      <div class="field"><label>Git branch</label>
        <div class="row"><input type="text" name="branch" list="tbranches" value="${esc(t.branch || '')}" placeholder="Link a branch; the task closes itself when it is merged" style="flex:1;direction:ltr"><datalist id="tbranches">${branches}</datalist>
          ${canStart ? `<button type="button" class="btn sm" data-action="task-start" data-pid="${p.id}" data-id="${tid}" title="Create a branch for this task, switch to it and move the task to In progress">${I.branch}Start branch</button>` : ''}</div></div>
    </div>${footerBtns(tid ? `<button type="button" class="btn danger" data-action="task-del" data-pid="${p.id}" data-id="${tid}">${I.trash}Delete</button>` : '')}</form>`);
}

/* ---------- Moving tasks (button, modal and drag and drop all end up here) ---------- */
/** Moves task `id` to column `col`, before/after `targetId` when given, otherwise to the end of the column */
async function moveTask(id, col, targetId, after) {
  const f = findTask(id);
  if (!f) return;
  const { p, t } = f;
  if (!(await wipAllows(p, t, col))) return;
  if (t.status !== col) setTaskStatus(p, t, col);
  p.tasks = p.tasks.filter(x => x !== t);
  const at = targetId ? p.tasks.findIndex(x => x.id === targetId) : -1;
  if (at < 0) {
    // no anchor: place after the last task of that column, or at the very end
    let last = -1;
    p.tasks.forEach((x, i) => { if (x.status === col) last = i; });
    p.tasks.splice(last < 0 ? p.tasks.length : last + 1, 0, t);
  } else p.tasks.splice(after ? at + 1 : at, 0, t);
  save(); render();
}

/* ---------- Git link ---------- */
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const branchOf = (p, t) => t.branch && ((C.tb[p.id] || {}).branches || []).find(b => b.name === t.branch && !b.isRemote);
function branchRun(p, t) {
  const c = C.ci[p.id];
  return t.branch && c && c.runs && c.runs.find(r => r.branch === t.branch);
}

/** Reads the branch list for apps that have tasks linked to a branch, and closes tasks whose branch has been merged.
 * A branch counts as merged only if its tip is newer than the moment it was linked, so a branch that was just
 * created from main (and is therefore trivially "merged") does not close its task. */
async function loadTaskBranches(p) {
  if (!p.repoPath || !p.tasks.some(t => t.branch && t.status !== 'done')) return;
  const r = await native.git('branches', p.repoPath);
  if (r.error || !r.branches) return;
  C.tb[p.id] = r;
  let changed = false;
  for (const t of p.tasks) {
    if (!t.branch || t.status === 'done') continue;
    const b = r.branches.find(x => x.name === t.branch && !x.isRemote);
    if (b && b.merged && b.date > (t.branchAt || 0)) {
      setTaskStatus(p, t, 'done');
      t.doneVia = 'merge';
      changed = true;
      toast(`${taskKey(p, t)} done — ${t.branch} was merged`);
    }
  }
  if (changed) save();
}
async function refreshTaskBranches() {
  await Promise.all(S.projects.map(loadTaskBranches));
}

/* ---------- Actions ---------- */
Object.assign(actions, {
  'task-new': el => taskModal(el.dataset.pid || (V.name === 'project' ? V.pid : ''), ''),
  'task-edit': el => taskModal(el.dataset.pid, el.dataset.id),
  'task-toggle': async el => {
    const f = findTask(el.dataset.id);
    if (!f) return;
    await moveTask(f.t.id, f.t.status === 'done' ? 'todo' : 'done');
  },
  'task-del': async el => {
    if (!(await askConfirm('Delete this task?'))) return;
    const p = proj(el.dataset.pid), gone = p.tasks.find(x => x.id === el.dataset.id);
    if (gone && gone.doneAt) archiveTask(p, gone);
    p.tasks = p.tasks.filter(x => x.id !== el.dataset.id);
    save(); closeModal(); render();
  },
  'task-start': async el => {
    const f = findTask(el.dataset.id);
    if (!f) return;
    const { p, t } = f;
    const name = t.branch || `task-${t.num}${slug(t.title) ? '-' + slug(t.title) : ''}`;
    if (!(await askConfirm(`${t.branch ? 'Switch to' : 'Create and switch to'} the branch "${name}"?\nThe task moves to In progress.`, 'Start', false))) return;
    if (!(await wipAllows(p, t, 'doing'))) return;
    closeModal();
    const r = t.branch
      ? await gitOp(p.id, 'checkout', { name }, `Checkout ${name}`)
      : await gitOp(p.id, 'createBranch', { name }, `Create branch ${name}`);
    if (r.error) return;
    t.branch = name; t.branchAt = Date.now();
    setTaskStatus(p, t, 'doing');
    save(); render(); loadTaskBranches(p).then(softRender);
  },
  tfilter: el => { V.tfilter = el.dataset.v; render(); },
  tview: el => { V.tview = el.dataset.v; navPush(); render(); if (el.dataset.v === 'board') enterTab(); },
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.id !== 'taskForm') return;
  e.preventDefault();
  const fd = new FormData(f), title = String(fd.get('title')).trim();
  if (!title) return;
  const oldP = proj(f.dataset.pid), newP = proj(fd.get('projectId')) || oldP;
  const branch = String(fd.get('branch')).trim();
  const data = { title, priority: Number(fd.get('priority')), estimate: Number(fd.get('estimate')) || 0 };
  const status = fd.get('status');
  if (branch && !/^(?!-)[A-Za-z0-9._/@+-]+$/.test(branch)) return toast('Invalid branch name', true);
  let t;
  if (f.dataset.id) {
    t = oldP.tasks.find(x => x.id === f.dataset.id);
    Object.assign(t, data);
    if (t.branch !== branch) { t.branch = branch; t.branchAt = branch ? Date.now() : 0; }
    if (oldP !== newP) { oldP.tasks = oldP.tasks.filter(x => x !== t); newP.tasks.push(t); t.sprintId = ''; t.num = Math.max(newP.taskSeq || 0, ...newP.tasks.map(x => x.num || 0)) + 1; newP.taskSeq = t.num; }
    if (t.status !== status) setTaskStatus(newP, t, status);
  } else {
    t = makeTask(newP, { ...data, branch, branchAt: branch ? Date.now() : 0 });
    if (status !== 'backlog') setTaskStatus(newP, t, status);
  }
  save(); closeModal(); render(); toast('Saved');
  if (branch) loadTaskBranches(newP).then(softRender);
});

// Quick add: title + Enter (lands in the backlog)
document.addEventListener('keydown', e => {
  const pid = e.target.dataset && e.target.dataset.tquick;
  if (!pid || e.key !== 'Enter') return;
  e.preventDefault();
  const title = e.target.value.trim();
  if (!title) return;
  makeTask(proj(pid), { title });
  save(); render();
  const again = document.querySelector(`[data-tquick="${pid}"]`);
  if (again) again.focus();
});

/* ---------- Tasks popup (small always-on-top window, Ctrl+Alt+T) ---------- */
/** Sends what the popup shows: only tasks that are in play, never anything else from the data */
function pushPopup(locked) {
  if (!S || !native.popup) return;
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const items = [];
  if (!locked) {
    for (const p of orderedProjects()) {
      for (const t of p.tasks) {
        if (isNow(t)) items.push({ id: t.id, pid: p.id, key: taskKey(p, t), app: p.name, title: t.title, status: t.status, priority: t.priority, estimate: t.estimate || 0 });
      }
    }
    items.sort((a, b) => b.priority - a.priority);
  }
  try { native.popup.update(locked ? { locked: true, theme } : { locked: false, theme, items }); } catch { /* popup unavailable */ }
}
if (native.popup) {
  native.popup.onAction(a => {
    if (a && a.type === 'done' && typeof a.id === 'string' && !(typeof locking !== 'undefined' && locking) && findTask(a.id)) moveTask(a.id, 'done');
  });
}
