// One street-level frame in the city, rendered directly (no menus/post). usage: node tools/cityshot.mjs out.png [x z yawDeg]
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f)) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(8776);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 720 }, protocolTimeout: 240000 });
const pg = await br.newPage(); pg.on('pageerror', (e) => console.log('[pageerror]', e.message));
await pg.evaluateOnNewDocument(() => localStorage.setItem('redline-settings', JSON.stringify({ quality: 1 })));
await pg.goto('http://localhost:8776/?noperf'); await pg.waitForFunction('window.__rp', { timeout: 200000 });
const [x = 130, z = 240, yaw = 200] = process.argv.slice(3).map(Number);
const url = await pg.evaluate((x, z, yaw) => { const { game, world, renderer, scene, camera } = window.__rp; game.start('free', 0); for (let i = 0; i < 3; i++) game.update(1 / 60);
  game.player.place(x, z + 0, yaw * Math.PI / 180, 0); game.update(1 / 60);
  const a = yaw * Math.PI / 180; camera.fov = 60; camera.updateProjectionMatrix(); camera.position.set(x - Math.sin(a) * 7, world.heightAt(x, z) + 2.4, z - Math.cos(a) * 7); camera.lookAt(x + Math.sin(a) * 30, world.heightAt(x, z) + 4, z + Math.cos(a) * 30); camera.updateMatrixWorld();
  world.updateSun(game.player.pos); world.update(0.016, 1); document.querySelectorAll('.screen,#hud').forEach((e) => (e.style.display = 'none'));
  renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); }, x, z, yaw);
fs.writeFileSync(process.argv[2], Buffer.from(url.split(',')[1], 'base64')); await br.close(); srv.close(); console.log('saved');
