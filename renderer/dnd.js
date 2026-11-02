'use strict';

/* ======================= Drag and drop: reordering projects on the projects page, moving tasks on the board =======================
 * Projects are always grouped by priority; the drag order is kept within a group, and dropping a project onto one of another
 * priority moves it to that priority. Tasks move between board columns (or are reordered inside one); the board
 * only accepts tasks of its own app.
 * Items of a project list (deploys, backups, publish / database-update operations) are reordered by dragging their card
 * (draggable must be in the markup: Chromium ignores it being switched on at mousedown). An item can only be dropped inside
 * its own list (data-list). While dragging, the page scrolls when the pointer nears the top or bottom edge. */
let dragState = null, dropMark = null;

const dndGrip = `<span class="grip" title="Drag to reorder">${I.grip}</span>`;
const dndItem = (list, id) => `draggable="true" data-dnd="item" data-list="${list}" data-axis="y" data-did="${id}"`;

/** The array a list key points at; ops lists hold one operation type of p.ops */
function dndList(p, key) {
  if (key.startsWith('ops:')) return p.ops.filter(o => o.type === key.slice(4));
  return p[key];
}

/** Move an item inside one of the current project's lists, writing the new order back (ops keep the slots of their type) */
function dndReorderItem(list, id, targetId, after) {
  const p = proj(V.pid);
  if (!p || id === targetId) return;
  const items = dndList(p, list).slice();
  const from = items.findIndex(x => x.id === id);
  if (from < 0) return;
  const [it] = items.splice(from, 1);
  const to = items.findIndex(x => x.id === targetId);
  if (to < 0) return;
  items.splice(after ? to + 1 : to, 0, it);
  if (list.startsWith('ops:')) {
    let n = 0;
    p.ops = p.ops.map(o => o.type === list.slice(4) ? items[n++] : o);
  } else p[list] = items;
  save();
  render();
}

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
  dragState = { kind: el.dataset.dnd, id: el.dataset.did, list: el.dataset.list };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragState.id);
  setTimeout(() => el.classList.add('dragging'), 0);
  dragY = e.clientY;
  clearInterval(scrollTimer);
  scrollTimer = setInterval(dndAutoScroll, 16);
});

/** While dragging, the page scrolls when the pointer nears the top or bottom edge of the content area (or leaves it above / below) */
let dragY = null, scrollTimer = 0;
function dndAutoScroll() {
  if (!dragState) return clearInterval(scrollTimer);
  const m = document.getElementById('main'), r = m.getBoundingClientRect(), zone = 110, max = 26;
  let v = 0;
  if (dragY < r.top + zone) v = -Math.min(max, 4 + (r.top + zone - dragY) / zone * max);
  else if (dragY > r.bottom - zone) v = Math.min(max, 4 + (dragY - (r.bottom - zone)) / zone * max);
  if (v) m.scrollTop += v;
}

/** The item of the dragged one's own list nearest to the pointer: lets a drop land in the gaps, on headings and past either end */
function dndNearestItem(y) {
  let best = null, bd = Infinity;
  document.querySelectorAll(`[data-dnd="item"][data-list="${dragState.list}"]`).forEach(c => {
    if (c.dataset.did === dragState.id) return;
    const r = c.getBoundingClientRect(), d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < bd) { bd = d; best = c; }
  });
  return best;
}

document.addEventListener('dragover', e => {
  if (!dragState) return;
  dragY = e.clientY;
  if (dragState.kind === 'task') return taskDragOver(e);
  let t = e.target.closest && e.target.closest(`[data-dnd="${dragState.kind}"]`);
  document.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  dropMark = null;
  if (!t && dragState.kind === 'item' && e.target.closest && e.target.closest('#main')) t = dndNearestItem(e.clientY);
  if (!t || t.dataset.did === dragState.id || t.dataset.list !== dragState.list) return;
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
  const { kind, id, list } = dragState, mark = dropMark;
  dragState = null; dropMark = null;
  dndClear();
  if (kind === 'task') moveTask(id, mark.col, mark.id, mark.after);
  else if (kind === 'item') dndReorderItem(list, id, mark.id, mark.after);
  else dndReorder(kind, id, mark.id, mark.after);
});

document.addEventListener('dragend', () => {
  dragState = null;
  dragY = null;
  clearInterval(scrollTimer);
  dropMark = null;
  dndClear();
});
