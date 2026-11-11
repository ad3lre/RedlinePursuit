// Speedway-only world: flat oval route + height / onRoad queries (no city nav).
import { clamp } from './math.js';

const HALF_W = 18;

export function loopRadius(t) {
  const a = 1780, b = 980;
  const c = Math.cos(t), s = Math.sin(t);
  return 1 / Math.sqrt((c * c) / (a * a) + (s * s) / (b * b));
}

export function loopPoint(t) {
  const r = loopRadius(t);
  return { x: Math.cos(t) * r, z: Math.sin(t) * r };
}

/** Almost-flat speed bowl (matches src/terrain.js speedway feel). */
export function heightAt(x, z) {
  const d = Math.max(Math.abs(x), Math.abs(z));
  const und = Math.sin(x * 0.007) * Math.cos(z * 0.006) * 0.9;
  const edge = d < 700 ? 0 : Math.min(1, (d - 700) / 700);
  return 1.5 + und + edge * 1.5;
}

/**
 * One-lap race polyline (decreasing angle = race heading used by game.js).
 * Open path that starts/ends near the same spot — same shape as client buildRoute.
 */
export function buildSpeedwayRoute(spacing = 10) {
  const start = Math.PI / 2; // north
  const N = Math.max(400, Math.ceil((2 * Math.PI * 1400) / spacing));
  const pts = [];
  let d = 0;
  let prev = null;
  for (let i = 0; i <= N; i++) {
    const t = start - (i / N) * Math.PI * 2;
    const p = loopPoint(t);
    if (prev) d += Math.hypot(p.x - prev.x, p.z - prev.z);
    pts.push({ x: p.x, z: p.z, d });
    prev = p;
  }
  return { pts, length: d };
}

export function projectOnRoute(route, x, z, hint = 0, window = 40) {
  const pts = route.pts;
  const scan = (lo, hi) => {
    let best = lo, bd = 1e18, bt = 0;
    for (let i = lo; i <= hi; i++) {
      const a = pts[i], b = pts[i + 1];
      if (!b) break;
      const dx = b.x - a.x, dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1e-6;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / l2; t = clamp(t, 0, 1);
      const cx = a.x + dx * t, cz = a.z + dz * t;
      const dd = (x - cx) ** 2 + (z - cz) ** 2;
      if (dd < bd) { bd = dd; best = i; bt = t; }
    }
    return { best, bd, bt };
  };
  let r = scan(Math.max(0, hint - window), Math.min(pts.length - 2, hint + window));
  if (r.bd > 25 * 25) {
    const g = scan(0, pts.length - 2);
    if (g.bd < r.bd - 4) r = g;
  }
  const a = pts[r.best], b = pts[Math.min(r.best + 1, pts.length - 1)];
  return { index: r.best, dist: a.d + (b.d - a.d) * r.bt, off: Math.sqrt(r.bd) };
}

export function pointAtDist(route, dist, out = {}) {
  const pts = route.pts;
  dist = clamp(dist, 0, route.length);
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (pts[m].d <= dist) lo = m; else hi = m;
  }
  const a = pts[lo], b = pts[hi];
  const t = (dist - a.d) / (b.d - a.d || 1);
  out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
  out.dx = (b.x - a.x); out.dz = (b.z - a.z);
  const l = Math.hypot(out.dx, out.dz) || 1; out.dx /= l; out.dz /= l;
  out.index = lo;
  return out;
}

export function onRoad(route, x, z, halfW = HALF_W) {
  return projectOnRoute(route, x, z, 0, 80).off <= halfW + 1.5;
}

export function roadDist(route, x, z) {
  return projectOnRoute(route, x, z, 0, 80).off;
}

export function makeSpeedwayWorld(route) {
  return {
    heightAt,
    onRoad: (x, z) => onRoad(route, x, z),
    roadDist: (x, z) => roadDist(route, x, z),
    route,
  };
}

export const SPEED_GRID = [
  [48, -6], [48, 0], [48, 6],
  [30, -6], [30, 0], [30, 6],
  [12, -6], [12, 0], [12, 6],
  [0, -6], [0, 0], [0, 6],
];

export function placeOnGrid(route, slot, out = {}) {
  const g = SPEED_GRID[slot % SPEED_GRID.length];
  const p = pointAtDist(route, g[0], out);
  const lat = g[1];
  return {
    x: p.x + -p.dz * lat,
    z: p.z + p.dx * lat,
    yaw: Math.atan2(p.dx, p.dz),
    lat,
    dist: g[0],
  };
}
