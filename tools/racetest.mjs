// Headless race sim (game logic only, no rendering): player autopilots the route, bots run RacerAI. Reports per-car progress over time, circling and wrong-way.
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(0);
const PORT = srv.address().port;
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], protocolTimeout: 280000 });
const pg = await br.newPage(); pg.on('pageerror', (e) => console.log('[pageerror]', e.message));
await pg.goto('http://localhost:' + PORT + '/?noperf'); await pg.waitForFunction('window.__rp', { timeout: 200000 });
const mode = process.argv[2] || 'race', secs = +process.argv[3] || 60;
const res = await pg.evaluate(async (mode, secs) => {
  const { game } = window.__rp; game.start(mode, 0); game.countdown = 0.01; for (let i = 0; i < 30; i++) game.update(1 / 60); game.state = 'playing';
  const route = game.route, pl = game.player, drv = { steer: 0, throttle: 0, brake: 0, handbrake: 0, nitro: 0 }; game.input.drive = () => drv;
  const _unused = 0, out = { samples: [], wrongWay: 0, frames: 0 };
  const { pointAtDist } = window.__rp.roads || {};
  for (let f = 0; f < secs * 60; f++) {
    // player autopilot: chase a point ahead on the route
    const pr = game.playerProgress, look = Math.min(route.length, pr + 24);
    let best = route.pts.findIndex((p) => p.d >= look); if (best < 0) best = route.pts.length - 1; const t = route.pts[best];
    let da = Math.atan2(t.x - pl.pos.x, t.z - pl.pos.z) - pl.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
    drv.steer = Math.max(-1, Math.min(1, da * 2.2)); drv.throttle = pl.speed < 36 ? 1 : 0.3; drv.brake = pl.speed > 40 ? 0.6 : 0;
    game.bust = 0; if (pl.wrecked || pl.health < 0.5) { pl.health = 1; pl.wrecked = false; } /* keep the test going: crash recovery is not what is being tested */
    game.update(1 / 60); out.frames++; if (game.state === 'ending' || game.state === 'result') break; if (game.wrongWay) out.wrongWay++;
    if (f % 600 === 0 || f < 3) out.samples.push({ stuckInfo: game.racers.filter((r) => r !== pl && r.speed < 8 && f > 1200).map((r) => `${r.name} pos ${Math.round(r.pos.x)},${Math.round(r.pos.z)} y${r.pos.y.toFixed(1)} yaw${Math.round(r.yaw*57.3)} wrecked${r.wrecked} hp${r.health.toFixed(2)} off${r.ai?.route ? Math.round(window.__rp.game.route.pts[Math.min(r.ai.idx, window.__rp.game.route.pts.length-1)].x)+','+Math.round(window.__rp.game.route.pts[Math.min(r.ai.idx, window.__rp.game.route.pts.length-1)].z) : ''} reverseT${(r.ai.reverseT||0).toFixed(1)} stuckCount${r.ai.stuckCount||0}`).join(' | '), t: Math.round(f / 60), player: Math.round(game.playerProgress), kmh: Math.round(pl.speed * 3.6), st: game.state, thr: pl.input.throttle, wrecked: pl.wrecked, hp: +pl.health.toFixed(2), bots: game.racers.filter((r) => r !== pl).map((r) => `${r.name}:${Math.round(r.ai?.progress || 0)}@${Math.round(r.speed * 3.6)}`) });
  }
  out.endReason = game.result ? game.result.reason : null; out.plPos = [Math.round(pl.pos.x), Math.round(pl.pos.z)]; out.hp = +pl.health.toFixed(2);
  out.routeLen = Math.round(route.length); out.finishedList = game.finished.map((c) => c.name); out.final = { player: Math.round(game.playerProgress), off: Math.round(game.playerOff || 0), place: game.position, checkIdx: game.checkIdx, finishDist: Math.round(game.finishDist), state: game.state };
  return out;
}, mode, secs);
console.log('endReason', res.endReason, 'playerPos', res.plPos, 'health', res.hp);
console.log('finished order', JSON.stringify(res.finishedList));
console.log('route length', res.routeLen, '| wrongWay frames', res.wrongWay, '/', res.frames, '| final', JSON.stringify(res.final));
for (const s of res.samples) if (s.stuckInfo) console.log('   STUCK:', s.stuckInfo);
for (const s of res.samples) console.log(`t=${String(s.t).padStart(3)}s [${s.st} thr${s.thr} hp${s.hp}] player ${String(s.player).padStart(5)} @${s.kmh}km/h | ${s.bots.join('  ')}`);
await br.close(); srv.close();
