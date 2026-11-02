'use strict';
// Recovery test: starts the app with a throw-away profile and breaks its page in the ways a long-running window breaks
// (renderer killed, GPU process killed, renderer hung, DOM wiped, an all-white frame) and checks that the page comes back by itself.
// Run:  set ELECTRON_RUN_AS_NODE=1 && node_modules\electron\dist\electron.exe scripts\test-recovery.js   (npm run test:recovery)
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.join(__dirname, '..');
const electron = require('electron');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-test-'));
const PORT = 9400 + Math.floor(Math.random() * 400);
const PW = 'test-password-123';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const env = { ...process.env, PK_WATCHDOG_MS: '2000' }; // fast watchdog for the test
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(electron, [root, `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' });
app.on('exit', c => { if (!finished) { console.log('app exited early', c); process.exit(1); } });
let finished = false;

async function target() {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    return list.find(t => t.type === 'page' && /index\.html/.test(t.url));
  } catch { return null; } // the app is still starting, or between two page loads
}
/** One CDP call on the page target; resolves {value} or {error} and gives up after `ms` (a hung renderer never answers) */
async function cdp(expr, ms = 4000) {
  const t = await target();
  if (!t) return { error: 'no target' };
  return new Promise(resolve => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    const done = v => { clearTimeout(timer); try { ws.close(); } catch { /* closed */ } resolve(v); };
    const timer = setTimeout(() => done({ error: 'timeout' }), ms);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id === 1) done(d.result && d.result.exceptionDetails ? { error: 'exception' } : { value: d.result && d.result.result.value }); };
    ws.onerror = () => done({ error: 'ws' });
  });
}
async function waitFor(expr, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const r = await cdp(expr, 2500); if (r.value === true) return true; await sleep(400); }
  console.log(`    timed out waiting for: ${label}`);
  return false;
}
/** Renderer / GPU process ids: direct children of this test instance's main process */
function pids(type) {
  const ps = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${app.pid}" | Where-Object { $_.CommandLine -like '*--type=${type}*' } | ForEach-Object { $_.ProcessId }`;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  return out.split(/\s+/).filter(Boolean).map(Number);
}
const kill = pid => { try { execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' }); } catch { /* already gone */ } };

const UI_OK = '!!document.querySelector("#nav") && document.querySelector("#nav").children.length > 0 && document.querySelector("#main").innerHTML.length > 50';
const results = [];
async function scenario(name, breakIt, recoverMs = 25000) {
  process.stdout.write(`- ${name}\n`);
  if (!(await waitFor(UI_OK, 'app UI before the test', 20000))) { results.push([name, false]); return; }
  await cdp('window.__generation = 1; true');
  await breakIt();
  await sleep(300);
  // recovered = the UI is back AND it is a fresh page (the marker set above is gone), so a scenario cannot pass by doing nothing
  const ok = await waitFor(`${UI_OK} && window.__generation === undefined && !document.getElementById("whiteout")`, 'a freshly loaded app UI', recoverMs);
  console.log(`    ${ok ? 'PASS' : 'FAIL'}`);
  results.push([name, ok]);
}

(async () => {
  try {
    if (!(await waitFor('!!document.querySelector("#lockScreenForm")', 'lock screen'))) throw new Error('app did not start');
    await cdp(`(() => { const f = document.querySelector('#lockScreenForm'); f.elements.pw.value = '${PW}'; f.elements.pw2.value = '${PW}'; f.requestSubmit(); return true; })()`);
    if (!(await waitFor(UI_OK, 'unlocked app'))) throw new Error('could not set up the test profile');

    const killAll = type => { const p = pids(type); console.log(`    killing ${type}: ${p.join(', ') || 'NONE FOUND'}`); p.forEach(kill); };
    // auto-lock (or the Lock button) and then typing the master password must bring the app back, not a blank page
    process.stdout.write('- lock, then unlock with the password\n');
    await cdp('lockNow(); true');
    let lockOk = await waitFor('!!document.querySelector("#lockScreenForm")', 'lock screen after locking', 10000);
    if (lockOk) {
      await cdp(`(() => { const f = document.querySelector('#lockScreenForm'); f.elements.pw.value = '${PW}'; f.requestSubmit(); return true; })()`);
      lockOk = await waitFor(`${UI_OK} && document.getElementById("lock").hidden`, 'app UI after unlocking', 10000);
    }
    console.log(`    ${lockOk ? 'PASS' : 'FAIL'}`);
    results.push(['lock then unlock', lockOk]);

    await scenario('renderer process killed', async () => killAll('renderer'));
    // the GPU process is not the page, so a new page is not required here; the page must simply still be there afterwards
    process.stdout.write('- GPU process killed\n');
    killAll('gpu-process');
    await sleep(4000);
    const gpuOk = await waitFor(UI_OK, 'app UI after the GPU process died', 20000);
    console.log(`    ${gpuOk ? 'PASS' : 'FAIL'}`);
    results.push(['GPU process killed', gpuOk]);
    await scenario('renderer hung (infinite loop)', async () => { cdp('while (true) {}', 500); }, 60000);
    await scenario('page content wiped (blank DOM)', async () => { await cdp('document.body.innerHTML = ""; true'); });
    await scenario('all-white frame over a healthy DOM', async () => {
      await cdp('(() => { const d = document.createElement("div"); d.id = "whiteout"; d.style.cssText = "position:fixed;inset:0;background:#fff;z-index:99999"; document.body.append(d); return true; })()');
    });
  } catch (e) {
    console.log('ERROR:', e.message);
    results.push(['harness', false]);
  } finally {
    finished = true;
    kill(app.pid);
    await sleep(500);
    try { console.log('\ncrash.log:\n' + fs.readFileSync(path.join(profile, 'crash.log'), 'utf8')); } catch { console.log('\n(no crash.log)'); }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still in use */ }
    const bad = results.filter(r => !r[1]).length;
    console.log(`\n${results.length - bad}/${results.length} scenarios recovered`);
    process.exit(bad ? 1 : 0);
  }
})();
