// Direct physics probes (headless, no rendering): braking distance, skidpad lateral g, handbrake drift, launch, grass grip.
import puppeteer from 'puppeteer-core'; import http from 'http'; import fs from 'fs'; import path from 'path';
const srv = http.createServer((q, r) => { const u0 = decodeURIComponent(q.url.split('?')[0]); const p = u0 === '/' ? '/index.html' : u0; const f = path.join(process.cwd(), p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); fs.createReadStream(f).pipe(r); }).listen(0);
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await br.newPage(); pg.on('pageerror', (e) => console.log('pageerror', e.message));
await pg.goto('http://localhost:' + srv.address().port + '/?noperf'); await pg.waitForFunction('window.__rp', { timeout: 200000 });
const res = await pg.evaluate(() => {
  const { game, world } = window.__rp; world.statics.collide = () => false; const out = {};
  const cars = [0, 1, 2, 3];
  for (const ci of cars) {
    game.start('free', ci); for (let i = 0; i < 5; i++) game.update(1 / 60); game.state = 'play';
    const pl = game.player, name = pl.spec.id; const R = {};
    const run = (setup, fn, secs) => { setup(); for (let t = 0; t < secs * 180; t++) { if (fn(t / 180) === 'stop') break; pl.step(1 / 180); } };
    const setV = (v) => { pl.vel.set(Math.sin(pl.yaw) * v, Math.cos(pl.yaw) * v); pl.vF = v; pl.vR = 0; pl.speed = v; };
    const flat = () => { pl.place(0, 100, 0, 0); pl.health = 1; pl.wrecked = false; pl.drifting = false; pl.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 }; };
    // 0-100 km/h + braking 100->0 on the flat city grid (z along +)
    let t100 = 0; run(() => { flat(); }, (t) => { pl.input.throttle = 1; if (pl.vF >= 27.8) { t100 = t; return 'stop'; } }, 20); R.t0_100 = +t100.toFixed(2);
    let d0 = pl.pos.z, tb = 0; run(() => { setV(27.8); pl.input = { throttle: 0, brake: 1, steer: 0, handbrake: 0, nitro: 0 }; d0 = pl.pos.z; }, (t) => { tb = t; if (pl.vF < 0.3) return 'stop'; }, 10); R.brake100_m = +(pl.pos.z - d0).toFixed(1); R.brake100_g = +(27.8 / tb / 9.81).toFixed(2);
    // 160 km/h braking
    run(() => { flat(); setV(44.4); pl.input.brake = 1; d0 = pl.pos.z; }, (t) => { tb = t; if (pl.vF < 0.3) return 'stop'; }, 12); R.brake160_m = +(pl.pos.z - d0).toFixed(1);
    // skidpad: hold speed ~25 m/s, full lock, measure steady lateral accel
    let latg = 0; run(() => { flat(); setV(25); }, (t) => { pl.input.steer = 1; pl.input.throttle = pl.vF < 25 ? 0.6 : 0.25; if (t > 2.5) latg = Math.max(latg, Math.abs(pl.angVel * pl.vF) / 9.81); }, 5); R.skidpad25_g = +latg.toFixed(2);
    latg = 0; run(() => { flat(); setV(55); }, (t) => { pl.input.steer = 1; pl.input.throttle = pl.vF < 55 ? 0.8 : 0.4; if (t > 2.5) latg = Math.max(latg, Math.abs(pl.angVel * pl.vF) / 9.81); }, 5); R.skidpad55_g = +latg.toFixed(2);
    // handbrake drift at 30 m/s
    let maxSlip = 0, drifted = false; run(() => { flat(); setV(30); }, (t) => { if (t % 0.25 < 1 / 180) (R.trace ||= []).push([+t.toFixed(2), +pl.vF.toFixed(1), +pl.vR.toFixed(1), +(pl.angVel).toFixed(2), +(pl.slip * 57.3).toFixed(0), pl.drifting ? 'D' : '-'].join(' ')); pl.input.steer = 0.8; pl.input.handbrake = t > 0.3 && t < 1.2 ? 1 : 0; pl.input.throttle = 0.5; maxSlip = Math.max(maxSlip, Math.abs(pl.slip)); if (pl.drifting) drifted = true; if (!isFinite(pl.pos.x)) return 'stop'; }, 4); R.drift_maxSlipDeg = +(maxSlip * 57.3).toFixed(0); R.drifted = drifted; R.driftSpeedAfter = +pl.speed.toFixed(1);
    // recovery: steer 0, release after drift -> does it straighten?
    run(() => {}, (t) => { pl.input.steer = 0; pl.input.handbrake = 0; pl.input.throttle = 0.3; }, 4); R.recoverSlipDeg = +(Math.abs(pl.slip) * 57.3).toFixed(1);
    // grass vs asphalt braking at 25 m/s
    run(() => { flat(); pl.place(1500, 0, 0, 0); setV(25); pl.input.brake = 1; d0 = pl.pos.z; }, () => { if (pl.vF < 0.3) return 'stop'; }, 10); R.brake_offroad_m = +(pl.pos.z - 0).toFixed(1) + '(surfMu ' + pl.surfMu + ')';
    out[name] = R;
  }
  return out;
});
console.log(JSON.stringify(res, null, 1)); await br.close(); srv.close();
