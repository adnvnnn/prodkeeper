'use strict';

/* ======================= Drag and drop: reordering projects on the projects page, moving tasks on the board =======================
 * Projects are always grouped by priority; the drag order is kept within a group, and dropping a project onto one of another
 * priority moves it to that priority. Tasks move between board columns (or are reordered inside one); the board
 * only accepts tasks of its own app. */
let dragState = null, dropMark = null;

function dndClear() {
  document.querySelectorAll('.dragging, .drop-before, .drop-after, .drop-col').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-col'));
}

function dndReorder(kind, id, targetId, after) {
  const ids = S.projects.map(p => p.id);
  const from = ids.indexOf(id);
  if (from < 0 || id === targetId) return;
  proj(id).priority = proj(targetId).priority;
  ids.splice(from, 1);
  const to = ids.indexOf(targetId);
  if (to < 0) return;
  ids.splice(after ? to + 1 : to, 0, id);
  S.projects = ids.map(proj);
  save();
  render();
}

document.addEventListener('dragstart', e => {
  const el = e.target.closest && e.target.closest('[data-dnd]');
  if (!el) return;
  dragState = { kind: el.dataset.dnd, id: el.dataset.did };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragState.id);
  setTimeout(() => el.classList.add('dragging'), 0);
});

document.addEventListener('dragover', e => {
  if (!dragState) return;
  if (dragState.kind === 'task') return taskDragOver(e);
  const t = e.target.closest && e.target.closest(`[data-dnd="${dragState.kind}"]`);
  document.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  dropMark = null;
  if (!t || t.dataset.did === dragState.id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const r = t.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  const after = t.dataset.axis === 'x'
    ? (rtl ? e.clientX < r.left + r.width / 2 : e.clientX > r.left + r.width / 2)
    : e.clientY > r.top + r.height / 2;
  t.classList.add(after ? 'drop-after' : 'drop-before');
  dropMark = { id: t.dataset.did, after };
});

/** Board: hovering a card marks the gap before/after it; hovering empty column space marks the whole column */
function taskDragOver(e) {
  document.querySelectorAll('.drop-before, .drop-after, .drop-col').forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-col'));
  dropMark = null;
  const col = e.target.closest && e.target.closest('[data-col]');
  const src = findTask(dragState.id);
  if (!col || !src || col.dataset.pid !== src.p.id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const card = e.target.closest('[data-dnd="task"]');
  if (card && card.dataset.did !== dragState.id) {
    const r = card.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    card.classList.add(after ? 'drop-after' : 'drop-before');
    dropMark = { col: col.dataset.col, id: card.dataset.did, after };
  } else {
    col.classList.add('drop-col');
    dropMark = { col: col.dataset.col };
  }
}

document.addEventListener('drop', e => {
  if (!dragState || !dropMark) return;
  e.preventDefault();
  const { kind, id } = dragState, mark = dropMark;
  dragState = null; dropMark = null;
  dndClear();
  if (kind === 'task') moveTask(id, mark.col, mark.id, mark.after);
  else dndReorder(kind, id, mark.id, mark.after);
});

document.addEventListener('dragend', () => {
  dragState = null;
  dropMark = null;
  dndClear();
});
