// Headless screenshots of the real game. usage: node tools/shot.mjs outPrefix
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const pre = process.argv[2] || '/tmp/shot';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f)) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream'); fs.createReadStream(f).pipe(r); }).listen(8766);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const pg = await br.newPage();
pg.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[console]', m.text().slice(0, 300)); });
pg.on('pageerror', (e) => console.log('[pageerror]', e.message));
await pg.evaluateOnNewDocument(() => localStorage.setItem('redline-settings', JSON.stringify({ quality: 2 })));
await pg.goto('http://localhost:8766/?noperf');
await pg.waitForFunction('window.__rp', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));
await pg.screenshot({ path: pre + '_0title.png' });
await pg.click('#title'); await new Promise((r) => setTimeout(r, 1500));
await pg.click('[data-mode="race"]'); await new Promise((r) => setTimeout(r, 4000));
await pg.screenshot({ path: pre + '_1garage.png' });
await pg.click('#btn-start'); await new Promise((r) => setTimeout(r, 9000));
await pg.screenshot({ path: pre + '_2race.png' });
await pg.keyboard.down('KeyW'); await new Promise((r) => setTimeout(r, 4000));
await pg.screenshot({ path: pre + '_3drive.png' });
for (let i = 0; i < 2; i++) { await pg.keyboard.press('KeyC'); await new Promise((r) => setTimeout(r, 600)); }
await pg.screenshot({ path: pre + '_4cockpit.png' });
await br.close(); srv.close();
