// Real-GPU harness (runs on the Windows PC, inside the logged-in desktop session so Chrome gets the GTX 1650).
// usage: node gpu.mjs <scenario> [outDir]     scenarios: menu | fps | ground | city
// Every scenario goes through the REAL UI (title -> mode -> START) so input, camera and HUD behave exactly like a player's session.
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const scen = process.argv[2] || 'fps', out = process.argv[3] || 'shots'; fs.mkdirSync(out, { recursive: true });
const root = path.resolve('www');
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(root, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream'); fs.createReadStream(f).pipe(r); }).listen(8780);
const br = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 }, protocolTimeout: 180000 });
const pg = await br.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await pg.evaluateOnNewDocument(() => localStorage.setItem('redline-settings', JSON.stringify({ quality: 2, speedFx: true })));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (o) => console.log(JSON.stringify(o));
const t0 = Date.now(); await pg.goto('http://localhost:8780/?noperf'); await pg.waitForFunction('window.__rp', { timeout: 120000 });
say({ boot_ms: Date.now() - t0, gpu: await pg.evaluate(() => { const g = window.__rp.renderer.getContext(); return g.getParameter(g.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL); }) });
const hudVisible = () => pg.evaluate(() => { const e = document.getElementById('hud'); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none'; });

// ---- the real flow: title -> mode -> garage -> START -> wait for GO ----
async function startGame(mode) {
  await sleep(800); await pg.click('#title'); await sleep(1200);
  await pg.click(`[data-mode="${mode}"]`); await sleep(2500);
  await pg.click('#btn-start');
  for (let i = 0; i < 40; i++) { await sleep(500); const st = await pg.evaluate(() => window.__rp.game.state); if (st === 'playing') break; }
  await sleep(600);
  return { hud: await hudVisible(), state: await pg.evaluate(() => window.__rp.game.state) };
}
const place = (roadName, idx, kmh) => pg.evaluate((roadName, idx, kmh) => { const { game, world, rig } = window.__rp; const r = world.net.roads.find((x) => x.name === roadName) || world.net.loop; const p = r.pts[idx], q = r.pts[idx + 2]; game.player.place(p.x, p.z, Math.atan2(q.x - p.x, q.z - p.z), kmh / 3.6); rig.snap = true; }, roadName, idx, kmh);
const stats = () => pg.evaluate(() => { const pl = window.__rp.game.player; return { kmh: Math.round(pl.speed * 3.6), grounded: pl.grounded, y: +pl.pos.y.toFixed(2) }; });

if (scen === 'menu') {
  await sleep(800); await pg.click('#title'); await sleep(1500);
  say(await pg.evaluate(() => ({ modes: [...document.querySelectorAll('.mode b')].map((b) => b.textContent), mp: /multiplayer/i.test(document.body.innerText) })));
  await pg.screenshot({ path: `${out}/menu.png` });
}
if (scen === 'fps') {
  say({ started: await startGame('free') });
  await place('COAST HIGHWAY', 40, 90);
  await pg.evaluate(() => { window.__ft = []; let l = performance.now(); const f = (n) => { window.__ft.push(n - l); l = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await pg.keyboard.down('KeyW'); await sleep(2500); await pg.screenshot({ path: `${out}/fps_a.png` });
  await sleep(5500); await pg.screenshot({ path: `${out}/fps_b.png` });
  const s = await pg.evaluate(() => { const a = window.__ft.slice(30).sort((x, y) => x - y); const avg = a.reduce((x, y) => x + y, 0) / a.length; return { frames: a.length, avg_ms: +avg.toFixed(1), fps: +(1000 / avg).toFixed(1), p95_ms: +a[Math.floor(a.length * 0.95)].toFixed(1), p99_ms: +a[Math.floor(a.length * 0.99)].toFixed(1), worst_ms: +a[a.length - 1].toFixed(1) }; });
  say({ ...s, ...(await stats()) });
}
if (scen === 'ground') {
  // the reported problem area: the very start of the roads. Chase cam at speed, 5 frames in a row on each of 3 spots.
  say({ started: await startGame('free') });
  for (const [road, idx, name] of [['NORTH AVE', 4, 'northave'], ['SOUTH AVE', 4, 'southave'], ['OCEAN BLVD', 6, 'ocean']]) {
    await place(road, idx, 70); await pg.keyboard.down('KeyW'); await sleep(900);
    for (let i = 0; i < 4; i++) { await pg.screenshot({ path: `${out}/ground_${name}_${i}.png` }); await sleep(120); }
    say({ road, ...(await stats()) }); await pg.keyboard.up('KeyW');
  }
}
if (scen === 'city') {
  say({ started: await startGame('free') });
  await pg.evaluate(() => { const { game, world, rig } = window.__rp; game.player.place(130, 240, 3.5, 20); rig.snap = true; });
  await pg.keyboard.down('KeyW'); await sleep(1800); await pg.screenshot({ path: `${out}/city_a.png` }); await sleep(2500); await pg.screenshot({ path: `${out}/city_b.png` }); say(await stats());
}
if (scen === 'cyber' || scen === 'car') {
  // 4th car (Cybertruck): garage turntable, then driving in chase / hood / cockpit-ish cams
  await sleep(800); await pg.click('#title'); await sleep(1200); await pg.click('[data-mode="free"]'); await sleep(2000);
  for (let i = 0; i < (+process.env.CARNEXT || 4); i++) { await pg.click('#car-next'); await sleep(300); }
  say(await pg.evaluate(() => ({ name: document.getElementById('car-name').textContent, idx: document.getElementById('car-idx').textContent })));
  await sleep(1800); await pg.screenshot({ path: `${out}/car_garage_a.png` }); await sleep(4500); await pg.screenshot({ path: `${out}/car_garage_b.png` });
  say(await pg.evaluate(() => { const c = window.__rp.game.cars.find((x) => x.role === 'player'); let t = 0; c.model.root.traverse((o) => { if (o.isMesh) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return { tris: Math.round(t), dims: c.dims, wheels: c.model.wheels.length }; }));
  await pg.click('#btn-start'); for (let i = 0; i < 40; i++) { await sleep(500); if ((await pg.evaluate(() => window.__rp.game.state)) === 'playing') break; }
  await place('COAST HIGHWAY', 40, 60);
  await pg.evaluate(() => { window.__ft = []; let l = performance.now(); const f = (n) => { window.__ft.push(n - l); l = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await pg.keyboard.down('KeyW'); await sleep(2500); await pg.screenshot({ path: `${out}/car_chase.png` });
  await pg.keyboard.press('KeyC'); await sleep(1500); await pg.screenshot({ path: `${out}/car_cam2.png` });
  await pg.keyboard.press('KeyC'); await sleep(1500); await pg.screenshot({ path: `${out}/car_cam3.png` });
  await pg.keyboard.press('KeyC'); await sleep(1500); await pg.screenshot({ path: `${out}/car_cam4.png` });
  const s = await pg.evaluate(() => { const a = window.__ft.slice(20).sort((x, y) => x - y); const avg = a.reduce((x, y) => x + y, 0) / a.length; return { frames: a.length, fps: +(1000 / avg).toFixed(1), p95_ms: +a[Math.floor(a.length * 0.95)].toFixed(1), worst_ms: +a[a.length - 1].toFixed(1) }; });
  say({ ...s, ...(await stats()) });
}
if (scen === 'nitro') {
  // nitro look: free run, hold W + nitro, shots from chase / low rear / front quarter. env NITROCAR picks the car (default 0).
  say({ started: await startGame('free') });
  await place('COAST HIGHWAY', 40, 120);
  await pg.evaluate(() => { const p = window.__rp.game.player; p.nitro = 1; });
  await pg.keyboard.down('KeyW'); await pg.keyboard.down('ShiftLeft'); await sleep(2200);
  await pg.evaluate(() => { const p = window.__rp.game.player; p.nitro = 1; });
  await pg.screenshot({ path: `${out}/nitro_chase.png` }); await sleep(600); await pg.screenshot({ path: `${out}/nitro_chase2.png` });
  await pg.keyboard.press('KeyC'); await sleep(1400); await pg.evaluate(() => { window.__rp.game.player.nitro = 1; }); await pg.screenshot({ path: `${out}/nitro_cam2.png` });
  await pg.keyboard.press('KeyC'); await sleep(1400); await pg.evaluate(() => { window.__rp.game.player.nitro = 1; }); await pg.screenshot({ path: `${out}/nitro_cam3.png` });
  say(await pg.evaluate(() => { const p = window.__rp.game.player; return { nitroActive: p.nitroActive, kmh: Math.round(p.speed * 3.6), nitro: +p.nitro.toFixed(2) }; }));
}
say({ errors: errs.slice(0, 4) }); await br.close(); srv.close();
