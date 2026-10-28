// "Does the car whip around?" probe (headless, no rendering). For each car: steady cornering g, yaw-rate response to small / full steering
// at highway speed, peak slip angle after a steering flick, and time for the yaw rate to settle. usage: node tools/whipprobe.mjs
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(0);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], protocolTimeout: 280000 });
const pg = await br.newPage(); pg.on('pageerror', (e) => console.log('pageerror', e.message));
await pg.goto('http://localhost:' + srv.address().port + '/?noperf'); await pg.waitForFunction('window.__rp', { timeout: 250000 });
const res = await pg.evaluate(() => {
  const { game, world } = window.__rp; world.statics.collide = () => false; const out = {};
  for (let ci = 0; ci < 5; ci++) {
    game.start('free', ci); for (let i = 0; i < 5; i++) game.update(1 / 60); game.state = 'play'; const pl = game.player, R = {};
    const setup = (v) => { pl.place(0, 100, 0, 0); pl.health = 1; pl.wrecked = false; pl.drifting = false; pl.vel.set(0, v); pl.vF = v; pl.speed = v; pl.angVel = 0; pl.steerAngle = 0; pl.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 }; };
    // hold a speed with the throttle and apply a steering input; sample yaw rate / lateral g / slip
    const run = (v, steer, secs, flickAt) => { setup(v); let peakSlip = 0, peakYaw = 0, yaw1 = 0, g = 0; const tr = [];
      for (let t = 0; t < secs * 180; t++) { const tt = t / 180; pl.input.steer = flickAt !== undefined ? (tt > flickAt && tt < flickAt + 0.25 ? steer : 0) : steer; pl.input.throttle = pl.vF < v ? 0.7 : 0.18; pl.input.brake = 0; pl.step(1 / 180);
        peakSlip = Math.max(peakSlip, Math.abs(pl.slip)); peakYaw = Math.max(peakYaw, Math.abs(pl.angVel)); if (t === Math.round(secs * 180 * 0.5)) yaw1 = pl.angVel; g = Math.abs(pl.angVel * pl.vF) / 9.81; if (t % 90 === 0) tr.push(+pl.angVel.toFixed(2)); }
      return { yaw: +yaw1.toFixed(2), g: +g.toFixed(2), peakSlipDeg: +(peakSlip * 57.3).toFixed(0), peakYaw: +peakYaw.toFixed(2), spd: Math.round(pl.vF * 3.6), tr: tr.join(' ') }; };
    const small = run(50, 0.1, 3), mid = run(50, 0.3, 3), full25 = run(25, 1, 3), full55 = run(55, 1, 3), flick = run(45, 1, 3, 0.4);
    R.hw_steer10 = small.yaw; R.hw_steer30 = mid.yaw; R.g25 = full25.g; R.g55 = full55.g; R.flickPeakSlipDeg = flick.peakSlipDeg; R.flickPeakYaw = flick.peakYaw; R.flickAfter = flick.tr;
    out[pl.spec.id] = R;
  }
  return out;
});
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(8), JSON.stringify(v));
await br.close(); srv.close();
