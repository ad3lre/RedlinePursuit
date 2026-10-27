// Screenshot every garage car (and the police variant). usage: node tools/garage.mjs prefix
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const pre = process.argv[2] || '/tmp/g';
const srv = http.createServer((q, r) => { const p = q.url === '/' ? '/index.html' : decodeURIComponent(q.url.split('?')[0]); const f = path.join(process.cwd(), p); if (!fs.existsSync(f)) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream'); fs.createReadStream(f).pipe(r); }).listen(8771);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const pg = await br.newPage(); pg.on('pageerror', (e) => console.log('[pageerror]', e.message)); pg.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
await pg.goto('http://localhost:8771/'); await pg.waitForFunction('window.__rp', { timeout: 150000 });
await new Promise((r) => setTimeout(r, 1000)); await pg.click('#title'); await new Promise((r) => setTimeout(r, 1500));
await pg.click('[data-mode="race"]'); await new Promise((r) => setTimeout(r, 3500));
for (let i = 0; i < 2; i++) { await pg.screenshot({ path: `${pre}_car${i}.png` }); await pg.click('#car-next'); await new Promise((r) => setTimeout(r, 3500)); }
await br.close(); srv.close(); console.log('done');
