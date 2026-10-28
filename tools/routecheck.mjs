// Audits the race route: builds roads+nav+route exactly like the game and reports backtracking, kinks, gaps, start heading and goal.
import { build } from 'esbuild';
await build({ stdin: { contents: `
import { buildRoads, buildNav, buildRoute } from './src/roads.js';
const net = buildRoads(); const nav = buildNav(net);
const C = (x, z) => nav.cityId(x, z); const L = (d) => nav.loopId((d * Math.PI) / 180);
const pick = (name) => nav.ramps.filter((r) => r.name.startsWith(name)).sort((a, b) => b.loopIndex - a.loopIndex)[0];
const entry = nav.ramps.filter((r) => r.name.startsWith('NORTH AVE')).sort((a, b) => a.loopIndex - b.loopIndex)[0], exit = pick('SOUTH AVE');
const wpsDef = [['C',0,360],['C',0,-600],['E','entry fork'],['E','entry loop'],['L',-115],['L',-135],['L',-160],['L',180],['L',155],['L',130],['L',108],['E','exit loop'],['E','exit fork'],['C',0,600],['C',360,600],['C',360,240],['C',120,240],['C',120,-120],['C',-240,-120],['C',-240,120]];
const E = { 'entry fork': entry.navIds[0], 'entry loop': entry.navIds[entry.navIds.length - 1], 'exit loop': exit.navIds[exit.navIds.length - 1], 'exit fork': exit.navIds[0] };
const wps = wpsDef.map((w) => (w[0] === 'C' ? C(w[1], w[2]) : w[0] === 'E' ? E[w[1]] : L(w[1])));
console.log('entry ramp loopIdx', entry.loopIndex, '| exit ramp loopIdx', exit.loopIndex);

const bad = wps.map((w, i) => [w, i]).filter(([w]) => w === undefined || w === null); if (bad.length) console.log('MISSING waypoint nodes at', bad.map((b) => b[1]).join(','));
// per-leg A*
let total = 0; for (let i = 0; i < wps.length - 1; i++) { const p = nav.astar(wps[i], wps[i + 1]); console.log('leg', i, wpsDef[i].join(':'), '->', wpsDef[i+1].join(':'), p ? p.length + ' nodes' : 'NO PATH'); }
const route = buildRoute(nav, wps); const pts = route.pts;
console.log('route points', pts.length, 'length', Math.round(route.length));
// heading continuity
let back = 0, kinks = [], longSeg = [], dup = 0, maxJump = 0;
for (let i = 1; i < pts.length - 1; i++) {
  const a = pts[i-1], b = pts[i], c = pts[i+1]; const d1 = Math.hypot(b.x-a.x,b.z-a.z), d2 = Math.hypot(c.x-b.x,c.z-b.z);
  if (d1 < 0.01) { dup++; continue; } if (d1 > 25) longSeg.push([i, Math.round(d1)]); maxJump = Math.max(maxJump, d1);
  const dot = ((b.x-a.x)*(c.x-b.x)+(b.z-a.z)*(c.z-b.z)) / (d1*d2 || 1);
  if (dot < -0.2) back++; if (dot < 0.5) kinks.push([i, Math.round(Math.acos(Math.max(-1, dot)) * 57.3), Math.round(b.x), Math.round(b.z)]);
}
console.log('backtracks (>101deg)', back, '| sharp turns (>60deg)', kinks.length, '| dup points', dup, '| max seg', Math.round(maxJump), '| long segs', JSON.stringify(longSeg.slice(0, 6)));
console.log('sharp turns:', JSON.stringify(kinks.slice(0, 14)));
// revisit: does the route cross/overlap itself (circling)?
let revisit = 0; const near = []; for (let i = 0; i < pts.length; i += 3) for (let j = i + 40; j < pts.length; j += 3) if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < 6) { revisit++; if (near.length < 6) near.push([i, j, Math.round(pts[i].x), Math.round(pts[i].z)]); }
console.log('self-overlaps', revisit, JSON.stringify(near));
// start grid heading + goal
for (const d of [22, 34]) { let acc = 0, k = 0; while (k < pts.length - 1 && pts[k+1].d < d) k++; const a = pts[k], b = pts[Math.min(k+3, pts.length-1)]; console.log('at dist', d, 'pos', Math.round(a.x), Math.round(a.z), 'heading deg', Math.round(Math.atan2(b.x-a.x, b.z-a.z) * 57.3)); }
const e = pts[pts.length - 1], f = pts[pts.length - 6]; console.log('goal pos', Math.round(e.x), Math.round(e.z), 'final heading deg', Math.round(Math.atan2(e.x-f.x, e.z-f.z)*57.3), 'start', Math.round(pts[0].x), Math.round(pts[0].z));
// along-route progress sanity: distance from a route point to the ones before it should keep growing for a long time
`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: '/tmp/routecheck.mjs', logLevel: 'silent' });
await import('/tmp/routecheck.mjs');
