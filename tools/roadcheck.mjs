// Headless road-network audit: finds where different roads overlap and how badly their heights disagree.
import { build } from 'esbuild';
await build({ stdin: { contents: `
import { buildRoads } from './src/roads.js';
import { HeightField } from './src/terrain.js';
const net = buildRoads();
const out = { roads: net.roads.map(r => r.name + ' ' + r.kind + ' pts=' + r.pts.length), issues: [] };
const R = net.roads;
for (let a = 0; a < R.length; a++) for (let b = a + 1; b < R.length; b++) {
  const A = R[a], B = R[b]; let worst = null, n = 0;
  for (let i = 0; i < A.pts.length; i++) {
    const p = A.pts[i];
    for (let j = 0; j < B.pts.length; j++) {
      const q = B.pts[j]; const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < Math.min(A.halfW, B.halfW) + 2) { const dh = Math.abs(p.h - q.h); n++; if (!worst || dh > worst.dh) worst = { dh, d, ai: i, bj: j, ha: p.h, hb: q.h }; }
    }
  }
  if (n) out.issues.push(A.name + ' x ' + B.name + ' overlapPairs=' + n + ' worstDH=' + worst.dh.toFixed(2) + ' dist=' + worst.d.toFixed(1) + ' hA=' + worst.ha.toFixed(1) + ' hB=' + worst.hb.toFixed(1));
}
// heightfield vs ribbon height mismatch on every road centreline point
const hf = new HeightField(); hf.build(R); let bad = 0, maxE = 0, tot = 0;
for (const r of R) for (const p of r.pts) { const e = Math.abs(hf.ground(p.x, p.z) - p.h - 0.12); tot++; if (e > 0.3) bad++; if (e > maxE) maxE = e; }
out.hfMismatch = { total: tot, over30cm: bad, maxErr: +maxE.toFixed(2) };
// slope between consecutive points (steepness)
let steep = 0, maxS = 0; for (const r of R) for (let i = 1; i < r.pts.length; i++) { const s = Math.abs(r.pts[i].h - r.pts[i-1].h) / 10; if (s > 0.12) steep++; if (s > maxS) maxS = s; }
out.slope = { over12pct: steep, max: +maxS.toFixed(3) };
out.steepRoads = []; for (const r of R) { let m = 0, at = 0; for (let i = 1; i < r.pts.length; i++) { const s2 = Math.abs(r.pts[i].h - r.pts[i-1].h) / Math.hypot(r.pts[i].x-r.pts[i-1].x, r.pts[i].z-r.pts[i-1].z); if (s2 > m) { m = s2; at = i; } } let crest = 0; for (let i = 1; i < r.pts.length - 1; i++) { const c = (r.pts[i-1].h - 2*r.pts[i].h + r.pts[i+1].h); crest = Math.max(crest, Math.abs(c)); } if (m > 0.1 || crest > 0.8) out.steepRoads.push(r.name + ' ' + r.kind + ' maxGrade=' + (m*100).toFixed(0) + '% at ' + at + '/' + r.pts.length + ' maxCurvature=' + crest.toFixed(2)); }
// minimum turn radius per road (circumradius of 3 consecutive points) vs half-width: radius < halfW folds the ribbon over itself
out.tight = [];
for (const r of R) { let min = 1e9, at = -1; const n = r.pts.length; for (let i = 1; i < n - 1; i++) { const a = r.pts[i-1], b = r.pts[i], c = r.pts[i+1]; const ab = Math.hypot(b.x-a.x,b.z-a.z), bc = Math.hypot(c.x-b.x,c.z-b.z), ca = Math.hypot(a.x-c.x,a.z-c.z); const area2 = Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x)); const rad = area2 < 1e-6 ? 1e9 : ab*bc*ca/(2*area2); if (rad < min) { min = rad; at = i; } } if (min < r.halfW * 3) out.tight.push(r.name + ' ' + r.kind + ' minRadius=' + min.toFixed(1) + ' halfW=' + r.halfW + ' at idx ' + at + '/' + n); }
console.log(JSON.stringify(out, null, 1));
`, resolveDir: process.cwd(), loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile: '/tmp/roadcheck.mjs', logLevel: 'silent' });
await import('/tmp/roadcheck.mjs');
