// Headless inspector: prints node bboxes of a GLB. usage: node tools/inspect.mjs assets/models/ferrari.glb
import puppeteer from 'puppeteer-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { build } from 'esbuild';
const file = process.argv[2];
await build({ stdin: { contents: `
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
const d = new DRACOLoader(); d.setDecoderPath('/assets/draco/');
const l = new GLTFLoader(); l.setDRACOLoader(d);
l.load('/${file}', (g) => {
  g.scene.updateMatrixWorld(true);
  const out = [];
  const tris = { n: 0 };
  g.scene.traverse((o) => { if (o.isMesh) tris.n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  g.scene.traverse((o) => { if (o.children.length || o.isMesh) { const b = new THREE.Box3().setFromObject(o); const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()); out.push(o.name + ' c=' + [c.x, c.y, c.z].map(v=>v.toFixed(2)) + ' s=' + [s.x, s.y, s.z].map(v=>v.toFixed(2)) + ' pos=' + o.position.toArray().map(v=>v.toFixed(2)) + ' sc=' + o.scale.toArray().map(v=>v.toFixed(3)) + ' q=' + o.quaternion.toArray().map(v=>v.toFixed(2))); } });
  window.__out = { tris: tris.n, lines: out };
}, undefined, (e) => { window.__out = { err: String(e) }; });
`, resolveDir: process.cwd() }, bundle: true, format: 'iife', outfile: '/tmp/inspect.js', logLevel: 'silent' });
const srv = http.createServer((q, r) => { const p = q.url === '/' ? '/__i.html' : decodeURIComponent(q.url.split('?')[0]); if (p === '/__i.html') { r.setHeader('content-type', 'text/html'); return r.end('<script src="/inspect.js"></script>'); } const f = p === '/inspect.js' ? '/tmp/inspect.js' : path.join(process.cwd(), p); if (!fs.existsSync(f)) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'); fs.createReadStream(f).pipe(r); }).listen(8765);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'], headless: 'new' });
const pg = await br.newPage(); await pg.goto('http://localhost:8765/');
await pg.waitForFunction('window.__out', { timeout: 60000 });
const o = await pg.evaluate('window.__out'); console.log(JSON.stringify(o, null, 1)); await br.close(); srv.close();
