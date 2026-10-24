const { contextBridge, ipcRenderer } = require('electron');

const inv = ch => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  sec: {
    status: inv('sec:status'), setup: inv('sec:setup'), unlock: inv('sec:unlock'), lock: inv('sec:lock'),
    change: inv('sec:change'), reset: inv('sec:reset'), export: inv('sec:export'), import: inv('sec:import'),
  },
  data: {
    load: inv('data:load'), save: inv('data:save'),
    saveSync: d => ipcRenderer.sendSync('data:saveSync', d),
    path: inv('data:path'),
  },
  shell: { openFolder: inv('shell:openFolder'), pickFolder: inv('shell:pickFolder'), openUrl: inv('shell:openUrl') },
  git: inv('git'),
  vault: {
    status: inv('vault:status'), list: inv('vault:list'), save: inv('vault:save'), remove: inv('vault:remove'),
    removeByProject: inv('vault:removeByProject'), reveal: inv('vault:reveal'), copy: inv('vault:copy'),
  },
  job: {
    run: inv('job:run'), kill: inv('job:kill'), backups: inv('job:backups'),
    onOutput: cb => ipcRenderer.on('job:output', (_e, m) => cb(m)),
  },
  net: { check: inv('net:check') },
  app: {
    prefs: inv('app:prefs'), setPrefs: inv('app:setPrefs'), status: inv('app:status'), notify: inv('app:notify'),
    onNavigate: cb => ipcRenderer.on('app:navigate', (_e, n) => cb(n)),
  },
  ci: { runs: inv('ci:runs'), workflows: inv('ci:workflows'), action: inv('ci:action') },
});
