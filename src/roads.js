// ===== Road network: highway loop, connectors, city grid, nav graph, A* =====
import { CITY_HALF, STREET_SPACING, rawHeight, currentMap } from './terrain.js';
import { clamp, lerp } from './util.js';

export const LOOP_HALF_W = 13;
export const CONN_HALF_W = 10;

export function loopRadius(t, mapId = currentMap) {
  if (mapId === 'speedway') {
    // Elongated high-speed oval: long N–S straights, tight banked ends — ~10 km lap
    const a = 1780, b = 980;
    const c = Math.cos(t), s = Math.sin(t);
    return 1 / Math.sqrt((c * c) / (a * a) + (s * s) / (b * b));
  }
  if (mapId === 'tokyo') {
    // Distinct Tokyo Wangan + Touge silhouette: flatter high-speed Wangan straight over Tokyo Bay on the east (cos(t)>0),
    // sweeping deep into the Hakone/Haruna mountain S-curves on the west (cos(t)<0).
    const eastFlat = Math.max(0, Math.cos(t));
    return 1290 - 150 * eastFlat * eastFlat + 140 * Math.cos(2 * t) + 75 * Math.sin(3 * t - 0.4) + 42 * Math.sin(6 * t + 0.9) * (1 - 0.7 * eastFlat);
  }
  if (mapId === 'stuttgart') {
    // Autobahn ring around the Kessel: slightly squashed N–S, flowing bends into the western vineyard hills.
    return 1280 + 95 * Math.cos(2 * t) + 70 * Math.sin(3 * t + 0.6) + 38 * Math.sin(5 * t - 0.3) + 28 * Math.cos(7 * t + 1.1);
  }
  return 1320 + 110 * Math.sin(3 * t + 0.5) + 50 * Math.sin(7 * t + 1.3) + 22 * Math.sin(11 * t + 2.1);
}
function loopPoint(t, mapId = currentMap) {
  const r = loopRadius(t, mapId);
  return { x: Math.cos(t) * r, z: Math.sin(t) * r };
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z: 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  };
}

function resample(poly, spacing) {
  const out = [{ x: poly[0].x, z: poly[0].z }];
  let prev = poly[0], acc = 0;
  for (let i = 1; i < poly.length; i++) {
    const b = poly[i];
    let start = prev;
    let seg = Math.hypot(b.x - start.x, b.z - start.z);
    while (acc + seg >= spacing && seg > 1e-9) {
      const t = (spacing - acc) / seg;
      const p = { x: start.x + (b.x - start.x) * t, z: start.z + (b.z - start.z) * t };
      out.push(p);
      start = p; seg = Math.hypot(b.x - start.x, b.z - start.z); acc = 0;
    }
    acc += seg; prev = b;
  }
  const last = poly[poly.length - 1];
  const lo = out[out.length - 1];
  if (Math.hypot(last.x - lo.x, last.z - lo.z) > spacing * 0.4) out.push({ x: last.x, z: last.z });
  else out[out.length - 1] = { x: last.x, z: last.z };
  return out;
}

function smoothHeights(pts, closed, radius, passes) {
  const n = pts.length;
  let h = pts.map((p) => p.h);
  for (let p = 0; p < passes; p++) {
    const nh = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -radius; k <= radius; k++) {
        let j = i + k;
        if (closed) j = (j + n) % n; else j = clamp(j, 0, n - 1);
        s += h[j]; c++;
      }
      nh[i] = s / c;
    }
    h = nh;
  }
  for (let i = 0; i < n; i++) pts[i].h = h[i];
}


// ---- geometry hygiene ----
function minRadius(pts) {
  let min = 1e9;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (area2 > 1e-6) min = Math.min(min, (ab * bc * ca) / (2 * area2));
  }
  return min;
}
// Laplacian-relax an open polyline (ends pinned) until no bend is tighter than minR, so the ribbon never folds over itself.
function relaxCurve(pts, minR, pin = 3) {
  for (let pass = 0; pass < 6000 && minRadius(pts) < minR; pass++) {
    const src = pts.map((p) => ({ x: p.x, z: p.z }));
    for (let i = pin; i < pts.length - pin; i++) {
      pts[i].x = src[i].x * 0.5 + (src[i - 1].x + src[i + 1].x) * 0.25;
      pts[i].z = src[i].z * 0.5 + (src[i - 1].z + src[i + 1].z) * 0.25;
    }
  }
}
function nearestOnPolyline(pts, closed, x, z) {
  let best = 1e18, bi = 0, bt = 0; const n = pts.length, segN = closed ? n : n - 1;
  for (let i = 0; i < segN; i++) {
    const a = pts[i], b = pts[(i + 1) % n]; const dx = b.x - a.x, dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1e-6;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2;
    if (d < best) { best = d; bi = i; bt = t; }
  }
  const a = pts[bi], b = pts[(bi + 1) % n];
  return { d: Math.sqrt(best), h: a.h + (b.h - a.h) * bt };
}
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function smoothPinned(pts, radius, passes, pin) {
  const n = pts.length; let h = pts.map((p) => p.h);
  for (let ps = 0; ps < passes; ps++) {
    const nh = h.slice();
    for (let i = pin; i < n - pin; i++) { let s = 0, c = 0; for (let k = -radius; k <= radius; k++) { const j = clamp(i + k, 0, n - 1); s += h[j]; c++; } nh[i] = s / c; }
    h = nh;
  }
  for (let i = 0; i < n; i++) pts[i].h = h[i];
}

// Make a height profile drivable: cap grade, then smooth crests/dips so cars stay planted (ends pinned).
function driveableProfile(pts, maxGrade, pin = 1, closed = false) {
  const n = pts.length;
  const ds = []; for (let i = 0; i < n - 1; i++) ds.push(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z));
  for (let pass = 0; pass < 800; pass++) {
    let worst = 0;
    for (let i = 0; i < n - 1; i++) {
      const dh = pts[i + 1].h - pts[i].h, lim = maxGrade * ds[i];
      if (Math.abs(dh) > lim) {
        const ex = (Math.abs(dh) - lim) * 0.5 * Math.sign(dh); worst = Math.max(worst, Math.abs(dh) - lim);
        if (i >= pin) pts[i].h += ex; if (i + 1 < n - pin) pts[i + 1].h -= ex;
      }
    }
    // curvature relief: pull each point toward the average of its neighbours
    for (let i = pin; i < n - pin; i++) pts[i].h = pts[i].h * 0.6 + (pts[i - 1].h + pts[i + 1].h) * 0.2;
    if (worst < 0.01 && pass > 40) break;
  }
}

export function buildRoads(mapId = currentMap) {
  const isTokyo = mapId === 'tokyo';
  const isStuttgart = mapId === 'stuttgart';
  const isSpeedway = mapId === 'speedway';
  const roads = [];
  // ---- Highway loop ----
  const dense = [];
  const N = 4000;
  for (let i = 0; i <= N; i++) dense.push(loopPoint((i / N) * Math.PI * 2, mapId));
  let loopPts = resample(dense, 10);
  loopPts.pop(); // closed
  for (const p of loopPts) {
    const minH = isTokyo && p.x > 480 ? lerp(5, 16, sstep(480, 780, p.x)) : isSpeedway ? 2 : 3;
    p.h = Math.max(rawHeight(p.x, p.z, mapId), minH);
  }
  smoothHeights(loopPts, true, 10, 4);
  for (const p of loopPts) {
    const minH = isTokyo && p.x > 480 ? lerp(5, 15, sstep(480, 780, p.x)) : isSpeedway ? 2 : 3.5;
    p.h = Math.max(p.h, minH);
  }
  const loopName = isTokyo ? 'WANGAN EXPRESSWAY' : isStuttgart ? 'STUTTGARTER RING' : isSpeedway ? 'REDLINE SPEEDWAY' : 'COAST HIGHWAY';
  // Wider deck on the speed oval so packs can draft three-wide
  const loop = { name: loopName, pts: loopPts, halfW: isSpeedway ? 18 : LOOP_HALF_W, closed: true, kind: 'highway' };
  roads.push(loop);

  const loopIndexAtAngle = (ang) => {
    const target = loopPoint(ang, mapId);
    let best = 0, bd = 1e18;
    loopPts.forEach((p, i) => { const d = (p.x - target.x) ** 2 + (p.z - target.z) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };

  const nL = loopPts.length;
  // ---- Connectors (speedway is a pure closed oval — no city ramps) ----
  if (isSpeedway) {
    const MAXB = 0.085; // stronger banking into the tight ends
    let bank = loopPts.map((b, i) => {
      const a = loopPts[(i - 1 + nL) % nL], c = loopPts[(i + 1) % nL];
      const l1 = Math.hypot(b.x - a.x, b.z - a.z) || 1, l2 = Math.hypot(c.x - b.x, c.z - b.z) || 1;
      const cross = ((b.x - a.x) / l1) * ((c.z - b.z) / l2) - ((b.z - a.z) / l1) * ((c.x - b.x) / l2);
      const kappa = cross / ((l1 + l2) / 2);
      return -Math.sign(kappa) * clamp(Math.abs(kappa) * 80, 0, MAXB);
    });
    for (let pass = 0; pass < 8; pass++) bank = bank.map((_, i) => { let sum = 0; for (let k = -10; k <= 10; k++) sum += bank[(i + k + nL) % nL]; return sum / 21; });
    loopPts.forEach((pt, i) => { pt.bank = bank[i]; });
    return { roads, loop, connectors: [], ramps: [], loopIndexAtAngle };
  }
  const connDefs = isTokyo ? [
    { tag: 'north', name: 'SHINJUKU DORI', jp: '新宿通り', s: { x: 0, z: -CITY_HALF }, dir: { x: 0, z: -1 }, ang: -Math.PI / 2, wig: 75, freq: 1 },
    { tag: 'south', name: 'SHIBUYA DORI', jp: '渋谷通り', s: { x: 0, z: CITY_HALF }, dir: { x: 0, z: 1 }, ang: Math.PI / 2, wig: -80, freq: 1 },
    { tag: 'east', name: 'RAINBOW BRIDGE', jp: 'レインボーブリッジ', s: { x: CITY_HALF, z: 0 }, dir: { x: 1, z: 0 }, ang: 0, wig: 15, freq: 1 },
    { tag: 'west', name: 'HAKONE TOUGE', jp: '箱根峠', s: { x: -CITY_HALF, z: 0 }, dir: { x: -1, z: 0 }, ang: Math.PI, wig: -115, freq: 3 },
    { tag: 'nw', name: 'HARUNA PASS', jp: '榛名山', s: { x: -CITY_HALF, z: -CITY_HALF }, dir: { x: -0.7071, z: -0.7071 }, ang: -Math.PI * 0.75, wig: 120, freq: 3 },
    { tag: 'se', name: 'ODAIBA BAYWAY', jp: 'お台場湾岸', s: { x: CITY_HALF, z: CITY_HALF }, dir: { x: 0.7071, z: 0.7071 }, ang: Math.PI * 0.25, wig: 45, freq: 1 },
  ] : isStuttgart ? [
    { tag: 'north', name: 'HEILBRONNER STR.', jp: 'Heilbronn', s: { x: 0, z: -CITY_HALF }, dir: { x: 0, z: -1 }, ang: -Math.PI / 2, wig: 55, freq: 1 },
    { tag: 'south', name: 'TÜBINGER STR.', jp: 'Tübingen', s: { x: 0, z: CITY_HALF }, dir: { x: 0, z: 1 }, ang: Math.PI / 2, wig: -65, freq: 1 },
    { tag: 'east', name: 'NECKARTAL', jp: 'Neckar', s: { x: CITY_HALF, z: 0 }, dir: { x: 1, z: 0 }, ang: 0, wig: 40, freq: 1 },
    { tag: 'west', name: 'WEINBERGE', jp: 'Weinberge', s: { x: -CITY_HALF, z: 0 }, dir: { x: -1, z: 0 }, ang: Math.PI, wig: -95, freq: 2 },
    { tag: 'nw', name: 'SOLITUDE', jp: 'Solitude', s: { x: -CITY_HALF, z: -CITY_HALF }, dir: { x: -0.7071, z: -0.7071 }, ang: -Math.PI * 0.75, wig: 105, freq: 3 },
    { tag: 'se', name: 'FLUGHAFEN', jp: 'Flughafen', s: { x: CITY_HALF, z: CITY_HALF }, dir: { x: 0.7071, z: 0.7071 }, ang: Math.PI * 0.25, wig: 55, freq: 1 },
  ] : [
    { tag: 'north', name: 'NORTH AVE', s: { x: 0, z: -CITY_HALF }, dir: { x: 0, z: -1 }, ang: -Math.PI / 2, wig: 60, freq: 1 },
    { tag: 'south', name: 'SOUTH AVE', s: { x: 0, z: CITY_HALF }, dir: { x: 0, z: 1 }, ang: Math.PI / 2, wig: -70, freq: 1 },
    { tag: 'east', name: 'OCEAN BLVD', s: { x: CITY_HALF, z: 0 }, dir: { x: 1, z: 0 }, ang: 0, wig: 50, freq: 1 },
    { tag: 'west', name: 'WEST PARKWAY', s: { x: -CITY_HALF, z: 0 }, dir: { x: -1, z: 0 }, ang: Math.PI, wig: -60, freq: 1 },
    { tag: 'nw', name: 'CANYON ROAD', s: { x: -CITY_HALF, z: -CITY_HALF }, dir: { x: -0.7071, z: -0.7071 }, ang: -Math.PI * 0.75, wig: 90, freq: 3 },
    { tag: 'se', name: 'HARBOR DRIVE', s: { x: CITY_HALF, z: CITY_HALF }, dir: { x: 0.7071, z: 0.7071 }, ang: Math.PI * 0.25, wig: 70, freq: 2 },
  ];
  const connectors = [];
  const ramps = [];
  const loopTan = (i) => { const a = loopPts[(i - 1 + nL) % nL], b = loopPts[(i + 1) % nL]; const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz); return { x: dx / l, z: dz / l }; };
  for (const c of connDefs) {
    const li = loopIndexAtAngle(c.ang);
    const e = loopPts[li];
    const s = c.s;
    // connector ends at a fork point inside the loop, then splits into two merging ramps
    const er = Math.hypot(e.x, e.z);
    const F = { x: e.x - (e.x / er) * 190, z: e.z - (e.z / er) * 190 };
    const s1 = { x: s.x + c.dir.x * 70, z: s.z + c.dir.z * 70 };
    const ex = F.x - s1.x, ez = F.z - s1.z; const el = Math.hypot(ex, ez);
    const nx = -ez / el, nz = ex / el;
    const ctrl = [s, s1];
    const K = 4;
    for (let k = 1; k < K; k++) {
      const t = k / K;
      const w = Math.sin(t * Math.PI * c.freq) * c.wig * (k % 2 === 0 && c.freq > 1 ? -1 : 1);
      ctrl.push({ x: s1.x + ex * t + nx * w, z: s1.z + ez * t + nz * w });
    }
    const f0 = { x: F.x - (e.x / er) * 50, z: F.z - (e.z / er) * 50 };
    ctrl.push(f0, { x: F.x, z: F.z });
    const dense2 = [];
    const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
    for (let i = 1; i < P.length - 2; i++) for (let t = 0; t < 1; t += 0.02) dense2.push(catmull(P[i - 1], P[i], P[i + 1], P[i + 2], t));
    dense2.push({ x: F.x, z: F.z });
    const pts = resample(dense2, 10);
    pts[0] = { x: s.x, z: s.z };
    pts[pts.length - 1] = { x: F.x, z: F.z };
    relaxCurve(pts, CONN_HALF_W * 3.2);
    for (const p of pts) p.h = rawHeight(p.x, p.z, mapId);
    smoothHeights(pts, false, 8, 4);
    const targetH = e.h;
    const h0 = pts[0].h, h1 = pts[pts.length - 1].h;
    const t0 = 0 - h0, t1 = targetH - h1;
    pts.forEach((p, i) => {
      const t = i / (pts.length - 1);
      p.h += lerp(t0, t1, t);
      if (isTokyo && p.x > 550) {
        const arch = Math.sin(clamp((p.x - 560) / 520, 0, 1) * Math.PI) * (c.tag === 'east' ? 7 : 3);
        p.h = Math.max(p.h, lerp(3, 15.5, sstep(550, 740, p.x)) + arch);
      } else if (i >= 12) {
        p.h = Math.max(p.h, 2.5);
      }
    });
    for (let i = 0; i < Math.min(8, pts.length); i++) pts[i].h *= i / 8;
    driveableProfile(pts, 0.085, 1);
    const road = { tag: c.tag, name: c.name, jp: c.jp, pts, halfW: CONN_HALF_W, closed: false, kind: 'conn', loopIndex: li };
    roads.push(road);
    connectors.push(road);
    // ramps (bezier merge tangentially into loop)
    const dirF = { x: e.x / er, z: e.z / er };
    road.ramps = [];
    for (const sg of [1, -1]) {
      const lp = (li + sg * 20 + nL) % nL;
      const L = loopPts[lp];
      const tg = loopTan(lp); const tx = tg.x * sg, tz = tg.z * sg;
      const C1 = { x: F.x + dirF.x * 80, z: F.z + dirF.z * 80 };
      const C2 = { x: L.x - tx * 90, z: L.z - tz * 90 };
      const dense = [];
      for (let t = 0; t <= 1.0001; t += 0.01) {
        const u = 1 - t;
        dense.push({ x: u * u * u * F.x + 3 * u * u * t * C1.x + 3 * u * t * t * C2.x + t * t * t * L.x, z: u * u * u * F.z + 3 * u * u * t * C1.z + 3 * u * t * t * C2.z + t * t * t * L.z });
      }
      const rp = resample(dense, 10);
      rp[0] = { x: F.x, z: F.z }; rp[rp.length - 1] = { x: L.x, z: L.z };
      relaxCurve(rp, 9 * 3.2);
      const hA = pts[pts.length - 1].h, hB = L.h; // (connector end height is the fork height)
      // sibling ramps share the fork height for the first quarter so they never stack at different heights
      const forkPin = Math.max(4, Math.ceil(rp.length * 0.28));
      rp.forEach((p, i) => { const t = i / (rp.length - 1); p.h = lerp(hA, hB, sstep(0.28, 1, t)); });
      smoothPinned(rp, 2, 3, forkPin);
      driveableProfile(rp, 0.09, forkPin);
      for (let i = 0; i < forkPin; i++) rp[i].h = hA;
      smoothPinned(rp, 2, 2, 2);
      // wherever the ramp or its shoulder approaches the highway deck, lock it to the deck height so edges meet seamlessly
      for (let i = 1; i < rp.length; i++) {
        const fk = 1 - sstep(forkPin - 2, forkPin + 3, i);
        const q = nearestOnPolyline(loopPts, true, rp[i].x, rp[i].z);
        const w = (1 - sstep(LOOP_HALF_W + 9 + 16, LOOP_HALF_W + 9 + 64, q.d)) * (1 - fk);
        rp[i].h = lerp(rp[i].h, q.h, w);
        if (i < forkPin - 1) rp[i].h = hA;
      }
      rp[0].h = hA;
      rp[rp.length - 1].h = L.h;
      const ramp = { tag: c.tag, name: c.name + ' RAMP', pts: rp, halfW: 9, closed: false, kind: 'ramp', loopIndex: lp, parent: road };
      roads.push(ramp); ramps.push(ramp); road.ramps.push(ramp);
    }
  }
  // ---- banking (superelevation): the highway tilts into its bends, flat where the ramps merge onto the deck ----
  const MAXB = 0.055;
  let bank = loopPts.map((b, i) => {
    const a = loopPts[(i - 1 + nL) % nL], c = loopPts[(i + 1) % nL];
    const l1 = Math.hypot(b.x - a.x, b.z - a.z) || 1, l2 = Math.hypot(c.x - b.x, c.z - b.z) || 1;
    const cross = ((b.x - a.x) / l1) * ((c.z - b.z) / l2) - ((b.z - a.z) / l1) * ((c.x - b.x) / l2);
    const kappa = cross / ((l1 + l2) / 2);
    return -Math.sign(kappa) * clamp(Math.abs(kappa) * 60, 0, MAXB);
  });
  for (let pass = 0; pass < 6; pass++) bank = bank.map((_, i) => { let sum = 0; for (let k = -8; k <= 8; k++) sum += bank[(i + k + nL) % nL]; return sum / 17; });
  loopPts.forEach((pt, i) => {
    let w = 1;
    for (const c of connectors) { const d = Math.min(Math.abs(i - c.loopIndex), nL - Math.abs(i - c.loopIndex)); w = Math.min(w, sstep(38, 58, d)); }
    pt.bank = bank[i] * w;
  });
  return { roads, loop, connectors, ramps, loopIndexAtAngle };
}

// ---------------- Navigation graph -----------------
export class NavGraph {
  constructor() { this.nodes = []; this.keyMap = new Map(); }
  add(x, z, h = 0, key = null) {
    if (key && this.keyMap.has(key)) return this.keyMap.get(key);
    const id = this.nodes.length;
    this.nodes.push({ id, x, z, h, edges: [] });
    if (key) this.keyMap.set(key, id);
    return id;
  }
  link(a, b) {
    if (a === b) return;
    const A = this.nodes[a], B = this.nodes[b];
    if (A.edges.some((e) => e.to === b)) return;
    const c = Math.hypot(A.x - B.x, A.z - B.z);
    A.edges.push({ to: b, cost: c });
    B.edges.push({ to: a, cost: c });
  }
  buildGrid() {
    const cs = 60;
    this.grid = new Map();
    for (const n of this.nodes) {
      const k = Math.floor(n.x / cs) * 10007 + Math.floor(n.z / cs);
      let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(n);
    }
    this.gcs = cs;
  }
  nearest(x, z, maxR = 400) {
    const cs = this.gcs;
    const ci = Math.floor(x / cs), cj = Math.floor(z / cs);
    let best = null, bd = 1e18;
    for (let r = 0; r <= Math.ceil(maxR / cs); r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const a = this.grid.get(i * 10007 + j); if (!a) continue;
        for (const n of a) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } }
      }
      if (best && Math.sqrt(bd) < r * cs) break;
    }
    return best;
  }
  astar(start, goal) {
    const nodes = this.nodes;
    const g = new Float64Array(nodes.length).fill(Infinity);
    const came = new Int32Array(nodes.length).fill(-1);
    const closed = new Uint8Array(nodes.length);
    const G = nodes[goal];
    const heap = [];
    const push = (id, f) => { heap.push([f, id]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    g[start] = 0; push(start, 0);
    let iter = 0;
    while (heap.length && iter++ < 20000) {
      const [, cur] = pop();
      if (cur === goal) break;
      if (closed[cur]) continue; closed[cur] = 1;
      for (const e of nodes[cur].edges) {
        const ng = g[cur] + e.cost;
        if (ng < g[e.to]) {
          g[e.to] = ng; came[e.to] = cur;
          const n = nodes[e.to];
          push(e.to, ng + Math.hypot(n.x - G.x, n.z - G.z));
        }
      }
    }
    if (came[goal] === -1 && start !== goal) return null;
    const path = [goal];
    let c = goal;
    while (c !== start) { c = came[c]; if (c < 0) return null; path.push(c); }
    path.reverse();
    return path;
  }
}

export function buildNav(net) {
  const nav = new NavGraph();
  const S = STREET_SPACING, H = CITY_HALF, step = 20;
  const ck = (x, z) => `c${Math.round(x)},${Math.round(z)}`;
  // city grid
  for (let j = -H; j <= H; j += S) {
    let prevA = -1, prevB = -1;
    for (let x = -H; x <= H; x += step) {
      const a = nav.add(x, j, 0, ck(x, j));
      if (prevA >= 0) nav.link(prevA, a); prevA = a;
      const b = nav.add(j, x, 0, ck(j, x));
      if (prevB >= 0) nav.link(prevB, b); prevB = b;
    }
  }
  // loop
  const loopIds = net.loop.pts.map((p, i) => nav.add(p.x, p.z, p.h, `l${i}`));
  for (let i = 0; i < loopIds.length; i++) nav.link(loopIds[i], loopIds[(i + 1) % loopIds.length]);
  net.loop.navIds = loopIds;
  // connectors
  for (const c of net.connectors) {
    const ids = c.pts.map((p, i) => {
      if (i === 0) return nav.keyMap.get(ck(p.x, p.z));
      return nav.add(p.x, p.z, p.h);
    });
    for (let i = 0; i < ids.length - 1; i++) nav.link(ids[i], ids[i + 1]);
    c.navIds = ids;
    const fork = ids[ids.length - 1];
    for (const r of c.ramps) {
      const rid = r.pts.map((p, i) => (i === 0 ? fork : i === r.pts.length - 1 ? loopIds[r.loopIndex] : nav.add(p.x, p.z, p.h)));
      for (let i = 0; i < rid.length - 1; i++) nav.link(rid[i], rid[i + 1]);
      r.navIds = rid;
    }
  }
  nav.ramps = net.roads.filter((r) => r.kind === 'ramp').map((r) => ({ tag: r.tag, name: r.name, loopIndex: r.loopIndex, navIds: r.navIds }));
  nav.buildGrid();
  nav.cityId = (x, z) => nav.keyMap.get(ck(x, z));
  nav.loopId = (ang) => loopIds[net.loopIndexAtAngle(ang)];
  return nav;
}

// Build a route polyline from a list of nav node ids (waypoints)
export function buildRoute(nav, wps) {
  let ids = [];
  const clean = wps.filter((id) => id != null && nav.nodes[id]);
  for (let i = 0; i < clean.length - 1; i++) {
    const p = nav.astar(clean[i], clean[i + 1]);
    if (!p) continue;
    if (ids.length) p.shift();
    ids.push(...p);
  }
  // remove A-B-A reversals left over at leg joins
  for (let i = 2; i < ids.length; i++) if (ids[i] === ids[i - 2]) { ids.splice(i - 1, 2); i = Math.max(1, i - 2); }
  const pts = ids.map((id) => ({ x: nav.nodes[id].x, z: nav.nodes[id].z }));
  if (!pts.length) return { pts: [{ x: 0, z: 0, d: 0 }], length: 0, ids: [] };
  const out = pts;
  let d = 0;
  out[0].d = 0;
  for (let i = 1; i < out.length; i++) { d += Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z); out[i].d = d; }
  return { pts: out, length: d, ids };
}
export function projectOnRoute(route, x, z, hint = 0, window = 40) {
  const pts = route.pts;
  const scan = (lo, hi) => {
    let best = lo, bd = 1e18, bt = 0;
    for (let i = lo; i <= hi; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1e-6;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / l2; t = clamp(t, 0, 1);
      const cx = a.x + dx * t, cz = a.z + dz * t;
      const dd = (x - cx) ** 2 + (z - cz) ** 2 + (i === lo ? 0 : 0);
      if (dd < bd) { bd = dd; best = i; bt = t; }
    }
    return { best, bd, bt };
  };
  let r = scan(Math.max(0, hint - window), Math.min(pts.length - 2, hint + window));
  if (r.bd > 25 * 25) { // lost it (teleport / respawn / long detour): search the whole route, nearest segment wins, ties -> closest to the old hint
    const g = scan(0, pts.length - 2);
    if (g.bd < r.bd - 4) r = g;
  }
  const a = pts[r.best], b = pts[Math.min(r.best + 1, pts.length - 1)];
  return { index: r.best, dist: a.d + (b.d - a.d) * r.bt, off: Math.sqrt(r.bd) };
}
export function pointAtDist(route, dist, out = {}) {
  const pts = route.pts;
  dist = clamp(dist, 0, route.length);
  // binary search
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].d <= dist) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi];
  const t = (dist - a.d) / (b.d - a.d || 1);
  out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
  out.dx = (b.x - a.x); out.dz = (b.z - a.z);
  const l = Math.hypot(out.dx, out.dz) || 1; out.dx /= l; out.dz /= l;
  out.index = lo;
  return out;
}
