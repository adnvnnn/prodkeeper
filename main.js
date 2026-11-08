const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, Tray, Notification, nativeImage, globalShortcut, nativeTheme, screen, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const gitlib = require('./lib/git');
const secure = require('./lib/secure');
const vault = require('./lib/vault');
const jobs = require('./lib/jobs');
const net = require('./lib/net');
const scaffold = require('./lib/scaffold');

if (!app.requestSingleInstanceLock()) app.quit();
// The UI is plain DOM: GPU compositing buys nothing, and a window that stays open for days is the classic victim of a lost GPU / display reset (white window)
app.disableHardwareAcceleration();
app.setAppUserModelId('dev.prodkeeper.app');

let win, tray, popupWin, popupSnap = { locked: true }, popupPlaced = false, quitting = false;
const startHidden = process.argv.includes('--hidden');

/* Non-secret background preferences (needed in main; the encrypted data is not available before the master password is entered) */
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const PREF_DEFAULTS = { keepRunning: true, autoStart: true, theme: 'dark' };
let prefs = { ...PREF_DEFAULTS };
function loadPrefs() { try { prefs = { ...PREF_DEFAULTS, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch { /* first run */ } }
const THEME_BG = { dark: '#0a0a0b', light: '#f6f6f7' };
/** The window and native parts (scrollbars, dialogs) follow the chosen theme from the very first frame, including the lock screen */
function applyNativeTheme() {
  if (!['system', 'light', 'dark'].includes(prefs.theme)) prefs.theme = 'dark';
  nativeTheme.themeSource = prefs.theme;
  const bg = nativeTheme.shouldUseDarkColors ? THEME_BG.dark : THEME_BG.light;
  if (win && !win.isDestroyed()) win.setBackgroundColor(bg);
  if (popupWin && !popupWin.isDestroyed()) {
    popupWin.setBackgroundColor(bg);
    popupSnap = { ...popupSnap, theme: popupTheme() };
    popupWin.webContents.send('popup:data', popupSnap);
  }
}
/** The popup follows the app theme; while locked it still has to match, so main resolves it itself */
function popupTheme() { return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'; }
function savePrefs() { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs), 'utf8'); } catch { /* read-only */ } }
function applyAutoStart() {
  if (!app.isPackaged) return; // in development we do not register electron.exe as a startup item
  app.setLoginItemSettings({ openAtLogin: !!prefs.autoStart, args: ['--hidden'] });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 840, minWidth: 1000, minHeight: 620,
    // the .ico has an exact image for every size; a PNG would be scaled down by Windows for the taskbar
    title: 'ProdKeeper', icon: asset('icon.ico'), backgroundColor: nativeTheme.shouldUseDarkColors ? THEME_BG.dark : THEME_BG.light, show: !startHidden,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  // a hidden renderer must still run the monitoring timers without throttling
  win.webContents.setBackgroundThrottling(false);
  // After hours the page can die (crash / out of memory / killed on sleep) or stop painting, which leaves a blank white window: log it and load it again
  win.webContents.on('render-process-gone', (_e, d) => {
    logCrash(`main window renderer gone: ${d.reason} (exit ${d.exitCode})`);
    if (d.reason !== 'clean-exit') reloadPage();
  });
  win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: the load was replaced by another one
    logCrash(`main window failed to load: ${desc} (${code})`);
    reloadPage(2000);
  });
  win.webContents.on('unresponsive', () => logCrash('main window is not responding'));
  win.on('restore', () => checkPage(true));
  clearInterval(watchdog);
  watchdog = setInterval(() => checkPage(false), WATCHDOG_MS);
  win.on('closed', () => { if (popupWin && !popupWin.isDestroyed()) popupWin.destroy(); });
  win.on('close', e => {
    if (quitting || !prefs.keepRunning) return;
    e.preventDefault();
    win.hide();
  });
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });
  }
}

function logCrash(msg) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), `${new Date().toISOString()} ${msg}\n`, 'utf8'); } catch { /* read-only */ }
}
/* ---------- Keeping the page alive ----------
 * A window left open for days can end up white without any crash event: the renderer hangs, its content is gone, or the
 * compositor stops painting (sleep / resume, a display or GPU driver reset). A watchdog looks at the page from the outside
 * and loads it again; the app state is not lost because the key and the encrypted data live in main / on disk. */
const INDEX_HTML = path.join(__dirname, 'renderer', 'index.html');
const WATCHDOG_MS = Number(process.env.PK_WATCHDOG_MS) || 30000;
const STRIKES = { hung: 3, blank: 2, white: 2 }; // consecutive bad checks before acting (a busy page is not a dead one)
let watchdog = null, reloadTimer = null, reloadTimes = [], checking = false, strikes = { state: '', n: 0 };

/** Loads the page again (a fresh load works on a crashed page where reload() may not); a page that keeps dying is retried slowly */
function reloadPage(delay = 500) {
  if (reloadTimer || !win || win.isDestroyed()) return;
  const now = Date.now();
  reloadTimes = reloadTimes.filter(t => now - t < 60000);
  reloadTimes.push(now);
  if (reloadTimes.length > 5) delay = 30000;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    if (win && !win.isDestroyed()) win.loadFile(INDEX_HTML).catch(e => logCrash('main window reload failed: ' + e.message));
  }, delay);
}
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

/** True when a screenshot of the window is one flat pure-white frame (the app itself never paints pure white everywhere) */
async function frameIsWhite() {
  try {
    const img = await withTimeout(win.webContents.capturePage(), 4000);
    if (!img || img.isEmpty()) return false;
    const { width, height } = img.getSize(), px = img.toBitmap(); // BGRA
    const sx = Math.max(1, Math.floor(width / 64)), sy = Math.max(1, Math.floor(height / 40));
    for (let y = 0; y < height; y += sy) {
      for (let x = 0; x < width; x += sx) {
        const i = (y * width + x) * 4;
        if (px[i] !== 255 || px[i + 1] !== 255 || px[i + 2] !== 255) return false;
      }
    }
    return true;
  } catch { return false; }
}
/** 'ok' | 'hung' (does not answer) | 'blank' (no app content in the page) | 'white' (content exists but nothing is painted) */
async function probePage() {
  const wc = win.webContents;
  if (wc.isLoading()) return 'ok';
  let dom;
  try { dom = await withTimeout(wc.executeJavaScript('!!document.getElementById("main") && document.body.children.length > 0'), 5000); } catch { dom = false; }
  if (dom === null) return 'hung';
  if (!dom) return 'blank';
  if (win.isVisible() && !win.isMinimized() && await frameIsWhite()) return 'white';
  return 'ok';
}
/** force = the window was just shown / the PC just woke up: act on the first bad check instead of waiting for a second one */
async function checkPage(force) {
  if (checking || !win || win.isDestroyed()) return;
  checking = true;
  try {
    if (force) await new Promise(r => setTimeout(r, 600)); // let the window paint first
    if (!win || win.isDestroyed()) return;
    const state = await probePage();
    if (!win || win.isDestroyed()) return;
    if (state === 'ok') { strikes = { state: '', n: 0 }; if (force) win.webContents.invalidate(); return; }
    strikes = { state, n: strikes.state === state ? strikes.n + 1 : 1 };
    if (!force && strikes.n < STRIKES[state]) return;
    strikes = { state: '', n: 0 };
    logCrash(`main window page is ${state}: ${state === 'hung' ? 'restarted' : 'reloaded'}`);
    if (state === 'hung') win.webContents.forcefullyCrashRenderer(); // render-process-gone loads it again
    else reloadPage();
  } finally { checking = false; }
}
function showWin(nav) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  checkPage(true);
  if (nav) win.webContents.send('app:navigate', nav);
}
/* Task popup: a small always-on-top window above the tray icon. It stays put (no hide on blur) until it is closed with
 * Esc / the close button / the shortcut again, and can be dragged by its header. It only shows a snapshot that the main window pushes
 * (nothing is read from the encrypted data here, and the snapshot becomes "locked" when the app locks). */
const POPUP_W = 360, POPUP_H = 480;
function createPopup() {
  popupWin = new BrowserWindow({
    width: POPUP_W, height: POPUP_H, minWidth: 280, minHeight: 180, show: false, frame: false, resizable: true, maximizable: false, minimizable: false,
    skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, title: 'ProdKeeper tasks',
    backgroundColor: nativeTheme.shouldUseDarkColors ? THEME_BG.dark : THEME_BG.light,
    webPreferences: { preload: path.join(__dirname, 'popup-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  popupWin.setAlwaysOnTop(true, 'pop-up-menu');
  popupWin.loadFile(path.join(__dirname, 'renderer', 'popup.html'));
  popupWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popupWin.webContents.on('will-navigate', e => e.preventDefault());
  popupWin.on('close', e => { if (!quitting) { e.preventDefault(); popupWin.hide(); } });
}
function placePopup() {
  const [pw, ph] = popupWin.getSize();
  const tb = tray && tray.getBounds();
  const disp = tb && tb.width ? screen.getDisplayNearestPoint({ x: tb.x, y: tb.y }) : screen.getPrimaryDisplay();
  const wa = disp.workArea;
  let x = wa.x + wa.width - pw - 12, y = wa.y + wa.height - ph - 12;
  if (tb && tb.width) {
    x = Math.min(Math.max(tb.x + tb.width / 2 - pw / 2, wa.x + 12), wa.x + wa.width - pw - 12);
    y = tb.y > wa.y + wa.height / 2 ? tb.y - ph - 8 : tb.y + tb.height + 8;
    y = Math.min(Math.max(y, wa.y + 12), wa.y + wa.height - ph - 12);
  }
  popupWin.setPosition(Math.round(x), Math.round(y));
}
function togglePopup() {
  if (!popupWin || popupWin.isDestroyed()) createPopup();
  if (popupWin.isVisible()) { popupWin.hide(); return; }
  if (!popupPlaced) { placePopup(); popupPlaced = true; } // afterwards it reopens where (and as big as) the user left it
  if (popupSnap.locked) popupSnap = { locked: true, theme: popupTheme() };
  popupWin.webContents.send('popup:data', popupSnap);
  popupWin.setAlwaysOnTop(true, 'pop-up-menu');
  popupWin.show(); popupWin.focus();
}
function toggleWin() { if (win && win.isVisible() && win.isFocused()) win.hide(); else showWin(); }

/* Tray icon: the logo; a small amber / red dot is added for warnings / critical alerts */
const asset = f => path.join(__dirname, 'assets', f);
const trayIcon = level => nativeImage.createFromPath(asset(`tray-${level}.png`));
function setTrayStatus({ bad = 0, warn = 0 } = {}) {
  if (!tray) return;
  tray.setImage(trayIcon(bad ? 'bad' : warn ? 'warn' : 'ok'));
  tray.setToolTip(bad || warn ? `ProdKeeper — ${bad} critical, ${warn} warnings` : 'ProdKeeper — all healthy');
}
function createTray() {
  tray = new Tray(trayIcon('ok'));
  tray.setToolTip('ProdKeeper');
  tray.on('click', toggleWin);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open ProdKeeper', click: () => showWin() },
    { label: 'Tasks popup\tCtrl+Alt+T', click: togglePopup },
    { label: 'Lock', click: () => showWin({ lock: true }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

app.on('second-instance', () => showWin());
app.on('web-contents-created', (_e, wc) => wc.on('will-attach-webview', e => e.preventDefault()));
app.on('child-process-gone', (_e, d) => {
  if (d.type === 'GPU' || d.reason !== 'clean-exit') logCrash(`${d.type} process gone: ${d.reason} (exit ${d.exitCode})`);
  if (d.type === 'GPU') setTimeout(() => checkPage(true), 2000); // a lost GPU can leave the window unpainted
});
app.on('before-quit', () => { quitting = true; jobs.killServers(); vault.clearClipboard(); secure.lock(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  loadPrefs();
  applyNativeTheme();
  applyAutoStart();
  // only notifications are allowed; every other permission (camera, location, ...) is denied
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications'));

  const h = (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a));

  /* Master password and encrypted storage */
  h('sec:status', secure.status);
  h('sec:setup', secure.setup);
  h('sec:unlock', secure.unlock);
  h('sec:lock', () => { vault.clearClipboard(); return secure.lock(); });
  h('sec:change', secure.changePassword);
  h('sec:reset', secure.reset);
  h('sec:export', async () => {
    const bundle = secure.exportBundle();
    if (!bundle) return { error: 'The app is locked' };
    const day = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Save encrypted backup', defaultPath: `prodkeeper-backup-${day}.pkbak`, filters: [{ name: 'ProdKeeper Backup', extensions: ['pkbak'] }] });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, JSON.stringify(bundle), 'utf8');
    return { ok: true };
  });
  h('sec:import', async pw => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Restore from encrypted backup', filters: [{ name: 'ProdKeeper Backup', extensions: ['pkbak'] }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return { canceled: true };
    let b;
    try { b = JSON.parse(fs.readFileSync(filePaths[0], 'utf8')); } catch { return { error: 'Not a valid backup file' }; }
    return secure.importBundle(b, pw);
  });

  h('data:load', secure.loadData);
  h('data:save', secure.saveData);
  ipcMain.on('data:saveSync', (e, obj) => { e.returnValue = secure.saveData(obj); });
  h('data:path', () => app.getPath('userData'));

  h('shell:openFolder', async p => {
    if (typeof p !== 'string' || !p) return 'Path is empty';
    if (!fs.existsSync(p)) return 'This folder was not found';
    return shell.openPath(p);
  });
  h('shell:pickFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Choose folder', properties: ['openDirectory', 'createDirectory'] });
    return canceled ? null : filePaths[0];
  });
  h('shell:openUrl', net.openUrl);

  h('git', (op, repo, params) => gitlib.call(op, repo, params));

  h('vault:status', vault.status);
  h('vault:list', vault.list);
  h('vault:save', vault.save);
  h('vault:remove', vault.remove);
  h('vault:removeByProject', vault.removeByProject);
  h('vault:reveal', vault.reveal);
  h('vault:copy', vault.copy);

  h('job:run', spec => jobs.run(spec, m => win && !win.isDestroyed() && win.webContents.send('job:output', m)));
  h('job:kill', jobs.kill);
  h('job:backups', jobs.listBackups);
  h('db:test', jobs.testDatabase);

  h('net:check', net.check);
  h('ci:runs', net.ciRuns);
  h('ci:workflows', net.ciWorkflows);
  h('ci:action', net.ciAction);
  h('ci:detect', scaffold.detect);
  h('ci:scaffold', scaffold.write);
  h('ci:prs', net.prList);
  h('ci:prAction', net.prAction);
  h('ci:release', net.releaseCreate);
  h('flags:write', scaffold.writeFlags);

  /* Background: tray, notifications, global shortcut */
  h('app:prefs', () => ({ ...prefs, packaged: app.isPackaged }));
  h('app:setPrefs', p => {
    if (p && typeof p.keepRunning === 'boolean') prefs.keepRunning = p.keepRunning;
    if (p && typeof p.autoStart === 'boolean') prefs.autoStart = p.autoStart;
    if (p && ['system', 'light', 'dark'].includes(p.theme)) { prefs.theme = p.theme; applyNativeTheme(); }
    savePrefs(); applyAutoStart();
    return { ...prefs, packaged: app.isPackaged };
  });
  h('app:status', s => setTrayStatus(s || {}));
  h('app:notify', n => {
    if (!n || !Notification.isSupported()) return false;
    const note = new Notification({ title: String(n.title || 'ProdKeeper').slice(0, 80), body: String(n.body || '').slice(0, 240) });
    note.on('click', () => showWin(n.nav));
    note.show();
    return true;
  });

  // the popup talks only to main: snapshots come from the main window, actions come from the popup window
  const fromWin = e => win && !win.isDestroyed() && e.sender === win.webContents;
  const fromPopup = e => popupWin && !popupWin.isDestroyed() && e.sender === popupWin.webContents;
  ipcMain.handle('popup:update', (e, snap) => {
    if (!fromWin(e) || !snap || typeof snap !== 'object') return false;
    const theme = snap.locked ? popupTheme() : (snap.theme === 'light' ? 'light' : 'dark');
    popupSnap = snap.locked ? { locked: true, theme } : {
      locked: false, theme,
      items: (Array.isArray(snap.items) ? snap.items : []).slice(0, 200).map(t => ({
        id: String(t.id), pid: String(t.pid), key: String(t.key).slice(0, 16), app: String(t.app).slice(0, 60), title: String(t.title).slice(0, 300),
        status: t.status === 'doing' ? 'doing' : 'todo', priority: [0, 1, 2].includes(t.priority) ? t.priority : 1, estimate: Number(t.estimate) || 0,
      })),
    };
    if (popupWin && !popupWin.isDestroyed() && popupWin.isVisible()) popupWin.webContents.send('popup:data', popupSnap);
    return true;
  });
  ipcMain.handle('popup:ready', e => (fromPopup(e) ? { ...popupSnap, theme: popupSnap.locked ? popupTheme() : popupSnap.theme } : null));
  ipcMain.handle('popup:toggle', e => { if (fromWin(e)) togglePopup(); });
  ipcMain.on('popup:act', (e, a) => {
    if (!fromPopup(e) || !a) return;
    if (a.type === 'close') popupWin.hide();
    else if (a.type === 'done' && typeof a.id === 'string') win.webContents.send('popup:action', { type: 'done', id: a.id });
    else if (a.type === 'open') { showWin(typeof a.pid === 'string' && a.pid ? { pid: a.pid, tab: 'tasks' } : undefined); }
  });

  // after sleep, hibernation or unlocking the PC the display may have been reset underneath the window
  for (const ev of ['resume', 'unlock-screen']) powerMonitor.on(ev, () => setTimeout(() => checkPage(true), 3000));

  createWindow();
  createTray();
  try { globalShortcut.register('CommandOrControl+Alt+W', toggleWin); } catch { /* shortcut is taken by another app */ }
  try { globalShortcut.register('CommandOrControl+Alt+T', togglePopup); } catch { /* shortcut is taken by another app */ }
});

app.on('window-all-closed', () => { if (!prefs.keepRunning || quitting) app.quit(); });
