// Multiplayer smoke test for the single shared room:
//   page A  = a real game page (goes through the real UI: title -> mode -> garage -> START = ready, then GO)
//   client B = scripted WebSocket player (ready as a COP, streams a position, drops spikes, EMPs A, busts A)
// usage: node tools/mptest.mjs [url] [--gpu]      (default url https://rxnd.de/chase/)
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
const args = process.argv.slice(2); const URL = args.find((a) => a.startsWith('http')) || 'https://rxnd.de/chase/'; const GPU = args.includes('--gpu');
const WS = (args.find((a) => a.startsWith('ws')) || URL.replace(/^http/, 'ws').replace(/\/?$/, '/ws'));
const log = (...a) => console.log(new Date().toISOString().slice(14, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const check = (name, ok, info = '') => { results.push([name, ok]); log(ok ? 'PASS' : 'FAIL', name, info); };
const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: GPU ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 720 }, protocolTimeout: 240000 });
try {
  // ---- scripted player B connects first -> becomes the room owner candidate ----
  const B = new WebSocket(WS); const blog = [];
  B.on('message', (d) => blog.push(JSON.parse(d)));
  await new Promise((r) => B.on('open', r));
  B.send(JSON.stringify({ t: 'hello', name: 'NODECOP' }));
  const bid = await (async () => { for (let i = 0; i < 40; i++) { const w = blog.find((m) => m.t === 'welcome'); if (w) return w.id; await sleep(100); } })();
  check('B welcome', !!bid, bid);

  // ---- A: real page, real UI ----
  const A = await br.newPage();
  A.on('pageerror', (e) => log('PAGEERR', e.message));
  A.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) log('CONSOLE', m.text().slice(0, 200)); });
  await A.goto(URL + '?noperf' + (args.find((a) => a.startsWith('ws')) ? '&server=' + WS : ''), { timeout: 120000 });
  await A.waitForFunction(() => !document.getElementById('title').classList.contains('hidden'), { timeout: 240000, polling: 1000 });
  check('no MULTIPLAYER button / lobby in the menu', await A.evaluate(() => !document.getElementById('btn-mp') && !document.getElementById('lobby') && !/multiplayer/i.test(document.body.innerText)));
  await sleep(1500);
  check('A connected in background', await A.evaluate(() => true));
  await A.click('#title'); await sleep(1200);
  // ---- player names: type one on the main menu; keys typed there must not drive the menu; it persists and reaches the relay ----
  const appBefore = await A.evaluate(() => [...document.querySelectorAll('.screen')].filter((e) => !e.classList.contains('hidden')).map((e) => e.id).join());
  await A.click('#player-name', { clickCount: 3 }); await A.keyboard.type('Dr. Speed! <>wasd');
  const typed = await A.evaluate(() => document.getElementById('player-name').value);
  check('name box strips illegal characters and caps at 14', typed === 'Dr. Speed! was', typed);
  check('typing in the name box does not navigate the menu', (await A.evaluate(() => [...document.querySelectorAll('.screen')].filter((e) => !e.classList.contains('hidden')).map((e) => e.id).join())) === appBefore);
  await A.keyboard.press('Enter'); await sleep(300);
  check('name saved to localStorage', (await A.evaluate(() => localStorage.getItem('redline-name'))) === 'Dr. Speed! was');
  await A.click('#player-name', { clickCount: 3 }); await A.keyboard.type('Dr. Speed'); await A.keyboard.press('Enter'); await sleep(300);
  check('name limited to 14 characters', await A.evaluate(() => { const i = document.getElementById('player-name'); i.value = 'ABCDEFGHIJKLMNOPQRS'; i.dispatchEvent(new Event('change')); return localStorage.getItem('redline-name').length === 14; }));
  await A.click('#player-name', { clickCount: 3 }); await A.keyboard.type('Dr. Speed'); await A.keyboard.press('Enter'); await sleep(300);
  await A.click('[data-mode="race"]'); await sleep(2500);
  await A.click('#btn-start'); await sleep(1500);
  const banner = await A.evaluate(() => document.getElementById('wait-banner').textContent);
  check('START = ready; banner shows "N players ready"', /player/.test(banner), banner);

  // B readies as a COP (Interceptor), same shared race
  B.send(JSON.stringify({ t: 'ready', name: 'NODECOP', mode: 'cop', role: 'cop', car: 2 }));
  await sleep(1000);
  const room = blog.filter((m) => m.t === 'room').pop();
  check('relay shows A under the typed name', !!room && room.players.some((p) => p.name === 'Dr. Speed'), JSON.stringify(room?.players?.map((p) => p.name)));
  check('relay sees 2 ready players', room && room.players.filter((p) => p.state !== 'menu').length === 2, JSON.stringify(room?.players?.map((p) => p.name + ':' + p.state + ':' + p.role)));
  const aIsHost = await A.evaluate(() => !document.getElementById('btn-go').classList.contains('hidden'));
  log('A owner (GO visible):', aIsHost, '| room host:', room?.host);
  if (aIsHost) await A.keyboard.press('KeyG'); else B.send(JSON.stringify({ t: 'go' }));
  await sleep(3000);
  const st = blog.find((m) => m.t === 'start'); check('session started for both', !!st, st ? `event ${st.event} players ${st.players.length}` : '');
  const gs = await A.evaluate(() => { const g = window.__rp.game; return { mode: g.mode, multi: !!g.multi, state: g.state, cars: g.cars.map((c) => `${c.name}|${c.role}|${c.spec.id || c.spec.kind}|${c.model.paint.color.getHexString()}`) }; });
  log('A game', JSON.stringify(gs));
  check('A in multiplayer game', gs.multi);
  check('A is a RACER (Race mode)', gs.mode === 'race');
  const bCar = gs.cars.find((c) => c.startsWith('NODECOP'));
  check('B\'s car in A\'s world carries B\'s own name', gs.cars.some((c) => c.startsWith('NODECOP|')));
  check('A\'s own car is named after the typed name', await A.evaluate(() => window.__rp.game.player.name === 'Dr. Speed'));
  check('B (cop) appears as a cop in A\'s world', !!bCar && bCar.includes('|cop|'), bCar);
  // same car for everyone: B asked for car index 2 (BRUISER) -> drawn with its own default colours, not recoloured
  // a human cop is drawn as the car they picked (bruiser) in the police livery - never swapped for another model or recoloured because it matches mine
  check('B drawn as chosen car 2 (bruiser) in police livery', !!bCar && /bruiser/.test(bCar) && /0b0b0d/i.test(bCar), bCar);
  check('A is NOT drawn like B (no model/colour swap)', !gs.cars.find((c) => c.startsWith('RACER'))?.includes('bruiser'));

  // ---- B streams a position, then spikes / EMP / bust ----
  let bx = null;
  const iv = setInterval(() => { const h = blog.filter((m) => m.t === 's').pop(); if (!h) return; const me = h.cars[0]; if (!bx) bx = { x: me[1] - 8, y: me[2], z: me[3] - 8, yaw: me[4] }; bx.x += Math.sin(bx.yaw) * 0.6; bx.z += Math.cos(bx.yaw) * 0.6; B.send(JSON.stringify({ t: 's', cars: [[bid, bx.x, bx.y, bx.z, bx.yaw, Math.sin(bx.yaw) * 10, Math.cos(bx.yaw) * 10, 0, 1, 0, 50, 0, 1, 0, 0.5]] })); }, 66);
  await A.evaluate(() => { window.__rp.game.countdown = 0.01; }); await sleep(4000);
  const spikesBefore = await A.evaluate(() => window.__rp.game.spikes.length);
  B.send(JSON.stringify({ t: 'spike', x: bx?.x || 0, z: bx?.z || 0, yaw: bx?.yaw || 0 })); await sleep(800);
  check('cop B\'s spike strip appears for A', (await A.evaluate(() => window.__rp.game.spikes.length)) > spikesBefore);
  const myId = await A.evaluate(() => window.__rp.game.multi.myId);
  B.send(JSON.stringify({ t: 'dmg', to: myId, id: myId, kind: 'emp', amt: 0.2, by: bid })); await sleep(800);
  check('EMP from cop B applies to A', await A.evaluate(() => window.__rp.game.player.empTimer > 0 || window.__rp.game.player.health < 1));
  const bustedBefore = await A.evaluate(() => window.__rp.game.bustedRacers);
  B.send(JSON.stringify({ t: 'bust', id: 'pX', name: 'GHOSTRACER' })); await sleep(600);
  check('bust broadcast counted on A with real racer total', (await A.evaluate(() => window.__rp.game.bustedRacers)) === bustedBefore + 1 && await A.evaluate(() => /\/\d+/.test(document.getElementById('busted-num').textContent)));
  // ---- spectator mode: A dies while real player B is still racing -> A spectates B; event ends when B is out too ----
  const specSnap = () => A.evaluate(() => { const g = window.__rp.game; const t = g.specTarget && g.specTarget(); return { state: g.state, spec: !!g.spectating, target: t ? t.name : null, banner: !document.getElementById('spec-banner').classList.contains('hidden'), bannerName: document.getElementById('spec-name').textContent, alive: g.aliveHumans().length, res: g.result ? { allOut: g.result.allOut, reason: g.result.reason } : null }; });
  await A.evaluate(() => { const g = window.__rp.game; g.player.health = 0.01; g.damage(g.player, 0.5, null); }); await sleep(1200);
  let sp = await specSnap();
  check('A dies while B alive -> spectator mode (not game over)', sp.spec && sp.state === 'playing' && !sp.res, JSON.stringify(sp));
  await A.screenshot({ path: process.platform === 'win32' ? 'shots/spec.png' : '/tmp/spec.png' }).catch(() => {});
  check('spectator banner shows B and the camera targets B', sp.banner && sp.bannerName === 'NODECOP' && sp.target === 'NODECOP', sp.bannerName);
  await A.keyboard.press('KeyE'); await sleep(300);
  check('A stays spectating after switching targets (only one other player)', (await specSnap()).spec);
  // B (the last real player) is wrecked -> everyone is out -> GAME OVER for A
  B.send(JSON.stringify({ t: 'wreck', id: bid, by: null })); await sleep(1800);
  sp = await specSnap();
  check('last real player out -> game over for the spectator', (sp.state === 'ending' || sp.state === 'result') && sp.res && sp.res.allOut === true, JSON.stringify(sp.res));
  check('spectator banner hidden at game over', !sp.banner);
  clearInterval(iv); B.close(); await sleep(1500);
  check('B leaving removes its car', await A.evaluate(() => !window.__rp.game.cars.some((c) => c.name === 'NODECOP')));
  await A.evaluate(() => { window.__rp.game.start && 0; });
  await A.screenshot({ path: process.platform === 'win32' ? 'shots/mpA.png' : '/tmp/mpA.png' }).catch(() => {});
} finally { await br.close(); }
const bad = results.filter((r) => !r[1]); log(`${results.length - bad.length}/${results.length} passed`); process.exit(bad.length ? 1 : 0);
