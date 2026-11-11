// ===== Car physics + visual sync =====
import * as THREE from 'three';
import { buildCar, buildInterior } from './carModel.js';
import { clamp, lerp, damp, wrapAngle } from './util.js';
import { glowTexture } from './textures.js';
import { resolveEngine } from './engineProfiles.js';
import { G, G_VERT } from './units.js';
const RIDE = 0.02; // tyre contact height above the road surface (m)

let blobTex = null, blurTex = null;
const blobMat = () => (blobTex ||= glowTexture('rgba(0,0,0,0.9)', 'rgba(0,0,0,0)', 128));

export const PLAYER_CARS = [
  { id: 'viper', name: 'VIPER GT', kind: 'super', top: 91.7, accel: 18.0, grip: 9.5, steer: 1.0, mass: 1.0, armor: 1.0, color: 0xc8101a, color2: 0x101010, livery: 'stripe', desc: 'Balanced supercar · 330 km/h' },
  { id: 'kaiser', name: 'KAISER RS', kind: 'gt', top: 87.5, accel: 16.5, grip: 8.8, steer: 0.92, mass: 1.1, armor: 1.1, color: 0xe8ecf0, color2: 0x1846ff, livery: 'stripe', desc: 'Twin-turbo GT coupe · 315 km/h' },
  { id: 'bruiser', name: 'BRUISER V8', kind: 'muscle', top: 75.0, accel: 17.5, grip: 8.6, steer: 0.95, mass: 1.45, armor: 1.5, color: 0xff7a00, color2: 0x111111, livery: 'split', desc: 'American V8 muscle · 270 km/h' },
  { id: 'cyber', name: 'CYBERTRUCK', kind: 'suv', cg: 0.74, model: 'cybertruck', top: 58.3, accel: 18.5, grip: 8.0, steer: 0.82, mass: 1.9, armor: 1.9, color: 0xb8bcc2, color2: 0x111111, livery: 'plain', desc: 'Stainless-steel EV pickup · 210 km/h' },
  { id: 'gt3rs', name: 'GT3 RS', kind: 'super', cg: 0.44, model: 'gt3rs', top: 82.2, accel: 18.5, grip: 10.6, steer: 1.12, mass: 0.95, armor: 0.85, color: 0xd8d018, color2: 0x111111, livery: 'plain', desc: 'Track-bred 992 weapon · 296 km/h' },
  { id: 'vito', name: 'VITO VAN', kind: 'suv', cg: 0.78, model: 'vito', top: 55.6, accel: 11.0, grip: 7.4, steer: 0.78, mass: 2.1, armor: 1.7, color: 0xf2f2f2, color2: 0x111111, livery: 'plain', desc: 'Mercedes diesel utility van · 200 km/h' },
  { id: 'mini', name: 'MINI COOPER S', kind: 'sedan', cg: 0.5, model: 'mini', top: 66.7, accel: 14.5, grip: 9.4, steer: 1.18, mass: 0.85, armor: 0.75, color: 0xc8102e, color2: 0x111111, livery: 'plain', desc: 'Pocket rocket turbo hatch · 240 km/h' },
  { id: 'jesko', name: 'JESKO ATTACK', kind: 'super', cg: 0.42, model: 'jesko', top: 141.7, accel: 22.0, grip: 10.8, steer: 1.04, mass: 1.0, armor: 0.8, color: 0xe8e8ea, color2: 0x111111, livery: 'plain', desc: 'Koenigsegg 1600 hp hypercar · 510 km/h' },
  { id: 'corolla', name: 'COROLLA 2020', kind: 'sedan', cg: 0.52, model: 'corolla', top: 54.2, accel: 11.5, grip: 8.6, steer: 1.02, mass: 1.0, armor: 1.0, color: 0xc8ccd2, color2: 0x111111, livery: 'plain', desc: 'Everyday 2.0L sedan · 195 km/h' },
  { id: 'model_s', name: 'MODEL S P100D', kind: 'gt', cg: 0.48, model: 'model_s', top: 69.4, accel: 20.5, grip: 9.4, steer: 1.0, mass: 1.35, armor: 1.15, color: 0x1a1a1e, color2: 0x111111, livery: 'plain', desc: 'Ludicrous AWD EV sedan · 250 km/h' },
  { id: 'mclaren', name: '720S', kind: 'super', cg: 0.43, model: 'mclaren', top: 94.7, accel: 19.8, grip: 10.4, steer: 1.1, mass: 0.92, armor: 0.82, color: 0xe85a00, color2: 0x111111, livery: 'plain', desc: 'Papaya twin-turbo V8 supercar · 341 km/h' },
  { id: 'gwagon', name: 'G 63 AMG', kind: 'suv', cg: 0.76, model: 'gwagon', top: 61.1, accel: 16.8, grip: 8.3, steer: 0.84, mass: 2.05, armor: 1.85, color: 0x1a1a1a, color2: 0x111111, livery: 'plain', desc: 'Boxy bi-turbo V8 bruiser · 220 km/h' },
  { id: 'civic', name: 'CIVIC TYPE R', kind: 'sedan', cg: 0.5, model: 'civic', top: 66.7, accel: 15.5, grip: 9.6, steer: 1.15, mass: 0.9, armor: 0.8, color: 0xc8102e, color2: 0x111111, livery: 'plain', desc: 'EK9 B16B scream machine · 240 km/h' },
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

// held-steer ramp: full effect after HOLD_RAMP_S of continuous steering in one direction; HOLD_GAIN = extra steering authority at full hold
const HOLD_RAMP_S = 0.7, HOLD_GAIN = 1.05;
// brake hold bite: tap ≈ half force, full bite after BRAKE_RAMP_S via quadratic ramp
const BRAKE_RAMP_S = 0.55;
export class Car {
  constructor(game, spec, opts = {}) {
    this.game = game;
    this.spec = spec;
    this.role = opts.role || 'traffic';
    this.name = opts.name || spec.name || 'CAR';
    const military = !!(opts.military || spec.kind === 'tank');
    const police = !military && (this.role === 'cop' || opts.police);
    this.police = police;
    this.military = military;
    this.model = buildCar(spec.kind, {
      model: opts.model ?? spec.model,
      color: military ? (opts.color ?? spec.color ?? 0x6a7e42) : police ? 0x0b0b0d : opts.color ?? spec.color,
      color2: military ? (opts.color2 ?? spec.color2 ?? 0x3f4c28) : police ? 0xf2f2f2 : opts.color2 ?? spec.color2,
      livery: military ? 'plain' : police ? 'police' : opts.livery ?? spec.livery ?? 'plain',
      police, taxi: opts.taxi, lod: this.role === 'player' ? 'hi' : 'lo',
    });
    this._lampMounts = null; // invalidate if a pooled car ever swaps models
    game.scene.add(this.model.root);
    this.dims = this.model.dims;
    // soft ambient-occlusion blob under the car: grounds it far better than a 10 cm/texel shadow map can
    // Traffic/cops skip the transparent plane (one extra blend draw × every AI car)
    if (this.role === 'player' || this.role === 'racer') {
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobMat(), transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
      blob.scale.set(this.dims.W * 1.25, 1, this.dims.L * 1.1); blob.position.y = -0.14; blob.renderOrder = 3;
      this.model.root.add(blob); this.blob = blob;
    } else this.blob = null;
    // spring-damper suspension state (pitch / roll / heave), underdamped so it settles with a bounce
    this.susp = { p: 0, pv: 0, r: 0, rv: 0, h: 0, hv: 0 };
    this.radius = Math.min(this.dims.W / 2 + 0.05, 1.15);
    this.circOff = this.dims.L / 2 - this.radius * 0.9;
    this.cgH = spec.cg ?? ({ super: 0.46, gt: 0.5, muscle: 0.55, sedan: 0.58, suv: 0.72, truck: 0.95, tank: 0.85 }[spec.kind] ?? 0.55);
    this.mass = spec.mass || (spec.kind === 'tank' ? 6 : spec.kind === 'truck' ? 3 : spec.kind === 'suv' ? 1.5 : 1.1);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();
    this.yaw = 0; this.angVel = 0; this.vy = 0; this.grounded = true; this.airTime = 0;
    this.steerAngle = 0; this.steerWheel = 0; this.surfMu = 1; this.sliding = false;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 };
    this.brakeHoldT = 0;
    this.nitro = 0.5; this.nitroActive = false;
    this.health = 1; this.wrecked = false; this.wreckTime = 0;
    this.drifting = false; this.wasDrifting = false; this.slip = 0; this.speed = 0; this.vF = 0; this.vR = 0;
    this.exitBoost = 0; // seconds of post-drift exit boost remaining
    this.flatTimer = 0; this.empTimer = 0;
    this.offroad = false;
    this.wheelSpin = 0;
    this.pitch = 0; this.roll = 0; this.bodyPitch = 0; this.bodyRoll = 0;
    this.accelLong = 0; this.accelLat = 0; // measured body-frame accel (m/s²), IMU-style
    this.imuLong = 0; this.imuLat = 0; this.imuVert = 0;
    this.odometer = 0; // metres driven this life
    this._imuReady = false;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.lastImpact = 0;
    this.gear = 1; this.rpm = 0.2; this.shiftTimer = 0;
    this.sirenPhase = Math.random() * 10;
    this.signal = 0; // 0 | 'L' | 'R' — AI intent drives blinkers in syncVisual
    this.active = true;
    this.visible = true;
  }

  // lateral grip limit in m/s² (no downforce): what the AI plans its corner speeds around
  gripLimit() { return (this.spec.grip / 7.6) * G; }

  // gear speed bands [0, shift1, shift2, …, 999] and gear count for this car
  gearBands() {
    const eng = resolveEngine(this.spec.id, this.spec.kind);
    if (eng.electric > 0.5) return null;
    const shifts = eng.shiftSpeeds?.length ? eng.shiftSpeeds : [16, 29, 42, 56, 71];
    const maxGear = shifts.length + 1;
    const top = this.spec.top;
    // vRed(g): road speed (m/s) at which gear g hits redline. Engine RPM is proportional to road speed in a gear
    // (fixed ratio), so rpm/redline = speed / vRed(g). Auto upshifts happen at ~92% of redline.
    const vRed = (g) => (g < maxGear ? shifts[g - 1] / 0.92 : Math.max(top / 0.95, shifts[maxGear - 2] / 0.92 * 1.15));
    return { ratios: [0, ...shifts, 999], maxGear, vRed, eng };
  }

  // Manual shift (dir +1 up / -1 down). The first call converts the gearbox to manual permanently.
  // Downshifts that would over-rev the engine are refused (rev-protection, like real manual-mode gearboxes).
  shiftManual(dir) {
    const b = this.gearBands();
    if (!b) return; // EV: single-speed, nothing to shift
    this.manual = true;
    const g = clamp((this.gear || 1) + dir, 1, b.maxGear);
    if (g === this.gear) return;
    if (dir < 0 && Math.abs(this.vF) / b.vRed(g) > 1.0) { this.shiftDenied = 1; return; }
    this.shifted = dir > 0 ? 1 : -1;
    this.shiftTimer = dir > 0 ? 0.3 : 0.2;
    this.gear = g;
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
    this._imuReady = false; this.accelLong = 0; this.accelLat = 0; this.imuLong = 0; this.imuLat = 0; this.imuVert = 0;
    this.odometer = 0;
    if (this.manual && speed < 5) { this.gear = 1; this.shiftTimer = 0; } // respawn from standstill in 1st
    this.syncVisual(0);
  }

  addInterior() { this.interior = buildInterior(this.model); }

  setVisible(v) { this.visible = v; this.model.root.visible = v; }
  setShadowCast(on) {
    if (this._castOn === on) return;
    this._castOn = on;
    // Honour the builder's castShadow picks (paint/glass/tyres) — flipping every mesh on floods the sun map
    this.model.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.shadowCaster == null) o.userData.shadowCaster = !!o.castShadow;
      o.castShadow = !!(on && o.userData.shadowCaster);
    });
  }

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

    let maxV = spec.top * (this.nitroActive ? 1.22 : 1) * (this.flatTimer > 0 ? 0.55 : 1) * (0.82 + 0.18 * this.health) * (emp ? 0.5 : 1);
    if (this.offroad) maxV *= 0.62;
    if (this.boost) maxV *= this.boost;
    if (this.exitBoost > 0) { maxV *= 1.12; this.exitBoost = Math.max(0, this.exitBoost - dt); }
    // manual gearbox: rev limiter caps speed per gear; too high a gear for the speed lugs (weak pull)
    let gearPull = 1;
    const mb = this.manual ? this.gearBands() : null;
    if (mb) {
      const g = clamp(this.gear || 1, 1, mb.maxGear);
      if (g < mb.maxGear) maxV = Math.min(maxV, mb.vRed(g)); // rev limiter
      const rf = sp / mb.vRed(g); // fraction of redline
      if (g > 1 && rf < 0.45) gearPull = clamp(0.25 + 0.75 * rf / 0.45, 0.25, 1); // lugging: little torque low in the rev range
      if (this.shiftTimer > 0) gearPull *= 0.35; // clutch in during the shift
      this._engBrake = this.shiftTimer > 0 ? 0 : (0.6 + 2.4 * rf) * (1.4 - g / mb.maxGear); // off-throttle engine braking, stronger in low gears
    } else this._engBrake = 0;

    // ---- tyre budget ----------------------------------------------------------------------------------------
    // One friction budget (mu*g) shared by braking, driving and cornering ("friction circle"). Surface, damage and
    // aero downforce (supercars / GTs) scale it. spec.grip 7.6 == mu 1.0. All forces in m/s².
    const rdist = this.offroad ? world.hf.roadDist(this.pos.x, this.pos.z) : 0;
    const surfMu = this.offroad ? (rdist < 3.5 ? 0.82 : 0.6) : 1; // gravel shoulder vs grass / dirt
    this.surfMu = surfMu;
    const df = spec.kind === 'super' ? 5.5e-5 : spec.kind === 'gt' ? 3.2e-5 : 0;
    const muG = (spec.grip / 7.6) * surfMu * (this.flatTimer > 0 ? 0.6 : 1) * (1 + df * vF * vF) * G;

    // progressive brake bite: longer hold → quadratic ramp up to full authority
    if (inp.brake > 0.05) this.brakeHoldT = Math.min(BRAKE_RAMP_S, this.brakeHoldT + dt);
    else this.brakeHoldT = Math.max(0, this.brakeHoldT - dt * 5);
    const bt = this.brakeHoldT / BRAKE_RAMP_S;
    const bite = 0.5 + 0.5 * bt * bt; // tap ≈ 0.5, full hold ≈ 1.0
    const brkAmt = clamp(inp.brake, 0, 1) * bite;

    let a = 0, aLong = 0; // aLong: longitudinal tyre demand (drive or brake), eats into the cornering budget
    if (this.grounded) {
      if (inp.throttle > 0) {
        if (vF < maxV) {
          const r = clamp(vF / maxV, 0, 1);
          let ad = spec.accel * 0.82 * (1 - Math.pow(r, 1.5) * 0.85) * inp.throttle * (this.boost || 1) * gearPull;
          if (this.nitroActive) ad += 15;
          if (this.exitBoost > 0) ad += 9;
          const trac = muG * 0.97; // traction limit: launches spin the wheels instead of teleporting
          if (ad > trac) ad = trac;
          a += ad; aLong = ad;
        } else a -= (vF - maxV) * 0.8;
      }
      if (brkAmt > 0) {
        if (vF > 0.8) { const bk = Math.min(muG * 1.45 + 0.0004 * vF * vF, 48) * brkAmt; a -= bk; aLong = Math.max(aLong, bk); } // tyres + a little aero drag
        else if (vF > -16) a -= 9 * brkAmt;
      }
      if (!inp.throttle && !inp.brake) a -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, 1.4 + 0.0006 * vF * vF + (vF > 3 ? this._engBrake || 0 : 0));
      if (this.offroad) a -= vF * 0.18;
      if (inp.handbrake && sp > 1) a -= Math.sign(vF) * 7;
      // gravity along the slope: climbs bleed speed, descents add it (grade from the smoothed ground speed)
      if (sp > 6 && this.slopeVs !== undefined) a -= G * clamp(this.slopeVs / vF, -0.22, 0.22);
    }
    const vFprev = vF;
    vF += a * dt;
    if (this.grounded && inp.brake > 0 && vFprev > 0.8 && vF < 0) vF = 0;

    // drift state
    const slip = Math.atan2(vR, Math.max(Math.abs(vF), 1));
    this.wasDrifting = this.drifting;
    if (inp.handbrake && sp > 14 && Math.abs(inp.steer) > 0.1) this.drifting = true;
    if (this.drifting && ((!inp.handbrake && Math.abs(slip) < 0.1) || sp < 9)) this.drifting = false;
    if (this.drifting && inp.brake > 0.5 && !inp.handbrake && Math.abs(slip) < 0.2) this.drifting = false;
    this.slip = slip;

    if (this.grounded) {
      // ---- centre of gravity + load transfer -------------------------------------------------------------------
      // cg: height of the centre of gravity (m). A high CG (SUV / truck) transfers more load in corners and under braking:
      // less peak sideways grip, more body roll / pitch. A low CG (supercar) stays flat and planted.
      const cg = this.cgH;
      const brk = clamp((-a - 5) / 20, 0, 1);   // braking hard: weight goes forward, rear gets light -> a little rotation, a little less rear grip
      const acc = clamp((a - 4) / 14, 0, 1);    // accelerating hard: weight goes rearward, front gets light -> a little understeer
      let grip = spec.grip * 1.12 * (this.offroad ? 0.6 : 1) * (this.flatTimer > 0 ? 0.6 : 1) * (1 - 0.1 * brk) * (1 - 0.12 * (cg - 0.5)); // sideways grip: ~12% more than before
      if (this.drifting) grip *= inp.handbrake ? 0.14 : 0.3;
      if (this.wrecked) grip = 2;
      const nvR = vR * Math.exp(-grip * dt);
      const lost = Math.abs(vR - nvR);
      vR = nvR;
      if (this.drifting && vF > 0) vF += lost * 0.45; // keep momentum in drifts
      // cornering budget (m/s^2): friction circle - driving or braking hard leaves slightly less for turning; cg trims it
      const al = Math.min(aLong, muG * 0.97);
      const circle = Math.sqrt(Math.max(0.68, 1 - (al / muG) ** 2 * 0.32));
      // held steering: the longer the same direction is held, the more aggressive the turn-in (applies to both player and AI so NPCs can make tight turns)
      let hold = 0;
      const sIn = inp.steer;
      const rampS = this.role === 'player' && !this.game.demo ? HOLD_RAMP_S : 0.45;
      if (Math.abs(sIn) > 0.18) {
        if (Math.sign(sIn) !== this.holdDir) { this.holdDir = Math.sign(sIn); this.holdT = 0; }
        this.holdT = Math.min(rampS, (this.holdT || 0) + dt);
      } else this.holdT = Math.max(0, (this.holdT || 0) - dt * 4);
      hold = (this.holdT || 0) / rampS;
      const holdBoost = 1 + HOLD_GAIN * hold;
      this.holdBoost = holdBoost;
      const capLat = muG * 1.32 * circle * (1 - 0.28 * (cg - 0.5)) * (this.drifting ? 1.85 : 1) * (1 + 0.7 * HOLD_GAIN * hold);
      // steering: road-wheel angle is *proportional* to the wheel input, and full lock is scaled so it just reaches the grip limit at that speed.
      const wb2 = Math.max(2.2, this.dims.wb * 2);
      const dMax = (this.drifting ? 0.58 : clamp(Math.atan(wb2 * capLat * spec.steer * holdBoost / Math.max(sp * sp, 22)), 0.025, 0.72 + 0.18 * hold));
      this.steerAngle = damp(this.steerAngle, inp.steer * dMax, 14, dt);
      this.steerWheel = damp(this.steerWheel || 0, inp.steer, 16, dt);
      let target = vF * Math.tan(this.steerAngle) / wb2; // bicycle-model yaw rate
      target *= (1 + 0.18 * brk) * (1 - 0.08 * acc);      // trail-braking tightens the line, power-on pushes wide
      const capYaw = Math.min(3.1, capLat / Math.max(sp, 2.2));
      target = clamp(target, -capYaw, capYaw);
      // NPCs need stronger straight-line pull-back — player-tuned low stability makes traffic/cops orbit targets
      const npc = this.role !== 'player';
      const stab = npc ? 1.45 : 0.55 * (1 - 0.65 * hold);
      if (this.drifting) target += -slip * 0.55 * Math.sign(vF); // natural counter-yaw
      else target += -slip * stab * clamp(sp / 40, 0, 1) * Math.sign(vF || 1);
      // yaw response: snappy for player; NPCs slower so steerToward doesn't oscillate into doughnuts
      const resp = (npc ? lerp(6.5, 4.2, clamp(sp / 60, 0, 1)) : lerp(13, 8.5, clamp(sp / 60, 0, 1))) / (0.85 + 0.15 * this.mass);
      if (npc) target = clamp(target, -2.2, 2.2);
      this.angVel = damp(this.angVel, target, this.drifting ? (npc ? 4 : 6.5) : resp, dt);
      // cornering scrub: a car that is turned hard sheds a little speed
      if (!this.drifting && sp > 8) vF -= Math.sign(vF) * Math.abs(this.angVel * vF) * 0.012 * dt * 60 * 0.5;
    } else {
      this.angVel *= Math.exp(-0.5 * dt);
    }
    const ax = fx * vF + rx * vR, az = fz * vF + rz * vR;
    this.vel.set(ax, az);
    this.yaw = wrapAngle(this.yaw + this.angVel * dt);
    this.pos.x += ax * dt; this.pos.z += az * dt;

    // vertical — arcade G_VERT for road stick; IMU still reports real G via measured Δv
    const g = world.heightAt(this.pos.x, this.pos.z) + RIDE;
    const wasGrounded = this.grounded;
    // slope the car is rolling along (m/s of vertical ground motion)
    const rawSlopeV = this.prevG !== undefined ? clamp((g - this.prevG) / dt, -30, 30) : 0;
    // low-pass: a 1-step ground-height jump (mesh seams, segment switches) must not read as a launch ramp
    this.slopeVs = this.slopeVs === undefined || !wasGrounded ? rawSlopeV : this.slopeVs + (rawSlopeV - this.slopeVs) * Math.min(1, dt * 14);
    const slopeV = this.slopeVs;
    this.vy -= G_VERT * dt;
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
    // Measured IMU accel from world velocity delta (m/s²) — what a real accelerometer would integrate
    {
      const invDt = 1 / Math.max(dt, 1e-4);
      if (this._imuReady) {
        const awx = (this.vel.x - this._px) * invDt;
        const awz = (this.vel.y - this._pz) * invDt;
        const awy = (this.vy - this._py) * invDt;
        const yfx = Math.sin(this.yaw), yfz = Math.cos(this.yaw);
        const yrx = yfz, yrz = -yfx; // right vector in XZ
        this.imuLong = awx * yfx + awz * yfz;
        this.imuLat = awx * yrx + awz * yrz;
        this.imuVert = awy;
        // frame-rate independent low-pass for body / HUD (still tracks hard hits)
        const k = 1 - Math.exp(-dt * 16);
        this.accelLong += (this.imuLong - this.accelLong) * k;
        this.accelLat += (this.imuLat - this.accelLat) * k;
      } else this._imuReady = true;
      this._px = this.vel.x; this._pz = this.vel.y; this._py = this.vy;
    }
    this.odometer += this.speed * dt;
    if (this.flatTimer > 0) this.flatTimer -= dt;
    if (this.empTimer > 0) this.empTimer -= dt;
    this.wheelSpin += (vF / this.dims.wheelR) * dt;
    // gear/rpm model — per-car shift points & redline (EV stays in a single virtual gear)
    const eng = resolveEngine(spec.id, spec.kind);
    const av = Math.abs(vF);
    if (eng.electric > 0.5) {
      // Single-speed EV: RPM tracks road speed toward motor redline; no shift events
      this.gear = 1;
      this.shifted = 0;
      const targetRpm = this.grounded
        ? clamp(av / Math.max(8, spec.top * 1.15), 0, 1) * (0.35 + inp.throttle * 0.65)
        : clamp(inp.throttle, 0, 1);
      this.rpm = damp(this.rpm, Math.max(targetRpm, 0.02), 10, dt);
    } else {
      const gb = this.gearBands();
      const { ratios, maxGear } = gb;
      let gear = clamp(this.gear || 1, 1, maxGear);
      if (!this.manual) {
        while (gear < maxGear && av > ratios[gear]) gear++;
        while (gear > 1 && av < ratios[gear - 1] * 0.86) gear--;
      }
      if (gear !== this.gear) {
        this.shifted = gear > this.gear ? 1 : -1;
        this.shiftTimer = gear > this.gear ? 0.3 : 0.2;
        this.gear = gear;
      }
      if (this.shiftTimer > 0) this.shiftTimer -= dt;
      // Physical RPM: in a fixed gear, engine RPM = redline × (road speed / speed-at-redline for that gear).
      // An upshift drops RPM by the ratio step, a downshift raises it — exactly like a real gearbox.
      const idle = eng.idleRpm || 700, red = eng.redlineRpm || 6500;
      const wheelRpm = red * clamp(av / gb.vRed(gear), 0, 1);
      // clutch slip at low road speed: idle off-throttle, launch revs (~45% of the band) on throttle
      const launch = inp.throttle > 0 ? idle + (red - idle) * (0.3 + 0.2 * inp.throttle) : idle;
      const engRpm = Math.max(wheelRpm, gear === 1 || av < 4 ? Math.min(launch, Math.max(idle, launch * (1 - av / 8)) ) : idle);
      let targetRpm = clamp((engRpm - idle) / (red - idle), 0, 1);
      if (!this.grounded) targetRpm = Math.max(targetRpm, 0.95 * (inp.throttle || 0)); // wheels unloaded: free-rev
      const shifting = this.shiftTimer > 0;
      const lam = shifting ? (this.shifted > 0 ? 9 : 14) : (targetRpm > this.rpm ? 12 : 8);
      this.rpm = damp(this.rpm, targetRpm, lam, dt);
    }
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
        // Arcade recovery: low bounce, keep most forward speed on scrapes so walls don't kill the run
        const player = this.role === 'player';
        const graze = Math.abs(vt) > impact * 1.1;
        const e = player ? (graze ? 0.04 : 0.1) : 0.25;
        const scrub = player ? (graze ? 0.04 : Math.min(0.28, impact * 0.006)) : Math.min(0.5, impact * 0.012);
        const newVn = -vn * e;
        const newVt = vt * (1 - scrub);
        this.vel.set(nx * newVn + tx * newVt, nz * newVn + tz * newVt);
        // yaw kick (softer for player scrapes)
        const cross = fx * nz - fz * nx;
        this.angVel += cross * s * impact * (player && graze ? 0.015 : 0.04);
        if (impact > (player ? 2.2 : 3)) this.game.onImpact(this, null, impact, cx - nx * this.radius, cz - nz * this.radius, r.tag);
      }
    }
  }

  // detail: 2 = player (full), 1 = near AI, 0 = far (pose + wheels only)
  syncVisual(dt, time = 0, detail = 2) {
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
    let lift = 0;
    // 4× height samples are for the player car only — near AI uses body normal (already lerped above)
    if (detail >= 2 && this.grounded) {
      const wbh = this.dims.wb, hwt = this.dims.W / 2 - 0.2, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      const hs = (lz, lx) => world.heightAt(this.pos.x + sy * lz + cy * lx, this.pos.z + cy * lz - sy * lx);
      const hFL = hs(wbh, -hwt), hFR = hs(wbh, hwt), hRL = hs(-wbh, -hwt), hRR = hs(-wbh, hwt);
      const tp = Math.atan2((hFL + hFR) - (hRL + hRR), 4 * wbh);
      const tr = Math.atan2((hFR + hRR) - (hFL + hRL), 4 * hwt);
      this.vPitch = dt ? damp(this.vPitch ?? tp, tp, 18, dt) : tp;
      this.vRoll = dt ? damp(this.vRoll ?? tr, tr, 18, dt) : tr;
      const avg = (hFL + hFR + hRL + hRR) / 4;
      const tl = Math.max(-0.02, avg - (this.pos.y - RIDE));
      this.vLift = dt ? damp(this.vLift ?? tl, tl, 18, dt) : tl;
      lift = this.vLift;
    } else {
      this.vPitch = this.pitch; this.vRoll = this.roll; this.vLift = 0;
    }
    m.root.position.y = this.pos.y + lift;
    m.root.rotation.set(0, 0, 0);
    m.root.rotation.order = 'YXZ';
    m.root.rotation.y = this.yaw;
    m.root.rotation.x = this.grounded ? -this.vPitch : this.pitch;
    m.root.rotation.z = this.grounded ? this.vRoll : this.roll;
    const S = this.susp, sdt = Math.min(dt || 0, 0.033);
    if (detail >= 1 && sdt > 0) {
      // body motion: spring-damper on pitch / roll / heave
      const cgk = this.cgH / 0.5;
      const tp = clamp(-this.accelLong * 0.0046 * cgk, -0.08, 0.08);
      const tr = clamp(this.accelLat * 0.0026 * cgk, -0.07, 0.07); // softer lean — less tippy in hard turns
      const rough = (this.offroad ? 1 : 0.18) * clamp(this.speed / 40, 0, 1);
      const sub = detail >= 2 ? 2 : 1, h = sdt / sub;
      for (let i = 0; i < sub; i++) {
        S.pv += ((tp - S.p) * 110 - S.pv * 11) * h; S.p += S.pv * h;
        S.rv += ((tr - S.r) * 120 - S.rv * 11.5) * h; S.r += S.rv * h;
        S.hv += ((0 - S.h) * 140 - S.hv * 13) * h; S.h += S.hv * h;
      }
      const t = time * 1;
      S.hv += (Math.sin(t * 61 + this.sirenPhase) * 0.5 + Math.sin(t * 97)) * 0.012 * rough;
      S.pv += Math.sin(t * 43 + 1.7) * 0.004 * rough;
      if (detail >= 2 && this.role === 'player' && this.grounded) S.h += Math.sin(t * (30 + this.rpm * 70)) * 0.0011 * (0.35 + this.rpm);
      S.p = clamp(S.p, -0.10, 0.10); S.r = clamp(S.r, -0.09, 0.09); S.h = clamp(S.h, -0.05, 0.12);
    }
    this.bodyPitch = S.p; this.bodyRoll = S.r;
    m.body.rotation.x = S.p;
    m.body.rotation.z = S.r;
    m.body.position.y = S.h;
    if (this.blob) { this.blob.material.opacity = this.grounded ? 0.8 : clamp(0.8 - this.airTime * 1.2, 0.15, 0.8); this.blob.visible = this.visible; }
    // wheels
    const blurA = detail >= 1 ? clamp((Math.abs(this.vF) - 10) / 32, 0, 0.62) : 0;
    for (const w of m.wheels) {
      if (w.blur) { w.blur.material.opacity = blurA; w.blur.visible = blurA > 0.02; }
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = this.steerAngle * 1.2;
    }
    if (detail >= 2 && this.interior) this.interior.wheel.rotation.z = -(this.steerWheel || 0) * 1.5;
    // brake lights — emissive + flare bloom punch; head flares dim in daylight
    const braking = this.input.brake > 0.1 && this.vF > 1;
    if (m.tailMat) m.tailMat.emissiveIntensity = braking ? 9 : 1.7;
    // keepTextures cars without remapped tailMat — brake punch on cached lamp mats (avoid per-frame traverse)
    if (detail >= 1 && m.glb && !m.tailMat) {
      if (!m.brakeMats) {
        m.brakeMats = [];
        m.body.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          const n = o.material.name || '';
          if (!/light|tail|lamp|luz|optik|SLight/i.test(n)) return;
          if (o.material.emissiveIntensity == null) return;
          o.userData.baseEm = o.material.emissiveIntensity || 1;
          m.brakeMats.push(o.material);
        });
      }
      for (const mat of m.brakeMats) mat.emissiveIntensity = braking ? (mat.userData.baseEm || 1) * 3.2 : (mat.userData.baseEm || 1);
    }
    const night = !!(this.game.world && this.game.world.isNight && this.game.world.isNight());
    const headMul = night ? 1 : 0.35;
    if (detail >= 1) for (const h of m.heads) {
      if (h.userData.lamp === 'head') {
        const s = (h.userData.baseScale || 1) * headMul;
        h.scale.set(s, s, 1);
        h.material.opacity = Math.min(1, (h.userData.baseOpacity || 0.7) * (night ? 1 : 0.4));
        continue;
      }
      if (h.userData.lamp !== 'tail') continue;
      const k = braking ? (h.userData.layer === 'core' ? 1.55 : 1.85) : 1;
      const s = (h.userData.baseScale || 1) * k;
      h.scale.set(s, s, 1);
      h.material.opacity = Math.min(1, (h.userData.baseOpacity || 0.7) * (braking ? 1.35 : 1));
    }
    // turn signals — pulse body lamp mesh emissives amber (~1.6 Hz). Flare sprites stay head/tail only.
    if (m.signals && detail >= 1) {
      const side = this.signal === 'L' || this.signal === 'R' ? this.signal : 0;
      const on = !!side && !this.wrecked && ((time * 3.2 + this.sirenPhase) % 1) < 0.55;
      for (const s of ['L', 'R']) {
        const lit = on && side === s;
        for (const mat of m.signals[s]) {
          if (!mat?.emissive) continue;
          const baseEm = mat.userData.baseEm ?? 1;
          const baseCol = mat.userData.baseEmColor ?? 0xfff4e0;
          if (lit) {
            mat.emissive.setHex(0xffa018);
            mat.emissiveIntensity = Math.max(baseEm, 0.8) * (night ? 6.5 : 4.2);
          } else {
            mat.emissive.setHex(baseCol);
            mat.emissiveIntensity = baseEm;
          }
        }
      }
    }
    // tank turret tracks the pursuit target when available
    if (m.turret && this.ai?.target && !this.wrecked) {
      const tg = this.ai.target;
      const dx = tg.pos.x - this.pos.x, dz = tg.pos.z - this.pos.z;
      const want = Math.atan2(dx, dz) - this.yaw;
      const cur = m.turret.rotation.y;
      m.turret.rotation.y = cur + wrapAngle(want - cur) * clamp(dt * 3.2, 0, 1);
    }
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
    if (m.paint.userData.u) m.paint.userData.u.uDmg.value = clamp((1 - this.health) * 0.9, 0, 0.9);
    if (detail >= 1 && m.dmgMats && m.dmgMats.length) { const k = 1 - clamp((1 - this.health) * 0.9, 0, 0.9) * 0.6; for (const dm of m.dmgMats) dm.color.setScalar(k); }
  }

  dispose() {
    this.game.scene.remove(this.model.root);
    this.model.root.traverse((o) => { if (o.isMesh && o.geometry && !this.model.root.userData.sharedGeo) o.geometry.dispose(); });
  }
}
