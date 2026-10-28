// Real-GPU performance profile (Windows PC). usage: node perf.mjs [label]
// Goes through the real UI, drives at speed on the highway and in the city, and reports fps, frame-time percentiles, draw calls, triangles,
// GPU memory objects and JS heap, plus per-feature cost by toggling expensive features off one at a time.
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const label = process.argv[2] || 'run'; const root = path.resolve(process.env.WWW || 'www');
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(root, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream'); fs.createReadStream(f).pipe(r); }).listen(8781);
const br = process.env.CONNECT ? await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null, protocolTimeout: 240000 }) : await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 }, protocolTimeout: 240000 });
const pg = await br.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
const q = process.env.Q === undefined ? 2 : +process.env.Q;
await pg.evaluateOnNewDocument((q) => localStorage.setItem('redline-settings', JSON.stringify({ quality: q, speedFx: true })), q);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const out = { label, quality: q };
const t0 = Date.now(); await pg.goto('http://localhost:8781/?noperf'); await pg.waitForFunction('window.__rp', { timeout: 120000 }); out.boot_ms = Date.now() - t0;
await sleep(800); await pg.click('#title'); await sleep(1200); await pg.click('[data-mode="free"]'); await sleep(2500); await pg.click('#btn-start');
for (let i = 0; i < 40; i++) { await sleep(500); if ((await pg.evaluate(() => window.__rp.game.state)) === 'playing') break; }
const place = (kind, idx, kmh) => pg.evaluate((kind, idx, kmh) => { const { game, world, rig } = window.__rp; if (kind === 'city') { game.player.place(130, 240, 3.5, kmh / 3.6); } else { const r = world.net.loop, p = r.pts[idx], q2 = r.pts[idx + 2]; game.player.place(p.x, p.z, Math.atan2(q2.x - p.x, q2.z - p.z), kmh / 3.6); } rig.snap = true; }, kind, idx, kmh);
const measure = async (name, ms = 5000) => {
  await pg.evaluate(() => { window.__ft = []; const { renderer } = window.__rp; renderer.info.autoReset = false; renderer.info.reset(); let l = performance.now(); const f = (n) => { window.__ft.push(n - l); l = n; window.__raf = requestAnimationFrame(f); }; window.__raf = requestAnimationFrame(f); });
  await sleep(ms);
  const s = await pg.evaluate(() => { cancelAnimationFrame(window.__raf); const a = window.__ft.slice(15).sort((x, y) => x - y); const avg = a.reduce((x, y) => x + y, 0) / a.length; const { renderer } = window.__rp; const i = renderer.info; const frames = Math.max(1, window.__ft.length); const r = { fps: +(1000 / avg).toFixed(1), avg_ms: +avg.toFixed(1), p95_ms: +a[Math.floor(a.length * 0.95)].toFixed(1), worst_ms: +a[a.length - 1].toFixed(1), calls: Math.round(i.render.calls / frames), tris_k: Math.round(i.render.triangles / frames / 1000), geoms: i.memory.geometries, tex: i.memory.textures, programs: i.programs ? i.programs.length : 0, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }; renderer.info.autoReset = true; return r; });
  out[name] = s;
};
await pg.keyboard.down('KeyW');
await place('hwy', 40, 120); await sleep(1500); await measure('highway');
await place('city', 0, 80); await sleep(1500); await measure('city');
// feature toggles on the city scene (the heaviest): shadows, post, pixel ratio
const toggles = {
  noPost: () => { const { post } = window.__rp; post.composer.passes.forEach((p) => { if (p !== post.composer.passes[0]) p.enabled = false; }); },
  noShadows: () => { const { renderer, world } = window.__rp; world.sunLight.castShadow = false; renderer.shadowMap.needsUpdate = true; },
  halfRes: () => { const { renderer } = window.__rp; renderer.setPixelRatio(0.5); window.dispatchEvent(new Event('resize')); },
};
if (!process.env.QUICK) for (const [k, fn] of Object.entries(toggles)) { await pg.evaluate(fn); await sleep(1200); await measure('city_' + k, 4000); await pg.reload(); await pg.waitForFunction('window.__rp', { timeout: 120000 }); await sleep(800); await pg.click('#title'); await sleep(1200); await pg.click('[data-mode="free"]'); await sleep(2500); await pg.click('#btn-start'); for (let i = 0; i < 40; i++) { await sleep(500); if ((await pg.evaluate(() => window.__rp.game.state)) === 'playing') break; } await pg.keyboard.down('KeyW'); await place('city', 0, 80); await sleep(1500); }
out.errors = errs.slice(0, 3);
fs.writeFileSync(`perf_${label}.json`, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out)); await (process.env.CONNECT ? pg.close() : br.close()); srv.close();
