'use strict';

/* ======================= Pet =======================
 * One robot (renderer/petart.js) that keeps watch over the app; it is also the app's icon.
 *  - You steer it with the arrow keys: Left / Right walk, Up jumps (twice for a double jump), Down drops through what it stands on.
 *    Everything on the page is solid ground from above: cards, buttons, headings and lines of text. It can go anywhere you can jump.
 *    F, D, X and S make it do a backflip, dance, play dead and beep.
 *  - It does not wander: a few seconds after you stop steering it, it climbs down and goes to the bottom-right corner and waits there.
 *  - On the lock screen it stands on the unlock form and says the messages there; after the unlock it hops down and runs to its corner.
 *  - It talks in a terminal-style bubble: normal messages are typed out, errors and warnings appear at once. Its antenna LED blinks red
 *    while the app has critical alerts, and a finished task / deploy / backup, a failed job or a new alert makes it say so
 *    (click a message about an app to open that app).
 *  - It has no settings. Right-click it to hide it; it comes back from Settings or the Ctrl+K palette.
 * What it remembers (S.pet: shown or hidden) lives in the encrypted data; the app never depends on it. */
const PET_SIZE = 96, PET_FLOOR = 4, PET_GRAV = 2200, PET_TYPE_MS = 26, PET_SPEED = 230, PET_PARK_MS = 4000, PET_CORNER = 14;
/* everything the pet can stand on (from above): text, controls and boxes */
const PET_SOLID = 'h1,h2,h3,h4,p,li,label,td,th,button,a,input,select,textarea,code,pre,summary,img,.card,.chip,.btn,.sub,.dd,.dialog,.pitem,.palette';

const petRand = (a, b) => a + Math.random() * (b - a);
const petPick = arr => arr[Math.floor(Math.random() * arr.length)];
const petClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const petIcons = {};
const petIcon = (name, size = 3) => petIcons[name + size] || (petIcons[name + size] = PetArt.icon(name, size));

/** Fills in missing fields of the saved pet (called when the data is loaded, so old data files just get a new pet) */
function normPet(d) {
  d = d && typeof d === 'object' ? d : {};
  return { on: d.on !== false, at: d.at || Date.now() };
}

/* ---------- State ---------- */
const PET = {
  ready: false, live: false, lock: false, placed: false, relock: false, arrive: false, lockMsg: false,
  el: null, fig: null, bub: null, fxBox: null, menu: null, mirror: null, mirrorJson: '', spot: null,
  x: 100, lift: 0, vx: 0, vy: 0, dir: 1, mode: 'idle', trick: '', until: 0, wx: null, manualAt: 0, run: false,
  keys: {}, jumps: 0, stand: null, dropEl: null, dropUntil: 0, plats: [], platsAt: 0,
  napUntil: 0, last: 0, bubUntil: 0, bubNav: null, bubW: 0, bubH: 0, typing: null, bubDone: null, bubRest: null,
  talkUntil: 0, joyUntil: 0, blinkAt: 0, blinkUntil: 0, frame: '', nextChat: 0, lastSay: '', bad: 0, sleepFx: 0, saveT: 0,
};
const PETM = { x: 0, y: 0 };
const petFloorY = () => innerHeight - PET_FLOOR;
const petTopY = () => innerHeight - PET_FLOOR - PET_SIZE;
/** Where it waits: the bottom-right corner of the window */
const petCornerX = () => Math.max(4, innerWidth - PET_SIZE - PET_CORNER);
/** True while the lock screen is up (or the data is not loaded yet): the pet then stands on the lock form */
const petLockMode = () => !PET.live || !S || (typeof locking !== 'undefined' && locking) || !$('#lock').hidden;
/** The pet can react to the app only when the data is open; it never says anything about it on the lock screen */
const petVisible = () => PET.ready && PET.live && S && S.pet.on && !petLockMode();
const petMood = () => (PET.bad > 0 ? 'sad' : 'happy');
const petSaveSoon = () => { clearTimeout(PET.saveT); PET.saveT = setTimeout(() => { if (S && !NOSAVE) save(); }, 3000); };

/* The data is encrypted, so before the unlock the pet cannot read it. Whether it is shown and its mood are mirrored in localStorage,
 * like the theme, so the lock screen can show the same pet. Nothing in it is sensitive. */
const PET_MIRROR_KEY = 'aw-pet';
function petMirrorLoad() {
  let m = {};
  try { m = JSON.parse(localStorage.getItem(PET_MIRROR_KEY)) || {}; } catch { /* storage unavailable */ }
  return { on: m.on !== false, mood: m.mood === 'sad' ? 'sad' : 'happy' };
}
function petMirrorSave() {
  const m = { on: S.pet.on, mood: petMood() }, j = JSON.stringify(m);
  PET.mirror = m;
  if (j === PET.mirrorJson) return;
  PET.mirrorJson = j;
  try { localStorage.setItem(PET_MIRROR_KEY, j); } catch { /* storage unavailable */ }
}

/* ---------- Drawing: the sprite is rebuilt only when its pose changes ---------- */
function petPose(now, lockMode, talking) {
  const mood = lockMode ? PET.mirror.mood : petMood();
  if (now > PET.blinkAt) { PET.blinkAt = now + petRand(2500, 6000); PET.blinkUntil = now + 140; }
  let eyes = 'open';
  if (PET.mode === 'sleep') eyes = 'closed';
  else if (PET.trick === 'dead') eyes = 'x';
  else if (now < PET.joyUntil) eyes = 'happy';
  else if (now < PET.blinkUntil) eyes = 'closed';
  const dx = PETM.x - (PET.x + PET_SIZE / 2);
  return {
    eyes, mouth: talking ? 'open' : mood === 'sad' ? 'sad' : 'smile',
    look: PET.mode === 'sleep' || Math.abs(dx) < 90 ? 0 : dx > 0 ? 1 : -1,
    step: PET.mode === 'walk' ? 1 + (Math.floor(now / (PET.run ? 150 : 230)) % 2) : PET.mode === 'air' ? 3 : 0,
    led: PET.mode === 'sleep' ? 'off' : mood === 'sad' ? (Math.floor(now / 450) % 2 ? 'red' : 'off') : Math.floor(now / 1200) % 2 ? 'on' : 'off', // antenna: blinks red on alerts
  };
}
function petDraw(pose) {
  const key = Object.values(pose).join('|');
  if (key === PET.frame) return;
  PET.frame = key;
  PET.fig.innerHTML = PetArt.pet(pose);
}

function petSetMode(mode, trick = '', ms = 0) {
  PET.mode = mode; PET.trick = trick;
  PET.until = ms ? Date.now() + ms : 0;
}

/* ---------- Effects, speech ---------- */
function petFx(names, n = 5, spread = 22) {
  if (!PET.fxBox) return;
  const cx = PET.x + PET_SIZE / 2, cy = petTopY() - PET.lift + 18;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = 'pet-fx';
    s.innerHTML = petIcon(petPick(names));
    s.style.left = (cx + petRand(-spread, spread)) + 'px';
    s.style.top = (cy + petRand(-6, 14)) + 'px';
    s.style.setProperty('--dx', petRand(-26, 26).toFixed(0) + 'px');
    s.style.setProperty('--dy', petRand(-64, -36).toFixed(0) + 'px');
    s.style.animationDelay = (i * 0.08).toFixed(2) + 's';
    s.addEventListener('animationend', () => s.remove());
    PET.fxBox.appendChild(s);
  }
}
function petConfetti(n = 26) {
  if (!PET.fxBox) return;
  const cx = PET.x + PET_SIZE / 2, cy = petTopY() - PET.lift + 10, col = ['var(--text)', 'var(--muted)', 'var(--faint)'];
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.className = 'pet-conf';
    s.style.left = cx + 'px'; s.style.top = cy + 'px'; s.style.background = petPick(col);
    s.style.setProperty('--dx', petRand(-150, 150).toFixed(0) + 'px');
    s.style.setProperty('--dy', petRand(40, 150).toFixed(0) + 'px');
    s.style.setProperty('--up', petRand(-130, -60).toFixed(0) + 'px');
    s.addEventListener('animationend', () => s.remove());
    PET.fxBox.appendChild(s);
  }
}

const PET_TAGS = { info: '$', ok: 'OK', warn: 'WARN', err: 'ERR' };
/** The pet's terminal-style message. kind: info | ok | warn | err. Errors and warnings appear at once; the rest is typed out. */
function petSay(text, o = {}) {
  if (!petVisible()) return;
  petBubble(text, o);
}
function petBubble(text, o = {}) {
  const b = PET.bub, kind = o.kind || 'info', instant = o.instant !== undefined ? o.instant : kind === 'err' || kind === 'warn', now = Date.now();
  b.className = `pet-bubble k-${kind}${o.nav ? ' nav' : ''}`;
  b.innerHTML = `<span class="pb-tag">${PET_TAGS[kind]}</span><span class="pb-tx"><span class="pb-done"></span><span class="pb-cur"></span><span class="pb-rest"></span></span>`;
  PET.bubDone = b.querySelector('.pb-done'); PET.bubRest = b.querySelector('.pb-rest');
  PET.bubDone.textContent = instant ? text : '';
  PET.bubRest.textContent = instant ? '' : text; // the not-yet-typed part keeps the bubble at its final size
  PET.typing = instant ? null : { text, n: 0, t0: now };
  b.hidden = false;
  PET.bubNav = o.nav || null;
  PET.bubW = 0; PET.bubH = 0; // measured by the loop once the pet is on screen
  const typeMs = instant ? 0 : text.length * PET_TYPE_MS;
  PET.bubUntil = now + typeMs + (o.ms || 3200 + text.length * 35);
  PET.talkUntil = now + (instant ? 700 : Math.min(3000, typeMs));
  PET.lastSay = text;
}
/** The lock screen's messages (hints, wrong password, ...) come from the pet. Returns false when the pet is turned off. */
function petLockSay(text, kind) {
  if (!PET.ready || PET.mirror.on === false) return false;
  const err = kind === 'err';
  PET.lockMsg = true; // the first frame of the lock screen must not throw this message away
  petBubble(text, { kind: err ? 'err' : 'info', ms: err ? 10000 : /^Checking/.test(text) ? 2500 : 12000 });
  if (err) { petSetMode('trick', 'shake', 1000); petFx(['bang'], 2); }
  return true;
}
function petHideBubble() { PET.bub.hidden = true; PET.bubNav = null; PET.bubUntil = 0; PET.typing = null; }

/* ---------- Moving: jump, wake, sleep ---------- */
function petCelebrate(text, kind = 'ok') {
  if (!petVisible()) return;
  if (PET.mode === 'sleep') petWake();
  petConfetti();
  PET.joyUntil = Date.now() + 1500;
  if (PET.mode !== 'air') petJump(560);
  petSay(text, { kind });
}
function petJump(v = 660) {
  if (PET.mode === 'air') return;
  PET.stand = null; PET.jumps = 1;
  PET.vy = v; PET.vx = 0;
  petSetMode('air');
}
function petWake(text) {
  if (PET.mode !== 'sleep') return;
  petSetMode('idle');
  if (text) petSay(text);
}
/** It dozes off when you have been away for a while (sooner at night) and wakes as soon as you are back */
function petSleep() {
  if (!petVisible() || ['air', 'sleep'].includes(PET.mode)) return;
  petSetMode('sleep');
  PET.wx = null;
}

/* ---------- Reacting to the app (called from the rest of the renderer) ---------- */
const PET_JOB_KINDS = ['deploy', 'backup', 'build', 'dbupdate', 'publish'];
function petEvent(type, d = {}) {
  if (!PET.live || !S || !S.pet) return;
  try {
    if (type === 'task-done') {
      if (!d.t || d.t.petDone) return; // a task counts once, so moving it back and forth does not repeat the party
      d.t.petDone = 1;
      petCelebrate(petPick(['task done. nice one.', 'one less thing on the list.', 'task complete. good job.', 'done. what is next?']));
    } else if (type === 'job') {
      if (!PET_JOB_KINDS.includes(d.kind)) return;
      if (d.status === 'ok') {
        if (d.auto) return;
        petCelebrate(d.kind === 'deploy' ? 'deploy finished. shipped it.' : d.kind === 'backup' ? 'backup complete. your data is safe.' : 'job finished.');
      } else if (d.status === 'fail') {
        if (!petVisible()) return;
        if (PET.mode === 'sleep') petWake();
        petSetMode('trick', 'shake', 1000);
        petFx(['drop'], 3);
        petSay(`${d.title || 'job'} failed. i am here with you.`, { kind: 'err', ms: 6500 });
      }
    } else if (type === 'alerts') {
      const prev = PET.bad;
      PET.bad = d.bad;
      if (!petVisible()) return;
      if (d.fresh && d.fresh.length) {
        const a = d.fresh[0];
        if (PET.mode === 'sleep') petWake();
        petSetMode('trick', 'shake', 1000);
        petFx(['bang'], 3);
        petSay(`${a.name}: ${a.text}`, { kind: 'err', nav: a.pid ? { pid: a.pid, tab: a.tab } : null, ms: 9000 });
      } else if (prev > 0 && d.bad === 0) {
        petSay('all clear. nothing is on fire.', { kind: 'ok' });
        petFx(['spark', 'heart'], 4);
      }
    }
  } catch (e) { console.error('pet', e); }
}

/** Tricks, from the keys: Up jumps, F backflip, D dance, X play dead, S beep */
function petDo(t) {
  if (!petVisible() || PET.mode === 'air') return;
  if (PET.mode === 'sleep') petWake();
  if (t === 'flip') { PET.stand = null; PET.jumps = 1; petSetMode('air', 'flip'); PET.vy = 800; PET.vx = 0; }
  else if (t === 'dance') { petSetMode('trick', 'dance', 2800); petFx(['note', 'spark'], 8, 40); }
  else if (t === 'dead') { petSetMode('trick', 'dead', 2800); petFx(['star'], 3); }
  else if (t === 'speak') { petSay('beep boop!', { ms: 1800 }); petFx(['note'], 2); }
}
/** Shows or hides the pet (Settings, the Ctrl+K palette and its right-click menu all end up here) */
function petShow(on) {
  S.pet.on = on;
  petMenuClose();
  if (on) PET.nextChat = Date.now() + 8000; else petHideBubble();
  petMirrorSave(); petSaveSoon();
  const box = $('#petOn');
  if (box) box.checked = on;
}
function petClampX() { PET.x = petClamp(PET.x, 4, Math.max(4, innerWidth - PET_SIZE - 4)); }

/* ---------- Idle chatter: it says something about what is really going on, and now and then a small health tip ---------- */
const PET_TIPS = [
  'drink some water.', 'a glass of water beats another coffee.', 'stretch your legs for a minute.', 'stand up and walk a little.',
  'rest your eyes: look at something far away for 20 seconds.', 'sit up straight. shoulders down.', 'blink. breathe. continue.',
  'take a short break. i will keep watch.', 'save your work. commit often.', 'check that your backups ran today.',
];
function petChatter() {
  const h = new Date().getHours(), opts = [];
  const A = computeAlerts();
  if (A.length) opts.push({ w: 4, t: `${A[0].name}: ${A[0].text}`, kind: A[0].sev === 'bad' ? 'err' : 'warn', nav: A[0].pid ? { pid: A[0].pid, tab: A[0].tab } : null });
  const open = S.projects.flatMap(p => p.tasks), doing = open.filter(t => t.status === 'doing').length, todo = open.filter(t => t.status === 'todo').length;
  const day0 = new Date().setHours(0, 0, 0, 0), doneToday = open.filter(t => t.status === 'done' && t.doneAt >= day0).length;
  if (doing) opts.push({ w: 2, t: `${doing} task${doing > 1 ? 's' : ''} in progress. you got this.` });
  else if (todo) opts.push({ w: 2, t: 'nothing in progress. pick a task from your list?' });
  if (doneToday) opts.push({ w: 2, t: `${doneToday} task${doneToday > 1 ? 's' : ''} finished today. nice.`, kind: 'ok' });
  if (h >= 23 || h < 5) opts.push({ w: 3, t: 'it is late. your bugs will still be here tomorrow.' });
  if (h >= 12 && h < 14) opts.push({ w: 2, t: 'lunch time? eat something real.' });
  if (h >= 6 && h < 10) opts.push({ w: 1.5, t: 'have you had breakfast?' });
  for (const t of PET_TIPS) opts.push({ w: 0.6, t }); // together about as likely as an app message
  opts.push({ w: 0.5, t: 'tip: arrows move me, up jumps. f, d, x and s are tricks.' });
  const pool = opts.filter(o => o.t !== PET.lastSay), total = pool.reduce((s, o) => s + o.w, 0);
  let r = Math.random() * total, ch = pool[0];
  for (const o of pool) { if ((r -= o.w) <= 0) { ch = o; break; } }
  if (ch) petSay(ch.t, { nav: ch.nav, kind: ch.kind });
}

/* ---------- Keyboard ---------- */
const petTyping = t => t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
function petKeyDown(e) {
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || petTyping(e.target) || !petVisible()) return;
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault(); // the arrows steer the pet instead of scrolling the page
    PET.keys[k.slice(5).toLowerCase()] = true;
    petManual();
    if (k === 'ArrowUp' && !e.repeat) petJumpKey();
    if (k === 'ArrowDown' && PET.stand && PET.mode !== 'air') { // drop through what it stands on
      PET.dropEl = PET.stand.el; PET.dropUntil = Date.now() + 350;
      PET.stand = null; PET.vy = 0; petSetMode('air');
    }
  } else if (!e.repeat) {
    const t = { f: 'flip', d: 'dance', x: 'dead', s: 'speak' }[k.toLowerCase()];
    if (t) { PET.manualAt = Date.now(); petDo(t); }
  }
}
function petKeyUp(e) {
  if (e.key.startsWith('Arrow')) PET.keys[e.key.slice(5).toLowerCase()] = false;
}
/** The player takes over: it stops heading for its corner, and goes there again PET_PARK_MS after the last key */
function petManual() {
  PET.arrive = false; PET.wx = null;
  PET.manualAt = Date.now();
  if (PET.mode === 'sleep') petWake();
  else if (PET.mode === 'trick') petSetMode('idle');
}
function petJumpKey() {
  if (PET.mode !== 'air') { PET.stand = null; PET.jumps = 1; PET.vy = 880; petSetMode('air'); }
  else if (PET.jumps < 2) { PET.jumps = 2; PET.vy = 820; petFx(['spark'], 2, 10); } // double jump
}

/* ---------- Right-click menu ---------- */
function petMenuClose() { if (PET.menu) PET.menu.hidden = true; }
function petMenuOpen(e) {
  e.preventDefault();
  if (petLockMode()) return;
  const m = PET.menu;
  m.innerHTML = '<button type="button" data-pet-hide>Hide the robot</button>';
  m.hidden = false;
  m.style.left = Math.round(petClamp(e.clientX - 12, 8, innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.round(petClamp(e.clientY - m.offsetHeight - 10, 8, innerHeight - m.offsetHeight - 8)) + 'px';
}

/* ---------- The ground under its paws: every piece of text and box on the page ---------- */
function petPlatforms(force) {
  const now = performance.now();
  if (!force && now - PET.platsAt < 250) return PET.plats;
  PET.platsAt = now;
  const root = !$('#confirm').hidden ? '#confirm' : !$('#modal').hidden ? '#modal' : !$('#palette').hidden ? '#palette' : '#app';
  const out = [];
  for (const el of document.querySelectorAll(`${root} :is(${PET_SOLID})`)) {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 6 || r.top < PET_SIZE || r.top > innerHeight - 12 || r.right < 0 || r.left > innerWidth) continue;
    out.push({ el, l: r.left, r: r.right, t: r.top });
    if (out.length > 900) break;
  }
  return (PET.plats = out);
}
/** Keeps it standing on what it stands on (the page can scroll or rebuild under it); false = nothing holds it any more */
function petSupport() {
  const st = PET.stand, cx = PET.x + PET_SIZE / 2;
  let r = st.el.isConnected && st.el.getBoundingClientRect();
  if (!r || r.width < 20 || r.height < 4) { // the page was rebuilt: find the same spot again
    const p = petPlatforms(true).find(q => Math.abs(q.t - st.t) < 8 && cx >= q.l - 6 && cx <= q.r + 6);
    if (!p) return false;
    st.el = p.el; r = p.el.getBoundingClientRect();
  }
  if (cx < r.left - 6 || cx > r.right + 6 || r.top < PET_SIZE || r.top > innerHeight - 8) return false;
  st.t = r.top;
  PET.lift = petFloorY() - r.top;
  return true;
}
function petLand(lift, plat) {
  const hit = -PET.vy;
  PET.lift = lift; PET.vy = 0; PET.jumps = 0;
  PET.stand = plat ? { el: plat.el, t: plat.t } : null;
  if (!PET.keys.left && !PET.keys.right) PET.vx = 0;
  if (PET.mode === 'air') petSetMode('idle');
  if (hit > 500) petSquash();
}

/* ---------- The loop ---------- */
function petAir(dt, now, kx) {
  const prev = PET.lift, maxX = innerWidth - PET_SIZE - 4;
  PET.vy -= (PET_GRAV + (PET.keys.down ? 1800 : 0)) * dt;
  PET.lift += PET.vy * dt;
  if (kx) { PET.vx = kx * PET_SPEED; PET.dir = kx; } else PET.vx *= Math.max(0, 1 - 4 * dt);
  PET.x = petClamp(PET.x + PET.vx * dt, 4, Math.max(4, maxX));
  const ceil = innerHeight - PET_FLOOR - PET_SIZE; // its head stays inside the window
  if (PET.lift > ceil) { PET.lift = ceil; PET.vy = Math.min(PET.vy, 0); }
  if (PET.vy <= 0 && !PET.arrive) { // falling: land on the highest thing whose top the paws just went through
    const f0 = petFloorY() - prev, f1 = petFloorY() - PET.lift, cx = PET.x + PET_SIZE / 2;
    let best = null;
    for (const p of petPlatforms()) {
      if (p.el === PET.dropEl && now < PET.dropUntil) continue;
      if (cx < p.l - 6 || cx > p.r + 6 || f0 > p.t + 1 || f1 < p.t) continue;
      if (!best || p.t < best.t) best = p;
    }
    if (best) return petLand(petFloorY() - best.t, best);
  }
  if (PET.lift <= 0) petLand(0, null);
}

function petGround(dt, now, kx) {
  const maxX = innerWidth - PET_SIZE - 4;
  if (PET.mode === 'sleep') return;
  if (PET.mode === 'trick') {
    if (now > PET.until) {
      const was = PET.trick;
      petSetMode('idle');
      if (was === 'dead') { petSay('ta-da.', { kind: 'ok' }); petFx(['spark'], 4); }
    }
    return;
  }
  if (kx) { // steered with the arrows
    PET.dir = kx; PET.x = petClamp(PET.x + kx * PET_SPEED * dt, 4, Math.max(4, maxX));
    PET.mode = 'walk'; PET.run = true;
    return;
  }
  // nobody is steering it: climb down from the page and go to the corner (also what it does right after the unlock)
  if (!PET.arrive && now - PET.manualAt > PET_PARK_MS && (PET.stand || Math.abs(PET.x - petCornerX()) > 6)) { PET.wx = petCornerX(); PET.arrive = true; }
  if (PET.arrive && PET.stand) { PET.stand = null; PET.vy = 0; petSetMode('air'); return; }
  if (PET.arrive) {
    PET.wx = petCornerX();
    const dx = PET.wx - PET.x;
    if (Math.abs(dx) > 6) { PET.dir = dx > 0 ? 1 : -1; PET.x += PET.dir * Math.min(Math.abs(dx), 170 * dt); PET.mode = 'walk'; PET.run = true; return; }
    PET.x = PET.wx; PET.wx = null; PET.arrive = false;
  }
  PET.mode = 'idle'; PET.run = false;
}

function petTick(ts) {
  requestAnimationFrame(petTick);
  const dt = Math.min(0.05, (ts - (PET.last || ts)) / 1000);
  PET.last = ts;
  const lockMode = petLockMode(), P = lockMode ? PET.mirror : S.pet;
  if (lockMode !== PET.lock) petLockSwitch(lockMode);
  const box = lockMode && document.querySelector('#lockHost .lockbox');
  const off = P.on === false || (lockMode && !box && !PET.placed); // on the lock screen it waits until the form exists
  if (PET.el.hidden !== off) { PET.el.hidden = off; PET.fxBox.hidden = off; }
  if (off) return;
  const now = Date.now();

  if (lockMode) petLockTick(dt, now, box);
  else {
    const kx = (PET.keys.right ? 1 : 0) - (PET.keys.left ? 1 : 0);
    if (PET.stand && PET.mode !== 'air' && !petSupport()) { PET.stand = null; PET.vy = 0; petSetMode('air'); } // nothing under the paws any more
    if (PET.mode === 'air') petAir(dt, now, kx); else petGround(dt, now, kx);
  }

  petClampX();
  PET.el.style.transform = `translate3d(${Math.round(PET.x)}px, ${Math.round(petTopY() - PET.lift)}px, 0)`;
  PET.el.style.setProperty('--lift', PET.lift.toFixed(0));

  /* state for CSS and the sprite */
  const set = (k, v) => { if (PET.el.dataset[k] !== v) PET.el.dataset[k] = v; };
  set('mode', PET.mode); set('trick', PET.trick); set('run', PET.mode === 'walk' && PET.run ? '1' : '0');
  petDraw(petPose(now, lockMode, now < PET.talkUntil));

  /* the bubble: typed text, then its position (below the pet when there is no room above it) */
  const b = PET.bub;
  if (!b.hidden) {
    if (now > PET.bubUntil) petHideBubble();
    else {
      const T = PET.typing;
      if (T) {
        const n = Math.min(T.text.length, Math.floor((now - T.t0) / PET_TYPE_MS));
        if (n !== T.n) { T.n = n; PET.bubDone.textContent = T.text.slice(0, n); PET.bubRest.textContent = T.text.slice(n); }
        if (n >= T.text.length) PET.typing = null;
      }
      if (!PET.bubW) { PET.bubW = Math.min(300, b.offsetWidth); PET.bubH = b.offsetHeight; }
      const left = PET.x + PET_SIZE / 2 - PET.bubW / 2;
      b.style.setProperty('--bs', Math.round(petClamp(left, 8, innerWidth - PET.bubW - 8) - left) + 'px');
      b.classList.toggle('below', petTopY() - PET.lift < PET.bubH + 18);
    }
  }
  if (PET.mode === 'sleep' && now > PET.sleepFx) { PET.sleepFx = now + 1800; petFx(['zzz'], 1, 6); }
}
/** Lock screen: the pet stands on top of the form (or, when the window is too short for that, on the floor next to it) */
function petLockTick(dt, now, box) {
  if (box) {
    const r = box.getBoundingClientRect(), room = Math.max(PET.bubH, 44) + 16, top = r.top - (PET_SIZE - 4); // feet on the form's top edge
    if (top >= room) PET.spot = { x: r.left + r.width / 2 - PET_SIZE / 2, lift: petTopY() - top };
    else PET.spot = { x: r.right + 24 + PET_SIZE <= innerWidth ? r.right + 24 : Math.max(4, r.left - PET_SIZE - 24), lift: 0 };
  }
  const t = PET.spot;
  if (!t) return;
  if (!PET.placed) { PET.x = t.x; PET.lift = t.lift; PET.placed = true; }
  const dx = t.x - PET.x;
  if (Math.abs(dx) > 4) { PET.dir = dx > 0 ? 1 : -1; PET.x += PET.dir * Math.min(Math.abs(dx), 300 * dt); }
  PET.lift += (t.lift - PET.lift) * Math.min(1, 7 * dt);
  PET.run = false;
  if (PET.mode === 'trick') { if (now > PET.until) petSetMode('lock'); }
  else PET.mode = Math.abs(dx) > 4 ? 'walk' : 'lock';
}
/** Called when the lock screen appears or goes away */
function petLockSwitch(on) {
  PET.lock = on;
  PET.el.dataset.lock = PET.fxBox.dataset.lock = on ? '1' : '0';
  PET.keys = {};
  petMenuClose();
  if (on) {
    if (PET.live && S && S.pet) { PET.relock = true; petMirrorSave(); }
    PET.arrive = false; PET.wx = null; PET.stand = null;
    if (!PET.lockMsg) petHideBubble();
    petSetMode('lock');
    PET.frame = '';
    return;
  }
  PET.frame = '';
  PET.wx = petCornerX();
  PET.arrive = true; // on its way to the corner it ignores the page and lands on the floor
  PET.dir = PET.wx > PET.x ? 1 : -1;
  PET.vy = 420; // hops off the form and lands near the corner, then runs the rest
  PET.vx = petClamp((PET.wx - PET.x) / ((PET.vy + Math.sqrt(PET.vy ** 2 + 2 * PET_GRAV * PET.lift)) / PET_GRAV) / 0.75, -500, 500);
  PET.jumps = 1;
  petSetMode('air');
  PET.lockMsg = false;
  petHideBubble();
  if (PET.relock) { PET.relock = false; petSay('unlocked. back to my corner.', { kind: 'ok' }); }
}
function petSquash() {
  PET.el.classList.remove('squash');
  void PET.el.offsetWidth;
  PET.el.classList.add('squash');
}

/* ---------- Once a second: sleep and chatter ---------- */
function petSec() {
  if (!PET.live || !S || !S.pet) return;
  const P = S.pet, now = Date.now();
  P.at = now; // when it was last with you (for "welcome back")
  if (!PET.lock) petMirrorSave(); // its mood is remembered for the lock screen
  if (petVisible()) {
    const idle = now - lastActive, night = new Date().getHours() < 6;
    if (PET.mode === 'sleep') { if (idle < 3000) petWake(petPick(['rebooting...', 'welcome back.'])); }
    else if (['idle', 'walk'].includes(PET.mode) && !PET.keys.left && !PET.keys.right && idle > (night ? 45000 : 150000)) petSleep();
    if (now > PET.nextChat) {
      PET.nextChat = now + petRand(60000, 150000);
      if (!document.hidden && PET.bub.hidden && ['idle', 'walk'].includes(PET.mode) && idle < 120000) petChatter();
    }
  }
}

/** Commands for the Ctrl+K palette */
function petPaletteItems() {
  return [{ k: 'Pet', n: S.pet.on ? 'Hide the robot' : 'Show the robot', run: () => petShow(!S.pet.on) }];
}

/* ---------- Setup ---------- */
/** Runs as soon as the script loads: builds the pet so it can already stand on the lock screen (the data is still encrypted then) */
function petBoot() {
  try {
    if (PET.ready) return;
    const host = document.createElement('div');
    host.innerHTML = `<div id="pet" hidden><div class="pet-bubble" hidden></div><div class="pet-shadow"></div><div class="pet-flip"><div class="pet-sq"><div class="pet-fig"></div></div></div></div>
      <div id="petfx" hidden></div><div id="petmenu" hidden></div>`;
    while (host.firstChild) document.body.appendChild(host.firstChild);
    Object.assign(PET, { el: $('#pet'), fig: $('#pet .pet-fig'), bub: $('#pet .pet-bubble'), fxBox: $('#petfx'), menu: $('#petmenu') });
    PET.mirror = petMirrorLoad();
    PET.x = innerWidth / 2;

    PET.el.addEventListener('contextmenu', petMenuOpen);
    PET.bub.addEventListener('click', () => { const n = PET.bubNav; petHideBubble(); if (n && !petLockMode() && proj(n.pid)) openProject(n.pid, n.tab || 'tasks'); });
    PET.menu.addEventListener('click', e => { if (e.target.closest('[data-pet-hide]')) { petShow(false); toast('Robot hidden. Turn it back on in Settings.'); } });
    document.addEventListener('mousedown', e => { if (!PET.menu.hidden && !e.target.closest('#petmenu')) petMenuClose(); }, true);
    addEventListener('mousemove', e => { PETM.x = e.clientX; PETM.y = e.clientY; }, { passive: true });
    addEventListener('resize', petClampX);
    addEventListener('blur', () => { PET.keys = {}; });
    document.addEventListener('keydown', petKeyDown);
    document.addEventListener('keyup', petKeyUp);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') petMenuClose(); });
    document.addEventListener('change', e => { if (e.target.id === 'petOn') petShow(e.target.checked); });
    PET.ready = true;
    setInterval(petSec, 1000);
    requestAnimationFrame(petTick);
  } catch (e) { console.error('pet boot failed', e); }
}

/** Called once the data is unlocked: from then on the pet reacts to the app and uses S.pet */
function petInit() {
  try {
    if (!PET.ready || PET.live) return;
    const now = Date.now(), away = now - S.pet.at;
    PET.nextChat = now + 20000;
    PET.live = true;
    setTimeout(() => {
      if (!petVisible()) return;
      const h = new Date().getHours();
      petSay(away > 2 * 3600e3 ? `welcome back. i missed you (${Math.round(away / 3600e3)} h).` : h < 5 ? 'still up?' : h < 12 ? 'good morning.' : h < 18 ? 'good afternoon.' : 'good evening.');
    }, 1800);
  } catch (e) { console.error('pet init failed', e); }
}
petBoot();
