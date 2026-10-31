'use strict';
// Renders the app logo to assets/: icon.png, icon.ico and tray-{ok,warn,bad}.png.
// Run with:  npx electron scripts/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets');
const INK = '#0a0a0b', LINE = '#2b2b31', FG = '#ededef';

/** Dark tile with three stacked chevrons: the live release on top, older ones fading below. `dot` adds a status dot (tray). */
const logo = dot => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">
  <rect x=".5" y=".5" width="63" height="63" rx="14" fill="${INK}" stroke="${LINE}"/>
  <g fill="none" stroke="${FG}" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 26 L32 13 L49 26"/><path d="M15 38 L32 25 L49 38" opacity=".5"/><path d="M15 50 L32 37 L49 50" opacity=".28"/>
  </g>
  ${dot ? `<circle cx="49" cy="49" r="12" fill="${INK}"/><circle cx="49" cy="49" r="8.5" fill="${dot}"/>` : ''}
</svg>`;

/* Rasterises the SVG vector directly at size x size on a canvas (a window cannot be made smaller than ~32px and would distort the small sizes) */
async function render(win, svg, size) {
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg.replace('width="100%" height="100%"', `width="${size}" height="${size}"`)).toString('base64');
  const url = await win.webContents.executeJavaScript(`new Promise((ok, no) => {
    const img = new Image(); img.onerror = () => no(new Error('svg failed'));
    img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = ${size}; c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size}); ok(c.toDataURL('image/png')); };
    img.src = ${JSON.stringify(src)};
  })`);
  return Buffer.from(url.split(',')[1], 'base64');
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
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<body></body>');
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
