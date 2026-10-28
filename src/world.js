// ===== World construction: sky, terrain, city, highways, decor =====
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HeightField, WORLD_HALF, CITY_HALF, STREET_SPACING, STREET_HALF_W, HF_N, HF_CELL, WATER_LEVEL, setTerrainMap } from './terrain.js';
import { buildRoads, buildNav, LOOP_HALF_W } from './roads.js';
import { StaticWorld } from './collision.js';
import { mulberry32, makeNoise2D, fbm, smoothstep, clamp, lerp, nextFrame } from './util.js';
import * as TX from './textures.js';
import { ENV } from './envAssets.js';

export const globalUniforms = { time: { value: 0 } };

export const MAPS = {
  tokyo: {
    id: 'tokyo',
    name: 'TOKYO NIGHT',
    jp: '東京ナイト · 首都高湾岸線',
    desc: 'Midnight Shinjuku neon district, Wangan Bay Bridge & Hakone mountain touge.',
    exposure: 0.78,
  },
  coast: {
    id: 'coast',
    name: 'REDVIEW COAST',
    jp: 'レッドビュー · コースト',
    desc: 'Golden-hour coastal highway loop, downtown grid & alpine canyon pass.',
    exposure: 0.62,
  },
};

export class World {
  constructor(renderer, scene, mapId = 'coast') {
    this.renderer = renderer;
    this.scene = scene;
    this.mapId = mapId in MAPS ? mapId : 'tokyo';
    setTerrainMap(this.mapId);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.statics = new StaticWorld();
    this.hf = new HeightField();
    this.updaters = [];
  }

  clearWorld() {
    while (this.root.children.length) {
      const obj = this.root.children[0];
      this.root.remove(obj);
    }
    this.statics = new StaticWorld();
    this.updaters = [];
    this.cityChunks = [];
    this.propChunks = [];
    this.treeChunks = [];
    this.poolTex = null;
  }

  async setMap(mapId, progress = () => {}) {
    const next = mapId in MAPS ? mapId : 'tokyo';
    this.mapId = next;
    setTerrainMap(next);
    this.clearWorld();
    await this.build(progress);
  }

  async build(progress = () => {}) {
    setTerrainMap(this.mapId);
    progress(0.02, 'Generating road network…');
    await nextFrame();
    this.net = buildRoads(this.mapId);
    progress(0.08, 'Generating terrain…');
    await nextFrame();
    this.hf.build(this.net.roads);
    this.nav = buildNav(this.net);
    progress(0.25, 'Setting up sky and lighting…');
    await nextFrame();
    this.buildSky();
    progress(0.32, 'Building terrain mesh…');
    await nextFrame();
    this.buildTerrain();
    this.buildFarLand();
    this.buildWater();
    progress(0.45, 'Paving highways…');
    await nextFrame();
    this.buildRoadMeshes();
    progress(0.58, 'Building downtown…');
    await nextFrame();
    this.buildCity();
    progress(0.75, 'Placing forests and rocks…');
    await nextFrame();
    this.buildNature();
    progress(0.85, 'Drawing minimap…');
    await nextFrame();
    this.buildMinimap();
    progress(0.9, 'Compiling shaders…');
    await nextFrame();
  }

  heightAt(x, z) { return this.hf.ground(x, z); }

  // ---------------- Sky & lighting ----------------
  buildSky() {
    const scene = this.root;
    const isTokyo = this.mapId === 'tokyo';
    if (isTokyo) {
      const elev = THREE.MathUtils.degToRad(22), az = THREE.MathUtils.degToRad(-115);
      const moon = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elev, az);
      this.sunDir = moon.clone();

      // Midnight sky dome with Tokyo neon horizon glow + moon halo
      const domeGeo = new THREE.SphereGeometry(19000, 32, 20);
      const domeMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uMoon: { value: moon.clone() } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          varying vec3 vDir; uniform vec3 uMoon;
          void main(){
            float y = clamp(vDir.y, 0.0, 1.0);
            vec3 zenith = vec3(0.006, 0.010, 0.028);
            vec3 mid = vec3(0.018, 0.022, 0.058);
            vec3 hor = mix(vec3(0.09, 0.025, 0.11), vec3(0.02, 0.075, 0.13), 0.5 + 0.5 * vDir.x);
            vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, y));
            col = mix(col, zenith, smoothstep(0.18, 0.75, y));
            float md = max(dot(normalize(vDir), normalize(uMoon)), 0.0);
            col += vec3(0.18, 0.28, 0.52) * pow(md, 18.0) * 0.7 + vec3(1.4, 1.6, 2.0) * smoothstep(0.9985, 0.9996, md);
            gl_FragColor = vec4(col, 1.0);
          }`,
      });
      const dome = new THREE.Mesh(domeGeo, domeMat);
      scene.add(dome);
      this.sky = dome;

      // Starfield
      const starCnt = 1600;
      const starPos = new Float32Array(starCnt * 3);
      const starCol = new Float32Array(starCnt * 3);
      const srnd = mulberry32(9001);
      for (let i = 0; i < starCnt; i++) {
        const th = srnd() * Math.PI * 2;
        const ph = Math.acos(0.12 + srnd() * 0.88);
        const r = 17500;
        starPos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
        starPos[i * 3 + 1] = Math.cos(ph) * r;
        starPos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
        const b = 0.45 + srnd() * 0.55;
        const tint = srnd();
        starCol[i * 3] = b * (tint < 0.3 ? 1.1 : 0.85);
        starCol[i * 3 + 1] = b * 0.92;
        starCol[i * 3 + 2] = b * (tint > 0.6 ? 1.2 : 0.95);
      }
      const sGeo = new THREE.BufferGeometry();
      sGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
      sGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
      const stars = new THREE.Points(sGeo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8, fog: false, depthWrite: false, map: TX.glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 32), alphaTest: 0.02 }));
      scene.add(stars);

      // Neon-infused PMREM environment cubemap so cars and wet asphalt reflect vibrant Tokyo neon
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new THREE.Scene();
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 16), domeMat));
      const g = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: 0x0c0e1c }));
      g.rotation.x = -Math.PI / 2; g.position.y = -30; envScene.add(g);
      const neonBands = [
        [0, 120, -420, 260, 90, 0, new THREE.Color(2.6, 0.25, 1.4)],
        [420, 110, 0, 260, 85, Math.PI / 2, new THREE.Color(0.2, 2.1, 2.8)],
        [0, 130, 420, 260, 95, Math.PI, new THREE.Color(1.4, 0.4, 2.6)],
        [-420, 105, 0, 240, 80, -Math.PI / 2, new THREE.Color(2.4, 1.4, 0.25)],
        [300, 160, -300, 180, 110, Math.PI * 0.25, new THREE.Color(0.2, 2.5, 1.6)],
        [-300, 150, 300, 180, 110, -Math.PI * 0.75, new THREE.Color(2.8, 0.3, 0.8)],
      ];
      for (const [nx, ny, nz, nw, nh, ry, nc] of neonBands) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(nw, nh), new THREE.MeshBasicMaterial({ color: nc, side: THREE.DoubleSide }));
        m.position.set(nx, ny, nz); m.rotation.y = ry;
        envScene.add(m);
      }
      if (this.envMap) this.envMap.dispose();
      this.envMap = pmrem.fromScene(envScene, 0.03).texture;
      this.scene.environment = this.envMap;
      pmrem.dispose();

      this.scene.fog = new THREE.FogExp2(new THREE.Color(0.035, 0.042, 0.095), 0.00028);

      const hemi = new THREE.HemisphereLight(0x4a6cc8, 0x2e1638, 1.05);
      scene.add(hemi);
      const dl = new THREE.DirectionalLight(0x94beff, 1.65);
      dl.position.copy(moon).multiplyScalar(400);
      dl.castShadow = true;
      dl.shadow.mapSize.set(2048, 2048);
      const S = 110;
      Object.assign(dl.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 1200 });
      dl.shadow.bias = -0.0004; dl.shadow.normalBias = 0.6;
      scene.add(dl); scene.add(dl.target);
      this.sunLight = dl;

      const flareTex0 = TX.glowTexture('rgba(210,235,255,1)', 'rgba(80,140,255,0)', 256);
      const flareTex1 = TX.glowTexture('rgba(140,200,255,0.45)', 'rgba(80,120,255,0)', 128);
      const lf = new Lensflare();
      lf.addElement(new LensflareElement(flareTex0, 220, 0, new THREE.Color(0.45, 0.6, 0.85)));
      lf.addElement(new LensflareElement(flareTex1, 55, 0.55, new THREE.Color(0.15, 0.25, 0.45)));
      lf.addElement(new LensflareElement(flareTex1, 85, 0.78, new THREE.Color(0.25, 0.12, 0.35)));
      const flareHolder = new THREE.Object3D();
      flareHolder.position.copy(moon).multiplyScalar(9000);
      flareHolder.add(lf);
      scene.add(flareHolder);
      this.flare = flareHolder;
      return;
    }
    const sky = new Sky();
    sky.scale.setScalar(20000);
    const u = sky.material.uniforms;
    u.turbidity.value = 7.5; u.rayleigh.value = 2.6; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.86;
    const elev = THREE.MathUtils.degToRad(4.5), az = THREE.MathUtils.degToRad(-128);
    const sun = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elev, az);
    u.sunPosition.value.copy(sun);
    this.sunDir = sun.clone();
    scene.add(sky);
    this.sky = sky;

    // env map from sky
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(1000);
    Object.assign(sky2.material.uniforms.sunPosition.value, sun);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = u[k].value;
    envScene.add(sky2);
    // add a warm ground plane to env so reflections aren't black below horizon
    const g = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: 0x2a2320 }));
    g.rotation.x = -Math.PI / 2; g.position.y = -30; envScene.add(g);
    if (this.envMap) this.envMap.dispose();
    this.envMap = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = this.envMap;
    pmrem.dispose();

    this.scene.fog = new THREE.FogExp2(new THREE.Color(0.62, 0.46, 0.4), 0.00028);

    const hemi = new THREE.HemisphereLight(0x9fb4d8, 0x4a3a2a, 0.9);
    scene.add(hemi);
    const dl = new THREE.DirectionalLight(0xffb07a, 3.2);
    dl.position.copy(sun).multiplyScalar(400);
    dl.castShadow = true;
    dl.shadow.mapSize.set(2048, 2048);
    const S = 110;
    Object.assign(dl.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 1200 });
    dl.shadow.bias = -0.0004; dl.shadow.normalBias = 0.6;
    scene.add(dl); scene.add(dl.target);
    this.sunLight = dl;

    // lens flare
    const flareTex0 = TX.glowTexture('rgba(255,230,190,1)', 'rgba(255,160,80,0)', 256);
    const flareTex1 = TX.glowTexture('rgba(255,180,120,0.5)', 'rgba(255,120,60,0)', 128);
    const lf = new Lensflare();
    lf.addElement(new LensflareElement(flareTex0, 280, 0, new THREE.Color(0.6, 0.45, 0.35)));
    lf.addElement(new LensflareElement(flareTex1, 50, 0.6, new THREE.Color(0.25, 0.18, 0.12)));
    lf.addElement(new LensflareElement(flareTex1, 80, 0.7, new THREE.Color(0.2, 0.15, 0.1)));
    lf.addElement(new LensflareElement(flareTex1, 110, 0.9, new THREE.Color(0.18, 0.13, 0.1)));
    lf.addElement(new LensflareElement(flareTex1, 60, 1.0, new THREE.Color(0.2, 0.15, 0.1)));
    const flareHolder = new THREE.Object3D();
    flareHolder.position.copy(sun).multiplyScalar(9000);
    flareHolder.add(lf);
    scene.add(flareHolder);
    this.flare = flareHolder;
  }

  updateSun(target) {
    this.focus = target;
    const dl = this.sunLight;
    // snap to texel grid to avoid shimmering
    const snap = (2 * 110) / 2048;
    const tx = Math.round(target.x / snap) * snap, tz = Math.round(target.z / snap) * snap;
    dl.target.position.set(tx, target.y, tz);
    dl.position.set(tx + this.sunDir.x * 500, target.y + this.sunDir.y * 500 + 60, tz + this.sunDir.z * 500);
    this.flare.position.set(target.x + this.sunDir.x * 9000, this.sunDir.y * 9000, target.z + this.sunDir.z * 9000);
  }

  // ---------------- Terrain ----------------
  buildTerrain() {
    const isTokyo = this.mapId === 'tokyo';
    const n = this.hf.n;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const splat = new Float32Array(n * n * 4); // grass, rock, sand, meadow
    const nz = makeNoise2D(55), nz2 = makeNoise2D(66);
    const tmpN = new THREE.Vector3();
    const cGrass1 = isTokyo ? new THREE.Color(0.06, 0.12, 0.11) : new THREE.Color(0.26, 0.34, 0.12);
    const cGrass2 = isTokyo ? new THREE.Color(0.10, 0.15, 0.16) : new THREE.Color(0.5, 0.44, 0.22);
    const cGrass3 = isTokyo ? new THREE.Color(0.04, 0.09, 0.10) : new THREE.Color(0.18, 0.28, 0.1);
    const cRock = isTokyo ? new THREE.Color(0.13, 0.14, 0.20) : new THREE.Color(0.36, 0.32, 0.29);
    const cSand = isTokyo ? new THREE.Color(0.12, 0.14, 0.20) : new THREE.Color(0.78, 0.68, 0.5);
    const cDirt = isTokyo ? new THREE.Color(0.11, 0.11, 0.15) : new THREE.Color(0.42, 0.36, 0.28);
    const cSnow = isTokyo ? new THREE.Color(0.55, 0.64, 0.82) : new THREE.Color(0.92, 0.93, 0.96);
    const cWet = isTokyo ? new THREE.Color(0.06, 0.08, 0.14) : new THREE.Color(0.32, 0.29, 0.22);
    const cCity = isTokyo ? new THREE.Color(0.08, 0.09, 0.14) : new THREE.Color(0.3, 0.3, 0.3);
    const c = new THREE.Color();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = -WORLD_HALF + i * HF_CELL, z = -WORLD_HALF + j * HF_CELL;
      const h = this.hf.data[k];
      const rd = this.hf.rd[k];
      const cdm = Math.max(Math.abs(x), Math.abs(z));
      // Sink terrain mesh ONLY strictly inside the 1224x1224 city plane (cdm < 606); outside the city pos.y === hf.data[k] so physics and visual terrain match 1:1
      const citySink = 0.38 * (1 - smoothstep(592, 608, cdm));
      pos[k * 3] = x; pos[k * 3 + 1] = h - citySink; pos[k * 3 + 2] = z;
      uv[k * 2] = x / 12; uv[k * 2 + 1] = z / 12;
      this.hf.normal(x, z, tmpN);
      const slope = 1 - tmpN.y;
      const g = fbm(nz, x / 300, z / 300, 3) * 0.5 + 0.5;
      c.copy(cGrass1).lerp(cGrass2, smoothstep(0.35, 0.75, g));
      c.lerp(cGrass3, smoothstep(0.6, 0.9, fbm(nz2, x / 90, z / 90, 2) * 0.5 + 0.5) * 0.6);
      c.lerp(cRock, smoothstep(0.12, 0.3, slope));
      c.lerp(cRock, smoothstep(140, 200, h));
      c.lerp(cSnow, smoothstep(260, 320, h + fbm(nz, x / 80, z / 80, 2) * 30));
      c.lerp(cDirt, (1 - smoothstep(0, 6, rd)) * 0.8);
      if (x > 1300) c.lerp(cSand, 1 - smoothstep(1.0, 6, h));
      if (h < WATER_LEVEL) c.copy(cWet);
      if (Math.abs(x) < 640 && Math.abs(z) < 640) c.lerp(cCity, 0.5);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      // material weights: rock on steep / high ground, sand on the coast, meadow on dry lowland patches, grass elsewhere
      let wr = Math.max(smoothstep(0.1, 0.28, slope), smoothstep(150, 215, h)), ws = x > 1300 ? 1 - smoothstep(1.0, 7, h) : 0;
      if (h < WATER_LEVEL + 1.2) ws = Math.max(ws, 0.9);
      let wm = smoothstep(0.35, 0.8, g) * (1 - wr) * (1 - ws) * 0.9;
      let wg = Math.max(0, 1 - wr - ws - wm);
      const wsum = wr + ws + wm + wg || 1;
      splat[k * 4] = wg / wsum; splat[k * 4 + 1] = wr / wsum; splat[k * 4 + 2] = ws / wsum; splat[k * 4 + 3] = wm / wsum;
    }
    const idx = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const P = ENV.pbr;
    for (const k of ['grass', 'rock', 'sand', 'meadow']) for (const t of [P[k].map, P[k].normalMap, P[k].roughnessMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      const u = { Gd: P.grass.map, Gn: P.grass.normalMap, Rd: P.rock.map, Rn: P.rock.normalMap, Sd: P.sand.map, Sn: P.sand.normalMap, Md: P.meadow.map, Mn: P.meadow.normalMap };
      for (const [k, v] of Object.entries(u)) sh.uniforms['t' + k] = { value: v };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aSplat; varying vec4 vSplat; varying vec2 vWxz; varying float vDist;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat; vWxz = position.xz; vDist = 0.0;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec4 vSplat; varying vec2 vWxz; uniform sampler2D tGd, tGn, tRd, tRn, tSd, tSn, tMd, tMn;
        vec3 trip(sampler2D t, float sc){ vec3 a = texture2D(t, vWxz / sc).rgb; vec3 b = texture2D(t, vWxz / (sc * 5.3) + 0.37).rgb; return a * (0.65 + 0.7 * dot(b, vec3(0.333))); }
        vec3 tripN(sampler2D t, float sc){ return texture2D(t, vWxz / sc).xyz * 2.0 - 1.0; }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 tg = trip(tGd, 3.2), tr = trip(tRd, 5.0), ts = trip(tSd, 4.0), tm = trip(tMd, 3.0);
        vec3 texC = tg * vSplat.x + tr * vSplat.y + ts * vSplat.z + tm * vSplat.w;
        float texL = max(dot(texC, vec3(0.333)), 0.02);
        // keep the hand-tuned vertex palette (hue, snow, dirt near roads) and take luminance + micro contrast from the real textures
        float rel = clamp(texL / 0.30, 0.35, 2.0);
        diffuseColor.rgb = vColor * pow(rel, 1.25) * 1.15 * mix(vec3(1.0), texC / texL, 0.8);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 dn = tripN(tGn, 3.2) * vSplat.x + tripN(tRn, 5.0) * vSplat.y + tripN(tSn, 4.0) * vSplat.z + tripN(tMn, 3.0) * vSplat.w;
          normal = normalize(normal + vec3(dn.x, 0.0, dn.y) * 0.9); }`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.terrain = mesh;
  }

  buildFarLand() {
    const isTokyo = this.mapId === 'tokyo';
    const size = 18000, res = 180;
    const geo = new THREE.PlaneGeometry(size, size, res, res);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    const nz = makeNoise2D(909);
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const d = Math.max(Math.abs(x), Math.abs(z));
      let h;
      const eastness = smoothstep(1000, 2400, x) * (1 - smoothstep(2500, 5000, Math.abs(z)));
      if (d < 2080) h = -70;
      else {
        h = 160 + smoothstep(2080, 5000, d) * 700 * (0.55 + 0.45 * fbm(nz, x / 1400, z / 1400, 4)) + fbm(nz, x / 300, z / 300, 3) * 80;
        h = h * (1 - eastness) + -40 * eastness;
      }
      p.setY(i, h);
      if (isTokyo) {
        c.setRGB(0.05, 0.06, 0.11).lerp(new THREE.Color(0.03, 0.07, 0.10), 0.4);
        if (h > 480) c.lerp(new THREE.Color(0.38, 0.46, 0.65), smoothstep(480, 600, h));
      } else {
        c.setRGB(0.3, 0.28, 0.25).lerp(new THREE.Color(0.2, 0.26, 0.14), 0.4);
        if (h > 480) c.lerp(new THREE.Color(0.9, 0.92, 0.95), smoothstep(480, 600, h));
      }
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.position.y = -0.5;
    this.root.add(mesh);
  }

  buildWater() {
    const isTokyo = this.mapId === 'tokyo';
    const nt = TX.waterNormalTexture();
    nt.repeat.set(600, 600);
    const mat = new THREE.MeshStandardMaterial({
      color: isTokyo ? 0x050d1e : 0x0d2a3a,
      roughness: isTokyo ? 0.06 : 0.1,
      metalness: isTokyo ? 0.28 : 0.1,
      normalMap: nt,
      normalScale: new THREE.Vector2(0.35, 0.35),
      envMapIntensity: isTokyo ? 1.85 : 1.2,
    });
    // anti-sparkle: ripples fade to a flat mirror with distance and roughness rises toward the horizon, so far water is calm instead of noisy
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * (1.0 - smoothstep(35.0, 260.0, length(vViewPosition)));'))
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n      roughnessFactor = mix(roughnessFactor, 0.3, smoothstep(80.0, 700.0, length(vViewPosition)));');
    };
    const geo = new THREE.PlaneGeometry(40000, 40000);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = WATER_LEVEL;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.updaters.push((dt, t) => { nt.offset.set(t * 0.004, t * 0.0025); });
  }

  // ---------------- Roads ----------------
  ribbon(pts, closed, halfW, yOff, vLen, x0 = -1, x1 = 1) {
    const n = pts.length;
    const count = closed ? n + 1 : n;
    const pos = new Float32Array(count * 2 * 3), uv = new Float32Array(count * 2 * 2), nor = new Float32Array(count * 2 * 3);
    let dist = 0;
    for (let k = 0; k < count; k++) {
      const i = k % n;
      const p = pts[i];
      const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      let tx = next.x - prev.x, tz = next.z - prev.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const rx = -tz, rz = tx;
      if (k > 0) { const q = pts[(k - 1) % n]; dist += Math.hypot(p.x - q.x, p.z - q.z); }
      for (let s = 0; s < 2; s++) {
        const o = (s === 0 ? x0 : x1) * halfW;
        const vi = k * 2 + s;
        pos[vi * 3] = p.x + rx * o; pos[vi * 3 + 1] = p.h + yOff + (p.bank ? p.bank * clamp(o, -LOOP_HALF_W, LOOP_HALF_W) : 0); pos[vi * 3 + 2] = p.z + rz * o;
        uv[vi * 2] = s; uv[vi * 2 + 1] = dist / vLen;
        nor[vi * 3 + 1] = 1;
      }
    }
    const idx = [];
    for (let k = 0; k < count - 1; k++) { const a = k * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  buildRoadMeshes() {
    const hwTex = TX.roadTexture(3, true);
    const cnTex = TX.roadTexture(2, false);
    const A = ENV.pbr.asphalt; for (const t of [A.normalMap, A.roughnessMap, A.map]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    // the painted road canvas keeps lane markings; real asphalt detail (grain, cracks, normal, roughness) is multiplied in by a second UV set tiled in world metres
    const asphaltPatch = (mat, tile) => {
      if (this.mapId === 'tokyo') { mat.metalness = 0.18; mat.envMapIntensity = 2.2; mat.color.setRGB(0.55, 0.57, 0.66); }
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.tAsDiff = { value: A.map }; sh.uniforms.tAsNor = { value: A.normalMap }; sh.uniforms.tAsRough = { value: A.roughnessMap };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vAsUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAsUv = vec2(position.x + position.z * 0.37, position.z - position.x * 0.21) / ' + tile.toFixed(1) + ';');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vAsUv; uniform sampler2D tAsDiff, tAsNor, tAsRough;')
          .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 asD = texture2D(tAsDiff, vAsUv).rgb; vec3 asD2 = texture2D(tAsDiff, vAsUv * 0.173 + 0.31).rgb;
          float asL = dot(asD, vec3(0.333)) * 1.9; float asL2 = dot(asD2, vec3(0.333)) * 1.9;
          float asPaint = smoothstep(0.55, 0.8, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
          diffuseColor.rgb *= mix(clamp(asL * mix(0.8, 1.2, asL2 * 0.5), 0.45, 1.5), clamp(0.8 + asL * 0.25, 0.7, 1.15), asPaint);`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + (this.mapId === 'tokyo' ? 'roughnessFactor = clamp(texture2D(tAsRough, vAsUv).g * 0.3 + 0.1, 0.1, 0.42);' : 'roughnessFactor = clamp(texture2D(tAsRough, vAsUv).g * 0.35 + 0.62, 0.45, 1.0);'))
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          { vec3 an = texture2D(tAsNor, vAsUv).xyz * 2.0 - 1.0; normal = normalize(normal + (tbn_fake(an)) * 0.55); }`)
          .replace('void main() {', 'vec3 tbn_fake(vec3 n){ return vec3(n.x, 0.0, n.y); }\nvoid main() {');
      };
    };
    const hwMat = new THREE.MeshStandardMaterial({ map: hwTex, roughness: 0.78, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const cnMat = new THREE.MeshStandardMaterial({ map: cnTex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    asphaltPatch(hwMat, 6); asphaltPatch(cnMat, 6);
    const rpTex = TX.roadTexture(1, false);
    const rampMat = new THREE.MeshStandardMaterial({ map: rpTex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -0.8, polygonOffsetUnits: -0.8 });
    asphaltPatch(rampMat, 6);
    const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 1, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 });
    for (const r of this.net.roads) {
      const hw = r.kind === 'highway';
      const g = this.ribbon(r.pts, r.closed, r.halfW + (hw ? 1.2 : 0.8), hw ? 0.14 : r.kind === 'ramp' ? 0.1 : 0.12, hw ? 36 : 30);
      const m = new THREE.Mesh(g, hw ? hwMat : r.kind === 'ramp' ? rampMat : cnMat);
      m.receiveShadow = true;
      this.root.add(m);
      const sg = this.ribbon(r.pts, r.closed, r.halfW + 4, 0.06, 30);
      const sm = new THREE.Mesh(sg, shoulderMat); sm.receiveShadow = true; this.root.add(sm);
    }
    this.buildRails();
    this.buildHighwayLamps();
    this.buildGantries();
  }

  buildRails() {
    const loop = this.net.loop;
    const pts = loop.pts, n = pts.length;
    const off = LOOP_HALF_W + 1.9;
    const railPts = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
      let tx = next.x - prev.x, tz = next.z - prev.z; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
      let rx = -tz, rz = tx;
      let sgn = 1;
      if (rx * p.x + rz * p.z < 0) { rx = -rx; rz = -rz; sgn = -1; } // outward (sgn: side relative to the ribbon's right vector)
      railPts.push({ x: p.x + rx * off, z: p.z + rz * off, h: p.h + (p.bank || 0) * sgn * LOOP_HALF_W });
    }
    // beam ribbon (vertical)
    const count = n + 1;
    const pos = new Float32Array(count * 2 * 3);
    for (let k = 0; k < count; k++) {
      const p = railPts[k % n];
      pos.set([p.x, p.h + 0.45, p.z, p.x, p.h + 0.95], k * 6); pos[k * 6 + 5] = p.z;
    }
    const idx = [];
    for (let k = 0; k < count - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(g, mat); beam.castShadow = true; beam.receiveShadow = true;
    this.root.add(beam);
    // posts
    const post = new THREE.BoxGeometry(0.15, 1.0, 0.15); post.translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(post, new THREE.MeshStandardMaterial({ color: 0x777b80, metalness: 0.7, roughness: 0.5 }), n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { const p = railPts[i]; m4.makeTranslation(p.x, p.h, p.z); pm.setMatrixAt(i, m4); }
    this.root.add(pm);
    // reflectors (orange cat-eyes that bloom in headlights)
    const refl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.2) }), Math.ceil(n / 3));
    for (let i = 0, k = 0; i < n; i += 3, k++) { const p = railPts[i]; m4.makeTranslation(p.x, p.h + 0.75, p.z); refl.setMatrixAt(k, m4); }
    this.root.add(refl);
    for (let i = 0; i < n; i++) { const a = railPts[i], b = railPts[(i + 1) % n]; this.statics.addSeg(a.x, a.z, b.x, b.z, 'rail'); }
    this.railPts = railPts;
  }

  lampGeometry(height, arm) {
    const pole = new THREE.CylinderGeometry(0.1, 0.16, height, 8); pole.translate(0, height / 2, 0);
    const armG = new THREE.BoxGeometry(0.12, 0.12, arm); armG.translate(0, height - 0.1, arm / 2);
    const base = new THREE.CylinderGeometry(0.3, 0.35, 0.6, 8); base.translate(0, 0.3, 0);
    const g = mergeGeometries([pole, armG, base]);
    const head = new THREE.BoxGeometry(0.45, 0.14, 1.1); head.translate(0, height - 0.22, arm - 0.3);
    return { g, head };
  }

  buildHighwayLamps() {
    const pts = this.net.loop.pts, n = pts.length;
    const { g, head } = this.lampGeometry(11, 3.2);
    const every = 6;
    const cnt = Math.ceil(n / every);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a5e62, metalness: 0.8, roughness: 0.4 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1, 0.72, 0.4), emissiveIntensity: 5 });
    const poles = new THREE.InstancedMesh(g, poleMat, cnt), heads = new THREE.InstancedMesh(head, headMat, cnt);
    poles.castShadow = true;
    const pools = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (let i = 0; i < n; i += every) {
      const r = this.railPts[i];
      const p = pts[i];
      const ang = Math.atan2(p.x - r.x, p.z - r.z);
      q.setFromAxisAngle(up, ang);
      m4.compose(new THREE.Vector3(r.x + (r.x - p.x) * 0.04, r.h, r.z + (r.z - p.z) * 0.04), q, s);
      poles.setMatrixAt(k, m4); heads.setMatrixAt(k, m4); k++;
      pools.push({ x: r.x + Math.sin(ang) * 3.5, z: r.z + Math.cos(ang) * 3.5, y: p.h + 0.2, s: 13 });
    }
    this.root.add(poles, heads);
    this.addLightPools(pools);
  }

  addLightPools(list) {
    if (!this.poolTex) this.poolTex = TX.glowTexture('rgba(255,190,120,0.9)', 'rgba(255,150,80,0)', 128);
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: this.poolTex, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m4 = new THREE.Matrix4();
    list.forEach((p, i) => { m4.makeScale(p.s, 1, p.s).setPosition(p.x, p.y, p.z); im.setMatrixAt(i, m4); });
    im.renderOrder = 2;
    this.root.add(im);
  }

  buildGantries() {
    const loop = this.net.loop;
    const n = loop.pts.length;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8a8e92, metalness: 0.8, roughness: 0.4 });
    for (const c of this.net.connectors) {
      for (const dir of [1, -1]) {
        const i = (c.loopIndex - dir * 34 + n) % n;
        const p = loop.pts[i], nx = loop.pts[(i + dir + n) % n];
        const ang = Math.atan2(nx.x - p.x, nx.z - p.z);
        const grp = new THREE.Group();
        const span = LOOP_HALF_W * 2 + 4;
        const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.5, 0.5), postMat); beam.position.y = 7.5;
        const pL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7.8, 0.4), postMat); pL.position.set(-span / 2, 3.9, 0);
        const pR = pL.clone(); pR.position.x = span / 2;
        const tex = TX.textTexture(c.name, { sub: 'NEXT EXIT', w: 512, h: 200 });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.1), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.5 }));
        sign.position.set(-5, 6.2, -0.3); sign.rotation.y = Math.PI;
        grp.add(beam, pL, pR, sign);
        grp.position.set(p.x, p.h, p.z);
        grp.rotation.y = ang;
        grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        this.root.add(grp);
        const rx = Math.cos(ang), rz = -Math.sin(ang);
        this.statics.addCircle(p.x + rx * span / 2, p.z + rz * span / 2, 0.5, 'post');
        this.statics.addCircle(p.x - rx * span / 2, p.z - rz * span / 2, 0.5, 'post');
      }
    }
  }

  // ---------------- City ----------------
  buildCity() {
    const S = STREET_SPACING, H = CITY_HALF, W = STREET_HALF_W;
    const rnd = mulberry32(2024);
    const scene = this.root;
    // ground asphalt
    const AS = ENV.pbr.asphalt; for (const t of [AS.map, AS.normalMap, AS.roughnessMap]) { t.repeat.set(1224 / 7, 1224 / 7); t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1224, 1224), new THREE.MeshStandardMaterial({ map: AS.map, normalMap: AS.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: AS.roughnessMap, roughness: this.mapId === 'tokyo' ? 0.3 : 1, metalness: this.mapId === 'tokyo' ? 0.2 : 0, envMapIntensity: this.mapId === 'tokyo' ? 2.2 : 1, color: this.mapId === 'tokyo' ? 0x6a6c7a : 0xd0d0d0 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0.04; ground.receiveShadow = true;
    scene.add(ground);

    // markings
    const markGeo = new THREE.PlaneGeometry(1, 1); markGeo.rotateX(-Math.PI / 2);
    const white = new THREE.MeshStandardMaterial({ color: 0xdcdcd4, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8a420, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const whites = [], yellows = [];
    const lines = [];
    for (let k = -H; k <= H; k += S) lines.push(k);
    for (const c of lines) {
      for (let seg = -H; seg < H; seg += S) {
        const a = seg + W + 2, b = seg + S - W - 2, len = b - a, mid = (a + b) / 2;
        for (const o of [-0.25, 0.25]) { yellows.push([mid, c + o, len, 0.18]); yellows.push([c + o, mid, 0.18, len]); }
        for (const lane of [-5, 5]) for (let d = a + 2; d < b - 3; d += 9) {
          whites.push([d + 1.5, c + lane, 3, 0.16]); whites.push([c + lane, d + 1.5, 0.16, 3]);
        }
        // stop lines & crosswalks
      }
    }
    // crosswalks at intersections
    for (const x of lines) for (const z of lines) {
      for (let s = -8; s <= 8; s += 1.6) {
        whites.push([x + s, z - W - 1.2, 0.8, 2.6]); whites.push([x + s, z + W + 1.2, 0.8, 2.6]);
        whites.push([x - W - 1.2, z + s, 2.6, 0.8]); whites.push([x + W + 1.2, z + s, 2.6, 0.8]);
      }
    }
    const mk = (arr, mat) => {
      const im = new THREE.InstancedMesh(markGeo, mat, arr.length);
      const m4 = new THREE.Matrix4();
      arr.forEach((a, i) => { m4.makeScale(a[2], 1, a[3]).setPosition(a[0], 0.06, a[1]); im.setMatrixAt(i, m4); });
      im.receiveShadow = true; scene.add(im);
    };
    mk(whites, white); mk(yellows, yellow);

    // blocks
    const blocks = [];
    for (let i = -H; i < H; i += S) for (let j = -H; j < H; j += S) {
      const cx = i + S / 2, cz = j + S / 2;
      const d = Math.hypot(cx, cz);
      const r = rnd();
      let type = 'build';
      if (r < 0.09 && d > 150) type = 'park'; else if (r < 0.13 && d > 150) type = 'plaza';
      if (this.mapId === 'tokyo' && Math.abs(cx - 60) < 1 && Math.abs(cz - 60) < 1) type = 'tower'; // Tokyo Tower block
      blocks.push({ cx, cz, type, d });
    }
    const bs = S - W * 2; // block size (100)
    const CN = ENV.pbr.concrete; const concTex = CN.map; concTex.repeat.set(bs / 6, bs / 6); for (const t of [CN.normalMap, CN.roughnessMap]) { t.repeat.set(bs / 6, bs / 6); t.wrapS = t.wrapT = THREE.RepeatWrapping; } concTex.wrapS = concTex.wrapT = THREE.RepeatWrapping;
    const slabGeo = new THREE.BoxGeometry(bs, 0.3, bs); slabGeo.translate(0, 0.15, 0);
    const slabMat = new THREE.MeshStandardMaterial({ map: concTex, normalMap: CN.normalMap, roughnessMap: CN.roughnessMap, roughness: 1 });
    const slabs = new THREE.InstancedMesh(slabGeo, slabMat, blocks.length);
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x3e5a24, roughness: 1 });
    const parkTops = [];
    const m4 = new THREE.Matrix4();
    blocks.forEach((b, i) => {
      m4.makeTranslation(b.cx, 0, b.cz); slabs.setMatrixAt(i, m4);
      this.statics.addBox(b.cx - bs / 2, b.cz - bs / 2, b.cx + bs / 2, b.cz + bs / 2, 'block');
      if (b.type === 'park') parkTops.push(b);
    });
    slabs.receiveShadow = true;
    scene.add(slabs);
    if (parkTops.length) {
      const pg = new THREE.BoxGeometry(bs - 8, 0.05, bs - 8);
      const pm = new THREE.InstancedMesh(pg, grassMat, parkTops.length);
      parkTops.forEach((b, i) => { m4.makeTranslation(b.cx, 0.32, b.cz); pm.setMatrixAt(i, m4); });
      pm.receiveShadow = true; scene.add(pm);
    }

    // buildings
    const bldg = [];
    const T = this.mapId === 'tokyo';
    const palette = T ? [0x3a3f5c, 0x2c3350, 0x4a4560, 0x2a2f45, 0x55486a, 0x3c4a62, 0x5a5a78, 0x262a3c, 0x483a58] : [0x8a8580, 0xa89c88, 0x6d7278, 0x5a6470, 0x9a6a52, 0x7e7a70, 0xb0a898, 0x4a5058, 0x6a5a4c];
    let towerBlock = null;
    const addB = (x, z, w, d, h, seed, style, color) => bldg.push({ x, z, w, d, h, seed, style, color });
    const treeSpots = [];
    const fountains = [];
    for (const b of blocks) {
      const f = 1 - clamp(b.d / 820, 0, 1);
      const inset = bs / 2 - 5;
      if (b.type === 'park') {
        for (let k = 0; k < 26; k++) treeSpots.push({ x: b.cx + (rnd() - 0.5) * (bs - 14), z: b.cz + (rnd() - 0.5) * (bs - 14), s: 0.8 + rnd() * 0.6 });
        continue;
      }
      if (b.type === 'plaza') {
        fountains.push(b);
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; treeSpots.push({ x: b.cx + Math.cos(a) * 34, z: b.cz + Math.sin(a) * 34, s: 0.9 }); }
        continue;
      }
      if (b.type === 'tower') { towerBlock = b; continue; }
      const lotsR = rnd();
      const lots = [];
      if (T) {
        // Tokyo: dense narrow lots (3 x 2 grid, some merged) with tight alleys between them
        const g = 2, lw = (inset * 2 - g * 2) / 3, ld = (inset * 2 - g) / 2;
        for (let ix = 0; ix < 3; ix++) for (let iz = 0; iz < 2; iz++) {
          if (rnd() < 0.08) continue;
          lots.push([b.cx - inset + lw / 2 + ix * (lw + g), b.cz - inset + ld / 2 + iz * (ld + g), lw, ld]);
        }
      } else if (f > 0.55 && lotsR < 0.45) lots.push([b.cx, b.cz, inset * 2, inset * 2]);
      else if (lotsR < 0.7) {
        const g = 3;
        lots.push([b.cx - inset / 2 - g / 2, b.cz, inset - g, inset * 2], [b.cx + inset / 2 + g / 2, b.cz, inset - g, inset * 2]);
      } else {
        const g = 3, q = inset / 2 + g / 2, s = inset - g;
        lots.push([b.cx - q, b.cz - q, s, s], [b.cx + q, b.cz - q, s, s], [b.cx - q, b.cz + q, s, s], [b.cx + q, b.cz + q, s, s]);
      }
      for (const [x, z, w, d] of lots) {
        const hmax = T ? 30 + f * f * 210 : 18 + f * f * 190;
        const h = T ? 16 + Math.pow(rnd(), 0.75) * hmax + f * 26 : 10 + rnd() * rnd() * hmax + f * 20;
        const shrink = 0.8 + rnd() * 0.2;
        const style = f > 0.4 && rnd() < 0.55 ? 0.75 + rnd() * 0.25 : rnd() * 0.7;
        const color = palette[Math.floor(rnd() * palette.length)];
        const seed = rnd();
        const bw = w * shrink, bd = d * (0.8 + rnd() * 0.2);
        addB(x, z, bw, bd, h, seed, style, color);
        if (h > 70) {
          addB(x, z, bw * 0.7, bd * 0.7, h * (0.18 + rnd() * 0.2), seed + 0.3, style, color);
          if (rnd() < 0.6) addB(x, z, bw * 0.35, bd * 0.35, h * 0.1, seed + 0.6, style, 0x3a3d42);
        }
        if (rnd() < 0.5) {
          // rooftop units
          addB(x + (rnd() - 0.5) * bw * 0.5, z + (rnd() - 0.5) * bd * 0.5, 4 + rnd() * 5, 4 + rnd() * 5, 2 + rnd() * 2, 0.9, 0.1, 0x55585c);
        }
      }
      // sidewalk trees for lower-density blocks
      if (f < 0.5) for (let e = -40; e <= 40; e += 20) {
        treeSpots.push({ x: b.cx + e, z: b.cz - bs / 2 + 2.2, s: 0.55 }, { x: b.cx + e, z: b.cz + bs / 2 - 2.2, s: 0.55 });
      }
    }
    // stack: rooftop positions need base heights -> compute y offsets by order
    const baseBox = new THREE.BoxGeometry(1, 1, 1); baseBox.translate(0, 0.5, 0);
    const bMat = this.buildingMaterial();
    const bim = new THREE.InstancedMesh(baseBox, bMat, bldg.length);
    const seeds = new Float32Array(bldg.length * 2);
    const col = new THREE.Color();
    const tops = [];
    const beacons = [];
    const neon = [];
    const s_tokyoSigns = [];
    bldg.forEach((b, i) => {
      // find what is under (previous with same center & larger)
      let y = 0.3;
      for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
        const o = bldg[k];
        if (Math.abs(o.x - b.x) < o.w / 2 && Math.abs(o.z - b.z) < o.d / 2 && o.w >= b.w) { y = o.y + o.h; break; }
      }
      b.y = y;
      m4.makeScale(b.w, b.h, b.d).setPosition(b.x, y, b.z);
      bim.setMatrixAt(i, m4);
      col.set(b.color); bim.setColorAt(i, col);
      seeds[i * 2] = b.seed; seeds[i * 2 + 1] = b.style;
      if (y + b.h > 110 && b.w < 30) beacons.push([b.x, y + b.h + 0.6, b.z]);
      if (y === 0.3 && b.h > 25 && rnd() < (this.mapId === 'tokyo' ? 0.9 : 0.35)) {
        const side = Math.floor(rnd() * 4);
        const hy = 8 + rnd() * Math.min(40, b.h - 16);
        const nc = [[4, 0.4, 2.2], [0.4, 2.5, 4], [4, 2.6, 0.3], [0.3, 3.5, 3], [4, 1.2, 3.2]][Math.floor(rnd() * 5)];
        if (this.mapId === 'tokyo') {
          const k = Math.floor(rnd() * 6); s_tokyoSigns.push({ x: b.x, z: b.z, y: 6 + rnd() * Math.min(60, b.h - 10), side: Math.floor(rnd() * 4), w: b.w, d: b.d, k, vert: rnd() < 0.4 });
          // Shibuya scramble: huge video screens on the buildings facing the crossing at the origin
          if (Math.abs(b.x) < 90 && Math.abs(b.z) < 90 && b.h > 34) {
            const face = Math.abs(b.x) > Math.abs(b.z) ? (b.x > 0 ? 3 : 1) : (b.z > 0 ? 2 : 0);
            s_tokyoSigns.push({ x: b.x, z: b.z, y: 14 + rnd() * 8, side: face, w: b.w, d: b.d, k: Math.floor(rnd() * 6), vert: false, big: true });
          }
        }
        neon.push({ x: b.x, z: b.z, y: hy, side, w: b.w, d: b.d, c: nc, sw: 4 + rnd() * 6, sh: 1.5 + rnd() * 3 });
      }
    });
    baseBox.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 2));
    bim.castShadow = true; bim.receiveShadow = false;
    scene.add(bim);

    if (!location.search.includes('nodetail')) // ---- architectural detail layer (instanced): roof cornice + parapet, ground-floor plinth, corner piers, rooftop plant ----
    {
      const dm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.05 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x4a4e52, roughness: 0.6, metalness: 0.5 });
      const box = (w, h, d, y) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y, 0); return g; };
      const cornice = new THREE.InstancedMesh(mergeGeometries([box(1.04, 0.012, 1.04, 0.995), box(1.0, 0.02, 1.0, 1.0)]), dm, bldg.length); // scaled by building (unit box) below
      const plinth = new THREE.InstancedMesh(box(1.015, 1, 1.015, 0.5), dm, bldg.length);
      const hvac = [], pipes = [], piers = [];
      const cm = new THREE.Matrix4(), cc = new THREE.Color(), tmpV = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3();
      let n = 0, nPl = 0;
      bldg.forEach((b, i) => {
        if (b.style > 0.99 || b.h < 6) return;
        const top = b.y + b.h;
        // cornice: overhanging slab + parapet wall, ~0.9 m tall regardless of building height
        cm.makeScale(b.w * 1.0, 0.9, b.d * 1.0).setPosition(b.x, top - 0.9 * 0.0, b.z);
        // unit-geometry has height 1 at y 0.995..1.0 -> rebuild with absolute size instead
        tmpV.set(b.x, top + 0.45, b.z); ts.set(b.w * 1.03, 0.9, b.d * 1.03); cm.compose(tmpV, tq.identity(), ts);
        cornice.setMatrixAt(n, cm); cc.set(b.color).multiplyScalar(0.8); cornice.setColorAt(n, cc); n++;
        if (b.y < 1) { // ground-floor plinth band
          tmpV.set(b.x, 0.3 + 1.1, b.z); ts.set(b.w * 1.012, 2.2, b.d * 1.012); cm.compose(tmpV, tq.identity(), ts);
          plinth.setMatrixAt(nPl, cm); cc.set(b.color).multiplyScalar(0.55); plinth.setColorAt(nPl, cc); nPl++;
          // vertical corner piers on larger buildings give the facade rhythm
          if (b.h > 28 && b.style < 0.7) for (const sx of [-1, 1]) for (const sz of [-1, 1]) piers.push({ x: b.x + sx * b.w * 0.5, z: b.z + sz * b.d * 0.5, h: b.h, c: b.color });
        }
        // rooftop plant on flat tops
        if (b.w > 14 && b.d > 14 && b.h < 150) {
          const r = ((b.seed * 9301 + 49297) % 233280) / 233280;
          const cnt = 1 + Math.floor(r * 3);
          for (let k = 0; k < cnt; k++) { const a = ((b.seed * 77 + k * 31.7) % 1), a2 = ((b.seed * 131 + k * 17.3) % 1); hvac.push({ x: b.x + (a - 0.5) * b.w * 0.6, z: b.z + (a2 - 0.5) * b.d * 0.6, y: top, w: 2.4 + a * 3, d: 2 + a2 * 3, h: 1.4 + r * 1.2 }); }
        }
      });
      cornice.count = n; plinth.count = nPl;
      for (const im of [cornice, plinth]) { im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); scene.add(im); }
      if (hvac.length) { // rooftop AC blocks with a fan stack
        const unit = mergeGeometries([box(1, 1, 1, 0.5), (() => { const g = new THREE.CylinderGeometry(0.28, 0.28, 0.5, 10); g.translate(0.15, 1.25, 0.1); return g; })()]);
        const hm = new THREE.InstancedMesh(unit, dark, hvac.length);
        hvac.forEach((u, i) => { tmpV.set(u.x, u.y, u.z); ts.set(u.w, u.h, u.d); cm.compose(tmpV, tq.identity(), ts); hm.setMatrixAt(i, cm); });
        hm.castShadow = true; hm.computeBoundingSphere(); scene.add(hm);
      }
      if (piers.length) {
        const pm = new THREE.InstancedMesh(box(1, 1, 1, 0.5), dm, piers.length);
        piers.forEach((u, i) => { tmpV.set(u.x, 0.3, u.z); ts.set(1.1, u.h, 1.1); cm.compose(tmpV, tq.identity(), ts); pm.setMatrixAt(i, cm); cc.set(u.c).multiplyScalar(0.7); pm.setColorAt(i, cc); });
        pm.castShadow = true; pm.receiveShadow = true; pm.instanceColor.needsUpdate = true; pm.computeBoundingSphere(); scene.add(pm);
      }
    }

    // antenna beacons (blink)
    if (beacons.length) {
      const bm = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.2, 0.1) });
      const bi = new THREE.InstancedMesh(new THREE.SphereGeometry(0.6, 8, 6), bm, beacons.length);
      beacons.forEach((p, i) => { m4.makeTranslation(p[0], p[1], p[2]); bi.setMatrixAt(i, m4); });
      scene.add(bi);
      this.updaters.push((dt, t) => { const on = (t % 1.6) < 0.25 ? 1 : 0.05; bm.color.setRGB(6 * on, 0.2 * on, 0.1 * on); });
    }
    // neon signs
    if (neon.length) {
      const ng = new THREE.PlaneGeometry(1, 1);
      const nm = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      const ni = new THREE.InstancedMesh(ng, nm, neon.length);
      const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      neon.forEach((s, i) => {
        const offs = [[0, s.d / 2 + 0.15, 0], [s.w / 2 + 0.15, 0, Math.PI / 2], [0, -s.d / 2 - 0.15, Math.PI], [-s.w / 2 - 0.15, 0, -Math.PI / 2]][s.side];
        q.setFromAxisAngle(up, offs[2]);
        m4.compose(new THREE.Vector3(s.x + offs[0], s.y, s.z + offs[1]), q, new THREE.Vector3(s.sw, s.sh, 1));
        ni.setMatrixAt(i, m4); col.setRGB(s.c[0], s.c[1], s.c[2]); ni.setColorAt(i, col);
      });
      scene.add(ni);
    }

    if (this.mapId === 'tokyo') { this.buildTokyoDecor(s_tokyoSigns, lines, S, H, W, rnd); if (towerBlock) this.buildTokyoLandmarks(towerBlock, S, H, W); }

    // fountains
    for (const b of fountains) {
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(12, 12.5, 1, 32), new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.8 }));
      basin.position.set(b.cx, 0.8, b.cz);
      const water = new THREE.Mesh(new THREE.CylinderGeometry(11.3, 11.3, 0.1, 32), new THREE.MeshStandardMaterial({ color: 0x1d4050, roughness: 0.05, metalness: 0.2 }));
      water.position.set(b.cx, 1.2, b.cz);
      const col2 = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.5, 5, 12), basin.material); col2.position.set(b.cx, 3, b.cz);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 3) }));
      glow.position.set(b.cx, 5.8, b.cz);
      basin.castShadow = col2.castShadow = true;
      scene.add(basin, water, col2, glow);
    }

    // street lamps
    const lampList = [];
    for (const c of lines) {
      for (let t = -H + 20; t <= H - 20; t += 40) {
        const mod = ((t % S) + S) % S;
        if (mod < 14 || mod > S - 14) continue;
        for (const side of [-1, 1]) {
          if (Math.abs(c + side * (W + 1.3)) > H) continue;
          lampList.push({ x: t, z: c + side * (W + 1.3), ang: side > 0 ? Math.PI : 0 });
          lampList.push({ x: c + side * (W + 1.3), z: t, ang: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
        }
      }
    }
    // scanned lamp post (Poly Haven street_lamp_01), arm points toward the road; glowing head kept as a separate emissive mesh
    const lampP = ENV.lamp;
    const headMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1, 0.78, 0.5), emissiveIntensity: 5 });
    const lampH = lampP.size.y;
    const headGeo = new THREE.BoxGeometry(0.5, 0.12, 1.1); headGeo.translate(0, lampH - 0.3, 1.9); // glowing luminaire out over the road
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 2.2); armGeo.translate(0, lampH - 0.15, 1.1);
    // perf: lamps are chunked spatially (frustum + shadow-frustum culling actually works) and distance-culled; heads stay visible further as glow points
    const armMat = new THREE.MeshStandardMaterial({ color: 0x2a2d30, metalness: 0.7, roughness: 0.5 });
    const lampParts = [...lampP.parts.map((p) => ({ geo: p.geo, mat: p.mat, cast: true, recv: true })), { geo: armGeo, mat: armMat, cast: true }];
    this.cityProps(lampList, lampParts, 360, 300);
    this.cityProps(lampList, [{ geo: headGeo, mat: headMat }], 800, 400);
    this.addLightPools(lampList.map((l) => ({ x: l.x + Math.sin(l.ang) * 2.5, z: l.z + Math.cos(l.ang) * 2.5, y: 0.08, s: 10 })));

    // sidewalk props (decimated Poly Haven scans): bins at every block corner, short concrete barrier runs along busy block edges
    {
      const binList = [], barList = [];
      const inset = W + 1.6;
      for (const x of lines) for (const z of lines) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = x + sx * inset, pz = z + sz * inset;
        if (Math.abs(px) > H - 2 || Math.abs(pz) > H - 2) continue;
        binList.push({ x: px, z: pz, ang: rnd() * 6.28 });
      }
      for (const c of lines) for (let t = -H + 30; t <= H - 30; t += S) {
        if (rnd() < 0.55) continue;
        const off = (rnd() < 0.5 ? -1 : 1) * (W + 1.0);
        if (Math.abs(c + off) > H - 2) continue;
        for (let k = 0; k < 3; k++) {
          const along = t + (k - 1) * 1.5;
          if (rnd() < 0.5) barList.push({ x: along, z: c + off, ang: Math.PI / 2 }); else barList.push({ x: c + off, z: along, ang: 0 });
        }
      }
      // perf: small street furniture is chunked + culled at 220 m and does not cast into the sun shadow map (only receives)
      const put = (list, prop, solid) => {
        this.cityProps(list, prop.parts.map((p) => ({ geo: p.geo, mat: p.mat, cast: false, recv: true })), 200, 300);
        if (solid) for (const l of list) solid(l);
      };
      put(binList, ENV.bin, (l) => this.statics.addCircle(l.x, l.z, 0.55, 'post'));
      put(barList, ENV.barrier, (l) => { const hx = Math.abs(Math.cos(l.ang)) * 0.4, hz = Math.abs(Math.sin(l.ang)) * 0.4; this.statics.addCircle(l.x, l.z, 0.6, 'post'); });
    }

    this.cityTrees = treeSpots;
  }

  // Tokyo Night: bilingual neon billboards on tower faces, vertical kanji banners, paper lanterns and glowing vending machines.
  // Tokyo landmarks: lit lattice Tokyo Tower in its reserved block + an overhead Shuto-style viaduct over one avenue (pillars stand on the sidewalks, so traffic is unaffected)
  buildTokyoLandmarks(tower, S, H, W) {
    const g = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xff4a1c, emissive: new THREE.Color(1.0, 0.22, 0.05), emissiveIntensity: 0.9, roughness: 0.5, metalness: 0.4 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, emissive: new THREE.Color(0.9, 0.9, 1.0), emissiveIntensity: 0.8, roughness: 0.5, metalness: 0.4 });
    const beam = (ax, ay, az, bx, by, bz, r, mat) => {
      const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz), d = b.clone().sub(a), len = d.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 5), mat);
      m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(m);
    };
    const H1 = 150, H2 = 235, TOP = 330;
    const half = (y) => 21 * (1 - Math.min(1, y / TOP)) ** 1.6 + 1.2; // leg half-spacing narrows with height
    const levels = [0, 25, 50, 75, 100, 125, H1, 180, 210, H2];
    for (let i = 0; i < levels.length - 1; i++) {
      const y0 = levels[i], y1 = levels[i + 1], h0 = half(y0), h1 = half(y1), mat = i % 2 ? white : red;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(sx * h0, y0, sz * h0, sx * h1, y1, sz * h1, 0.7, mat);
      // cross bracing on each face
      for (const [sx, sz, tx, tz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) { beam(sx * h0, y0, sz * h0, tx * h1, y1, tz * h1, 0.28, mat); beam(tx * h0, y0, tz * h0, sx * h1, y1, sz * h1, 0.28, mat); }
    }
    for (const [y, w, hh] of [[H1, 1.0, 9], [H2, 0.55, 6]]) { // observation decks
      const d = new THREE.Mesh(new THREE.BoxGeometry(half(y) * 2 + 7 * w, hh, half(y) * 2 + 7 * w), new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: new THREE.Color(1.6, 1.0, 0.5), emissiveIntensity: 1.2, roughness: 0.6 }));
      d.position.y = y + hh / 2; g.add(d);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 1.2, TOP - H2 + 20, 8), red); mast.position.y = H2 + (TOP - H2 + 20) / 2; g.add(mast);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.3, 0.2) })); tip.position.y = TOP + 21; g.add(tip);
    g.position.set(tower.cx, 0.3, tower.cz);
    this.root.add(g);
    this.statics.addBox(tower.cx - 24, tower.cz - 24, tower.cx + 24, tower.cz + 24, 'block');
    const bm = new THREE.PointLight(0xff8040, 900, 220, 2); bm.position.set(tower.cx, 40, tower.cz); this.root.add(bm);
    this.updaters.push((dt, t) => { tip.material.color.setRGB(6 * (0.35 + 0.65 * (Math.sin(t * 2.4) > 0 ? 1 : 0)), 0.3, 0.2); });

    // overhead Shuto expressway deck along the z = 240 avenue (visual only; pillars on the sidewalks)
    const zc = 240, deckY = 15, halfW = W + 3.5;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(H * 2, 1.4, halfW * 2), new THREE.MeshStandardMaterial({ color: 0x2a2d3c, roughness: 0.85, metalness: 0.1 }));
    deck.position.set(0, deckY, zc); deck.castShadow = deck.receiveShadow = true; this.root.add(deck);
    const rail = new THREE.MeshStandardMaterial({ color: 0x555a70, roughness: 0.5, metalness: 0.6 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.2, 3.2) });
    for (const sz of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(H * 2, 1.1, 0.4), rail); r.position.set(0, deckY + 1.2, zc + sz * (halfW - 0.2)); this.root.add(r);
      const l = new THREE.Mesh(new THREE.BoxGeometry(H * 2, 0.12, 0.12), glow); l.position.set(0, deckY + 1.9, zc + sz * (halfW - 0.2)); this.root.add(l);
    }
    const pil = []; for (let x = -H + 30; x <= H - 30; x += 60) for (const sz of [-1, 1]) pil.push({ x, z: zc + sz * (W + 1.6), ang: 0 });
    const pg = new THREE.BoxGeometry(2.2, deckY, 2.2); pg.translate(0, deckY / 2, 0);
    this.cityProps(pil, [{ geo: pg, mat: new THREE.MeshStandardMaterial({ color: 0x3a3e50, roughness: 0.8 }), cast: true, recv: true }], 700, 120);
    for (const p of pil) this.statics.addCircle(p.x, p.z, 1.3, 'post');
  }

  buildTokyoDecor(signs, lines, S, H, W, rnd) {
    const TS = TX.tokyoSignTextures();
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4();
    const sideOff = (s, off) => [[0, s.d / 2 + off, 0], [s.w / 2 + off, 0, Math.PI / 2], [0, -s.d / 2 - off, Math.PI], [-s.w / 2 - off, 0, -Math.PI / 2]][s.side];
    const groups = new Map();
    for (const s of signs) { const key = (s.vert ? 'v' : 'h') + s.k; (groups.get(key) || groups.set(key, []).get(key)).push(s); }
    for (const [key, list] of groups) {
      const vert = key[0] === 'v', tex = (vert ? TS.vert : TS.horiz)[+key.slice(1)];
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.9, 1.9, 1.9), side: THREE.FrontSide, fog: true }); // front only: from behind the text would read mirrored
      const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, list.length);
      list.forEach((s, i) => {
        const o = sideOff(s, 0.35); q.setFromAxisAngle(up, o[2]);
        const w = s.big ? Math.min(34, (s.side % 2 ? s.d : s.w) * 0.85) : vert ? 3 : 12 + (i % 3) * 3, h = s.big ? 17 : vert ? 12 + (i % 3) * 3 : 6 + (i % 3) * 1.5;
        m4.compose(new THREE.Vector3(s.x + o[0], s.y + h / 2, s.z + o[1]), q, new THREE.Vector3(w, h, 1)); im.setMatrixAt(i, m4);
      });
      im.computeBoundingSphere(); this.root.add(im);
    }
    // paper lanterns strung along streets (red / orange emissive spheres, chunked + culled)
    const lan = [];
    for (const c of lines) for (let t = -H + 12; t <= H - 12; t += 24) {
      if (rnd() < 0.35) continue;
      const side = rnd() < 0.5 ? -1 : 1;
      lan.push({ x: t, z: c + side * (W + 0.8), ang: 0 }); if (rnd() < 0.5) lan.push({ x: c + side * (W + 0.8), z: t, ang: 0 });
    }
    const lg = new THREE.SphereGeometry(0.45, 10, 8); lg.scale(1, 1.25, 1); lg.translate(0, 5.2, 0);
    const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.45, 0.25) });
    const pole = new THREE.CylinderGeometry(0.05, 0.05, 5.2, 5); pole.translate(0, 2.6, 0);
    this.cityProps(lan, [{ geo: lg, mat: lm }, { geo: pole, mat: new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.6 }) }], 260, 120);
    // vending machines / konbini glow boxes at corners
    const vend = [];
    for (const x of lines) for (const z of lines) if (rnd() < 0.5) vend.push({ x: x + (W + 2.2), z: z + (W + 2.2), ang: rnd() * 6.28 });
    const vg = new THREE.BoxGeometry(1, 2, 0.8); vg.translate(0, 1, 0);
    this.cityProps(vend, [{ geo: vg, mat: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.4, 3.0) }) }], 200, 120);
  }

  // Instanced props split into CxC chunks; each chunk is distance-culled in update() (cullDist from the focus car).
  cityProps(list, parts, cullDist, C) {
    this.cityChunks ||= [];
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), m = new THREE.Matrix4(), p = new THREE.Vector3();
    const buckets = new Map();
    for (const l of list) { const k = Math.floor(l.x / C) * 1000 + Math.floor(l.z / C); let b = buckets.get(k); if (!b) buckets.set(k, (b = { items: [], cx: (Math.floor(l.x / C) + 0.5) * C, cz: (Math.floor(l.z / C) + 0.5) * C })); b.items.push(l); }
    for (const b of buckets.values()) {
      const ims = parts.map((pt) => { const im = new THREE.InstancedMesh(pt.geo, pt.mat, b.items.length); im.castShadow = !!pt.cast; im.receiveShadow = !!pt.recv; return im; });
      b.items.forEach((l, i) => { q.setFromAxisAngle(up, l.ang); m.compose(p.set(l.x, 0.3, l.z), q, one); for (const im of ims) im.setMatrixAt(i, m); });
      for (const im of ims) { im.computeBoundingSphere(); this.root.add(im); }
      this.cityChunks.push({ cx: b.cx, cz: b.cz, ims, d: cullDist + C * 0.71, on: true });
    }
  }

  buildingMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0, envMapIntensity: 1.0 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
        attribute vec2 aSeed; varying vec2 vSeed; varying vec3 vBW; varying vec3 vBN;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 bwp = vec4(transformed, 1.0);
        vec3 bn = normal;
        #ifdef USE_INSTANCING
          bwp = instanceMatrix * bwp;
          bn = mat3(instanceMatrix) * bn;
        #endif
        vBW = (modelMatrix * bwp).xyz; vBN = bn; vSeed = aSeed;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
        varying vec2 vSeed; varying vec3 vBW; varying vec3 vBN;
        float bhash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 bN = normalize(vBN);
        float isWall = 1.0 - step(0.5, abs(bN.y));
        vec2 tg = normalize(vec2(-bN.z, bN.x) + 1e-5);
        float bu = dot(vBW.xz, tg);
        float bv = vBW.y;
        float glassy = step(0.75, vSeed.y);
        float cw = mix(1.5, 2.0, fract(vSeed.y * 7.0));
        vec2 cell = vec2(bu / cw, bv / 3.1);
        vec2 fw = fract(cell); vec2 wid = floor(cell);
        float mx = mix(0.22, 0.07, glassy), my = mix(0.26, 0.08, glassy);
        float win = step(mx, fw.x) * step(fw.x, 1.0 - mx) * step(my, fw.y) * step(fw.y, 1.0 - my * 0.6) * step(4.6, bv) * isWall;
        float bRnd = bhash(wid + vSeed.x * 91.7);
        float bLit = step(0.66 - glassy * 0.12, bRnd) * win * step(vSeed.y, 0.99);
        vec3 glassCol = mix(vec3(0.025, 0.035, 0.055), vec3(0.045, 0.075, 0.1), glassy) * (0.8 + 0.4 * bhash(wid + 7.7));
        diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, win);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.4 + 0.05, 1.0 - isWall);
        float bShop = isWall * step(bv, 4.1) * step(0.9, bv) * step(vSeed.y, 0.99);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02), bShop);
        float bWin = win;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.16, max(bWin, bShop));`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 warm = mix(vec3(1.0, 0.7, 0.4), vec3(0.7, 0.85, 1.0), step(0.86, bRnd));
        totalEmissiveRadiance += warm * bLit * (${this.mapId === 'tokyo' ? '0.16 + bRnd * 0.34' : '0.02 + bRnd * 0.1'});
        vec3 shopCol = mix(vec3(1.0, 0.55, 0.25), vec3(0.35, 0.75, 1.0), fract(vSeed.x * 13.0));
        totalEmissiveRadiance += shopCol * bShop * ${this.mapId === 'tokyo' ? '2.4' : '1.4'} * step(0.25, fract(bu * 0.07 + vSeed.x));`);
    };
    return m;
  }

  // ---------------- Nature ----------------
  buildNature() {
    const rnd = mulberry32(8080);
    const nz = makeNoise2D(3131);
    const pines = [], broads = [], rocks = [];
    for (let k = 0; k < 60000 && pines.length + broads.length < 9000; k++) {
      const x = (rnd() * 2 - 1) * 1980, z = (rnd() * 2 - 1) * 1980;
      if (Math.abs(x) < 660 && Math.abs(z) < 660) continue;
      const h = this.hf.get(x, z);
      if (h < WATER_LEVEL + 1.5 || h > 240) continue;
      if (this.hf.roadDist(x, z) < 9) continue;
      const dens = fbm(nz, x / 260, z / 260, 3) * 0.5 + 0.5;
      if (rnd() > smoothstep(0.35, 0.75, dens) * 0.95 + 0.03) continue;
      const tmp = new THREE.Vector3(); this.hf.normal(x, z, tmp);
      if (tmp.y < 0.8) { if (rnd() < 0.1) rocks.push({ x, z, h, s: 1 + rnd() * 3 }); continue; }
      const s = 0.8 + rnd() * 0.8;
      if (h > 60 || rnd() < 0.45) pines.push({ x, z, h, s }); else broads.push({ x, z, h, s });
    }
    for (let k = 0; k < 900; k++) {
      const x = (rnd() * 2 - 1) * 1950, z = (rnd() * 2 - 1) * 1950;
      if (Math.abs(x) < 660 && Math.abs(z) < 660) continue;
      const h = this.hf.get(x, z);
      if (h < WATER_LEVEL || this.hf.roadDist(x, z) < 8) continue;
      rocks.push({ x, z, h, s: 0.8 + rnd() * 2.8 });
    }
    for (const t of this.cityTrees) broads.push({ x: t.x, z: t.z, h: 0.3, s: t.s, city: true });

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    // build instanced meshes split into spatial chunks so frustum/shadow culling works
    const chunked = (list, geos, mats, setup, cast) => {
      const CH = 700;
      const buckets = new Map();
      for (const t of list) { const k = Math.floor(t.x / CH) * 1000 + Math.floor(t.z / CH); let b = buckets.get(k); if (!b) buckets.set(k, (b = [])); b.push(t); }
      for (const b of buckets.values()) {
        const ims = geos.map((g, i) => new THREE.InstancedMesh(g, mats[i], b.length));
        b.forEach((t, i) => { setup(t, m4); for (const im of ims) im.setMatrixAt(i, m4); if (t.col) { ims[ims.length - 1].setColorAt(i, t.col); } });
        for (const im of ims) { im.castShadow = cast; im.receiveShadow = true; im.computeBoundingSphere(); this.root.add(im); }
      }
    };
    // High-detail trees: 3 hand-grown variants per species (bark-textured trunks + alpha-cut needle / leaf cards), instanced per spatial chunk.
    for (const t of pines) { t.rot = rnd() * 6.28; t.v = Math.floor(rnd() * 3); t.sy = t.s * (0.9 + rnd() * 0.4); t.tint = new THREE.Color().setHSL(0.26 + rnd() * 0.07, 0.35 + rnd() * 0.2, 0.78 + rnd() * 0.18); this.statics.addCircle(t.x, t.z, 0.5 * t.s, 'tree'); }
    for (const t of broads) { t.rot = rnd() * 6.28; t.v = Math.floor(rnd() * 3); t.tint = new THREE.Color().setHSL(0.2 + rnd() * 0.1, 0.45 + rnd() * 0.25, 0.62 + rnd() * 0.2); if (!t.city) this.statics.addCircle(t.x, t.z, 0.45 * t.s, 'tree'); }
    const CH = 350;
    this.treeChunks = [];
    const plant = (list, variants, barkMat, leafMat, yScale, lodGeo) => {
      const buckets = new Map();
      for (const t of list) { const k = Math.floor(t.x / CH) * 1000 + Math.floor(t.z / CH); let bk = buckets.get(k); if (!bk) buckets.set(k, (bk = { items: [], cx: (Math.floor(t.x / CH) + 0.5) * CH, cz: (Math.floor(t.z / CH) + 0.5) * CH })); bk.items.push(t); }
      for (const bk of buckets.values()) {
        const hi = [], lo = [];
        // one trunk+foliage instanced pair per variant (hi) and a single cheap mesh (lo) per chunk
        for (let v = 0; v < variants.length; v++) {
          const items = bk.items.filter((t) => t.v === v); if (!items.length) continue;
          const tr = new THREE.InstancedMesh(variants[v].trunk, barkMat, items.length), fo = new THREE.InstancedMesh(variants[v].foliage, leafMat, items.length);
          items.forEach((t, i) => { q.setFromAxisAngle(up, t.rot); sc.set(t.s, yScale(t), t.s); p.set(t.x, t.h - 0.25, t.z); m4.compose(p, q, sc); tr.setMatrixAt(i, m4); fo.setMatrixAt(i, m4); fo.setColorAt(i, t.tint); });
          tr.castShadow = true; tr.receiveShadow = true; fo.castShadow = true; fo.receiveShadow = false;
          for (const im of [tr, fo]) { im.computeBoundingSphere(); im.visible = false; this.root.add(im); hi.push(im); }
          fo.instanceColor.needsUpdate = true;
        }
        const lm = new THREE.InstancedMesh(lodGeo, ENV.lodMat, bk.items.length);
        bk.items.forEach((t, i) => { q.setFromAxisAngle(up, t.rot); sc.set(t.s, yScale(t), t.s); p.set(t.x, t.h - 0.25, t.z); m4.compose(p, q, sc); lm.setMatrixAt(i, m4); lm.setColorAt(i, t.tint.clone().multiplyScalar(1.5)); });
        lm.castShadow = false; lm.receiveShadow = true; lm.computeBoundingSphere(); this.root.add(lm); lo.push(lm);
        this.treeChunks.push({ cx: bk.cx, cz: bk.cz, hi, lo, state: -1 });
      }
    };
    plant(pines, ENV.pines, ENV.pineBark, ENV.pineMat, (t) => t.sy, ENV.lodPine);
    plant(broads, ENV.broads, ENV.broadBark, ENV.broadMat, (t) => t.s, ENV.lodBroad);
    // rocks + boulders: decimated Poly Haven scans (two sources, random rotation / squash)
    for (const r of rocks) {
      r.e = new THREE.Euler((rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5); r.big = r.s > 1.7; const k = r.s * (r.big ? 1.1 : 0.9);
      r.sc = new THREE.Vector3(k * (0.85 + rnd() * 0.4), k * (0.6 + rnd() * 0.5), k * (0.85 + rnd() * 0.4));
      if (r.s > 1.2) this.statics.addCircle(r.x, r.z, r.s * 0.7, 'rock');
    }
    this.propChunks = [];
    const scatter = (list, prop, cullDist = 0, cast = !cullDist) => {
      const C = cullDist ? 300 : CH, buckets = new Map();
      for (const r of list) { const k = Math.floor(r.x / C) * 1000 + Math.floor(r.z / C); let bk = buckets.get(k); if (!bk) buckets.set(k, (bk = { items: [], cx: (Math.floor(r.x / C) + 0.5) * C, cz: (Math.floor(r.z / C) + 0.5) * C })); bk.items.push(r); }
      for (const bk of buckets.values()) {
        const ims = prop.parts.map((part) => new THREE.InstancedMesh(part.geo, part.mat, bk.items.length));
        bk.items.forEach((r, i) => { q.setFromEuler(r.e); p.set(r.x, r.h - 0.1 * r.sc.y, r.z); m4.compose(p, q, r.sc); for (const im of ims) im.setMatrixAt(i, m4); });
        for (const im of ims) { im.castShadow = cast; im.receiveShadow = true; im.computeBoundingSphere(); this.root.add(im); }
        if (cullDist) this.propChunks.push({ cx: bk.cx, cz: bk.cz, ims, d: cullDist, on: true });
      }
    };
    // perf: scan rocks are ~2k tris each; small rocks vanish past ~450 m, boulders past ~750 m (fog hides both), still casting near the car
    scatter(rocks.filter((r) => !r.big), ENV.rock, 300, true); scatter(rocks.filter((r) => r.big), ENV.boulder, 600, true);
    // undergrowth: shrubs + ferns near trees (denser under broadleaf / lowland), instanced per chunk, no collision
    {
      const under = [], ferns = [];
      const near = [...pines, ...broads].filter((t) => !t.city);
      for (let i = 0; i < near.length; i += 5) {
        const t = near[i], n = 1 + Math.floor(rnd() * 2);
        for (let k = 0; k < n; k++) {
          const a = rnd() * 6.28, d = 2.5 + rnd() * 7, x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
          if (this.hf.roadDist(x, z) < 6) continue; const h = this.hf.get(x, z); if (h < WATER_LEVEL + 1.5) continue;
          const o = { x, z, h, e: new THREE.Euler(0, rnd() * 6.28, 0), sc: new THREE.Vector3(0, 0, 0) }; // (o used below)
          const sz = 0.7 + rnd() * 1.1; o.sc.set(sz, sz * (0.8 + rnd() * 0.5), sz);
          (rnd() < 0.55 ? ferns : under).push(o);
        }
      }
      scatter(under, ENV.shrub, 280); scatter(ferns, ENV.fern, 200);
    }

  }

  // ---------------- Minimap ----------------
  buildMinimap() {
    const S = 2048, sc = S / (WORLD_HALF * 2);
    const c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S / 4, S / 4);
    for (let j = 0; j < S / 4; j++) for (let i = 0; i < S / 4; i++) {
      const x = (i * 4) / sc - WORLD_HALF, z = (j * 4) / sc - WORLD_HALF;
      const h = this.hf.get(x, z);
      const k = (j * (S / 4) + i) * 4;
      if (h < WATER_LEVEL) { img.data[k] = 10; img.data[k + 1] = 30; img.data[k + 2] = 52; }
      else { const v = clamp(26 + h * 0.18, 20, 90); img.data[k] = v * 0.8; img.data[k + 1] = v; img.data[k + 2] = v * 0.85; }
      img.data[k + 3] = 255;
    }
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = S / 4; tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 0, 0, S, S);
    const tx = (x) => (x + WORLD_HALF) * sc;
    // city blocks
    ctx.fillStyle = this.mapId === 'tokyo' ? '#1a1830' : '#2b3036';
    ctx.fillRect(tx(-612), tx(-612), 1224 * sc, 1224 * sc);
    ctx.fillStyle = '#15181c';
    for (let i = -CITY_HALF; i < CITY_HALF; i += STREET_SPACING) for (let j = -CITY_HALF; j < CITY_HALF; j += STREET_SPACING)
      ctx.fillRect(tx(i + 10), tx(j + 10), 100 * sc, 100 * sc);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const r of this.net.roads) {
      ctx.strokeStyle = this.mapId === 'tokyo' ? (r.kind === 'highway' ? '#ff4fb4' : '#3fd8ff') : (r.kind === 'highway' ? '#8f9aa6' : '#727c86');
      ctx.lineWidth = r.halfW * 2 * sc * 1.2;
      ctx.beginPath();
      r.pts.forEach((p, i) => (i ? ctx.lineTo(tx(p.x), tx(p.z)) : ctx.moveTo(tx(p.x), tx(p.z))));
      if (r.closed) ctx.closePath();
      ctx.stroke();
    }
    this.minimapCanvas = c;
    this.minimapScale = sc;
  }

  update(dt, t) {
    globalUniforms.time.value = t;
    for (const u of this.updaters) u(dt, t);
    const f = this.focus;
    if (f && this.propChunks) for (const c of this.propChunks) { const on = Math.hypot(c.cx - f.x, c.cz - f.z) < c.d + 150; if (on !== c.on) { c.on = on; for (const m of c.ims) m.visible = on; } }
    if (f && this.cityChunks) for (const c of this.cityChunks) { const on = Math.hypot(c.cx - f.x, c.cz - f.z) < c.d; if (on !== c.on) { c.on = on; for (const m of c.ims) m.visible = on; } }
    // tree LOD: full-detail trees only near the camera; far chunks use cheap vertex-coloured trees
    if (f && this.treeChunks) for (const c of this.treeChunks) {
      const d = Math.hypot(c.cx - f.x, c.cz - f.z), want = d < 330 ? 1 : 0;
      if (want !== c.state) { c.state = want; for (const m of c.hi) m.visible = !!want; for (const m of c.lo) m.visible = !want; }
    }
  }
}
