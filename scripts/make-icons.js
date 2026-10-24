'use strict';
// Renders the app logo to assets/: icon.png, icon.ico and tray-{ok,warn,bad}.png.
// Run with:  npx electron scripts/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets');
const INK = '#0a0a0b', LINE = '#2b2b31', FG = '#ededef';

/** Dark tile with a solid shield; an upward chevron is cut out of it. `dot` adds a status dot (tray). */
const logo = dot => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">
  <defs><mask id="m"><rect width="64" height="64" fill="#fff"/><polyline points="22,36 32,26 42,36" fill="none" stroke="#000" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></mask></defs>
  <rect x=".5" y=".5" width="63" height="63" rx="14" fill="${INK}" stroke="${LINE}"/>
  <path mask="url(#m)" fill="${FG}" d="M32 9 L52 16.5 V31 C52 44 43.5 53 32 57.5 C20.5 53 12 44 12 31 V16.5 Z"/>
  ${dot ? `<circle cx="49" cy="49" r="12" fill="${INK}"/><circle cx="49" cy="49" r="8.5" fill="${dot}"/>` : ''}
</svg>`;

async function render(win, svg, size) {
  win.setContentSize(size, size);
  await win.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:transparent;overflow:hidden">${svg}</body>`));
  await new Promise(r => setTimeout(r, 250));
  return (await win.webContents.capturePage()).toPNG();
}

function ico(images) { // PNG-compressed ICO
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const o = 6 + i * 16;
    head[o] = size >= 256 ? 0 : size; head[o + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(png.length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map(i => i.png)]);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: false } });
  const base = logo('');
  fs.writeFileSync(path.join(OUT, 'icon.png'), await render(win, base, 512));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) images.push({ size, png: await render(win, base, size) });
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(images));
  for (const [name, dot] of [['ok', ''], ['warn', '#e8a23a'], ['bad', '#f0525f']]) {
    fs.writeFileSync(path.join(OUT, `tray-${name}.png`), await render(win, logo(dot), 32));
  }
  console.log('icons written to', OUT);
  app.quit();
});
