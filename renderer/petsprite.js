'use strict';

/* ======================= Pixel art for the pet =======================
 * The one pet (a cat that keeps watch over your apps, with the app's shield on its chest) is built on a 16 x 19 pixel grid:
 * shapes are filled in, a 1 px outline is added around everything, and the grid is written out as one SVG path per color.
 * The colors are CSS variables with a (dark theme) fallback, so the pet is white on the dark theme and black on the light one
 * (see the --pet-* variables in pet.css) without being redrawn. Standalone (the icon script) the fallbacks are used.
 * The same code draws the in-app pet, its particles, and (through scripts/make-icons.js) the app and tray icons. */
(function (root) {
  const W = 16, H = 19;
  const v = (name, fallback) => `var(--pet-${name},${fallback})`;
  const C = {
    o: v('o', '#e6e7ea'), d: v('d', '#a3a6af'), l: v('l', '#ffffff'), p: v('p', '#8e9099'), k: v('k', '#0a0a0b'),
    w: v('w', '#2b2b31'), e: v('e', '#e6e7ea'), b: v('b', '#c9cbd1'), lens: v('lens', '#8e9099'),
  };

  const grid = () => Array.from({ length: H }, () => Array(W).fill(null));
  const put = (g, x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = C[c] || c; };
  const run = (g, c, y, x1, x2 = x1) => { for (let x = x1; x <= x2; x++) put(g, x, y, c); };
  const dots = (g, c, pts) => pts.forEach(([x, y]) => put(g, x, y, c));

  /**
   * The pet. o: { eyes: open | closed | happy | x, mouth: smile | flat | sad | open, step: 0 | 1 | 2 (walking frame),
   *               tail: 0 | 1, look: -1 | 0 | 1, glasses } -> grid of colors (null = transparent)
   */
  function cat(o = {}) {
    const { eyes = 'open', mouth = 'smile', step = 0, tail = 0, glasses = false } = o, look = glasses ? 0 : o.look || 0;
    const g = grid();
    /* tail first, so the body covers its root */
    dots(g, 'o', tail ? [[12, 18], [13, 18], [13, 17], [14, 16]] : [[12, 18], [13, 18], [13, 17], [13, 16]]);
    dots(g, 'd', tail ? [[14, 15]] : [[13, 15]]);
    /* body, belly and the shield badge */
    for (let y = 15; y <= 17; y++) { run(g, 'o', y, 4, 11); run(g, 'l', y, 5, 10); }
    run(g, 'w', 15, 6, 9); dots(g, 'w', [[6, 16], [9, 16], [7, 17], [8, 17]]); dots(g, 'e', [[7, 16], [8, 16]]);
    /* paws */
    const paws = [[[4, 5], [10, 11]], [[3, 4], [9, 10]], [[5, 6], [11, 12]]][step] || [[4, 5], [10, 11]];
    paws.forEach(([a, b]) => run(g, 'l', 18, a, b));
    /* ears and head */
    dots(g, 'o', [[3, 4], [3, 5], [4, 5], [3, 6], [4, 6], [5, 6], [12, 4], [12, 5], [11, 5], [12, 6], [11, 6], [10, 6]]);
    dots(g, 'p', [[4, 5], [4, 6], [11, 5], [11, 6]]);
    for (let y = 7; y <= 14; y++) run(g, 'o', y, y === 7 || y === 14 ? 3 : 2, y === 7 || y === 14 ? 12 : 13);
    dots(g, 'd', [[7, 7], [8, 7], [6, 8], [9, 8]]);
    dots(g, 'b', [[3, 11], [12, 11]]);
    /* eyes */
    for (const c of [5 + look, 10 + look]) {
      if (eyes === 'open') dots(g, 'k', [[c, 9], [c, 10]]);
      else if (eyes === 'closed') dots(g, 'k', [[c - 1, 10], [c, 10], [c + 1, 10]]);
      else if (eyes === 'happy') dots(g, 'k', [[c - 1, 10], [c, 9], [c + 1, 10]]);
      else dots(g, 'k', [[c - 1, 9], [c + 1, 9], [c, 10], [c - 1, 11], [c + 1, 11]]);
    }
    if (glasses) {
      for (const c of [5, 10]) { run(g, 'lens', 8, c - 1, c + 1); run(g, 'lens', 11, c - 1, c + 1); dots(g, 'lens', [[c - 1, 9], [c - 1, 10], [c + 1, 9], [c + 1, 10]]); }
      run(g, 'lens', 9, 7, 8);
    }
    /* nose and mouth */
    run(g, 'p', 11, 7, 8);
    const m = { smile: [[6, 12], [7, 13], [8, 13], [9, 12]], flat: [[7, 12], [8, 12]], sad: [[6, 13], [7, 12], [8, 12], [9, 13]], open: [[7, 12], [8, 12], [7, 13]] }[mouth] || [];
    dots(g, 'k', m);
    if (mouth === 'open') put(g, 8, 13, 'p');
    return outline(g);
  }

  /** 1 px outline around everything that is drawn (inside the grid) */
  function outline(g) {
    const out = g.map(r => r.slice());
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (g[y][x]) continue;
      if ((y > 0 && g[y - 1][x]) || (y < H - 1 && g[y + 1][x]) || (x > 0 && g[y][x - 1]) || (x < W - 1 && g[y][x + 1])) out[y][x] = C.k;
    }
    return out;
  }

  /** Grid -> SVG string: one path per color, runs of pixels merged. `crop` = [x, y, w, h] in pixels. */
  function svg(g, scale, crop) {
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
    // the inline style wins over the app's global svg rules (16 px size, currentColor stroke)
    const size = scale ? `width:${cw * scale}px;height:${ch * scale}px;` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cw} ${ch}" style="${size}display:block;stroke:none" shape-rendering="crispEdges" fill="none">` +
      Object.entries(by).map(([c, d]) => `<path style="fill:${c}" d="${d.join('')}"/>`).join('') + '</svg>';
  }

  /* small pixel icons for particles and labels: rows of characters, one color letter per pixel; the colors follow the theme text colors */
  const ICON_COLORS = { y: 'var(--text,#ededef)', r: 'var(--text,#ededef)', w: 'var(--muted,#8e9099)', b: 'var(--muted,#8e9099)', R: 'var(--danger,#f0525f)' };
  const ICONS = {
    heart: ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'],
    spark: ['..y..', '..y..', 'yyyyy', '..y..', '..y..'],
    zzz: ['yyyyy', '...y.', '..y..', '.y...', 'yyyyy'],
    bang: ['.R.', '.R.', '.R.', '.R.', '...', '.R.'],
    drop: ['.b.', '.b.', 'bbb', 'bbb', '.b.'],
    note: ['..yyy', '..y.y', '..y..', 'yyy..', 'yyy..'],
    crumb: ['yy', 'yy'],
    star: ['..y..', '.yyy.', 'yyyyy', '.yyy.', '.y.y.'],
    fish: ['...bbb..', '.bbbbbb.', 'bbwbbbbb', '.bbbbbbb', '...bbb..'],
    ball: ['..rrr..', '.rwrrrr', 'rwrrrrr', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..'],
  };
  function icon(name, scale = 3) {
    const rows = ICONS[name];
    if (!rows) return '';
    const w = Math.max(...rows.map(r => r.length)), g = rows.map(r => Array.from({ length: w }, (_, i) => ICON_COLORS[r[i]] || null));
    return svg(g, scale);
  }

  /** The app / tray logo: the pet's face on a dark 16 x 16 pixel tile (so power-of-two icon sizes stay pixel-perfect).
   *  `dot` adds a status dot (tray). */
  function logo(o = {}) {
    const inner = svg(cat({}), 0, [0, 3, 16, 12]).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const dot = o.dot ? `<circle cx="13" cy="13" r="3.4" fill="#0a0a0b"/><circle cx="13" cy="13" r="2.4" fill="${o.dot}"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="100%" height="100%" style="stroke:none" shape-rendering="crispEdges">` +
      `<rect x=".25" y=".25" width="15.5" height="15.5" rx="3" fill="#0a0a0b" stroke="#2b2b31" stroke-width=".5"/><g transform="translate(0 2)">${inner}</g>${dot}</svg>`;
  }

  const api = { W, H, cat, svg, icon, logo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PetSprite = api;
})(typeof window !== 'undefined' ? window : globalThis);
