// Multiplayer smoke test: one real game page (host) + a scripted WebSocket client as player 2.
// usage: node tools/mptest.mjs [url]
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
const URL = process.argv[2] || 'https://rxnd.de/chase/';
const WS = URL.replace(/^http/, 'ws').replace(/\/?$/, '/ws');
const log = (...a) => console.log(new Date().toISOString().slice(14, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], defaultViewport: { width: 800, height: 450 }, protocolTimeout: 240000 });
try {
  const A = await br.newPage();
  A.on('pageerror', (e) => log('PAGEERR', e.message));
  A.on('console', (m) => { if (m.type() === 'error') log('CONSOLE', m.text().slice(0, 200)); });
  await A.goto(URL + '?noperf', { timeout: 120000 });
  await A.waitForFunction(() => !document.getElementById('title').classList.contains('hidden'), { timeout: 240000, polling: 2000 });
  log('title');
  await A.evaluate(() => { document.getElementById('title').click(); document.getElementById('btn-mp').click(); document.getElementById('btn-mp-create').click(); });
  await A.waitForFunction(() => document.getElementById('mp-room-code').textContent.length === 4, { timeout: 20000, polling: 500 });
  const code = await A.$eval('#mp-room-code', (e) => e.textContent);
  log('room', code);
  const B = new WebSocket(WS); const blog = [];
  B.on('message', (d) => blog.push(JSON.parse(d)));
  await new Promise((r) => B.on('open', r));
  B.send(JSON.stringify({ t: 'join', code, name: 'NODEBOT', car: 2 }));
  await A.waitForFunction(() => document.querySelectorAll('#mp-players .mp-p:not(.bot)').length === 2, { timeout: 20000, polling: 500 });
  log('B joined');
  await A.evaluate(() => document.querySelector('#mp-bots button[data-n="2"]').click());
  await sleep(600);
  await A.evaluate(() => document.getElementById('btn-mp-start').click());
  await sleep(1500);
  const st = blog.find((m) => m.t === 'start'); log('start', JSON.stringify(st));
  const bid = blog.find((m) => m.t === 'welcome').id;
  let bx = null;
  const iv = setInterval(() => {
    const h = blog.filter((m) => m.t === 's').pop(); if (!h) return;
    const me = h.cars[0];
    if (!bx) bx = { x: me[1] + 3.5, y: me[2], z: me[3], yaw: me[4] };
    bx.x += Math.sin(bx.yaw); bx.z += Math.cos(bx.yaw);
    B.send(JSON.stringify({ t: 's', cars: [[bid, bx.x, bx.y, bx.z, bx.yaw, Math.sin(bx.yaw) * 15, Math.cos(bx.yaw) * 15, 0, 1, 0, 50, 0, 1, 0, 0.5]] }));
  }, 66);
  log("cd", await A.evaluate(() => window.__rp.game.countdown)); await sleep(5000); log("cd", await A.evaluate(() => window.__rp.game.countdown)); await A.evaluate(() => { window.__rp.game.countdown = 0.01; }); await A.waitForFunction(() => window.__rp.game.state === "playing", { timeout: 60000, polling: 1000 }); log("playing"); await A.keyboard.down("KeyW"); await sleep(15000);
  log('A', JSON.stringify(await A.evaluate(() => { const g = window.__rp.game; return { state: g.state, mode: g.mode, multi: !!g.multi, pos: g.position, racers: g.racers.map((r) => `${r.name}@${Math.round(r.pos.x)},${Math.round(r.pos.z)} v${Math.round(r.speed)} ${r.ai ? r.ai.constructor.name : 'local'}`) }; })));
  const s = blog.filter((m) => m.t === 's');
  log('B got', s.length, 'snapshots; last:', JSON.stringify(s.pop()?.cars.map((c) => c[0] + '@' + Math.round(c[1]) + ',' + Math.round(c[3]))));
  await A.evaluate(() => { const pl = window.__rp.game.player; pl.health = 0.3; pl.nitro = 0.1; });
  B.send(JSON.stringify({ t: 'wreck', id: bid, by: st.host }));
  await sleep(1500);
  log('after takedown', JSON.stringify(await A.evaluate(() => { const g = window.__rp.game; return { takedowns: g.takedowns, health: g.player.health, nitro: +g.player.nitro.toFixed(2) }; })));
  clearInterval(iv); B.close();
  await sleep(1500);
  log('after leave', JSON.stringify(await A.evaluate(() => window.__rp.game.racers.map((r) => r.name))));
  await A.screenshot({ path: '/tmp/mpA.png' });
} finally { await br.close(); }
process.exit(0);
