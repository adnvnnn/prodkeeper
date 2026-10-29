'use strict';

/* ======================= Art for the pet =======================
 * The one pet is a little watchman robot with the app's shield on its chest, drawn as pixel art on a 48 x 48 grid (2 px per pixel at
 * its size in the app, so the pixels are fine but still visible). The robot is described as shapes in 100 x 100 units (rounded
 * rectangles, lines, circles); every pixel whose centre falls inside a shape takes that shape's color, and a 1 px outline is added
 * around the result. That keeps the face and limbs easy to change per pose.
 * The colors are CSS variables with a (dark theme) fallback, so the pet is white on the dark theme and black on the light one
 * (see the --pet-* variables in pet.css) without being redrawn. Standalone (the icon script) the fallbacks are used.
 * The antenna LED is the only accent color: it blinks red while the app has critical alerts.
 * The same art draws the in-app pet, its particles, and (through scripts/make-icons.js) the app and tray icons. */
(function (root) {
  const N = 48, U = 100 / N;
  const COL = { F: 'var(--pet-f,#ececef)', S: 'var(--pet-s,#b2b5be)', K: 'var(--pet-k,#16171b)', E: 'var(--pet-e,#ffffff)', R: 'var(--danger,#f0525f)', Q: 'var(--pet-q,#585a64)' };

  /* shape tests: is the point (px, py) inside? */
  const sdRound = (px, py, x, y, w, h, r) => {
    const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r), qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const segDist = (px, py, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l)) : 0;
    return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
  };
  const bezier = (a, c, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; });

  /** The robot's shapes for a pose, back to front. o: { eyes: open | closed | happy | x, mouth: smile | flat | sad | open,
   *  led: off | on | red, look: -1 | 0 | 1, step: 0 (standing) | 1 | 2 (walking frames) | 3 (jumping, arms up) } */
  function shapes(o) {
    const { eyes = 'open', mouth = 'smile', led = 'off', look = 0, step = 0 } = o, sh = [], minT = U * 1.15, dx = look * 3; // never thinner than about one pixel
    const rect = (c, x, y, w, h, r = 0) => sh.push([c, (px, py) => sdRound(px, py, x, y + 4, w, h, r) <= 0]);
    const circle = (c, x, y, r) => sh.push([c, (px, py) => Math.hypot(px - x, py - (y + 4)) <= r]);
    const line = (c, pts, t) => {
      const half = Math.max(t, minT) / 2, P = pts.map(p => [p[0], p[1] + 4]);
      sh.push([c, (px, py) => { for (let i = 0; i < P.length - 1; i++) if (segDist(px, py, P[i], P[i + 1]) <= half) return true; return false; }]);
    };
    line('S', [[50, 14], [50, 25]], 4.5); circle(led === 'red' ? 'R' : led === 'on' ? 'E' : 'S', 50, 11, Math.max(4.8, U * 0.9));
    rect('S', 14, 38, 9, 16, 4); rect('S', 77, 38, 9, 16, 4);
    rect('F', 20, 24, 60, 42, 14); rect('K', 27, 31, 46, 29, 9);
    // the face screen is y 31..60 (before the +4 shift); eyes sit in its upper part and the mouth below them, 3+ units clear of the edge
    const eye = x => eyes === 'open' ? rect('E', x + dx - 4.5, 37, 9, 10, 4.5) : eyes === 'closed' ? rect('E', x - 4.5, 41.5, 9, 3, 1.5)
      : eyes === 'happy' ? line('E', bezier([x - 4.5, 46], [x, 35], [x + 4.5, 46]), 3)
      : (line('E', [[x - 3.5, 38], [x + 3.5, 46]], 2.8), line('E', [[x + 3.5, 38], [x - 3.5, 46]], 2.8));
    eye(39.5); eye(60.5);
    if (mouth === 'smile') line('E', bezier([43, 51], [50, 59], [57, 51]), 3);
    else if (mouth === 'sad') line('E', bezier([43, 55.5], [50, 47.5], [57, 55.5]), 3);
    else if (mouth === 'open') rect('E', 45, 50, 10, 6, 3);
    else line('E', [[43, 53], [57, 53]], 3);
    rect('S', 43, 66, 14, 6); rect('F', 26, 72, 48, 20, 9); rect('K', 34, 76, 32, 12, 4);
    line('E', [[44, 78], [56, 78], [56, 83], [50, 87], [44, 83], [44, 78]], 2.2);
    const [la, ra, lf, rf] = [[0, 0, 0, 0], [30, 0, 0, -4], [0, 30, -4, 0], [115, 115, -2, -2]][step] || [0, 0, 0, 0];
    const arm = (x, a, dir) => [[x, 74], [x + dir * Math.sin(a * Math.PI / 180) * 15, 74 + Math.cos(a * Math.PI / 180) * 15]]; // swings out, up when a > 90
    line('F', arm(17.5, la, -1), 11); line('F', arm(82.5, ra, 1), 11);
    rect('S', 32, 90 + lf, 14, 6, 3); rect('S', 54, 90 + rf, 14, 6, 3);
    return sh;
  }

  /** Pose -> grid of color keys (null = empty), with the 1 px outline */
  function grid(o) {
    const sh = shapes(o), g = Array.from({ length: N }, () => Array(N).fill(null));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const px = (i + 0.5) * U, py = (j + 0.5) * U;
      for (const [c, test] of sh) if (test(px, py)) g[j][i] = c;
    }
    const out = g.map(r => r.slice());
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (!g[j][i] && ((j > 0 && g[j - 1][i]) || (j < N - 1 && g[j + 1][i]) || (i > 0 && g[j][i - 1]) || (i < N - 1 && g[j][i + 1]))) out[j][i] = 'Q';
    }
    return out;
  }

  /** Grid -> SVG paths: one path per color, runs of pixels merged. `crop` = [x, y, w, h] in pixels. */
  function paths(g, colors, crop) {
    const [cx, cy, cw, ch] = crop || [0, 0, g[0].length, g.length], by = {};
    for (let y = cy; y < cy + ch; y++) {
      for (let x = cx; x < cx + cw;) {
        const c = g[y] && g[y][x];
        if (!c) { x++; continue; }
        let e = x;
        while (e + 1 < cx + cw && g[y][e + 1] === c) e++;
        (by[c] = by[c] || []).push(`M${x - cx} ${y - cy}h${e - x + 1}v1h-${e - x + 1}z`);
        x = e + 1;
      }
    }
    return Object.entries(by).map(([c, d]) => `<path style="fill:${colors[c] || c}" d="${d.join('')}"/>`).join('');
  }
  // the inline style wins over the app's global svg rules (16 px size, currentColor stroke)
  const wrap = (w, h, body, size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="${size ? `width:${size[0]}px;height:${size[1]}px;` : ''}display:block;stroke:none" shape-rendering="crispEdges" fill="none">${body}</svg>`;

  const cache = new Map();
  /** The pet as an SVG string, 96 px tall in the app (the feet touch the bottom edge) */
  function pet(o = {}) {
    const key = JSON.stringify(o);
    let s = cache.get(key);
    if (!s) {
      s = wrap(N, N, paths(grid(o), COL));
      if (cache.size > 300) cache.clear();
      cache.set(key, s);
    }
    return s;
  }

  /* small pixel icons for the particles: rows of characters, one color letter per pixel; the colors follow the theme text colors */
  const ICON_COLORS = { y: 'var(--text,#ededef)', b: 'var(--muted,#8e9099)', R: 'var(--danger,#f0525f)' };
  const ICONS = {
    heart: ['.yy.yy.', 'yyyyyyy', 'yyyyyyy', '.yyyyy.', '..yyy..', '...y...'],
    spark: ['..y..', '..y..', 'yyyyy', '..y..', '..y..'],
    zzz: ['yyyyy', '...y.', '..y..', '.y...', 'yyyyy'],
    bang: ['.R.', '.R.', '.R.', '.R.', '...', '.R.'],
    drop: ['.b.', '.b.', 'bbb', 'bbb', '.b.'],
    note: ['..yyy', '..y.y', '..y..', 'yyy..', 'yyy..'],
    star: ['..y..', '.yyy.', 'yyyyy', '.yyy.', '.y.y.'],
  };
  function icon(name, size = 3) {
    const rows = ICONS[name];
    if (!rows) return '';
    const w = Math.max(...rows.map(r => r.length)), g = rows.map(r => Array.from({ length: w }, (_, i) => (r[i] && r[i] !== '.' ? r[i] : null)));
    return wrap(w, rows.length, paths(g, ICON_COLORS), [w * size, rows.length * size]);
  }

  /** The app / tray logo: the robot's head and shoulders (pixel art) on a dark rounded tile. `dot` adds a status dot (tray). */
  function logo(o = {}) {
    const T = 42, dot = o.dot ? `<circle cx="34" cy="34" r="7" fill="#0a0a0b"/><circle cx="34" cy="34" r="5" fill="${o.dot}"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${T} ${T}" width="100%" height="100%" style="stroke:none" shape-rendering="crispEdges">` +
      `<defs><clipPath id="t"><rect x=".5" y=".5" width="${T - 1}" height="${T - 1}" rx="9"/></clipPath></defs>` +
      `<rect x=".5" y=".5" width="${T - 1}" height="${T - 1}" rx="9" fill="#0a0a0b"/>` +
      `<g clip-path="url(#t)"><g transform="translate(2 2)">${paths(grid({ led: 'red' }), COL, [5, 4, 38, 38])}</g></g>` +
      `<rect x=".5" y=".5" width="${T - 1}" height="${T - 1}" rx="9" fill="none" stroke="#2b2b31"/>${dot}</svg>`;
  }

  const api = { pet, icon, logo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PetArt = api;
})(typeof window !== 'undefined' ? window : globalThis);
