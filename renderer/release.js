'use strict';

/* Releases (semantic versions + release notes from commits, deployed releases and rollback), feature flags
 * (on/off, percentage rollout, A/B variants per environment) and pull requests with review and merge. */

/* ---------- Semantic versioning and release notes ---------- */
const SEMVER = /^(v?)(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/;
/** "feat(scope)!: text" -> its type, text and whether it breaks compatibility (a "!" or a BREAKING CHANGE line in the body) */
function parseCommit(c) {
  const m = String(c.subject || '').match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
  return { hash: c.hash, type: m ? m[1].toLowerCase() : 'other', scope: m && m[2] || '', text: m ? m[4] : c.subject, breaking: !!(m && m[3]) || /(^|\n)BREAKING[ -]CHANGE/.test(c.body || '') };
}
const suggestBump = list => (!list.length ? null : list.some(c => c.breaking) ? 'major' : list.some(c => c.type === 'feat') ? 'minor' : 'patch');
/** The next version after `cur` (a tag name or ''), for a bump level and an optional pre-release label; `tags` are the existing tag names */
function nextVersion(cur, level, pre, tags) {
  const m = cur.match(SEMVER), prefix = m ? m[1] : 'v';
  let [maj, min, pat] = m ? [+m[2], +m[3], +m[4]] : [0, 0, 0];
  if (!(m && m[5] && !pre)) { // promoting a pre-release (1.2.0-rc.1 -> 1.2.0) keeps the numbers
    if (level === 'major') { maj++; min = 0; pat = 0; } else if (level === 'minor') { min++; pat = 0; } else pat++;
  }
  const base = `${prefix}${maj}.${min}.${pat}`;
  if (!pre) return base;
  const n = Math.max(0, ...tags.map(t => (t.match(new RegExp('^' + base.replace(/\./g, '\\.') + '-' + pre + '\\.(\\d+)$')) || [])[1]).filter(Boolean).map(Number));
  return `${base}-${pre}.${n + 1}`;
}
const NOTE_GROUPS = [['feat', 'Features'], ['fix', 'Bug fixes'], ['perf', 'Performance'], ['refactor', 'Refactoring'], ['docs', 'Documentation']];
function buildNotes(version, commits) {
  const L = [`## ${version} (${new Date().toISOString().slice(0, 10)})`, ''], line = c => `- ${c.scope ? `**${c.scope}:** ` : ''}${c.text} (${c.hash})`;
  const brk = commits.filter(c => c.breaking);
  if (brk.length) L.push('### Breaking changes', ...brk.map(line), '');
  const used = new Set();
  for (const [type, title] of NOTE_GROUPS) {
    const g = commits.filter(c => c.type === type);
    g.forEach(c => used.add(c));
    if (g.length) L.push(`### ${title}`, ...g.map(line), '');
  }
  const rest = commits.filter(c => !used.has(c));
  if (rest.length) L.push('### Other changes', ...rest.map(line), '');
  if (L.length === 2) L.push('No changes.');
  return L.join('\n').trim();
}

async function loadRelease(p) {
  if (!p.repoPath) return;
  const tg = await native.git('semverTags', p.repoPath), latest = tg.tags && tg.tags[0];
  const [cs, head] = await Promise.all([native.git('commitsSince', p.repoPath, { from: latest ? latest.name : '' }), native.git('head', p.repoPath)]);
  C.rel[p.id] = { latest: latest || null, tags: (tg.tags || []).map(t => t.name), commits: (latest ? cs.commits : (cs.commits || []).slice(0, 100)) || [], head, err: tg.error || cs.error || '' };
}
/** The form state of the "next release" card; it lives outside the page so a refresh does not wipe what was typed */
function relState(p) {
  if (!V.relUi || V.relUi.pid !== p.id) V.relUi = { pid: p.id, bump: 'auto', pre: '', push: true, gh: true, version: '', notes: '', vEdited: false, nEdited: false };
  return V.relUi;
}
function relPlan(p) {
  const rel = C.rel[p.id], R = relState(p), commits = rel.commits.map(parseCommit), suggested = suggestBump(commits);
  const level = R.bump === 'auto' ? suggested : R.bump, cur = rel.latest ? rel.latest.name : '';
  const version = level || (cur && R.pre) ? nextVersion(cur, level || 'patch', R.pre, rel.tags) : '';
  if (!R.vEdited) R.version = version;
  if (!R.nEdited) R.notes = commits.length ? buildNotes(R.version || version || 'Next release', commits) : '';
  return { commits, suggested, level, cur };
}

function tabRelease(p) {
  if (!p.repoPath) return notSet('The git repository path is not set for this project', `<button class="btn primary" data-action="edit-project" data-id="${p.id}">Set path</button>`);
  const rel = C.rel[p.id], g = C.git[p.id];
  if (!rel || !g) return '<div class="empty card">Loading…</div>';
  if (g.error) return notSet(esc(g.error), '');
  const R = relState(p), plan = relPlan(p), sel = (k, opts, cur) => `<select data-rel="${k}">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const counts = ['breaking', 'feat', 'fix'].map(k => [k, plan.commits.filter(c => (k === 'breaking' ? c.breaking : c.type === k && !c.breaking)).length]);
  const warn = [g.dirty ? `${num(g.dirty)} changed files are not committed and will not be in the release` : '', g.ahead ? `${num(g.ahead)} commits are not pushed yet` : ''].filter(Boolean);
  const next = `<div class="card section" style="margin-bottom:16px"><h2>Next release <span class="grow"></span><span class="sub">${rel.latest ? `latest tag ${esc(rel.latest.name)} · ${ago(rel.latest.ts)}` : 'no version tag yet'}</span></h2>
    ${rel.err ? `<div class="alert bad">${I.alert}<span>${esc(rel.err)}</span></div>` : ''}
    <div class="row"><span class="sub">${num(plan.commits.length)} ${plan.commits.length === 1 ? 'commit' : 'commits'} since ${rel.latest ? esc(rel.latest.name) : 'the start'}:</span>${counts.map(([k, n]) => n ? chip(`${num(n)} ${{ breaking: 'breaking', feat: 'features', fix: 'fixes' }[k]}`, k === 'breaking' ? 'late' : 'soon') : '').join('')}
      ${plan.suggested ? `<span class="sub">Suggested: <b>${plan.suggested}</b> (from the commit messages, Conventional Commits)</span>` : ''}</div>
    <div class="two" style="margin-top:10px"><div class="field"><label>Version bump</label>${sel('bump', [['auto', 'Automatic'], ['patch', 'Patch (fixes)'], ['minor', 'Minor (features)'], ['major', 'Major (breaking)']], R.bump)}</div>
      <div class="field"><label>Pre-release</label>${sel('pre', [['', 'Stable release'], ['rc', 'Release candidate (rc)'], ['beta', 'Beta'], ['alpha', 'Alpha']], R.pre)}</div></div>
    <div class="field"><label>Version (tag)</label><input type="text" data-rel="version" value="${esc(R.version)}" dir="ltr" placeholder="v1.0.0" style="max-width:240px"></div>
    <div class="field"><label>Release notes (written into the tag and the GitHub release)</label><textarea data-rel="notes" dir="ltr" style="min-height:200px;font-family:Consolas,monospace">${esc(R.notes)}</textarea></div>
    ${warn.map(w => `<div class="check-item warn">${I.alert}<span>${esc(w)}</span></div>`).join('')}
    <label class="chk"><input type="checkbox" data-rel="push" ${R.push ? 'checked' : ''}> Push the tag to the remote</label>
    ${p.ci.repo ? `<label class="chk"><input type="checkbox" data-rel="gh" ${R.gh ? 'checked' : ''}> Publish a GitHub release (needs a token with contents:write in Settings → CI)</label>` : ''}
    <div class="row" style="margin-top:10px"><button class="btn primary" data-action="release-create" ${R.version ? '' : 'disabled'}>${I.tag}Create release ${esc(R.version)}</button>
      ${rel.latest ? `<button class="btn" data-action="open-url" data-url="https://github.com/${esc(p.ci.repo)}/releases" ${p.ci.repo ? '' : 'hidden'}>${I.ext}Releases on GitHub</button>` : ''}</div></div>`;

  const deploys = p.deploys.map(d => {
    const list = releasesOf(p, d).slice(0, 8), cur = currentRelease(p, d), env = p.envs.find(e => e.id === d.envId);
    const st = { ok: ['okc', 'Succeeded'], unhealthy: ['late', 'Unhealthy'], failed: ['late', 'Failed'], rolledback: ['today', 'Rolled back'] };
    const rows = list.map(r => `<div class="trow" style="cursor:default">${chip(st[r.status][1], st[r.status][0])}<span class="tt"><b>${esc(r.version || (r.commit ? r.commit.slice(0, 7) : 'release'))}</b>
        <div class="sub" style="font-size:12px">${r.commit ? esc(r.commit.slice(0, 7)) + ' · ' : ''}${esc(r.strategy)}${r.slot ? ' · ' + esc(r.slot) : ''}${r.approvedAt ? ' · approved' : ''}${r.leadMs ? ' · lead time ' + fmtSpan(r.leadMs) : ''}${r.restoredAt ? ' · restored in ' + fmtSpan(r.restoredAt - r.ts) : ''}</div></span>
      ${r.artifact ? `<button class="iconbtn" data-action="open-folder" data-path="${esc(r.artifact)}" title="Open the build that was deployed">${I.folder}</button>` : ''}
      <span class="sub">${ago(r.ts)}</span>
      ${r.status === 'ok' && cur && r.id !== cur.id && (d.rollbackCommand || r.artifact) ? `<button class="btn sm" data-action="release-rollback" data-id="${r.id}">Roll back to this</button>` : ''}</div>`).join('');
    return `<div class="card section" style="margin-bottom:16px"><h2>${I.deploy}${esc(d.name)} ${env ? chip(esc(env.name), 'soon', I.globe) : ''}<span class="grow"></span>${liveInfo(p, d).replace(/^<div class="row" style="margin-top:8px">/, '<div class="row">')}</h2>
      ${rows || '<div class="sub">No release has been deployed with this deploy yet.</div>'}</div>`;
  }).join('');

  const flow = `<div class="card section" style="margin-bottom:16px"><h2>Branching strategy</h2><div class="row">${sel('branching', [['', 'Not set'], ['trunk', 'Trunk-based (short-lived branches, deploy from main)'], ['gitflow', 'GitFlow (feature/, release/, hotfix/)']], p.branching)}</div>
    <div class="sub" style="margin-top:6px">${{ '': 'Choose one to get a warning before a deploy that comes from the wrong branch.', trunk: 'Deploys should come from the default branch. Work happens on short-lived branches that are merged often.', gitflow: 'Name branches feature/…, release/… and hotfix/…. Deploys should come from main, a release/ or a hotfix/ branch.' }[p.branching]}</div></div>`;
  return next + (deploys || '') + flow;
}

Object.assign(actions, {
  'release-create': async () => {
    const p = proj(V.pid), R = relState(p), rel = C.rel[p.id], g = C.git[p.id], v = R.version.trim();
    if (!SEMVER.test(v)) return toast('The version must look like v1.2.3 or v1.2.3-rc.1', true);
    if (rel.tags.includes(v)) return toast(`The tag ${v} already exists`, true);
    const gh = R.gh && !!p.ci.repo, push = R.push || gh;
    if (!(await askConfirm(`Create the release ${v} on ${g.branch} (${g.last ? g.last.hash : 'HEAD'})?${push ? '\nThe tag is pushed to the remote.' : ''}${gh ? '\nA GitHub release is published.' : ''}`, 'Create', false))) return;
    const t = await gitOp(p.id, 'createTag', { name: v, message: `Release ${v}\n\n${R.notes}` }, `Create tag ${v}`, { quiet: true });
    if (t.error) return;
    if (push) { const r = await gitOp(p.id, 'pushTag', { name: v }, `Push tag ${v}`, { quiet: true }); if (r.error) return; }
    if (gh) {
      const r = await native.ci.release(ciCfg(p), { tag: v, name: v, body: R.notes, prerelease: /-/.test(v) });
      addHistory({ id: uid(), projectId: p.id, kind: 'git', title: `GitHub release ${v}`, start: Date.now(), end: Date.now(), status: r.error ? 'fail' : 'ok', log: r.error || r.url || '' });
      if (r.error) toast(`The tag was created, but the GitHub release failed: ${r.error}`, true); else toast(`Release ${v} published`);
    } else toast(`Release ${v} created`);
    V.relUi = null;
    await Promise.all([loadRelease(p), loadGitDetail(p)]);
    softRender();
  },
});
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.rel;
  if (!k || V.name !== 'project') return;
  const p = proj(V.pid), R = relState(p), t = e.target;
  if (k === 'branching') { p.branching = t.value; save(); render(); return; }
  if (k === 'bump' || k === 'pre') { R[k] = t.value; R.vEdited = R.nEdited = false; render(); }
  else if (k === 'push' || k === 'gh') R[k] = t.checked;
  else if (k === 'version') { R.version = t.value.trim(); R.vEdited = !!R.version; if (!R.nEdited) render(); }
});
document.addEventListener('input', e => {
  if (e.target.dataset && e.target.dataset.rel === 'notes') { const R = relState(proj(V.pid)); R.notes = e.target.value; R.nEdited = true; }
});

/* ---------- Feature flags ---------- */
const flagEnvs = p => (p.envs.length ? p.envs : [{ id: 'default', name: 'default' }]);
const flagSlug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'default';
const parseVariants = text => Object.fromEntries(String(text || '').split(/[,\s]+/).map(x => x.split(':')).filter(([n, w]) => /^[\w.-]+$/.test(n || '') && Number(w) >= 0).map(([n, w]) => [n, Number(w)]));
const flagState = (f, envId) => (f.env && f.env[envId]) || { on: false, pct: 100 };
/** What an app reads for one environment: { "flag-key": { enabled, rollout?, variants? } } */
function flagsJson(p, envId) {
  const out = {};
  for (const f of p.flags) {
    const st = flagState(f, envId), o = { enabled: !!st.on };
    if (f.kind === 'rollout') o.rollout = Math.min(100, Math.max(0, Math.round(Number(st.pct ?? 100))));
    if (f.kind === 'ab') o.variants = parseVariants(f.variants);
    out[f.key] = o;
  }
  return out;
}
function tabFlags(p) {
  const envs = flagEnvs(p), kinds = { bool: 'On / off', rollout: 'Gradual rollout', ab: 'A/B test' };
  const rows = p.flags.map(f => `<div class="card section" style="margin-bottom:12px"><div class="row between"><h2 style="margin:0"><code>${esc(f.key)}</code> ${chip(kinds[f.kind], 'soon')}</h2>
      <div class="row"><button class="iconbtn" data-action="flag-edit" data-id="${f.id}" title="Edit">${I.edit}</button></div></div>
      ${f.desc ? `<div class="sub" style="margin:4px 0 8px">${esc(f.desc)}</div>` : ''}
      ${envs.map(e => { const st = flagState(f, e.id); return `<div class="row" style="padding:4px 0"><b style="min-width:140px">${esc(e.name || e.url)}</b>
        <label class="chk"><input type="checkbox" data-flag="${f.id}" data-env="${e.id}" data-f="on" ${st.on ? 'checked' : ''}> ${st.on ? 'On' : 'Off'}</label>
        ${f.kind === 'rollout' ? `<input type="number" min="0" max="100" data-flag="${f.id}" data-env="${e.id}" data-f="pct" value="${esc(st.pct ?? 100)}" style="width:80px" ${st.on ? '' : 'disabled'}><span class="sub">% of users</span>` : ''}
        ${f.kind === 'ab' ? `<span class="sub">${Object.entries(parseVariants(f.variants)).map(([n, w]) => `${esc(n)} ${num(w)}%`).join(' · ') || 'no variants'}</span>` : ''}</div>`; }).join('')}</div>`).join('');
  return `<div class="page-head" style="margin-top:0"><span class="sub">Turn features on or off per environment without deploying, roll them out gradually, or split users for an A/B test.</span><span class="grow"></span>
      <button class="btn" data-action="flags-copy">${I.copy}Copy JSON</button><button class="btn primary" data-action="flag-new">${I.plus}New flag</button></div>
    ${rows || notSet('No feature flags yet', '<p class="sub">Create a flag, then write the flag files into your repository (or copy the JSON) so the app can read them.</p>')}
    <div class="card section"><h2>Flag files</h2>
      <div class="sub" style="margin-bottom:8px">One JSON file per environment is written into the repository. Use <code>{env}</code> in the path, for example <code>config/flags.{env}.json</code>. Commit and deploy them like any other change.</div>
      <div class="row"><input type="text" data-flagsfile value="${esc(p.flagsFile)}" dir="ltr" placeholder="config/flags.{env}.json" style="flex:1"><button class="btn" data-action="flags-write" ${p.repoPath && p.flags.length ? '' : 'disabled'}>${I.folder}Write files</button></div></div>`;
}
function flagModal(id) {
  const p = proj(V.pid), f = id ? p.flags.find(x => x.id === id) : { key: '', desc: '', kind: 'bool', variants: 'control:50,new:50' };
  openModal(`<form id="flagForm" data-id="${id || ''}">${modalHead(id ? 'Edit feature flag' : 'New feature flag')}
    <div class="body"><div class="field"><label>Key (used by the app)</label><input type="text" name="key" value="${esc(f.key)}" dir="ltr" required placeholder="new-checkout"></div>
      <div class="field"><label>Description</label><input type="text" name="desc" value="${esc(f.desc)}"></div>
      <div class="field"><label>Type</label><select name="kind"><option value="bool" ${f.kind === 'bool' ? 'selected' : ''}>On / off</option><option value="rollout" ${f.kind === 'rollout' ? 'selected' : ''}>Gradual rollout (percentage of users)</option><option value="ab" ${f.kind === 'ab' ? 'selected' : ''}>A/B test (variants)</option></select></div>
      <div class="field"><label>A/B variants and their share in percent</label><input type="text" name="variants" value="${esc(f.variants)}" dir="ltr" placeholder="control:50,new:50"></div></div>
    ${footerBtns(id ? `<button type="button" class="btn danger" data-action="flag-del" data-id="${id}">${I.trash}Delete</button>` : '')}</form>`, { small: true });
}
Object.assign(actions, {
  'flag-new': () => flagModal(),
  'flag-edit': el => flagModal(el.dataset.id),
  'flag-del': async el => {
    if (!(await askConfirm('Delete this feature flag? The files already written keep it until you write them again.'))) return;
    const p = proj(V.pid); p.flags = p.flags.filter(f => f.id !== el.dataset.id);
    save(); closeModal(); render();
  },
  'flags-copy': async () => {
    const p = proj(V.pid), all = Object.fromEntries(flagEnvs(p).map(e => [flagSlug(e.name || e.url), flagsJson(p, e.id)]));
    toast((await copyText(JSON.stringify(all, null, 2))) ? 'Flags copied as JSON' : 'Could not copy', false);
  },
  'flags-write': async () => {
    const p = proj(V.pid), pattern = p.flagsFile.trim(), envs = flagEnvs(p);
    if (!pattern) return toast('Enter the flag file path first', true);
    if (envs.length > 1 && !pattern.includes('{env}')) return toast('Use {env} in the path so each environment gets its own file', true);
    const files = envs.map(e => ({ path: pattern.replace(/\{env\}/g, flagSlug(e.name || e.url)), content: JSON.stringify(flagsJson(p, e.id), null, 2) + '\n' }));
    if (!(await askConfirm(`Write ${files.length === 1 ? 'this file' : 'these files'} into the repository (existing content is replaced)?\n${files.map(f => f.path).join('\n')}`, 'Write', false))) return;
    const r = await native.flags.write(p.repoPath, files);
    if (r.error) return toast(r.error, true);
    addHistory({ id: uid(), projectId: p.id, kind: 'git', title: `Feature flags written (${files.length} ${files.length === 1 ? 'file' : 'files'})`, start: Date.now(), end: Date.now(), status: 'ok', log: r.files.join('\n') });
    toast('Flag files written: commit and deploy them from the Git and Deploy tabs');
    loadGit(p).then(softRender);
  },
});
document.addEventListener('change', e => {
  const t = e.target;
  if (V.name !== 'project') return;
  if (t.dataset.flagsfile !== undefined) { proj(V.pid).flagsFile = t.value.trim(); save(); return; }
  if (!t.dataset.flag) return;
  const f = proj(V.pid).flags.find(x => x.id === t.dataset.flag);
  if (!f) return;
  f.env = f.env || {};
  const st = f.env[t.dataset.env] = { ...flagState(f, t.dataset.env) };
  if (t.dataset.f === 'on') st.on = t.checked; else st.pct = Math.min(100, Math.max(0, Math.round(Number(t.value) || 0)));
  save();
  if (t.dataset.f === 'on') render();
});
document.addEventListener('submit', e => {
  const f = e.target;
  if (f.id !== 'flagForm') return;
  const p = proj(V.pid), fd = new FormData(f), key = String(fd.get('key')).trim(), id = f.dataset.id;
  if (!/^[A-Za-z0-9_.-]+$/.test(key)) return toast('The key may only contain letters, digits, . _ -', true);
  if (p.flags.some(x => x.key === key && x.id !== id)) return toast('A flag with this key already exists', true);
  const data = { key, desc: String(fd.get('desc')).trim(), kind: ['bool', 'rollout', 'ab'].includes(fd.get('kind')) ? fd.get('kind') : 'bool', variants: String(fd.get('variants')).trim() };
  if (data.kind === 'ab') {
    const v = Object.values(parseVariants(data.variants));
    if (v.length < 2 || v.reduce((a, b) => a + b, 0) !== 100) return toast('Give at least two variants whose shares add up to 100', true);
  }
  const old = id && p.flags.find(x => x.id === id);
  if (old) Object.assign(old, data); else p.flags.push({ id: uid(), env: {}, ...data });
  save(); closeModal(); render();
});

/* ---------- Pull requests ---------- */
async function loadPRs(p) {
  if (!p.ci.repo) return;
  C.pr[p.id] = { ...(await native.ci.prs(ciCfg(p))), at: Date.now() };
}
function prSection(p) {
  if (!p.ci.repo) return '';
  const c = C.pr[p.id], chk = { success: ['okc', 'Checks passed'], failure: ['late', 'Checks failed'], running: ['soon', 'Checks running'], none: ['', 'No checks'] };
  const rows = c && c.prs ? c.prs.map(r => `<div class="trow" style="cursor:default"><span class="tt"><b>#${r.number}</b> ${esc(r.title)}${r.draft ? ' ' + chip('Draft', '') : ''}
      <div class="sub" style="font-size:12px">${chip(esc(r.head), '', I.branch)} → ${esc(r.base)} · ${esc(r.author || '')} · ${ago(r.updated)}</div></span>
      ${chip(chk[r.checks][1], chk[r.checks][0])}${r.approvals ? chip(`${num(r.approvals)} approved`, 'okc', I.tick) : chip('No approval yet', 'today')}${r.changes ? chip('Changes requested', 'late') : ''}
      <button class="btn sm" data-action="pr-review" data-n="${r.number}">Review</button><button class="btn sm primary" data-action="pr-merge" data-n="${r.number}" ${r.draft ? 'disabled' : ''}>${I.merge}Merge</button>
      <button class="iconbtn" data-action="open-url" data-url="${esc(r.url)}" title="Open on GitHub">${I.ext}</button></div>`).join('') : '';
  return `<div class="card section" style="margin-bottom:16px"><h2>Pull requests <span class="grow"></span><button class="btn sm" data-action="pr-new">${I.plus}New pull request</button></h2>
    ${!c ? '<div class="sub">Loading…</div>' : c.error ? `<div class="alert bad">${I.alert}<span>${esc(c.error)}</span></div>` : rows || '<div class="sub">No open pull requests</div>'}
    <div class="sub" style="margin-top:8px">Reviewing and merging need a token with pull-request write access in Settings → CI.</div></div>`;
}
const prAfter = async (p, msg) => { toast(msg); await loadPRs(p); softRender(); };
Object.assign(actions, {
  'pr-new': async () => {
    const p = proj(V.pid), g = C.git[p.id];
    if (!g || g.error) return toast('Open the Git tab first so the current branch is known', true);
    if (!g.upstream) return toast('Push the current branch to GitHub first', true);
    const gd = C.gd[p.id], bases = [...new Set([g.default, 'main', 'master', ...((gd && gd.br.branches) || []).filter(b => !b.isRemote).map(b => b.name)].filter(b => b && b !== g.branch))];
    openModal(`<form id="prNewForm">${modalHead('New pull request')}
      <div class="body"><div class="sub"><b>${esc(g.branch)}</b> → merge into:</div>
        <div class="field"><select name="base">${bases.map(b => `<option>${esc(b)}</option>`).join('')}</select></div>
        <div class="field"><label>Title</label><input type="text" name="title" value="${esc(g.last ? g.last.subject : '')}" required></div>
        <div class="field"><label>Description</label><textarea name="body" rows="5"></textarea></div>
        <label class="chk"><input type="checkbox" name="draft"> Open as a draft</label></div>${footerBtns().replace('Save', 'Create')}</form>`, { small: true });
  },
  'pr-review': el => openModal(`<form id="prReviewForm" data-n="${el.dataset.n}">${modalHead('Review #' + el.dataset.n)}
    <div class="body"><div class="field"><label>Decision</label><select name="event"><option value="APPROVE">Approve</option><option value="REQUEST_CHANGES">Request changes</option><option value="COMMENT">Comment only</option></select></div>
      <div class="field"><label>Comment (required unless you approve)</label><textarea name="body" rows="4"></textarea></div></div>${footerBtns().replace('Save', 'Submit review')}</form>`, { small: true }),
  'pr-merge': el => {
    const pr = ((C.pr[V.pid] || {}).prs || []).find(x => x.number === Number(el.dataset.n));
    openModal(`<form id="prMergeForm" data-n="${el.dataset.n}">${modalHead('Merge #' + el.dataset.n)}
      <div class="body">${pr && pr.checks !== 'success' ? `<div class="check-item warn">${I.alert}<span>The checks of this pull request have not all passed.</span></div>` : ''}
        ${pr && !pr.approvals ? `<div class="check-item warn">${I.alert}<span>It has no approval yet.</span></div>` : ''}${pr && pr.changes ? `<div class="check-item warn">${I.alert}<span>Changes were requested.</span></div>` : ''}
        <div class="field"><label>Merge method</label><select name="method"><option value="squash">Squash and merge</option><option value="merge">Merge commit</option><option value="rebase">Rebase and merge</option></select></div></div>${footerBtns().replace('Save', 'Merge')}</form>`, { small: true });
  },
});
document.addEventListener('submit', async e => {
  const f = e.target, p = proj(V.pid);
  if (!['prNewForm', 'prReviewForm', 'prMergeForm'].includes(f.id) || !p) return;
  const fd = new FormData(f), n = Number(f.dataset.n);
  closeModal();
  const call = (action, body) => native.ci.prAction(ciCfg(p), action, body);
  if (f.id === 'prNewForm') {
    const r = await call('create', { head: C.git[p.id].branch, base: fd.get('base'), title: fd.get('title'), body: fd.get('body'), draft: !!fd.get('draft') });
    if (r.error) return toast(r.error, true);
    prAfter(p, `Pull request #${r.number} created`);
  } else if (f.id === 'prReviewForm') {
    const r = await call('review', { number: n, event: fd.get('event'), body: fd.get('body') });
    if (r.error) return toast(r.error, true);
    prAfter(p, 'Review submitted');
  } else {
    const r = await call('merge', { number: n, method: fd.get('method') });
    if (r.error) return toast(r.error, true);
    await Promise.all([loadCI(p), loadGit(p), loadGitDetail(p)]);
    prAfter(p, `Pull request #${n} merged`);
  }
});
