import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(d); } }); }).listen(8776);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await br.newPage(); pg.on('pageerror', (e) => console.log('[pageerror]', e.message));
await pg.evaluateOnNewDocument(() => localStorage.setItem('redline-settings', JSON.stringify({ quality: 1 })));
await pg.goto('http://localhost:8776/?noperf&map=tokyo'); await pg.waitForFunction('window.__rp', { timeout: 200000 });
const out = await pg.evaluate(() => {
  const { world } = window.__rp; const res = { map: world.mapId, kids: world.root.children.length, deck: null, groups: 0, tower: null };
  world.root.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.type === 'BoxGeometry' && o.geometry.parameters.width === 1200) res.deck = { pos: o.position.toArray(), vis: o.visible, parent: o.parent === world.root, h: o.geometry.parameters.height, col: o.material.color.getHexString() };
    if (o.isGroup) { res.groups++; const b = new (o.constructor.prototype.constructor === Object ? Object : Object)(); }
  });
  const g = world.root.children.find((o) => o.isGroup && o.children.length > 100);
  if (g) res.tower = { pos: g.position.toArray(), parts: g.children.length };
  return res;
});
console.log(JSON.stringify(out)); await br.close(); srv.close();
