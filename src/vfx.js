// ===== Visual effects: particles, sparks, skidmarks, nitro, debris =====
import * as THREE from 'three';
import { smokeTexture, glowTexture } from './textures.js';
import { clamp } from './util.js';

class ParticlePool {
  constructor(scene, max, tex, blending, depthWrite = false) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uScale: { value: 800 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 pcolor; attribute float rot;
        uniform float uScale; varying float vA; varying vec3 vC; varying float vR;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = min(size * uScale / max(-mv.z, 0.1), 900.0); vA = alpha; vC = pcolor; vR = rot; }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC; varying float vR;
        void main(){ vec2 c = gl_PointCoord - 0.5; float s = sin(vR), co = cos(vR);
          vec2 uv = vec2(c.x*co - c.y*s, c.x*s + c.y*co) + 0.5;
          vec4 t = texture2D(map, uv); float a = t.a * vA; if (a < 0.003) discard;
          gl_FragColor = vec4(vC * t.rgb, a); }`,
      transparent: true, depthWrite, blending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.parts = [];
    for (let i = 0; i < max; i++) this.parts.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, a0: 1, r: 1, g: 1, b: 1, rot: 0, vr: 0, drag: 1, grav: 0 });
    this.cursor = 0;
    this._uploadTo = 0; // high-water mark of slots that need GPU upload
  }
  emit(o) {
    const p = this.parts[this.cursor]; this.cursor = (this.cursor + 1) % this.max;
    p.life = p.max = o.life; p.x = o.x; p.y = o.y; p.z = o.z; p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.s0 = o.s0; p.s1 = o.s1; p.a0 = o.a; p.r = o.r; p.g = o.g; p.b = o.b; p.rot = Math.random() * 6.28; p.vr = (Math.random() - 0.5) * (o.spin || 1);
    p.drag = o.drag ?? 1.5; p.grav = o.grav || 0; p.fadeIn = o.fadeIn || 0;
  }
  update(dt) {
    const P = this.parts;
    let hi = 0;
    for (let i = 0; i < this.max; i++) {
      const p = P[i];
      if (p.life <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      hi = i + 1;
      p.life -= dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.grav * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.vr * dt;
      const t = 1 - p.life / p.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.s0 + (p.s1 - p.s0) * t;
      const fin = p.fadeIn ? clamp(t / p.fadeIn, 0, 1) : 1;
      this.alpha[i] = p.a0 * (1 - t) * (1 - t) * fin;
      this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.g; this.col[i * 3 + 2] = p.b;
      this.rot[i] = p.rot;
    }
    // Upload only through the previous high-water mark so dead slots that just expired still clear on GPU
    const n = Math.max(hi, this._uploadTo);
    this._uploadTo = hi;
    if (n <= 0) return;
    const attrs = this.geo.attributes;
    for (const [k, stride] of [['position', 3], ['pcolor', 3], ['size', 1], ['alpha', 1], ['rot', 1]]) {
      const a = attrs[k]; a.needsUpdate = true; a.updateRange.offset = 0; a.updateRange.count = n * stride;
    }
  }
}

class SkidMarks {
  constructor(scene, max = 2400) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) { const a = i * 4; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const m = new THREE.ShaderMaterial({
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.02,0.02,0.02, vA * 0.6); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.cursor = 0;
    this.last = new Map();
  }
  add(key, x, y, z, rx, rz, a) {
    const prev = this.last.get(key);
    this.last.set(key, { x, y, z, rx, rz, t: performance.now() });
    if (!prev || performance.now() - prev.t > 120) return;
    if ((prev.x - x) ** 2 + (prev.z - z) ** 2 > 16) return;
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    const w = 0.16;
    const P = this.pos, o = i * 12;
    P[o] = prev.x - prev.rx * w; P[o + 1] = prev.y; P[o + 2] = prev.z - prev.rz * w;
    P[o + 3] = prev.x + prev.rx * w; P[o + 4] = prev.y; P[o + 5] = prev.z + prev.rz * w;
    P[o + 6] = x - rx * w; P[o + 7] = y; P[o + 8] = z - rz * w;
    P[o + 9] = x + rx * w; P[o + 10] = y; P[o + 11] = z + rz * w;
    this.alpha.fill(a, i * 4, i * 4 + 4);
    const gp = this.mesh.geometry.attributes.position, ga = this.mesh.geometry.attributes.alpha;
    gp.needsUpdate = true; gp.updateRange.offset = i * 12; gp.updateRange.count = 12;
    ga.needsUpdate = true; ga.updateRange.offset = i * 4; ga.updateRange.count = 4;
  }
  clear() {
    this.pos.fill(0); this.alpha.fill(0);
    const gp = this.mesh.geometry.attributes.position, ga = this.mesh.geometry.attributes.alpha;
    gp.needsUpdate = true; gp.updateRange.offset = 0; gp.updateRange.count = -1;
    ga.needsUpdate = true; ga.updateRange.offset = 0; ga.updateRange.count = -1;
  }
}

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new ParticlePool(scene, 1400, smokeTexture(), THREE.NormalBlending);
    this.glow = new ParticlePool(scene, 900, glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64), THREE.AdditiveBlending);
    this.skids = new SkidMarks(scene);
    // debris
    this.debris = [];
    const dg = new THREE.BoxGeometry(0.3, 0.08, 0.2);
    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(dg, this.debrisMat); m.visible = false; m.castShadow = true; scene.add(m);
      this.debris.push({ m, life: 0, v: new THREE.Vector3(), w: new THREE.Vector3() });
    }
    this.dcur = 0;
    // flash light for big hits
    this.flash = new THREE.PointLight(0xffaa66, 0, 40, 2);
    scene.add(this.flash);
    this.flashT = 0;
    // nitro light: blue underglow that lights the road and the car's rear while boosting (kept in the scene at 0 so shaders never recompile)
    this.nitroLight = new THREE.PointLight(0x4f8cff, 0, 18, 2); scene.add(this.nitroLight); this._nl = 0; this._nlPos = new THREE.Vector3();
    // nitro flame texture
    this.flameTex = glowTexture('rgba(160,200,255,1)', 'rgba(40,80,255,0)', 64);
    // EMP shell
    this.empMesh = new THREE.Mesh(new THREE.SphereGeometry(3.2, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.8, 3), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true }));
    this.empMesh.visible = false; scene.add(this.empMesh);
  }

  setScale(pxScale) { this.smoke.mat.uniforms.uScale.value = pxScale; this.glow.mat.uniforms.uScale.value = pxScale; }

  tireSmoke(x, y, z, vx, vz, intensity, dark = false) {
    const c = dark ? 0.35 : 0.85;
    this.smoke.emit({ x: x + (Math.random() - 0.5) * 0.4, y: y + 0.3, z: z + (Math.random() - 0.5) * 0.4, vx: vx * 0.2 + (Math.random() - 0.5) * 2, vy: 0.8 + Math.random(), vz: vz * 0.2 + (Math.random() - 0.5) * 2,
      life: 1.4 + Math.random() * 1.2, s0: 1.2, s1: 6 + intensity * 4, a: 0.22 * intensity + 0.08, r: c, g: c * 0.98, b: c * 0.96, drag: 1.4, fadeIn: 0.1 });
  }
  dust(x, y, z, vx, vz, intensity) {
    this.smoke.emit({ x, y: y + 0.2, z, vx: vx * 0.3 + (Math.random() - 0.5) * 2, vy: 0.5 + Math.random(), vz: vz * 0.3 + (Math.random() - 0.5) * 2,
      life: 1.5 + Math.random(), s0: 1.5, s1: 7, a: 0.25 * intensity, r: 0.62, g: 0.52, b: 0.4, drag: 1.2, fadeIn: 0.1 });
  }
  damageSmoke(x, y, z, heavy) {
    const c = heavy ? 0.12 : 0.5;
    this.smoke.emit({ x, y, z, vx: (Math.random() - 0.5), vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5), life: 2, s0: 1, s1: heavy ? 8 : 5, a: heavy ? 0.5 : 0.25, r: c, g: c, b: c, drag: 0.6 });
    if (heavy && Math.random() < 0.5) this.glow.emit({ x, y, z, vx: 0, vy: 2, vz: 0, life: 0.4, s0: 1.4, s1: 0.4, a: 0.9, r: 3, g: 1.2, b: 0.3, drag: 1 });
  }
  sparks(x, y, z, nx, nz, count, speed = 1) {
    for (let i = 0; i < count; i++) {
      const sp = (4 + Math.random() * 14) * speed;
      this.glow.emit({ x, y: y + 0.4 + Math.random() * 0.4, z, vx: nx * sp + (Math.random() - 0.5) * 10, vy: 2 + Math.random() * 7, vz: nz * sp + (Math.random() - 0.5) * 10,
        life: 0.3 + Math.random() * 0.5, s0: 0.35, s1: 0.05, a: 1, r: 4, g: 2.2, b: 0.8, drag: 2, grav: 18, spin: 0 });
    }
  }
  impactFlash(x, y, z, power) {
    this.flash.position.set(x, y + 1, z); this.flash.intensity = 40 * power; this.flashT = 0.15;
    this.glow.emit({ x, y: y + 0.8, z, life: 0.14, s0: 1.6 * power, s1: 3 * power, a: 0.7, r: 2, g: 1.2, b: 0.7, drag: 0 });
  }
  debrisBurst(x, y, z, vx, vz, n, color) {
    for (let i = 0; i < n; i++) {
      const d = this.debris[this.dcur]; this.dcur = (this.dcur + 1) % this.debris.length;
      d.m.visible = true; d.m.position.set(x, y + 0.8, z); d.life = 2.5;
      d.v.set(vx * 0.5 + (Math.random() - 0.5) * 14, 4 + Math.random() * 8, vz * 0.5 + (Math.random() - 0.5) * 14);
      d.w.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
      const s = 0.6 + Math.random() * 1.4; d.m.scale.set(s, s, s);
    }
  }
  explosion(x, y, z, vx = 0, vz = 0) {
    this.impactFlash(x, y, z, 1.5);
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * 6.28, s = 3 + Math.random() * 9;
      this.glow.emit({ x, y: y + 1, z, vx: Math.cos(a) * s + vx * 0.3, vy: 2 + Math.random() * 6, vz: Math.sin(a) * s + vz * 0.3, life: 0.4 + Math.random() * 0.35, s0: 1.2 + Math.random() * 1.2, s1: 0.2, a: 0.85, r: 3, g: 1.1, b: 0.25, drag: 2.5 });
    }
    for (let i = 0; i < 14; i++) this.smoke.emit({ x: x + (Math.random() - 0.5) * 3, y: y + 1, z: z + (Math.random() - 0.5) * 3, vx: (Math.random() - 0.5) * 5 + vx * 0.2, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 5 + vz * 0.2, life: 2.2 + Math.random() * 1.5, s0: 1.5, s1: 7, a: 0.5, r: 0.1, g: 0.09, b: 0.085, drag: 1.2, fadeIn: 0.08 });
    this.sparks(x, y, z, vx * 0.03, vz * 0.03, 40, 1.4);
    this.debrisBurst(x, y, z, vx, vz, 12);
  }
  // Layered nitro jet: white-hot core -> blue body -> violet tail, shock diamonds, sparks. Called once per exhaust per frame.
  nitroFlame(x, y, z, fx, fz, vx, vz, power = 1) {
    const len = (0.85 + Math.random() * 0.35) * power;
    this.glow.emit({ x, y, z, vx: -fx * 9 + vx, vy: 0.1, vz: -fz * 9 + vz, life: 0.07 + Math.random() * 0.04, s0: 0.7, s1: 0.3, a: 1, r: 4.5, g: 4.0, b: 3.6, drag: 0 });
    for (let k = 0; k < 6; k++) {
      const u = k / 5, off = 0.15 + u * 2.6 * len;
      const r = 3.6 - 3.0 * u, g = 3.4 - 2.5 * u, b = 5.2 - 1.2 * u; // white-blue -> blue -> violet
      this.glow.emit({ x: x - fx * off, y: y + (Math.random() - 0.5) * 0.06, z: z - fz * off, vx: -fx * (11 + u * 9) + vx, vy: (Math.random() - 0.5) * 0.4, vz: -fz * (11 + u * 9) + vz,
        life: 0.09 + u * 0.09, s0: 0.85 - 0.35 * u, s1: 0.35 + 0.5 * u, a: 0.95 - 0.5 * u, r, g, b, drag: 0.3 });
    }
    // shock diamonds: tiny bright beads that sit still relative to the car
    if (Math.random() < 0.7) for (let k = 1; k <= 3; k++) {
      const off = 0.55 + k * 0.72 * len;
      this.glow.emit({ x: x - fx * off, y, z: z - fz * off, vx, vy: 0, vz, life: 0.05, s0: 0.4 - k * 0.06, s1: 0.2, a: 1, r: 3.2, g: 4.4, b: 7, drag: 0 });
    }
    if (Math.random() < 0.35) this.glow.emit({ x: x - fx * 0.4, y, z: z - fz * 0.4, vx: -fx * (6 + Math.random() * 12) + vx + (Math.random() - 0.5) * 5, vy: 1 + Math.random() * 2.5, vz: -fz * (6 + Math.random() * 12) + vz + (Math.random() - 0.5) * 5,
      life: 0.25 + Math.random() * 0.25, s0: 0.2, s1: 0.04, a: 1, r: 2.2, g: 2.6, b: 5, drag: 1, grav: 10, spin: 0 });
  }
  // one-off: ignition shock ring + flash (nitro engaged) / cutoff pop (nitro ended)
  nitroIgnite(x, y, z, fx, fz, vx, vz) {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * 6.28, c = Math.cos(a), sn = Math.sin(a), rx = -fz, rz = fx;
      this.glow.emit({ x, y: y + c * 0.1, z, vx: -fx * 5 + rx * sn * 7 + vx, vy: c * 7, vz: -fz * 5 + rz * sn * 7 + vz, life: 0.22, s0: 0.5, s1: 0.1, a: 0.9, r: 1.2, g: 2.4, b: 6, drag: 3 });
    }
    this.glow.emit({ x: x - fx * 0.5, y, z: z - fz * 0.5, vx, vy: 0, vz, life: 0.12, s0: 2.6, s1: 4.2, a: 0.6, r: 1.2, g: 2.2, b: 6, drag: 0 });
  }
  nitroCut(x, y, z, fx, fz, vx, vz) {
    for (let k = 0; k < 5; k++) this.glow.emit({ x, y, z, vx: -fx * (6 + k * 2) + vx + (Math.random() - 0.5) * 2, vy: 0.4 + Math.random(), vz: -fz * (6 + k * 2) + vz + (Math.random() - 0.5) * 2, life: 0.12 + Math.random() * 0.1, s0: 0.5, s1: 0.1, a: 1, r: 4, g: 1.8, b: 0.6, drag: 2 });
  }
  empBurst(x, y, z) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.28, b = Math.random() * 3.14;
      this.glow.emit({ x, y: y + 1, z, vx: Math.cos(a) * Math.sin(b) * 12, vy: Math.cos(b) * 12, vz: Math.sin(a) * Math.sin(b) * 12, life: 0.5, s0: 0.8, s1: 0.1, a: 1, r: 0.8, g: 1.8, b: 5, drag: 3 });
    }
  }

  update(dt) {
    this.smoke.update(dt);
    this.glow.update(dt);
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.v.y -= 22 * dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      if (d.life <= 0) d.m.visible = false;
    }
    this.nitroLight.intensity += ((this._nl - this.nitroLight.intensity)) * Math.min(1, dt * 18); this._nl = 0;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; else this.flash.intensity *= 0.8; }
  }
  // per-car effects called each frame
  carEffects(car, dt, world) {
    if (!car.visible) return;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const rx = -fz, rz = fx;
    const L = car.dims.wb, W = car.dims.W / 2 - 0.2;
    const sp = car.speed;
    const lat = Math.abs(car.vR);
    // launch wheelspin only while actually launching in 1st (hard acceleration from low speed) — not while holding
    // the throttle against the rev limiter in a low manual gear, which used to trigger permanent tyre screech
    const spin = car.input.throttle > 0.8 && car.vF < 14 && car.vF > 0.5 && car.grounded && car.role === 'player' && (car.gear || 1) <= 1 && (car.accelLong || 0) > 4;
    const skidAmt = car.grounded ? clamp((lat - 2.5) / 8, 0, 1) + (car.input.handbrake && sp > 5 ? 0.5 : 0) + (spin ? 0.6 : 0) + (car.input.brake > 0.7 && car.vF > 18 ? 0.35 : 0) : 0;
    car.skidAmt = clamp(skidAmt, 0, 1);
    if (skidAmt > 0.15 && !car.offroad) {
      for (const s of [-1, 1]) {
        const x = car.pos.x - fx * L + rx * W * s, z = car.pos.z - fz * L + rz * W * s;
        const y = car.pos.y - 0.12;
        this.skids.add(car.id * 4 + (s > 0 ? 1 : 0), x, y, z, rx, rz, clamp(skidAmt, 0.2, 1));
        if (Math.random() < skidAmt * dt * 40) this.tireSmoke(x, y, z, car.vel.x, car.vel.y, skidAmt);
      }
      if (car.input.brake > 0.7 && car.vF > 18) for (const s of [-1, 1]) {
        const x = car.pos.x + fx * L + rx * W * s, z = car.pos.z + fz * L + rz * W * s;
        this.skids.add(car.id * 4 + 2 + (s > 0 ? 1 : 0), x, car.pos.y - 0.12, z, rx, rz, 0.5);
      }
    }
    if (car.offroad && sp > 8 && car.grounded && Math.random() < dt * sp * 0.6) {
      this.dust(car.pos.x - fx * L, car.pos.y, car.pos.z - fz * L, car.vel.x, car.vel.y, clamp(sp / 40, 0.3, 1));
    }
    // exhaust: backfire pops on upshift / lift-off, light smoke puffs on hard launch
    const exL = car.dims.L / 2 + 0.05;
    if (car.shifted === 1 && car.input.throttle > 0.6 && sp > 10 && car.role === 'player') {
      for (const s of [-0.42, 0.42]) {
        const x = car.pos.x - fx * exL + rx * s, z = car.pos.z - fz * exL + rz * s;
        for (let k = 0; k < 3; k++) this.glow.emit({ x, y: car.pos.y + 0.32, z, vx: -fx * (7 + k * 3) + car.vel.x + (Math.random() - 0.5) * 2, vy: 0.5 + Math.random(), vz: -fz * (7 + k * 3) + car.vel.y + (Math.random() - 0.5) * 2, life: 0.09 + Math.random() * 0.07, s0: 0.35, s1: 0.08, a: 1, r: 4, g: 1.6, b: 0.4, drag: 2 });
      }
    }
    if (car.grounded && car.input.throttle > 0.9 && car.vF > 1 && car.vF < 22 && Math.random() < dt * 14) {
      const s = Math.random() < 0.5 ? -0.42 : 0.42;
      this.tireSmoke(car.pos.x - fx * exL + rx * s, car.pos.y + 0.3, car.pos.z - fz * exL + rz * s, car.vel.x - fx * 2, car.vel.y - fz * 2, 0.12, true);
    }
    if (car.nitroActive) {
      const ex = car.dims.L / 2 + 0.12, sx = car.dims.W * 0.2;
      for (const s of [-sx, sx]) this.nitroFlame(car.pos.x - fx * ex + rx * s, car.pos.y + 0.2, car.pos.z - fz * ex + rz * s, fx, fz, car.vel.x, car.vel.y, 1);
      if (!car._nitroPrev) for (const s of [-sx, sx]) this.nitroIgnite(car.pos.x - fx * ex + rx * s, car.pos.y + 0.2, car.pos.z - fz * ex + rz * s, fx, fz, car.vel.x, car.vel.y);
      if (car.role === 'player') { this._nl = 22 * (0.85 + Math.random() * 0.3); this.nitroLight.position.set(car.pos.x - fx * (ex + 1.4), car.pos.y + 0.5, car.pos.z - fz * (ex + 1.4)); }
    } else if (car._nitroPrev) {
      const ex = car.dims.L / 2 + 0.12, sx = car.dims.W * 0.2;
      for (const s of [-sx, sx]) this.nitroCut(car.pos.x - fx * ex + rx * s, car.pos.y + 0.2, car.pos.z - fz * ex + rz * s, fx, fz, car.vel.x, car.vel.y);
    }
    car._nitroPrev = car.nitroActive;
    if (car.health < 0.45 && Math.random() < dt * (car.wrecked ? 18 : 6)) {
      this.damageSmoke(car.pos.x + fx * car.dims.L * 0.35, car.pos.y + 0.9, car.pos.z + fz * car.dims.L * 0.35, car.health < 0.2 || car.wrecked);
    }
  }
}
