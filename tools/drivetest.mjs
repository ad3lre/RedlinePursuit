// Headless physics soak test: autopilots the player over every road and reports wall hits, airtime, stuck time, wheel-vs-ground error.
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const p = q.url === '/' ? '/index.html' : decodeURIComponent(q.url.split('?')[0]); const f = path.join(process.cwd(), p); if (!fs.existsSync(f)) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(8767);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await br.newPage(); pg.on('pageerror', (e) => console.log('pageerror', e.message));
await pg.goto('http://localhost:8767/'); await pg.waitForFunction('window.__rp', { timeout: 150000 });
const QUICK = !process.argv.includes('--full'); // default: 3 roads (highway + tightest connector + a ramp). --full = all 19, only for the final check
const res = await pg.evaluate(async (QUICK) => {
  const { game, world } = window.__rp;
  game.start('free', 0); for (let i = 0; i < 5; i++) game.update(1 / 60);
  game.state = 'play'; const pl = game.player; const out = [];
  let roads = world.net.roads;
  if (QUICK) roads = [roads[0], roads.find((r) => r.name === 'CANYON ROAD' && r.kind === 'conn'), roads.find((r) => r.kind === 'ramp')]; // highway + tightest connector + one ramp
  for (const r of roads) {
    const pts = r.pts; const stats = { name: r.name + ' ' + r.kind, hits: 0, stuck: 0, air: 0, maxGap: 0, steps: 0, maxOff: 0 };
    const a = pts[2], b = pts[3]; pl.place(a.x, a.z, Math.atan2(b.x - a.x, b.z - a.z), 25); pl.health = 1; pl.wrecked = false;
    let idx = 2, lowSpeed = 0, prev = game.onImpact; let impacts = 0; game.onImpact = (...args) => { impacts++; return prev.apply(game, args); };
    const maxT = 60 * 120; let t = 0;
    while (idx < pts.length - 4 && t++ < maxT) {
      // pure pursuit on the polyline
      let look = Math.min(pts.length - 1, idx + 4); const tg = pts[look];
      const dx = tg.x - pl.pos.x, dz = tg.z - pl.pos.z; let da = Math.atan2(dx, dz) - pl.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
      pl.input.steer = Math.max(-1, Math.min(1, da * 2.2)); pl.input.throttle = pl.speed < 30 ? 1 : 0.2; pl.input.brake = 0; pl.input.nitro = 0; pl.input.handbrake = 0;
      for (let s = 0; s < 3; s++) { pl.step(1 / 180); game.carCollisions(); }
      while (idx < pts.length - 1 && Math.hypot(pts[idx].x - pl.pos.x, pts[idx].z - pl.pos.z) < 12) idx++;
      const g = world.heightAt(pl.pos.x, pl.pos.z) + 0.17; stats.maxGap = Math.max(stats.maxGap, Math.abs(pl.pos.y - g)); if (!pl.grounded) { stats.air++; if (!stats.airAt) { const gg = world.heightAt(pl.pos.x, pl.pos.z) + 0.17; const seg = pts[Math.max(0, idx - 1)]; stats.airAt = idx + '/' + pts.length + ' y-g=' + (pl.pos.y - gg).toFixed(2) + ' vy=' + pl.vy.toFixed(1) + ' off=' + Math.hypot(pl.pos.x - seg.x, pl.pos.z - seg.z).toFixed(1) + ' roadDist=' + world.hf.roadDist(pl.pos.x, pl.pos.z).toFixed(1) + ' prevG=' + (pl.prevG ?? 0).toFixed(2) + ' g=' + gg.toFixed(2) + ' h=' + pts[idx].h.toFixed(1) + ' v=' + pl.speed.toFixed(0); } }
      const off = Math.hypot(pl.pos.x - pts[Math.max(0, idx - 1)].x, pl.pos.z - pts[Math.max(0, idx - 1)].z); stats.maxOff = Math.max(stats.maxOff, off);
      if (pl.speed < 3) lowSpeed++; stats.steps++;
    }
    game.onImpact = prev; stats.hits = impacts; stats.stuck = +(lowSpeed / 120).toFixed(1); stats.reached = idx + '/' + pts.length; stats.timedOut = t >= maxT; stats.maxGap = +stats.maxGap.toFixed(2); stats.maxOff = +stats.maxOff.toFixed(1); stats.air = +(stats.air / 120).toFixed(1); out.push(stats);
  }
  return out;
}, QUICK);
for (const s of res) console.log(`${s.name.padEnd(26)} reached ${s.reached.padEnd(7)} impacts=${s.hits} stuck=${s.stuck}s air=${s.air}s maxGroundGap=${s.maxGap} maxOffRoad=${s.maxOff}${s.airAt ? ' airAt=' + s.airAt : ''}${s.timedOut ? ' TIMEOUT' : ''}`);
await br.close(); srv.close();
