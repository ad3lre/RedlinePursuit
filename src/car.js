// ===== Car physics + visual sync =====
import * as THREE from 'three';
import { buildCar, buildInterior } from './carModel.js';
import { clamp, lerp, damp, wrapAngle } from './util.js';
import { glowTexture } from './textures.js';
const RIDE = 0.02; // tyre contact height above the road surface (was 0.17 -> cars visibly hovered)

let blobTex = null, blurTex = null;
const blobMat = () => (blobTex ||= glowTexture('rgba(0,0,0,0.9)', 'rgba(0,0,0,0)', 128));

export const PLAYER_CARS = [
  { id: 'viper', name: 'VIPER GT', kind: 'super', top: 88, accel: 17.5, grip: 9.5, steer: 1.0, mass: 1.0, armor: 1.0, color: 0xc8101a, color2: 0x101010, livery: 'stripe', desc: 'Balanced supercar' },
  { id: 'kaiser', name: 'KAISER RS', kind: 'gt', top: 96, accel: 15.8, grip: 8.6, steer: 0.9, mass: 1.1, armor: 1.1, color: 0xe8ecf0, color2: 0x1846ff, livery: 'stripe', desc: 'Top-speed GT coupe' },
  { id: 'bruiser', name: 'BRUISER V8', kind: 'muscle', top: 85, accel: 19, grip: 8.8, steer: 0.95, mass: 1.45, armor: 1.5, color: 0xff7a00, color2: 0x111111, livery: 'split', desc: 'Ultimate ramming muscle car' },
];
export const RACER_COLORS = [[0x1ec8ff, 0x101010], [0x9aff1e, 0x101010], [0xffd400, 0x101010], [0xa020ff, 0xffffff], [0xffffff, 0xff2050], [0x202020, 0xff6a00]];
// Traffic uses the "Generic passenger car pack" models with their own baked textures (no recolour). `w` = spawn weight.
export const TRAFFIC_SPECS = [
  { kind: 'sedan', model: 'sedan', w: 3, colors: [0x6a7078] },
  { kind: 'sedan', model: 'hatchback', w: 3, colors: [0xe8d040] },
  { kind: 'sedan', model: 'compact', w: 2, colors: [0x4cc0e0] },
  { kind: 'sedan', model: 'wagon', w: 2, colors: [0x4a90a0] },
  { kind: 'sedan', model: 'coupe', w: 1, colors: [0x2030c0] },
  { kind: 'suv', model: 'suv', w: 2, colors: [0x202020] },
  { kind: 'suv', model: 'offroad', w: 1, colors: [0x2a4a20] },
  { kind: 'suv', model: 'minivan', w: 2, colors: [0x801818] },
  { kind: 'suv', model: 'pickup', w: 2, colors: [0x1a6a2a] },
  { kind: 'sedan', model: 'hatchback', taxi: true, w: 1, colors: [0xf4c400] },
  { kind: 'truck', w: 1, colors: [0xffffff, 0x1a4aa0, 0xa01a1a] },
];
// Models rivals drive (the player's own model is skipped so a rival never looks like a recoloured copy of you).
export const RIVAL_MODELS = [{ model: 'sport' }, { model: 'concept', kind: 'gt' }, { model: 'coupe' }, { model: 'ferrari', kind: 'super' }, { model: 'wagon' }];

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const colRes = {};
const UP = new THREE.Vector3(0, 1, 0);

export class Car {
  constructor(game, spec, opts = {}) {
    this.game = game;
    this.spec = spec;
    this.role = opts.role || 'traffic';
    this.name = opts.name || spec.name || 'CAR';
    const police = this.role === 'cop' || opts.police;
    this.police = police;
    this.model = buildCar(spec.kind, {
      model: opts.model ?? spec.model,
      color: police ? 0x0b0b0d : opts.color ?? spec.color,
      color2: police ? 0xf2f2f2 : opts.color2 ?? spec.color2,
      livery: police ? 'police' : opts.livery ?? spec.livery ?? 'plain',
      police, taxi: opts.taxi, lod: this.role === 'player' ? 'hi' : 'lo',
    });
    game.scene.add(this.model.root);
    this.dims = this.model.dims;
    // soft ambient-occlusion blob under the car: grounds it far better than a 10 cm/texel shadow map can
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobMat(), transparent: true, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    blob.scale.set(this.dims.W * 1.45, 1, this.dims.L * 1.25); blob.position.y = -0.14; blob.renderOrder = 3;
    this.model.root.add(blob); this.blob = blob;
    // spring-damper suspension state (pitch / roll / heave), underdamped so it settles with a bounce
    this.susp = { p: 0, pv: 0, r: 0, rv: 0, h: 0, hv: 0 };
    this.radius = Math.min(this.dims.W / 2 + 0.05, 1.15);
    this.circOff = this.dims.L / 2 - this.radius * 0.9;
    this.mass = spec.mass || (spec.kind === 'truck' ? 3 : spec.kind === 'suv' ? 1.5 : 1.1);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();
    this.yaw = 0; this.angVel = 0; this.vy = 0; this.grounded = true; this.airTime = 0;
    this.steerAngle = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 };
    this.nitro = 0.5; this.nitroActive = false;
    this.health = 1; this.wrecked = false; this.wreckTime = 0;
    this.drifting = false; this.slip = 0; this.speed = 0; this.vF = 0; this.vR = 0;
    this.flatTimer = 0; this.empTimer = 0;
    this.offroad = false;
    this.wheelSpin = 0;
    this.pitch = 0; this.roll = 0; this.bodyPitch = 0; this.bodyRoll = 0;
    this.accelLong = 0; this.accelLat = 0;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.lastImpact = 0;
    this.gear = 1; this.rpm = 0.2; this.shiftTimer = 0;
    this.sirenPhase = Math.random() * 10;
    this.active = true;
    this.visible = true;
  }

  get fwdX() { return Math.sin(this.yaw); }
  get fwdZ() { return Math.cos(this.yaw); }

  place(x, z, yaw, speed = 0) {
    this.pos.set(x, this.game.world.heightAt(x, z) + RIDE, z);
    this.yaw = yaw;
    this.vel.set(Math.sin(yaw) * speed, Math.cos(yaw) * speed);
    this.angVel = 0; this.vy = 0; this.grounded = true; this.prevG = undefined; this.airTime = 0;
    this.vPitch = undefined; this.vRoll = undefined; this.vLift = undefined; this.slopeVs = undefined;
    this.normal.set(0, 1, 0);
    this.syncVisual(0);
  }

  addInterior() { this.interior = buildInterior(this.model); }

  setVisible(v) { this.visible = v; this.model.root.visible = v; }

  step(dt) {
    if (!this.active) return;
    const spec = this.spec;
    const inp = this.wrecked ? { throttle: 0, brake: 0.3, steer: 0, handbrake: 1, nitro: 0 } : this.input;
    const emp = this.empTimer > 0;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    let vF = this.vel.x * fx + this.vel.y * fz;
    let vR = this.vel.x * rx + this.vel.y * rz;
    const world = this.game.world;
    this.offroad = !world.hf.onRoad(this.pos.x, this.pos.z);
    const sp = Math.abs(vF);

    // nitro
    this.nitroActive = !!(inp.nitro && this.nitro > 0.01 && inp.throttle > 0.1 && !emp);
    if (this.nitroActive) this.nitro = Math.max(0, this.nitro - dt * (this.role === 'player' ? 0.22 : 0.3));

    let maxV = spec.top * (this.nitroActive ? 1.2 : 1) * (this.flatTimer > 0 ? 0.55 : 1) * (0.82 + 0.18 * this.health) * (emp ? 0.5 : 1);
    if (this.offroad) maxV *= 0.62;
    if (this.boost) maxV *= this.boost;
    let a = 0;
    if (this.grounded) {
      if (inp.throttle > 0) {
        if (vF < maxV) {
          const r = clamp(vF / maxV, 0, 1);
          a += spec.accel * 0.82 * (1 - Math.pow(r, 1.5) * 0.85) * inp.throttle * (this.boost || 1);
          if (this.nitroActive) a += 13;
        } else a -= (vF - maxV) * 0.8;
      }
      if (inp.brake > 0) {
        if (vF > 0.8) a -= 34 * inp.brake;
        else if (vF > -16) a -= 9 * inp.brake;
      }
      if (!inp.throttle && !inp.brake) a -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, 1.4 + 0.0006 * vF * vF);
      if (this.offroad) a -= vF * 0.18;
      if (inp.handbrake && sp > 1) a -= Math.sign(vF) * 7;
    }
    const vFprev = vF;
    vF += a * dt;
    if (this.grounded && inp.brake > 0 && vFprev > 0.8 && vF < 0) vF = 0;

    // drift state
    const slip = Math.atan2(vR, Math.max(Math.abs(vF), 1));
    if (inp.handbrake && sp > 14 && Math.abs(inp.steer) > 0.1) this.drifting = true;
    if (this.drifting && ((!inp.handbrake && Math.abs(slip) < 0.1) || sp < 9)) this.drifting = false;
    if (this.drifting && inp.brake > 0.5 && !inp.handbrake && Math.abs(slip) < 0.2) this.drifting = false;
    this.slip = slip;

    if (this.grounded) {
      let grip = spec.grip * (this.offroad ? 0.6 : 1) * (this.flatTimer > 0 ? 0.6 : 1);
      if (this.drifting) grip *= inp.handbrake ? 0.14 : 0.3;
      if (this.wrecked) grip = 2;
      const nvR = vR * Math.exp(-grip * dt);
      const lost = Math.abs(vR - nvR);
      vR = nvR;
      if (this.drifting && vF > 0) vF += lost * 0.45; // keep momentum in drifts
      // steering
      const steerMax = lerp(0.6, 0.14, clamp(sp / 65, 0, 1));
      this.steerAngle = damp(this.steerAngle, inp.steer * steerMax, 10, dt);
      const latAcc = 30 * spec.steer * (this.drifting ? 1.75 : 1) * (this.offroad ? 0.8 : 1);
      const geomRate = (sp / 2.8) * Math.tan(Math.abs(inp.steer) * 0.6);
      const maxRate = Math.min(geomRate, latAcc / Math.max(sp, 1), 2.4);
      let target = Math.sign(inp.steer) * maxRate * Math.sign(vF || 1);
      if (this.drifting) target += -slip * 0.6 * Math.sign(vF); // natural counter-yaw
      this.angVel = damp(this.angVel, target, this.drifting ? 5 : 9, dt);
    } else {
      this.angVel *= Math.exp(-0.5 * dt);
    }
    const ax = fx * vF + rx * vR, az = fz * vF + rz * vR;
    this.accelLong = lerp(this.accelLong, a, 0.1);
    this.accelLat = lerp(this.accelLat, this.angVel * vF, 0.1);
    this.vel.set(ax, az);
    this.yaw = wrapAngle(this.yaw + this.angVel * dt);
    this.pos.x += ax * dt; this.pos.z += az * dt;

    // vertical
    const g = world.heightAt(this.pos.x, this.pos.z) + RIDE;
    const wasGrounded = this.grounded;
    // slope the car is rolling along (m/s of vertical ground motion)
    const rawSlopeV = this.prevG !== undefined ? clamp((g - this.prevG) / dt, -30, 30) : 0;
    // low-pass: a 1-step ground-height jump (mesh seams, segment switches) must not read as a launch ramp
    this.slopeVs = this.slopeVs === undefined || !wasGrounded ? rawSlopeV : this.slopeVs + (rawSlopeV - this.slopeVs) * Math.min(1, dt * 14);
    const slopeV = this.slopeVs;
    this.vy -= 22 * dt;
    this.pos.y += this.vy * dt;
    // ground adhesion: suspension keeps tyres on the road over crests and dips unless the car is genuinely launched
    // (big vertical speed relative to the surface, or well clear of it). Fixes cars hopping at every grade change.
    const gap = this.pos.y - g;
    const stick = wasGrounded && gap < 0.9 && (this.vy - slopeV) < 5.5;
    if (this.pos.y <= g || stick) {
      if (!wasGrounded) { const imp = clamp(-this.vy, 0, 25); this.susp.hv -= imp * 0.11; this.susp.pv += (Math.random() - 0.5) * imp * 0.004; }
      if (!wasGrounded && this.airTime > 0.35) this.game.onLanding(this, this.airTime);
      this.pos.y = g; this.vy = clamp(slopeV, -30, 14); this.grounded = true; this.airTime = 0;
    } else if (gap > 0.25) { this.grounded = false; this.airTime += dt; }
    this.prevG = g;

    // world bounds
    const B = 1900;
    if (Math.abs(this.pos.x) > B) { this.pos.x = Math.sign(this.pos.x) * B; this.vel.x *= -0.3; }
    if (Math.abs(this.pos.z) > B) { this.pos.z = Math.sign(this.pos.z) * B; this.vel.y *= -0.3; }

    // static collisions (2 circles)
    this.collideStatic();

    this.vF = this.vel.x * Math.sin(this.yaw) + this.vel.y * Math.cos(this.yaw);
    this.vR = this.vel.x * -Math.cos(this.yaw) + this.vel.y * Math.sin(this.yaw);
    this.speed = this.vel.length();
    if (this.flatTimer > 0) this.flatTimer -= dt;
    if (this.empTimer > 0) this.empTimer -= dt;
    this.wheelSpin += (vF / this.dims.wheelR) * dt;
    // gear/rpm model
    // hysteresis: upshift at the ratio limit, downshift a bit below it (no gear hunting)
    const ratios = [0, 16, 29, 42, 56, 71, 999];
    const av = Math.abs(vF);
    let gear = this.gear || 1;
    while (gear < 6 && av > ratios[gear]) gear++;
    while (gear > 1 && av < ratios[gear - 1] * 0.86) gear--;
    if (gear !== this.gear) {
      this.shifted = gear > this.gear ? 1 : -1;
      this.shiftTimer = gear > this.gear ? 0.3 : 0.2; // clutch-in time: revs hang then settle
      this.gear = gear;
    }
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    const lo = ratios[gear - 1], hi = Math.min(ratios[gear], spec.top * 1.2);
    const tr = clamp((av - lo) / (hi - lo), 0, 1);
    const targetRpm = this.grounded ? 0.25 + tr * 0.72 : 0.95 * (inp.throttle || 0.4);
    const shifting = this.shiftTimer > 0;
    // on throttle the revs fall slowly during an upshift and snap up on a downshift blip
    const lam = shifting ? (this.shifted > 0 ? 4.5 : 16) : (targetRpm > this.rpm ? 11 : 6);
    this.rpm = damp(this.rpm, Math.max(targetRpm, inp.throttle > 0 && sp < 3 ? 0.55 : 0.18), lam, dt);
  }

  collideStatic() {
    const st = this.game.world.statics;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const s of [1, 0, -1]) { // front / middle / rear circles: no gaps along the body
      const cx = this.pos.x + fx * this.circOff * s, cz = this.pos.z + fz * this.circOff * s;
      const r = st.collide(cx, cz, this.radius, colRes);
      if (!r) continue;
      this.pos.x += r.px; this.pos.z += r.pz;
      const nx = r.nx, nz = r.nz;
      const vn = this.vel.x * nx + this.vel.y * nz;
      if (vn < 0) {
        const tx = -nz, tz = nx;
        const vt = this.vel.x * tx + this.vel.y * tz;
        const impact = -vn;
        const e = 0.25;
        const newVn = -vn * e;
        const newVt = vt * (1 - Math.min(0.5, impact * 0.012));
        this.vel.set(nx * newVn + tx * newVt, nz * newVn + tz * newVt);
        // yaw kick
        const cross = fx * nz - fz * nx;
        this.angVel += cross * s * impact * 0.04;
        if (impact > 3) this.game.onImpact(this, null, impact, cx - nx * this.radius, cz - nz * this.radius, r.tag);
      }
    }
  }

  syncVisual(dt, time = 0) {
    const m = this.model;
    const world = this.game.world;
    m.root.position.copy(this.pos);
    // orient to terrain normal
    if (this.grounded) {
      world.hf.normal(this.pos.x, this.pos.z, tmpN);
      this.normal.lerp(tmpN, dt ? Math.min(1, dt * 10) : 1);
    }
    const n = this.normal;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // pitch from normal along forward, roll from normal along right
    const targetPitch = Math.asin(clamp(n.x * fx + n.z * fz, -1, 1));
    const targetRoll = Math.asin(clamp(n.x * -fz + n.z * fx, -1, 1));
    this.pitch = dt ? damp(this.pitch, targetPitch, 10, dt) : targetPitch;
    this.roll = dt ? damp(this.roll, targetRoll, 10, dt) : targetRoll;
    // sample the real surface under all four wheels -> pitch/roll/ride-height that follow the road, no wheel clipping
    let lift = 0;
    if (this.grounded) {
      const wbh = this.dims.wb, hwt = this.dims.W / 2 - 0.2, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      const hs = (lz, lx) => world.heightAt(this.pos.x + sy * lz + cy * lx, this.pos.z + cy * lz - sy * lx);
      const hFL = hs(wbh, -hwt), hFR = hs(wbh, hwt), hRL = hs(-wbh, -hwt), hRR = hs(-wbh, hwt);
      const tp = Math.atan2((hFL + hFR) - (hRL + hRR), 4 * wbh);
      const tr = Math.atan2((hFR + hRR) - (hFL + hRL), 4 * hwt);
      this.vPitch = dt ? damp(this.vPitch ?? tp, tp, 18, dt) : tp;
      this.vRoll = dt ? damp(this.vRoll ?? tr, tr, 18, dt) : tr;
      const avg = (hFL + hFR + hRL + hRR) / 4;
      const tl = avg - (this.pos.y - RIDE);
      this.vLift = dt ? damp(this.vLift ?? tl, tl, 18, dt) : tl;
      lift = this.vLift;
    } else { this.vPitch = this.pitch; this.vRoll = this.roll; this.vLift = 0; }
    m.root.position.y = this.pos.y + lift;
    m.root.rotation.set(0, 0, 0);
    m.root.rotation.order = 'YXZ';
    m.root.rotation.y = this.yaw;
    m.root.rotation.x = this.grounded ? -this.vPitch : this.pitch;
    m.root.rotation.z = this.grounded ? this.vRoll : this.roll;
    // body motion: real spring-damper on pitch / roll / heave. Squats on throttle, dives on brakes, rolls in corners,
    // rebounds after bumps and landings, and shudders with the engine - so the car reads as a heavy object on springs.
    const S = this.susp, sdt = Math.min(dt || 0, 0.033);
    if (sdt > 0) {
      const tp = clamp(-this.accelLong * 0.0046, -0.07, 0.07);
      const tr = clamp(this.accelLat * 0.0068, -0.1, 0.1);
      const rough = (this.offroad ? 1 : 0.18) * clamp(this.speed / 40, 0, 1);
      const sub = 2, h = sdt / sub;
      for (let i = 0; i < sub; i++) {
        S.pv += ((tp - S.p) * 110 - S.pv * 11) * h; S.p += S.pv * h;
        S.rv += ((tr - S.r) * 120 - S.rv * 11.5) * h; S.r += S.rv * h;
        S.hv += ((0 - S.h) * 140 - S.hv * 13) * h; S.h += S.hv * h;
      }
      // road texture + engine vibration
      const t = time * 1;
      S.hv += (Math.sin(t * 61 + this.sirenPhase) * 0.5 + Math.sin(t * 97)) * 0.012 * rough;
      S.pv += Math.sin(t * 43 + 1.7) * 0.004 * rough;
      if (this.role === 'player' && this.grounded) S.h += Math.sin(t * (30 + this.rpm * 70)) * 0.0011 * (0.35 + this.rpm);
      S.p = clamp(S.p, -0.12, 0.12); S.r = clamp(S.r, -0.16, 0.16); S.h = clamp(S.h, -0.14, 0.14);
    }
    this.bodyPitch = S.p; this.bodyRoll = S.r;
    m.body.rotation.x = S.p;
    m.body.rotation.z = S.r;
    m.body.position.y = S.h;
    if (this.blob) { this.blob.material.opacity = this.grounded ? 0.8 : clamp(0.8 - this.airTime * 1.2, 0.15, 0.8); this.blob.visible = this.visible; }
    // wheels
    const blurA = clamp((Math.abs(this.vF) - 10) / 32, 0, 0.62);
    for (const w of m.wheels) {
      if (w.blur) { w.blur.material.opacity = blurA; w.blur.visible = blurA > 0.02; }
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = this.steerAngle * 1.2;
    }
    if (this.interior) this.interior.wheel.rotation.z = -this.steerAngle * 3;
    // brake lights
    const braking = this.input.brake > 0.1 && this.vF > 1;
    m.tailMat.emissiveIntensity = braking ? 6 : 1.4;
    // siren
    if (this.police && m.siren.rMat) {
      const on = this.sirenOn !== false && !this.wrecked;
      const t = time + this.sirenPhase;
      const ph = (t * 2.2) % 1;
      const flashA = on && ((ph < 0.12) || (ph > 0.2 && ph < 0.32));
      const flashB = on && ((ph > 0.5 && ph < 0.62) || (ph > 0.7 && ph < 0.82));
      m.siren.rMat.emissiveIntensity = flashA ? 12 : 0.2;
      m.siren.bMat.emissiveIntensity = flashB ? 14 : 0.2;
      m.siren.rs.visible = flashA; m.siren.bs.visible = flashB;
      m.siren.rs2.visible = flashB; m.siren.bs2.visible = flashA;
      this.flashA = flashA; this.flashB = flashB;
    }
    m.paint.userData.u.uDmg.value = clamp((1 - this.health) * 0.9, 0, 0.9);
    if (m.dmgMats && m.dmgMats.length) { const k = 1 - clamp((1 - this.health) * 0.9, 0, 0.9) * 0.6; for (const dm of m.dmgMats) dm.color.setScalar(k); }
  }

  dispose() {
    this.game.scene.remove(this.model.root);
    this.model.root.traverse((o) => { if (o.isMesh && o.geometry && !this.model.root.userData.sharedGeo) o.geometry.dispose(); });
  }
}
