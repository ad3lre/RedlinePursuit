// Real-UI driving capture: enters Free Run through the menus, then holds W at speed and grabs frames. usage: node tools/motion.mjs prefix
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const pre = process.argv[2] || 'shots/m';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f)) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(8772);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 720 } });
const pg = await br.newPage(); pg.on('pageerror', (e) => console.log('[pageerror]', e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('[console]', m.text().slice(0, 200)); });
await pg.evaluateOnNewDocument(() => localStorage.setItem('redline-settings', JSON.stringify({ quality: 2, speedFx: true })));
await pg.goto('http://localhost:8772/?noperf'); await pg.waitForFunction('window.__rp', { timeout: 150000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(800); await pg.click('#title'); await sleep(1200); await pg.click('[data-mode="free"]'); await sleep(2500); await pg.click('#btn-start'); await sleep(3000);
await pg.evaluate(() => { const { game, world, rig } = window.__rp; game.state = 'playing'; const p = world.net.loop.pts[10], q = world.net.loop.pts[12]; game.player.place(p.x, p.z, Math.atan2(q.x - p.x, q.z - p.z), 64); rig.snap = true; });
await pg.keyboard.down('KeyW'); await sleep(6000);
await pg.screenshot({ path: `${pre}_straight.png` });
await pg.keyboard.down('Space'); await pg.keyboard.down('KeyA'); await sleep(2500);
await pg.screenshot({ path: `${pre}_corner.png` });
console.log(await pg.evaluate(() => { const { game, post } = window.__rp; const pl = game.player; return JSON.stringify({ quality: window.__rp.settings.quality, mbEnabled: post.mb.enabled, kmh: Math.round(pl.speed * 3.6), roll: +pl.susp.r.toFixed(3), pitch: +pl.susp.p.toFixed(3), mb: post.mb.strength, state: game.state }); }));
await br.close(); srv.close();
