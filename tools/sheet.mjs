// Contact sheet: render several GLBs side by side (3/4 front view, nose should point toward camera-right-front). usage: node tools/sheet.mjs out.png a.glb b.glb ...
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { build } from 'esbuild';
const [out, ...files] = process.argv.slice(2);
await build({ stdin: { contents: `
import * as THREE from 'three'; import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'; import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'; import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
const files = ${JSON.stringify(files)}; const W = 360, H = 300, cols = 4; const rows = Math.ceil(files.length / cols);
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(W * cols, H * rows); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace; document.body.append(r.domElement); r.setScissorTest(true);
const sc = new THREE.Scene(); sc.background = new THREE.Color(0x7a838c); sc.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(5, 8, 4); sc.add(d); const g = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x333333 })); g.rotation.x = -Math.PI / 2; sc.add(g);
const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder); let done = 0; const meta = [];
files.forEach((f, i) => l.load('/' + f, (gl) => {
  const m = gl.scene; const b = new THREE.Box3().setFromObject(m); const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  // arrow marking +Z (game forward)
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 8), new THREE.MeshBasicMaterial({ color: 0xff2200 })); arrow.rotation.x = Math.PI / 2; arrow.position.set(0, 0.05, s.z / 2 + 0.5); 
  const holder = new THREE.Group(); holder.add(m, arrow); sc.add(holder); holder.visible = false;
  const col = i % cols, row = rows - 1 - Math.floor(i / cols); meta[i] = { holder, c, s, col, row, f, wheels: [] };
  m.traverse((o) => { if (/^wheel_/.test(o.name)) meta[i].wheels.push(o.name); });
  if (++done === files.length) { meta.forEach((q) => { meta.forEach((o) => o.holder.visible = false); q.holder.visible = true; const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100); const R = Math.max(q.s.x, q.s.z, q.s.y * 0.8) * 1.9; cam.position.set(q.c.x + R * 0.75, q.s.y * 0.7, q.c.z + R * 0.75); cam.lookAt(q.c.x, q.s.y * 0.45, q.c.z); r.setViewport(q.col * W, q.row * H, W, H); r.setScissor(q.col * W, q.row * H, W, H); r.render(sc, cam); }); window.__done = JSON.stringify(meta.map((q) => q.f.split('/').pop() + ' ' + q.s.x.toFixed(2) + 'x' + q.s.y.toFixed(2) + 'x' + q.s.z.toFixed(2) + ' wheels:' + q.wheels.join(','))); }
}, undefined, (e) => { window.__done = 'ERR ' + f + e; }));
`, resolveDir: process.cwd() }, bundle: true, format: 'iife', outfile: '/tmp/sheet.js', logLevel: 'silent' });
const srv = http.createServer((q, rs) => { const p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') { rs.setHeader('content-type', 'text/html'); return rs.end('<body style="margin:0"><script src="/sheet.js"></script>'); } const f = p === '/sheet.js' ? '/tmp/sheet.js' : path.join(process.cwd(), p); if (!fs.existsSync(f)) { rs.statusCode = 404; return rs.end(); } rs.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); fs.createReadStream(f).pipe(rs); }).listen(8773);
const cols = 4, W = 360, H = 300, rows = Math.ceil(files.length / cols);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: W * cols, height: H * rows } });
const pg = await br.newPage(); pg.on('pageerror', (e) => console.log('pageerror', e.message)); await pg.goto('http://localhost:8773/'); await pg.waitForFunction('window.__done', { timeout: 120000 });
console.log((await pg.evaluate('window.__done')).replace(/","/g, '\n')); await pg.screenshot({ path: out }); await br.close(); srv.close();
