'use strict';
// Building the exe: invalid proxy environment variables (e.g. without http://) cause an "Invalid URL" error in electron-builder;
// only the invalid ones are set aside for this run.
const { spawnSync } = require('child_process');

for (const k of Object.keys(process.env)) {
  if (!/^(https?|all)_proxy$/i.test(k) || !process.env[k]) continue;
  let valid = true;
  try { new URL(process.env[k]); } catch { valid = false; }
  if (!valid) {
    console.log(`  • variable ${k} is invalid and was ignored for this build`);
    delete process.env[k];
  }
}
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

const r = spawnSync('npx', ['electron-builder', '--win', 'portable'], { stdio: 'inherit', shell: true, env: process.env });
process.exit(r.status === null ? 1 : r.status);
