// Controller test: injects a fake standard gamepad into the real game (navigator.getGamepads override) and drives it through the real UI.
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(0);
const PORT = srv.address().port;
const GPU = process.argv.includes('--gpu');
const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: GPU ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], protocolTimeout: 240000, defaultViewport: { width: 1280, height: 720 } });
const pg = await br.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.evaluateOnNewDocument(() => {
  window.__pad = { id: 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)', mapping: 'standard', connected: true, index: 0, timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), rumbles: [], vibrationActuator: { playEffect(t, o) { window.__pad.rumbles.push(o); return Promise.resolve('complete'); }, reset() {} } };
  navigator.getGamepads = () => [window.__pad, null, null, null];
  window.__btn = (i, v = 1) => { const b = window.__pad.buttons[i]; b.pressed = v > 0.5; b.value = v; b.touched = v > 0; };
  localStorage.setItem('redline-settings', JSON.stringify({ quality: 1 }));
});
const results = []; const check = (n, ok, i = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', n, i); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n) => pg.evaluate((n) => new Promise((r) => { let c = 0; const f = () => (++c >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const tap = async (i) => { await pg.evaluate((i) => window.__btn(i, 1), i); await frames(4); await pg.evaluate((i) => window.__btn(i, 0), i); await frames(4); };
await pg.goto(`http://localhost:${PORT}/?noperf`); await pg.waitForFunction('window.__rp', { timeout: 200000 });
await sleep(800);
check('pad detected', await pg.evaluate(() => window.__rp.input.padCount === 1 || (window.__rp.input.pollPad(), window.__rp.input.padCount === 1)));
// title: A starts, menu: navigate down with the D-pad and confirm with A, garage: A starts
await tap(0, 200); await frames(10);
check('A leaves the title screen', await pg.evaluate(() => !document.getElementById('menu').classList.contains('hidden')));
await tap(13); await tap(0); await frames(20);
check('D-pad down + A opens a mode (garage)', await pg.evaluate(() => !document.getElementById('garage').classList.contains('hidden')));
const idx0 = await pg.evaluate(() => document.getElementById('car-idx').textContent);
await tap(15); await frames(8);
const idx1 = await pg.evaluate(() => document.getElementById('car-idx').textContent);
check('D-pad right changes car', idx0 !== idx1, idx0 + ' -> ' + idx1);
await tap(0); await frames(30);
const st = await pg.evaluate(() => ({ app: window.__rp.game.state, hud: !document.getElementById('hud').classList.contains('hidden') }));
console.log('after START:', JSON.stringify(st));
// in-game: force playing and test driving inputs
await pg.evaluate(() => { const g = window.__rp.game; g.countdown = 0.01; });
await sleep(4500);
await pg.evaluate(() => { window.__btn(7, 1); window.__pad.axes[0] = -0.8; });
await frames(180);
const drive = await pg.evaluate(() => { const g = window.__rp.game, d = window.__rp.input.drive(0.016); return { kmh: Math.round(g.player.speed * 3.6), throttle: d.throttle, steer: +d.steer.toFixed(2), state: g.state }; });
console.log('driving:', JSON.stringify(drive));
check('RT = throttle, car accelerates', drive.throttle > 0.9 && drive.kmh > 20);
check('left stick left = steer left (positive)', drive.steer > 0.3);
// right stick look
const before = await pg.evaluate(() => window.__rp.rig.lookYaw);
await pg.evaluate(() => { window.__pad.axes[2] = 0.9; }); await frames(30);
const after = await pg.evaluate(() => window.__rp.rig.lookYaw);
await pg.evaluate(() => { window.__pad.axes[2] = 0; });
check('right stick orbits the camera', Math.abs(after - before) > 0.05, `${before.toFixed(2)} -> ${after.toFixed(2)}`);
// nitro rumble + crash rumble
await pg.evaluate(() => { window.__btn(0, 1); }); await frames(30); await pg.evaluate(() => window.__btn(0, 0));
const rumbles = await pg.evaluate(() => window.__pad.rumbles.length);
check('nitro / events produce rumble', rumbles > 0, 'rumble calls: ' + rumbles);
await pg.evaluate(() => { const g = window.__rp.game; g.onImpact(g.player, null, 18, g.player.pos.x, g.player.pos.z, 'wall'); });
check('impact rumbles the pad', (await pg.evaluate(() => window.__pad.rumbles.length)) > rumbles);
// pause / disconnect
await tap(9); await frames(8);
check('START pauses', await pg.evaluate(() => window.__rp.game && !document.getElementById('pause').classList.contains('hidden')));
await tap(9); await frames(8);
await pg.evaluate(() => { window.__pad.connected = false; window.dispatchEvent(new Event('gamepaddisconnected')); }); await frames(8);
check('disconnecting the pad pauses the game', await pg.evaluate(() => !document.getElementById('pause').classList.contains('hidden')));
// PlayStation layout detection
await pg.evaluate(() => { window.__pad.connected = true; window.__pad.id = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)'; }); await sleep(300);
check('DualShock/DualSense detected', await pg.evaluate(() => { window.__rp.input.pollPad(); return window.__rp.input.kind === 'ps'; }));
console.log('errors', JSON.stringify(errs.slice(0, 3)));
const bad = results.filter((r) => !r).length; console.log(`${results.length - bad}/${results.length} passed`); await br.close(); srv.close(); process.exit(bad ? 1 : 0);
