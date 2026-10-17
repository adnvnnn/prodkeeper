const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const gitlib = require('./lib/git');
const secure = require('./lib/secure');
const vault = require('./lib/vault');
const jobs = require('./lib/jobs');
const net = require('./lib/net');

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('dev.appwarden.app');

let win;

// نام برنامه عوض شد؛ اگر داده‌های رمزنگاری‌شدهٔ نسخهٔ قبلی در پوشهٔ قدیمی هست، یک‌بار به پوشهٔ جدید کپی می‌شود (پوشهٔ قدیمی دست‌نخورده می‌ماند)
function migrateOldUserData() {
  try {
    const oldDir = path.join(app.getPath('appData'), 'کنترل پروژه'), newDir = app.getPath('userData');
    if (oldDir === newDir || fs.existsSync(path.join(newDir, 'security.json')) || !fs.existsSync(path.join(oldDir, 'security.json'))) return;
    fs.mkdirSync(newDir, { recursive: true });
    for (const f of ['security.json', 'data.enc', 'vault.enc', 'data.json', 'vault.json']) {
      if (fs.existsSync(path.join(oldDir, f))) fs.copyFileSync(path.join(oldDir, f), path.join(newDir, f));
    }
    if (fs.existsSync(path.join(oldDir, 'backups'))) fs.cpSync(path.join(oldDir, 'backups'), path.join(newDir, 'backups'), { recursive: true });
  } catch { /* اگر نشد، برنامه به‌عنوان نصب تازه شروع می‌کند و پوشهٔ قدیمی سالم می‌ماند */ }
}
migrateOldUserData();


function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 840, minWidth: 1000, minHeight: 620,
    title: 'AppWarden — نگهبان برنامه', backgroundColor: '#f4f5f9',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });
  }
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('web-contents-created', (_e, wc) => wc.on('will-attach-webview', e => e.preventDefault()));
app.on('before-quit', () => { vault.clearClipboard(); secure.lock(); });

app.whenReady().then(() => {
  // فقط اعلان مجاز است؛ بقیهٔ مجوزها (دوربین، مکان و ...) رد می‌شود
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications'));

  const h = (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a));

  /* رمز اصلی و ذخیره‌سازی رمزنگاری‌شده */
  h('sec:status', secure.status);
  h('sec:setup', secure.setup);
  h('sec:unlock', secure.unlock);
  h('sec:lock', () => { vault.clearClipboard(); return secure.lock(); });
  h('sec:change', secure.changePassword);
  h('sec:reset', secure.reset);
  h('sec:export', async () => {
    const bundle = secure.exportBundle();
    if (!bundle) return { error: 'برنامه قفل است' };
    const day = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'ذخیرهٔ پشتیبان رمزنگاری‌شده', defaultPath: `appwarden-backup-${day}.awbak`, filters: [{ name: 'AppWarden Backup', extensions: ['awbak'] }] });
    if (canceled || !filePath) return { canceled: true };
    fs.writeFileSync(filePath, JSON.stringify(bundle), 'utf8');
    return { ok: true };
  });
  h('sec:import', async pw => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'بازیابی از پشتیبان رمزنگاری‌شده', filters: [{ name: 'AppWarden Backup', extensions: ['awbak', 'pcbak'] }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return { canceled: true };
    let b;
    try { b = JSON.parse(fs.readFileSync(filePaths[0], 'utf8')); } catch { return { error: 'فایل پشتیبان معتبر نیست' }; }
    return secure.importBundle(b, pw);
  });

  h('data:load', secure.loadData);
  h('data:save', secure.saveData);
  ipcMain.on('data:saveSync', (e, obj) => { e.returnValue = secure.saveData(obj); });
  h('data:path', () => app.getPath('userData'));

  h('shell:openFolder', async p => {
    if (typeof p !== 'string' || !p) return 'مسیر خالی است';
    if (!fs.existsSync(p)) return 'این پوشه پیدا نشد';
    return shell.openPath(p);
  });
  h('shell:pickFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'انتخاب پوشه', properties: ['openDirectory', 'createDirectory'] });
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

  createWindow();
});

app.on('window-all-closed', () => app.quit());
