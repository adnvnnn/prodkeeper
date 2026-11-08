'use strict';

/* Delivery safety: the deploy pipeline (runPipeline), release records, deploy strategies (rolling / blue-green / canary),
 * the plan + approval gate and rollback. Every deploy leaves a record in p.releases; the deploy card, the Releases tab and
 * the DORA report read it.
 * Variables the commands receive: DEPLOY_NAME, DEPLOY_STRATEGY, DEPLOY_COMMIT, DEPLOY_VERSION, DEPLOY_ENV, DEPLOY_URL,
 * DEPLOY_BRANCH; per strategy DEPLOY_BATCH / DEPLOY_BATCHES, CANARY_PERCENT, DEPLOY_SLOT / DEPLOY_LIVE_SLOT / DEPLOY_PHASE;
 * for a rollback ROLLBACK_VERSION, ROLLBACK_COMMIT, ROLLBACK_OUT. */

C.drift = {}; C.rel = {}; C.pr = {};

const STRATEGIES = [['direct', 'Direct (one step)'], ['rolling', 'Rolling (in batches)'], ['bluegreen', 'Blue-green (idle slot, then switch)'], ['canary', 'Canary (gradual traffic)']];
const clampN = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const LIVE_STATES = ['ok', 'unhealthy', 'failed'];

/* ---------- Release records ---------- */
const releasesOf = (p, d) => p.releases.filter(r => r.did === d.id); // newest first
const currentRelease = (p, d) => releasesOf(p, d).find(r => LIVE_STATES.includes(r.status)) || null;
/** The last good release before the current one */
function rollbackTarget(p, d) {
  const list = releasesOf(p, d), cur = currentRelease(p, d);
  return cur ? list.slice(list.indexOf(cur) + 1).find(r => r.status === 'ok') || null : null;
}
function canRollback(p, d) {
  if (d.rollbackCommand || d.strategy === 'bluegreen') return !!currentRelease(p, d);
  const t = rollbackTarget(p, d);
  return !!(t && t.artifact);
}
function recordRelease(p, d, info) {
  const rel = { id: uid(), did: d.id, status: 'ok', ts: Date.now(), ...info };
  p.releases.unshift(rel);
  let n = 0;
  const keep = clampN(d.keepReleases, 2, 500, 50);
  p.releases = p.releases.filter(r => r.did !== d.id || ++n <= keep);
  save();
  return rel;
}
/** When the oldest change in this release was committed: the start of its lead time */
async function leadStart(p, head, prev) {
  if (!head || !head.ts) return Date.now();
  if (!prev || !prev.commit || !p.repoPath) return head.ts;
  const r = await native.git('commitsSince', p.repoPath, { from: prev.commit });
  const cs = (r && r.commits) || [];
  return cs.length ? Math.min(...cs.map(c => c.ts)) : head.ts;
}

/* ---------- Deploy strategy as stages ---------- */
function deployStages(p, d) {
  const s = d.strategy || 'direct';
  if (s === 'rolling') {
    const n = clampN(d.batches, 2, 10, 3);
    return Array.from({ length: n }, (_, i) => ({ label: `batch ${i + 1} of ${n}`, env: { DEPLOY_BATCH: i + 1, DEPLOY_BATCHES: n }, wait: i < n - 1 ? 2000 : 4000 }));
  }
  if (s === 'canary') {
    let steps = String(d.canarySteps || '10,50,100').split(/[,\s]+/).map(Number).filter(x => x >= 1 && x <= 100).map(Math.round);
    steps = [...new Set(steps)].sort((a, b) => a - b);
    if (steps[steps.length - 1] !== 100) steps.push(100);
    const pause = clampN(d.canaryWait, 0, 600, 30);
    return steps.map((pct, i) => ({ label: `${pct}% of traffic`, env: { CANARY_PERCENT: pct, DEPLOY_STEP: i + 1 }, pause: i < steps.length - 1 ? pause : 0, wait: 2000 }));
  }
  if (s === 'bluegreen') {
    const live = d.liveSlot === 'green' ? 'green' : 'blue', idle = live === 'blue' ? 'green' : 'blue', idleUrl = String(d.idleCheckUrl || '').replace(/\{slot\}/g, idle);
    return [
      { label: `deploy to ${idle}`, env: { DEPLOY_SLOT: idle, DEPLOY_LIVE_SLOT: live, DEPLOY_PHASE: 'deploy' }, check: idleUrl || 'none', wait: 3000 },
      { label: `switch to ${idle}`, command: String(d.switchCommand || '').trim(), env: { DEPLOY_SLOT: idle, DEPLOY_LIVE_SLOT: live, DEPLOY_PHASE: 'switch' }, switched: true, newLive: idle },
    ];
  }
  return [{ label: 'Deploy', env: {} }];
}

/* ---------- Approval gate ---------- */
/** Shows the plan output (if any) and waits for the human: "confirm" is a button, "type" needs the environment name typed */
function askApproval(p, d, planLog) {
  const env = p.envs.find(e => e.id === d.envId), target = (env && (env.name || env.url)) || d.name, strict = d.approval === 'type';
  return new Promise(res => {
    const c = $('#confirm');
    c.innerHTML = `<div class="dialog small"><div class="body" style="padding-top:22px"><b>Approve the deploy "${esc(d.name)}"${env ? ' to ' + esc(env.name || env.url) : ''}?</b>
      <div class="sub" style="margin-top:6px">${esc(STRATEGIES.find(s => s[0] === (d.strategy || 'direct'))[1])}. Nothing has been changed yet.</div>
      ${planLog ? `<div class="sub" style="margin-top:10px">Plan output</div><pre class="console" style="max-height:220px;overflow:auto">${esc(planLog.slice(-3000))}</pre>` : ''}
      ${strict ? `<div class="field" style="margin-top:10px"><label>Type <b>${esc(target)}</b> to approve</label><input type="text" id="apType" dir="ltr" autocomplete="off"></div>` : ''}</div>
      <footer><button class="btn primary" id="cYes" ${strict ? 'disabled' : ''}>Approve and deploy</button><button class="btn" id="cNo">Reject</button></footer></div>`;
    c.hidden = false;
    const done = v => { c.hidden = true; c.innerHTML = ''; res(v); };
    $('#cYes').onclick = () => done(true);
    $('#cNo').onclick = () => done(false);
    if (strict) { const t = $('#apType'); t.oninput = () => { $('#cYes').disabled = t.value.trim() !== target; }; t.focus(); } else $('#cNo').focus();
  });
}

/* ---------- The pipeline ---------- */
const badRun = r => !r || r.status !== 'ok';
/** The deploy as one pipeline: tests, backup, publish (in parallel when asked), plan, approval, database update, then the deploy
 *  itself in the stages of its strategy with a health check between them; a failure can roll the deploy back by itself */
async function runPipeline(p, d, { auto } = {}) {
  const stop = msg => { toast(`Deploy "${d.name}" stopped: ${msg}`, true); return null; };
  const test = d.preTest && p.test.command, bk = d.backupId && p.backups.find(x => x.id === d.backupId);
  const pub = d.publishId && p.ops.find(x => x.id === d.publishId && x.type === 'publish'), dbu = d.dbUpdateId && p.ops.find(x => x.id === d.dbUpdateId && x.type === 'db');
  let pubOut = '';
  if (d.parallel) {
    const jobs = [];
    if (test) jobs.push(['the tests', runTests(p, { silent: true, auto })]);
    if (bk) jobs.push([`the backup "${bk.name}"`, runBackup(p, bk, true, auto)]);
    if (pub) jobs.push([`publishing "${pub.name}"`, runOp(p, pub, { silent: true, auto })]);
    const res = await Promise.all(jobs.map(j => j[1])), i = res.findIndex(badRun);
    if (i >= 0) return stop(`${jobs[i][0]} ${res[i] ? 'failed' : 'could not start'}`);
    if (pub) pubOut = res[res.length - 1].file || '';
  } else {
    if (test) { const t = await runTests(p, { silent: auto, auto }); if (badRun(t)) return stop(t ? 'the tests failed' : 'the tests could not start'); }
    if (bk) { const b = await runBackup(p, bk, auto, auto); if (badRun(b)) return stop(`the backup "${bk.name}" ${b ? 'failed' : 'could not start'}`); }
    if (pub) { const r = await runOp(p, pub, { silent: auto, auto }); if (badRun(r)) return stop(`publishing "${pub.name}" ${r ? 'failed' : 'could not start'}`); pubOut = r.file || ''; }
  }
  let planLog = '';
  if (d.planCommand && d.planCommand.trim()) { // a dry run (terraform plan, kubectl diff, ...): nothing is changed by it
    const pl = await runJob({ pid: p.id, kind: 'plan', refId: d.id + ':plan', title: `Plan: ${d.name}`, spec: deploySpec(p, d, pubOut, {}, d.planCommand), silent: auto, auto });
    if (badRun(pl)) return stop('the plan step failed');
    planLog = pl.log || '';
  }
  let approvedAt = 0;
  if (d.approval && d.approval !== 'off') {
    if (!(await askApproval(p, d, planLog))) return stop('it was not approved');
    approvedAt = Date.now();
  }
  if (dbu) {
    const r = await runDbUpdate(p, dbu, !bk, { silent: auto, auto }); // the deploy's own backup, when there is one, already covers the update
    if (badRun(r)) return stop(`the database update "${dbu.name}" ${r ? 'failed' : 'did not run'}`);
  }

  const head = p.repoPath ? await native.git('head', p.repoPath) : {}, env = p.envs.find(e => e.id === d.envId), prev = currentRelease(p, d);
  const meta = { DEPLOY_NAME: d.name, DEPLOY_STRATEGY: d.strategy || 'direct', ...(head.hash ? { DEPLOY_COMMIT: head.hash, DEPLOY_VERSION: head.describe } : {}),
    ...(env ? { DEPLOY_ENV: env.name || '', DEPLOY_URL: env.url || '' } : {}), ...(d.branch ? { DEPLOY_BRANCH: d.branch } : {}) };
  const from = await leadStart(p, head.hash ? head : null, prev), started = Date.now(), stages = deployStages(p, d);
  let ok = true, unhealthy = false, switched = false, last = null;
  for (let i = 0; i < stages.length; i++) {
    const st = stages[i];
    last = await runJob({ pid: p.id, kind: 'deploy', refId: d.id, title: `Deploy: ${d.name}${auto ? ' (after CI)' : ''}${stages.length > 1 ? ` — ${st.label}` : ''}`,
      spec: deploySpec(p, d, pubOut, { ...meta, ...st.env }, st.command), silent: auto, auto, deferHealth: true });
    if (badRun(last)) { ok = false; break; }
    if (st.switched) switched = true;
    if (st.check !== 'none') {
      const h = await postDeployHealth(p.id, d.id, last.id, last, { wait: st.wait, url: st.check });
      if (h && !h.ok) { ok = false; unhealthy = true; break; }
    }
    if (st.newLive) d.liveSlot = st.newLive;
    if (st.pause) await sleep(st.pause * 1000);
  }
  const status = ok ? 'ok' : unhealthy && (d.strategy !== 'bluegreen' || switched) ? 'unhealthy' : 'failed';
  recordRelease(p, d, { status, version: head.describe || '', commit: head.hash || '', commitTs: head.ts || 0, branch: d.branch || '', artifact: pubOut, envId: d.envId || '', strategy: d.strategy || 'direct',
    runId: last ? last.id : '', startedAt: started, leadMs: Date.now() - from, approvedAt, slot: d.strategy === 'bluegreen' ? d.liveSlot || 'blue' : '' });
  if (!ok && d.autoRollback && (d.strategy !== 'bluegreen' || switched) && canRollback(p, d)) {
    toast(`"${d.name}" failed: rolling back automatically`, true);
    await rollbackDeploy(p, d, { auto: true });
  }
  softRender();
  return last;
}

/* ---------- Rollback ---------- */
/** Returns the previous good release to the environment: the rollback command, the blue-green switch back, or the previous
 *  build deployed again. `to` is a release id (from the Releases tab); without it the last good release before the current one. */
async function rollbackDeploy(p, d, { auto, to } = {}) {
  const list = releasesOf(p, d), cur = currentRelease(p, d), target = to ? list.find(r => r.id === to) : rollbackTarget(p, d);
  const bg = d.strategy === 'bluegreen', live = d.liveSlot === 'green' ? 'green' : 'blue', other = live === 'blue' ? 'green' : 'blue', env = {};
  let command = String(d.rollbackCommand || '').trim();
  if (bg) { command = command || String(d.switchCommand || '').trim() || d.command; Object.assign(env, { DEPLOY_SLOT: other, DEPLOY_LIVE_SLOT: live, DEPLOY_PHASE: 'switch' }); }
  else if (!command && target && target.artifact) { command = d.command; env.PUBLISH_OUT = target.artifact; }
  if (!command) { toast(`"${d.name}" cannot be rolled back: set a rollback command in the deploy settings, or use a publish step so the previous build can be deployed again`, true); return null; }
  if (target) Object.assign(env, { ROLLBACK_VERSION: target.version || '', ROLLBACK_COMMIT: target.commit || '', ...(target.artifact ? { ROLLBACK_OUT: target.artifact } : {}) });
  const name = target ? target.version || (target.commit || '').slice(0, 7) || 'the previous release' : 'the previous release';
  if (!auto && !(await askConfirm(`Roll "${d.name}" back to ${name}?${bg ? `\nTraffic goes back to the ${other} slot.` : ''}`, 'Roll back'))) return null;
  const h = await runJob({ pid: p.id, kind: 'rollback', refId: d.id + ':rollback', title: `Rollback: ${d.name} to ${name}`, spec: deploySpec(p, d, '', env, command), silent: auto, auto, deferHealth: true });
  if (badRun(h)) { toast('The rollback failed: check the log', true); return h; }
  const now = Date.now(), upto = target ? list.indexOf(target) : cur ? list.indexOf(cur) + 1 : 0;
  list.slice(0, upto).forEach(r => { if (LIVE_STATES.includes(r.status)) { r.status = 'rolledback'; r.restoredAt = now; } });
  if (bg) d.liveSlot = other;
  save();
  toast(`"${d.name}" rolled back to ${name}`);
  await postDeployHealth(p.id, d.id, h.id, h);
  softRender();
  return h;
}

/* ---------- Deploy card ---------- */
function liveInfo(p, d) {
  const cur = currentRelease(p, d);
  if (!cur) return '';
  const label = cur.version || (cur.commit ? cur.commit.slice(0, 7) : 'release'), drift = C.drift[d.id];
  return `<div class="row" style="margin-top:8px"><span class="sub">Live:</span>${chip(esc(label), cur.status === 'ok' ? 'okc' : 'late', I.tag)}<span class="sub">${ago(cur.ts)}${cur.strategy && cur.strategy !== 'direct' ? ' · ' + esc(cur.strategy) : ''}</span>
    ${cur.status === 'unhealthy' ? chip('Unhealthy after deploy', 'late') : cur.status === 'failed' ? chip('Last deploy failed', 'late') : ''}
    ${drift ? chip(`${num(drift)} ${drift === 1 ? 'commit' : 'commits'} not deployed`, 'soon', I.up) : ''}
    ${canRollback(p, d) ? `<button class="btn sm" data-action="deploy-rollback" data-id="${d.id}">${I.refresh}Roll back</button>` : ''}</div>`;
}
/** Commits on the remote branch that the live release does not contain (git is the source of truth for what should be running) */
async function loadDrift(p) {
  if (!p.repoPath) return;
  await Promise.all(p.deploys.map(async d => {
    const cur = currentRelease(p, d);
    if (!cur || cur.status !== 'ok' || !cur.commit || !d.branch) { delete C.drift[d.id]; return; }
    const r = await native.git('commitsSince', p.repoPath, { from: cur.commit, to: 'origin/' + d.branch });
    if (r && r.commits) C.drift[d.id] = r.commits.length; else delete C.drift[d.id];
  }));
}

/* ---------- Deploy form: strategy, approval, rollback ---------- */
function deliveryFields(d) {
  const sel = (name, opts, cur) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const area = (name, label, val, ph, hint) => `<div class="field"><label>${label}</label><textarea name="${name}" dir="ltr" style="min-height:48px;font-family:Consolas,monospace" placeholder="${esc(ph)}">${esc(val || '')}</textarea>${hint ? `<div class="sub">${hint}</div>` : ''}</div>`;
  const used = d.strategy && d.strategy !== 'direct' || d.planCommand || d.rollbackCommand || (d.approval && d.approval !== 'off') || d.autoRollback || d.parallel;
  return `<details class="dlv" ${used ? 'open' : ''} style="margin-top:6px"><summary><b>Release strategy, approval and rollback</b></summary><div class="stack" style="margin-top:10px">
    <div class="two"><div class="field"><label>Strategy</label>${sel('strategy', STRATEGIES, d.strategy || 'direct')}</div>
      <div class="field"><label>Approval before the deploy</label>${sel('approval', [['off', 'None'], ['confirm', 'Ask me to confirm'], ['type', 'Type the environment name']], d.approval || 'off')}</div></div>
    <div class="two"><div class="field"><label>Rolling: number of batches</label><input type="number" name="batches" min="2" max="10" value="${esc(d.batches || 3)}"></div>
      <div class="field"><label>Canary: traffic steps, and seconds to watch between them</label><div class="two"><input type="text" name="canarySteps" dir="ltr" value="${esc(d.canarySteps || '10,50,100')}"><input type="number" name="canaryWait" min="0" max="600" value="${esc(d.canaryWait ?? 30)}"></div></div></div>
    ${area('switchCommand', 'Blue-green: switch command (moves traffic to the new slot)', d.switchCommand, 'kubectl patch service app -p "{\\"spec\\":{\\"selector\\":{\\"slot\\":\\"%DEPLOY_SLOT%\\"}}}"', 'Empty = the deploy command runs again with <code>DEPLOY_PHASE=switch</code>. The deploy command receives <code>DEPLOY_SLOT</code> (the idle slot to fill).')}
    <div class="field"><label>Blue-green: health URL of the idle slot (<code>{slot}</code> is replaced)</label><input type="text" name="idleCheckUrl" dir="ltr" value="${esc(d.idleCheckUrl || '')}" placeholder="https://{slot}.example.com/health"></div>
    ${area('planCommand', 'Plan / dry-run command (runs first, its output is shown for approval)', d.planCommand, 'terraform plan -no-color', 'For example <code>terraform plan</code>, <code>kubectl diff -f k8s/</code>, <code>helm diff upgrade</code>.')}
    ${area('rollbackCommand', 'Rollback command', d.rollbackCommand, 'kubectl rollout undo deployment/app', 'It receives <code>ROLLBACK_VERSION</code>, <code>ROLLBACK_COMMIT</code> and <code>ROLLBACK_OUT</code>. Without one, a deploy that has a publish step deploys the previous build again.')}
    <label class="chk"><input type="checkbox" name="autoRollback" ${d.autoRollback ? 'checked' : ''}> Roll back automatically when the deploy fails or the site is unhealthy afterwards</label>
    <label class="chk"><input type="checkbox" name="parallel" ${d.parallel ? 'checked' : ''}> Run tests, backup and publish at the same time instead of one after the other</label>
    <div class="field"><label>Releases kept in the list</label><input type="number" name="keepReleases" min="2" max="500" value="${esc(d.keepReleases || 50)}" style="max-width:120px"></div></div></details>`;
}
function readDelivery(fd) {
  const t = k => String(fd.get(k) ?? '').trim();
  return { strategy: STRATEGIES.some(s => s[0] === fd.get('strategy')) ? fd.get('strategy') : 'direct', approval: ['confirm', 'type'].includes(fd.get('approval')) ? fd.get('approval') : 'off',
    batches: clampN(fd.get('batches'), 2, 10, 3), canarySteps: t('canarySteps') || '10,50,100', canaryWait: clampN(fd.get('canaryWait'), 0, 600, 30), switchCommand: t('switchCommand'), idleCheckUrl: t('idleCheckUrl'),
    planCommand: t('planCommand'), rollbackCommand: t('rollbackCommand'), autoRollback: !!fd.get('autoRollback'), parallel: !!fd.get('parallel'), keepReleases: clampN(fd.get('keepReleases'), 2, 500, 50) };
}

Object.assign(actions, {
  'deploy-rollback': el => { const p = proj(V.pid); rollbackDeploy(p, p.deploys.find(x => x.id === el.dataset.id)); },
  'release-rollback': el => {
    const p = proj(V.pid), rel = p.releases.find(r => r.id === el.dataset.id), d = rel && p.deploys.find(x => x.id === rel.did);
    if (d) rollbackDeploy(p, d, { to: rel.id });
  },
});
