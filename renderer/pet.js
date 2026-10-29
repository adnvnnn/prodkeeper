'use strict';

/* ======================= Pet =======================
 * One pixel-art cat (renderer/petsprite.js) that keeps watch over the app; it is also the app's icon.
 *  - You steer it with the arrow keys: Left / Right walk, Up jumps (twice for a double jump), Down drops through what it stands on.
 *    Everything on the page is solid ground from above: cards, buttons, headings and lines of text. It can go anywhere you can jump.
 *  - On the lock screen it stands on the unlock form; after the unlock it hops down and runs back to where it was.
 *  - It talks in a terminal-style bubble: normal messages are typed out, errors and warnings appear at once. It is sad while the app
 *    has critical alerts, and a failed job, a new alert or a finished task / deploy / backup / focus session makes it react.
 *  - Tricks (mouse or keys), feeding, a ball, "follow my cursor" and a focus timer are in its panel.
 * Everything it remembers lives in S.pet (encrypted with the rest of the data); the app never depends on it. */
const PET_SIZE = 96, PET_PX = 5, PET_FLOOR = 4, PET_GRAV = 2200, PET_BALL = 28, PET_TYPE_MS = 26, PET_SPEED = 230;
const PET_JOKES = [
  'it works on my machine.', 'have you tried turning it off and on again?', 'git push --force? do not even think about it.',
  'two hard things: cache invalidation, naming things and off-by-one errors.', 'deploying on a friday evening? brave.',
  'backups are like parachutes. you want them before you need them.', 'commit early. commit often.',
  'tabs or spaces? i am a cat. i only care about treats.',
];
/* everything the pet can stand on (from above): text, controls and boxes */
const PET_SOLID = 'h1,h2,h3,h4,p,li,label,td,th,button,a,input,select,textarea,code,pre,summary,img,.card,.chip,.btn,.sub,.dd,.dialog,.pitem,.palette';

const petRand = (a, b) => a + Math.random() * (b - a);
const petPick = arr => arr[Math.floor(Math.random() * arr.length)];
const petClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const petIcons = {};
const petIcon = (name, px = 3) => petIcons[name + px] || (petIcons[name + px] = PetSprite.icon(name, px));

/** Fills in missing fields of the saved pet (called when the data is loaded, so old data files just get a new pet) */
function normPet(d) {
  d = d && typeof d === 'object' ? d : {};
  const st = d.stats || {};
  return {
    on: d.on !== false, name: String(d.name || 'Pixel').slice(0, 16),
    born: d.born || Date.now(), at: d.at || Date.now(),
    x: Number.isFinite(d.x) ? d.x : -1,
    focus: d.focus && d.focus.end ? { end: Number(d.focus.end), mins: Number(d.focus.mins) || 25 } : null,
    stats: { pets: +st.pets || 0, fed: +st.fed || 0, tasks: +st.tasks || 0, jobs: +st.jobs || 0, focus: +st.focus || 0, balls: +st.balls || 0 },
  };
}

/* ---------- State ---------- */
const PET = {
  ready: false, live: false, lock: false, placed: false, relock: false, arrive: false, lockMsg: false,
  el: null, fig: null, bub: null, badge: null, fxBox: null, mirror: null, mirrorJson: '', spot: null,
  x: 100, lift: 0, vx: 0, vy: 0, dir: 1, mode: 'idle', trick: '', until: 0, wx: null, nextWander: 0, run: false,
  keys: {}, jumps: 0, stand: null, dropEl: null, dropUntil: 0, plats: [], platsAt: 0,
  follow: 0, napUntil: 0, sleepAuto: false, food: null, ball: null, grab: null, last: 0,
  bubUntil: 0, bubNav: null, bubW: 0, bubH: 0, typing: null, bubDone: null, bubRest: null,
  talkUntil: 0, joyUntil: 0, blinkAt: 0, blinkUntil: 0, frame: '', nextChat: 0, lastSay: '', kickAt: 0,
  clicks: [], bad: 0, sleepFx: 0, panel: false, saveT: 0,
};
const PETM = { x: 0, y: 0 };
const petFloorY = () => innerHeight - PET_FLOOR;
const petTopY = () => innerHeight - PET_FLOOR - PET_SIZE;
/** True while the lock screen is up (or the data is not loaded yet): the pet then stands on the lock form and only uses its saved look */
const petLockMode = () => !PET.live || !S || (typeof locking !== 'undefined' && locking) || !$('#lock').hidden;
/** The pet can react to the app only when the data is open; it never says anything about it on the lock screen */
const petVisible = () => PET.ready && PET.live && S && S.pet.on && !petLockMode();
const petMood = () => (PET.bad > 0 ? 'sad' : 'happy');
const petSaveSoon = () => { clearTimeout(PET.saveT); PET.saveT = setTimeout(() => { if (S && !NOSAVE) save(); }, 3000); };

/* The data is encrypted, so before the unlock the pet cannot read it. Its name and mood are mirrored in localStorage, like the theme,
 * so the lock screen can show the same pet. Nothing in it is sensitive. */
const PET_MIRROR_KEY = 'aw-pet';
function petMirrorLoad() {
  let m = {};
  try { m = JSON.parse(localStorage.getItem(PET_MIRROR_KEY)) || {}; } catch { /* storage unavailable */ }
  return { on: m.on !== false, name: String(m.name || 'Pixel').slice(0, 16), mood: m.mood === 'sad' ? 'sad' : 'happy' };
}
function petMirrorSave() {
  const P = S.pet, m = { on: P.on, name: P.name, mood: petMood() }, j = JSON.stringify(m);
  PET.mirror = m;
  if (j === PET.mirrorJson) return;
  PET.mirrorJson = j;
  try { localStorage.setItem(PET_MIRROR_KEY, j); } catch { /* storage unavailable */ }
}
/** Forces the sprite to be drawn again on the next frame (focus glasses changed) */
function petRedraw() { PET.frame = ''; }

/* ---------- Drawing: the sprite is rebuilt only when its pose changes ---------- */
function petPose(now, lockMode, talking) {
  const mood = lockMode ? PET.mirror.mood : petMood(), own = !lockMode && S.pet;
  if (now > PET.blinkAt) { PET.blinkAt = now + petRand(2500, 6000); PET.blinkUntil = now + 140; }
  let eyes = 'open';
  if (PET.mode === 'sleep') eyes = 'closed';
  else if (PET.trick === 'dead') eyes = 'x';
  else if (now < PET.joyUntil) eyes = 'happy';
  else if (now < PET.blinkUntil) eyes = 'closed';
  let mouth = mood === 'sad' ? 'sad' : 'smile';
  if (talking) mouth = 'open';
  if (PET.mode === 'eat') mouth = Math.floor(now / 160) % 2 ? 'open' : 'smile';
  const dx = PETM.x - (PET.x + PET_SIZE / 2), sgn = PET.dir > 0 ? -1 : 1; // the sprite is mirrored when it faces right
  const look = PET.mode === 'sleep' ? 0 : Math.abs(dx) < 90 ? 0 : (dx > 0 ? 1 : -1) * sgn;
  return {
    eyes, mouth, look, glasses: !!(own && own.focus),
    step: PET.mode === 'walk' ? 1 + (Math.floor(now / (PET.run ? 110 : 170)) % 2) : PET.mode === 'air' ? 2 : 0,
    tail: PET.mode === 'sleep' || mood === 'sad' ? 0 : Math.floor(now / 420) % 2,
  };
}
function petDraw(pose) {
  const key = Object.values(pose).join('|');
  if (key === PET.frame) return;
  PET.frame = key;
  PET.fig.innerHTML = PetSprite.svg(PetSprite.cat(pose), PET_PX);
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
  if (!['air', 'eat'].includes(PET.mode)) petJump(560);
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
  PET.napUntil = 0;
  PET.nextWander = Date.now() + 2500;
  if (text) petSay(text);
}
function petSleep(manual) {
  if (!petVisible() || ['air', 'eat', 'sleep'].includes(PET.mode)) return;
  petSetMode('sleep');
  PET.sleepAuto = !manual;
  PET.napUntil = manual ? Date.now() + 120000 : 0;
  PET.wx = null;
}

/* ---------- Reacting to the app (called from the rest of the renderer) ---------- */
const PET_JOB_KINDS = ['deploy', 'backup', 'build', 'dbupdate', 'publish'];
function petEvent(type, d = {}) {
  if (!PET.live || !S || !S.pet) return;
  try {
    const P = S.pet;
    if (type === 'task-done') {
      if (!d.t || d.t.petDone) return; // a task counts once, so moving it back and forth does not repeat the party
      d.t.petDone = 1;
      P.stats.tasks++;
      petSaveSoon();
      petCelebrate(petPick(['task done. nice one.', 'one less thing on the list.', 'task complete. good job.', 'done. what is next?']));
    } else if (type === 'job') {
      if (!PET_JOB_KINDS.includes(d.kind)) return;
      if (d.status === 'ok') {
        P.stats.jobs++;
        petSaveSoon();
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

/* ---------- Actions: feed, play, tricks, focus ---------- */
function petFeed() {
  if (PET.food) return toast('There is already food on the floor');
  if (PET.mode === 'sleep') petWake();
  const el = document.createElement('div');
  el.className = 'pet-item pet-food';
  el.innerHTML = petIcon('fish', 4);
  document.body.appendChild(el);
  PET.food = { el, x: petRand(60, innerWidth - 60), lift: innerHeight - 150, vy: 0 };
}
function petFinishEat() {
  if (PET.food) { PET.food.el.remove(); PET.food = null; }
  S.pet.stats.fed++;
  petFx(['heart', 'crumb'], 4);
  petSay(petPick(['yum.', 'delicious.', 'more please?', 'nom nom nom.']));
  petSaveSoon();
}
function petBall() {
  if (PET.ball) { PET.ball.el.remove(); PET.ball = null; return; }
  if (PET.mode === 'sleep') petWake();
  const el = document.createElement('div');
  el.className = 'pet-item pet-ball';
  el.innerHTML = petIcon('ball', 4);
  document.body.appendChild(el);
  PET.ball = { el, x: petRand(80, innerWidth - 80), lift: innerHeight - 160, vx: petRand(-200, 200), vy: 0, touched: Date.now() };
}
function petFollow() {
  PET.follow = PET.follow > Date.now() ? 0 : Date.now() + 90000;
  if (PET.follow && PET.mode === 'sleep') petWake();
  if (PET.follow) petSay('catch me if you can.');
}
/** Tricks: from the panel buttons and from the keys (F, D, X, S; Up is the jump) */
function petDo(t) {
  if (!petVisible() || ['air', 'eat'].includes(PET.mode)) return;
  if (PET.mode === 'sleep') petWake();
  if (t === 'jump') petJump(860);
  else if (t === 'flip') { PET.stand = null; PET.jumps = 1; petSetMode('air', 'flip'); PET.vy = 800; PET.vx = 0; }
  else if (t === 'dance') { petSetMode('trick', 'dance', 2800); petFx(['note', 'spark'], 8, 40); }
  else if (t === 'dead') { petSetMode('trick', 'dead', 2800); petFx(['star'], 3); }
  else if (t === 'speak') { petSay('meow!', { ms: 1800 }); petFx(['note'], 2); }
}
function petStartFocus(mins) {
  const P = S.pet;
  P.focus = { end: Date.now() + mins * 60000, mins };
  if (PET.mode === 'sleep') petWake();
  PET.wx = null; PET.follow = 0;
  petRedraw();
  petSay(`focus mode on: ${mins} min. i will keep watch.`);
  petSaveSoon(); petPanelRender();
}
function petEndFocus(done) {
  const P = S.pet, f = P.focus;
  if (!f) return;
  P.focus = null;
  if (PET.mode === 'work') petSetMode('idle');
  petRedraw();
  if (done) {
    P.stats.focus++;
    petCelebrate('focus session complete. take a break.');
    try { pushNote('Focus session complete', `${f.mins} minutes done. Take a short break!`, {}); } catch { /* notifications unavailable */ }
  }
  petSaveSoon(); petPanelRender();
}
function petShow(on) {
  S.pet.on = on;
  if (on) { PET.nextChat = Date.now() + 8000; petClampX(); }
  else { petHideBubble(); if (PET.food) { PET.food.el.remove(); PET.food = null; } if (PET.ball) { PET.ball.el.remove(); PET.ball = null; } }
  petSaveSoon(); petPanelRender();
}
function petClampX() { PET.x = petClamp(PET.x, 4, Math.max(4, innerWidth - PET_SIZE - 4)); }

/* ---------- Idle chatter: the pet says something about what is really going on ---------- */
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
  if (h >= 12 && h < 14) opts.push({ w: 1.5, t: 'lunch time?' });
  opts.push({ w: 1, t: 'drink some water.' }, { w: 1, t: 'stretch your legs for a minute.' }, { w: 1, t: 'arrow keys: walk and jump. try it.' });
  opts.push({ w: 1.5, t: petPick(PET_JOKES) });
  const pool = opts.filter(o => o.t !== PET.lastSay), total = pool.reduce((s, o) => s + o.w, 0);
  let r = Math.random() * total, ch = pool[0];
  for (const o of pool) { if ((r -= o.w) <= 0) { ch = o; break; } }
  if (ch) petSay(ch.t, { nav: ch.nav, kind: ch.kind });
}

/* ---------- Keyboard and mouse ---------- */
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
    if (t) petDo(t);
  }
}
function petKeyUp(e) {
  const k = e.key;
  if (k.startsWith('Arrow')) PET.keys[k.slice(5).toLowerCase()] = false;
}
/** The player takes over: no more wandering, following or hurrying home */
function petManual() {
  PET.follow = 0; PET.arrive = false; PET.wx = null;
  PET.nextWander = Date.now() + 5000;
  if (PET.mode === 'sleep') petWake();
  else if (PET.mode === 'trick' || PET.mode === 'eat') petSetMode('idle');
}
function petJumpKey() {
  if (PET.mode !== 'air') { PET.stand = null; PET.jumps = 1; PET.vy = 880; petSetMode('air'); }
  else if (PET.jumps < 2) { PET.jumps = 2; PET.vy = 820; petFx(['spark'], 2, 10); } // double jump
}

function petGrabBall(e) {
  const b = PET.ball;
  PET.grab = { sx: e.clientX, sy: e.clientY, ox: e.clientX - (b.x - PET_BALL / 2), oy: e.clientY - (innerHeight - PET_FLOOR - PET_BALL - b.lift), moved: false, s: [] };
  e.preventDefault();
}
function petMouseMove(e) {
  PETM.x = e.clientX; PETM.y = e.clientY;
  const g = PET.grab;
  if (!g) return;
  if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 5) return;
  const now = performance.now(), b = PET.ball;
  g.moved = true; b.held = true;
  g.s.push({ t: now, x: e.clientX, y: e.clientY });
  while (g.s.length > 2 && now - g.s[0].t > 90) g.s.shift();
  b.x = petClamp(e.clientX - g.ox + PET_BALL / 2, PET_BALL / 2, innerWidth - PET_BALL / 2);
  b.lift = petClamp(innerHeight - PET_FLOOR - PET_BALL - (e.clientY - g.oy), 0, innerHeight - 110);
  b.touched = Date.now();
}
function petMouseUp() {
  const g = PET.grab;
  if (!g) return;
  PET.grab = null;
  const b = PET.ball, a = g.s[0], z = g.s[g.s.length - 1];
  if (!g.moved || !b) return;
  b.held = false; b.vx = 0; b.vy = 0;
  if (a && z && z.t > a.t) { const dt = (z.t - a.t) / 1000; b.vx = petClamp((z.x - a.x) / dt, -1600, 1600); b.vy = petClamp(-(z.y - a.y) / dt, -1600, 1600); }
}
/** Click on the pet: pet it. Two quick clicks: jump. */
function petClicked() {
  const now = Date.now();
  if (petLockMode()) { PET.joyUntil = now + 1300; petFx(['heart'], 2); return; } // the data is locked: just a hello
  const P = S.pet;
  if (PET.mode === 'sleep') return petWake('huh?');
  PET.clicks = PET.clicks.filter(t => now - t < 3000);
  PET.clicks.push(now);
  const n = PET.clicks.length;
  if (n >= 2 && now - PET.clicks[n - 2] < 350 && PET.mode !== 'eat') petJump(700);
  P.stats.pets++;
  PET.joyUntil = now + 1300;
  petFx(['heart'], 2);
  if (n >= 8) { PET.clicks = []; petSay('ok ok, i love you too.'); petFx(['heart'], 6, 30); }
  else if (P.stats.pets % 7 === 0) petSay(petPick(['*purr*', 'meow.', 'that feels nice.']), { ms: 1800 });
  petSaveSoon();
}

/* ---------- The ground under its paws: every piece of text and box on the page ---------- */
function petPlatforms(force) {
  const now = performance.now();
  if (!force && now - PET.platsAt < 250) return PET.plats;
  PET.platsAt = now;
  const roots = !$('#confirm').hidden ? ['#confirm'] : !$('#modal').hidden ? ['#modal'] : !$('#palette').hidden ? ['#palette'] : ['#app'];
  const panel = PET.panel && roots[0] === '#app' ? $('#petpanel').getBoundingClientRect() : null;
  if (panel) roots.push('#petpanel');
  const out = [];
  for (const root of roots) {
    for (const el of document.querySelectorAll(`${root} :is(${PET_SOLID})`)) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 6 || r.top < PET_SIZE || r.top > innerHeight - 12 || r.right < 0 || r.left > innerWidth) continue;
      if (panel && root !== '#petpanel' && r.left < panel.right && r.right > panel.left && r.top > panel.top && r.top < panel.bottom) continue; // hidden behind the panel
      out.push({ el, l: r.left, r: r.right, t: r.top });
      if (out.length > 900) break;
    }
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
function petLand(lift, plat, now) {
  const hit = -PET.vy;
  PET.lift = lift; PET.vy = 0; PET.jumps = 0;
  PET.stand = plat ? { el: plat.el, t: plat.t } : null;
  if (!PET.keys.left && !PET.keys.right) PET.vx = 0;
  if (PET.mode === 'air') petSetMode('idle');
  if (hit > 500) petSquash();
}

/* ---------- The loop ---------- */
function petBallTick(dt) {
  const b = PET.ball;
  if (!b) return;
  if (!b.held) {
    b.vy -= PET_GRAV * dt;
    b.lift += b.vy * dt;
    b.x += b.vx * dt;
    if (b.lift <= 0) {
      b.lift = 0;
      if (b.vy < -160) b.vy = -b.vy * 0.68; else b.vy = 0;
      b.vx *= Math.max(0, 1 - 1.3 * dt);
    }
    const r = PET_BALL / 2;
    if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx) * 0.8; } else if (b.x > innerWidth - r) { b.x = innerWidth - r; b.vx = -Math.abs(b.vx) * 0.8; }
    const top = innerHeight - 110;
    if (b.lift > top) { b.lift = top; b.vy = -Math.abs(b.vy) * 0.5; }
    if (Math.abs(b.vx) > 8 || b.lift > 0) b.touched = Date.now();
  }
  b.el.style.transform = `translate3d(${Math.round(b.x - PET_BALL / 2)}px, ${Math.round(innerHeight - PET_FLOOR - PET_BALL - b.lift)}px, 0)`;
  if (Date.now() - b.touched > 60000) { b.el.remove(); PET.ball = null; petPanelRender(); }
}
function petFoodTick(dt) {
  const f = PET.food;
  if (!f) return;
  if (f.lift > 0) { f.vy -= PET_GRAV * 0.6 * dt; f.lift = Math.max(0, f.lift + f.vy * dt); }
  f.el.style.transform = `translate3d(${Math.round(f.x - 16)}px, ${Math.round(innerHeight - PET_FLOOR - 20 - f.lift)}px, 0)`;
}

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
    if (best) return petLand(petFloorY() - best.t, best, now);
  }
  if (PET.lift <= 0) petLand(0, null, now);
}

function petGround(dt, now, kx) {
  const P = S.pet, maxX = innerWidth - PET_SIZE - 4, mid = PET.x + PET_SIZE / 2;
  if (PET.mode === 'sleep') return;
  if (PET.mode === 'eat') { if (now > PET.until) { petSetMode('idle'); petFinishEat(); } return; }
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
  if (P.focus) { petSetMode('work'); return; }
  if (PET.mode === 'work') petSetMode('idle');

  let tx = null, speed = 58, chasing = false;
  if (PET.arrive && PET.wx != null) { tx = PET.wx; speed = 170; } // just unlocked: hurry back to its spot
  else if (PET.food && PET.food.lift <= 1) { tx = PET.food.x - PET_SIZE / 2; speed = 170; chasing = true; }
  else if (PET.ball) { tx = PET.ball.x - PET_SIZE / 2; speed = 190; chasing = true; }
  else if (PET.follow > now) { tx = PETM.x - PET_SIZE / 2; speed = 210; chasing = true; if (PETM.y < petTopY() - PET.lift - 110 && Math.abs(tx - PET.x) < 40 && Math.random() < 0.02) petJump(700); }
  else if (PET.wx != null) tx = PET.wx;

  if (tx != null) {
    tx = petClamp(tx, 4, maxX);
    const dx = tx - PET.x;
    if (Math.abs(dx) > 6) {
      PET.dir = dx > 0 ? 1 : -1;
      PET.x += PET.dir * Math.min(Math.abs(dx), speed * dt);
      PET.mode = 'walk';
      PET.run = speed > 100;
    } else {
      if (!chasing) { PET.wx = null; PET.arrive = false; PET.nextWander = now + petRand(2500, 8000); }
      PET.mode = 'idle'; PET.run = false;
    }
  } else {
    PET.mode = 'idle'; PET.run = false;
    if (now > PET.nextWander && !PET.panel && !PET.stand) { // it only wanders on the floor; up on the page it stays where you put it
      PET.nextWander = now + petRand(3000, 8000);
      if (Math.random() < 0.6) { const w = petRand(10, maxX); if (Math.abs(w - PET.x) > 80) PET.wx = w; }
      else if (Math.random() < 0.15) petJump(560);
    }
  }
  if (PET.food && PET.food.lift <= 1 && PET.lift < 4 && Math.abs(mid - PET.food.x) < 30) {
    petSetMode('eat', '', 1500);
    petFx(['crumb'], 3);
    PET.food.el.classList.add('eating');
  }
  const b = PET.ball;
  if (b && now > PET.kickAt && Math.abs(mid - b.x) < 46 && Math.abs(b.lift - PET.lift) < 58 && !b.held) {
    const k = b.x >= mid ? 1 : -1;
    b.vx = k * petRand(380, 700); b.vy = petRand(420, 780); b.touched = now;
    PET.kickAt = now + 500; PET.dir = k;
    P.stats.balls++;
    if (P.stats.balls % 8 === 0) petFx(['star', 'spark'], 2);
    if (Math.random() < 0.35) petJump(520);
  }
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
  for (const it of [PET.ball, PET.food]) if (it && it.el.hidden !== (off || lockMode)) it.el.hidden = off || lockMode;
  if (off) return;
  const now = Date.now();
  if (!lockMode) { petBallTick(dt); petFoodTick(dt); }

  if (lockMode) petLockTick(dt, now, box);
  else {
    const kx = (PET.keys.right ? 1 : 0) - (PET.keys.left ? 1 : 0);
    if (PET.stand && PET.mode !== 'air' && !petSupport()) { PET.stand = null; PET.vy = 0; petSetMode('air'); } // nothing under the paws any more
    if (PET.mode === 'air') petAir(dt, now, kx); else petGround(dt, now, kx);
  }

  petClampX();
  PET.el.style.transform = `translate3d(${Math.round(PET.x)}px, ${Math.round(petTopY() - PET.lift)}px, 0)`;
  PET.el.style.setProperty('--lift', PET.lift.toFixed(0));
  PET.el.style.setProperty('--dir', PET.dir > 0 ? -1 : 1); // the tail is drawn on the right, so it trails behind when facing right

  /* state for CSS and the sprite */
  const talking = now < PET.talkUntil;
  const set = (k, v) => { if (PET.el.dataset[k] !== v) PET.el.dataset[k] = v; };
  set('mode', PET.mode); set('trick', PET.trick); set('run', PET.mode === 'walk' && PET.run ? '1' : '0');
  petDraw(petPose(now, lockMode, talking));

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
  if (on) {
    if (PET.live && S && S.pet) { PET.relock = true; petMirrorSave(); }
    PET.panel = false; petPanelRender();
    PET.follow = 0; PET.arrive = false; PET.wx = null; PET.stand = null; PET.badge.hidden = true;
    if (!PET.lockMsg) petHideBubble();
    petSetMode('lock');
    petRedraw();
    return;
  }
  petRedraw();
  const home = S.pet.x >= 0 ? S.pet.x : petRand(80, Math.max(100, innerWidth - 160));
  PET.wx = petClamp(home, 4, Math.max(4, innerWidth - PET_SIZE - 4));
  PET.arrive = true; // on its way home it ignores the page and lands on the floor
  PET.dir = PET.wx > PET.x ? 1 : -1;
  PET.vy = 420; // hops off the form and lands near its spot, then runs the rest
  PET.vx = petClamp((PET.wx - PET.x) / ((PET.vy + Math.sqrt(PET.vy ** 2 + 2 * PET_GRAV * PET.lift)) / PET_GRAV) / 0.75, -500, 500);
  PET.jumps = 1;
  petSetMode('air');
  PET.lockMsg = false;
  petHideBubble();
  if (PET.relock) { PET.relock = false; petSay('unlocked. back to my spot.', { kind: 'ok' }); }
}
function petSquash() {
  PET.el.classList.remove('squash');
  void PET.el.offsetWidth;
  PET.el.classList.add('squash');
}

/* ---------- Once a second: focus, sleep, chatter ---------- */
function petSec() {
  if (!PET.live || !S || !S.pet) return;
  const P = S.pet, now = Date.now();
  P.at = now; // when it was last with you (for "welcome back")
  if (P.focus) {
    const left = P.focus.end - now;
    if (left <= 0) petEndFocus(true);
    else if (!PET.lock) { PET.badge.hidden = false; PET.badge.textContent = petClock(left); }
  } else if (!PET.badge.hidden) PET.badge.hidden = true;
  if (!PET.lock) { // remember where it stands (its spot after the next unlock) and how it looks (for the lock screen)
    if (PET.mode !== 'air') P.x = Math.round(PET.x);
    petMirrorSave();
  }

  if (petVisible()) {
    const idle = now - lastActive, night = new Date().getHours() < 6;
    if (PET.mode === 'sleep') {
      if (PET.sleepAuto && idle < 3000) petWake(petPick(['yawn...', 'oh, you are back.']));
      else if (!PET.sleepAuto && now > PET.napUntil) petWake('that was a good nap.');
    } else if (!P.focus && ['idle', 'walk'].includes(PET.mode) && !PET.food && !PET.ball && PET.follow < now && !PET.keys.left && !PET.keys.right && idle > (night ? 45000 : 150000)) petSleep(false);
    if (now > PET.nextChat) {
      PET.nextChat = now + petRand(55000, 120000);
      if (!document.hidden && !PET.panel && PET.bub.hidden && ['idle', 'walk'].includes(PET.mode) && idle < 120000) petChatter();
    }
  }
  if (PET.panel) petPanelUpdate();
}
const petClock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

/* ---------- Panel ---------- */
I.paw = '<svg viewBox="0 0 24 24"><ellipse cx="5.5" cy="11" rx="2" ry="2.6"/><ellipse cx="9.5" cy="6.5" rx="2" ry="2.6"/><ellipse cx="14.5" cy="6.5" rx="2" ry="2.6"/><ellipse cx="18.5" cy="11" rx="2" ry="2.6"/><path d="M12 11.5c-3 0-6 3.2-6 5.7 0 1.9 1.6 2.8 3 2.8 1.3 0 2-.6 3-.6s1.7.6 3 .6c1.4 0 3-.9 3-2.8 0-2.5-3-5.7-6-5.7z"/></svg>';
function petPanelHtml() {
  const P = S.pet, now = Date.now(), days = Math.max(1, Math.round((now - P.born) / 864e5));
  const tricks = [['jump', 'Jump', 'Up'], ['flip', 'Backflip', 'F'], ['dance', 'Dance', 'D'], ['dead', 'Play dead', 'X'], ['speak', 'Speak', 'S']];
  return `<div class="pp-head"><div class="pet-ava">${PetSprite.svg(PetSprite.cat({ glasses: !!P.focus }), 3, [0, 3, 16, 16])}</div>
      <div class="grow"><input id="petName" type="text" maxlength="16" value="${esc(P.name)}" spellcheck="false" aria-label="Pet name">
        <div class="sub pp-meta">${PET.bad > 0 ? 'sad: critical alerts' : 'all good'}</div></div>
      <button class="iconbtn" data-action="pet-panel" title="Close">${I.x}</button></div>
    <div class="pp-sec pp-btns">
      <button class="btn sm" data-action="pet-feed">${petIcon('fish', 2)} Feed</button>
      <button class="btn sm ${PET.ball ? 'on' : ''}" data-action="pet-ball">${petIcon('ball', 2)} ${PET.ball ? 'Put the ball away' : 'Play ball'}</button>
      <button class="btn sm ${PET.follow > now ? 'on' : ''}" data-action="pet-follow">Follow my cursor</button>
      <button class="btn sm" data-action="pet-pat">${petIcon('heart', 2)} Pet</button>
      <button class="btn sm" data-action="pet-nap">${PET.mode === 'sleep' ? 'Wake up' : 'Nap'}</button>
    </div>
    <div class="pp-sec"><div class="pp-lbl">tricks <span class="sub">click a button or press its key</span></div>
      <div class="pp-btns">${tricks.map(([t, l, k]) => `<button class="btn sm" data-action="pet-trick" data-t="${t}">${l} <kbd>${k}</kbd></button>`).join('')}</div></div>
    <div class="pp-sec"><div class="pp-lbl">move <span class="sub">it climbs on text and boxes</span></div>
      <div class="pp-keys"><span><kbd>Left</kbd><kbd>Right</kbd> walk</span><span><kbd>Up</kbd> jump (twice = double jump)</span><span><kbd>Down</kbd> drop through</span></div></div>
    <div class="pp-sec"><div class="pp-lbl">focus session <span class="sub">work together</span></div>
      ${P.focus ? `<div class="pfocus"><b data-k="timer">${petClock(P.focus.end - now)}</b><span class="sub">left of ${P.focus.mins} min</span><span class="grow"></span><button class="btn sm danger" data-action="pet-focus-stop">Cancel</button></div>`
        : `<div class="pp-btns">${[15, 25, 50].map(m => `<button class="btn sm" data-action="pet-focus" data-m="${m}">${m} min</button>`).join('')}</div>`}</div>
    <div class="pp-foot sub">together ${days} day${days > 1 ? 's' : ''} · petted ${P.stats.pets}x · ${P.stats.tasks} tasks · ${P.stats.jobs} jobs · ${P.stats.focus} focus
      <button class="btn sm" data-action="pet-hide" style="margin-inline-start:auto">Hide pet</button></div>`;
}
function petPanelRender() {
  const el = $('#petpanel');
  if (!el) return;
  el.hidden = !PET.panel;
  if (!PET.panel) return;
  const y = el.scrollTop;
  el.innerHTML = petPanelHtml();
  el.scrollTop = y;
}
/** Cheap refresh while the panel is open (the focus clock), so typing a name is never interrupted */
function petPanelUpdate() {
  const el = $('#petpanel');
  if (!PET.panel || !el || !S) return;
  const P = S.pet;
  if (!!el.querySelector('[data-k=timer]') !== !!P.focus) return petPanelRender();
  const t = el.querySelector('[data-k=timer]');
  if (t && P.focus) t.textContent = petClock(P.focus.end - Date.now());
}

Object.assign(actions, {
  'pet-panel': () => { if (S.pet.on === false) petShow(true); PET.panel = !PET.panel; petPanelRender(); },
  'pet-feed': () => petFeed(),
  'pet-ball': () => { petBall(); petPanelRender(); },
  'pet-follow': () => { petFollow(); petPanelRender(); },
  'pet-pat': () => { if (petVisible()) petClicked(); },
  'pet-nap': () => { if (PET.mode === 'sleep') petWake('good morning.'); else petSleep(true); petPanelRender(); },
  'pet-trick': el => petDo(el.dataset.t),
  'pet-focus': el => petStartFocus(Number(el.dataset.m)),
  'pet-focus-stop': () => petEndFocus(false),
  'pet-hide': () => { PET.panel = false; petShow(false); toast('Pet hidden. Bring it back from the paw button in the top bar'); },
});

/** Commands for the Ctrl+K palette */
function petPaletteItems() {
  const need = fn => () => { if (!S.pet.on) petShow(true); fn(); };
  return [
    { k: 'Pet', n: 'Open pet panel', run: () => actions['pet-panel']() },
    { k: 'Pet', n: S.pet.on ? 'Hide pet' : 'Show pet', run: () => petShow(!S.pet.on) },
    { k: 'Pet', n: 'Feed pet', run: need(petFeed) },
    { k: 'Pet', n: 'Play ball with pet', run: need(petBall) },
    { k: 'Pet', n: 'Pet follows my cursor', run: need(petFollow) },
    { k: 'Pet', n: 'Pet does a trick', run: need(() => petDo(petPick(['flip', 'dance', 'dead', 'speak']))) },
    { k: 'Pet', n: 'Start 25-minute focus session', run: need(() => petStartFocus(25)) },
  ];
}

/* ---------- Setup ---------- */
/** Runs as soon as the script loads: builds the pet so it can already stand on the lock screen (the data is still encrypted then) */
function petBoot() {
  try {
    if (PET.ready) return;
    const host = document.createElement('div');
    host.innerHTML = `<div id="pet" hidden><div class="pet-bubble" hidden></div><div class="pet-badge" hidden></div>
        <div class="pet-shadow"></div><div class="pet-flip"><div class="pet-sq"><div class="pet-fig"></div></div></div></div>
      <div id="petfx" hidden></div><div id="petpanel" hidden></div>`;
    while (host.firstChild) document.body.appendChild(host.firstChild);
    Object.assign(PET, { el: $('#pet'), fig: $('#pet .pet-fig'), bub: $('#pet .pet-bubble'), badge: $('#pet .pet-badge'), fxBox: $('#petfx') });
    PET.mirror = petMirrorLoad();
    PET.x = innerWidth / 2;
    $('#topbar [data-action="pet-panel"]').innerHTML = I.paw;

    PET.el.addEventListener('mousedown', e => {
      if (e.button !== 0 || e.target.closest('.pet-bubble')) return;
      e.preventDefault(); // keeps the focus (and a half-typed password) where it was
      petClicked();
    });
    PET.el.addEventListener('contextmenu', e => { e.preventDefault(); if (!petLockMode()) actions['pet-panel'](); });
    PET.bub.addEventListener('click', () => { const n = PET.bubNav; petHideBubble(); if (n && !petLockMode() && proj(n.pid)) openProject(n.pid, n.tab || 'tasks'); });
    document.addEventListener('mousedown', e => { if (e.button === 0 && PET.ball && e.target.closest && e.target.closest('.pet-ball') === PET.ball.el) petGrabBall(e); });
    addEventListener('mousemove', petMouseMove, { passive: true });
    addEventListener('mouseup', petMouseUp);
    addEventListener('resize', petClampX);
    addEventListener('blur', () => { PET.keys = {}; });
    document.addEventListener('keydown', petKeyDown);
    document.addEventListener('keyup', petKeyUp);
    document.addEventListener('change', e => { if (e.target.id === 'petName') { S.pet.name = e.target.value.trim().slice(0, 16) || 'Pixel'; e.target.value = S.pet.name; petSaveSoon(); } });
    document.addEventListener('keydown', e => {
      if (e.target.id === 'petName' && e.key === 'Enter') e.target.blur();
      else if (e.key === 'Escape' && PET.panel && $('#modal').hidden && $('#confirm').hidden && $('#palette').hidden) { PET.panel = false; petPanelRender(); }
    });
    PET.ready = true;
    setInterval(petSec, 1000);
    requestAnimationFrame(petTick);
  } catch (e) { console.error('pet boot failed', e); }
}

/** Called once the data is unlocked: from then on the pet reacts to the app and uses S.pet */
function petInit() {
  try {
    if (!PET.ready || PET.live) return;
    const P = S.pet, now = Date.now(), away = now - P.at;
    PET.nextChat = now + 20000; PET.nextWander = now + 3000;
    if (P.focus && P.focus.end < now) P.focus = null;
    PET.live = true;

    /* greeting */
    setTimeout(() => {
      if (!petVisible()) return;
      const h = new Date().getHours(), hi = h < 5 ? 'still up?' : h < 12 ? 'good morning.' : h < 18 ? 'good afternoon.' : 'good evening.';
      if (away > 2 * 3600e3) petSay(`welcome back. i missed you (${Math.round(away / 3600e3)} h).`);
      else petSay(hi);
    }, 1800);
  } catch (e) { console.error('pet init failed', e); }
}
petBoot();
