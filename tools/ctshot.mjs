// Screenshots the 4th car (Cybertruck) in the garage and driving. usage: node tools/ctshot.mjs [outDir]
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const out = process.argv[2] || 'shots/ct'; fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(0);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 }, protocolTimeout: 280000 });
const pg = await br.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/404|WebSocket/.test(m.text())) errs.push(m.text().slice(0, 140)); });
await pg.goto('http://localhost:' + srv.address().port + '/?noperf'); await pg.waitForFunction('window.__rp', { timeout: 250000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(500); await pg.click('#title'); await sleep(800); await pg.click('[data-mode="free"]'); await sleep(1500);
for (let i = 0; i < 3; i++) { await pg.click('#car-next'); await sleep(250); }
const info = await pg.evaluate(() => ({ name: document.getElementById('car-name').textContent, idx: document.getElementById('car-idx').textContent }));
await sleep(2500); await pg.screenshot({ path: out + '/garage_a.png' }); await sleep(3500); await pg.screenshot({ path: out + '/garage_b.png' });
await pg.evaluate(() => { const g = window.__rp.game; g.start; });
const dims = await pg.evaluate(() => { const c = window.__rp.game.cars.find((x) => x.role === 'player'); const d = c.dims; return { dims: d, tris: (() => { let t = 0; c.model.root.traverse((o) => { if (o.isMesh) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return Math.round(t); })() }; });
await pg.click('#btn-start'); for (let i = 0; i < 40; i++) { await sleep(400); if (await pg.evaluate(() => window.__rp.game.state) === 'playing') break; }
await pg.evaluate(() => { const { game, world, rig } = window.__rp; const r = world.net.roads[0]; const p = r.pts[40], q = r.pts[42]; game.player.place(p.x, p.z, Math.atan2(q.x - p.x, q.z - p.z), 30); rig.snap = true; });
await pg.keyboard.down('KeyW'); await sleep(3500); await pg.screenshot({ path: out + '/drive_chase.png' });
await pg.keyboard.press('KeyC'); await sleep(1200); await pg.screenshot({ path: out + '/drive_cam2.png' });
await pg.keyboard.press('KeyC'); await sleep(1200); await pg.screenshot({ path: out + '/drive_cam3.png' });
const st = await pg.evaluate(() => { const p = window.__rp.game.player; return { kmh: Math.round(p.speed * 3.6), spec: p.spec.id, grounded: p.grounded, wheels: p.model.wheels.length }; });
console.log(JSON.stringify({ info, dims, st, errs: errs.slice(0, 4) })); await br.close(); srv.close();
