'use strict';

/* ======================= Command palette (Ctrl+K), hotkeys and top-menu icons ======================= */
document.querySelector('#topbar [data-action="palette"]').innerHTML = I.search;
document.querySelector('#topbar [data-action="lock-now"]').innerHTML = I.lock;

let palState = null;
function paletteItems() {
  const it = [];
  NAV_ITEMS.forEach(([name, label]) => it.push({ k: 'Go to', n: label, run: () => actions.go({ dataset: { to: name } }) }));
  it.push({ k: 'Action', n: 'New app', run: () => projectModal() });
  it.push({ k: 'Action', n: 'New task', run: () => actions['task-new']({ dataset: {} }) });
  it.push({ k: 'Action', n: 'New vault item', run: () => vaultModal() });
  it.push({ k: 'Action', n: 'Refresh all apps', run: () => refreshAll(true) });
  it.push({ k: 'Action', n: 'Show alerts', run: () => { V.bell = true; renderTopbar(); } });
  it.push({ k: 'Action', n: 'Lock', run: () => lockNow() });
  for (const p of orderedProjects()) TABS.forEach(([t, l]) => it.push({ k: 'App', n: `${p.name} / ${l}`, run: () => openProject(p.id, t) }));
  return it;
}
function paletteDraw() {
  const st = palState, q = st.input.value.toLowerCase().split(/\s+/).filter(Boolean);
  st.list = st.items.filter(i => q.every(w => (i.k + ' ' + i.n).toLowerCase().includes(w))).slice(0, 40);
  st.hot = Math.min(st.hot, Math.max(0, st.list.length - 1));
  st.box.innerHTML = st.list.length ? st.list.map((i, k) => `<div class="pitem ${k === st.hot ? 'hot' : ''}" data-i="${k}"><span class="pk">${i.k}</span><span class="pn">${esc(i.n)}</span></div>`).join('') : '<div class="pitem"><span class="pn sub">No matches</span></div>';
  const hot = st.box.querySelector('.hot');
  if (hot) hot.scrollIntoView({ block: 'nearest' });
}
function paletteClose() {
  $('#palette').hidden = true;
  $('#palette').innerHTML = '';
  palState = null;
}
function paletteRun(i) {
  const item = palState && palState.list[i];
  if (!item) return;
  paletteClose();
  item.run();
}
function paletteOpen() {
  if (!S || locking || !$('#lock').hidden || !$('#modal').hidden || !$('#confirm').hidden) return;
  const el = $('#palette');
  el.innerHTML = `<div class="palette"><div class="pin"><input type="text" id="palIn" placeholder="Search apps, views and actions" autocomplete="off" spellcheck="false"></div>
    <div class="plist" id="palList"></div><div class="pfoot"><span>↑↓ select</span><span>Enter open</span><span>Esc close</span></div></div>`;
  el.hidden = false;
  palState = { items: paletteItems(), list: [], hot: 0, input: $('#palIn'), box: $('#palList') };
  palState.input.addEventListener('input', () => { palState.hot = 0; paletteDraw(); });
  palState.input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      palState.hot = (palState.hot + (e.key === 'ArrowDown' ? 1 : -1) + palState.list.length) % Math.max(1, palState.list.length);
      paletteDraw();
    } else if (e.key === 'Enter') { e.preventDefault(); paletteRun(palState.hot); }
    else if (e.key === 'Escape') { e.preventDefault(); paletteClose(); }
  });
  palState.box.addEventListener('click', e => { const it = e.target.closest('.pitem[data-i]'); if (it) paletteRun(Number(it.dataset.i)); });
  paletteDraw();
  palState.input.focus();
}
Object.assign(actions, { palette: () => (palState ? paletteClose() : paletteOpen()) });
document.addEventListener('mousedown', e => { if (e.target.id === 'palette') paletteClose(); });

/* Hotkeys: Ctrl+K search, Ctrl+1..5 views, Alt+1..9 project tabs */
document.addEventListener('keydown', e => {
  if (!S || locking || !$('#lock').hidden) return;
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); actions.palette(); return; }
  if (palState || !$('#modal').hidden || !$('#confirm').hidden) return;
  if (e.ctrlKey && !e.altKey && /^[1-5]$/.test(e.key)) {
    e.preventDefault();
    actions.go({ dataset: { to: NAV_ITEMS[Number(e.key) - 1][0] } });
  } else if (e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key) && V.name === 'project' && TABS[Number(e.key) - 1]) {
    e.preventDefault();
    actions['set-tab']({ dataset: { tab: TABS[Number(e.key) - 1][0] } });
  }
});
