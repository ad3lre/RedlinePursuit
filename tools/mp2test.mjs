// Two REAL game pages in one session: each drives forward; checks each sees the other move.
// usage: node tools/mp2test.mjs [url] [ws://relay]
import puppeteer from 'puppeteer-core';
const args = process.argv.slice(2);
const URL = args.find((a) => a.startsWith('http')) || 'https://rxnd.de/chase/';
const WSA = args.find((a) => a.startsWith('ws'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(14, 19), ...a);
const brs = [];
const launch = () => puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], defaultViewport: { width: 640, height: 360 }, protocolTimeout: 240000 });
let fail = 0;
try {
  const open = async (name) => {
    const br = await launch(); brs.push(br); const p = (await br.pages())[0] || await br.newPage();
    p.on('pageerror', (e) => log(name, 'PAGEERR', e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) log(name, 'CONSOLE', m.text().slice(0, 300)); });
    await p.goto(URL + '?noperf' + (WSA ? '&server=' + WSA : ''), { timeout: 120000 });
    await p.waitForFunction(() => !document.getElementById('title').classList.contains('hidden'), { timeout: 240000, polling: 1000 });
    await p.evaluate((n) => { localStorage.setItem('redline-name', n); }, name);
    await p.click('#title'); await sleep(1000);
    await p.click('[data-mode="race"]'); await sleep(2000);
    await p.click('#btn-start'); await sleep(1500);
    return p;
  };
  const A = await open('AAA'); const B = await open('BBB');
  await sleep(1000);
  const hostA = await A.evaluate(() => !document.getElementById('btn-go').classList.contains('hidden'));
  await (hostA ? A : B).evaluate(() => document.getElementById('btn-go').click());
  await sleep(4000);
  for (const P of [A, B]) log('after GO', JSON.stringify(await P.evaluate(() => { const g = window.__rp.game; return { state: g.state, multi: !!g.multi, mode: g.mode, cd: g.countdown, banner: document.getElementById('wait-banner')?.textContent }; })));
  for (const P of [A, B]) await P.evaluate(() => { window.__rp.game.countdown = 0.01; });
  await sleep(8000);
  for (const P of [A, B]) log('8s later', JSON.stringify(await P.evaluate(() => { const g = window.__rp.game; return { state: g.state, cd: g.countdown, t: g.time }; })));
  for (const P of [A, B]) await P.waitForFunction(() => window.__rp.game.state === 'playing', { timeout: 240000, polling: 500 });
  // hold throttle in both pages
  for (const P of [A, B]) await P.evaluate(() => { const g = window.__rp.game; g.input.drive = () => ({ steer: 0, throttle: 1, brake: 0, handbrake: 0, nitro: 0 }); });
  const snap = (P) => P.evaluate(() => { const g = window.__rp.game; const o = {}; for (const [id, c] of g.netCars) if (c.net.human) o[id] = [+c.pos.x.toFixed(1), +c.pos.z.toFixed(1), c.ai?.snap ? 1 : 0, +(c.ai?.age ?? -1).toFixed(2)]; return { me: g.multi.myId, self: [+g.player.pos.x.toFixed(1), +g.player.pos.z.toFixed(1)], others: o, t: g.time }; });
  const a0 = await snap(A), b0 = await snap(B);
  await sleep(5000);
  const a1 = await snap(A), b1 = await snap(B);
  log('A', JSON.stringify(a0), '->', JSON.stringify(a1));
  log('B', JSON.stringify(b0), '->', JSON.stringify(b1));
  const moved = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const aSeesB = a1.others[b1.me] && a0.others[b1.me] ? moved(a0.others[b1.me], a1.others[b1.me]) : 0;
  const bSeesA = b1.others[a1.me] && b0.others[a1.me] ? moved(b0.others[a1.me], b1.others[a1.me]) : 0;
  log('A self moved', moved(a0.self, a1.self).toFixed(1), '| A sees B moved', aSeesB.toFixed(1));
  log('B self moved', moved(b0.self, b1.self).toFixed(1), '| B sees A moved', bSeesA.toFixed(1));
  if (aSeesB < 3 || bSeesA < 3) { fail = 1; log('FAIL: remote player frozen'); } else log('PASS: both see each other move');
  // ---- desync check: drop B's socket mid-race; it must resume the same identity and both worlds must re-converge ----
  const bId = b1.me;
  await B.evaluate(() => window.__rp.game.multi.net.ws.close());
  await sleep(4000);
  const a2 = await snap(A), b2 = await snap(B);
  await sleep(3000);
  const a3 = await snap(A), b3 = await snap(B);
  log('after drop: B id', b3.me, '(was', bId + ')', '| A still has B:', !!a3.others[bId]);
  const aSeesB2 = a3.others[bId] && a2.others[bId] ? moved(a2.others[bId], a3.others[bId]) : 0;
  const bSeesA2 = b3.others[a3.me] && b2.others[a3.me] ? moved(b2.others[a3.me], b3.others[a3.me]) : 0;
  // A's view of B vs B's own position (both sampled at ~same time) must agree
  const gap = a3.others[bId] ? moved(a3.others[bId], b3.self) : 999;
  log('after resume: A sees B moved', aSeesB2.toFixed(1), '| B sees A moved', bSeesA2.toFixed(1), '| A-view vs B-self gap', gap.toFixed(1));
  if (b3.me !== bId || aSeesB2 < 3 || bSeesA2 < 3 || gap > 25) { fail = 1; log('FAIL: worlds diverged after reconnect'); } else log('PASS: reconnect resumed the same shared world');
} finally { for (const b of brs) await b.close(); }
process.exit(fail);
