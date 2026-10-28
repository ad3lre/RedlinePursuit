// Triangle / draw-call cost by object group in the live scene (no rendering needed). Writes shots/scenecost.txt
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(0);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], protocolTimeout: 240000 });
const pg = await br.newPage(); await pg.goto(`http://localhost:${srv.address().port}/?noperf`); await pg.waitForFunction('window.__rp', { timeout: 200000 });
const mode = process.argv[2] || 'race';
const rows = await pg.evaluate((mode) => {
  const { game, scene, world, camera } = window.__rp; game.start(mode, 0); game.countdown = 0.01; for (let i = 0; i < 90; i++) game.update(1 / 60); const pc = game.cars.find((c) => c.role === "player"); const fp = (pc.pos || pc.position || pc.model.root.position); window.__rp.world.updateSun(fp); window.__rp.world.update(1 / 60, 1);
  const carOf = new Map(); for (const c of game.cars) c.model.root.traverse((o) => carOf.set(o, c));
  const groups = {}; let total = 0, calls = 0; const add = (k, t) => { (groups[k] ||= { tris: 0, calls: 0 }); groups[k].tris += t; groups[k].calls++; total += t; calls++; };
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return; const g = o.geometry; const tri = (g.index ? g.index.count : g.attributes.position.count) / 3; const n = o.isInstancedMesh ? o.count : 1; const t = tri * n;
    const car = carOf.get(o);
    if (car) { const lod = car.model.glb ? (car.role === 'player' ? 'hi' : (car.spec.model || car.spec.kind)) : 'procedural'; add(`car:${car.role}:${car.model.glbCfgName || car.spec.id || car.spec.kind}`, t); return; }
    let k = o.isInstancedMesh ? `instanced:${(o.material && o.material.name) || (o.material && o.material.map ? 'textured' : o.material && o.material.type)}:${o.count}` : `mesh:${o.name || (o.material && o.material.type)}`;
    add(k, t);
  });
  const carsByRole = {}; for (const c of game.cars) carsByRole[c.role] = (carsByRole[c.role] || 0) + 1;
  return { total: Math.round(total), calls, carsByRole, groups: Object.entries(groups).map(([k, v]) => [k, Math.round(v.tris), v.calls]).sort((a, b) => b[1] - a[1]).slice(0, 28), shadowCasters: (() => { let t = 0; scene.traverse((o) => { if (o.isMesh && o.castShadow && o.visible) { const g = o.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } }); return Math.round(t); })() };
}, mode);
let txt = `mode ${mode}: scene triangles ${rows.total} (before frustum culling), meshes ${rows.calls}, shadow-casting tris ${rows.shadowCasters}, cars ${JSON.stringify(rows.carsByRole)}\n`;
for (const [k, t, c] of rows.groups) txt += `${String(t).padStart(9)} tris  ${String(c).padStart(4)} meshes  ${k}\n`;
fs.writeFileSync('shots/scenecost.txt', txt); await br.close(); srv.close();
