'use strict';

/* ======================= Sprints and retrospectives =======================
 * A sprint is an optional time-box per app. Starting one adopts the tasks that are already in To do / In progress;
 * closing one records what was finished, sends unfinished work back to the backlog (or carries it over) and keeps a
 * retrospective. Without a sprint the board still works as a plain kanban. */
const SPRINT_WEEKS = [1, 2, 3, 4];

const SPRINT_LIMIT_DEFAULT = 1; // sprints running at the same time across all apps (one person); 0 = off

const activeSprint = p => (p.sprints || []).find(s => !s.closedAt);
const sprintLimit = () => S.settings.sprints;
const activeSprintApps = () => S.projects.filter(activeSprint);
const sprintTasks = (p, s) => p.tasks.filter(t => t.sprintId === s.id);
const sumPts = list => list.reduce((n, t) => n + (t.estimate || 0), 0);

function sprintBanner(p) {
  const s = activeSprint(p);
  if (!s) {
    return `<div class="card sprint idle"><span class="sub">No active sprint. Pull work from the backlog into To do, or time-box it with a sprint.</span><span class="grow"></span>
      <button class="btn sm" data-action="sprint-start" data-pid="${p.id}">Start sprint</button></div>`;
  }
  const list = sprintTasks(p, s), total = sumPts(list), done = sumPts(list.filter(t => t.status === 'done'));
  const left = diffDays(s.end), late = left < 0;
  const when = late ? `ended ${num(-left)} day${-left === 1 ? '' : 's'} ago` : left === 0 ? 'ends today' : `${num(left)} day${left === 1 ? '' : 's'} left`;
  const pct = total ? Math.round(done / total * 100) : (list.length ? Math.round(list.filter(t => t.status === 'done').length / list.length * 100) : 0);
  return `<div class="card sprint ${late ? 'late' : ''}">
    <div class="sp-main"><div class="sp-t"><b>${esc(s.name)}</b><span class="sub">${fmtDate(s.start)} – ${fmtDate(s.end)}</span><span class="${late ? 'sp-late' : 'sub'}">${when}</span></div>
      ${s.goal ? `<div class="sp-goal">${esc(s.goal)}</div>` : ''}</div>
    ${total ? `<span class="sub">${num(done)} / ${num(total)} pt</span>` : ''}
    <button class="btn sm ${late ? 'primary' : ''}" data-action="sprint-close" data-pid="${p.id}">Close sprint</button>
    <div class="sp-bar"><i style="width:${pct}%"></i></div></div>`;
}

/* ---------- Sprints view: history and retrospectives ---------- */
function sprintsHtml(p) {
  const closed = (p.sprints || []).filter(s => s.closedAt).sort((a, b) => b.closedAt - a.closedAt);
  const act = activeSprint(p);
  const recent = closed.slice(0, 3).filter(s => s.stats);
  const velocity = recent.length ? Math.round(recent.reduce((n, s) => n + s.stats.donePts, 0) / recent.length) : 0;
  const head = `<div class="row between" style="margin-bottom:14px">
      <span class="sub">${velocity ? `Velocity: about ${num(velocity)} pt per sprint (last ${num(recent.length)})` : 'Finished sprints and their retrospectives appear here.'}</span>
      ${act ? '' : `<button class="btn" data-action="sprint-start" data-pid="${p.id}">Start sprint</button>`}</div>`;
  if (!closed.length) return head + `<div class="empty card">${I.cal}<h3>No finished sprints yet</h3><p>Start a sprint, work through the board, then close it to record what shipped and what to change next time.</p></div>`;
  const part = (label, text) => text ? `<div class="retro-p"><div class="retro-l">${label}</div><div class="retro-t">${esc(text)}</div></div>` : '';
  return head + closed.map(s => {
    const st = s.stats || { total: 0, done: 0, pts: 0, donePts: 0 };
    const done = sprintTasks(p, s).filter(t => t.status === 'done');
    return `<div class="card section" style="margin-bottom:14px"><h2>${esc(s.name)}<span class="sub" style="font-weight:400">${fmtDate(s.start)} – ${fmtDate(s.end)}</span><span class="grow"></span>
        ${chip(`${num(st.done)} / ${num(st.total)} tasks`, st.total && st.done === st.total ? 'okc' : '')}${st.pts ? chip(`${num(st.donePts)} / ${num(st.pts)} pt`, '') : ''}</h2>
      ${s.goal ? `<div class="sp-goal" style="margin-bottom:10px">${esc(s.goal)}</div>` : ''}
      ${done.length ? `<div class="sp-done">${done.map(t => `<div><span class="tk">${taskKey(p, t)}</span> ${esc(t.title)}</div>`).join('')}</div>` : ''}
      ${s.retro ? `<div class="retro">${part('Went well', s.retro.well)}${part('To improve', s.retro.improve)}${part('Actions', s.retro.actions)}</div>` : ''}</div>`;
  }).join('');
}

/* ---------- Dialogs ---------- */
function sprintStartModal(pid) {
  const p = proj(pid);
  if (!p || activeSprint(p)) return;
  const n = (p.sprints || []).length + 1;
  const adopt = p.tasks.filter(t => isNow(t) && !t.sprintId).length;
  openModal(`<form id="sprintForm" data-pid="${p.id}">${modalHead('Start sprint')}
    <div class="body">
      <div class="two"><div class="field"><label>Name</label><input type="text" name="name" value="Sprint ${n}" required></div>
        <div class="field"><label>Length</label><select name="weeks">${SPRINT_WEEKS.map(w => `<option value="${w}" ${w === 2 ? 'selected' : ''}>${w} week${w > 1 ? 's' : ''}</option>`).join('')}</select></div></div>
      <div class="field"><label>Goal (optional)</label><input type="text" name="goal" placeholder="What should be true at the end of this sprint?"></div>
      <div class="sub">Starts today.${adopt ? ` The ${num(adopt)} task${adopt > 1 ? 's' : ''} already in To do / In progress join this sprint.` : ' Drag tasks from the backlog into To do to plan it.'}</div>
    </div><footer><span class="grow"></span><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary">Start sprint</button></footer></form>`, { small: true });
}

function sprintCloseModal(pid) {
  const p = proj(pid), s = p && activeSprint(p);
  if (!s) return;
  const list = sprintTasks(p, s), done = list.filter(t => t.status === 'done'), left = list.filter(t => t.status !== 'done');
  openModal(`<form id="sprintCloseForm" data-pid="${p.id}">${modalHead(`Close ${esc(s.name)}`)}
    <div class="body">
      <div class="sub">${num(done.length)} of ${num(list.length)} tasks finished${sumPts(list) ? ` · ${num(sumPts(done))} of ${num(sumPts(list))} pt` : ''}.</div>
      ${left.length ? `<div class="field"><label>${num(left.length)} unfinished task${left.length > 1 ? 's' : ''}</label>
        <div class="sp-left">${left.map(t => `<div><span class="tk">${taskKey(p, t)}</span> ${esc(t.title)}</div>`).join('')}</div>
        <label class="opt"><input type="radio" name="leftover" value="backlog" checked> Send back to the backlog</label>
        <label class="opt"><input type="radio" name="leftover" value="carry"> Carry over to the next sprint</label></div>` : ''}
      <div class="field"><label>Retrospective — what went well?</label><textarea name="well"></textarea></div>
      <div class="field"><label>What should change?</label><textarea name="improve"></textarea></div>
      <div class="field"><label>Actions (one per line)</label><textarea name="actions" placeholder="Each line can become a backlog task"></textarea>
        <label class="opt"><input type="checkbox" name="mk" checked> Add the actions to the backlog as tasks</label></div>
    </div><footer><span class="grow"></span><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary">Close sprint</button></footer></form>`);
}

Object.assign(actions, {
  'sprint-start': async el => {
    const running = activeSprintApps(), lim = sprintLimit();
    if (lim && running.length >= lim && !(await askConfirm(`${running.map(p => `"${p.name}"`).join(', ')} already ${running.length > 1 ? 'have sprints' : 'has a sprint'} running (limit ${num(lim)} at a time).\nOne person committing to several sprints at once spreads the work thin. Finishing one sprint before starting the next keeps it focused.`, 'Start anyway', false))) return;
    sprintStartModal(el.dataset.pid);
  },
  'sprint-close': el => sprintCloseModal(el.dataset.pid),
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.id === 'sprintForm') {
    e.preventDefault();
    const p = proj(f.dataset.pid), fd = new FormData(f), name = String(fd.get('name')).trim();
    if (!p || !name || activeSprint(p)) return;
    const end = new Date(); end.setDate(end.getDate() + 7 * Number(fd.get('weeks')));
    const s = { id: uid(), name, goal: String(fd.get('goal')).trim(), start: todayISO(), end: toISO(end), closedAt: null, retro: null, stats: null };
    (p.sprints || (p.sprints = [])).push(s);
    p.tasks.forEach(t => { if (isNow(t) && !t.sprintId) t.sprintId = s.id; });
    save(); closeModal(); render(); toast('Sprint started');
  } else if (f.id === 'sprintCloseForm') {
    e.preventDefault();
    const p = proj(f.dataset.pid), s = p && activeSprint(p);
    if (!s) return;
    const fd = new FormData(f), list = sprintTasks(p, s), left = list.filter(t => t.status !== 'done');
    s.stats = { total: list.length, done: list.length - left.length, pts: sumPts(list), donePts: sumPts(list.filter(t => t.status === 'done')) };
    s.closedAt = Date.now();
    const text = k => String(fd.get(k) || '').trim();
    const actionLines = text('actions').split('\n').map(x => x.trim()).filter(Boolean);
    s.retro = (text('well') || text('improve') || actionLines.length) ? { well: text('well'), improve: text('improve'), actions: actionLines.join('\n') } : null;
    for (const t of left) {
      t.sprintId = '';
      if (fd.get('leftover') !== 'carry') { t.status = 'backlog'; t.startedAt = 0; t.blocked = false; } // carried tasks keep their column
    }
    if (fd.get('mk')) actionLines.forEach(title => makeTask(p, { title: 'Retro: ' + title, priority: 2 }));
    save(); closeModal(); V.tview = 'sprints'; render(); toast('Sprint closed');
  }
});
