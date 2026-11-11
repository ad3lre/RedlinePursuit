// Headless car kinematics (Speedway-focused). No Three, no meshes — usable from Node and browser.
import { clamp, lerp, wrapAngle, damp, G, G_VERT, RIDE } from './math.js';
import { dimsFor } from './carSpecs.js';

const HOLD_RAMP_S = 0.7, HOLD_GAIN = 1.05;
const BRAKE_RAMP_S = 0.55;

/** @param {object} world { heightAt(x,z), onRoad(x,z), roadDist(x,z) } */
export function createSimCar(spec, opts = {}) {
  const dims = opts.dims || dimsFor(spec);
  const cgH = spec.cg ?? ({ super: 0.46, gt: 0.5, muscle: 0.55, sedan: 0.58, suv: 0.72, truck: 0.95, tank: 0.85 }[spec.kind] ?? 0.55);
  return {
    spec,
    role: opts.role || 'racer',
    name: opts.name || spec.name || 'CAR',
    dims,
    radius: Math.min(dims.W / 2 + 0.05, 1.15),
    circOff: dims.L / 2 - Math.min(dims.W / 2 + 0.05, 1.15) * 0.9,
    cgH,
    mass: spec.mass || 1.1,
    x: 0, y: 2, z: 0,
    vx: 0, vz: 0, // XZ velocity (matches Car.vel.x / Car.vel.y)
    yaw: 0, angVel: 0, vy: 0,
    grounded: true, airTime: 0,
    steerAngle: 0,
    input: { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 },
    brakeHoldT: 0,
    nitro: opts.nitro ?? 0.6,
    nitroActive: false,
    health: 1,
    wrecked: false,
    drifting: false,
    slip: 0,
    speed: 0, vF: 0, vR: 0,
    exitBoost: 0,
    flatTimer: 0, empTimer: 0,
    offroad: false,
    holdDir: 0, holdT: 0,
    prevG: undefined, slopeVs: undefined,
    boost: 1,
    progress: 0,
    finished: false,
    out: false,
    police: !!opts.police,
  };
}

export function placeSimCar(car, x, z, yaw, speed = 0, heightAt) {
  car.x = x; car.z = z;
  car.y = (heightAt ? heightAt(x, z) : 2) + RIDE;
  car.yaw = yaw;
  car.vx = Math.sin(yaw) * speed;
  car.vz = Math.cos(yaw) * speed;
  car.angVel = 0; car.vy = 0; car.grounded = true; car.airTime = 0;
  car.prevG = undefined; car.slopeVs = undefined;
  car.wrecked = false; car.health = car.health || 1;
}

export function gripLimit(car) {
  return (car.spec.grip / 7.6) * G;
}

/**
 * One fixed-dt kinematics step. Port of Car.step without visuals / static collide / gear RPM.
 * @param {object} car
 * @param {number} dt
 * @param {object} world { heightAt, onRoad, roadDist }
 */
export function stepSimCar(car, dt, world) {
  if (car.out) return;
  const spec = car.spec;
  const inp = car.wrecked ? { throttle: 0, brake: 0.3, steer: 0, handbrake: 1, nitro: 0 } : car.input;
  const emp = car.empTimer > 0;
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const rx = -fz, rz = fx;
  let vF = car.vx * fx + car.vz * fz;
  let vR = car.vx * rx + car.vz * rz;
  car.offroad = world.onRoad ? !world.onRoad(car.x, car.z) : false;
  const sp = Math.abs(vF);

  car.nitroActive = !!(inp.nitro && car.nitro > 0.01 && inp.throttle > 0.1 && !emp);
  if (car.nitroActive) car.nitro = Math.max(0, car.nitro - dt * (car.role === 'player' ? 0.22 : 0.3));

  let maxV = spec.top * (car.nitroActive ? 1.22 : 1) * (car.flatTimer > 0 ? 0.55 : 1) * (0.82 + 0.18 * car.health) * (emp ? 0.5 : 1);
  if (car.offroad) maxV *= 0.62;
  if (car.boost) maxV *= car.boost;
  if (car.exitBoost > 0) { maxV *= 1.12; car.exitBoost = Math.max(0, car.exitBoost - dt); }

  const rdist = car.offroad && world.roadDist ? world.roadDist(car.x, car.z) : 0;
  const surfMu = car.offroad ? (rdist < 3.5 ? 0.82 : 0.6) : 1;
  const df = spec.kind === 'super' ? 5.5e-5 : spec.kind === 'gt' ? 3.2e-5 : 0;
  const muG = (spec.grip / 7.6) * surfMu * (car.flatTimer > 0 ? 0.6 : 1) * (1 + df * vF * vF) * G;

  if (inp.brake > 0.05) car.brakeHoldT = Math.min(BRAKE_RAMP_S, car.brakeHoldT + dt);
  else car.brakeHoldT = Math.max(0, car.brakeHoldT - dt * 5);
  const bt = car.brakeHoldT / BRAKE_RAMP_S;
  const bite = 0.5 + 0.5 * bt * bt;
  const brkAmt = clamp(inp.brake, 0, 1) * bite;

  let a = 0, aLong = 0;
  if (car.grounded) {
    if (inp.throttle > 0) {
      if (vF < maxV) {
        const r = clamp(vF / maxV, 0, 1);
        let ad = spec.accel * 0.82 * (1 - Math.pow(r, 1.5) * 0.85) * inp.throttle * (car.boost || 1);
        if (car.nitroActive) ad += 15;
        if (car.exitBoost > 0) ad += 9;
        const trac = muG * 0.97;
        if (ad > trac) ad = trac;
        a += ad; aLong = ad;
      } else a -= (vF - maxV) * 0.8;
    }
    if (brkAmt > 0) {
      if (vF > 0.8) { const bk = Math.min(muG * 1.45 + 0.0004 * vF * vF, 48) * brkAmt; a -= bk; aLong = Math.max(aLong, bk); }
      else if (vF > -16) a -= 9 * brkAmt;
    }
    if (!inp.throttle && !inp.brake) a -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, 1.4 + 0.0006 * vF * vF);
    if (car.offroad) a -= vF * 0.18;
    if (inp.handbrake && sp > 1) a -= Math.sign(vF) * 7;
    if (sp > 6 && car.slopeVs !== undefined) a -= G * clamp(car.slopeVs / vF, -0.22, 0.22);
  }
  const vFprev = vF;
  vF += a * dt;
  if (car.grounded && inp.brake > 0 && vFprev > 0.8 && vF < 0) vF = 0;

  const slip = Math.atan2(vR, Math.max(Math.abs(vF), 1));
  if (inp.handbrake && sp > 14 && Math.abs(inp.steer) > 0.1) car.drifting = true;
  if (car.drifting && ((!inp.handbrake && Math.abs(slip) < 0.1) || sp < 9)) car.drifting = false;
  if (car.drifting && inp.brake > 0.5 && !inp.handbrake && Math.abs(slip) < 0.2) car.drifting = false;
  car.slip = slip;

  if (car.grounded) {
    const cg = car.cgH;
    const brk = clamp((-a - 5) / 20, 0, 1);
    const acc = clamp((a - 4) / 14, 0, 1);
    let grip = spec.grip * 1.12 * (car.offroad ? 0.6 : 1) * (car.flatTimer > 0 ? 0.6 : 1) * (1 - 0.1 * brk) * (1 - 0.12 * (cg - 0.5));
    if (car.drifting) grip *= inp.handbrake ? 0.14 : 0.3;
    if (car.wrecked) grip = 2;
    const nvR = vR * Math.exp(-grip * dt);
    const lost = Math.abs(vR - nvR);
    vR = nvR;
    if (car.drifting && vF > 0) vF += lost * 0.45;
    const al = Math.min(aLong, muG * 0.97);
    const circle = Math.sqrt(Math.max(0.68, 1 - (al / muG) ** 2 * 0.32));
    let hold = 0;
    const sIn = inp.steer;
    const rampS = car.role === 'player' ? HOLD_RAMP_S : 0.45;
    if (Math.abs(sIn) > 0.18) {
      if (Math.sign(sIn) !== car.holdDir) { car.holdDir = Math.sign(sIn); car.holdT = 0; }
      car.holdT = Math.min(rampS, (car.holdT || 0) + dt);
    } else car.holdT = Math.max(0, (car.holdT || 0) - dt * 4);
    hold = (car.holdT || 0) / rampS;
    const holdBoost = 1 + HOLD_GAIN * hold;
    const capLat = muG * 1.32 * circle * (1 - 0.28 * (cg - 0.5)) * (car.drifting ? 1.85 : 1) * (1 + 0.7 * HOLD_GAIN * hold);
    const wb2 = Math.max(2.2, car.dims.wb * 2);
    const dMax = (car.drifting ? 0.58 : clamp(Math.atan(wb2 * capLat * spec.steer * holdBoost / Math.max(sp * sp, 22)), 0.025, 0.72 + 0.18 * hold));
    car.steerAngle = damp(car.steerAngle, inp.steer * dMax, 14, dt);
    let target = vF * Math.tan(car.steerAngle) / wb2;
    target *= (1 + 0.18 * brk) * (1 - 0.08 * acc);
    const capYaw = Math.min(3.1, capLat / Math.max(sp, 2.2));
    target = clamp(target, -capYaw, capYaw);
    const npc = car.role !== 'player';
    const stab = npc ? 1.45 : 0.55 * (1 - 0.65 * hold);
    if (car.drifting) target += -slip * 0.55 * Math.sign(vF);
    else target += -slip * stab * clamp(sp / 40, 0, 1) * Math.sign(vF || 1);
    const resp = (npc ? lerp(6.5, 4.2, clamp(sp / 60, 0, 1)) : lerp(13, 8.5, clamp(sp / 60, 0, 1))) / (0.85 + 0.15 * car.mass);
    if (npc) target = clamp(target, -2.2, 2.2);
    car.angVel = damp(car.angVel, target, car.drifting ? (npc ? 4 : 6.5) : resp, dt);
    if (!car.drifting && sp > 8) vF -= Math.sign(vF) * Math.abs(car.angVel * vF) * 0.012 * dt * 60 * 0.5;
  } else {
    car.angVel *= Math.exp(-0.5 * dt);
  }

  const ax = fx * vF + rx * vR, az = fz * vF + rz * vR;
  car.vx = ax; car.vz = az;
  car.yaw = wrapAngle(car.yaw + car.angVel * dt);
  car.x += ax * dt; car.z += az * dt;

  const g = (world.heightAt ? world.heightAt(car.x, car.z) : 2) + RIDE;
  const wasGrounded = car.grounded;
  const rawSlopeV = car.prevG !== undefined ? clamp((g - car.prevG) / dt, -30, 30) : 0;
  car.slopeVs = car.slopeVs === undefined || !wasGrounded ? rawSlopeV : car.slopeVs + (rawSlopeV - car.slopeVs) * Math.min(1, dt * 14);
  const slopeV = car.slopeVs;
  car.vy -= G_VERT * dt;
  car.y += car.vy * dt;
  const gap = car.y - g;
  const stick = wasGrounded && gap < 0.9 && (car.vy - slopeV) < 5.5;
  if (car.y <= g || stick) {
    car.y = g; car.vy = clamp(slopeV, -30, 14); car.grounded = true; car.airTime = 0;
  } else if (gap > 0.25) { car.grounded = false; car.airTime += dt; }
  car.prevG = g;

  const B = 1900;
  if (Math.abs(car.x) > B) { car.x = Math.sign(car.x) * B; car.vx *= -0.3; }
  if (Math.abs(car.z) > B) { car.z = Math.sign(car.z) * B; car.vz *= -0.3; }

  car.vF = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw);
  car.vR = car.vx * -Math.cos(car.yaw) + car.vz * Math.sin(car.yaw);
  car.speed = Math.hypot(car.vx, car.vz);
  if (car.flatTimer > 0) car.flatTimer -= dt;
  if (car.empTimer > 0) car.empTimer -= dt;
}

/** Soft pairwise circle push (Speedway pack). */
export function collideSimPair(a, b) {
  if (a.out || b.out) return;
  const dx = b.x - a.x, dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  const minD = a.radius + b.radius;
  if (d2 > minD * minD || d2 < 1e-8) return;
  const d = Math.sqrt(d2);
  const nx = dx / d, nz = dz / d;
  const overlap = minD - d;
  const imA = 1 / (a.mass || 1), imB = 1 / (b.mass || 1);
  const share = overlap / (imA + imB);
  a.x -= nx * share * imA; a.z -= nz * share * imA;
  b.x += nx * share * imB; b.z += nz * share * imB;
  const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return;
  const e = 0.15;
  const j = -(1 + e) * vn / (imA + imB);
  a.vx -= j * nx * imA; a.vz -= j * nz * imA;
  b.vx += j * nx * imB; b.vz += j * nz * imB;
  const impact = -vn;
  if (impact > 8) {
    const dmg = Math.min(0.18, impact * 0.008);
    a.health = Math.max(0, a.health - dmg / (a.spec.armor || 1));
    b.health = Math.max(0, b.health - dmg / (b.spec.armor || 1));
  }
}
