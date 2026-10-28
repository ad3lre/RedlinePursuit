// For each selectable car: start the real game with it and report the model that actually got built (catches "selected X, got Y").
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(fs.existsSync(path.join(process.cwd(), 'www', 'index.html')) ? path.join(process.cwd(), 'www') : process.cwd(), p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(0);
const GPU = process.argv.includes('--gpu');
const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: GPU ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], protocolTimeout: 240000 });
const pg = await br.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`http://localhost:${srv.address().port}/?noperf`); await pg.waitForFunction('window.__rp', { timeout: 200000 });
const out = await pg.evaluate(() => {
  const { game } = window.__rp; const rows = [];
  const N = window.__rp.cars ? window.__rp.cars.length : 4;
  for (let i = 0; i < 6; i++) for (const mode of ['race', 'cop', 'free']) {
    try { game.start(mode, i); const pl = game.player; rows.push({ pick: i, mode, spec: pl.spec.id || pl.spec.kind, specName: pl.spec.name, carIdx: game.carIdx, wheelsFound: pl.model.wheels.length, L: +pl.dims.L.toFixed(2), glb: !!pl.model.glb, police: pl.police }); } catch (e) { rows.push({ pick: i, mode, error: String(e.message || e) }); }
  }
  return rows;
});
for (const r of out) console.log(JSON.stringify(r));
console.log('errors', JSON.stringify(errs.slice(0, 3))); await br.close(); srv.close();
