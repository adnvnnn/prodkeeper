const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, Tray, Notification, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const gitlib = require('./lib/git');
const secure = require('./lib/secure');
const vault = require('./lib/vault');
const jobs = require('./lib/jobs');
const net = require('./lib/net');

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('dev.appwarden.app');

let win, tray, quitting = false;
const startHidden = process.argv.includes('--hidden');

/* Non-secret background preferences (needed in main; the encrypted data is not available before the master password is entered) */
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const PREF_DEFAULTS = { keepRunning: true, autoStart: false };
let prefs = { ...PREF_DEFAULTS };
function loadPrefs() { try { prefs = { ...PREF_DEFAULTS, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch { /* first run */ } }
function savePrefs() { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs), 'utf8'); } catch { /* read-only */ } }
function applyAutoStart() {
  if (!app.isPackaged) return; // in development we do not register electron.exe as a startup item
  app.setLoginItemSettings({ openAtLogin: !!prefs.autoStart, args: ['--hidden'] });
}

// The app was renamed; if the previous version's encrypted data exists in the old folder, copy it once to the new folder (the old folder is left untouched)
function migrateOldUserData() {
  try {
    const oldDir = path.join(app.getPath('appData'), 'کنترل پروژه'), newDir = app.getPath('userData');
    if (oldDir === newDir || fs.existsSync(path.join(newDir, 'security.json')) || !fs.existsSync(path.join(oldDir, 'security.json'))) return;
    fs.mkdirSync(newDir, { recursive: true });
    for (const f of ['security.json', 'data.enc', 'vault.enc', 'data.json', 'vault.json']) {
      if (fs.existsSync(path.join(oldDir, f))) fs.copyFileSync(path.join(oldDir, f), path.join(newDir, f));
    }
    if (fs.existsSync(path.join(oldDir, 'backups'))) fs.cpSync(path.join(oldDir, 'backups'), path.join(newDir, 'backups'), { recursive: true });
  } catch { /* on failure the app starts as a fresh install and the old folder stays intact */ }
}
migrateOldUserData();


function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 840, minWidth: 1000, minHeight: 620,
    title: 'AppWarden', backgroundColor: '#0a0a0b', show: !startHidden,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  // a hidden renderer must still run the monitoring timers without throttling
  win.webContents.setBackgroundThrottling(false);
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

function showWin(nav) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (nav) win.webContents.send('app:navigate', nav);
}
function toggleWin() { if (win && win.isVisible() && win.isFocused()) win.hide(); else showWin(); }

/* Tray icon: a colored circle (blue = healthy, yellow = warning, red = critical alert) */
function trayIcon(level) {
  const N = 32, buf = Buffer.alloc(N * N * 4), c = (N - 1) / 2;
  const [r, g, b] = { bad: [220, 53, 69], warn: [240, 173, 20], ok: [64, 99, 235] }[level] || [64, 99, 235];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x - c, y - c), i = (y * N + x) * 4;
    if (d > 15) continue;
    const ring = d > 11.5, w = ring ? [255, 255, 255] : [r, g, b];
    buf[i] = w[2]; buf[i + 1] = w[1]; buf[i + 2] = w[0]; buf[i + 3] = 255; // BGRA
  }
  return nativeImage.createFromBitmap(buf, { width: N, height: N }).resize({ width: 16, height: 16 });
}
function setTrayStatus({ bad = 0, warn = 0 } = {}) {
  if (!tray) return;
  tray.setImage(trayIcon(bad ? 'bad' : warn ? 'warn' : 'ok'));
  tray.setToolTip(bad || warn ? `AppWarden — ${bad} critical, ${warn} warnings` : 'AppWarden — all healthy');
}
function createTray() {
  tray = new Tray(trayIcon('ok'));
  tray.setToolTip('AppWarden');
  tray.on('click', toggleWin);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open AppWarden', click: () => showWin() },
    { label: 'Lock', click: () => showWin({ lock: true }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

app.on('second-instance', () => showWin());
app.on('web-contents-created', (_e, wc) => wc.on('will-attach-webview', e => e.preventDefault()));
app.on('before-quit', () => { quitting = true; vault.clearClipboard(); secure.lock(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  loadPrefs();
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
    const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Save encrypted backup', defaultPath: `appwarden-backup-${day}.awbak`, filters: [{ name: 'AppWarden Backup', extensions: ['awbak'] }] });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, JSON.stringify(bundle), 'utf8');
    return { ok: true };
  });
  h('sec:import', async pw => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Restore from encrypted backup', filters: [{ name: 'AppWarden Backup', extensions: ['awbak', 'pcbak'] }], properties: ['openFile'] });
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

  h('net:check', net.check);
  h('ci:runs', net.ciRuns);
  h('ci:workflows', net.ciWorkflows);
  h('ci:action', net.ciAction);

  /* Background: tray, notifications, global shortcut */
  h('app:prefs', () => ({ ...prefs, packaged: app.isPackaged }));
  h('app:setPrefs', p => {
    if (p && typeof p.keepRunning === 'boolean') prefs.keepRunning = p.keepRunning;
    if (p && typeof p.autoStart === 'boolean') prefs.autoStart = p.autoStart;
    savePrefs(); applyAutoStart();
    return { ...prefs, packaged: app.isPackaged };
  });
  h('app:status', s => setTrayStatus(s || {}));
  h('app:notify', n => {
    if (!n || !Notification.isSupported()) return false;
    const note = new Notification({ title: String(n.title || 'AppWarden').slice(0, 80), body: String(n.body || '').slice(0, 240) });
    note.on('click', () => showWin(n.nav));
    note.show();
    return true;
  });

  createWindow();
  createTray();
  try { globalShortcut.register('CommandOrControl+Alt+W', toggleWin); } catch { /* shortcut is taken by another app */ }
});

app.on('window-all-closed', () => { if (!prefs.keepRunning || quitting) app.quit(); });
