// For every car model: per-wheel part geometry relative to the spin origin. A clean wheel has every part centred on the axle (x offset only along the axle) and a thin X axis.
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(0);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], protocolTimeout: 240000 });
const pg = await br.newPage(); await pg.goto(`http://localhost:${srv.address().port}/?noperf`); await pg.waitForFunction('window.__rp', { timeout: 200000 });
const rows = await pg.evaluate(() => {
  const { game } = window.__rp; const out = [];
  const T = (window.__rp.THREE) || null;
  for (let ci = 0; ci < 5; ci++) {
    game.start('free', ci); const m = game.player.model; const w = m.wheels[0];
    const parts = []; w.spin.children.forEach((c) => { if (!c.geometry) return; c.geometry.computeBoundingBox(); const b = c.geometry.boundingBox; parts.push({ mat: c.material.name || c.material.type, cx: +((b.min.x + b.max.x) / 2).toFixed(3), cy: +((b.min.y + b.max.y) / 2).toFixed(3), cz: +((b.min.z + b.max.z) / 2).toFixed(3), sx: +(b.max.x - b.min.x).toFixed(3), sy: +(b.max.y - b.min.y).toFixed(3), sz: +(b.max.z - b.min.z).toFixed(3), tris: (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3 | 0 }); });
    out.push({ car: game.player.spec.id, wheelR: +m.dims.wheelR.toFixed(3), pivotPos: [w.pivot.position.x, w.pivot.position.y, w.pivot.position.z].map((v) => +v.toFixed(3)), spinPos: [w.spin.position.x, w.spin.position.y, w.spin.position.z].map((v) => +v.toFixed(3)), blur: !!w.blur, parts });
  }
  return out;
});
fs.writeFileSync('shots/wheelcheck.json', JSON.stringify(rows, null, 1));
let txt = '';
for (const r of rows) { txt += `== ${r.car} wheelR ${r.wheelR} pivot ${r.pivotPos} spin ${r.spinPos}\n`; for (const p of r.parts) txt += `   ${String(p.mat).slice(0, 18).padEnd(18)} centre(${p.cx},${p.cy},${p.cz}) size(${p.sx},${p.sy},${p.sz}) tris ${p.tris}${(Math.abs(p.cy) > 0.02 || Math.abs(p.cz) > 0.02) ? '  <-- OFF-AXIS' : ''}${(p.sx > p.sy * 0.9 && p.sx > 0.2) ? '  <-- axis not X?' : ''}\n`; }
fs.writeFileSync('shots/wheelcheck.txt', txt); await br.close(); srv.close();
