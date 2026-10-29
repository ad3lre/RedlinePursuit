// Renders a car in-game from 3 angles + reports world-space size / wheel positions. usage: node tools/jeskoshot.mjs prefix carIdx
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(0);
const PORT = srv.address().port;
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await br.newPage(); pg.on('pageerror', (e) => console.log('[pageerror]', e.message)); pg.on('console', (m) => { if (/error|warn/i.test(m.type())) console.log('[console]', m.text().slice(0, 160)); });
await pg.evaluateOnNewDocument(() => localStorage.setItem('redline-settings', JSON.stringify({ quality: 1 })));
await pg.goto(`http://localhost:${PORT}/?noperf&map=coast`); await pg.waitForFunction('window.__rp', { timeout: 200000 });
const prefix = process.argv[2], carIdx = +process.argv[3];
const info = await pg.evaluate((carIdx) => {
  const { game, world, renderer, scene, camera } = window.__rp;
  game.start('free', carIdx); for (let i = 0; i < 3; i++) game.update(1 / 60);
  const pl = game.player; pl.place(0, 40, 0, 0); game.update(1 / 60);
  const root = pl.model.root; root.updateMatrixWorld(true);
  const box = new (root.constructor.prototype.constructor === Object ? Object : Object)();
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; let tris = 0, meshes = 0;
  root.traverse((o) => { if (o.isMesh && o.visible && o.geometry && o.geometry.attributes.position) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; const g = o.geometry; g.computeBoundingBox(); const b = g.boundingBox, m = o.matrixWorld.elements; for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const w = [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]]; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); } } } });
  const wheels = pl.model.wheels.map((w) => ({ front: w.front, side: w.side, x: +w.pivot.position.x.toFixed(2), y: +w.pivot.position.y.toFixed(2), z: +w.pivot.position.z.toFixed(2) }));
  return { name: pl.name, dims: pl.dims, size: hi.map((v, k) => +(v - lo[k]).toFixed(2)), min: lo.map((v) => +v.toFixed(2)), meshes, tris: Math.round(tris), wheels };
}, carIdx);
console.log(JSON.stringify(info));
for (const [i, yaw] of [[0, 35], [1, 145], [2, 270]].map((a) => a)) {
  const url = await pg.evaluate((yaw) => {
    const { game, world, renderer, scene, camera } = window.__rp; const pl = game.player; const a = yaw * Math.PI / 180;
    camera.fov = 38; camera.updateProjectionMatrix(); camera.position.set(pl.pos.x + Math.sin(a) * 7.5, pl.pos.y + 1.5, pl.pos.z + Math.cos(a) * 7.5); camera.lookAt(pl.pos.x, pl.pos.y + 0.45, pl.pos.z);
    world.updateSun(pl.pos); world.update(0.016, 1); document.querySelectorAll('.screen,#hud').forEach((e) => (e.style.display = 'none'));
    renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); }, yaw);
  fs.writeFileSync(`${prefix}_${i}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
await br.close(); srv.close(); console.log('saved');
