// Render the generated environment assets (3 pines, 3 broadleaf, rocks, props) in a studio scene. usage: node tools/envview.mjs out.png
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { build } from 'esbuild';
await build({ stdin: { contents: `
import * as THREE from 'three'; import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'; import { loadEnvAssets, ENV } from '/home/founder/prod/exyno-chat/RedlinePursuit/src/envAssets.js';
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(1500, 700); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace; document.body.append(r.domElement); r.shadowMap.enabled = true;
const sc = new THREE.Scene(); sc.background = new THREE.Color(0x9fb4cc); sc.fog = new THREE.Fog(0x9fb4cc, 40, 160); sc.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xfff0d8, 3); sun.position.set(-20, 30, 15); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 120 }); sc.add(sun);
sc.add(new THREE.HemisphereLight(0xbcd0ee, 0x504030, 0.9));
const g = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x55603a, roughness: 1 })); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; sc.add(g);
(async () => {
await loadEnvAssets();
const add = (geo, mat, x, z, s = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, 0, z); m.scale.setScalar(s); m.castShadow = m.receiveShadow = true; sc.add(m); return m; };
ENV.pines.forEach((v, i) => { add(v.trunk, ENV.pineBark, -22 + i * 7, 0); add(v.foliage, ENV.pineMat, -22 + i * 7, 0); });
ENV.broads.forEach((v, i) => { add(v.trunk, ENV.broadBark, 2 + i * 9, 0); add(v.foliage, ENV.broadMat, 2 + i * 9, 0); });
const prop = (P, x, z, s = 1) => P.parts.forEach((p) => add(p.geo, p.mat, x, z, s));
prop(ENV.rock, -10, 9, 2); prop(ENV.boulder, -6, 9, 2.4); prop(ENV.bin, -1, 9); prop(ENV.barrier, 3, 9); prop(ENV.lamp, 7, 9);
const cam = new THREE.PerspectiveCamera(42, 1500 / 700, 0.1, 400); cam.position.set(-2, 6, 34); cam.lookAt(-2, 5, 0); r.render(sc, cam); window.__done = 'ok';
})().catch((e) => { window.__done = 'ERR ' + e; console.error(e); });
`, resolveDir: process.cwd(), sourcefile: 'envview-entry.js', loader: 'js' }, bundle: true, format: 'iife', outfile: '/tmp/envview.js', loader: { '.glb': 'binary', '.webp': 'dataurl' }, logLevel: 'silent' });
const srv = http.createServer((q, rs) => { const p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') { rs.setHeader('content-type', 'text/html'); return rs.end('<body style="margin:0"><script src="/v.js"></script>'); } rs.setHeader('content-type', 'text/javascript'); fs.createReadStream('/tmp/envview.js').pipe(rs); }).listen(8774);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1500, height: 700 } });
const pg = await br.newPage(); pg.on('pageerror', (e) => console.log('pageerror', e.message)); pg.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await pg.goto('http://localhost:8774/'); await pg.waitForFunction('window.__done', { timeout: 120000 }); await pg.screenshot({ path: process.argv[2] || 'shots/envview.png' }); await br.close(); srv.close(); console.log('done');
