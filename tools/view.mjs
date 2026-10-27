// Render a GLB from 3 angles with studio lighting. usage: node tools/view.mjs model.glb out.png [rotY]
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { build } from 'esbuild';
const [file, out, rotY = '0'] = process.argv.slice(2);
await build({ stdin: { contents: `
import * as THREE from 'three'; import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'; import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'; import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'; import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(1500, 500); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace; document.body.append(r.domElement);
const sc = new THREE.Scene(); sc.background = new THREE.Color(0x889099); sc.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(5, 8, 4); sc.add(d);
const g = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 })); g.rotation.x = -Math.PI / 2; sc.add(g);
const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder); const dr = new DRACOLoader(); dr.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/'); l.setDRACOLoader(dr);
l.load('/${file}', (gl) => {
  const m = gl.scene; m.rotation.y = ${rotY} * Math.PI / 180; sc.add(m); m.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(m); const c = b.getCenter(new THREE.Vector3()); const s = b.getSize(new THREE.Vector3()); const R = Math.max(s.x, s.z) * 1.15;
  const views = [[0.9, 0.35, 0.8], [-1, 0.25, 0.2], [0.1, 0.3, -1]];
  r.setScissorTest(true);
  views.forEach((v, i) => { const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100); cam.position.set(c.x + v[0] * R * 1.5, b.min.y + s.y * 0.5 + v[1] * R, c.z + v[2] * R * 1.5); cam.lookAt(c.x, b.min.y + s.y * 0.4, c.z); r.setViewport(i * 500, 0, 500, 500); r.setScissor(i * 500, 0, 500, 500); r.render(sc, cam); });
  window.__done = JSON.stringify({ size: [s.x, s.y, s.z].map((x) => +x.toFixed(2)), minY: +b.min.y.toFixed(2) });
}, undefined, (e) => { window.__done = 'ERR ' + e; });
`, resolveDir: process.cwd() }, bundle: true, format: 'iife', outfile: '/tmp/view.js', logLevel: 'silent' });
const srv = http.createServer((q, rs) => { const p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') { rs.setHeader('content-type', 'text/html'); return rs.end('<body style="margin:0"><script src="/view.js"></script>'); } const f = p === '/view.js' ? '/tmp/view.js' : path.join(process.cwd(), p); if (!fs.existsSync(f)) { rs.statusCode = 404; return rs.end(); } rs.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); fs.createReadStream(f).pipe(rs); }).listen(8770);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1500, height: 500 } });
const pg = await br.newPage(); await pg.goto('http://localhost:8770/'); await pg.waitForFunction('window.__done', { timeout: 90000 });
console.log(await pg.evaluate('window.__done')); await pg.screenshot({ path: out }); await br.close(); srv.close();
