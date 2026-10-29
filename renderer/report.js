'use strict';

/* ======================= Reports: what was done over any period =======================
 * Everything is derived from data the app already keeps: tasks (created / started / done times, points, priority),
 * sprints, the long-lived operation log (S.runlog), site checks and the git history of each app (read on demand).
 * Charts are plain SVG/HTML, so nothing is loaded from outside and they follow the theme. */
const REP_RANGES = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['3m', 'Last 3 months'], ['thisq', 'This quarter'], ['lastq', 'Last quarter'], ['6m', 'Last 6 months'], ['year', 'This year'], ['custom', 'Custom range']];
const REP_OPS = [['deploy', 'Deploy'], ['dbupdate', 'Database update'], ['backup', 'Backup'], ['publish', 'Publish']];
const REP_CACHE_MS = 5 * 60e3;
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WD_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY = 864e5;

V.rep = { range: '30d', from: '', to: '', pid: '', mine: true };
C.rep = {}; // git activity per app: pid -> { since, at, me, commits, err, loading }

/* ---------- Dates ---------- */
const dayStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayEnd = d => { const x = dayStart(d); x.setDate(x.getDate() + 1); return new Date(x - 1); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => addDays(dayStart(d), -((d.getDay() + 6) % 7));
const wdIdx = d => (d.getDay() + 6) % 7;
const monthsBack = (d, n) => {
  const f = new Date(d.getFullYear(), d.getMonth() - n, 1);
  return new Date(f.getFullYear(), f.getMonth(), Math.min(d.getDate(), monthLen(f.getFullYear(), f.getMonth() + 1)));
};
const fmtDay = d => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const fmtFull = d => `${fmtDay(d)}, ${d.getFullYear()}`;
const fmtN = n => Number(n).toLocaleString('en-US');
const sumOf = (list, f) => list.reduce((n, x) => n + f(x), 0);

/** The chosen period, the same-length period right before it (for comparison) and how to group time */
function repRange(R) {
  const today = dayStart(new Date()), y = today.getFullYear(), m = today.getMonth();
  let from = today, to = today;
  switch (R.range) {
    case '7d': from = addDays(today, -6); break;
    case '30d': from = addDays(today, -29); break;
    case 'month': from = new Date(y, m, 1); break;
    case 'lastmonth': from = new Date(y, m - 1, 1); to = new Date(y, m, 0); break;
    case '3m': from = addDays(monthsBack(today, 3), 1); break;
    case '6m': from = addDays(monthsBack(today, 6), 1); break;
    case 'thisq': from = new Date(y, m - (m % 3), 1); break;
    case 'lastq': from = new Date(y, m - (m % 3) - 3, 1); to = new Date(y, m - (m % 3), 0); break;
    case 'year': from = new Date(y, 0, 1); break;
    case 'custom': {
      from = R.from ? dayStart(parseISO(R.from)) : addDays(today, -29);
      to = R.to ? dayStart(parseISO(R.to)) : today;
      if (to < from) to = from;
      break;
    }
  }
  to = dayEnd(to);
  const days = Math.round((dayStart(to) - from) / DAY) + 1;
  const pfrom = addDays(from, -days), pto = new Date(from - 1);
  return { from, to, pfrom, pto, days, gran: days <= 31 ? 'day' : days <= 140 ? 'week' : 'month',
    label: `${fmtFull(from)} – ${fmtFull(dayStart(to))}`, plabel: `${fmtFull(pfrom)} – ${fmtFull(dayStart(pto))}` };
}

/** Consecutive time slices (days, weeks or months) covering the range; s/e are inclusive millisecond bounds */
function repBuckets({ from, to, gran }) {
  const out = [];
  if (gran === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ s: d.getTime(), e: dayEnd(d).getTime(), label: String(d.getDate()), title: `${WD[wdIdx(d)]}, ${fmtFull(d)}` });
  } else if (gran === 'week') {
    for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) {
      const s = w < from ? from : w, e = dayEnd(addDays(w, 6)) > to ? to : dayEnd(addDays(w, 6));
      out.push({ s: s.getTime(), e: e.getTime(), label: fmtDay(s), title: `${fmtDay(s)} – ${fmtDay(e)}` });
    }
  } else {
    const multi = from.getFullYear() !== to.getFullYear();
    for (let c = new Date(from.getFullYear(), from.getMonth(), 1); c <= to; c = new Date(c.getFullYear(), c.getMonth() + 1, 1)) {
      const s = c < from ? from : c, end = dayEnd(new Date(c.getFullYear(), c.getMonth() + 1, 0)), e = end > to ? to : end;
      out.push({ s: s.getTime(), e: e.getTime(), label: MONTHS[c.getMonth()] + (multi ? ` ${String(c.getFullYear()).slice(2)}` : ''), title: `${MONTHS[c.getMonth()]} ${c.getFullYear()}` });
    }
  }
  return out;
}
const bucketOf = (buckets, ts) => buckets.findIndex(b => ts >= b.s && ts <= b.e);
const countBy = (buckets, list, ts) => { const v = buckets.map(() => 0); for (const x of list) { const i = bucketOf(buckets, ts(x)); if (i >= 0) v[i]++; } return v; };

/* ---------- Data ---------- */
function repScope() {
  if (V.rep.pid && !proj(V.rep.pid)) V.rep.pid = '';
  return S.projects.filter(p => !V.rep.pid || p.id === V.rep.pid);
}
/** Live tasks plus finished tasks that were deleted later (archive) */
function repTasks(scope) {
  const out = [];
  for (const p of S.projects) if (scope.has(p.id)) for (const t of p.tasks) out.push({ pid: p.id, app: p.name, t });
  for (const a of S.archive) { const p = proj(a.pid); if (p && scope.has(a.pid)) out.push({ pid: a.pid, app: p.name, t: a.t }); }
  return out;
}
function repCommits(scope) {
  const out = [];
  for (const pid of scope) {
    const c = C.rep[pid];
    if (!c || !c.commits) continue;
    const me = (c.me || '').toLowerCase();
    for (const x of c.commits) if (!V.rep.mine || !me || String(x.email).toLowerCase() === me) out.push({ pid, ...x });
  }
  return out;
}
function loadRepCommits(p, since) {
  C.rep[p.id] = { ...(C.rep[p.id] || {}), loading: true };
  native.git('activity', p.repoPath, { since }).then(r => {
    C.rep[p.id] = r.error ? { since, at: Date.now(), err: r.error, commits: [] } : { since, at: Date.now(), me: r.me, commits: r.commits };
    repRender();
  });
}
/** Reads git history for the apps in scope (back to the start of the comparison period), at most once per few minutes */
function repEnsure(rng) {
  const need = rng.pfrom.getTime();
  for (const p of repScope()) {
    const c = C.rep[p.id];
    if (!p.repoPath || (c && c.loading)) continue;
    if (c && c.since <= need && Date.now() - c.at < REP_CACHE_MS) continue;
    loadRepCommits(p, need);
  }
}
function repRender() {
  if (V.name !== 'reports' || (typeof locking !== 'undefined' && locking)) return;
  const m = $('#main'), y = m.scrollTop;
  render();
  m.scrollTop = y;
}

const median = a => (a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null);

function repModel() {
  const R = V.rep, rng = repRange(R), scope = new Set(repScope().map(p => p.id));
  repEnsure(rng);
  const tasks = repTasks(scope), commits = repCommits(scope), runs = S.runlog.filter(r => scope.has(r.pid));
  const slice = (from, to) => {
    const f = from.getTime(), t = to.getTime(), ok = ts => ts >= f && ts <= t;
    const done = tasks.filter(x => x.t.doneAt && ok(x.t.doneAt)), created = tasks.filter(x => x.t.createdAt && ok(x.t.createdAt));
    const rs = runs.filter(r => ok(r.t)), cm = commits.filter(c => ok(c.ts));
    // moments that show "you at work": scheduled backups do not count
    const human = [...cm.map(c => c.ts), ...done.map(x => x.t.doneAt), ...created.map(x => x.t.createdAt), ...rs.filter(r => !r.a).map(r => r.t)];
    const lead = done.filter(x => x.t.createdAt).map(x => Math.max(0, x.t.doneAt - x.t.createdAt)).sort((a, b) => a - b);
    return { done, created, runs: rs, commits: cm, human, activeDays: new Set(human.map(ts => toISO(new Date(ts)))).size,
      pts: sumOf(done, x => x.t.estimate || 0), add: sumOf(cm, c => c.add), del: sumOf(cm, c => c.del), lead, medianLead: median(lead) };
  };
  return { R, rng, scope, tasks, commits, runs, cur: slice(rng.from, rng.to), prev: slice(rng.pfrom, rng.pto), buckets: repBuckets(rng) };
}
const ofKind = (runs, k) => runs.filter(r => r.k === k);
const okCount = runs => runs.filter(r => r.s === 'ok').length;
const failCount = runs => runs.filter(r => r.s === 'fail').length; // stopped / interrupted runs are neither succeeded nor failed

/* ---------- Small formatters ---------- */
function fmtSpan(ms) {
  if (ms == null) return '—';
  const h = ms / 36e5;
  if (h < 1) return '< 1 h';
  if (h < 48) return `${Math.round(h)} h`;
  const d = h / 24;
  return `${d < 14 ? Math.round(d * 10) / 10 : Math.round(d)} d`;
}
function deltaText(c, p) {
  if (!p && !c) return 'no activity either period';
  if (!p) return '▲ none in previous period';
  const pct = Math.round((c - p) / p * 100);
  return pct === 0 ? '= same as previous' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs previous`;
}
const pctOf = (a, b) => (b ? Math.round(a / b * 100) : null);

/* ---------- SVG charts ---------- */
function niceScale(max) {
  if (max <= 0) return { m: 4, step: 1 };
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map(k => k * p).find(s => s >= raw));
  return { m: Math.ceil(max / step) * step, step };
}
const fmtK = v => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${+(v / 1e3).toFixed(1)}k` : fmtN(v));
/** Bar with only its top corners rounded, so it sits flat on the baseline */
const barPath = (x, y, w, h, r) => { r = Math.min(r, w / 2, h); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; };
const tipAttr = lines => `data-tip="${esc(lines.filter(Boolean).join('\n'))}"`;

/** Axes, gridlines and hover columns shared by the bar and line charts. `draw(frame)` returns the marks. */
function plot({ cats, max, h = 210, label, hover, draw }) {
  const W = 640, ml = 38, mr = 6, mt = 8, mb = 24, pw = W - ml - mr, ph = h - mt - mb, n = Math.max(1, cats.length);
  const { m, step } = niceScale(max), slot = pw / n;
  const y = v => mt + ph - v / m * ph, cx = i => ml + slot * (i + .5);
  let svg = '';
  for (let v = 0; v <= m; v += step) svg += `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${ml - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${fmtK(v)}</text>`;
  const every = Math.ceil(cats.length / 10);
  cats.forEach((c, i) => { if (i % every === 0) svg += `<text x="${cx(i)}" y="${h - 7}" class="ax" text-anchor="middle">${esc(c.label)}</text>`; });
  svg += draw({ slot, y, cx, base: y(0) });
  cats.forEach((c, i) => { svg += `<rect class="hit" x="${ml + slot * i}" y="${mt}" width="${slot}" height="${ph}" ${tipAttr([c.title, ...hover(i)])}/>`; });
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${svg}</svg>`;
}

/** series: [{ name, color, values }]; stack puts them on top of each other, otherwise side by side */
function barChart({ cats, series, stack, label, extra }) {
  const totals = cats.map((_, i) => (stack ? sumOf(series, s => s.values[i]) : Math.max(...series.map(s => s.values[i]))));
  const k = stack ? 1 : series.length;
  return plot({
    cats, max: Math.max(0, ...totals), label,
    hover: i => [...series.map(s => `${s.name}: ${fmtN(s.values[i])}`), stack && series.length > 1 ? `Total: ${fmtN(totals[i])}` : '', extra ? extra(i) : ''],
    draw: ({ slot, y, cx, base }) => {
      const bw = Math.max(2, Math.min(stack ? 26 : 16, slot * .78 / k - (k > 1 ? 2 : 0))), gw = bw * k + (k - 1) * 2;
      let out = '';
      cats.forEach((c, i) => {
        let x = cx(i) - gw / 2, acc = 0;
        const top = stack ? series.map(s => s.values[i] > 0).lastIndexOf(true) : -1;
        series.forEach((s, j) => {
          const v = s.values[i];
          if (v > 0) {
            // stacked segments are separated by a 2px surface-colored stroke; only the top one gets rounded corners
            const y0 = stack ? y(acc) : base, y1 = y(acc + v), ht = Math.max(1.5, y0 - y1);
            out += !stack || j === top ? `<path d="${barPath(x, y0 - ht, bw, ht, 3)}" fill="${s.color}"/>`
              : `<rect x="${x}" y="${y0 - ht}" width="${bw}" height="${ht}" fill="${s.color}" stroke="var(--panel)" stroke-width="2"/>`;
          }
          if (stack) acc += v; else x += bw + 2;
        });
      });
      return out;
    },
  });
}

function lineChart({ cats, name, values, color, label }) {
  return plot({
    cats, max: Math.max(0, ...values), label, hover: i => [`${name}: ${fmtN(values[i])}`],
    draw: ({ y, cx, base }) => {
      const pts = values.map((v, i) => `${cx(i).toFixed(1)},${y(v).toFixed(1)}`);
      const last = values.length - 1;
      return (values.length > 1 ? `<path d="M${pts.join('L')}L${cx(last)},${base}L${cx(0)},${base}Z" fill="${color}" fill-opacity=".12"/><path d="M${pts.join('L')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` : '')
        + `<circle cx="${cx(last)}" cy="${y(values[last])}" r="4" fill="${color}" stroke="var(--panel)" stroke-width="2"/>`;
    },
  });
}

/** Weekday x hour grid: when the work happens */
function heatChart(stamps) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  stamps.forEach(ts => { const d = new Date(ts); grid[wdIdx(d)][d.getHours()]++; });
  const max = Math.max(1, ...grid.flat()), cell = 22, gap = 2, ml = 34, mt = 2, W = ml + 24 * (cell + gap), H = mt + 7 * (cell + gap) + 16;
  let svg = '';
  WD.forEach((d, r) => { svg += `<text x="${ml - 8}" y="${mt + r * (cell + gap) + 15}" class="ax" text-anchor="end">${d}</text>`; });
  for (let c = 0; c < 24; c += 3) svg += `<text x="${ml + c * (cell + gap) + cell / 2}" y="${H - 3}" class="ax" text-anchor="middle">${pad(c)}</text>`;
  grid.forEach((row, r) => row.forEach((v, c) => {
    svg += `<rect class="hc" x="${ml + c * (cell + gap)}" y="${mt + r * (cell + gap)}" width="${cell}" height="${cell}" rx="3" fill="${v ? 'var(--s1)' : 'var(--panel3)'}" ${v ? `fill-opacity="${(.2 + .8 * v / max).toFixed(2)}"` : ''} ${tipAttr([`${WD_LONG[r]}, ${pad(c)}:00–${pad(c + 1)}:00`, `${fmtN(v)} ${v === 1 ? 'event' : 'events'}`])}/>`;
  }));
  const dayTot = grid.map(r => sumOf(r, x => x)), hourTot = Array.from({ length: 24 }, (_, c) => sumOf(grid, r => r[c]));
  const hasAny = stamps.length > 0;
  return { svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Activity by weekday and hour">${svg}</svg>`,
    busyDay: hasAny ? WD_LONG[dayTot.indexOf(Math.max(...dayTot))] : '', busyHour: hasAny ? hourTot.indexOf(Math.max(...hourTot)) : -1 };
}

/* ---------- HTML pieces ---------- */
const legend = items => `<div class="legend">${items.map(([name, color]) => `<span><i style="background:${color}"></i>${esc(name)}</span>`).join('')}</div>`;
const repCard = (title, body, hint) => `<div class="card section rcard"><h2>${title}${hint ? `<span class="grow"></span><span class="sub rhint">${hint}</span>` : ''}</h2>${body}</div>`;
const none = text => `<div class="sub" style="padding:8px 0">${text}</div>`;

function hbars(rows) {
  const max = Math.max(1, ...rows.map(r => r.v));
  return `<div class="hbars">${rows.map(r => `<div class="hb" ${tipAttr(r.tip)}><span class="hl">${esc(r.l)}${r.sub ? `<small>${r.sub}</small>` : ''}</span><span class="ht"><i style="width:${r.v / max * 100}%"></i></span><span class="hv">${r.t}</span></div>`).join('')}</div>`;
}
function kpi(label, value, sub, c, p) {
  return `<div class="kpi"><span>${label}</span><b>${value}</b><small>${sub || '&nbsp;'}</small><em>${c === undefined ? '' : deltaText(c, p)}</em></div>`;
}

/* ---------- The view ---------- */
function viewReports() {
  if (!S.projects.length) return `<div class="page-head"><h1>Reports</h1></div><div class="empty card">${I.activity}<h3>Add an app first</h3><p>Reports are built from your tasks, deploys, backups and git history.</p></div>`;
  const M = repModel(), { R, rng, cur, prev, buckets, scope } = M;
  const cats = buckets, loading = [...scope].some(id => C.rep[id] && C.rep[id].loading);
  const errs = [...scope].filter(id => C.rep[id] && C.rep[id].err).map(id => `${esc(proj(id).name)}: ${esc(C.rep[id].err)}`);
  const noRepo = S.projects.filter(p => scope.has(p.id) && !p.repoPath).length;
  const sel = (k, opts, val) => `<select data-rep="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

  const filters = `<div class="filters">${sel('range', REP_RANGES, R.range)}
    ${R.range === 'custom' ? `<input type="date" data-rep="from" value="${toISO(rng.from)}" max="${todayISO()}"><span class="sub">to</span><input type="date" data-rep="to" value="${toISO(dayStart(rng.to))}" max="${todayISO()}">` : ''}
    ${sel('pid', [['', 'All apps'], ...S.projects.map(p => [p.id, esc(p.name)])], R.pid)}
    <label class="chk" title="Count only commits made with this repository's git user.email"><input type="checkbox" data-rep="mine" ${R.mine ? 'checked' : ''}> Only my commits</label>
    <span class="grow"></span><button class="btn" data-action="rep-copy">${I.copy}Copy summary</button></div>`;
  const note = `<div class="sub" style="margin-block:-4px 16px">${esc(rng.label)} · compared with ${esc(rng.plabel)} · grouped by ${rng.gran}${loading ? ' ' + chip('Reading git history…', 'soon') : ''}
    ${noRepo ? `<div>${num(noRepo)} ${noRepo === 1 ? 'app has' : 'apps have'} no repository folder, so commits are not counted for ${noRepo === 1 ? 'it' : 'them'}.</div>` : ''}${errs.length ? `<div>Git history unavailable — ${errs.join('; ')}</div>` : ''}</div>`;

  /* headline numbers */
  const dep = k => ofKind(k.runs, 'deploy'), bak = k => ofKind(k.runs, 'backup');
  const tiles = [
    kpi('Tasks completed', fmtN(cur.done.length), `${fmtN(cur.pts)} story points`, cur.done.length, prev.done.length),
    kpi('Tasks created', fmtN(cur.created.length), cur.created.length > cur.done.length ? `${fmtN(cur.created.length - cur.done.length)} more than completed` : 'completed at least as many', cur.created.length, prev.created.length),
    kpi('Commits', fmtN(cur.commits.length), `+${fmtN(cur.add)} / −${fmtN(cur.del)} lines`, cur.commits.length, prev.commits.length),
    kpi('Deploys', fmtN(dep(cur).length), dep(cur).length ? `${pctOf(okCount(dep(cur)), dep(cur).length)}% succeeded` : 'none', dep(cur).length, dep(prev).length),
    kpi('Backups', fmtN(bak(cur).length), bak(cur).length ? `${pctOf(okCount(bak(cur)), bak(cur).length)}% succeeded` : 'none', bak(cur).length, bak(prev).length),
    kpi('DB updates + publishes', fmtN(ofKind(cur.runs, 'dbupdate').length + ofKind(cur.runs, 'publish').length), `${fmtN(ofKind(cur.runs, 'dbupdate').length)} database · ${fmtN(ofKind(cur.runs, 'publish').length)} publish`, ofKind(cur.runs, 'dbupdate').length + ofKind(cur.runs, 'publish').length, ofKind(prev.runs, 'dbupdate').length + ofKind(prev.runs, 'publish').length),
    kpi('Median lead time', fmtSpan(cur.medianLead), 'from created to done'),
    kpi('Active days', `${fmtN(cur.activeDays)} / ${fmtN(rng.days)}`, 'days with any work', cur.activeDays, prev.activeDays),
  ].join('');

  /* time series */
  const doneSeries = countBy(buckets, cur.done, x => x.t.doneAt), createdSeries = countBy(buckets, cur.created, x => x.t.createdAt);
  const open = buckets.map(b => M.tasks.filter(x => x.t.createdAt && x.t.createdAt <= b.e && (!x.t.doneAt || x.t.doneAt > b.e)).length);
  const taskChart = barChart({ cats, label: 'Tasks created and completed', series: [{ name: 'Completed', color: 'var(--s1)', values: doneSeries }, { name: 'Created', color: 'var(--s2)', values: createdSeries }] });
  const openChart = lineChart({ cats, name: 'Open tasks', values: open, color: 'var(--s1)', label: 'Open tasks over time' });
  const cm = countBy(buckets, cur.commits, c => c.ts), cmAdd = buckets.map(() => 0), cmDel = buckets.map(() => 0);
  cur.commits.forEach(c => { const i = bucketOf(buckets, c.ts); if (i >= 0) { cmAdd[i] += c.add; cmDel[i] += c.del; } });
  const commitChart = barChart({ cats, label: 'Commits', series: [{ name: 'Commits', color: 'var(--s3)', values: cm }], extra: i => `+${fmtN(cmAdd[i])} / −${fmtN(cmDel[i])} lines` });
  const opSeries = [['deploy', 'Deploy', 'var(--s1)'], ['dbupdate', 'Database update', 'var(--s2)'], ['backup', 'Backup', 'var(--s3)'], ['publish', 'Publish', 'var(--s4)']]
    .map(([k, name, color]) => ({ name, color, values: countBy(buckets, ofKind(cur.runs, k), r => r.t) }));
  const opsChart = barChart({ cats, label: 'Operations', stack: true, series: opSeries });
  const opRows = REP_OPS.map(([k, name]) => {
    const rs = ofKind(cur.runs, k), ok = okCount(rs), bad = failCount(rs), took = rs.filter(r => r.s === 'ok' && r.d > 0).map(r => r.d);
    return `<tr><td>${name}</td><td>${fmtN(rs.length)}</td><td>${rs.length ? pctOf(ok, rs.length) + '%' : '—'}</td><td>${bad ? `<span class="bad">${fmtN(bad)}</span>` : '0'}</td><td>${took.length ? fmtSec(sumOf(took, x => x) / took.length / 1000) : '—'}</td></tr>`;
  }).join('');

  /* by app, lead time, priority */
  const byApp = orderedProjects().filter(p => scope.has(p.id)).map(p => {
    const d = cur.done.filter(x => x.pid === p.id), c = cur.commits.filter(x => x.pid === p.id), rs = cur.runs.filter(r => r.pid === p.id && r.k !== 'git');
    return { p, d, c, rs, pts: sumOf(d, x => x.t.estimate || 0), fails: rs.filter(r => r.s === 'fail').length };
  }).filter(a => a.d.length || a.c.length || a.rs.length).sort((a, b) => b.d.length - a.d.length || b.c.length - a.c.length);
  const appRows = byApp.map(a => ({ l: a.p.name, v: a.d.length, t: `${fmtN(a.d.length)} ${a.d.length === 1 ? 'task' : 'tasks'}${a.pts ? ` · ${fmtN(a.pts)} pt` : ''}`,
    sub: `${fmtN(a.c.length)} commits · ${fmtN(a.rs.length)} operations${a.fails ? ` · ${fmtN(a.fails)} failed` : ''}`, tip: [a.p.name, `${fmtN(a.d.length)} tasks completed`, `${fmtN(a.pts)} story points`, `${fmtN(a.c.length)} commits`, `${fmtN(a.rs.length)} operations (${fmtN(a.fails)} failed)`] }));
  const LEAD = [['< 1 d', 1], ['1–2 d', 3], ['3–7 d', 8], ['8–14 d', 15], ['15–28 d', 29], ['29+ d', Infinity]];
  const leadVals = LEAD.map(() => 0);
  cur.lead.forEach(ms => { leadVals[LEAD.findIndex(([, max]) => ms / DAY < max)]++; });
  const leadChart = barChart({ cats: LEAD.map(([l]) => ({ label: l, title: `Finished in ${l}` })), label: 'Lead time of completed tasks', series: [{ name: 'Tasks', color: 'var(--s1)', values: leadVals }] });
  const PRIO = [2, 1, 0].map(k => ({ l: `${T_PRIO[k]} priority`, v: cur.done.filter(x => x.t.priority === k).length }));
  const prioRows = PRIO.map(r => ({ l: r.l, v: r.v, t: fmtN(r.v), tip: [r.l, `${fmtN(r.v)} completed`] }));
  const SIZE = [['No estimate', x => !x.t.estimate], ['1–2 pt', x => x.t.estimate >= 1 && x.t.estimate <= 2], ['3–5 pt', x => x.t.estimate >= 3 && x.t.estimate <= 5], ['8+ pt', x => x.t.estimate >= 8]];
  const sizeRows = SIZE.map(([l, f]) => { const v = cur.done.filter(f).length; return { l, v, t: fmtN(v), tip: [l, `${fmtN(v)} completed`] }; });

  /* when the work happens */
  const heat = heatChart(cur.human);

  /* sprints, site health, failures */
  const sprints = S.projects.filter(p => scope.has(p.id)).flatMap(p => (p.sprints || []).filter(s => s.closedAt && s.closedAt >= rng.from && s.closedAt <= rng.to && s.stats).map(s => ({ p, s })))
    .sort((a, b) => b.s.closedAt - a.s.closedAt);
  const velocity = sprints.length ? Math.round(sumOf(sprints, x => x.s.stats.donePts) / sprints.length) : 0;
  const sprintHtml = sprints.length ? `<div class="sub" style="margin-bottom:6px">${fmtN(sprints.length)} sprint${sprints.length > 1 ? 's' : ''} closed${velocity ? ` · average ${fmtN(velocity)} pt per sprint` : ''}</div>`
    + sprints.map(({ p, s }) => { const st = s.stats, pct = pctOf(st.pts ? st.donePts : st.done, st.pts || st.total);
      return `<div class="trow" style="cursor:default"><span class="tt"><b>${esc(s.name)}</b> <span class="sub">${esc(p.name)} · ${fmtDate(s.start)} – ${fmtDate(s.end)}</span></span><span class="sub">${fmtN(st.done)} / ${fmtN(st.total)} tasks${st.pts ? ` · ${fmtN(st.donePts)} / ${fmtN(st.pts)} pt` : ''}</span>${chip(pct == null ? '—' : pct + '%', pct >= 80 ? 'okc' : '')}</div>`; }).join('')
    : none('No sprint was closed in this period.');
  const f0 = rng.from.getTime(), t0 = rng.to.getTime();
  const sites = S.projects.filter(p => scope.has(p.id)).flatMap(p => p.envs.map(e => {
    const cs = (S.checks[e.id] || []).filter(c => c.t >= f0 && c.t <= t0);
    return cs.length ? { p, e, n: cs.length, up: pctOf(cs.filter(c => c.ok).length, cs.length), fails: cs.filter(c => !c.ok).length, ms: Math.round(sumOf(cs.filter(c => c.ok), c => c.ms) / Math.max(1, cs.filter(c => c.ok).length)) } : null;
  })).filter(Boolean);
  const siteHtml = sites.length ? sites.map(x => `<div class="trow" style="cursor:default"><span class="tt"><b><bdi>${esc(x.e.name || x.e.url)}</bdi></b> <span class="sub">${esc(x.p.name)}</span></span>
      <span class="sub">${fmtN(x.n)} checks · avg ${fmtN(x.ms)} ms</span>${x.fails ? chip(`${fmtN(x.fails)} failed`, 'late') : ''}${chip(`${x.up}% up`, x.up >= 99 ? 'okc' : x.up >= 90 ? 'today' : 'late')}</div>`).join('') + '<div class="sub" style="margin-top:8px">Only the latest 120 checks per site are kept, so older periods may be partly covered.</div>'
    : none('No site checks were recorded in this period.');
  const fails = cur.runs.filter(r => r.s === 'fail').sort((a, b) => b.t - a.t);
  const KIND = { deploy: 'Deploy', backup: 'Backup', dbupdate: 'Database update', publish: 'Publish', git: 'Git', run: 'Run', build: 'Build' };
  const failHtml = fails.length ? fails.slice(0, 15).map(r => {
    const log = S.history.some(h => h.id === r.id); // the full log is only there while the (capped) history still holds it
    return `<div class="frow" ${log ? `data-action="log-open" data-id="${r.id}" title="Open the log"` : 'style="cursor:default"'}>${chip('Failed', 'late')}
      <span class="ft"><b><bdi>${esc(r.n || KIND[r.k] || r.k)}</bdi></b><small><bdi>${esc((proj(r.pid) || {}).name || '')}</bdi> · ${KIND[r.k] || esc(r.k)}</small></span><span class="sub fd">${fmtTs(r.t)}</span></div>`;
  }).join('') + (fails.length > 15 ? `<div class="sub" style="margin-top:6px">…and ${fmtN(fails.length - 15)} more</div>` : '')
    : `<div class="okline">${I.tick}No failed operations in this period.</div>`;

  /* the narrative: everything that was finished */
  const doneList = [...cur.done].sort((a, b) => b.t.doneAt - a.t.doneAt);
  const LIST_MAX = 300;
  const shown = new Set(doneList.slice(0, LIST_MAX));
  const doneHtml = doneList.length ? orderedProjects().filter(p => scope.has(p.id)).map(p => {
    const mine = doneList.filter(x => x.pid === p.id), vis = mine.filter(x => shown.has(x));
    return vis.length ? `<div class="cw-app">${esc(p.name)} <span class="sub">${fmtN(mine.length)} ${mine.length === 1 ? 'task' : 'tasks'}${sumOf(mine, x => x.t.estimate || 0) ? ` · ${fmtN(sumOf(mine, x => x.t.estimate || 0))} pt` : ''}</span></div>`
      + vis.map(x => `<div class="trow" style="cursor:default"><span class="sub cw-d">${fmtDay(new Date(x.t.doneAt))}</span><span class="tk">T-${x.t.num}</span><span class="tt">${esc(x.t.title)}</span>${x.t.estimate ? chip(`${fmtN(x.t.estimate)} pt`, '') : ''}</div>`).join('') : '';
  }).join('') + (doneList.length > LIST_MAX ? `<div class="sub" style="margin-top:8px">…and ${fmtN(doneList.length - LIST_MAX)} older tasks in this period</div>` : '')
    : none('No tasks were completed in this period.');

  /* the same numbers as a table (also the accessible alternative to the charts) */
  const dep0 = countBy(buckets, ofKind(cur.runs, 'deploy'), r => r.t), bak0 = countBy(buckets, ofKind(cur.runs, 'backup'), r => r.t);
  const tableHtml = `<table class="rt"><thead><tr><th>Period</th><th>Created</th><th>Completed</th><th>Commits</th><th>Deploys</th><th>Backups</th></tr></thead><tbody>
    ${buckets.map((b, i) => `<tr><td>${esc(b.title)}</td><td>${createdSeries[i]}</td><td>${doneSeries[i]}</td><td>${cm[i]}</td><td>${dep0[i]}</td><td>${bak0[i]}</td></tr>`).join('')}
    </tbody><tfoot><tr><td>Total</td><td>${cur.created.length}</td><td>${cur.done.length}</td><td>${cur.commits.length}</td><td>${dep(cur).length}</td><td>${bak(cur).length}</td></tr></tfoot></table>`;

  const empty = !cur.done.length && !cur.created.length && !cur.commits.length && !cur.runs.length;
  return `<div class="page-head"><h1>Reports</h1></div>${filters}${note}
    ${empty ? `<div class="alert warn" style="cursor:default">${I.alert}<span>Nothing was recorded in this period${loading ? ' yet' : ''}. Pick a longer range, or another app.</span></div>` : ''}
    <div class="kpis">${tiles}</div>
    <div class="cols2 rrow">
      ${repCard('Tasks created and completed', legend([['Completed', 'var(--s1)'], ['Created', 'var(--s2)']]) + taskChart)}
      ${repCard('Open tasks', openChart, 'tasks that still exist')}
    </div>
    <div class="cols2 rrow">
      ${repCard('Commits', commitChart, R.mine ? 'only yours' : 'everyone')}
      ${repCard('Operations', legend(opSeries.map(s => [s.name, s.color])) + opsChart + `<table class="rt"><thead><tr><th>Type</th><th>Runs</th><th>Succeeded</th><th>Failed</th><th>Avg time</th></tr></thead><tbody>${opRows}</tbody></table>`)}
    </div>
    <div class="cols2 rrow">
      ${repCard('Work by app', appRows.length ? hbars(appRows) : none('No activity in this period.'), 'tasks completed')}
      ${repCard('How long tasks took', leadChart + `<div class="sub">Median ${fmtSpan(cur.medianLead)} from created to done · ${fmtN(cur.lead.length)} tasks</div>`)}
    </div>
    <div class="cols2 rrow">
      ${repCard('When you work', heat.svg + `<div class="sub">${heat.busyDay ? `Busiest day: ${heat.busyDay} · busiest hour: ${pad(heat.busyHour)}:00` : 'No activity in this period.'}</div><div class="sub rhint">Counts commits, tasks and operations you ran yourself</div>`)}
      ${repCard('What was finished', `<div class="sub rlab">By priority</div>${hbars(prioRows)}<div class="sub rlab">By size</div>${hbars(sizeRows)}`)}
    </div>
    <div class="cols2 rrow">
      ${repCard('Sprints', sprintHtml)}
      ${repCard('Site health', siteHtml)}
    </div>
    ${repCard('Failures', failHtml)}
    ${repCard(`Completed work ${chip(fmtN(doneList.length), '')}`, doneHtml)}
    <details class="rdata"><summary>Show the numbers as a table</summary>${tableHtml}</details>`;
}

/* ---------- Copy summary (for notes and meeting slides) ---------- */
function repSummary(M) {
  const { rng, cur, prev, R } = M, L = [];
  const dep = cur.runs.filter(r => r.k === 'deploy'), bak = cur.runs.filter(r => r.k === 'backup');
  const scopeName = R.pid ? (proj(R.pid) || {}).name : 'All apps';
  L.push(`ProdKeeper report — ${scopeName}`, rng.label, '');
  L.push(`Tasks: ${fmtN(cur.done.length)} completed (${fmtN(cur.pts)} pt), ${fmtN(cur.created.length)} created; ${deltaText(cur.done.length, prev.done.length)}`);
  if (cur.medianLead != null) L.push(`Median lead time: ${fmtSpan(cur.medianLead)}`);
  L.push(`Commits: ${fmtN(cur.commits.length)} (+${fmtN(cur.add)} / −${fmtN(cur.del)} lines)`);
  L.push(`Deploys: ${fmtN(dep.length)}${dep.length ? ` (${pctOf(okCount(dep), dep.length)}% succeeded)` : ''} · Backups: ${fmtN(bak.length)} · Database updates: ${fmtN(cur.runs.filter(r => r.k === 'dbupdate').length)} · Publishes: ${fmtN(cur.runs.filter(r => r.k === 'publish').length)}`);
  L.push(`Active days: ${fmtN(cur.activeDays)} of ${fmtN(rng.days)}`, '');
  for (const p of orderedProjects()) {
    const d = cur.done.filter(x => x.pid === p.id).sort((a, b) => a.t.doneAt - b.t.doneAt);
    if (!d.length) continue;
    L.push(`${p.name} — ${fmtN(d.length)} tasks completed`);
    d.forEach(x => L.push(`  - T-${x.t.num} ${x.t.title}${x.t.estimate ? ` (${fmtN(x.t.estimate)} pt)` : ''}`));
    L.push('');
  }
  const fails = cur.runs.filter(r => r.s === 'fail');
  if (fails.length) L.push(`Failed operations: ${fmtN(fails.length)}`, ...fails.slice(0, 10).map(r => `  - ${fmtDay(new Date(r.t))} ${r.n}`));
  return L.join('\n').trim();
}

/* ---------- Events ---------- */
Object.assign(actions, {
  'rep-copy': async () => { toast((await copyText(repSummary(repModel()))) ? 'Summary copied' : 'Could not copy', false); },
});
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.rep;
  if (!k) return;
  const R = V.rep;
  R[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (k === 'range' && R.range === 'custom' && !R.from) { R.from = toISO(addDays(new Date(), -29)); R.to = todayISO(); }
  render();
});

/* Hover readout: any element with data-tip shows its text next to the pointer */
const repTip = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'repTip', hidden: true }));
document.addEventListener('pointermove', e => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (!el) { repTip.hidden = true; return; }
  if (repTip.textContent !== el.dataset.tip) repTip.textContent = el.dataset.tip;
  repTip.hidden = false;
  const w = repTip.offsetWidth, h = repTip.offsetHeight;
  repTip.style.left = Math.max(8, Math.min(e.clientX + 14, innerWidth - w - 8)) + 'px';
  repTip.style.top = Math.max(8, e.clientY + 16 + h > innerHeight ? e.clientY - h - 12 : e.clientY + 16) + 'px';
});
document.addEventListener('pointerleave', () => { repTip.hidden = true; });
