// Steering feel probe: holds a steady speed, applies full / half lock, reports steady yaw rate, lateral g, turn radius and speed lost. No rendering needed.
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(0);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], protocolTimeout: 240000 });
const pg = await br.newPage(); await pg.goto(`http://localhost:${srv.address().port}/?noperf`); await pg.waitForFunction('window.__rp', { timeout: 200000 });
const rows = await pg.evaluate(() => {
  const { game } = window.__rp; const out = [];
  for (const ci of [0, 3]) { game.start('free', ci); const pl = game.player; pl.collideStatic = () => {};
    for (const sp of [15, 30, 50]) {
      pl.place(0, 0, 0, sp); pl.health = 1; pl.wrecked = false; pl.drifting = false; pl.holdT = 0; pl.holdDir = 0; pl.input = { throttle: 0, brake: 0, steer: 1, handbrake: 0, nitro: 0 };
      const r = []; for (let i = 1; i <= 270; i++) { pl.input.throttle = pl.vF < sp ? 1 : 0; pl.step(1 / 180); if ([18, 54, 108, 162, 270].includes(i)) r.push(`${(i / 180).toFixed(1)}s yaw ${Math.abs(pl.angVel).toFixed(2)} lat ${(Math.abs(pl.angVel) * pl.speed / 9.81).toFixed(2)}g slip ${pl.slip.toFixed(2)}`); }
      out.push(`${pl.spec.id} ${Math.round(sp * 3.6)}km/h | ` + r.join(' | '));
    } }
  return out;
});
for (const r of rows) console.log(r);
await br.close(); srv.close();
