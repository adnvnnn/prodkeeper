'use strict';

/* Draws the task snapshot pushed by the main window. Text is always set with textContent. */
const body = document.getElementById('pBody');
const ICON = {
  ext: '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  x: '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};
document.getElementById('pOpen').innerHTML = ICON.ext;
document.getElementById('pClose').innerHTML = ICON.x;
document.getElementById('pOpen').onclick = () => popup.act({ type: 'open' });
document.getElementById('pClose').onclick = () => popup.act({ type: 'close' });
addEventListener('keydown', e => { if (e.key === 'Escape') popup.act({ type: 'close' }); });

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const GROUPS = [['doing', 'In progress'], ['todo', 'To do']];

function draw(d) {
  document.documentElement.dataset.theme = d && d.theme ? (d.theme === 'light' ? 'light' : 'dark') : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  body.replaceChildren();
  if (!d || d.locked) {
    const box = el('div', 'locked');
    const mark = el('div', 'lockmark');
    mark.innerHTML = ICON.lock;
    box.append(mark, el('div', 'lt', 'Locked'), el('div', 'none', 'Unlock ProdKeeper to see your tasks.'));
    body.append(box);
    return;
  }
  let any = false;
  for (const [status, label] of GROUPS) {
    const list = d.items.filter(t => t.status === status);
    if (!list.length) continue;
    any = true;
    const g = el('div', 'grp');
    g.append(el('span', '', label), el('span', '', String(list.length)));
    body.append(g);
    for (const t of list) {
      const row = el('div', 'item');
      const chk = el('button', 'check');
      chk.title = 'Mark done';
      chk.onclick = e => { e.stopPropagation(); popup.act({ type: 'done', id: t.id }); };
      const meta = el('div', 'sub');
      meta.append(el('span', 'tk', t.key), el('span', '', t.app));
      if (t.estimate) meta.append(el('span', '', t.estimate + ' pt'));
      const it = el('div', 'it');
      it.append(el('div', 'tt', t.title), meta);
      row.append(chk, el('span', 'pdot p' + t.priority), it);
      row.onclick = () => popup.act({ type: 'open', pid: t.pid });
      body.append(row);
    }
  }
  if (!any) body.append(el('div', 'none', 'Nothing in progress or to do.'));
}

popup.onData(draw);
popup.ready().then(draw);
