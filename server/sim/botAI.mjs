// Slim oval AI for the dedicated match server (no city nav / Three).
import { clamp, wrapAngle, lerp } from '../../shared/math.js';
import { projectOnRoute, pointAtDist } from '../../shared/speedway.js';
import { gripLimit } from '../../shared/carSim.js';

const P = {}; const P2 = {}; const P3 = {};

function steerToward(car, tx, tz, gain = 2.1) {
  const desired = Math.atan2(tx - car.x, tz - car.z);
  const diff = wrapAngle(desired - car.yaw);
  const dampTerm = (car.angVel || 0) * 0.09;
  return { steer: clamp((diff - dampTerm) * gain, -1, 1), diff };
}

function speedControl(car, desired) {
  const v = car.vF;
  if (v < desired - 1) { car.input.throttle = clamp((desired - v) / 6, 0.35, 1); car.input.brake = 0; }
  else if (v > desired + 2.5) { car.input.throttle = 0; car.input.brake = clamp((v - desired) / 9, 0.25, 1); }
  else { car.input.throttle = 0.3; car.input.brake = 0; }
}

function curvatureSpeed(route, prog, latA, carYaw) {
  const a = pointAtDist(route, prog, P);
  const ax = carYaw !== undefined ? Math.sin(carYaw) : a.dx;
  const az = carYaw !== undefined ? Math.cos(carYaw) : a.dz;
  const baseAng = Math.atan2(ax, az);
  let vmax = 999, sharpNear = false;
  for (const d of [8, 16, 26, 40, 60, 85, 115, 150]) {
    const b = pointAtDist(route, prog + d, P2);
    const c = pointAtDist(route, prog + d + 12, P3);
    const ang1 = Math.abs(wrapAngle(Math.atan2(b.dx, b.dz) - baseAng));
    const localAng = Math.abs(wrapAngle(Math.atan2(c.dx, c.dz) - Math.atan2(b.dx, b.dz)));
    if (d <= 30 && (ang1 > 0.45 || localAng > 0.45)) sharpNear = true;
    if (ang1 > 0.03) {
      const R = Math.max(10, d / ang1);
      const vc = Math.sqrt(latA * R);
      vmax = Math.min(vmax, Math.sqrt(vc * vc + 2 * 11.5 * Math.max(0, d - 12)));
    }
  }
  return { vmax, sharpNear };
}

function avoidance(car, cars, range = 32) {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const rx = -fz, rz = fx;
  let push = 0, block = 999;
  for (const o of cars) {
    if (o === car || o.out) continue;
    const dx = o.x - car.x, dz = o.z - car.z;
    const fwd = dx * fx + dz * fz;
    if (fwd < 2 || fwd > range) continue;
    const lat = dx * rx + dz * rz;
    if (Math.abs(lat) > 4) continue;
    const relV = car.vF - (o.vx * fx + o.vz * fz);
    if (relV < 2 && fwd > 10) continue;
    const w = (1 - fwd / range) * (1 - Math.abs(lat) / 4);
    push += (lat >= 0 ? -1 : 1) * w;
    if (Math.abs(lat) < 2.2) block = Math.min(block, fwd);
  }
  return { push, block };
}

export class OvalRacerAI {
  constructor(car, route, skill = 1) {
    this.car = car; this.route = route; this.skill = skill;
    this.idx = 0; this.lane = (Math.random() - 0.5) * 5; this.laneT = this.lane;
    this.stuck = 0; this.reverseT = 0;
    this.aggression = 0.55 + Math.random() * 0.45;
    this.patience = 0.4 + Math.random() * 0.6;
    this.pace = 0.94 + Math.random() * 0.1;
  }
  update(dt, cars, leadProgress) {
    const car = this.car;
    if (car.wrecked || car.finished || car.out) {
      car.input.throttle = 0; car.input.brake = 1; car.input.nitro = 0;
      return;
    }
    const pr = projectOnRoute(this.route, car.x, car.z, this.idx, 30);
    this.idx = pr.index; car.progress = pr.dist;
    const sp = car.speed;
    const { vmax, sharpNear } = curvatureSpeed(this.route, car.progress, gripLimit(car) * (0.78 + this.aggression * 0.08), car.yaw);
    const look = sharpNear ? clamp(9 + sp * 0.25, 9, 16) : clamp(11 + sp * 0.42, 11, 28);
    const t = pointAtDist(this.route, car.progress + look, P);
    const av = avoidance(car, cars);
    const lim = 4.8;
    this.laneT = clamp(this.laneT + av.push * dt * (10 + this.aggression * 6), -lim, lim);
    if (car.offroad || pr.off > 6 || sharpNear) this.laneT = lerp(this.laneT, 0, dt * 4);
    else if (Math.abs(av.push) < 0.01) this.laneT = lerp(this.laneT, clamp(this.lane, -lim, lim), dt * (0.35 + this.patience * 0.4));
    const rx = -t.dz, rz = t.dx;
    let tx = t.x + rx * this.laneT, tz = t.z + rz * this.laneT;
    if (pr.off > 10 || car.offroad) { const q = pointAtDist(this.route, car.progress + 12, P2); tx = q.x; tz = q.z; }
    const s = steerToward(car, tx, tz, 2.0 + this.aggression * 0.35);
    car.input.steer = lerp(car.input.steer || 0, s.steer, clamp(dt * (9 + this.aggression * 4), 0, 1));
    let desired = Math.min(car.spec.top, vmax) * this.skill * this.pace;
    if (leadProgress != null) {
      const gap = leadProgress - car.progress;
      desired *= 1 + clamp(gap / 900, -0.12, 0.14);
      car.boost = 1 + clamp(gap / 1500, -0.05, 0.12);
    }
    if (av.block < 14 && sp > 10) desired = Math.min(desired, sp * (0.85 + this.aggression * 0.08));
    if (Math.abs(s.diff) > 0.6) desired = Math.min(desired, 18);
    speedControl(car, desired);
    car.input.handbrake = Math.abs(s.diff) > 0.9 && sp > 22 && sp < 40 ? 1 : 0;
    car.input.nitro = car.nitro > 0.2 && desired > car.spec.top * 0.85 && Math.abs(s.diff) < 0.1 && this.aggression > 0.45 ? 1 : 0;
    car.nitro = Math.min(1, car.nitro + dt * 0.035);
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      car.input.throttle = 0; car.input.brake = 1; car.input.steer = -car.input.steer; car.input.nitro = 0;
      return;
    }
    if (car.speed < 2.5 && car.input.throttle > 0.2) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 1.6) { this.reverseT = 1.1; this.stuck = 0; }
  }
}

export class OvalCopAI {
  constructor(car, route) {
    this.car = car; this.route = route; this.idx = 0; this.target = null; this.lane = 0;
  }
  update(dt, cars) {
    const car = this.car;
    if (car.wrecked || car.out) { car.input.throttle = 0; car.input.brake = 1; return; }
    const tg = this.target;
    const pr = projectOnRoute(this.route, car.x, car.z, this.idx, 30);
    this.idx = pr.index; car.progress = pr.dist;
    let tx, tz, desired;
    if (tg && !tg.out && !tg.wrecked) {
      const dx = tg.x - car.x, dz = tg.z - car.z;
      const dist = Math.hypot(dx, dz);
      tx = tg.x; tz = tg.z;
      desired = tg.speed + clamp(dist * 0.55, 4, 28);
      if (dist < 18) desired = Math.min(desired, tg.speed + 4);
    } else {
      const t = pointAtDist(this.route, car.progress + 22, P);
      tx = t.x; tz = t.z;
      desired = 55;
    }
    const s = steerToward(car, tx, tz, 2.2);
    car.input.steer = lerp(car.input.steer || 0, s.steer, clamp(dt * 10, 0, 1));
    speedControl(car, desired);
    car.input.nitro = car.nitro > 0.15 && desired > 70 ? 1 : 0;
    car.nitro = Math.min(1, car.nitro + dt * 0.04);
    car.input.handbrake = 0;
  }
}
