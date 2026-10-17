'use strict';

const $ = s => document.querySelector(s);
const native = window.api;
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fa = n => Number(n).toLocaleString('fa-IR', { useGrouping: false });
const pad = n => String(n).padStart(2, '0');

const I = {};
[
  ['grid', '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'],
  ['folder', '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'],
  ['tick', '<polyline points="20 6 9 17 4 12"/>'],
  ['sliders', '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'],
  ['plus', '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'],
  ['play', '<polygon points="6 3 20 12 6 21 6 3"/>'],
  ['stop', '<rect x="6" y="6" width="12" height="12" rx="1"/>'],
  ['trash', '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'],
  ['edit', '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'],
  ['clock', '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'],
  ['x', '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'],
  ['branch', '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>'],
  ['deploy', '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>'],
  ['db', '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'],
  ['key', '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'],
  ['activity', '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'],
  ['refresh', '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'],
  ['copy', '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'],
  ['eye', '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'],
  ['lock', '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'],
  ['ext', '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'],
  ['term', '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>'],
  ['alert', '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'],
  ['tag', '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'],
  ['down', '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'],
  ['up', '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'],
  ['merge', '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>'],
  ['globe', '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'],
  ['cal', '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'],
].forEach(([k, d]) => (I[k] = `<svg viewBox="0 0 24 24">${d}</svg>`));

/* ======================= تاریخ شمسی ======================= */
function g2j(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}
function j2g(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const sal = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm;
  for (gm = 0; gm < 13 && gd > sal[gm]; gm++) gd -= sal[gm];
  return [gy, gm, gd];
}
const JMONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
function jMonthLen(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  const [gy, gm, gd] = j2g(jy, 12, 30);
  const r = g2j(gy, gm, gd);
  return r[0] === jy && r[1] === 12 && r[2] === 30 ? 30 : 29;
}

const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const todayISO = () => toISO(new Date());
const diffDays = iso => Math.round((parseISO(iso) - parseISO(todayISO())) / 864e5);
const jOf = iso => { const d = parseISO(iso); return g2j(d.getFullYear(), d.getMonth() + 1, d.getDate()); };

function fmtDate(iso) {
  if (!iso) return '';
  const [jy, jm, jd] = jOf(iso);
  return `${fa(jd)} ${JMONTHS[jm - 1]}${jy !== jOf(todayISO())[0] ? ' ' + fa(jy) : ''}`;
}
function fmtTs(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${fmtDate(toISO(d))} ${fa(pad(d.getHours()))}:${fa(pad(d.getMinutes()))}`;
}
function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'لحظاتی پیش';
  if (s < 3600) return `${fa(Math.floor(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${fa(Math.floor(s / 3600))} ساعت پیش`;
  if (s < 86400 * 45) return `${fa(Math.floor(s / 86400))} روز پیش`;
  return fmtDate(toISO(new Date(ms)));
}
function fmtSec(s) {
  s = Math.round(s);
  if (s < 60) return `${fa(s)} ثانیه`;
  if (s < 3600) return `${fa(Math.floor(s / 60))} دقیقه و ${fa(s % 60)} ثانیه`;
  return `${fa(Math.floor(s / 3600))} ساعت و ${fa(Math.floor((s % 3600) / 60))} دقیقه`;
}
function fmtSize(b) {
  if (!b) return '۰';
  const u = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
  let i = 0;
  while (b >= 1024 && i < 3) { b /= 1024; i++; }
  return `${Number(b.toFixed(i ? 1 : 0)).toLocaleString('fa-IR')} ${u[i]}`;
}

/** انتخاب‌گر تاریخ شمسی با سه لیست */
function dateField(name, iso) {
  const [cy] = jOf(todayISO());
  let jy = '', jm = '', jd = '';
  if (iso) [jy, jm, jd] = jOf(iso);
  const from = Math.min(cy - 1, jy || cy), to = Math.max(cy + 6, jy || cy);
  const opts = (arr, sel) => arr.map(([v, l]) => `<option value="${v}" ${String(v) === String(sel) ? 'selected' : ''}>${l}</option>`).join('');
  const days = Array.from({ length: 31 }, (_, i) => [i + 1, fa(i + 1)]);
  const months = JMONTHS.map((m, i) => [i + 1, m]);
  const years = Array.from({ length: to - from + 1 }, (_, i) => [from + i, fa(from + i)]);
  return `<div class="datef" data-name="${name}">
    <select data-p="d"><option value="">روز</option>${opts(days, jd)}</select>
    <select data-p="m"><option value="">ماه</option>${opts(months, jm)}</select>
    <select data-p="y"><option value="">سال</option>${opts(years, jy)}</select>
    <button type="button" class="btn sm" data-action="date-clear">پاک‌کردن</button></div>`;
}
function readDate(root, name) {
  const f = root.querySelector(`.datef[data-name="${name}"]`);
  const v = p => Number(f.querySelector(`[data-p="${p}"]`).value);
  const y = v('y'), m = v('m');
  let d = v('d');
  if (!y || !m || !d) return '';
  d = Math.min(d, jMonthLen(y, m));
  const [gy, gm, gd] = j2g(y, m, d);
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}

/* ======================= پنجره‌ها و اعلان ======================= */
let onModalClose = null;
function openModal(html, { small, wide } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="dialog ${small ? 'small' : ''} ${wide ? 'wide' : ''}">${html}</div>`;
  m.hidden = false;
  const f = m.querySelector('input[type=text],input[type=password]');
  if (f) { f.focus(); f.select && f.select(); }
}
function closeModal() {
  $('#modal').hidden = true;
  $('#modal').innerHTML = '';
  if (onModalClose) { const f = onModalClose; onModalClose = null; f(); }
}
function askConfirm(msg, okLabel = 'حذف', danger = true) {
  return new Promise(res => {
    const c = $('#confirm');
    c.innerHTML = `<div class="dialog small"><div class="body" style="padding-top:22px;white-space:pre-line">${esc(msg)}</div>
      <footer><button class="btn ${danger ? 'danger' : 'primary'}" id="cYes">${okLabel}</button><button class="btn" id="cNo">انصراف</button></footer></div>`;
    c.hidden = false;
    const done = v => { c.hidden = true; c.innerHTML = ''; res(v); };
    $('#cYes').onclick = () => done(true);
    $('#cNo').onclick = () => done(false);
    $('#cNo').focus();
  });
}
let toastT;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', !!bad);
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), bad ? 4500 : 2200);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

/* ======================= لیست کشویی سفارشی =======================
 * منوی بازشدهٔ select بومی را نمی‌شود استایل داد؛ پس هر select با یک دکمه + منوی خودمان جایگزین می‌شود
 * و select اصلی (مخفی) همچنان مقدار فرم و رویداد change را نگه می‌دارد. */
let ddMenu = null, ddOwner = null;

function ddLabel(sel) {
  const o = sel.options[sel.selectedIndex];
  return o ? o.textContent : '';
}
function ddSync(sel) {
  const b = sel.parentElement && sel.parentElement.querySelector('.dd-btn');
  if (!b) return;
  b.textContent = ddLabel(sel);
  b.disabled = sel.disabled;
}
function ddClose() {
  if (ddMenu) { ddMenu.remove(); ddMenu = null; }
  if (ddOwner) { ddOwner.btn.setAttribute('aria-expanded', 'false'); ddOwner = null; }
}
function ddOpen(sel, btn) {
  ddClose();
  const m = document.createElement('div');
  m.className = 'dd-menu';
  m.setAttribute('role', 'listbox');
  [...sel.options].forEach((o, i) => {
    const it = document.createElement('div');
    it.className = 'dd-item' + (i === sel.selectedIndex ? ' on' : '');
    it.dataset.i = i;
    it.textContent = o.textContent;
    if (o.disabled) it.classList.add('dis');
    m.appendChild(it);
  });
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.minWidth = r.width + 'px';
  const h = Math.min(m.scrollHeight, 280);
  const below = innerHeight - r.bottom - 8, above = r.top - 8;
  const up = below < h && above > below;
  m.style.maxHeight = Math.min(280, up ? above : below) + 'px';
  m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px'; // هم‌راستا با لبهٔ راست دکمه (RTL)
  m.style.top = (up ? r.top - Math.min(h, above) - 4 : r.bottom + 4) + 'px';
  btn.setAttribute('aria-expanded', 'true');
  ddMenu = m;
  ddOwner = { sel, btn };
  const on = m.querySelector('.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
  m.addEventListener('mousedown', e => e.preventDefault());
  m.addEventListener('click', e => {
    const it = e.target.closest('.dd-item');
    if (it && !it.classList.contains('dis')) ddPick(sel, Number(it.dataset.i));
  });
}
function ddPick(sel, i) {
  const changed = sel.selectedIndex !== i;
  sel.selectedIndex = i;
  ddSync(sel);
  const btn = sel.parentElement.querySelector('.dd-btn');
  ddClose();
  btn.focus();
  if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
}
function ddMove(dir) {
  if (!ddMenu) return;
  const items = [...ddMenu.querySelectorAll('.dd-item:not(.dis)')];
  let k = items.findIndex(x => x.classList.contains('hot'));
  if (k < 0) k = items.findIndex(x => x.classList.contains('on'));
  k = Math.max(0, Math.min(items.length - 1, k + dir));
  ddMenu.querySelectorAll('.hot').forEach(x => x.classList.remove('hot'));
  items[k].classList.add('hot');
  items[k].scrollIntoView({ block: 'nearest' });
}

function ddEnhance(sel) {
  if (sel.dataset.dd) return;
  sel.dataset.dd = '1';
  const wrap = document.createElement('div');
  wrap.className = 'dd';
  if (sel.getAttribute('style')) wrap.style.cssText = sel.getAttribute('style');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  sel.parentNode.insertBefore(wrap, sel);
  wrap.append(btn, sel);
  ddSync(sel);
  btn.addEventListener('click', () => (ddOwner && ddOwner.sel === sel ? ddClose() : ddOpen(sel, btn)));
  btn.addEventListener('keydown', e => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      if (!ddMenu) ddOpen(sel, btn);
      else if (e.key === 'ArrowDown') ddMove(1);
      else if (e.key === 'ArrowUp') ddMove(-1);
      else {
        const hot = ddMenu.querySelector('.hot') || ddMenu.querySelector('.on');
        if (hot) ddPick(sel, Number(hot.dataset.i)); else ddClose();
      }
    }
  });
  sel.addEventListener('change', () => ddSync(sel));
}
function ddScan(root) { (root || document).querySelectorAll('select:not([data-dd])').forEach(ddEnhance); }

document.addEventListener('mousedown', e => { if (ddMenu && !e.target.closest('.dd-menu, .dd-btn')) ddClose(); });
document.addEventListener('keydown', e => {
  if (ddMenu && e.key === 'Escape') { e.stopImmediatePropagation(); ddClose(); }
}, true);
addEventListener('resize', ddClose);
document.addEventListener('scroll', ddClose, true);
new MutationObserver(() => ddScan()).observe(document.body, { childList: true, subtree: true });
ddScan();
