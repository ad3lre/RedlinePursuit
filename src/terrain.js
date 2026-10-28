// ===== Terrain height model =====
import { makeNoise2D, fbm, smoothstep, lerp, clamp } from './util.js';

export const WORLD_HALF = 2000;
export const CITY_HALF = 600;
export const STREET_SPACING = 120;
export const STREET_HALF_W = 10;
export const WATER_LEVEL = -1.5;
export const CITY_PLANE = 0.04;
export const HF_N = 400; // cells per side
export const HF_CELL = (WORLD_HALF * 2) / HF_N;

const n1 = makeNoise2D(1337);
const n2 = makeNoise2D(4242);
const n3 = makeNoise2D(777);
const n4 = makeNoise2D(2088);

export let currentMap = 'coast';
export function setTerrainMap(m) { currentMap = m || 'coast'; }

export function rawHeight(x, z, mapId = currentMap) {
  const dCity = Math.max(Math.abs(x), Math.abs(z));
  const mask = smoothstep(640, 980, dCity);
  if (mapId === 'tokyo') {
    // Tokyo Night: strictly flat megacity basin (dCity <= 640 -> h = 0), wide Tokyo Bay on the east (x > 680) with Odaiba island,
    // and steep Mt. Hakone / Haruna volcanic mountains on the west and northwest.
    let h = (fbm(n4, x / 620, z / 620, 4) * 74 + 26 + fbm(n2, x / 175, z / 175, 3) * 13);
    const westMount = smoothstep(-660, -1450, x) * (0.65 + 0.35 * smoothstep(-600, 900, Math.abs(z)));
    h += westMount * (165 + 135 * fbm(n3, (x + 300) / 230, z / 230, 4));
    const borderMount = smoothstep(1450, 1980, Math.max(-x, Math.abs(z))) * (1 - smoothstep(450, 950, x));
    h += borderMount * (210 + 140 * fbm(n3, x / 250, z / 250, 4));
    const bayEdge = 720 + 55 * Math.sin(z / 240) - 35 * Math.cos(z / 110);
    const inBay = smoothstep(bayEdge - 40, bayEdge + 110, x);
    h = lerp(h, -26, inBay);
    const odDist = Math.hypot((x - 920) / 1.15, (z - 180) / 1.35);
    const odaiba = 1 - smoothstep(155, 225, odDist);
    h = lerp(h, 4.2, odaiba);
    return h * mask;
  }
  if (mapId === 'stuttgart') {
    // Stuttgart: Kessel basin flat in the city, vineyard / Schwäbische Alb hills all around, Neckar river corridor NE→SE.
    const maskSt = smoothstep(620, 1000, dCity);
    let h = (fbm(n1, x / 680, z / 680, 4) * 48 + 18 + fbm(n2, x / 190, z / 190, 3) * 10) * maskSt;
    // Surrounding hills (west Solitude / Birkenkopf stronger, south Alb foothills)
    const ring = smoothstep(980, 1650, dCity);
    const hillShape = 0.55 + 0.45 * fbm(n3, x / 280, z / 280, 4);
    const westBoost = smoothstep(-500, -1400, x) * 0.55;
    const southBoost = smoothstep(700, 1600, z) * 0.4;
    h += ring * (95 + 110 * hillShape) * (1 + westBoost + southBoost);
    // Gentle vineyard terraces on mid slopes
    h += smoothstep(70, 140, h) * (1 - smoothstep(200, 260, h)) * fbm(n4, x / 90, z / 90, 3) * 8;
    // Neckar: snaking valley from NW through NE then SE — carves a water channel outside the hard city grid
    const neckarZ = -80 + 0.22 * x + 55 * Math.sin(x / 210) + 28 * Math.cos(x / 95);
    const riverDist = Math.abs(z - neckarZ);
    const alongRiver = smoothstep(-200, 200, x + z * 0.15) * (1 - smoothstep(1500, 1850, Math.hypot(x, z)));
    const river = (1 - smoothstep(28, 95, riverDist)) * alongRiver * smoothstep(520, 780, dCity);
    h = lerp(h, -10, river);
    return h;
  }
  const maskCoast = smoothstep(680, 1050, dCity);
  let h = (fbm(n1, x / 750, z / 750, 4) * 60 + 22 + fbm(n2, x / 210, z / 210, 3) * 9) * maskCoast;
  // mountains on west/north/south borders
  const e = Math.max(-x, Math.abs(z));
  const eastFade = 1 - smoothstep(1250, 1600, x);
  const me = smoothstep(1580, 2050, e) * eastFade;
  h += me * (200 + 140 * fbm(n3, x / 260, z / 260, 4));
  // ocean to the east
  const coast = x + 45 * Math.sin(z / 170) + 25 * Math.sin(z / 61);
  const o = smoothstep(1510, 1720, coast);
  h = lerp(h, -28, o);
  return h;
}

// Heightfield with road flattening. Built once.
export class HeightField {
  constructor() {
    this.n = HF_N + 1;
    this.data = new Float32Array(this.n * this.n);
    this.rd = new Float32Array(this.n * this.n).fill(999); // distance from nearest road edge
  }
  roadDist(x, z) {
    const n = this.n;
    let fx = (x + WORLD_HALF) / HF_CELL, fz = (z + WORLD_HALF) / HF_CELL;
    fx = clamp(fx, 0, n - 1.001); fz = clamp(fz, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const d = this.rd;
    const a = d[j * n + i], b = d[j * n + i + 1], c = d[(j + 1) * n + i], e = d[(j + 1) * n + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
  }
  // true if position is on paved surface
  onRoad(x, z) {
    if (Math.abs(x) < 612 && Math.abs(z) < 612) return true;
    return this.roadDist(x, z) < 0.5;
  }
  build(roads) {
    const n = this.n;
    this.rd.fill(999);
    // spatial hash of road segments
    const CS = 64;
    const grid = new Map();
    const key = (i, j) => i * 100003 + j;
    for (const r of roads) {
      const pts = r.pts;
      const segN = r.closed ? pts.length : pts.length - 1;
      for (let s = 0; s < segN; s++) {
        const a = pts[s], b = pts[(s + 1) % pts.length];
        const minx = Math.floor((Math.min(a.x, b.x) - 50) / CS), maxx = Math.floor((Math.max(a.x, b.x) + 50) / CS);
        const minz = Math.floor((Math.min(a.z, b.z) - 50) / CS), maxz = Math.floor((Math.max(a.z, b.z) + 50) / CS);
        for (let i = minx; i <= maxx; i++) for (let j = minz; j <= maxz; j++) {
          const k = key(i, j);
          let arr = grid.get(k); if (!arr) grid.set(k, (arr = []));
          arr.push({ a, b, hw: r.halfW });
        }
      }
    }
    this.rgrid = grid; this.rkey = key; this.rcs = CS;
    for (let j = 0; j < n; j++) {
      const z = -WORLD_HALF + j * HF_CELL;
      for (let i = 0; i < n; i++) {
        const x = -WORLD_HALF + i * HF_CELL;
        let h = rawHeight(x, z);
        const cdm = Math.max(Math.abs(x), Math.abs(z));
        const arr = grid.get(key(Math.floor(x / CS), Math.floor(z / CS)));
        if (arr) {
          let best = 1e9, bh = 0, minNearH = 1e9;
          for (const s of arr) {
            const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
            const l2 = dx * dx + dz * dz || 1e-6;
            let t = ((x - s.a.x) * dx + (z - s.a.z) * dz) / l2; t = clamp(t, 0, 1);
            const cx = s.a.x + dx * t, cz = s.a.z + dz * t;
            const d = Math.hypot(x - cx, z - cz) - s.hw;
            const sl = Math.sqrt(l2);
            const bo = (-(x - cx) * dz + (z - cz) * dx) / sl;
            const bb = lerp(s.a.bank || 0, s.b.bank || 0, t);
            const sh = lerp(s.a.h, s.b.h, t) + bb * clamp(bo, -s.hw, s.hw);
            if (d < 8 && sh < minNearH) minNearH = sh;
            if (d < best) { best = d; bh = sh; }
          }
          if (minNearH < 1e8 && best < 8) bh = Math.min(bh, minNearH);
          this.rd[j * n + i] = Math.min(best, 999);
          const inCity = cdm <= 612;
          if (!inCity && best < 48) {
            const w = smoothstep(14, 48, best);
            const sub = 0.30 * (1 - smoothstep(0.8, 4.5, best));
            h = lerp(bh - sub, h, w);
          }
        }
        if (cdm <= 612) h = CITY_PLANE;
        this.data[j * n + i] = h;
      }
    }
  }
  get(x, z) {
    const n = this.n;
    let fx = (x + WORLD_HALF) / HF_CELL, fz = (z + WORLD_HALF) / HF_CELL;
    fx = clamp(fx, 0, n - 1.001); fz = clamp(fz, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const d = this.data;
    // match triangle interpolation used by PlaneGeometry (diagonal split)
    const h00 = d[j * n + i], h10 = d[j * n + i + 1], h01 = d[(j + 1) * n + i], h11 = d[(j + 1) * n + i + 1];
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }
  // Height of what the player actually drives on: the road ribbon when over one, otherwise terrain.
  // Terrain cells are 10 m wide so they can't follow a 20 m road exactly; this removes wheels sinking into / floating over the asphalt.
  ground(x, z) {
    let t = this.get(x, z);
    const cd = Math.max(Math.abs(x), Math.abs(z));
    if (cd <= 612) t = Math.max(t, CITY_PLANE);
    const arr = this.rgrid && this.rgrid.get(this.rkey(Math.floor(x / this.rcs), Math.floor(z / this.rcs)));
    if (!arr) return t;
    // Prefer the laterally nearest ribbon only. Taking max height across overlaps (ramps / parallel
    // roads) pinned cars to a higher surface then snapped them down → hopping on the highway.
    let best = 1e9, bh = 0;
    for (const sg of arr) {
      const dx = sg.b.x - sg.a.x, dz = sg.b.z - sg.a.z; const l2 = dx * dx + dz * dz || 1e-6;
      let u = ((x - sg.a.x) * dx + (z - sg.a.z) * dz) / l2; u = u < 0 ? 0 : u > 1 ? 1 : u;
      const px = x - sg.a.x - dx * u, pz = z - sg.a.z - dz * u;
      const d = Math.hypot(px, pz) - sg.hw;
      let sh = sg.a.h + (sg.b.h - sg.a.h) * u;
      const bk = sg.a.bank;
      if (bk !== undefined || sg.b.bank !== undefined) { const o = (-px * dz + pz * dx) / Math.sqrt(l2); sh += ((bk || 0) + ((sg.b.bank || 0) - (bk || 0)) * u) * (o < -sg.hw ? -sg.hw : o > sg.hw ? sg.hw : o); }
      if (d < best) { best = d; bh = sh; }
    }
    if (best > 5.5) return t;
    const roadY = bh + 0.13; // ribbon tops sit at +0.10..0.14
    if (best <= 0.6) return roadY;
    const shoulderY = Math.max(t, bh + 0.06);
    if (best <= 4.0) {
      const k = (best - 0.6) / 3.4;
      return roadY + (shoulderY - roadY) * (k * k * (3 - 2 * k));
    }
    const k = (best - 4.0) / 1.5;
    return shoulderY + (t - shoulderY) * (k * k * (3 - 2 * k));
  }
  normal(x, z, out) {
    const e = 2;
    const hx = this.ground(x + e, z) - this.ground(x - e, z);
    const hz = this.ground(x, z + e) - this.ground(x, z - e);
    out.set(-hx, 2 * e, -hz).normalize();
    return out;
  }
}
