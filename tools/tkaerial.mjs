// usage: node tools/tkaerial.mjs out.png camX camY camZ lookX lookY lookZ
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(d); } }); }).listen(8776);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await br.newPage(); pg.on('pageerror', (e) => console.log('[pageerror]', e.message));
await pg.evaluateOnNewDocument(() => localStorage.setItem('redline-settings', JSON.stringify({ quality: 1 })));
await pg.goto('http://localhost:8776/?noperf&map=tokyo'); await pg.waitForFunction('window.__rp', { timeout: 200000 });
const [cx, cy, cz, lx, ly, lz] = process.argv.slice(3).map(Number);
const url = await pg.evaluate((cx, cy, cz, lx, ly, lz) => { const { game, world, renderer, scene, camera } = window.__rp; game.start('free', 0); for (let i = 0; i < 3; i++) game.update(1 / 60);
  game.player.place(cx, cz, 0, 0); game.update(1 / 60);
  camera.fov = 60; camera.far = 14000; camera.updateProjectionMatrix(); camera.position.set(cx, cy, cz); camera.lookAt(lx, ly, lz);
  world.updateSun(game.player.pos); world.update(0.016, 1); document.querySelectorAll('.screen,#hud').forEach((e) => (e.style.display = 'none'));
  game.player.pos.set(1e5, 0, 1e5); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); }, cx, cy, cz, lx, ly, lz);
fs.writeFileSync(process.argv[2], Buffer.from(url.split(',')[1], 'base64')); await br.close(); srv.close(); console.log('saved');
