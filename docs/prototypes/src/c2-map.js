/* ================= Map engine (vector, drawn on canvas) ================= */
const MAP = (() => {
  const RMQ = matchMedia('(prefers-reduced-motion: reduce)');
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const R = rng(20261112);
  function smooth(c, step) {
    const out = [], p = [c[0], ...c, c[c.length - 1]];
    for (let i = 1; i < p.length - 2; i++) {
      const a = p[i - 1], b = p[i], d = p[i + 1], e = p[i + 2];
      const n = Math.max(2, Math.ceil(Math.hypot(d[0] - b[0], d[1] - b[1]) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        out.push([.5 * (2 * b[0] + (-a[0] + d[0]) * t + (2 * a[0] - 5 * b[0] + 4 * d[0] - e[0]) * t2 + (-a[0] + 3 * b[0] - 3 * d[0] + e[0]) * t3),
                  .5 * (2 * b[1] + (-a[1] + d[1]) * t + (2 * a[1] - 5 * b[1] + 4 * d[1] - e[1]) * t2 + (-a[1] + 3 * b[1] - 3 * d[1] + e[1]) * t3)]);
      }
    }
    out.push(c[c.length - 1]); return out;
  }
  const shore = x => 250 + 26 * Math.sin(x / 210) + 12 * Math.sin(x / 77 + 1.3);
  const EXP = smooth([[-400,1545],[300,1522],[900,1492],[1500,1452],[2100,1424],[2800,1412]], 14);
  const ADM = smooth([[1262,1470],[1236,1250],[1182,1040],[1170,860],[1228,660],[1346,486],[1500,352]], 12);
  const FREE = smooth([[230,1012],[700,978],[1176,950],[1650,930],[2400,904]], 14);
  const FOLA = smooth([[760,1508],[776,1262],[760,1032],[790,802],[850,562],[900,392]], 12);
  const yOn = (pts, x) => { for (let i = 1; i < pts.length; i++) if (pts[i][0] >= x) { const a = pts[i - 1], b = pts[i], k = (x - a[0]) / ((b[0] - a[0]) || 1); return a[1] + (b[1] - a[1]) * k; } return pts[pts.length - 1][1]; };
  const expY = x => yOn(EXP, x);
  const idxNearY = (pts, y) => { let bi = 0, bd = 1e9; pts.forEach((p, i) => { const d = Math.abs(p[1] - y); if (d < bd) { bd = d; bi = i; } }); return bi; };

  /* spatial grid of road points */
  const G = new Map(), CS = 40;
  const gk = (x, y) => Math.floor(x / CS) + ',' + Math.floor(y / CS);
  function gadd(pts, h) { for (const [x, y] of pts) { const k = gk(x, y); let a = G.get(k); if (!a) G.set(k, a = []); a.push(x, y, h); } }
  function near(x, y, r) {
    const cx = Math.floor(x / CS), cy = Math.floor(y / CS), n = Math.ceil((r + 16) / CS);
    for (let i = cx - n; i <= cx + n; i++) for (let j = cy - n; j <= cy + n; j++) {
      const a = G.get(i + ',' + j); if (!a) continue;
      for (let q = 0; q < a.length; q += 3) { const dx = a[q] - x, dy = a[q + 1] - y, l = r + a[q + 2]; if (dx * dx + dy * dy < l * l) return true; }
    }
    return false;
  }

  /* roads */
  const roads = [
    { pts:EXP, cls:'motor', name:'Lekki–Epe Expressway', at:[.16, .74] },
    { pts:ADM, cls:'pri', name:'Admiralty Way', at:[.36] },
    { pts:FREE, cls:'sec', name:'Freedom Way', at:[.78] },
    { pts:FOLA, cls:'sec', name:'Fola Osibo Road', at:[.62] }
  ];
  const HALF = { motor:15, pri:10, sec:7.5, res:5 };
  roads.forEach(r => gadd(r.pts, HALF[r.cls]));
  const LOTS = [ // parks and big footprints; no small buildings inside
    { x:410, y:600, w:190, h:120, park:true }, { x:1480, y:1090, w:170, h:150, park:true }, { x:1880, y:560, w:210, h:130, park:true }, { x:300, y:1700, w:160, h:110, park:true },
    { x:470, y:expY(520) - 92, w:110, h:62, mall:'Shoprite' }, { x:1930, y:expY(2000) - 110, w:170, h:84, mall:'Circle Mall' }
  ];
  const inLot = (x, y, m = 0) => LOTS.some(l => x > l.x - m && x < l.x + l.w + m && y > l.y - m && y < l.y + l.h + m);
  function addRes(pts) {
    let cur = [];
    for (let i = 0; i < pts.length; i++) {
      cur.push(pts[i]);
      if (cur.length > 5 && R() < .08) { const s = smooth(cur, 12); roads.push({ pts:s, cls:'res' }); cur = []; i += 1; }
    }
    if (cur.length > 2) roads.push({ pts:smooth(cur, 12), cls:'res' });
  }
  const okN = (x, y) => y > shore(x) + 36 && y < expY(x) - 34 && !near(x, y, 30) && !inLot(x, y, 6);
  const okS = (x, y) => y > expY(x) + 36 && y < 2240 && !near(x, y, 30) && !inLot(x, y, 6);
  function sweepH(y0, k, ok) {
    let seg = [];
    for (let x = -460; x <= 2860; x += 56) { const y = y0 + 15 * Math.sin(x / 250 + k * 1.7) + (R() - .5) * 6; if (ok(x, y)) seg.push([x, y]); else { if (seg.length > 3) addRes(seg); seg = []; } }
    if (seg.length > 3) addRes(seg);
  }
  function sweepV(x0, ya, yb, ok) {
    let seg = [];
    for (let y = ya; y <= yb; y += 56) { const x = x0 + 13 * Math.sin(y / 210 + x0); if (ok(x, y)) seg.push([x, y]); else { if (seg.length > 3) addRes(seg); seg = []; } }
    if (seg.length > 3) addRes(seg);
  }
  for (let k = 0; k < 12; k++) sweepH(380 + k * 96, k, okN);
  for (let x = -300; x < 2860; x += 190 + R() * 70) sweepV(x, 240, 1520, okN);
  for (let k = 0; k < 7; k++) sweepH(1600 + k * 94, k + 3, okS);
  for (let x = -260; x < 2860; x += 210 + R() * 60) sweepV(x, 1480, 2260, okS);
  roads.filter(r => r.cls === 'res').forEach(r => gadd(r.pts, HALF.res));
  const resNames = ['Durosimi Etti Drive', 'T.F. Kuboye Road', 'Babatunde Anjous Avenue', 'Omorinre Johnson Street'];
  roads.filter(r => r.cls === 'res' && r.pts.length > 60).sort((a, b) => {
    const da = Math.hypot(a.pts[a.pts.length >> 1][0] - 1050, a.pts[a.pts.length >> 1][1] - 1050), db = Math.hypot(b.pts[b.pts.length >> 1][0] - 1050, b.pts[b.pts.length >> 1][1] - 1050);
    return da - db;
  }).slice(0, 4).forEach((r, i) => { r.name = resNames[i]; r.at = [.5]; });

  /* buildings */
  const BLD = new Path2D(), BIG = new Path2D(), PARK = new Path2D(), TREES = new Path2D(), WATER = new Path2D();
  for (const r of roads) {
    if (r.cls === 'motor') continue;
    const pts = r.pts, base = r.cls === 'pri' ? 10 : r.cls === 'sec' ? 8 : 5;
    let acc = 0, next = 8 + R() * 16;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      acc += seg; if (acc < next) continue;
      next = acc + 22 + R() * 16;
      const tx = (b[0] - a[0]) / seg, ty = (b[1] - a[1]) / seg, nx = -ty, ny = tx;
      for (const side of [-1, 1]) {
        if (R() < .1) continue;
        const big = r.cls !== 'res' && R() < .5;
        const w = (big ? 20 : 12) + R() * (big ? 22 : 15), d = (big ? 18 : 10) + R() * (big ? 16 : 14), off = base + 5 + d / 2 + R() * 3;
        const cx = b[0] + nx * off * side, cy = b[1] + ny * off * side;
        if (cy < shore(cx) + 20 || inLot(cx, cy, 4) || near(cx, cy, Math.min(w, d) * .5 + 1)) continue;
        const hw = w / 2, hd = d / 2;
        BLD.moveTo(cx + tx * hw + nx * hd, cy + ty * hw + ny * hd); BLD.lineTo(cx - tx * hw + nx * hd, cy - ty * hw + ny * hd);
        BLD.lineTo(cx - tx * hw - nx * hd, cy - ty * hw - ny * hd); BLD.lineTo(cx + tx * hw - nx * hd, cy + ty * hw - ny * hd); BLD.closePath();
      }
    }
  }
  for (const l of LOTS) {
    if (l.park) {
      PARK.roundRect ? PARK.roundRect(l.x, l.y, l.w, l.h, 14) : PARK.rect(l.x, l.y, l.w, l.h);
      for (let k = 0; k < 34; k++) { const x = l.x + 10 + R() * (l.w - 20), y = l.y + 10 + R() * (l.h - 20), r = 4 + R() * 6; TREES.moveTo(x + r, y); TREES.arc(x, y, r, 0, 7); }
    } else BIG.rect(l.x, l.y, l.w, l.h);
  }
  WATER.moveTo(-1200, -1200); for (let x = -1200; x <= 3400; x += 16) WATER.lineTo(x, shore(x)); WATER.lineTo(3400, -1200); WATER.closePath();
  const ROADP = {};
  for (const cls of ['res', 'sec', 'pri', 'motor']) {
    const p = new Path2D();
    roads.filter(r => r.cls === cls).forEach(r => { p.moveTo(r.pts[0][0], r.pts[0][1]); for (let i = 1; i < r.pts.length; i++) p.lineTo(r.pts[i][0], r.pts[i][1]); });
    ROADP[cls] = p;
  }

  /* key places and paths */
  const pX = 520, P = [pX, expY(pX) - 4];
  const dI = idxNearY(ADM, 860), D = [ADM[dI][0] + 2, ADM[dI][1]];
  const jI = EXP.findIndex(p => p[0] >= 1262);
  const ROUTE = [...EXP.filter(p => p[0] >= pX && p[0] <= EXP[jI][0]), ...ADM.slice(0, dI + 1)];
  ROUTE.unshift(P); ROUTE.push(D);
  const fI = idxNearY(FOLA, 1080), HOME_AGENT = FOLA[fI];
  const APPROACH = [...FOLA.slice(0, fI + 1).reverse(), ...EXP.filter(p => p[0] >= pX && p[0] <= 762).reverse(), P];
  const NEAR = [[380,1360],[640,1380],[300,1180],[700,1240],[450,1620],[880,1600]];
  const POIS = [
    { p:P, name:'Shoprite', cat:'shop' }, { p:[ADM[idxNearY(ADM, 1120)][0] + 16, 1120], name:'Medplus Pharmacy', cat:'health' },
    { p:[ADM[idxNearY(ADM, 700)][0] + 16, 700], name:'GIG Logistics', cat:'parcel' }, { p:[2015, expY(2015) - 12], name:'Circle Mall', cat:'shop' }
  ];
  const AREAS = [{ t:'LEKKI PHASE 1', p:[980, 720] }, { t:'IKATE', p:[420, 1860] }, { t:'OSAPA', p:[2140, 1220] }, { t:'Lagos Lagoon', p:[1080, 120], water:true }];

  /* colours and instances */
  const KEYS = ['land','bld','bld-edge','bld-shadow','park','tree','water','water-edge','road','road-edge','primary','primary-edge','motor','motor-edge','label','halo','area','route','route-edge','done'];
  let COL = {};
  const insts = new Set();
  function readCol() {
    const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
    KEYS.forEach(k => COL[k] = g('--m-' + k));
    Object.assign(COL, { ink:g('--ink'), onInk:g('--on-ink'), surface:g('--surface'), brand:g('--brand-2'), blue:g('--blue'), urgent:g('--urgent') });
    insts.forEach(m => m.dirty());
  }
  readCol();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readCol);
  new MutationObserver(readCol).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme', 'class', 'style'] });
  if (document.fonts) document.fonts.ready.then(() => insts.forEach(m => m.dirty()));
  const IMG = {};
  function avatar(key, svg) { if (!IMG[key]) { const im = new Image(); im.onload = () => insts.forEach(m => m.dirty()); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); IMG[key] = im; } return IMG[key]; }
  const POIC = { shop:'#E37400', health:'#D93025', parcel:'#1A73E8' };

  function plen(p) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; }
  function along(p, u) {
    const L = plen(p) * Math.max(0, Math.min(1, u)); let acc = 0;
    for (let i = 1; i < p.length; i++) {
      const s = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (acc + s >= L) { const k = s ? (L - acc) / s : 0; return { pt:[p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k], i, ang:Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]) }; }
      acc += s;
    }
    const n = p.length; return { pt:p[n - 1], i:n - 1, ang:Math.atan2(p[n - 1][1] - p[n - 2][1], p[n - 1][0] - p[n - 2][0]) };
  }

  function create(cv, opt = {}) {
    const ctx = cv.getContext('2d');
    let W = 1, H = 1, dpr = 1, sc = { key:'', focus:[P, D] }, ins = { t:0, r:0, b:0, l:0 };
    const cam = { x:P[0], y:P[1], z:.5 };
    let anim = null, user = false, dirty = true, vis = true, alive = true, t0 = performance.now(), first = true;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    function fit() {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [x, y] of sc.focus) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const pad = sc.pad ?? 70, aw = Math.max(80, W - ins.l - ins.r), ah = Math.max(80, H - ins.t - ins.b);
      const z = clamp(Math.min(aw / (x1 - x0 + 2 * pad), ah / (y1 - y0 + 2 * pad)), .16, sc.maxZ ?? 1.4);
      return { x:(x0 + x1) / 2 - (ins.l + aw / 2 - W / 2) / z, y:(y0 + y1) / 2 - (ins.t + ah / 2 - H / 2) / z, z };
    }
    function fly(to, ms) { if (!ms || RMQ.matches) { Object.assign(cam, to); anim = null; } else anim = { f:{ ...cam }, to, s:performance.now(), ms }; dirty = true; }
    function size() {
      const r = cv.getBoundingClientRect(); if (!r.width) return;
      W = r.width; H = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      if (!user) fly(fit(), 0); dirty = true;
    }
    const w2s = p => [W / 2 + (p[0] - cam.x) * cam.z, H / 2 + (p[1] - cam.y) * cam.z];
    function zoomAt(sx, sy, f) {
      const wx = cam.x + (sx - W / 2) / cam.z, wy = cam.y + (sy - H / 2) / cam.z;
      cam.z = clamp(cam.z * f, .14, 2.8); cam.x = wx - (sx - W / 2) / cam.z; cam.y = wy - (sy - H / 2) / cam.z; dirty = true;
    }
    if (opt.interactive) {
      const pts = new Map();
      cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]); user = true; anim = null; opt.onUser && opt.onUser(); });
      cv.addEventListener('pointermove', e => {
        if (!pts.has(e.pointerId)) return;
        const prev = pts.get(e.pointerId), cur = [e.offsetX, e.offsetY];
        if (pts.size === 1) { cam.x -= (cur[0] - prev[0]) / cam.z; cam.y -= (cur[1] - prev[1]) / cam.z; }
        else { const o = [...pts.entries()].find(([id]) => id !== e.pointerId)[1], d0 = Math.hypot(prev[0] - o[0], prev[1] - o[1]), d1 = Math.hypot(cur[0] - o[0], cur[1] - o[1]); if (d0 > 0) zoomAt((cur[0] + o[0]) / 2, (cur[1] + o[1]) / 2, d1 / d0); }
        pts.set(e.pointerId, cur); dirty = true;
      });
      const up = e => pts.delete(e.pointerId);
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('wheel', e => { e.preventDefault(); user = true; anim = null; opt.onUser && opt.onUser(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * .0016)); }, { passive:false });
      cv.addEventListener('dblclick', e => { user = true; zoomAt(e.offsetX, e.offsetY, 1.7); });
    }
    function line(p, a = 0, b = p.length - 1) { ctx.beginPath(); ctx.moveTo(p[a][0], p[a][1]); for (let i = a + 1; i <= b; i++) ctx.lineTo(p[i][0], p[i][1]); }
    function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function text(t, x, y, font, fill, halo, align = 'center') {
      ctx.font = font; ctx.textAlign = align; ctx.textBaseline = 'middle';
      if (halo) { ctx.lineWidth = 3.5; ctx.strokeStyle = halo; ctx.lineJoin = 'round'; ctx.strokeText(t, x, y); }
      ctx.fillStyle = fill; ctx.fillText(t, x, y);
    }
    function pathLabel(r, f) {
      const a = along(r.pts, f), [x, y] = w2s(a.pt); if (x < -60 || y < -30 || x > W + 60 || y > H + 30) return;
      let ang = a.ang; if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.letterSpacing = '1px'; text(r.name.toUpperCase(), 0, 0, `${r.cls === 'res' ? 600 : 700} ${r.cls === 'motor' ? 10.5 : 10}px Figtree, system-ui, sans-serif`, COL.label, COL.halo); ctx.letterSpacing = '0px';
      ctx.restore();
    }
    function bubble(x, y, t, strong) {
      ctx.font = '700 12.5px Figtree, system-ui, sans-serif';
      const w = ctx.measureText(t).width + 20, h = 28;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
      ctx.fillStyle = strong ? COL.ink : COL.surface; rr(x - w / 2, y - h - 10, w, h, 10); ctx.fill(); ctx.restore();
      ctx.fillStyle = strong ? COL.ink : COL.surface; ctx.beginPath(); ctx.moveTo(x - 6, y - 11); ctx.lineTo(x + 6, y - 11); ctx.lineTo(x, y - 4); ctx.fill();
      text(t, x, y - 10 - h / 2, '700 12.5px Figtree, system-ui, sans-serif', strong ? COL.onInk : COL.ink);
    }
    function poiIcon(cat, x, y) {
      ctx.fillStyle = POIC[cat]; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      if (cat === 'health') { ctx.fillRect(x - 1.3, y - 4.5, 2.6, 9); ctx.fillRect(x - 4.5, y - 1.3, 9, 2.6); }
      else if (cat === 'parcel') { ctx.strokeRect(x - 4, y - 3.5, 8, 7); ctx.beginPath(); ctx.moveTo(x - 4, y - 1); ctx.lineTo(x + 4, y - 1); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(x - 4.5, y - 3); ctx.lineTo(x + 4.5, y - 3); ctx.lineTo(x + 3.5, y + 3.5); ctx.lineTo(x - 3.5, y + 3.5); ctx.closePath(); ctx.stroke(); }
    }
    function draw(now) {
      const z = cam.z, t = (now - t0) / 1000, px = v => v / z;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = COL.land; ctx.fillRect(0, 0, W, H);
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - cam.x * z), dpr * (H / 2 - cam.y * z));
      ctx.fillStyle = COL.park; ctx.fill(PARK);
      if (z > .5) { ctx.fillStyle = COL.tree; ctx.fill(TREES); }
      if (z > .26) {
        ctx.globalAlpha = Math.min(1, (z - .26) / .2);
        ctx.save(); ctx.translate(px(1.5) + 1.2, px(1.5) + 1.8); ctx.fillStyle = COL['bld-shadow']; ctx.fill(BLD); ctx.fill(BIG); ctx.restore();
        ctx.fillStyle = COL.bld; ctx.fill(BLD); ctx.fill(BIG);
        if (z > .7) { ctx.strokeStyle = COL['bld-edge']; ctx.lineWidth = px(.8); ctx.stroke(BLD); ctx.stroke(BIG); }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = COL.water; ctx.fill(WATER); ctx.strokeStyle = COL['water-edge']; ctx.lineWidth = px(1.5); ctx.stroke(WATER);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const road = (cls, w, edge, fill, minpx) => {
        const lw = Math.max(w, px(minpx));
        ctx.strokeStyle = edge; ctx.lineWidth = lw + Math.max(3, px(1.4)); ctx.stroke(ROADP[cls]);
        ctx.strokeStyle = fill; ctx.lineWidth = lw; ctx.stroke(ROADP[cls]);
      };
      road('res', 10, COL['road-edge'], COL.road, 1.6);
      road('sec', 15, COL['primary-edge'], COL.primary, 2.6);
      road('pri', 20, COL['primary-edge'], COL.primary, 3.4);
      road('motor', 28, COL['motor-edge'], COL.motor, 4.5);
      // route
      let agentPos = null, agentAng = -Math.PI / 2;
      const ag = sc.agent;
      if (ag) {
        if (ag.path) { const k = RMQ.matches ? 1 : Math.min(1, t / ag.dur); const a = along(ag.path, ag.u0 + (ag.u1 - ag.u0) * k); agentPos = a.pt; agentAng = a.ang; ag._i = a.i; }
        else agentPos = ag.at;
      }
      if (sc.approach) { ctx.setLineDash([px(2), px(8)]); ctx.strokeStyle = COL.ink; ctx.lineWidth = px(4); line(APPROACH); ctx.stroke(); ctx.setLineDash([]); }
      if (sc.route) {
        ctx.strokeStyle = COL['route-edge']; ctx.lineWidth = px(11); line(ROUTE); ctx.stroke();
        ctx.strokeStyle = COL.route; ctx.lineWidth = px(6); ctx.globalAlpha = sc.route === 'faint' ? .45 : 1; line(ROUTE); ctx.stroke(); ctx.globalAlpha = 1;
        if (ag && ag.path === ROUTE && ag._i > 1) { ctx.strokeStyle = COL.done; ctx.lineWidth = px(6); line(ROUTE, 0, ag._i - 1); ctx.lineTo(agentPos[0], agentPos[1]); ctx.stroke(); }
      }
      // screen layer
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const a of AREAS) {
        if (!a.water && (z < .3 || z > 1.1)) continue;
        const [x, y] = w2s(a.p);
        if (a.water) text(a.t, x, y, 'italic 600 12px Figtree, system-ui, sans-serif', COL.label);
        else { ctx.save(); ctx.globalAlpha = .9; ctx.letterSpacing = '3px'; text(a.t, x, y, '700 10.5px Figtree, system-ui, sans-serif', COL.area, COL.halo); ctx.letterSpacing = '0px'; ctx.restore(); }
      }
      for (const r of roads) if (r.name && (r.cls !== 'res' || z > .85) && (r.cls === 'motor' || r.cls === 'pri' || z > .42)) r.at.forEach(f => pathLabel(r, f));
      if (z > .38) for (const q of POIS) {
        const hide = (sc.pick && q.p === P) ; if (hide) continue;
        const [x, y] = w2s(q.p); if (x < -40 || y < -20 || x > W + 40 || y > H + 20) continue;
        poiIcon(q.cat, x, y); if (z > .55) text(q.name, x + 14, y, '700 11px Figtree, system-ui, sans-serif', POIC[q.cat], COL.halo, 'left');
      }
      if (sc.tags) for (const g of sc.tags) {
        const [x, y] = w2s(g.p);
        ctx.fillStyle = g.hot ? COL.urgent : COL.ink; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 7); ctx.fill();
        ctx.strokeStyle = COL.surface; ctx.lineWidth = 2; ctx.stroke();
        bubble(x, y - 6, g.text, true);
      }
      if (sc.nearby) NEAR.forEach((n, k) => {
        const wob = RMQ.matches ? 0 : Math.sin(t * .8 + k) * 3;
        const [x, y] = w2s([n[0] + wob, n[1] - wob]);
        ctx.fillStyle = COL.surface; ctx.beginPath(); ctx.arc(x, y, 9.5, 0, 7); ctx.fill();
        ctx.fillStyle = COL.ink; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
      });
      if (sc.pulse && !RMQ.matches) {
        const [x, y] = w2s(sc.pulse);
        for (let k = 0; k < 3; k++) { const ph = ((t + k * .7) % 2.1) / 2.1; ctx.strokeStyle = COL.ink; ctx.globalAlpha = (1 - ph) * .45; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 14 + ph * 90, 0, 7); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      if (sc.me) {
        const [x, y] = w2s(sc.me);
        ctx.fillStyle = COL.blue; ctx.globalAlpha = .16; ctx.beginPath(); ctx.arc(x, y, 30, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.fill();
        ctx.fillStyle = COL.blue; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
      }
      if (sc.pick) {
        const [x, y] = w2s(P);
        ctx.fillStyle = COL.surface; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fill();
        ctx.strokeStyle = COL.ink; ctx.lineWidth = 5.5; ctx.beginPath(); ctx.arc(x, y, 8.5, 0, 7); ctx.stroke();
        if (sc.pickLabel) bubble(x, y - 8, sc.pickLabel);
      }
      if (sc.drop) {
        const [x, y] = w2s(D);
        ctx.fillStyle = COL.ink; rr(x - 10, y - 10, 20, 20, 5); ctx.fill();
        ctx.fillStyle = COL.surface; rr(x - 4, y - 4, 8, 8, 2); ctx.fill();
        if (sc.dropLabel) bubble(x, y - 8, sc.dropLabel, true);
      }
      if (agentPos) {
        const [x, y] = w2s(agentPos), r = 20;
        if (!RMQ.matches) { const ph = (t % 1.8) / 1.8; ctx.fillStyle = COL.ink; ctx.globalAlpha = (1 - ph) * .16; ctx.beginPath(); ctx.arc(x, y, r + 4 + ph * 22, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
        ctx.save(); ctx.translate(x, y); ctx.rotate(agentAng + Math.PI / 2);
        ctx.fillStyle = COL.ink; ctx.beginPath(); ctx.moveTo(0, -r - 9); ctx.lineTo(7, -r + 1); ctx.lineTo(-7, -r + 1); ctx.closePath(); ctx.fill(); ctx.restore();
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
        ctx.fillStyle = COL.surface; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 7); ctx.fill(); ctx.restore();
        const im = ag.img && IMG[ag.img];
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
        if (im && im.complete && im.naturalWidth) ctx.drawImage(im, x - r, y - r, r * 2, r * 2); else { ctx.fillStyle = COL.brand; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
        ctx.restore();
      }
    }
    function frame(now) {
      if (!alive) return; requestAnimationFrame(frame); if (!vis) return;
      let moving = false;
      if (anim) {
        const k0 = Math.min(1, (now - anim.s) / anim.ms), k = 1 - Math.pow(1 - k0, 3);
        cam.x = anim.f.x + (anim.to.x - anim.f.x) * k; cam.y = anim.f.y + (anim.to.y - anim.f.y) * k;
        cam.z = Math.exp(Math.log(anim.f.z) + (Math.log(anim.to.z) - Math.log(anim.f.z)) * k);
        moving = true; if (k0 >= 1) anim = null;
      }
      const t = (now - t0) / 1000;
      const live = !RMQ.matches && (sc.pulse || sc.nearby || (sc.agent && (sc.agent.path ? t < sc.agent.dur + .2 : false) ) || sc.agent);
      if (dirty || moving || live) { draw(now); dirty = false; }
    }
    const ro = new ResizeObserver(size); ro.observe(cv);
    const io = new IntersectionObserver(es => { vis = es[0].isIntersecting; if (vis) dirty = true; }); io.observe(cv);
    requestAnimationFrame(frame);
    const api = {
      scene(next, insets) {
        if (next.key !== sc.key) t0 = performance.now();
        sc = next; if (insets) ins = { t:0, r:0, b:0, l:0, ...insets };
        if (W > 1 && !user) fly(fit(), first ? 0 : 700);
        first = false; dirty = true;
      },
      recenter() { user = false; fly(fit(), 650); },
      dirty() { dirty = true; },
      destroy() { alive = false; ro.disconnect(); io.disconnect(); insts.delete(api); }
    };
    insts.add(api); return api;
  }
  return { create, avatar, P, D, ROUTE, APPROACH, HOME_AGENT, NEAR, POIS };
})();
