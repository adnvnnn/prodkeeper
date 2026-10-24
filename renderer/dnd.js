'use strict';

/* ======================= Drag and drop: reordering apps on the dashboard =======================
 * Only apps can be moved. Apps are always grouped by priority; the drag order is kept within a group,
 * and dropping an app onto one of another priority moves it to that priority. */
let dragState = null, dropMark = null;

function dndClear() {
  document.querySelectorAll('.dragging, .drop-before, .drop-after').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after'));
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

document.addEventListener('drop', e => {
  if (!dragState || !dropMark) return;
  e.preventDefault();
  const { kind, id } = dragState, { id: target, after } = dropMark;
  dragState = null; dropMark = null;
  dndReorder(kind, id, target, after);
});

document.addEventListener('dragend', () => {
  dragState = null;
  dropMark = null;
  dndClear();
});
