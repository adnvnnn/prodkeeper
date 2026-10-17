'use strict';

/* ======================= تسک‌ها (کارهای نگهداری هر برنامه) ======================= */
const T_PRIO = ['کم', 'متوسط', 'زیاد'];
const T_STATUS = { todo: 'در انتظار', doing: 'در حال انجام', done: 'انجام‌شده' };
const T_REPEATS = [[0, 'بدون تکرار'], [7, 'هر هفته'], [30, 'هر ماه'], [90, 'هر ۳ ماه'], [365, 'هر سال']];

const openTasks = p => p.tasks.filter(t => t.status !== 'done');
const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.priority - a.priority;
function addDaysISO(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

function taskDueChip(t) {
  if (!t.due) return '';
  const d = diffDays(t.due);
  let cls = '', label = fmtDate(t.due);
  if (t.status !== 'done') {
    if (d < 0) { cls = 'late'; label = `${fa(-d)} روز تأخیر`; }
    else if (d === 0) { cls = 'today'; label = 'امروز'; }
    else if (d === 1) { cls = 'soon'; label = 'فردا'; }
    else if (d <= 3) cls = 'soon';
  }
  return chip(label, cls, I.cal);
}

function taskRowHtml(p, t, showProject) {
  const done = t.status === 'done';
  const rep = T_REPEATS.find(r => r[0] === t.repeat);
  return `<div class="trow ${done ? 'done' : ''}" data-action="task-edit" data-pid="${p.id}" data-id="${t.id}">
    <button class="check ${done ? 'on' : ''}" data-action="task-toggle" data-pid="${p.id}" data-id="${t.id}" title="${done ? 'بازگرداندن' : 'انجام شد'}">${done ? I.tick : ''}</button>
    <span class="pdot p${t.priority}" title="اولویت ${T_PRIO[t.priority]}"></span>
    <span class="tt">${esc(t.title)}${t.notes ? `<div class="sub" style="font-size:12px">${esc(t.notes.split('\n')[0].slice(0, 90))}</div>` : ''}</span>
    ${showProject ? chip(`<span class="pdot" style="background:${p.color};width:7px;height:7px"></span>${esc(p.name)}`, '') : ''}
    ${t.status === 'doing' ? chip('در حال انجام', 'soon') : ''}
    ${t.repeat > 0 && rep ? chip(rep[1], '', I.refresh) : ''}
    ${taskDueChip(t)}</div>`;
}

function tabTasks(p) {
  const f = V.tfilter || 'open';
  let list = p.tasks.filter(t => f === 'all' ? true : f === 'done' ? t.status === 'done' : t.status !== 'done');
  list = list.sort((a, b) => (a.status === 'done') - (b.status === 'done') || byDue(a, b));
  const seg = (v, l) => `<button class="${f === v ? 'on' : ''}" data-action="tfilter" data-v="${v}">${l}</button>`;
  const late = openTasks(p).filter(t => t.due && diffDays(t.due) < 0).length;
  return `<div class="page-head" style="margin-top:0"><div class="seg">${seg('open', `باز (${fa(openTasks(p).length)})`)}${seg('done', 'انجام‌شده')}${seg('all', 'همه')}</div>
      ${late ? chip(`${fa(late)} عقب‌افتاده`, 'late') : ''}<span class="grow"></span>
      <button class="btn primary" data-action="task-new" data-pid="${p.id}">${I.plus}تسک جدید</button></div>
    <div class="card section">
      <div class="quick-add"><input type="text" data-tquick="${p.id}" placeholder="تسک جدید (مثلاً: تمدید SSL، آپدیت پکیج‌ها، تست بازیابی بک‌آپ) و Enter"></div>
      ${list.length ? list.map(t => taskRowHtml(p, t, false)).join('') : `<div class="empty" style="padding:24px">${f === 'open' ? 'تسک بازی نیست' : 'موردی نیست'}</div>`}
    </div>`;
}

function viewTasksAll() {
  const f = V.tfilter || 'open';
  const groups = S.projects.map(p => ({ p, list: p.tasks.filter(t => f === 'all' ? true : f === 'done' ? t.status === 'done' : t.status !== 'done').sort(byDue) })).filter(g => g.list.length);
  const seg = (v, l) => `<button class="${f === v ? 'on' : ''}" data-action="tfilter" data-v="${v}">${l}</button>`;
  return `<div class="page-head"><h1>تسک‌ها</h1><div class="seg">${seg('open', 'باز')}${seg('done', 'انجام‌شده')}${seg('all', 'همه')}</div><span class="grow"></span>
      <button class="btn primary" data-action="task-new">${I.plus}تسک جدید</button></div>
    ${groups.length ? groups.map(({ p, list }) => `<div class="card section" style="margin-bottom:14px"><h2><span class="pdot" style="background:${p.color};width:11px;height:11px"></span>${esc(p.name)}<span class="grow"></span><button class="btn sm" data-action="open-project" data-id="${p.id}" data-tab="tasks">باز کردن</button></h2>${list.map(t => taskRowHtml(p, t, false)).join('')}</div>`).join('')
      : `<div class="empty card">${I.tick}<h3>${S.projects.length ? 'تسکی نیست' : 'اول یک برنامه اضافه کنید'}</h3></div>`}`;
}

function taskModal(pid, tid) {
  if (!S.projects.length) { toast('اول یک برنامه بسازید', true); return; }
  const p = proj(pid) || proj(V.pid) || S.projects[0];
  const t = tid ? p.tasks.find(x => x.id === tid) : { title: '', notes: '', status: 'todo', priority: 1, due: '', repeat: 0, projectId: p.id };
  const opt = (arr, cur) => arr.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`).join('');
  openModal(`<form id="taskForm" data-pid="${p.id}" data-id="${tid || ''}">${modalHead(tid ? 'ویرایش تسک' : 'تسک جدید')}
    <div class="body">
      <div class="field"><label>عنوان</label><input type="text" name="title" value="${esc(t.title)}" required placeholder="چه کاری باید انجام شود؟"></div>
      <div class="two"><div class="field"><label>برنامه</label><select name="projectId">${S.projects.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div class="field"><label>وضعیت</label><select name="status">${opt(Object.entries(T_STATUS), t.status)}</select></div></div>
      <div class="two"><div class="field"><label>اولویت</label><select name="priority">${opt(T_PRIO.map((l, i) => [i, l]), t.priority)}</select></div>
        <div class="field"><label>تکرار (برای کارهای دوره‌ای)</label><select name="repeat">${opt(T_REPEATS, t.repeat || 0)}</select></div></div>
      <div class="field"><label>مهلت</label>${dateField('due', t.due)}</div>
      <div class="field"><label>یادداشت</label><textarea name="notes">${esc(t.notes)}</textarea></div>
      <div class="sub">با انجام‌شدن تسک تکراری، نسخهٔ بعدی خودکار با مهلت جدید ساخته می‌شود.</div>
    </div>${footerBtns(tid ? `<button type="button" class="btn danger" data-action="task-del" data-pid="${p.id}" data-id="${tid}">${I.trash}حذف</button>` : '')}</form>`);
}

/** تغییر وضعیت؛ اگر تسک تکراری انجام شد، نمونهٔ بعدی ساخته می‌شود */
function setTaskStatus(p, t, status) {
  const was = t.status;
  t.status = status;
  t.doneAt = status === 'done' ? Date.now() : null;
  if (status === 'done' && was !== 'done' && t.repeat > 0) {
    const base = t.due && diffDays(t.due) > 0 ? t.due : todayISO();
    p.tasks.push({ ...t, id: uid(), status: 'todo', doneAt: null, createdAt: Date.now(), due: addDaysISO(base, t.repeat) });
    toast(`تسک بعدی برای ${fmtDate(addDaysISO(base, t.repeat))} ساخته شد`);
  }
}

Object.assign(actions, {
  'task-new': el => taskModal(el.dataset.pid || (V.name === 'project' ? V.pid : ''), ''),
  'task-edit': el => taskModal(el.dataset.pid, el.dataset.id),
  'task-toggle': el => {
    const p = proj(el.dataset.pid), t = p.tasks.find(x => x.id === el.dataset.id);
    setTaskStatus(p, t, t.status === 'done' ? 'todo' : 'done');
    save(); render();
  },
  'task-del': async el => {
    if (!(await askConfirm('این تسک حذف شود؟'))) return;
    const p = proj(el.dataset.pid);
    p.tasks = p.tasks.filter(x => x.id !== el.dataset.id);
    save(); closeModal(); render();
  },
  tfilter: el => { V.tfilter = el.dataset.v; render(); },
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.id !== 'taskForm') return;
  e.preventDefault();
  const fd = new FormData(f), title = String(fd.get('title')).trim();
  if (!title) return;
  const oldP = proj(f.dataset.pid), newP = proj(fd.get('projectId')) || oldP;
  const data = { title, notes: String(fd.get('notes')).trim(), priority: Number(fd.get('priority')), repeat: Number(fd.get('repeat')), due: readDate(f, 'due') };
  const status = fd.get('status');
  let t;
  if (f.dataset.id) {
    t = oldP.tasks.find(x => x.id === f.dataset.id);
    Object.assign(t, data);
    if (oldP !== newP) { oldP.tasks = oldP.tasks.filter(x => x !== t); newP.tasks.push(t); }
    if (t.status !== status) setTaskStatus(newP, t, status);
  } else {
    t = { id: uid(), createdAt: Date.now(), doneAt: null, status: 'todo', ...data };
    newP.tasks.push(t);
    if (status !== 'todo') setTaskStatus(newP, t, status);
  }
  save(); closeModal(); render(); toast('ذخیره شد');
});

// افزودن سریع: عنوان + Enter
document.addEventListener('keydown', e => {
  const pid = e.target.dataset && e.target.dataset.tquick;
  if (!pid || e.key !== 'Enter') return;
  e.preventDefault();
  const title = e.target.value.trim();
  if (!title) return;
  proj(pid).tasks.push({ id: uid(), createdAt: Date.now(), doneAt: null, status: 'todo', title, notes: '', priority: 1, repeat: 0, due: '' });
  save(); render();
  const again = document.querySelector(`[data-tquick="${pid}"]`);
  if (again) again.focus();
});
