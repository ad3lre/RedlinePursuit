// Steering feel probe: holds a steady speed, applies full / half lock, reports steady yaw rate, lateral g, turn radius and speed lost. No rendering needed.
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(0);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], protocolTimeout: 240000 });
const pg = await br.newPage(); await pg.goto(`http://localhost:${srv.address().port}/?noperf`); await pg.waitForFunction('window.__rp', { timeout: 200000 });
const rows = await pg.evaluate(() => {
  const { game, world } = window.__rp; const out = [];
  for (let ci = 0; ci < 4; ci++) {
    game.start('free', ci); const pl = game.player; pl.collideStatic = () => {}; /* measure the tyre model, not the kerbs */
    for (const sp of [10, 20, 30, 50, 70]) for (const lock of [0, 1]) {
      // flat test patch on the open city plane
      pl.place(0, 0, 0, sp); pl.health = 1; pl.wrecked = false; pl.drifting = false; pl.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 };
      const s0 = pl.speed; let yawSum = 0, n = 0, minV = sp;
      for (let i = 0; i < 270; i++) { // 1.5 s at 180 Hz
        const vF = pl.vF; pl.input.steer = lock; pl.input.throttle = vF < sp ? 1 : 0; pl.input.brake = 0;
        pl.step(1 / 180);
        if (i > 120) { yawSum += Math.abs(pl.angVel); n++; } minV = Math.min(minV, pl.speed);
      }
      const w = yawSum / n, v = pl.speed;
      out.push({ car: pl.spec.id, kmh: Math.round(sp * 3.6), lock, yaw: +w.toFixed(2), latG: +(w * v / 9.81).toFixed(2), radius: Math.round(v / Math.max(w, 0.001)), vEnd: Math.round(v * 3.6) });
    }
  }
  return out;
});
const by = {}; /* lock 0 rows show the straight-line baseline */ for (const r of rows) (by[r.car] ||= []).push(r);
for (const [car, rs] of Object.entries(by)) { console.log('== ' + car); for (const r of rs.filter((r) => r.lock === 1 || r.lock === 0)) console.log(`   lock ${r.lock}`, `  ${String(r.kmh).padStart(4)} km/h full lock: yaw ${r.yaw} rad/s  lat ${r.latG} g  radius ${r.radius} m  (ended ${r.vEnd} km/h)`); }
await br.close(); srv.close();
