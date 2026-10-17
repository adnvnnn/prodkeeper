'use strict';
// ساخت exe: متغیرهای پروکسی نامعتبر محیط (مثلاً بدون http://) باعث خطای "Invalid URL" در electron-builder می‌شوند؛
// فقط همان‌هایی که معتبر نیستند برای این اجرا کنار گذاشته می‌شوند.
const { spawnSync } = require('child_process');

for (const k of Object.keys(process.env)) {
  if (!/^(https?|all)_proxy$/i.test(k) || !process.env[k]) continue;
  let valid = true;
  try { new URL(process.env[k]); } catch { valid = false; }
  if (!valid) {
    console.log(`  • متغیر ${k} نامعتبر است و برای این ساخت نادیده گرفته شد`);
    delete process.env[k];
  }
}
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

const r = spawnSync('npx', ['electron-builder', '--win', 'portable'], { stdio: 'inherit', shell: true, env: process.env });
process.exit(r.status === null ? 1 : r.status);
