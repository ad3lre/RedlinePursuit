// ===== Military units for BLACKOUT: tanks + chase helicopters =====
import * as THREE from 'three';
import { clamp, lerp, wrapAngle } from './util.js';
import { glowTexture } from './textures.js';
import { getMilitary } from './militaryAssets.js';

// Brighter olive so procedural armor reads clearly at night / against asphalt
const OLIVE = 0x6a7e42;
const OLIVE_DK = 0x3f4c28;
const STEEL = 0x5a6068;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.68, metalness: opts.metalness ?? 0.28, emissive: opts.emissive ?? 0, emissiveIntensity: opts.emissiveIntensity ?? 0 });
}

/** Real Sketchfab Abrams (fallback: procedural boxes). Matches car model return shape. */
export function buildTank(opts = {}) {
  const T = getMilitary('tank');
  if (T?.body?.length) return buildTankGLB(T, opts);
  return buildTankProcedural(opts);
}

function buildTankGLB(T, opts = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = mat(opts.color ?? OLIVE, { emissive: 0x1a2410, emissiveIntensity: 0.22 });
  const dark = mat(OLIVE_DK);
  const steel = mat(STEEL, { metalness: 0.55, roughness: 0.45 });
  const L = T.size.z || 7.9, W = T.size.x || 2.9, H = T.size.y || 3.0;
  const wheelR = 0.42, wb = L * 0.32;
  const parts = [];
  for (const it of T.body) {
    const m = new THREE.Mesh(it.geo, it.mat);
    body.add(m);
    parts.push(m);
  }
  // high-vis chevron so armor reads at night / distance
  const mark = mat(0xc8ff40, { emissive: 0x88cc20, emissiveIntensity: 0.9, roughness: 0.55 });
  const chev = new THREE.Mesh(new THREE.BoxGeometry(W * 0.45, 0.1, 0.5), mark);
  chev.position.set(0, H * 0.55, L * 0.05); body.add(chev);
  // soft turret pivot (visual barrel only — hull GLB is fused)
  const turret = new THREE.Group();
  turret.position.set(0, H * 0.62, -0.1);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 3.2, 8), steel);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.15, 2.0); turret.add(barrel);
  body.add(turret);
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1810, emissiveIntensity: 2.4 });
  const heads = [];
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.18), mat(0xfff2c8, { emissive: 0xffe8a0, emissiveIntensity: 2.2, roughness: 0.4 }));
    h.position.set(sx * W * 0.35, H * 0.35, L * 0.42); body.add(h); heads.push(h);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.08), tailMat);
    tl.position.set(sx * W * 0.38, H * 0.32, -L * 0.42); body.add(tl);
  }
  // invisible physics wheels (GLB already has tracks)
  const wheels = [];
  const wx = W * 0.42;
  for (const [sx, sz, front] of [[1, 1, true], [-1, 1, true], [1, -1, false], [-1, -1, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * wx, wheelR, sz * wb * 0.85);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.4, 8), dark);
    tyre.rotation.z = Math.PI / 2; tyre.visible = false; spin.add(tyre);
    pivot.add(spin); root.add(pivot);
    wheels.push({ pivot, spin, front, side: sx, blur: null });
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  const dims = { L, W, wheelR, wb, roofH: H };
  const profile = { L, W, roofH: H, belt: H * 0.55, hoodFront: H * 0.4, wsBase: 0.8, roofF: 0.5, roofR: -L * 0.2, rearWin: -L * 0.3, deck: H * 0.5, tail: H * 0.4, wheelR, wb, cabinW: W * 0.7 };
  return { root, body, wheels, paint, tailMat, heads, siren: {}, dims, profile, parts, turret, military: true, glb: true };
}

/** Procedural MBT-style tank matching the car model return shape. */
function buildTankProcedural(opts = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = mat(opts.color ?? OLIVE, { emissive: 0x1a2410, emissiveIntensity: 0.22 });
  const dark = mat(OLIVE_DK);
  const steel = mat(STEEL, { metalness: 0.55, roughness: 0.45 });
  const L = 7.2, W = 3.4, wheelR = 0.42, wb = 2.35;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 1.05, L * 0.88), paint);
  hull.position.y = 0.95; body.add(hull);
  const glacis = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, 0.55, 1.6), paint);
  glacis.position.set(0, 1.15, L * 0.32); glacis.rotation.x = -0.28; body.add(glacis);
  const skirtL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, L * 0.78), dark);
  skirtL.position.set(-W * 0.48, 0.7, 0); body.add(skirtL);
  const skirtR = skirtL.clone(); skirtR.position.x = W * 0.48; body.add(skirtR);
  // high-vis chevron so tanks don't read as dark blobs
  const mark = mat(0xc8ff40, { emissive: 0x88cc20, emissiveIntensity: 0.85, roughness: 0.55 });
  const chev = new THREE.Mesh(new THREE.BoxGeometry(W * 0.55, 0.08, 0.55), mark);
  chev.position.set(0, 1.5, L * 0.08); body.add(chev);
  // turret + barrel (yaw group for aiming)
  const turret = new THREE.Group();
  turret.position.set(0, 1.55, -0.15);
  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 0.85, 12), paint);
  cupola.position.y = 0.35; turret.add(cupola);
  const bustle = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 1.4), dark);
  bustle.position.set(0, 0.35, -1.0); turret.add(bustle);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 3.6, 8), steel);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.4, 2.4); turret.add(barrel);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.45, 8), steel);
  muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.4, 4.15); turret.add(muzzle);
  body.add(turret);
  // marker lights
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1810, emissiveIntensity: 2.4 });
  const heads = [];
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.2), mat(0xfff2c8, { emissive: 0xffe8a0, emissiveIntensity: 2.2, roughness: 0.4 }));
    h.position.set(sx * 1.1, 1.15, L * 0.42); body.add(h);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.08), tailMat);
    tl.position.set(sx * 1.2, 1.0, -L * 0.42); body.add(tl);
  }
  // track rollers as "wheels" for physics spin visual
  const wheels = [];
  const wx = W / 2 - 0.35;
  for (const [sx, sz, front] of [[1, 1, true], [-1, 1, true], [1, -1, false], [-1, -1, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * wx, wheelR, sz * wb * 0.85);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.55, 10), dark);
    tyre.rotation.z = Math.PI / 2; spin.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.45, wheelR * 0.45, 0.58, 8), steel);
    hub.rotation.z = Math.PI / 2; spin.add(hub);
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin, front, side: sx, blur: null });
  }
  // extra mid rollers (visual only)
  for (const sx of [-1, 1]) {
    for (const z of [-0.9, 0.9]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 8), dark);
      r.rotation.z = Math.PI / 2; r.position.set(sx * wx, 0.32, z); root.add(r);
    }
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  const dims = { L, W, wheelR, wb, roofH: 2.4 };
  const profile = { L, W, roofH: 2.4, belt: 1.4, hoodFront: 1.2, wsBase: 0.8, roofF: 0.5, roofR: -1.5, rearWin: -2.2, deck: 1.6, tail: 1.1, wheelR, wb, cabinW: 2.2 };
  return { root, body, wheels, paint, tailMat, heads, siren: {}, dims, profile, parts: [hull], turret, military: true };
}

function buildHeliMesh() {
  const T = getMilitary('heli');
  if (T?.body?.length) return buildHeliGLB(T);
  return buildHeliProcedural();
}

function buildHeliGLB(T) {
  const root = new THREE.Group();
  // Center of mass sits mid-fuselage; prep grounded at y=0 — lift so skids clear ground at alt=0
  const lift = 0;
  for (const it of T.body) {
    const m = new THREE.Mesh(it.geo, it.mat);
    m.position.y = lift;
    root.add(m);
  }
  for (const it of T.glass) {
    const m = new THREE.Mesh(it.geo, it.mat);
    m.position.y = lift;
    root.add(m);
  }
  const rotor = new THREE.Group();
  if (T.rotors.length) {
    const hub = new THREE.Vector3();
    for (const it of T.rotors) {
      it.geo.computeBoundingBox();
      hub.add(it.geo.boundingBox.getCenter(new THREE.Vector3()));
    }
    hub.multiplyScalar(1 / T.rotors.length);
    rotor.position.set(hub.x, hub.y + lift, hub.z);
    for (const it of T.rotors) {
      const m = new THREE.Mesh(it.geo, it.mat);
      m.position.set(-hub.x, -hub.y, -hub.z);
      rotor.add(m);
    }
  } else {
    // Fallback disc if rotor mats weren't tagged
    const steel = mat(STEEL, { metalness: 0.7, roughness: 0.35 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, T.size.x * 0.95), steel);
    const blade2 = blade.clone(); blade2.rotation.y = Math.PI / 2;
    rotor.position.set(0, T.size.y * 0.85 + lift, T.size.z * 0.05);
    rotor.add(blade, blade2);
  }
  root.add(rotor);
  const tailRotor = new THREE.Group();
  // Approximate tail boom tip
  tailRotor.position.set(T.size.x * 0.08, T.size.y * 0.55 + lift, -T.size.z * 0.42);
  const steel = mat(STEEL, { metalness: 0.7, roughness: 0.35 });
  const tb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.18), steel);
  const tb2 = tb.clone(); tb2.rotation.z = Math.PI / 2;
  tailRotor.add(tb, tb2);
  root.add(tailRotor);
  // Nav lights
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), mat(0xff2020, { emissive: 0xff1010, emissiveIntensity: 4 }));
  red.position.set(-T.size.x * 0.35, T.size.y * 0.35 + lift, T.size.z * 0.05); root.add(red);
  const grn = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), mat(0x20ff40, { emissive: 0x10ff20, emissiveIntensity: 4 }));
  grn.position.set(T.size.x * 0.35, T.size.y * 0.35 + lift, T.size.z * 0.05); root.add(grn);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  // Shift so visual center is near origin XZ (prep already centered); keep belly near y=0
  return { root, rotor, tailRotor };
}

function buildHeliProcedural() {
  const root = new THREE.Group();
  const paint = mat(OLIVE, { emissive: 0x152010, emissiveIntensity: 0.28 });
  const glass = mat(0x1a2830, { metalness: 0.6, roughness: 0.25, emissive: 0x204060, emissiveIntensity: 0.55 });
  const steel = mat(STEEL, { metalness: 0.7, roughness: 0.35 });
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.45, 5.8), paint);
  fuselage.position.y = 0; root.add(fuselage);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.95, 1.5), glass);
  nose.position.set(0, 0.15, 2.8); root.add(nose);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 4.4), paint);
  boom.position.set(0, 0.15, -4.4); root.add(boom);
  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.55, 1.0), paint);
  tailFin.position.set(0, 0.95, -6.4); root.add(tailFin);
  // belly stripe — silhouette against sky/city
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 4.2), mat(0xc8ff40, { emissive: 0x88cc20, emissiveIntensity: 0.7 }));
  stripe.position.set(0, -0.65, 0.2); root.add(stripe);
  const skidGeo = new THREE.BoxGeometry(0.12, 0.12, 4.4);
  for (const sx of [-0.9, 0.9]) {
    const sk = new THREE.Mesh(skidGeo, steel); sk.position.set(sx, -1.1, 0.2); root.add(sk);
  }
  // main rotor
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.15, 0.2);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.28, 8), steel);
  rotor.add(hub);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 8.2), steel);
  const blade2 = blade.clone(); blade2.rotation.y = Math.PI / 2;
  rotor.add(blade, blade2);
  root.add(rotor);
  // tail rotor
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.38, 0.9, -6.45);
  const tb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.8, 0.2), steel);
  const tb2 = tb.clone(); tb2.rotation.z = Math.PI / 2;
  tailRotor.add(tb, tb2);
  root.add(tailRotor);
  // nav lights (bright so choppers read in night sky)
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), mat(0xff2020, { emissive: 0xff1010, emissiveIntensity: 4 }));
  red.position.set(-1.25, 0.25, 0.5); root.add(red);
  const grn = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), mat(0x20ff40, { emissive: 0x10ff20, emissiveIntensity: 4 }));
  grn.position.set(1.25, 0.25, 0.5); root.add(grn);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return { root, rotor, tailRotor };
}

let spotTex = null;
const softSpot = () => (spotTex ||= glowTexture('rgba(255,240,200,1)', 'rgba(255,220,140,0)', 128));

export class Helicopter {
  constructor(scene) {
    const m = buildHeliMesh();
    this.root = m.root;
    this.rotor = m.rotor;
    this.tailRotor = m.tailRotor;
    scene.add(this.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3(); // world XZ (y unused) + vertical in .vy
    this.vy = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.alt = 18;
    this.targetAlt = 18;
    this.slot = 0; // formation lane index — set by spawnHeli
    this.fireCd = 6 + Math.random() * 4;
    this.active = true;
    this.age = 0;
    this.spot = new THREE.SpotLight(0xfff2c8, 0, 160, 0.42, 0.6, 1.25);
    this.spot.castShadow = false;
    scene.add(this.spot);
    scene.add(this.spot.target);
    const beam = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softSpot(), color: 0xffe8b0, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    beam.scale.set(16, 16, 1);
    this.beam = beam;
    this.root.add(beam);
    beam.position.set(0, -1.4, 0.6);
  }

  place(x, z, yaw = 0) {
    this.pos.set(x, this.alt, z);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.root.position.copy(this.pos);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = yaw;
  }

  /** Lead station ahead of the player — formation lane + speed-scaled distance. */
  station(pl) {
    const pfx = Math.sin(pl.yaw), pfz = Math.cos(pl.yaw);
    const prx = -pfz, prz = pfx;
    const lanes = [0, -18, 18, -34, 34];
    const lat = lanes[this.slot % lanes.length] + Math.sin(this.age * 0.35 + this.slot) * 2.2;
    // Stay clearly in front of the car; stretch out as they go faster so we don't sit on their roof
    const lead = 52 + pl.speed * 0.65 + (this.slot % 3) * 10;
    const pred = 0.85; // predict where the car will be
    const px = pl.pos.x + pl.vel.x * pred;
    const pz = pl.pos.z + pl.vel.y * pred;
    return {
      x: px + pfx * lead + prx * lat,
      z: pz + pfz * lead + prz * lat,
      pfx, pfz, lead,
    };
  }

  update(dt, game) {
    if (!this.active) return;
    this.age += dt;
    const pl = game.player;
    if (!pl || pl.wrecked) return;

    const st = this.station(pl);
    const ex = st.x - this.pos.x, ez = st.z - this.pos.z;
    const edist = Math.hypot(ex, ez) || 1;
    const toX = ex / edist, toZ = ez / edist;
    const pSpd = Math.hypot(pl.vel.x, pl.vel.y);

    // Flight plan: race to the lead point (can outrun the car), then hold station matching player velocity.
    // Cap ~78 m/s (~280 km/h) so Blackhawks can overtake supercars and park in front.
    const MAX = 78;
    let wantVx, wantVz;
    if (edist > 40) {
      // Intercept — fly at player speed + catch-up toward the station
      const catchUp = clamp(18 + edist * 0.85, 28, 55);
      const cruise = Math.min(MAX, pSpd + catchUp);
      wantVx = toX * cruise;
      wantVz = toZ * cruise;
    } else if (edist > 12) {
      // Closing — blend toward matching player while still correcting
      const k = clamp((edist - 12) / 28, 0, 1);
      const catchUp = 12 + edist * 0.55;
      wantVx = lerp(pl.vel.x + ex * 2.4, toX * Math.min(MAX, pSpd + catchUp), k);
      wantVz = lerp(pl.vel.y + ez * 2.4, toZ * Math.min(MAX, pSpd + catchUp), k);
    } else {
      // On station — ride with the car + soft spring so the formation holds
      wantVx = pl.vel.x + ex * 3.2;
      wantVz = pl.vel.y + ez * 3.2;
      const wsp = Math.hypot(wantVx, wantVz);
      if (wsp > MAX) { wantVx *= MAX / wsp; wantVz *= MAX / wsp; }
    }

    const damp = 1 - Math.exp(-dt * 2.8);
    this.vel.x = lerp(this.vel.x, wantVx, damp);
    this.vel.z = lerp(this.vel.z, wantVz, damp);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // Yaw: follow velocity when chasing the station; align with the car once ahead (spotlight back onto them)
    const spd = Math.hypot(this.vel.x, this.vel.z);
    let desiredYaw = spd > 3 ? Math.atan2(this.vel.x, this.vel.z) : pl.yaw;
    if (edist < 22) desiredYaw = pl.yaw;
    this.yaw += wrapAngle(desiredYaw - this.yaw) * (1 - Math.exp(-dt * 3.8));

    // Real heli attitude: bank into lateral accel, pitch with surge / climb
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    const latV = this.vel.x * rx + this.vel.z * rz;
    const fwdV = this.vel.x * fx + this.vel.z * fz;
    const surge = fwdV - pSpd;
    this.targetAlt = 16 + clamp(pSpd * 0.09, 0, 12) + (this.slot % 3) * 3.2 + Math.sin(this.age * 0.85 + this.slot * 1.7) * 0.9;
    const wantVy = (this.targetAlt - this.alt) * 2.4;
    this.vy = lerp(this.vy, wantVy, 1 - Math.exp(-dt * 2.2));
    this.alt += this.vy * dt;
    const gy = game.world.heightAt(this.pos.x, this.pos.z);
    this.pos.y = Math.max(gy + 14, this.alt);

    const targetRoll = clamp(-latV * 0.045 - (wantVx * rz - wantVz * rx) * 0.012, -0.55, 0.55);
    const targetPitch = clamp(-surge * 0.014 - this.vy * 0.02, -0.38, 0.3);
    this.roll = lerp(this.roll, targetRoll, 1 - Math.exp(-dt * 4.2));
    this.pitch = lerp(this.pitch, targetPitch, 1 - Math.exp(-dt * 3.4));

    this.root.position.copy(this.pos);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = this.yaw;
    this.root.rotation.x = this.pitch;
    this.root.rotation.z = this.roll;

    // Rotor load: spin harder when accelerating / climbing — reads as working air
    const load = clamp(1 + Math.hypot(wantVx - this.vel.x, wantVz - this.vel.z) * 0.08 + Math.abs(this.vy) * 0.04, 1, 1.75);
    this.rotor.rotation.y += dt * 52 * load;
    this.tailRotor.rotation.x += dt * 78 * load;

    // Searchlight from the lead bird onto the car
    const night = game.world.isNight?.() ?? true;
    const dist = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) || 1;
    this.spot.intensity = (night ? 160 : 55) * clamp(1.15 - dist / 140, 0.35, 1);
    this.spot.position.set(this.pos.x, this.pos.y - 1.2, this.pos.z);
    this.spot.target.position.set(pl.pos.x, pl.pos.y + 0.35, pl.pos.z);
    this.spot.target.updateMatrixWorld();
    this.beam.material.opacity = night ? 0.5 : 0.16;

    this.fireCd -= dt;
    if (this.fireCd <= 0 && game.pursuit && game.heat >= 3 && dist < 110) {
      this.fireCd = 7 + Math.random() * 5;
      this.suppress(game, pl, dist);
    }
    if (!game.pursuit && dist > 260) this.active = false;
  }

  suppress(game, pl, dist) {
    // tracers toward the car + light damage / punch when under the beam
    const under = dist < 55;
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      const x = lerp(this.pos.x, pl.pos.x + (Math.random() - 0.5) * 6, t);
      const z = lerp(this.pos.z, pl.pos.z + (Math.random() - 0.5) * 6, t);
      const y = lerp(this.pos.y - 2, pl.pos.y + 0.5, t);
      game.vfx.sparks?.(x, y, z, pl.pos.x - this.pos.x, pl.pos.z - this.pos.z, 2, 1.6);
    }
    if (under) {
      game.damage(pl, 0.04 + Math.random() * 0.03, null);
      game.punch?.('heatUp', 0.55);
      game.hud.flashDamage?.(0.35);
      if (Math.random() < 0.55) {
        game.notify('AIR SUPPORT', 'Helicopter suppressing fire!', '#ff6040');
        game.radio('Air unit engaging. Keep eyes on the suspect.');
      }
    } else if (Math.random() < 0.4) {
      game.notify('CHOPPER OVERHEAD', 'Stay out of the spotlight', '#ffb040');
    }
  }

  dispose(scene) {
    scene.remove(this.root);
    scene.remove(this.spot);
    scene.remove(this.spot.target);
    this.active = false;
  }
}
