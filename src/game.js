// ===== Game orchestration: modes, pursuit rules, spawning, collisions =====
import * as THREE from 'three';
import { Car, PLAYER_CARS, RACER_COLORS, TRAFFIC_SPECS, RIVAL_MODELS } from './car.js';
import { RacerAI, CopAI, TrafficAI } from './ai.js';
import { buildRoute, projectOnRoute, pointAtDist } from './roads.js';
import { clamp, lerp, wrapAngle, damp } from './util.js';
import { WATER_LEVEL } from './terrain.js';
import { glowTexture, softGlowTexture, beamTexture, headlampPattern } from './textures.js';
import { MAPS } from './world.js';
import { MS_TO_KMH } from './units.js';
import { Feel } from './feel.js';
import { Helicopter } from './military.js';
import { encodeInput, keysFromDrive, F_WRECKED, F_NITRO_ON, F_FINISHED, F_OUT } from '../shared/protocol.js';

const COP_SPEC = { name: 'INTERCEPTOR', kind: 'gt', top: 91, accel: 17, grip: 9.6, steer: 1.0, mass: 1.25, armor: 1.0 };
const COP_SPEC2 = { name: 'PURSUIT SPEC', kind: 'super', top: 94, accel: 18, grip: 10, steer: 1.05, mass: 1.15, armor: 0.9 };
const COP_HEAVY = { name: 'HEAVY SUV', kind: 'suv', top: 84, accel: 15, grip: 9, steer: 0.9, mass: 2.0, armor: 1.8 };
const COP_TANK = { name: 'M1 BLOCKADE', kind: 'tank', top: 42, accel: 9, grip: 7.2, steer: 0.55, mass: 6.5, armor: 4.5, color: 0x6a7e42, color2: 0x3f4c28, cg: 0.85 };
const RACER_NAMES = ['KAZE', 'NOVA', 'VIPERA', 'GHOST', 'RAVEN', 'ZERO'];
const DIRS = ['north', 'north east', 'east', 'south east', 'south', 'south west', 'west', 'north west'];

const tmp = new THREE.Vector3();

// Remote-controlled car (another player, or a bot simulated by the room host).
// Snapshots land in a short receive-time buffer; netSmooth() renders ~1 tick behind and interpolates
// between known poses so the stream reads continuous instead of predict→correct→rubberband.
class RemoteAI {
  constructor(car) {
    this.car = car; this.progress = 0; this.finished = false; this.remote = true;
    this.buf = []; this.snap = null; this.age = 0; this.lagging = false; this.seq = -1;
  }
  pushSnap(s, now) {
    // drop out-of-order / duplicate seqs (seq is optional — older clients omit it)
    if (s.seq != null && this.seq >= 0 && s.seq <= this.seq) return;
    if (s.seq != null) this.seq = s.seq;
    s.t = now;
    this.buf.push(s);
    while (this.buf.length > 32) this.buf.shift();
    const cut = now - 1.2;
    while (this.buf.length > 2 && this.buf[0].t < cut) this.buf.shift();
    this.snap = s; this.age = 0; this.lagging = false;
  }
  /** Pose at render time (seconds, performance.now scale). Extrapolates briefly past the newest snap. */
  sample(renderT) {
    const b = this.buf; if (!b.length) return null;
    const last = b[b.length - 1];
    if (b.length === 1 || renderT >= last.t) {
      const dt = Math.min(0.18, Math.max(0, renderT - last.t));
      return {
        x: last.x + last.vx * dt, y: last.y, z: last.z + last.vz * dt,
        yaw: last.yaw + last.av * dt, vx: last.vx, vz: last.vz, av: last.av,
        h: last.h, f: last.f, st: last.st, th: last.th, br: last.br, nitro: last.nitro,
        extrap: dt > 0.001,
      };
    }
    if (renderT <= b[0].t) return b[0];
    let i = 1;
    while (i < b.length - 1 && b[i].t < renderT) i++;
    const a = b[i - 1], c = b[i];
    const u = clamp((renderT - a.t) / Math.max(1e-4, c.t - a.t), 0, 1);
    // smoothstep — softens snap edges without lagging the mid-pose
    const uu = u * u * (3 - 2 * u);
    return {
      x: a.x + (c.x - a.x) * uu, y: a.y + (c.y - a.y) * uu, z: a.z + (c.z - a.z) * uu,
      yaw: a.yaw + wrapAngle(c.yaw - a.yaw) * uu,
      vx: a.vx + (c.vx - a.vx) * uu, vz: a.vz + (c.vz - a.vz) * uu, av: a.av + (c.av - a.av) * uu,
      h: c.h, f: c.f, st: c.st, th: c.th, br: c.br, nitro: c.nitro, extrap: false,
    };
  }
  update(dt) {
    this.age += dt;
    this.lagging = this.age > 0.4;
    const s = this.snap; if (!s) return;
    const i = this.car.input;
    // Hold last inputs while lagging so remotes don't slam the brakes every packet gap
    if (this.lagging) { i.throttle *= 0.96; i.nitro = 0; return; }
    i.steer = s.st; i.throttle = s.th; i.brake = s.br; i.handbrake = s.f & 8 ? 1 : 0; i.nitro = s.f & 16 ? 1 : 0;
  }
}
const BOT_NAMES = RACER_NAMES;

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx); // renderer, scene, camera, world, audio, input, settings, rig, vfx, hud
    this.cars = []; this.traffic = []; this.cops = []; this.racers = []; this.spikes = []; this.roadblocks = [];
    this.helis = [];
    this.player = null; this.state = 'idle'; this.time = 0; this.timeScale = 1; this.slowmo = 0;
    this.idc = 1; this.acc = 0; this.heat = 0;
    this.gates = this.makeGate();
    this.copLights = [new THREE.PointLight(0xff2040, 0, 38, 2), new THREE.PointLight(0x2060ff, 0, 38, 2)];
    this.copLights.forEach((l) => this.scene.add(l));
    // Dual low-beam spots + soft flood + local car fill; real illumination for night driving
    const mkSpot = (color, dist, angle, pen, decay) => {
      const l = new THREE.SpotLight(color, 0, dist, angle, pen, decay);
      this.scene.add(l); this.scene.add(l.target); return l;
    };
    // Real projector headlamps: each SpotLight projects a low-beam pattern (sharp cut-off, kerb-side kick-up) onto the
    // road via SpotLight.map, so the light lands on the asphalt ahead instead of a fake glowing slab.
    this.lowPattern = headlampPattern(256, false);
    this.highPattern = headlampPattern(256, true);
    this.headlights = [
      mkSpot(0xfff3e2, 150, 0.62, 0.35, 1.1),
      mkSpot(0xfff3e2, 150, 0.62, 0.35, 1.1),
    ];
    for (const l of this.headlights) {
      l.map = this.lowPattern;
      l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.0004; l.shadow.normalBias = 0.04;
      l.shadow.camera.near = 0.5; l.shadow.camera.far = 150;
    }
    this.highBeam = false;
    this.headFlood = mkSpot(0xe8f2ff, 70, 0.78, 0.82, 1.55);
    this.headFill = new THREE.PointLight(0xffe6c4, 0, 14, 2); this.scene.add(this.headFill);
    this.brakeGlow = new THREE.PointLight(0xff1808, 0, 16, 2); this.scene.add(this.brakeGlow);
    // legacy alias used by garage / clear
    this.headlight = this.headlights[0];
    this.beamGroup = this.makeHeadBeams();
    this.scene.add(this.beamGroup);
    this.radioCd = 0;
    this.feel = new Feel();
    this.nearMiss = new Map();
    this.driftT = 0;
    this._wasDrifting = false;
  }

  /** Coupled arcade punch: FOV + blur + rumble + shake in one call. */
  punch(kind, scale = 1) {
    this.feel.punch(kind, scale, { rig: this.rig, input: this.input });
    if (this.rig) this.rig.fovKick = Math.max(this.rig.fovKick || 0, this.feel.fovKick);
  }

  // Volumetric headlamp shafts. The old version was two crossed flat sheets (one lying flat), which sliced through the
  // asphalt and showed hard polygon edges — the "cheap clipping" look. Now: a true cone mesh per lamp, rendered with a
  // view-dependent shader (bright when looking down the beam axis, near-invisible side-on), soft fade at the lens and
  // the tip, and a depth-aware soft intersection so where the cone meets the road it fades out instead of cutting.
  makeHeadBeams() {
    const g = new THREE.Group();
    const LEN = 34, R = 4.6;
    const geo = new THREE.ConeGeometry(R, LEN, 40, 12, true);
    geo.translate(0, -LEN / 2, 0); geo.rotateX(-Math.PI / 2); // apex at origin, opening along +Z
    this.beamUniforms = { uOpacity: { value: 0 }, uLen: { value: LEN }, uColor: { value: new THREE.Color(0xfff0d8) }, uGround: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.beamUniforms,
      vertexShader: `
        varying vec3 vWorld; varying vec3 vNormalW; varying float vAlong;
        uniform float uLen;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz; vNormalW = normalize(mat3(modelMatrix) * normal); vAlong = position.z / uLen;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        varying vec3 vWorld; varying vec3 vNormalW; varying float vAlong;
        uniform float uOpacity; uniform vec3 uColor; uniform float uGround;
        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          float rim = abs(dot(normalize(vNormalW), V));          // facing = through more of the volume
          float body = pow(rim, 1.6);
          float near = smoothstep(0.0, 0.08, vAlong);            // no hard lens disc
          float far = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.7);   // fades to nothing down the road
          float ground = smoothstep(0.0, 0.55, vWorld.y - uGround); // dissolve before touching the asphalt
          float a = uOpacity * body * near * far * ground;
          if (a < 0.002) discard;
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 5;
      m.userData.side = sx; g.add(m);
    }
    g.visible = false;
    return g;
  }

  // car-space headlamp mounts (from the model's lamp flares, else from body dims)
  lampMounts(car) {
    if (car._lampMounts) return car._lampMounts;
    const d = car.dims;
    const heads = (car.model.heads || []).filter((h) => h.userData.lamp === 'head' && h.userData.layer === 'core');
    let pts = heads.map((h) => h.position.clone());
    if (pts.length === 1) {
      // one real lamp detected → mirror across X instead of dropping both to the dim heuristic
      const a = pts[0], b = a.clone(); b.x *= -1; pts = [a, b];
    } else if (pts.length < 2) {
      const y = Math.max(0.55, (d.wheelR || 0.35) + 0.28);
      pts = [new THREE.Vector3(-d.W * 0.32, y, d.L / 2 - 0.15), new THREE.Vector3(d.W * 0.32, y, d.L / 2 - 0.15)];
    }
    pts.sort((a, b) => a.x - b.x);
    car._lampMounts = [pts[0], pts[pts.length - 1]];
    return car._lampMounts;
  }

  // ---------------- helpers ----------------
  addCar(spec, opts) {
    const c = new Car(this, spec, opts);
    c.id = this.idc++;
    this.cars.push(c);
    return c;
  }
  removeCar(c) {
    c.dispose();
    this.cars = this.cars.filter((x) => x !== c);
    this.cops = this.cops.filter((x) => x !== c);
    this.traffic = this.traffic.filter((x) => x !== c);
  }
  distToCamera(c) { return this.camera.position.distanceTo(c.pos); }
  carsNear(car, r) { return this.cars.filter((o) => o !== car && Math.abs(o.pos.x - car.pos.x) < r && Math.abs(o.pos.z - car.pos.z) < r); }
  notify(t, sub = '', color = '#ffb400', big = false) { this.hud.notify(t, sub, color, big); }

  radio(text) {
    if (!this.settings.voice || this.radioCd > 0) return;
    this.radioCd = 5;
    this.audio.radio();
    this.hud.radio(text);
    try {
      if (!window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 1.12; u.pitch = 0.85; u.volume = 0.55 * this.settings.master;
      const v = speechSynthesis.getVoices().find((v) => /en-US/.test(v.lang) && /Male|David|Alex|Daniel|Fred/i.test(v.name)) || speechSynthesis.getVoices().find((v) => /en/.test(v.lang));
      if (v) u.voice = v;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }
  headingWord(car) {
    const a = Math.atan2(car.vel.x, -car.vel.y); // 0 = north (-z)
    const i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    return DIRS[i];
  }
  areaName(car) {
    const p = car.pos;
    if (this.world.mapId === 'tokyo') {
      if (Math.abs(p.x) < 180 && Math.abs(p.z) < 180) return 'Shibuya Scramble';
      if (Math.abs(p.x) < 640 && Math.abs(p.z) < 640) return p.z < 0 ? 'Shinjuku Kabukicho' : 'Roppongi & Tokyo Tower';
      if (p.x > 550) return Math.abs(p.z) < 220 ? 'Rainbow Bridge' : 'the Wangan Bayshore Expressway';
      return 'the Hakone mountain touge';
    }
    if (this.world.mapId === 'stuttgart') {
      if (Math.abs(p.x + 60) < 140 && Math.abs(p.z + 60) < 140) return 'Schlossplatz';
      if (Math.abs(p.x - 60) < 140 && Math.abs(p.z + 180) < 140) return 'Fernsehturm';
      if (Math.abs(p.x) < 640 && Math.abs(p.z) < 640) return p.z < 0 ? 'Mitte & Königstraße' : 'Südstadt';
      if (p.x > 500) return 'Neckartal';
      if (p.x < -500) return 'the Weinberge';
      return Math.hypot(p.x, p.z) > 1100 ? 'Stuttgarter Ring' : 'the hills';
    }
    if (Math.abs(p.x) < 640 && Math.abs(p.z) < 640) return 'downtown';
    if (Math.hypot(p.x, p.z) > 1100) return p.x > 1000 ? 'the coast highway' : 'the highway';
    return 'the hills';
  }

  makeGate() {
    const g = new THREE.Group();
    const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.9, 0.2), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff9a20, emissiveIntensity: 3 });
    const L = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), pylonMat); L.position.set(-12, 3.5, 0);
    const R = L.clone(); R.position.x = 12;
    const top = new THREE.Mesh(new THREE.BoxGeometry(24.6, 0.6, 0.6), pylonMat); top.position.y = 7;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 400, 16, 1, true), beamMat); beam.position.y = 200;
    const tex = glowTexture('rgba(255,180,60,1)', 'rgba(255,120,0,0)', 128);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff }));
    sp.scale.set(14, 14, 1); sp.position.y = 7;
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(24, 7), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.5, 0.1), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    curtain.position.y = 3.5;
    g.add(L, R, top, beam, sp, curtain);
    g.visible = false;
    this.scene.add(g);
    this.gateMats = { pylonMat, beamMat };
    return g;
  }

  // ---------------- lifecycle ----------------
  clear() {
    for (const c of [...this.cars]) c.dispose();
    this.cars = []; this.traffic = []; this.cops = []; this.racers = []; this.netCars = new Map(); this.respawnT = 0; this.spectating = null;
    for (const h of this.helis || []) h.dispose(this.scene);
    this.helis = [];
    for (const s of this.spikes) this.scene.remove(s.mesh);
    this.spikes = []; this.roadblocks = [];
    this.player = null; this.gates.visible = false;
    this.vfx.skids.clear();
    this.rig.endCine();
    this.timeScale = 1; this.slowmo = 0;
    this.copLights.forEach((l) => (l.intensity = 0));
    for (const l of this.headlights) l.intensity = 0;
    this.headFlood.intensity = 0; this.headFill.intensity = 0; this.brakeGlow.intensity = 0;
    if (this.beamGroup) this.beamGroup.visible = false;
  }

  raceRoute() {
    if (this._route && this._routeMap === this.world.mapId) return this._route;
    this._routeMap = this.world.mapId;
    const nav = this.world.nav;
    const C = (x, z) => nav.cityId(x, z);
    const L = (d) => nav.loopId((d * Math.PI) / 180);
    // The race runs the coast loop in ONE direction (decreasing loop index = decreasing compass angle). Entry / exit ramps are pinned:
    // letting A* choose them picked a ramp past the first loop waypoint and the route doubled back on itself (a 176 degree U-turn,
    // which made bots circle and the wrong-way / progress logic fight the player).
    const ramps = nav.ramps || [];
    const pick = (tag) => ramps.filter((r) => r.tag === tag).sort((a, b) => b.loopIndex - a.loopIndex)[0];
    const pickLow = (tag) => ramps.filter((r) => r.tag === tag).sort((a, b) => a.loopIndex - b.loopIndex)[0];
    if (this.world.mapId === 'tokyo') {
      // Tokyo Night route: straight launch north through Shibuya Scramble (0,0) & past Tokyo Tower (60,60) ->
      // Shinjuku Dori onto the Hakone/Haruna mountain touge & Wangan Loop -> Shibuya Dori back into the city ->
      // overhead Shuto Viaduct avenue (z = 240) -> Akihabara / Roppongi finish (0 self-overlaps, 0 border-street kinks)
      const entry = pickLow('north'), exit = pick('south');
      const wps = [
        C(0, 360), C(0, -600),
        entry.navIds[0], entry.navIds[entry.navIds.length - 1],
        L(-115), L(-135), L(-160), L(180), L(155), L(130), L(108),
        exit.navIds[exit.navIds.length - 1], exit.navIds[0],
        C(0, 600), C(0, 240), C(360, 240), C(360, -120), C(120, -120), C(120, 120), C(-240, 120), C(-240, -120),
      ];
      this._route = buildRoute(nav, wps);
      return this._route;
    }
    if (this.world.mapId === 'stuttgart') {
      const entry = pickLow('north'), exit = pick('south');
      const wps = [
        C(0, 360), C(0, -600),
        entry.navIds[0], entry.navIds[entry.navIds.length - 1],
        L(-115), L(-135), L(-160), L(180), L(155), L(130), L(108),
        exit.navIds[exit.navIds.length - 1], exit.navIds[0],
        C(0, 600), C(0, 240), C(360, 240), C(360, -120), C(120, -120), C(-240, -120), C(-240, 120),
      ].filter((id) => id != null);
      this._route = buildRoute(nav, wps);
      return this._route;
    }
    if (this.world.mapId === 'speedway') {
      // One full lap of the high-speed oval (decreasing angle = race direction)
      const wps = [L(90), L(60), L(30), L(0), L(-30), L(-60), L(-90), L(-120), L(-150), L(180), L(150), L(120), L(90)];
      this._route = buildRoute(nav, wps.filter((id) => id != null));
      return this._route;
    }
    const entry = pickLow('north'), exit = pick('south'); // entry merges heading with the race direction (lower index), exit leaves it (higher index)
    const wps = [C(0, 360), C(0, -600), entry.navIds[0], entry.navIds[entry.navIds.length - 1], L(-115), L(-135), L(-160), L(180), L(155), L(130), L(108), exit.navIds[exit.navIds.length - 1], exit.navIds[0], C(0, 600), C(0, 240), C(360, 240), C(360, -120), C(120, -120), C(-240, -120), C(-240, 120)];
    this._route = buildRoute(nav, wps);
    return this._route;
  }

  start(mode, carIdx, multi = null) {
    this.clear();
    this.multi = multi;
    this.mode = mode;
    this.carIdx = carIdx;
    this.time = 0; this.raceTime = 0; this.heat = 0; this.bounty = 0; this.takedowns = 0; this.maxSpeed = 0;
    this.bust = 0; this.finished = []; this.pursuit = false; this.pursuitTime = 0; this.lastSeen = 0; this.cooldown = 0;
    this.roadblockCd = 30; this.nearMiss = new Map(); this.driftT = 0; this.escapes = 0; this.checkIdx = 0;
    this.result = null; this.copSpawnCd = 0; this.trafficCd = 0; this.patrolSpawned = false; this.bustedRacers = 0; this.escapedRacers = 0;
    this.empState = { lock: 0, target: null, cd: 0 }; this.spikeCd = 0;
    this.playerFinished = false; this.playerPlace = 0; this.plIdx = 0; this.playerProgress = 0; this.lastHeat = undefined; this.drown = 0;
    this.position = 0; this.standings = []; this.wrongWay = false; this.drafting = false; this.sirenGlow = null; this.lastHitWith = null;
    const spec = PLAYER_CARS[carIdx];
    const route = mode === 'free' ? null : this.raceRoute();
    this.route = route;
    const police = mode === 'cop';
    this.demo = mode === 'demo';
    if (this.demo) return this.startDemo();
    const pl = this.addCar(police ? { ...spec, armor: spec.armor * 1.3 } : spec, { role: 'player', police, name: 'YOU' });
    pl.addInterior();
    this.player = pl;
    pl.nitro = police ? 1 : mode === 'speed' ? 1 : 0.6;
    const P = {};
    if (multi) this.setupMulti(pl, route);
    else if (route) {
      // checkpoints
      this.checkpoints = [];
      const N = mode === 'speed' ? 12 : 9;
      for (let i = 1; i <= N; i++) this.checkpoints.push((route.length - 60) * (i / N) + 30);
      this.finishDist = this.checkpoints[N - 1];
      const place = (car, dist, lat) => {
        const p = pointAtDist(route, dist, P);
        car.place(p.x + -p.dz * lat, p.z + p.dx * lat, Math.atan2(p.dx, p.dz), 0);
      };
      if (mode === 'race' || mode === 'speed') {
        // Speedway packs wider (3-wide capable deck)
        const grid = mode === 'speed'
          ? [[48, -6], [48, 0], [48, 6], [30, -6], [30, 0], [30, 6]]
          : [[34, -3.5], [34, 3.5], [22, -3.5], [22, 3.5]];
        const pIdx = mode === 'speed' ? 4 : 3;
        let ri = 0;
        grid.forEach((g, i) => {
          if (i === pIdx) { place(pl, g[0], g[1]); return; }
          const ms = PLAYER_CARS[(carIdx + 1 + ri) % PLAYER_CARS.length];
          const col = RACER_COLORS[ri % RACER_COLORS.length];
          const rm = this.rivalModel(carIdx, ri);
          const pace = mode === 'speed' ? (1.02 + ri * 0.015) : (0.985 + ri * 0.012);
          const r = this.addCar({ ...ms, kind: rm.kind || ms.kind, top: ms.top * pace }, { role: 'racer', model: rm.model, color: col[0], color2: col[1], livery: 'stripe', name: RACER_NAMES[ri % RACER_NAMES.length] });
          place(r, g[0], g[1]);
          r.ai = new RacerAI(r, route, mode === 'speed' ? (1.02 + ri * 0.02) : (0.97 + ri * 0.02));
          r.ai.lane = g[1];
          r.nitro = mode === 'speed' ? 0.85 : 0.5;
          this.racers.push(r); ri++;
        });
        this.racers.push(pl);
        if (mode === 'speed') {
          // Cops already on station — chase the pack from the jump
          this.pursuit = true; this.heat = 2; this.lastSeen = 0; this.pursuitTime = 0;
          for (let i = 0; i < 3; i++) {
            const c = this.spawnCop(null, i === 2 ? COP_HEAVY : COP_SPEC);
            place(c, 12 - i * 10, i % 2 ? 8 : -8);
            c.ai.target = this.racers[i % this.racers.length];
          }
        }
      } else {
        // cop mode: 4 racers ahead, player + 2 partners behind
        for (let i = 0; i < 4; i++) {
          const ms = PLAYER_CARS[i % PLAYER_CARS.length];
          const col = RACER_COLORS[i];
          const rm = this.rivalModel(carIdx, i);
          const r = this.addCar({ ...ms, kind: rm.kind || ms.kind, top: ms.top * (0.99 + i * 0.008), armor: ms.armor * 1.0 }, { role: 'racer', model: rm.model, color: col[0], color2: col[1], livery: 'stripe', name: RACER_NAMES[i] });
          place(r, 95 + Math.floor(i / 2) * 12, i % 2 ? 3.5 : -3.5);
          r.ai = new RacerAI(r, route, 0.99 + i * 0.012);
          r.ai.lane = i % 2 ? 3.5 : -3.5;
          r.nitro = 0.6;
          this.racers.push(r);
        }
        place(pl, 40, 0);
        for (let i = 0; i < 2; i++) {
          const c = this.spawnCop(null, i ? COP_SPEC2 : COP_SPEC);
          place(c, 26 - i * 12, i ? 4 : -4);
          c.ai.target = this.racers[i];
        }
      }
    } else {
      pl.place(0, 0, Math.PI, 0);
      this.heat = 1;
    }
    // Speedway / speed mode: no civilians — pure pack racing
    if (mode !== 'speed' && this.world.mapId !== 'speedway') this.spawnInitialTraffic();
    this.rig.setMode(this.settings.camMode || 0);
    this.rig.snap = true;
    this.state = 'countdown';
    this.countdown = 3.99;
    this.lastCount = 4;
    this.audio.music && this.audio.music.setLevel(1);
    this.hud.setMode(mode, this);
    this.updateGate();
  }

  // ---------------- multiplayer ----------------
  // multi = { myId, host, players, roster?, authority?, net, sid, late? }
  setupMulti(pl, route) {
    const M = this.multi;
    if (M.authority === 'server') return this.setupMultiServer(pl, route);
    const me = M.players.find((p) => p.id === M.myId);
    pl.net = { id: M.myId, owner: M.myId, human: true };
    pl.name = me?.name || 'YOU';
    this.netSendT = 0; this.sid = M.sid;
    const rr = this.raceRoute();
    this.botRoute = rr;
    if (route) {
      this.checkpoints = [];
      const N = 9;
      for (let i = 1; i <= N; i++) this.checkpoints.push((route.length - 60) * (i / N) + 30);
      this.finishDist = this.checkpoints[N - 1];
    }
    const humans = M.players.filter((p) => p.role !== 'cop'), cops = M.players.filter((p) => p.role === 'cop');
    const BOT_FILL = 4;
    const nBots = Math.max(0, BOT_FILL - humans.length) + (cops.length ? 0 : 0);
    this.botCount = nBots;
    const total = humans.length + nBots;
    const rows = Math.ceil(total / 2);
    const P = {};
    const lane = (k) => (k % 2 ? 3.5 : -3.5);
    const placeAt = (car, k) => {
      const d = (route ? 34 : 220) + (rows - 1) * 12 - Math.floor(k / 2) * 12;
      const p = pointAtDist(rr, d, P);
      const lat = lane(k);
      car.place(p.x + -p.dz * lat, p.z + p.dx * lat, Math.atan2(p.dx, p.dz), 0);
    };
    const copBehind = (car, k) => {
      const p = pointAtDist(rr, Math.max(6, (route ? 34 : 220) - 26 - Math.floor(k / 2) * 12), P);
      const lat = lane(k);
      car.place(p.x + -p.dz * lat, p.z + p.dx * lat, Math.atan2(p.dx, p.dz), 0);
    };
    for (const p of M.players) {
      const isCop = p.role === 'cop';
      if (M.late && p.id === M.myId && M.late.spawn) { const sp = M.late.spawn; pl.place(sp.x, sp.z, sp.yaw, sp.speed || 0); continue; }
      if (p.id === M.myId) { if (isCop) copBehind(pl, p.slot); else placeAt(pl, p.slot); continue; }
      const spec = PLAYER_CARS[p.car % PLAYER_CARS.length];
      const c = this.addCar(isCop ? { ...spec, armor: spec.armor * 1.3 } : spec, { role: isCop ? 'cop' : 'racer', police: isCop, name: p.name, color: spec.color, color2: spec.color2, livery: spec.livery });
      c.net = { id: p.id, owner: p.id, human: true };
      c.ai = new RemoteAI(c);
      c.nitro = isCop ? 1 : 0.6;
      if (isCop) { copBehind(c, p.slot); c.sirenOn = true; this.cops.push(c); } else { placeAt(c, p.slot); this.racers.push(c); }
      this.netCars.set(p.id, c);
    }
    for (let i = 0; i < nBots; i++) {
      const k = humans.length + i;
      const ms = PLAYER_CARS[(i + 1) % PLAYER_CARS.length];
      const col = RACER_COLORS[i % RACER_COLORS.length];
      const rm = RIVAL_MODELS[i % RIVAL_MODELS.length];
      const c = this.addCar({ ...ms, kind: rm.kind || ms.kind, top: ms.top * (0.985 + i * 0.01) }, { role: 'racer', model: rm.model, color: col[0], color2: col[1], livery: 'stripe', name: 'BOT ' + BOT_NAMES[i % BOT_NAMES.length] });
      const id = 'b' + i;
      c.net = { id, owner: M.host, bot: true };
      placeAt(c, k);
      if (M.host === M.myId) { c.ai = new RacerAI(c, rr, 0.97 + i * 0.015); c.ai.lane = lane(k); }
      else c.ai = new RemoteAI(c);
      c.nitro = 0.5;
      this.netCars.set(id, c);
      this.racers.push(c);
    }
    if (pl.role === 'cop' || pl.police) { /* */ }
    else this.racers.push(pl);
    this.expectedRacers = this.racers.length;
    if (!route) this.heat = 1;
  }

  /** Dedicated Speedway: server sims everyone; client predicts local + interpolates remotes/bots. */
  setupMultiServer(pl, route) {
    const M = this.multi;
    const roster = M.roster || M.players || [];
    const me = roster.find((p) => p.id === M.myId) || M.players?.find((p) => p.id === M.myId);
    pl.net = { id: M.myId, owner: M.myId, human: true, slot: me?.slot ?? 0 };
    pl.name = me?.name || 'YOU';
    this.netSendT = 0; this.sid = M.sid;
    this._slotToId = new Map();
    this.botRoute = route || this.raceRoute();
    this.pursuit = true; this.heat = 2;
    if (route) {
      this.checkpoints = [];
      const N = 12;
      for (let i = 1; i <= N; i++) this.checkpoints.push((route.length - 60) * (i / N) + 30);
      this.finishDist = M.finishDist || this.checkpoints[N - 1];
    }
    const P = {};
    const placeAt = (car, slot) => {
      const grid = [[48, -6], [48, 0], [48, 6], [30, -6], [30, 0], [30, 6], [12, -6], [12, 0], [12, 6], [0, -6], [0, 0], [0, 6]];
      const g = grid[(slot | 0) % grid.length];
      const p = pointAtDist(this.botRoute, g[0], P);
      car.place(p.x + -p.dz * g[1], p.z + p.dx * g[1], Math.atan2(p.dx, p.dz), 0);
    };
    for (const p of roster) {
      this._slotToId.set(p.slot | 0, p.id);
      if (p.id === M.myId) {
        pl.net.slot = p.slot | 0;
        if (M.late?.spawn) {
          const sp = M.late.spawn;
          pl.place(sp.x, sp.z, sp.yaw, sp.speed || 0);
          this.playerProgress = sp.progress || 0;
        } else placeAt(pl, p.slot);
        continue;
      }
      const isCop = p.role === 'cop' || p.cop;
      const spec = PLAYER_CARS[(p.car | 0) % PLAYER_CARS.length];
      const col0 = p.color ?? (isCop ? 0x0b0b0d : spec.color);
      const col1 = p.color2 ?? (isCop ? 0xf2f2f2 : spec.color2);
      const c = this.addCar(isCop ? { ...spec, armor: spec.armor * 1.3 } : spec, {
        role: isCop ? 'cop' : 'racer', police: isCop, name: p.name,
        color: col0, color2: col1, livery: isCop ? 'police' : (p.bot ? 'stripe' : spec.livery),
      });
      c.net = { id: p.id, owner: 'server', human: !!p.human, bot: !!p.bot, slot: p.slot | 0 };
      c.ai = new RemoteAI(c);
      c.nitro = isCop ? 1 : 0.85;
      placeAt(c, p.slot);
      if (isCop) { c.sirenOn = true; this.cops.push(c); } else this.racers.push(c);
      this.netCars.set(p.id, c);
    }
    this.racers.push(pl);
    this.expectedRacers = this.racers.length;
    pl.nitro = 1;
  }

  serverAuthority() { return !!(this.multi && this.multi.authority === 'server'); }
  racerTotal() { return this.multi ? Math.max(1, this.expectedRacers || this.racers.length) : 4; }
  mine(car) {
    if (this.serverAuthority()) return car === this.player;
    return !this.multi || !car.net || car.net.owner === this.multi.myId;
  }
  ownedNetCars() {
    if (this.serverAuthority()) return [this.player];
    const out = [this.player];
    if (this.multi && this.multi.host === this.multi.myId) for (const c of this.netCars.values()) if (c.net.bot) out.push(c);
    return out;
  }
  netSend(dtReal) {
    const M = this.multi; if (!M || !M.net) return;
    this.netSendT -= dtReal;
    if (this.netSendT > 0) return;
    if (this.serverAuthority()) {
      // Inputs only @ ~40 Hz
      this.netSendT = 1 / 40;
      this._netSeq = (this._netSeq || 0) + 1;
      const pl = this.player;
      if (!pl || this.spectating) return;
      const keys = keysFromDrive(pl.input);
      M.net.sendBin(encodeInput(this._netSeq, keys, pl.input.steer || 0));
      return;
    }
    const pl0 = this.player;
    const hot = pl0 && (pl0.nitroActive || pl0.speed > 45 || this.spectating);
    this.netSendT = hot ? 1 / 25 : 1 / 20;
    this._netSeq = (this._netSeq || 0) + 1;
    const r = (v, k = 100) => Math.round(v * k) / k;
    const cars = this.ownedNetCars().map((c) => {
      const pl = c === this.player;
      const prog = pl ? this.playerProgress || 0 : c.ai?.progress || 0;
      const f = (c.wrecked ? 1 : 0) | (c.nitroActive ? 2 : 0) | ((pl ? this.playerFinished : c.ai?.finished) ? 4 : 0) | (c.input.handbrake ? 8 : 0) | (c.input.nitro ? 16 : 0) | (pl && this.spectating ? 32 : 0);
      return [c.net.id, r(c.pos.x), r(c.pos.y), r(c.pos.z), r(c.yaw, 1000), r(c.vel.x), r(c.vel.y), r(c.angVel, 1000), r(c.health, 1000), f, Math.round(prog), r(c.input.steer), r(c.input.throttle), r(c.input.brake), r(c.nitro)];
    });
    const pl = this.player;
    M.net.send({ t: 's', sid: this.sid, seq: this._netSeq, me: [M.myId, pl.name, this.carIdx, pl.police ? 'cop' : 'racer'], cars });
  }
  // a snapshot arrived from a player this client has no car for (joined late via a bot handover, or the 'assign'
  // never reached us): build their car on the spot instead of silently ignoring them forever
  spawnRemote(id, name, carIdx, role) {
    if (this.netCars.has(id) || id === this.multi.myId) return this.netCars.get(id);
    const isCop = role === 'cop';
    const spec = PLAYER_CARS[(carIdx | 0) % PLAYER_CARS.length];
    const c = this.addCar(isCop ? { ...spec, armor: spec.armor * 1.3 } : spec, { role: isCop ? 'cop' : 'racer', police: isCop, name: name || 'RACER', color: spec.color, color2: spec.color2, livery: spec.livery });
    c.net = { id, owner: id, human: true };
    c.ai = new RemoteAI(c);
    c.nitro = isCop ? 1 : 0.6;
    if (isCop) { c.sirenOn = true; this.cops.push(c); } else this.racers.push(c);
    this.netCars.set(id, c);
    this.expectedRacers = Math.max(this.expectedRacers || 0, this.racers.length);
    this.notify('PLAYER JOINED', c.name, '#3aff90');
    return c;
  }
  dropNetCar(id) {
    const c = this.netCars.get(id); if (!c) return;
    this.netCars.delete(id);
    this.racers = this.racers.filter((x) => x !== c); this.cops = this.cops.filter((x) => x !== c);
    this.removeCar(c);
  }
  onNet(m) {
    if (!this.multi) return;
    if (m.t === 'snap') return this.onServerSnap(m.snap);
    if (m.t === 'joined' && this.serverAuthority()) {
      // New human replaced a bot — drop bot, spawn remote
      if (m.takeBot) this.dropNetCar(m.takeBot);
      if (!this.netCars.has(m.id) && m.id !== this.multi.myId) {
        const c = this.spawnRemote(m.id, m.name, m.car, 'racer');
        if (c) { c.net.slot = m.slot | 0; this._slotToId?.set(m.slot | 0, m.id); }
      }
      return;
    }
    if (m.t === 'end' && this.serverAuthority()) {
      if (this.state === 'playing' || this.state === 'countdown') {
        const mine = (m.standings || []).find((s) => s.id === this.multi.myId);
        const place = mine?.finished ? (m.standings.filter((s) => s.finished).findIndex((s) => s.id === this.multi.myId) + 1) : 0;
        if (mine?.finished) { this.playerFinished = true; this.playerPlace = place; this.endGame('finish', true); }
        else if (mine?.out) this.endGame('busted', true);
        else this.endGame(m.reason === 'complete' ? 'finish' : 'wrecked', true);
      }
      return;
    }
    if (m.t === 'event' && m.kind === 'finish' && this.serverAuthority()) {
      if (m.id === this.multi.myId) { this.playerFinished = true; this.finishRace(); }
      else {
        const c = this.netCars.get(m.id);
        if (c && !c.ai?.finished) { c.ai.finished = true; this.finished.push(c); }
      }
      return;
    }
    if (this.serverAuthority() && (m.t === 'joinreq' || m.t === 'assign' || m.t === 's')) return;
    if (m.t === 'joinreq' && this.multi.host === this.multi.myId) return this.assignBot(m);
    if (m.t === 'taken') { this.dropNetCar(m.bot); return; }
    if (m.t === 's') {
      if (m.sid != null && this.sid != null && m.sid !== this.sid) return; // stale/other session: never mix realities
      if (Array.isArray(m.me) && m.me[0] === m.from && this.state !== 'idle') {
        const own = (m.cars || []).some((a) => a[0] === m.from);
        if (own && !this.netCars.has(m.from)) this.spawnRemote(m.me[0], m.me[1], m.me[2], m.me[3]);
      }
      const now = performance.now() * 0.001;
      for (const a of m.cars || []) {
        let c = this.netCars.get(a[0]);
        // bot ids are host-scoped: only accept bot snapshots from whoever actually simulates them
        if (c && c.net.bot && m.from && c.net.owner !== m.from) c.net.owner = m.from;
        if (!c || !(c.ai instanceof RemoteAI)) continue;
        c.ai.pushSnap({
          x: a[1], y: a[2], z: a[3], yaw: a[4], vx: a[5], vz: a[6], av: a[7],
          h: a[8], f: a[9], st: a[11], th: a[12], br: a[13], nitro: a[14],
          seq: m.seq,
        }, now);
        c.ai.progress = a[10];
        c.health = a[8]; c.nitro = a[14] ?? c.nitro; c.out = !!(a[9] & 32);
        if (a[9] & 4 && !c.ai.finished && this.route) { c.ai.finished = true; this.finished.push(c); }
        if (!(a[9] & 1) && c.wrecked) { c.wrecked = false; c.sirenOn = undefined; }
        else if (a[9] & 1 && !c.wrecked) { c.wrecked = true; c.wreckTime = this.time; c.health = 0; } // missed the 'wreck' event: converge anyway
      }
    } else if (m.t === 'wreck') {
      const c = this.netCars.get(m.id);
      if (!c || c.wrecked) return;
      c.wrecked = true; c.wreckTime = this.time; c.health = 0;
      c.angVel += (Math.random() - 0.5) * 6; c.vy = 5 + Math.random() * 3; c.grounded = false;
      this.vfx.explosion(c.pos.x, c.pos.y, c.pos.z, c.vel.x, c.vel.y);
      if (c.pos.distanceTo(this.player.pos) < 200) this.audio.takedown();
      if (m.by && m.by === this.multi.myId) {
        this.takedowns++; this.bounty += 2500; this.takedownReward();
        this.notify('TAKEDOWN!', `${c.name} wrecked  +2500`, '#ff3060', true);
        this.takedownCam(c);
      } else {
        const by = m.by && this.netCars.get(m.by);
        this.notify(`${c.name} WRECKED`, by ? `by ${by.name}` : '', '#ffb400');
      }
    } else if (m.t === 'spike') {
      const c = this.netCars.get(m.from);
      const ghost = { pos: new THREE.Vector3(m.x, this.world.heightAt(m.x, m.z), m.z), yaw: m.yaw };
      this.dropSpike(ghost, null, true, true);
      if (c && c.pos.distanceTo(this.player.pos) < 200) this.audio.spikes();
      this.notify('SPIKE STRIP', `${c ? c.name : 'A cop'} laid spikes`, '#3a80ff');
    } else if (m.t === 'dmg') {
      // damage addressed to a car this client owns (EMP, takedown hits from remote cops)
      const c = m.id === this.multi.myId ? this.player : this.netCars.get(m.id);
      if (!c || !this.mine(c)) return;
      if (m.kind === 'emp') { c.empTimer = 2.5; if (c === this.player) { this.notify('EMP HIT!', 'A cop fried your electronics', '#ff4040'); this.rig.addShake(0.5); this.hud.flashDamage(0.5); } }
      if (m.amt) this.damage(c, m.amt, this.netCars.get(m.by) || null);
    } else if (m.t === 'bust') {
      // a human racer was busted by a human cop: every client counts it
      { const bc = this.netCars.get(m.id); if (bc) bc.out = true; }
      if (m.id !== this.multi.myId && !this.bustSeen?.has(m.id)) { (this.bustSeen ||= new Set()).add(m.id); this.bustedRacers++; this.notify('BUSTED!', `${m.name || 'Racer'} busted (${this.bustedRacers}/${this.racerTotal()})`, '#3aa0ff', true); }
    } else if (m.t === 'escape') {
      if (!this.escSeen?.has(m.id)) { (this.escSeen ||= new Set()).add(m.id); this.escapedRacers++; this.notify('RACER ESCAPED', `${m.name || 'Racer'} got away`, '#ff6040'); }
    } else if (m.t === 'gone') {
      for (const [id, c] of [...this.netCars]) {
        if (c.net.owner !== m.from && id !== m.from) continue;
        this.dropNetCar(id);
        if (c.net.human) this.notify('PLAYER LEFT', c.name, '#aaaaaa');
      }
    }
  }
  /** Apply a dedicated-server binary snapshot (remotes interp + local reconcile). */
  onServerSnap(snap) {
    if (!snap || !this.multi) return;
    const now = snap.recvAt || (performance.now() * 0.001);
    const slotMap = this._slotToId;
    for (const a of snap.cars) {
      let cid = slotMap?.get(a.slot);
      if (!cid) {
        for (const [nid, c] of this.netCars) if ((c.net.slot | 0) === a.slot) { cid = nid; break; }
        if (!cid && (this.player?.net?.slot | 0) === a.slot) cid = this.multi.myId;
      }
      if (!cid) continue;
      if (cid === this.multi.myId) {
        this.reconcileLocal(a);
        continue;
      }
      let c = this.netCars.get(cid);
      if (!c || !(c.ai instanceof RemoteAI)) continue;
      c.ai.pushSnap({
        x: a.x, y: a.y, z: a.z, yaw: a.yaw, vx: a.vx, vz: a.vz, av: a.av,
        h: a.health, f: a.flags, st: 0, th: 0, br: 0, nitro: a.nitro,
        seq: snap.tick,
      }, now);
      c.ai.progress = a.progress;
      c.health = a.health; c.nitro = a.nitro;
      c.out = !!(a.flags & F_OUT);
      if ((a.flags & F_FINISHED) && !c.ai.finished && this.route) { c.ai.finished = true; this.finished.push(c); }
      if (!(a.flags & F_WRECKED) && c.wrecked) { c.wrecked = false; c.sirenOn = undefined; }
      else if ((a.flags & F_WRECKED) && !c.wrecked) { c.wrecked = true; c.wreckTime = this.time; c.health = 0; }
      c.nitroActive = !!(a.flags & F_NITRO_ON);
    }
  }

  /** Soft-correct local prediction against server truth (same thresholds as netSmooth). */
  reconcileLocal(a) {
    const pl = this.player; if (!pl) return;
    const dx = a.x - pl.pos.x, dz = a.z - pl.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 225) {
      pl.pos.set(a.x, a.y, a.z); pl.yaw = a.yaw; pl.vel.set(a.vx, a.vz); pl.angVel = a.av;
    } else if (d2 > 0.05) {
      const k = 0.22;
      pl.pos.x += dx * k; pl.pos.z += dz * k;
      if (Math.abs(a.y - pl.pos.y) > 0.5) pl.pos.y += (a.y - pl.pos.y) * k;
      pl.yaw = wrapAngle(pl.yaw + wrapAngle(a.yaw - pl.yaw) * k);
      pl.vel.x += (a.vx - pl.vel.x) * k; pl.vel.y += (a.vz - pl.vel.y) * k;
      pl.angVel = lerp(pl.angVel, a.av, k);
    }
    pl.health = a.health; pl.nitro = a.nitro;
    this.playerProgress = Math.max(this.playerProgress || 0, a.progress || 0);
    if (a.flags & F_FINISHED) this.playerFinished = true;
    if (a.flags & F_OUT) pl.out = true;
    if ((a.flags & F_WRECKED) && !pl.wrecked) { pl.wrecked = true; pl.wreckTime = this.time; pl.health = 0; }
  }

  // owner hands a bot's slot (car, position, race progress) to a player who pressed START while the session runs
  assignBot(m) {
    if (this.serverAuthority()) return;
    const bot = [...this.netCars.values()].find((c) => c.net.bot && !c.wrecked && !c.net.taken);
    if (!bot || !this.multi.net) return;
    bot.net.taken = m.from;
    const progress = bot.ai?.progress || 0;
    this.multi.net.send({ t: 'assign', to: m.from, event: this.multi.event, map: this.world.mapId, sid: this.sid, host: this.multi.myId, players: [{ id: m.from, name: m.name, role: m.role, car: m.car, slot: 0 }], spawn: { x: bot.pos.x, z: bot.pos.z, yaw: bot.yaw, speed: bot.speed, progress }, takeBot: bot.net.id });
    // that bot disappears here (the relay tells every other client via 'taken'); the new player's own car,
    // streamed from their client, replaces it everywhere — other clients spawn it from its first snapshot
    this.dropNetCar(bot.net.id);
  }
  netSmooth(dt) {
    const now = performance.now() * 0.001;
    const rtt = (this.multi.net && this.multi.net.rtt) || 0.08;
    // Render delay: half RTT + jitter pad. Stay in the buffer so we blend known poses, not guesses.
    const delay = clamp(rtt * 0.45 + 0.045, 0.055, 0.14);
    const renderT = now - delay;
    for (const c of this.netCars.values()) {
      const ai = c.ai; if (!(ai instanceof RemoteAI)) continue;
      const s = ai.sample(renderT); if (!s) continue;
      const dx = s.x - c.pos.x, dz = s.z - c.pos.z;
      const d2 = dx * dx + dz * dz;
      // Hard snap on big desync (teleport / late join / long stall); otherwise blend hard toward the interp pose
      if (d2 > 225) {
        c.pos.set(s.x, s.y, s.z); c.yaw = s.yaw; c.vel.set(s.vx, s.vz); c.angVel = s.av;
      } else {
        const rate = s.extrap ? 10 : (ai.lagging ? 6 : 22);
        const k = 1 - Math.exp(-dt * rate);
        c.pos.x += dx * k; c.pos.z += dz * k;
        if (!c.grounded || Math.abs(s.y - c.pos.y) > 2.5) c.pos.y += (s.y - c.pos.y) * k;
        c.yaw = wrapAngle(c.yaw + wrapAngle(s.yaw - c.yaw) * k);
        c.vel.x += (s.vx - c.vel.x) * k; c.vel.y += (s.vz - c.vel.y) * k;
        c.angVel = lerp(c.angVel, s.av, k);
      }
      c.nitroActive = !!(s.f & 2);
      if (s.nitro != null) c.nitro = s.nitro;
    }
  }
  /** Mid-session host change: take over bot simulation so the pack doesn't freeze when the old host drops. */
  adoptHost(newHostId) {
    if (this.serverAuthority()) return;
    if (!this.multi || !newHostId || this.multi.host === newHostId) return;
    const was = this.multi.host;
    this.multi.host = newHostId;
    if (newHostId !== this.multi.myId) return;
    const route = this.botRoute || this.route || this.raceRoute();
    let n = 0;
    for (const c of this.netCars.values()) {
      if (!c.net?.bot) continue;
      c.net.owner = newHostId;
      if (!(c.ai instanceof RacerAI)) {
        const lane = c.ai?.lane ?? ((n % 2) ? 3.5 : -3.5);
        const prog = c.ai?.progress || 0;
        c.ai = new RacerAI(c, route, 0.97 + (n % 4) * 0.015);
        c.ai.lane = lane; c.ai.progress = prog;
        n++;
      }
    }
    if (n) this.notify('HOST', 'You are simulating the pack now', '#3aff90');
    else if (was !== newHostId) this.notify('HOST', 'You are now the session host', '#3aff90');
  }
  multiRules(dt) {
    if (this.spectating && this.state === 'playing' && !this.aliveHumans().length) { this.endGame(this.spectating.reason, true); return; }
    // host keeps free-roam bots circulating along the race loop
    if (this.multi.host === this.multi.myId && this.mode === 'free') {
      for (const c of this.netCars.values()) {
        if (!c.net.bot || !(c.ai instanceof RacerAI)) continue;
        if (c.ai.progress > this.botRoute.length - 120 || (c.wrecked && this.time - c.wreckTime > 6)) {
          const p = pointAtDist(this.botRoute, 40, {});
          c.place(p.x + -p.dz * c.ai.lane, p.z + p.dx * c.ai.lane, Math.atan2(p.dx, p.dz), 10);
          c.ai.idx = 0; c.ai.progress = 0; c.ai.finished = false;
          c.wrecked = false; c.health = 1;
        }
      }
    }
    // free-roam: respawn instead of ending the session
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        const pl = this.player;
        pl.wrecked = false; pl.health = 1; pl.nitro = Math.max(pl.nitro, 0.5); pl.flatTimer = 0; pl.empTimer = 0;
        this.resetPlayer();
        this.state = 'playing';
      }
    }
  }
  // ---- spectator mode (multiplayer, Race / Interceptor): when you die and other REAL players are still racing you watch them;
  // the event ends for everybody once every real player is out (wrecked / busted / finished / left). Bots never keep it alive.
  aliveHumans() {
    const out = [];
    for (const c of this.netCars.values()) if (c.net.human && !c.out && !c.wrecked && !c.ai?.finished) out.push(c);
    return out;
  }
  /** Prefer the lead racer, then nearest human — used on first enter so you don't land on a stuck car. */
  pickSpecId(alive) {
    if (!alive.length) return null;
    if (this.route) {
      let best = alive[0], bp = -1;
      for (const c of alive) {
        const p = c === this.player ? this.playerProgress : (c.ai?.progress || 0);
        if (p > bp) { bp = p; best = c; }
      }
      return best.net.id;
    }
    return alive[0].net.id;
  }
  specTarget() {
    if (!this.spectating) return null;
    const alive = this.aliveHumans(); if (!alive.length) return null;
    let cur = alive.find((c) => c.net.id === this.spectating.id);
    if (!cur) {
      this.spectating.id = this.pickSpecId(alive);
      cur = alive.find((c) => c.net.id === this.spectating.id) || alive[0];
      if (this.rig) this.rig.snap = true;
    }
    this.spectating.id = cur.net.id;
    return cur;
  }
  specCycle(dir) {
    if (!this.spectating) return;
    const alive = this.aliveHumans(); if (!alive.length) return;
    const i = Math.max(0, alive.findIndex((c) => c.net.id === this.spectating.id));
    this.spectating.id = alive[(i + dir + alive.length) % alive.length].net.id;
    if (this.rig) this.rig.snap = true;
    this.audio.click && this.audio.click();
  }
  goSpectator(reason) {
    const alive = this.aliveHumans();
    this.spectating = { reason, id: this.pickSpecId(alive) };
    this.pursuit = false; this.bust = 0; this.cooldown = 20; this.heat = 1; this.pursuitTime = 0;
    for (const c of [...this.cops]) { if (c.ai) { c.sirenOn = false; c.ai.target = null; c.ai.retire = true; } }
    const pl = this.player; pl.input.throttle = 0; pl.input.nitro = 0;
    if (this.rig) { this.rig.snap = true; if (this.rig.mode === 'cockpit' || this.rig.mode === 'hood') this.rig.setMode(0); }
    if (reason === 'busted') { this.audio.busted(); this.notify('BUSTED', 'You are out — spectating the pack', '#ff3050', true); }
    else { this.notify('WRECKED', 'You are out — spectating the pack', '#ff3050', true); }
  }
  softFail(reason) {
    // multiplayer free roam: losing doesn't end the session
    const pl = this.player;
    this.notify(reason === 'busted' ? 'BUSTED' : 'WRECKED', 'Respawning…', '#ff3050', true);
    if (reason === 'busted') { this.audio.busted(); this.bounty = Math.round(this.bounty * 0.5); }
    this.pursuit = false; this.bust = 0; this.cooldown = 20; this.heat = 1; this.pursuitTime = 0;
    for (const c of [...this.cops]) { c.sirenOn = false; c.ai.target = null; c.ai.retire = true; }
    pl.input.throttle = 0;
    this.respawnT = 3;
  }

  startDemo() {
    const route = this.raceRoute();
    this.route = null; this.demoRoute = route;
    const pl = this.addCar(PLAYER_CARS[Math.floor(Math.random() * PLAYER_CARS.length)], { role: 'player', name: 'DEMO' });
    this.player = pl;
    const P = {};
    const start = 200 + Math.random() * (route.length - 1500);
    const p = pointAtDist(route, start, P);
    pl.place(p.x, p.z, Math.atan2(p.dx, p.dz), 30);
    pl.ai = new RacerAI(pl, route, 0.95); pl.ai.idx = p.index; pl.ai.lane = 0; pl.nitro = 1;
    for (let i = 0; i < 2; i++) {
      const q = pointAtDist(route, start - 30 - i * 25, {});
      const c = this.spawnCop({ x: q.x + (i ? 3 : -3) * -q.dz, z: q.z + (i ? 3 : -3) * q.dx, yaw: Math.atan2(q.dx, q.dz), speed: 28 });
      c.ai.target = pl;
    }
    const r2 = this.addCar({ ...PLAYER_CARS[1], kind: 'super' }, { role: 'racer', model: 'sport', color: 0x1ec8ff, color2: 0x101010, livery: 'stripe', name: 'NOVA' });
    const q = pointAtDist(route, start + 20, {});
    r2.place(q.x + 3 * -q.dz, q.z + 3 * q.dx, Math.atan2(q.dx, q.dz), 30);
    r2.ai = new RacerAI(r2, route, 0.97); r2.ai.idx = q.index; r2.ai.lane = 3;
    this.racers = [r2, pl];
    this.spawnInitialTraffic();
    this.state = 'playing'; this.pursuit = true; this.heat = 2;
    this.demoStart = start;
  }

  // ---------------- spawning ----------------
  // pick a rival model that differs from the player's car (and from other rivals where possible)
  rivalModel(carIdx, i) {
    const pc = PLAYER_CARS[carIdx % PLAYER_CARS.length];
    const mine = pc.model || (pc.kind === 'gt' ? 'concept' : 'ferrari');
    const pool = RIVAL_MODELS.filter((r) => r.model !== mine);
    return pool[i % pool.length];
  }
  spawnCop(pos, spec = COP_SPEC) {
    const military = spec.kind === 'tank';
    const c = this.addCar(spec, { role: 'cop', military, color: spec.color, color2: spec.color2 });
    c.ai = new CopAI(c, this);
    c.health = 1;
    if (military) { c.sirenOn = false; c.health = 1.4; }
    this.cops.push(c);
    if (pos) c.place(pos.x, pos.z, pos.yaw || 0, pos.speed || 0);
    return c;
  }
  spawnHeli(nearPl = true) {
    const pl = this.player;
    const h = new Helicopter(this.scene);
    const n = this.helis.length;
    h.slot = n;
    // Always spawn on the lead station (ahead + lane) so they never pop in behind the chase cam
    const pfx = Math.sin(pl.yaw), pfz = Math.cos(pl.yaw);
    const prx = -pfz, prz = pfx;
    const lanes = [0, -18, 18, -34, 34];
    const lat = lanes[n % lanes.length];
    const ahead = nearPl ? (55 + (n % 3) * 12) : (90 + Math.random() * 40);
    h.alt = 16 + (n % 3) * 3.5;
    h.targetAlt = h.alt;
    h.place(pl.pos.x + pfx * ahead + prx * lat, pl.pos.z + pfz * ahead + prz * lat, pl.yaw);
    // Match road speed immediately so they hold the lead instead of getting rear-ended by the pack
    h.vel.set(pl.vel.x, 0, pl.vel.y);
    this.helis.push(h);
    return h;
  }
  /** Place a tank ahead/beside the player so chase cam sees armor immediately (not behind the camera). */
  spawnNearbyTank() {
    const pl = this.player;
    const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw);
    const rx = -fz, rz = fx;
    const n = (this.cops || []).filter((c) => c.military).length;
    const ahead = 24 + (n % 4) * 14 + Math.random() * 10;
    const lat = ((n % 2) ? -1 : 1) * (6 + (n % 3) * 5 + Math.random() * 4);
    const x = pl.pos.x + fx * ahead + rx * lat;
    const z = pl.pos.z + fz * ahead + rz * lat;
    const c = this.spawnCop(null, COP_TANK);
    // Face the player / block the road
    c.place(x, z, Math.atan2(pl.pos.x - x, pl.pos.z - z), 10);
    c.ai.target = pl;
    c.sirenOn = false;
    return c;
  }
  spawnInitialTraffic() {
    const nav = this.world.nav;
    // denser pack so near-misses happen every few seconds on highways (capped harder on Low/Med for GPU)
    const count = this.settings.quality === 0 ? 10 : this.settings.quality === 1 ? 11 : 28;
    for (let i = 0; i < count; i++) {
      let wsum = 0; for (const t of TRAFFIC_SPECS) wsum += t.w || 1; let wr = Math.random() * wsum; let ts = TRAFFIC_SPECS[0]; for (const t of TRAFFIC_SPECS) { wr -= t.w || 1; if (wr <= 0) { ts = t; break; } }
      const spec = { kind: ts.kind, top: 34, accel: 8, grip: 8, steer: 0.8, mass: ts.kind === 'truck' ? 3 : ts.kind === 'suv' ? 1.6 : 1.1, armor: 1 };
      const c = this.addCar(spec, { role: 'traffic', model: ts.model, color: ts.colors[Math.floor(Math.random() * ts.colors.length)], color2: 0xeeeeee, taxi: ts.taxi, livery: ts.taxi ? 'taxi' : 'plain' });
      c.ai = new TrafficAI(c, this);
      this.traffic.push(c);
      this.respawnTraffic(c, true);
    }
  }
  respawnTraffic(c, initial = false) {
    const nav = this.world.nav, pl = this.player;
    const camF = new THREE.Vector3(); this.camera.getWorldDirection(camF);
    const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw);
    // Prefer packing cars ahead on the player's road so the frame stays "alive"
    if (!initial && this.route && Math.random() < 0.55) {
      const ahead = (this.playerProgress || 0) + 90 + Math.random() * 260;
      if (ahead < this.route.length - 40) {
        const p = pointAtDist(this.route, ahead, {});
        const n = nav.nearest(p.x, p.z);
        if (n && !this.cars.some((o) => o !== c && (o.pos.x - n.x) ** 2 + (o.pos.z - n.z) ** 2 < 280)) {
          const sameDir = Math.random() < 0.55 ? 1 : -1;
          c.ai.spawnAt(n, this, p.dx * sameDir, p.dz * sameDir);
          return;
        }
      }
    }
    for (let tries = 0; tries < 40; tries++) {
      const n = nav.nodes[Math.floor(Math.random() * nav.nodes.length)];
      const dx = n.x - pl.pos.x, dz = n.z - pl.pos.z; const d = Math.hypot(dx, dz);
      if (initial ? (d < 40 || d > 700) : (d < 180 || d > 580)) continue;
      const aheadDot = (dx * fx + dz * fz) / d;
      // bias toward ahead/sideband traffic; avoid dumping cars into the camera frustum on top of the player
      if (!initial && aheadDot < -0.2 && Math.random() < 0.7) continue;
      if (!initial && (dx * camF.x + dz * camF.z) / d > 0.55 && d < 220) continue;
      if (this.cars.some((o) => o !== c && (o.pos.x - n.x) ** 2 + (o.pos.z - n.z) ** 2 < 320)) continue;
      c.ai.spawnAt(n, this);
      return;
    }
  }
  spawnPursuitCop() {
    const nav = this.world.nav, pl = this.player;
    if (this.route && Math.random() < 0.6) {
      const d = (this.playerProgress || 0) + 320 + Math.random() * 260;
      if (d < this.route.length - 80) {
        const p = pointAtDist(this.route, d, {});
        const inCity = Math.abs(p.x) < 640 && Math.abs(p.z) < 640;
        const oncoming = !inCity && Math.random() < 0.35;
        const lat = (oncoming ? -1 : 1) * (3 + Math.random() * 3);
        const x = p.x + -p.dz * lat, z = p.z + p.dx * lat;
        if (!this.cars.some((o) => (o.pos.x - x) ** 2 + (o.pos.z - z) ** 2 < 100)) {
          const c = this.spawnCop(null, this.pickCopSpec());
          c.place(x, z, Math.atan2(p.dx, p.dz) + (oncoming ? Math.PI : 0), oncoming ? 18 : (c.military ? 14 : 32));
          c.ai.target = this.pickTarget(c);
          return c;
        }
      }
    }
    const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw);
    for (let tries = 0; tries < 40; tries++) {
      const n = nav.nodes[Math.floor(Math.random() * nav.nodes.length)];
      const dx = n.x - pl.pos.x, dz = n.z - pl.pos.z; const d = Math.hypot(dx, dz);
      if (d < 220 || d > 480) continue;
      const ahead = (dx * fx + dz * fz) / d;
      if (Math.random() < 0.6 && ahead > 0.2) continue; // prefer behind/side
      if (this.cars.some((o) => (o.pos.x - n.x) ** 2 + (o.pos.z - n.z) ** 2 < 100)) continue;
      const c = this.spawnCop(null, this.pickCopSpec());
      const toPlX = pl.pos.x - n.x, toPlZ = pl.pos.z - n.z;
      let bestE = n.edges[0], bestDot = -2;
      for (const cand of n.edges) {
        const cm = nav.nodes[cand.to];
        const ex = cm.x - n.x, ez = cm.z - n.z, el = Math.hypot(ex, ez) || 1;
        const dot = (ex * toPlX + ez * toPlZ) / el;
        if (dot > bestDot) { bestDot = dot; bestE = cand; }
      }
      const m = nav.nodes[bestE.to];
      c.place(n.x, n.z, Math.atan2(m.x - n.x, m.z - n.z), c.military ? 12 : 20);
      c.ai.target = this.pickTarget(c);
      return c;
    }
    return null;
  }
  /** Military / BLACKOUT response — folds into normal hot pursuit once heat is high enough (not on the pure-speed oval). */
  milLive() { return this.heat >= 4 && this.mode !== 'speed' && this.world.mapId !== 'speedway'; }

  pickCopSpec() {
    if (this.milLive()) {
      // Heat 4–5 = BLACKOUT PROTOCOL: armor floods the street
      if (this.heat >= 5 && Math.random() < 0.9) return COP_TANK;
      if (this.heat >= 4 && Math.random() < 0.75) return COP_TANK;
      if (Math.random() < 0.4) return COP_HEAVY;
      return Math.random() < 0.5 ? COP_SPEC : COP_SPEC2;
    }
    const heavy = this.heat >= 3 && Math.random() < 0.3;
    return heavy ? COP_HEAVY : Math.random() < 0.5 ? COP_SPEC : COP_SPEC2;
  }
  pickTarget(cop) {
    if (this.mode === 'free' || !this.racers.length) return this.player;
    let best = null, bs = 1e9;
    for (const r of this.racers) {
      if (r.wrecked || (r.ai && r.ai.finished) || (r === this.player && this.playerFinished)) continue;
      if (!this.mine(r)) continue;
      let d = r.pos.distanceTo(cop.pos);
      if (r === this.player) d *= 0.45;
      if (d < bs) { bs = d; best = r; }
    }
    return best;
  }

  spawnRoadblock() {
    const pl = this.player, nav = this.world.nav;
    let px, pz, dx, dz;
    if (this.route) {
      const p = pointAtDist(this.route, this.playerProgress + 520, {});
      if (this.playerProgress + 520 > this.route.length - 50) return;
      px = p.x; pz = p.z; dx = p.dx; dz = p.dz;
    } else {
      const fx = pl.vel.x / (pl.speed || 1), fz = pl.vel.y / (pl.speed || 1);
      const n = nav.nearest(pl.pos.x + fx * 420, pl.pos.z + fz * 420);
      if (!n) return;
      let bestE = null, bd = -2;
      for (const e of n.edges) { const m = nav.nodes[e.to]; const ex = m.x - n.x, ez = m.z - n.z, el = Math.hypot(ex, ez); const d = (ex * fx + ez * fz) / el; if (d > bd) { bd = d; bestE = { ex: ex / el, ez: ez / el }; } }
      if (!bestE) return;
      px = n.x; pz = n.z; dx = bestE.ex; dz = bestE.ez;
    }
    if (Math.hypot(px - pl.pos.x, pz - pl.pos.z) < 250) return;
    const rx = -dz, rz = dx;
    const hw = this.world.hf.roadDist(px, pz) < -11 ? 13 : 10;
    const slots = hw > 12 ? [-9.5, -3.5, 6] : [-6.5, 3];
    const rb = { cars: [], x: px, z: pz };
    slots.forEach((lat, i) => {
      const armor = this.milLive() || (this.heat >= 4 && i === 1);
      const c = this.spawnCop(null, armor ? COP_TANK : (i === 1 && this.heat >= 4 ? COP_HEAVY : COP_SPEC));
      const yaw = Math.atan2(dx, dz) + Math.PI / 2 + (i % 2 ? 0.35 : -0.35);
      c.place(px + rx * lat, pz + rz * lat, yaw, 0);
      c.ai.parked = true; c.ai.target = this.player;
      rb.cars.push(c);
    });
    if (this.heat >= 4) {
      const fake = { pos: new THREE.Vector3(px - dx * 25 + rx * 1, 0, pz - dz * 25 + rz * 1), yaw: Math.atan2(dx, dz) + Math.PI };
      this.dropSpike(fake, null, true);
    }
    this.roadblocks.push(rb);
    this.notify('ROADBLOCK AHEAD', this.milLive() ? 'Armor roadblock ahead!' : 'Roadblock ahead! Find the gap', '#ff4040');
    this.radio(this.milLive() ? 'Armor blockade is set. Hold the line.' : 'Roadblock is set up ahead. All units hold position.');
  }

  dropSpike(cop, target, silent = false, remote = false) {
    if (!remote && this.multi && this.multi.net && cop === this.player && !this.serverAuthority()) this.multi.net.send({ t: 'spike', x: cop.pos.x, z: cop.pos.z, yaw: cop.yaw });
    const fx = Math.sin(cop.yaw), fz = Math.cos(cop.yaw);
    const x = cop.pos.x - fx * 7, z = cop.pos.z - fz * 7;
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 0.45), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }));
    g.add(base);
    const spikeG = new THREE.ConeGeometry(0.06, 0.22, 4);
    const sm = new THREE.InstancedMesh(spikeG, new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.2 }), 40);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) { m4.makeTranslation(-3.9 + (i % 20) * 0.41, 0.12, i < 20 ? -0.12 : 0.12); sm.setMatrixAt(i, m4); }
    g.add(sm);
    const warn = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.03, 0.12), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa000, emissiveIntensity: 2 }));
    warn.position.y = 0.05; g.add(warn);
    const y = this.world.heightAt(x, z) + 0.18;
    g.position.set(x, y, z); g.rotation.y = cop.yaw;
    this.scene.add(g);
    this.spikes.push({ mesh: g, x, z, yaw: cop.yaw, t: 25, hit: new Set() });
    if (!silent && target === this.player) { this.notify('SPIKE STRIP', 'Spike strip deployed!', '#ff4040'); this.radio('Spike strip deployed!'); }
  }

  // ---------------- events ----------------
  onLanding(car, air) {
    if (car === this.player) {
      this.audio.landing(clamp(air, 0.3, 1));
      this.punch('landing', clamp(air / 0.9, 0.4, 1.2));
      if (air > 0.6) { this.notify('AIR TIME', `${air.toFixed(1)}s`, '#40d0ff'); car.nitro = Math.min(1, car.nitro + 0.1); this.bounty += 500; }
    }
  }
  onImpact(car, other, impact, x, z, tag) {
    const pl = this.player;
    const near = car.pos.distanceTo(this.camera.position) < 120;
    const tier = Feel.impactTier(impact);
    if (near) {
      const sparkN = tier === 'smash' ? Math.min(48, impact * 1.8) : tier === 'hit' ? Math.min(30, impact * 1.2) : Math.min(14, impact);
      this.vfx.sparks(x, car.pos.y, z, (car.pos.x - x), (car.pos.z - z), sparkN, tier === 'graze' ? 0.45 : 0.75);
      if (tier !== 'graze') this.vfx.impactFlash(x, car.pos.y, z, clamp(impact / 40, 0.25, 1));
      if (tier === 'smash') this.vfx.debrisBurst(x, car.pos.y, z, car.vel.x, car.vel.y, 4);
      const dist = car.pos.distanceTo(pl.pos);
      const vol = clamp(1 - dist / 120, 0, 1);
      if (vol > 0) {
        if (tier === 'graze') this.audio.scrape(0.35 * vol);
        else this.audio.crash(clamp(impact / 35, 0.1, 1.2) * vol * (tier === 'smash' ? 1.15 : 0.85));
      }
    }
    if (car === pl) {
      this.punch(tier, clamp(impact / (tier === 'smash' ? 28 : 18), 0.35, 1.3));
      if (tier !== 'graze') this.hud.flashDamage(clamp(impact / 30, 0.15, 1));
    }
    // static damage — scrapes barely hurt; big hits still matter
    if (!other) {
      const floor = car === pl ? (tier === 'graze' ? 14 : 9) : 7;
      const dmg = Math.max(0, impact - floor) * 0.006 / (car.spec.armor || 1) * (car.role === 'traffic' ? 0 : 1) * (car.role === 'cop' ? 1.2 : car.role === 'racer' ? 0.5 : 1);
      this.damage(car, dmg, null);
    }
  }
  damage(car, amt, by) {
    if (car.wrecked || amt <= 0 || this.demo) return;
    if (this.state !== 'playing' && !(this.multi && car !== this.player)) return;
    if (!this.mine(car)) return; // the owner simulates its own damage
    // cap damage per crash event (0.4s window) so multi-substep contacts don't stack
    const cap = car === this.player ? 0.3 : 0.6;
    if (!car.dmgWin || this.time - car.dmgWin.t > 0.4) car.dmgWin = { t: this.time, sum: 0 };
    amt = Math.min(amt, cap - car.dmgWin.sum);
    if (amt <= 0) return;
    car.dmgWin.sum += amt;
    car.health -= amt;
    if (car.health <= 0) { car.health = 0; this.wreck(car, by); }
  }
  wreck(car, by) {
    car.wrecked = true; car.wreckTime = this.time;
    car.angVel += (Math.random() - 0.5) * 6; car.vy = 5 + Math.random() * 3; car.grounded = false;
    car.sirenOn = false;
    this.vfx.explosion(car.pos.x, car.pos.y, car.pos.z, car.vel.x, car.vel.y);
    const pl = this.player;
    const byPlayer = by === pl;
    if (this.multi && car.net && this.multi.net && !this.serverAuthority()) this.multi.net.send({ t: 'wreck', id: car.net.id, by: by?.net?.id || null });
    if (car.pos.distanceTo(pl.pos) < 200) this.audio.takedown();
    if (car === pl) {
      if (this.multi && this.mode === 'free') { this.softFail('wrecked'); return; }
      this.endGame(this.mode === 'cop' ? 'wrecked_cop' : 'wrecked');
      return;
    }
    if (car.role === 'cop') {
      if (byPlayer) {
        const tank = car.military || car.spec?.kind === 'tank';
        const payout = tank ? 6000 : 2500;
        this.takedowns++; this.bounty += payout; this.takedownReward();
        this.notify('TAKEDOWN!', tank ? `Tank disabled  +${payout}` : `Patrol car down  +${payout}`, '#ff3060', true);
        this.radio(tank
          ? ['Armor unit is down!', 'We lost a tank!', 'Heavy asset destroyed!'][Math.floor(Math.random() * 3)]
          : ['Unit down! Unit down!', 'We lost a unit!', 'Officer down, requesting backup!'][Math.floor(Math.random() * 3)]);
        this.takedownCam(car);
      }
    } else if (car.role === 'racer') {
      if (this.mode === 'cop') {
        this.bustedRacers++;
        if (byPlayer) { this.takedowns++; this.takedownReward(); this.takedownCam(car); }
        this.notify('BUSTED!', `${car.name} busted (${this.bustedRacers}/${this.racerTotal()})`, '#3aa0ff', true);
        this.radio('Suspect is down. Nice work.');
      } else {
        this.notify('RACER WRECKED', `${car.name} is out`, '#ffb400');
        if (byPlayer) { this.takedowns++; this.takedownReward(); this.takedownCam(car); }
      }
    }
  }
  takedownReward() {
    const pl = this.player;
    if (!pl || pl.wrecked) return;
    pl.health = 1; pl.nitro = 1; pl.flatTimer = 0; pl.empTimer = 0;
  }
  takedownCam(car) {
    if (!this.settings.cinematic) { this.slowmo = 0.5; return; }
    this.slowmo = 1.3;
    const pl = this.player;
    const d = { x: Math.sin(pl.yaw), z: Math.cos(pl.yaw) };
    this.rig.startCine({ type: 'side', target: () => car.pos, dir: d, dur: 1.3 });
  }

  // ---------------- collisions between cars ----------------
  carCollisions() {
    const cars = this.cars;
    const n = cars.length;
    const pl = this.player;
    const px = pl?.pos.x || 0, pz = pl?.pos.z || 0;
    // Far NPC↔NPC pairs never affect gameplay — skip before the O(n²) body work
    const farR2 = 55 * 55;
    for (let i = 0; i < n; i++) {
      const a = cars[i]; if (!a.active) continue;
      const aFar = a !== pl && ((a.pos.x - px) ** 2 + (a.pos.z - pz) ** 2) > farR2;
      for (let j = i + 1; j < n; j++) {
        const b = cars[j]; if (!b.active) continue;
        if (aFar && b !== pl && ((b.pos.x - px) ** 2 + (b.pos.z - pz) ** 2) > farR2) continue;
        const dx0 = b.pos.x - a.pos.x, dz0 = b.pos.z - a.pos.z;
        if (Math.abs(dx0) > 9 || Math.abs(dz0) > 9) continue;
        if (Math.abs(b.pos.y - a.pos.y) > 2.5) continue;
        const afx = Math.sin(a.yaw), afz = Math.cos(a.yaw), bfx = Math.sin(b.yaw), bfz = Math.cos(b.yaw);
        let hit = false, maxImp = 0, hn = null, hx = 0, hz = 0;
        for (const sa of [1, 0, -1]) for (const sb of [1, 0, -1]) {
          const ax = a.pos.x + afx * a.circOff * sa, az = a.pos.z + afz * a.circOff * sa;
          const bx = b.pos.x + bfx * b.circOff * sb, bz = b.pos.z + bfz * b.circOff * sb;
          let dx = bx - ax, dz = bz - az; const d = Math.hypot(dx, dz); const min = a.radius + b.radius;
          if (d >= min || d < 1e-4) continue;
          dx /= d; dz /= d;
          const pen = min - d;
          const ia = 1 / a.mass, ib = 1 / b.mass, s = ia + ib;
          a.pos.x -= dx * pen * (ia / s); a.pos.z -= dz * pen * (ia / s);
          b.pos.x += dx * pen * (ib / s); b.pos.z += dz * pen * (ib / s);
          const rel = (b.vel.x - a.vel.x) * dx + (b.vel.y - a.vel.y) * dz;
          if (rel < 0) {
            // Arcade: keep more forward speed on player scrapes so traffic bumps don't stall the chase
            const involvesPl = a === this.player || b === this.player;
            const bounce = involvesPl ? 0.12 : 0.3;
            const jimp = (-(1 + bounce) * rel) / s;
            a.vel.x -= dx * jimp * ia; a.vel.y -= dz * jimp * ia;
            b.vel.x += dx * jimp * ib; b.vel.y += dz * jimp * ib;
            // friction-ish tangential coupling (lighter for player so you glance off)
            const tx = -dz, tz = dx;
            const relT = (b.vel.x - a.vel.x) * tx + (b.vel.y - a.vel.y) * tz;
            const f = relT * (involvesPl ? 0.08 : 0.15);
            a.vel.x += tx * f * ia / s; a.vel.y += tz * f * ia / s; b.vel.x -= tx * f * ib / s; b.vel.y -= tz * f * ib / s;
            a.angVel += (afx * dz - afz * dx) * sa * -rel * (involvesPl ? 0.018 : 0.03) * ia;
            b.angVel += (bfx * -dz - bfz * -dx) * sb * -rel * (involvesPl ? 0.018 : 0.03) * ib;
            if (-rel > maxImp) { maxImp = -rel; hn = { x: dx, z: dz }; hx = (ax + bx) / 2; hz = (az + bz) / 2; }
            hit = true;
          }
        }
        if (hit && maxImp > 2.5) this.onCarHit(a, b, maxImp, hn, hx, hz);
      }
    }
  }
  onCarHit(a, b, impact, n, x, z) {
    const pl = this.player;
    // who is the aggressor: the one whose velocity points more into the other
    const aInto = a.vel.x * n.x + a.vel.y * n.z;
    const bInto = -(b.vel.x * n.x + b.vel.y * n.z);
    const att = aInto >= bInto ? a : b, vic = att === a ? b : a;
    const involvesPlayer = a === pl || b === pl;
    const tier = Feel.impactTier(impact);
    if (involvesPlayer || a.pos.distanceTo(this.camera.position) < 100) {
      const sparkN = tier === 'smash' ? Math.min(55, impact * 2) : Math.min(40, impact * 1.5);
      this.vfx.sparks(x, (a.pos.y + b.pos.y) / 2, z, -n.x, -n.z, sparkN, tier === 'graze' ? 0.5 : 0.85);
      if (tier !== 'graze') this.vfx.impactFlash(x, a.pos.y, z, clamp(impact / 40, 0.25, 1));
      if (tier === 'smash') this.vfx.debrisBurst(x, a.pos.y, z, att.vel.x, att.vel.y, 5);
      const vol = clamp(1 - a.pos.distanceTo(pl.pos) / 120, 0, 1);
      if (tier === 'graze') this.audio.scrape(0.4 * vol);
      else this.audio.crash(clamp(impact / 30, 0.15, 1.3) * vol * (tier === 'smash' ? 1.2 : 0.9));
    }
    if (involvesPlayer) {
      this.punch(tier, clamp(impact / (tier === 'smash' ? 26 : 16), 0.4, 1.35));
      const other = a === pl ? b : a;
      this.lastHitWith = other; this.lastHitT = this.time;
      if (vic === pl && tier !== 'graze') this.hud.flashDamage(clamp(impact / 25, 0.15, 1));
    }
    for (const c of [a, b]) if (c.role === 'traffic' && impact > 6) { c.ai.stunned = 2 + Math.random() * 2; }
    const roleDmg = (victim, attacker) => {
      const base = impact * 0.016 * (attacker.mass / victim.mass) / (victim.spec.armor || 1);
      if (victim.role === 'traffic') return 0;
      if (attacker.role === 'traffic') return base * 0.25;
      if (victim.role === 'cop' && attacker.role === 'cop') return 0;
      if (victim === pl && this.mode !== 'cop') return base * (attacker.role === 'cop' ? 0.4 : 0.3);
      if (victim.role === 'cop' && attacker === pl) return base * 1.7;
      if (victim.role === 'racer' && attacker === pl && this.mode === 'cop') return base * 1.7;
      if (victim.role === 'racer' && attacker.role === 'cop') return base * (this.mode === 'cop' ? 0.45 : 0.4);
      if (victim.role === 'cop' && attacker.role === 'racer') return base * 0.9;
      if (victim.role === 'racer' && attacker.role === 'racer') return base * 0.3;
      return base * 0.5;
    };
    if (impact > 4) {
      this.damage(vic, roleDmg(vic, att), att);
      this.damage(att, roleDmg(att, vic) * 0.35, vic);
    }
  }

  // ---------------- main update ----------------
  update(dtReal) {
    const input = this.input;
    if (this.slowmo > 0) { this.slowmo -= dtReal; this.timeScale = lerp(this.timeScale, 0.22, 0.2); if (this.slowmo <= 0) { this.rig.endCine(); } }
    else this.timeScale = lerp(this.timeScale, 1, 0.12);
    const dt = dtReal * this.timeScale;
    const pl = this.player;
    if (!pl) return;
    this.radioCd -= dtReal;

    if (this.state === 'countdown') {
      this.countdown -= dtReal;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount && n >= 1) { this.lastCount = n; this.hud.countdown(n); this.audio.beep(false); }
      if (this.countdown <= 0) {
        this.state = 'playing'; this.hud.countdown('GO!'); this.audio.beep(true);
        if (this.mode === 'free') this.radio('All units, be advised. Street racers reported downtown.');
        else if (this.mode === 'speed') this.radio('Speedway is hot. Interceptors on the oval — keep the pack honest.');
        else if (this.mode === 'cop') this.radio('All units, racers are on the move. Take them down!');
      }
      // hold cars in place but let player rev
      const d = input.drive(dtReal);
      pl.rpm = lerp(pl.rpm, d.throttle ? 0.9 : 0.22, 0.1);
      pl.input.throttle = d.throttle;
      for (const c of this.cars) c.syncVisual(dtReal, this.time);
      this.updateTraffic(dtReal, true);
      this.physics(dtReal * 0.0001);
    }

    if (this.state === 'playing' || this.state === 'ending' || (this.multi && this.state === 'result')) {
      this.time += dt;
      if (this.state === 'playing') this.raceTime += dt;
      // player input
      if (this.demo) { /* AI drives */ }
      else if (this.state === 'playing' && !pl.wrecked && this.respawnT <= 0 && !this.spectating) {
        const d = this.inputLocked ? { steer: 0, throttle: 0, brake: 0, handbrake: 0, nitro: 0 } : input.drive(dtReal);
        Object.assign(pl.input, d);
        if (pl.nitroActive === false && d.nitro && pl.nitro > 0.05 && !this._nitroWas) { this.audio.nitroStart(); this.punch('nitro', 1); }
        this._nitroWas = d.nitro && pl.nitro > 0.05;
        if (input.hit('KeyR', 'PadBack')) this.resetPlayer();
        // manual gearbox: first press switches the car to manual for good (no more auto shifting)
        if (!this.inputLocked) {
          if (input.hit('ArrowUp')) pl.shiftManual(1);
          if (input.hit('ArrowDown')) pl.shiftManual(-1);
        }
        if (this.mode === 'cop') this.copAbilities(dt);
      } else { pl.input.throttle = 0; pl.input.brake = 0.6; pl.input.nitro = 0; }
      // AI — skip far traffic/cops (still respawned by updateTraffic); full AI within ~300m of focus
      const focus = (this.spectating && this.specTarget()) || pl;
      const fx0 = focus.pos.x, fz0 = focus.pos.z;
      for (const c of this.cars) {
        if (!c.ai || (c === pl && !this.demo)) continue;
        if (c.role === 'traffic' || c.role === 'cop') {
          const dx = c.pos.x - fx0, dz = c.pos.z - fz0;
          if (dx * dx + dz * dz > 90000) continue;
        }
        c.ai.update(dt, this);
      }
      for (const h of this.helis) h.update(dt, this);
      this.helis = this.helis.filter((h) => {
        if (h.active) return true;
        h.dispose(this.scene); return false;
      });
      this.physics(dt);
      if (this.multi) { this.netSmooth(dt); this.multiRules(dt); this.netSend(dtReal); }
      if (this.demo) this.demoRules(dt); else this.rules(dt);
      this.updateTraffic(dt);
      this.updateSpikes(dt);
      const cam = this.camera.position;
      const q = this.settings.quality ?? 1;
      const hideR2 = (q === 0 ? 160 : q === 1 ? 185 : 400) ** 2;
      const nearR2 = (q === 0 ? 42 : q === 1 ? 48 : 55) ** 2, fxR2 = (q === 0 ? 62 : q === 1 ? 78 : 88) ** 2, castR2 = (q >= 2 ? 42 : 20) ** 2;
      for (const c of this.cars) {
        const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z, d2 = dx * dx + dz * dz;
        const isPl = c === pl;
        if (!isPl && d2 > hideR2) {
          if (c.visible) c.setVisible(false);
          c.setShadowCast(false);
          continue;
        }
        if (!c.visible) c.setVisible(true);
        const detail = isPl ? 2 : d2 < nearR2 ? 1 : 0;
        c.syncVisual(dt, this.time, detail);
        c.setShadowCast(isPl || d2 < castR2);
        if (isPl || d2 < fxR2) this.vfx.carEffects(c, dt, this.world);
      }
    }
    this._frameDt = dt; this.updateLights();
    this.maxSpeed = Math.max(this.maxSpeed, pl.speed);
    this.updateAudio(dtReal);
  }

  physics(dt) {
    this.acc += dt;
    // High: 120 Hz; Med/Low: 90 Hz — city speeds don't need the extra steps, and catch-up is cheaper
    const q = this.settings.quality ?? 1;
    const h = 1 / (q >= 2 ? 120 : 90);
    const maxSteps = q >= 2 ? 8 : 6;
    const pl = this.player;
    const focus = (this.spectating && this.specTarget()) || pl;
    const px = focus?.pos.x || 0, pz = focus?.pos.z || 0;
    const stepR2 = (q === 0 ? 190 : q === 1 ? 220 : 450) ** 2;
    let steps = 0;
    while (this.acc >= h && steps < maxSteps) {
      for (const c of this.cars) {
        // Far traffic/cops stay parked until respawn/cull — full step only near the focus (player or spectatee)
        if (c !== pl && c.role !== 'racer' && ((c.pos.x - px) ** 2 + (c.pos.z - pz) ** 2) > stepR2) continue;
        // Remotes: light coast only — netSmooth owns the pose so full tyre sim doesn't fight the stream
        if (c.ai instanceof RemoteAI && c.ai.snap) {
          // Coast in XZ only — netSmooth owns height/yaw authority after the step
          c.pos.x += c.vel.x * h; c.pos.z += c.vel.y * h;
          continue;
        }
        c.step(h);
      }
      this.carCollisions();
      this.acc -= h; steps++;
    }
    if (steps >= maxSteps) this.acc = 0;
  }

  resetPlayer() {
    const pl = this.player;
    if (this.route) {
      const p = pointAtDist(this.route, Math.max(0, this.playerProgress - 10), {});
      pl.place(p.x, p.z, Math.atan2(p.dx, p.dz), 0);
    } else {
      const n = this.world.nav.nearest(pl.pos.x, pl.pos.z);
      const m = this.world.nav.nodes[n.edges[0].to];
      pl.place(n.x, n.z, Math.atan2(m.x - n.x, m.z - n.z), 0);
    }
    this.rig.snap = true;
    this.notify('RESET', 'Reset', '#aaaaaa');
  }

  copAbilities(dt) {
    const pl = this.player, input = this.input, e = this.empState;
    this.spikeCd = Math.max(0, this.spikeCd - dt);
    e.cd = Math.max(0, e.cd - dt);
    if (input.hit('KeyQ', 'PadLB') && this.spikeCd <= 0) {
      this.dropSpike(pl, null, true); this.spikeCd = 12; this.audio.spikes();
      this.notify('SPIKE STRIP', 'Spikes deployed behind', '#3aa0ff');
    }
    // EMP: hold E to lock onto racer ahead
    const holding = input.k('KeyE', 'PadRB');
    if (holding && e.cd <= 0) {
      let best = null, bd = 1e9;
      const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw);
      for (const r of this.racers) {
        if (r.wrecked || r.ai?.finished) continue;
        const dx = r.pos.x - pl.pos.x, dz = r.pos.z - pl.pos.z, d = Math.hypot(dx, dz);
        if (d > 130 || d < 5) continue;
        if ((dx * fx + dz * fz) / d < 0.9) continue;
        if (d < bd) { bd = d; best = r; }
      }
      if (best && best === e.target) { e.lock += dt; this.audio.empCharge(e.lock / 2); }
      else { e.target = best; e.lock = 0; }
      if (e.target && e.lock >= 2) {
        const r = e.target;
        this.vfx.empBurst(r.pos.x, r.pos.y, r.pos.z);
        this.audio.empFire();
        r.empTimer = 2.5;
        if (this.multi && r.net && this.multi.net) this.multi.net.send({ t: 'dmg', to: r.net.owner, id: r.net.id, kind: 'emp', amt: 0.3, by: this.multi.myId });
        this.damage(r, 0.3, pl);
        this.notify('EMP HIT!', `${r.name} hit by EMP`, '#40a0ff');
        e.cd = 14; e.lock = 0; e.target = null;
      }
    } else { e.lock = Math.max(0, e.lock - dt * 2); if (!holding) e.target = null; }
    this.vfx.empMesh.visible = !!(e.target && e.lock > 0);
    if (e.target && e.lock > 0) { this.vfx.empMesh.position.copy(e.target.pos).y += 1; this.vfx.empMesh.rotation.y += dt * 3; this.vfx.empMesh.scale.setScalar(1.6 - e.lock * 0.3); }
    pl.nitro = Math.min(1, pl.nitro + dt * 0.03);
  }

  rules(dt) {
    const pl = this.player;
    // progress for route modes
    if (this.route) {
      const pr = projectOnRoute(this.route, pl.pos.x, pl.pos.z, this.plIdx || 0, 40);
      if (pr.off < 120) { this.plIdx = pr.index; this.playerProgress = pr.dist; }
      this.playerOff = pr.off;
      // wrong way
      const p = pointAtDist(this.route, this.playerProgress, {});
      this.wrongWay = pl.speed > 8 && (pl.vel.x * p.dx + pl.vel.y * p.dz) / pl.speed < -0.5;
      // checkpoints (server-authority Speedway: finish is owned by the match server)
      if (this.state === 'playing' && this.checkIdx < this.checkpoints.length && this.playerProgress >= this.checkpoints[this.checkIdx]) {
        this.checkIdx++;
        if (this.checkIdx >= this.checkpoints.length) {
          if (!this.serverAuthority() && (this.mode === 'race' || this.mode === 'speed')) this.finishRace();
          else if (this.serverAuthority()) { /* wait for server finish event */ }
          else { this.audio.checkpoint(); }
        } else {
          this.audio.checkpoint();
          this.notify('CHECKPOINT', `${this.checkIdx}/${this.checkpoints.length - 1}   ${fmtTime(this.raceTime)}`, '#ffb400');
          if (this.mode === 'race' || this.mode === 'speed') pl.nitro = Math.min(1, pl.nitro + 0.1);
        }
        this.updateGate();
      }
      // AI racers finishing
      for (const r of this.racers) {
        if (r === pl || !r.ai || r.ai.finished || r.wrecked) continue;
        if (this.serverAuthority()) continue;
        if (r.ai.progress >= this.finishDist) {
          r.ai.finished = true; this.finished.push(r);
          if (this.mode === 'cop') {
            this.escapedRacers++;
            this.notify('RACER ESCAPED', `${r.name} got away`, '#ff6040');
          }
        }
      }
      // positions
      const standings = this.racers.filter((r) => r !== pl || true).map((r) => ({ r, p: r === pl ? (this.playerFinished ? 1e9 - this.playerPlace : this.playerProgress) : r.ai.finished ? 1e9 - this.finished.indexOf(r) : r.wrecked ? -1 : r.ai.progress }));
      standings.sort((a, b) => b.p - a.p);
      this.standings = standings.map((s) => s.r);
      this.position = this.standings.indexOf(pl) + 1;
      if (this.mode === 'cop') {
        const remaining = this.racers.filter((r) => !r.wrecked && !r.ai.finished).length;
        if (remaining === 0 && this.state === 'playing') this.endGame('cop_done');
      }
    }
    // --- pursuit (race, free, speed) — BLACKOUT armor kicks in at heat 4+ ---
    if (this.mode !== 'cop') this.pursuitRules(dt);
    else {
      // partner cops retarget
      for (const c of this.cops) if (!c.ai.target || c.ai.target.wrecked || c.ai.target.ai?.finished || Math.random() < dt * 0.1) c.ai.target = this.pickCopModeTarget(c);
      if (this.raceTime > 45 && this.cops.filter((c) => !c.wrecked).length < 3 && this.copSpawnCd <= 0) {
        this.copSpawnCd = 25;
        const lead = this.standings.find((r) => r !== pl && !r.wrecked && !r.ai.finished);
        if (lead) {
          const p = pointAtDist(this.route, lead.ai.progress + 350, {});
          const c = this.spawnCop({ x: p.x, z: p.z, yaw: Math.atan2(-p.dx, -p.dz), speed: 0 });
          c.ai.target = lead;
          this.radio('Unit in position ahead of the lead racer.');
        }
      }
      this.copSpawnCd -= dt;
    }
    // near misses / drift / draft (racer roles)
    if (this.mode !== 'cop') this.styleRules(dt);
    // water / out of world
    if (pl.pos.y < WATER_LEVEL + 0.2) { this.drown = (this.drown || 0) + dt; if (this.drown > 1) { this.drown = 0; this.resetPlayer(); pl.health -= 0.1; } }
    // cleanup wrecked
    for (const c of [...this.cars]) {
      if (c.wrecked && c !== pl && c.role !== 'racer' && this.time - c.wreckTime > 8 && this.distToCamera(c) > 40) this.removeCar(c);
    }
    // roadblock activation & cleanup
    for (const rb of this.roadblocks) {
      for (const c of rb.cars) {
        if (!c.ai.parked) continue;
        const d = c.pos.distanceTo(pl.pos);
        const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw);
        const passed = ((c.pos.x - pl.pos.x) * fx + (c.pos.z - pl.pos.z) * fz) < -10;
        if (d < 30 && passed) c.ai.parked = false;
        if (c.speed > 3) c.ai.parked = false;
      }
    }
    this.roadblocks = this.roadblocks.filter((rb) => {
      const far = rb.cars.every((c) => !this.cars.includes(c) || c.pos.distanceTo(pl.pos) > 700);
      if (far) rb.cars.forEach((c) => this.cars.includes(c) && this.removeCar(c));
      return !far;
    });
  }

  demoRules(dt) {
    const pl = this.player;
    if (!pl?.ai || !this.demoRoute) return;
    for (const c of this.cars) c.health = Math.max(c.health, 0.8);
    if (pl.ai.progress > this.demoRoute.length - 200 || (pl.speed < 1 && this.time > 5 && Math.random() < dt * 0.2)) { this.start('demo'); }
    for (const c of this.cops) if (c.pos.distanceTo(pl.pos) > 400) { const q = pointAtDist(this.demoRoute, pl.ai.progress - 60, {}); c.place(q.x, q.z, Math.atan2(q.dx, q.dz), pl.speed); }
  }

  pickCopModeTarget(c) {
    let best = null, bs = 1e9;
    for (const r of this.racers) { if (r.wrecked || r.ai.finished) continue; const d = r.pos.distanceTo(c.pos); if (d < bs) { bs = d; best = r; } }
    return best;
  }

  pursuitRules(dt) {
    const pl = this.player;
    const active = this.cops.filter((c) => !c.wrecked);
    if (this.mode === 'race' || this.mode === 'speed') {
      this.pursuit = this.mode === 'speed' ? true : this.raceTime > 8;
      const ramp = this.mode === 'speed' ? 22 : 32;
      this.heat = this.pursuit ? clamp(1 + Math.floor(this.raceTime / ramp), 1, 5) : 0;
    } else {
      // free: detection & escape (helis also keep you "seen")
      let seen = false;
      for (const c of active) {
        if (c.ai.parked) continue;
        const d = c.pos.distanceTo(pl.pos);
        if (d < 70 || (d < 230 && this.world.statics.los(c.pos.x, c.pos.z, pl.pos.x, pl.pos.z))) { seen = true; break; }
      }
      if (!seen) {
        const heliR = this.milLive() ? 280 : 120;
        for (const h of this.helis) {
          if (!h.active) continue;
          if (Math.hypot(h.pos.x - pl.pos.x, h.pos.z - pl.pos.z) < heliR) { seen = true; break; }
        }
      }
      if (this.pursuit) {
        this.pursuitTime += dt;
        if (seen) this.lastSeen = 0; else this.lastSeen += dt;
        const ramp = this.milLive() ? 28 : 40;
        this.heat = clamp(Math.max(this.heat, 1 + Math.floor(this.pursuitTime / ramp) + Math.floor(this.takedowns / 3)), 1, 5);
        this.bounty += dt * (10 + this.heat * (this.milLive() ? 22 : 15)) * (pl.speed > 30 ? 2 : 1);
        const escapeT = this.milLive() ? 22 : 14;
        const heliEscapeR = this.milLive() ? 260 : 140;
        if (this.lastSeen > escapeT && !active.some((c) => !c.ai.retire && !c.ai.parked && c.pos.distanceTo(pl.pos) < 160) && !this.helis.some((h) => h.active && Math.hypot(h.pos.x - pl.pos.x, h.pos.z - pl.pos.z) < heliEscapeR)) {
          this.pursuit = false; this.escapes++;
          const bonus = (this.milLive() ? 5000 : 3000) * this.heat;
          this.bounty += bonus;
          this.notify('ESCAPED!', `Escaped  +${bonus}`, '#30ff90', true);
          this.audio.victory();
          this.radio(this.milLive() ? 'Blackout units, stand down. Suspect is dark.' : 'We lost the suspect. All units return to patrol.');
          for (const c of [...this.cops]) { c.sirenOn = false; c.ai.target = null; c.ai.retire = true; }
          for (const h of this.helis) h.active = false;
          this.cooldown = this.milLive() ? 14 : 20; this.heat = Math.max(1, this.heat - 1);
        }
      } else {
        this.cooldown -= dt;
        if (this.cooldown < -28 && this.raceTime > 10) {
          this.pursuit = true; this.lastSeen = -20; this.pursuitTime = 0; this.cooldown = 0;
          for (const k of active) if (k.ai.patrol) { k.ai.patrol = false; k.sirenOn = true; k.ai.target = pl; }
          this.notify('PURSUIT!', 'Pursuit started — you were reported', '#ff3050', true);
          this.radio(`Dispatch, we have a report of a street racer near ${this.areaName(pl)}. All units respond.`);
        }
        const patrols = active.filter((c) => c.ai.patrol);
        if (this.cooldown <= 0 && patrols.length < 2 && this.raceTime > 3) {
          const c = this.spawnPursuitCop();
          if (c) { c.ai.patrol = true; c.sirenOn = false; c.ai.target = null; c.ai.trafficAI = new TrafficAI(c, this); const n = this.world.nav.nearest(c.pos.x, c.pos.z); c.ai.trafficAI.spawnAt(n, this); c.ai.trafficAI.cruise = 16; }
        }
        for (const c of patrols) {
          const d = c.pos.distanceTo(pl.pos);
          const sees = d < 40 || (d < 120 && this.world.statics.los(c.pos.x, c.pos.z, pl.pos.x, pl.pos.z));
          if (sees && (pl.speed > 22 || d < 25)) {
            this.pursuit = true; this.lastSeen = 0; this.pursuitTime = 0;
            for (const k of patrols) { k.ai.patrol = false; k.sirenOn = true; k.ai.target = pl; }
            this.notify('PURSUIT!', 'Pursuit started! Get away', '#ff3050', true);
            this.radio(`Suspect spotted heading ${this.headingWord(pl)} through ${this.areaName(pl)}. In pursuit!`);
            break;
          }
        }
      }
      for (const c of [...this.cops]) if (c.ai.retire && c.pos.distanceTo(pl.pos) > 160 && this.distToCamera(c) > 120) this.removeCar(c);
    }
    // spawn cops per heat
    this.copSpawnCd -= dt;
    if (this.pursuit) {
      const mil = this.milLive();
      const want = mil ? [0, 4, 6, 8, 10, 14][this.heat] : [0, 2, 3, 4, 5, 6][this.heat];
      const chasing = active.filter((c) => !c.ai.parked && !c.ai.retire).length;
      if (chasing < want && this.copSpawnCd <= 0) {
        const c = this.spawnPursuitCop();
        this.copSpawnCd = mil ? 1.8 : (this.mode === 'speed' ? 2.5 : 4);
        if (c && Math.random() < 0.4) {
          this.radio(c.military
            ? `Armor unit rolling. Suspect heading ${this.headingWord(pl)}.`
            : `Unit responding. Suspect heading ${this.headingWord(pl)}.`);
        }
      }
      // BLACKOUT PROTOCOL (heat 4+): tanks + helis join normal hot pursuit
      if (mil) {
        const wantHeli = this.heat >= 5 ? 5 : 3;
        while (this.helis.filter((h) => h.active).length < wantHeli) this.spawnHeli();
        const tanksNear = this.cops.filter((c) => c.military && !c.wrecked && c.pos.distanceTo(pl.pos) < 180).length;
        const wantNearTank = this.heat >= 5 ? 5 : 3;
        if (tanksNear < wantNearTank && this.copSpawnCd <= 0.5) this.spawnNearbyTank();
      }
      // heat change notifications
      if (this.heat !== this.lastHeat) {
        if (this.lastHeat !== undefined && this.heat > this.lastHeat) {
          const msgs = ['', '', 'Backup units approaching', 'Roadblocks deploying', 'BLACKOUT — armor inbound', 'Full blackout — tanks & air live'];
          const radios = ['', '', 'Requesting backup!', 'Setting up roadblocks!', 'Blackout protocol is live. Armor authorized!', 'Blackout maximum — no escape routes!'];
          this.notify(this.heat >= 4 ? 'BLACKOUT PROTOCOL' : `HEAT LEVEL ${this.heat}`, msgs[this.heat], this.heat >= 4 ? '#c8ff40' : '#ff4040');
          this.radio(radios[this.heat]);
          this.punch('heatUp', 0.7 + this.heat * 0.1);
        }
        this.lastHeat = this.heat;
      }
      // roadblocks
      this.roadblockCd -= dt;
      if (this.heat >= 3 && this.roadblockCd <= 0) { this.roadblockCd = (mil ? 28 : 40) - this.heat * 4; this.spawnRoadblock(); }
      // retarget
      for (const c of active) {
        if (c.ai.patrol || c.ai.retire) continue;
        if (!c.ai.target || c.ai.target.wrecked || c.ai.target.ai?.finished || Math.random() < dt * 0.15) c.ai.target = this.pickTarget(c);
      }
    }
    // bust meter
    let copNear = false;
    for (const c of active) if (!c.ai.patrol && c.pos.distanceTo(pl.pos) < 11) copNear = true;
    if (this.state === 'playing' && copNear && pl.speed < 6 && this.pursuit) this.bust += dt / 3.2;
    else this.bust = Math.max(0, this.bust - dt * 0.6);
    if (this.bust >= 1 && this.state === 'playing') this.endGame('busted');
    // too many cops far away -> recycle
    for (const c of [...this.cops]) {
      if (c.wrecked || c.ai.parked || c.ai.patrol) continue;
      if (c.pos.distanceTo(pl.pos) > (this.route ? 650 : 900) && this.distToCamera(c) > 250) this.removeCar(c);
    }
  }

  styleRules(dt) {
    const pl = this.player;
    const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw), rx = -fz, rz = fx;
    // near miss — slightly wider latch so dense traffic pays off
    for (const o of this.cars) {
      if (o === pl || o.wrecked) continue;
      const dx = o.pos.x - pl.pos.x, dz = o.pos.z - pl.pos.z;
      if (Math.abs(dx) > 16 || Math.abs(dz) > 16) { this.nearMiss.delete(o.id); continue; }
      const along = dx * fx + dz * fz, lat = Math.abs(dx * rx + dz * rz);
      const prev = this.nearMiss.get(o.id);
      const relSpeed = Math.hypot(pl.vel.x - o.vel.x, pl.vel.y - o.vel.y);
      if (prev !== undefined && prev > 0 && along <= 0 && lat < 4.0 && relSpeed > 16 && !(this.lastHitWith === o && this.time - this.lastHitT < 1.5)) {
        const close = lat < 2.4;
        this.audio.nearMiss();
        const reward = close ? 400 : 250;
        pl.nitro = Math.min(1, pl.nitro + (close ? 0.14 : 0.09));
        this.bounty += reward;
        this.notify(close ? 'CLOSE CALL' : 'NEAR MISS', `+${reward}`, '#40d0ff');
        this.punch('nearMiss', close ? 1.15 : 0.85);
      }
      this.nearMiss.set(o.id, along);
    }
    // drift grammar: enter punch → hold charge → exit boost
    if (pl.drifting && !this._wasDrifting && pl.speed > 15) this.punch('driftEnter', 0.8);
    if (pl.drifting && pl.speed > 15) {
      this.driftT += dt; pl.nitro = Math.min(1, pl.nitro + dt * 0.11); this.bounty += dt * 140;
      // light continuous rumble while sideways
      if (Math.floor(this.driftT * 4) !== Math.floor((this.driftT - dt) * 4)) this.input.vibrate(40, 0.12, 0.35);
    } else if (this.driftT > 0) {
      const t = this.driftT;
      const pts = Math.round(t * 140);
      if (t > 0.55 && pl.speed > 18) {
        // exit boost: short top-speed + accel surge scaled by hold time
        pl.exitBoost = Math.min(1.4, 0.35 + t * 0.35);
        pl.nitro = Math.min(1, pl.nitro + 0.06 + t * 0.05);
        const label = t > 2.4 ? 'PERFECT DRIFT' : t > 1.2 ? 'DRIFT' : 'DRIFT EXIT';
        this.notify(label, `${t.toFixed(1)}s  +${pts}`, '#ffd040');
        this.punch('driftExit', clamp(0.55 + t * 0.25, 0.55, 1.25));
        this.audio.whoosh();
      } else if (t > 1.2) {
        this.notify('DRIFT', `${t.toFixed(1)}s  +${pts}`, '#ffd040');
      }
      this.driftT = 0;
    }
    this._wasDrifting = pl.drifting;
    // drafting
    this.drafting = false;
    if (pl.speed > 28) for (const o of this.cars) {
      if (o === pl) continue;
      const dx = o.pos.x - pl.pos.x, dz = o.pos.z - pl.pos.z;
      const along = dx * fx + dz * fz, lat = Math.abs(dx * rx + dz * rz);
      if (along > 5 && along < 22 && lat < 2.0) { this.drafting = true; pl.nitro = Math.min(1, pl.nitro + dt * 0.09); break; }
    }
    if (!pl.grounded) pl.nitro = Math.min(1, pl.nitro + dt * 0.1);
    // speed bounty
    if (pl.speed > 55) this.bounty += dt * 40;
  }

  updateSpikes(dt) {
    for (const s of this.spikes) {
      s.t -= dt;
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), rx = -fz, rz = fx;
      for (const c of this.cars) {
        if (c.role === 'cop' || c.role === 'traffic' || s.hit.has(c.id)) continue;
        const dx = c.pos.x - s.x, dz = c.pos.z - s.z;
        if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
        const along = dx * fx + dz * fz, lat = dx * rx + dz * rz;
        if (Math.abs(along) < 1.6 && Math.abs(lat) < 4.4) {
          s.hit.add(c.id);
          c.flatTimer = 9;
          this.damage(c, 0.22, null);
          this.vfx.sparks(c.pos.x, c.pos.y, c.pos.z, 0, 0, 30, 1);
          if (c === this.player) { this.audio.spikes(); this.notify('SPIKED!', 'Tires punctured!', '#ff3030'); this.rig.addShake(0.6); this.input.vibrate(450, 0.9, 0.6); this.hud.flashDamage(0.6); }
          else if (c.pos.distanceTo(this.player.pos) < 150) { this.audio.spikes(); if (this.mode === 'cop') this.notify('SPIKED!', `${c.name} hit the spikes`, '#3aa0ff'); }
        }
      }
    }
    this.spikes = this.spikes.filter((s) => { if (s.t <= 0) { this.scene.remove(s.mesh); return false; } return true; });
  }

  updateTraffic(dt, frozen = false) {
    if (frozen) return;
    this.trafficCd -= dt;
    if (this.trafficCd > 0) return;
    this.trafficCd = 0.4;
    const pl = this.player;
    for (const c of this.traffic) {
      const d = c.pos.distanceTo(pl.pos);
      const stuck = c.speed < 0.5 && !c.ai.stunned;
      c.stuckT = stuck ? (c.stuckT || 0) + 0.4 : 0;
      if ((d > 700 || c.stuckT > 12) && this.distToCamera(c) > 150) { this.respawnTraffic(c); c.stuckT = 0; }
    }
  }

  updateGate() {
    if (!this.route || this.checkIdx >= this.checkpoints.length) { this.gates.visible = false; return; }
    const d = this.checkpoints[this.checkIdx];
    const p = pointAtDist(this.route, d, {});
    const final = this.checkIdx === this.checkpoints.length - 1;
    this.gates.visible = true;
    this.gates.position.set(p.x, this.world.heightAt(p.x, p.z), p.z);
    this.gates.rotation.y = Math.atan2(p.dx, p.dz);
    const w = this.world.hf.onRoad(p.x, p.z) && Math.abs(p.x) < 640 && Math.abs(p.z) < 640 ? 0.85 : 1.05;
    this.gates.scale.set(w, 1, 1);
    this.gateMats.pylonMat.emissive.set(final ? 0x30ff60 : this.mode === 'cop' ? 0x3080ff : 0xff9a20);
    this.gateMats.beamMat.color.set(final ? new THREE.Color(0.3, 1.5, 0.5) : this.mode === 'cop' ? new THREE.Color(0.3, 0.7, 1.8) : new THREE.Color(1.5, 0.9, 0.2));
    this.gatePos = p;
  }

  finishRace() {
    const pl = this.player;
    this.playerFinished = true;
    this.finished.push(pl);
    this.playerPlace = this.finished.indexOf(pl) + 1;
    this.endGame('finish');
  }

  endGame(reason, force = false) {
    if (this.state === 'ending' || this.state === 'result') return;
    if (this.spectating && !force && (reason === 'busted' || reason === 'wrecked' || reason === 'wrecked_cop')) return; // already out and watching
    if (!force && this.multi && this.multi.net && reason === 'busted' && !this.serverAuthority()) this.multi.net.send({ t: 'bust', id: this.multi.myId, name: this.player.name });
    if (this.multi && this.mode === 'free' && (reason === 'busted' || reason === 'wrecked')) { if (this.respawnT <= 0) this.softFail(reason); return; }
    // multiplayer race / interceptor: dying while other real players are still going puts you in spectator mode
    if (!force && this.multi && this.state === 'playing' && (reason === 'busted' || reason === 'wrecked' || reason === 'wrecked_cop') && this.aliveHumans().length > 0) { this.goSpectator(reason); return; }
    // GAME OVER = every real player is out: forced by the last spectator, or the last real player to die (others already out)
    const allOut = force || (!!this.multi && (reason === 'busted' || reason === 'wrecked' || reason === 'wrecked_cop') && [...this.netCars.values()].some((c) => c.net.human));
    this.spectating = null;
    this.state = 'ending';
    const pl = this.player;
    this.result = { reason, time: this.raceTime, place: this.playerPlace || this.position, takedowns: this.takedowns, bounty: Math.round(this.bounty), maxSpeed: this.maxSpeed * MS_TO_KMH, odometer: this.player ? this.player.odometer : 0, busted: this.bustedRacers, escaped: this.escapedRacers, escapes: this.escapes, heat: this.heat, total: this.racers.length, multi: !!this.multi, allOut };
    if (allOut) { this.audio.busted(); this.notify('GAME OVER', 'All players are out', '#ff3050', true); }
    else if (reason === 'busted') { this.audio.busted(); this.notify('BUSTED', 'You were arrested…', '#ff3050', true); this.radio('Suspect is in custody. Good work everyone.'); }
    else if (reason === 'wrecked' || reason === 'wrecked_cop') { this.audio.busted(); this.notify('WRECKED', 'Vehicle wrecked', '#ff3050', true); }
    else if (reason === 'finish') { this.audio.victory(); this.notify(this.playerPlace === 1 ? 'VICTORY!' : `FINISH  P${this.playerPlace}`, fmtTime(this.raceTime), '#30ff90', true); }
    else if (reason === 'cop_done') { this.audio.victory(); this.notify('EVENT COMPLETE', `Busted ${this.bustedRacers}/${this.racerTotal()}`, '#3aa0ff', true); }
    // orbit camera on player
    this.rig.startCine({ type: 'orbit', target: () => pl.pos, r: 8, h: 2.2, speed: 0.3, a0: pl.yaw + Math.PI * 0.8 });
    this.audio.music && this.audio.music.setLevel(0);
    setTimeout(() => { this.state = 'result'; this.onResult && this.onResult(this.result); }, 3200);
  }

  // ---------------- lights, audio ----------------
  updateLights() {
    const pl = this.player;
    // nearest two cops get real point lights
    const cops = this.cops.filter((c) => !c.wrecked && c.sirenOn !== false).sort((a, b) => a.pos.distanceToSquared(this.camera.position) - b.pos.distanceToSquared(this.camera.position));
    const pc = pl.police ? pl : cops[0];
    const L = this.copLights;
    const own = pc === pl;
    const fp = own && (this.rig.mode === 'cockpit' || this.rig.mode === 'hood') && !this.rig.cine;
    if (pc && !fp && pc.pos.distanceTo(this.camera.position) < 150) {
      L[0].position.set(pc.pos.x, pc.pos.y + (own ? 3 : 2), pc.pos.z); L[1].position.copy(L[0].position);
      const k = own ? 0.55 : 1.15;
      L[0].intensity = pc.flashA ? 70 * k : 0; L[1].intensity = pc.flashB ? 85 * k : 0;
    } else { L[0].intensity = L[1].intensity = 0; }
    // player headlights — dual beams + flood + body fill; much stronger at night
    this.updateHeadlamps(pl, this._frameDt || 1 / 60);
    // siren edge glow on screen when close
    let near = 0, fl = 0;
    for (const c of cops.slice(0, 1)) { const d = c.pos.distanceTo(pl.pos); near = clamp(1 - d / 25, 0, 1); fl = c.flashA ? 1 : c.flashB ? -1 : 0; }
    this.sirenGlow = { r: fl > 0 ? 1 : 0, b: fl < 0 ? 1 : 0, a: near };
  }

  // ---- player headlamps ----
  // Lamps sit at the car's real headlight positions and ride with the body (pitch/roll/suspension), aimed ~1% down
  // (≈ legal low-beam aim) so the cut-off lands ~40 m ahead. Light is projected with a lamp pattern, shadows on High.
  // H toggles high beam. Day: weak running lights only. Night: proper road illumination.
  updateHeadlamps(pl, dt = 1 / 60) {
    const night = !!(MAPS[this.world.mapId] && MAPS[this.world.mapId].night);
    const q = this.settings.quality ?? 1;
    const body = pl.model.body; body.updateWorldMatrix(true, false);
    const M = body.matrixWorld;
    const mounts = this.lampMounts(pl);
    const fwd = new THREE.Vector3(0, 0, 1).transformDirection(M);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(M);
    const high = this.highBeam && night;
    // beam axis ≈ level: the pattern's hot spot already sits below the axis, so it lands ~15–40 m ahead (low beam)
    const aimDown = high ? -0.004 : 0.006;
    const useDual = q >= 1;
    this._lampOn = damp(this._lampOn ?? 1, pl.wrecked ? 0 : 1, 6, dt);
    const base = (night ? (high ? 1500 : 1000) : 20) * this._lampOn;
    for (let i = 0; i < 2; i++) {
      const Lh = this.headlights[i];
      const on = i === 0 || useDual;
      Lh.intensity = on ? base * (useDual ? 1 : 1.7) : 0;
      if (!on) continue;
      const p = mounts[useDual ? i : 0].clone();
      if (!useDual) p.x = 0;
      p.z += 0.05; p.applyMatrix4(M);
      Lh.position.copy(p);
      const toe = (i === 0 ? -1 : 1) * 0.02; // slight outward spread
      const side = new THREE.Vector3().crossVectors(up, fwd).normalize();
      Lh.target.position.copy(p).addScaledVector(fwd, 30).addScaledVector(up, -30 * aimDown).addScaledVector(side, -toe * 30);
      Lh.target.updateMatrixWorld();
      Lh.map = high ? this.highPattern : this.lowPattern;
      Lh.angle = high ? 0.42 : 0.46;
      Lh.distance = high ? 220 : 150;
      // shadows only from the right lamp on High (one shadow map) — cars/poles cast real shadows into the beam
      const sh = q >= 2 && night && i === 1;
      if (Lh.castShadow !== sh) Lh.castShadow = sh;
    }
    // flood = short wide fill for the foreground and kerbs (stops the "tunnel vision" look)
    const mountY = (mounts[0].y + mounts[1].y) * 0.5;
    const useFlood = q >= 2;
    this.headFlood.intensity = useFlood ? (night ? 40 : 0) * this._lampOn : 0;
    if (useFlood) {
      const c = new THREE.Vector3(0, mountY * 0.85, pl.dims.L / 2 - 0.1).applyMatrix4(M);
      this.headFlood.position.copy(c);
      this.headFlood.target.position.copy(c).addScaledVector(fwd, 12).addScaledVector(up, -2.2);
      this.headFlood.target.updateMatrixWorld();
    }
    // bounce light off the road onto the bumper/hood (stays below the bodywork, never a floating blob)
    this.headFill.intensity = (night ? (q === 0 ? 2.5 : 3.5) : 0.55) * this._lampOn;
    this.headFill.position.copy(new THREE.Vector3(0, Math.min(0.4, mountY * 0.55), pl.dims.L / 2 + 1.6).applyMatrix4(M));
    const braking = pl.input && pl.input.brake > 0.1 && pl.vF > 1;
    this.brakeGlow.intensity = q === 0 ? 0 : (braking ? (night ? 24 : 5) : (night ? 4 : 0));
    this.brakeGlow.position.copy(new THREE.Vector3(0, mountY * 0.85, -pl.dims.L / 2 - 0.3).applyMatrix4(M));
    // day: dim head flare sprites so they don't glare like suns; night: full base
    const headMul = night ? 1 : 0.35;
    for (const h of pl.model.heads || []) {
      if (h.userData.lamp !== 'head') continue;
      const s = (h.userData.baseScale || 1) * headMul;
      h.scale.set(s, s, 1);
      h.material.opacity = Math.min(1, (h.userData.baseOpacity || 0.7) * (night ? 1 : 0.4));
    }
    // volumetric shafts: only meaningful at night, in fog/haze; follow the lamps exactly
    const bg = this.beamGroup;
    if (bg) {
      const show = q > 0 && night;
      bg.visible = show;
      if (show) {
        this.beamUniforms.uOpacity.value = (high ? 0.14 : 0.1) * this._lampOn;
        this.beamUniforms.uGround.value = this.world.heightAt(pl.pos.x, pl.pos.z);
        bg.children.forEach((m, i) => {
          m.position.copy(this.headlights[useDual ? i : 0].position);
          m.lookAt(this.headlights[useDual ? i : 0].target.position);
        });
      }
    }
  }

  updateAudio(dt) {
    const pl = this.player; const a = this.audio;
    if (!a.ready) return;
    const camR = new THREE.Vector3(); this.camera.getWorldDirection(camR);
    const sir = [];
    const cops = this.cops.filter((c) => !c.wrecked && c.sirenOn !== false);
    if (pl.police) cops.unshift(pl);
    cops.sort((x, y) => x.pos.distanceToSquared(pl.pos) - y.pos.distanceToSquared(pl.pos));
    for (const c of cops.slice(0, 4)) {
      const dx = c.pos.x - pl.pos.x, dz = c.pos.z - pl.pos.z, d = Math.hypot(dx, dz) || 1;
      const gain = c === pl ? 0.62 : clamp(1 - d / 500, 0, 1) ** 1.5;
      const vrel = ((c.vel.x - pl.vel.x) * dx + (c.vel.y - pl.vel.y) * dz) / d;
      const pan = (dx * -camR.z + dz * camR.x) / d;
      let mode = c.id % 3 === 2 ? 2 : c.id % 2;
      if (d < 42 && this.pursuit) mode = d < 22 ? 3 : 1;
      sir.push({ gain, dist: c === pl ? 0 : d, vrel: c === pl ? 0 : vrel, pan: c === pl ? 0 : -pan, mode });
    }
    const q = this.settings.quality ?? 1;
    const others = [];
    const otherR2 = (q >= 2 ? 140 : 110) ** 2;
    for (const c of this.cars) {
      if (c === pl || c.wrecked) continue;
      const dx = c.pos.x - pl.pos.x, dz = c.pos.z - pl.pos.z, d2 = dx * dx + dz * dz;
      if (d2 > otherR2) continue;
      const d = Math.sqrt(d2) || 1;
      const vrel = ((c.vel.x - pl.vel.x) * dx + (c.vel.y - pl.vel.y) * dz) / d;
      const pan = (dx * -camR.z + dz * camR.x) / d;
      others.push({
        d, gain: clamp(1 - d / 130, 0, 1) ** 1.7, vrel, pan: -pan,
        rpm: c.rpm || 0.35, thr: c.input?.throttle ?? 0.5,
        kind: c.spec.kind, carId: c.spec.id,
      });
    }
    others.sort((x, y) => x.d - y.d);
    const fp = (this.rig.mode === 'cockpit' || this.rig.mode === 'hood') && !this.rig.cine;
    const active = !this.demo && (this.state === 'playing' || this.state === 'countdown' || this.state === 'ending');
    // Med/Low: fewer ambient engine voices — audio graph cost shows up under chase density
    const otherN = q >= 2 ? 4 : q === 1 ? 2 : 1;
    a.update(dt, {
      active, rpm: pl.rpm, throttle: pl.input.throttle, brake: pl.input.brake, handbrake: pl.input.handbrake,
      speed: pl.speed, vF: pl.vF, gear: pl.gear, shiftTimer: pl.shiftTimer || 0,
      skid: pl.skidAmt || 0, slip: Math.abs(pl.slip || 0), drifting: pl.drifting,
      offroad: pl.offroad && pl.grounded, grounded: pl.grounded, flat: pl.flatTimer > 0,
      nitro: pl.nitroActive, shifted: pl.shifted, kind: pl.spec.kind, carId: pl.spec.id,
      fp, sirens: sir, others: others.slice(0, otherN),
    });
    pl.shifted = 0;
    // music intensity — chase / heat drive the drama bed; escape cools it
    if (a.music && this.state === 'playing') {
      let lvl = 1;
      if (this.mode === 'cop') lvl = this.bustedRacers >= 2 ? 3 : 2;
      else if (this.pursuit) {
        if (this.mode === 'free' && this.lastSeen > 6) lvl = 1; // losing them: music drops
        else lvl = this.heat >= 4 ? 3 : this.heat >= 2 ? 2 : 1;
        if (this.heat >= 5 || (pl.nitroActive && this.heat >= 3) || (this.milLive() && this.helis.length) || this.mode === 'speed') lvl = 3;
      } else if (pl.speed > 60) lvl = 2;
      a.music.setLevel(lvl);
      a.setDrama?.(lvl, this.pursuit ? this.heat : 0);
    }
    this.feel.update(dt);
  }
}

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
