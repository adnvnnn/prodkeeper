const { contextBridge, ipcRenderer } = require('electron');

// The popup only receives a task snapshot pushed by the main window and can ask for a few actions; it never touches the data file
contextBridge.exposeInMainWorld('popup', {
  ready: () => ipcRenderer.invoke('popup:ready'),
  onData: cb => ipcRenderer.on('popup:data', (_e, d) => cb(d)),
  act: a => ipcRenderer.send('popup:act', a),
});
