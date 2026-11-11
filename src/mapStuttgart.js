// ===== Stuttgart map: blue-hour sky + Fernsehturm / Schloss landmarks =====
import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import * as TX from './textures.js';

/** Blue-hour dusk dome — cool zenith, warm sodium/amber horizon over the Kessel. */
export function buildStuttgartSky(scene, renderer, world) {
  const elev = THREE.MathUtils.degToRad(6.5), az = THREE.MathUtils.degToRad(-125);
  const sun = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elev, az);
  world.sunDir = sun.clone();

  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: sun.clone() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uSun;
      void main(){
        float y = clamp(vDir.y, 0.0, 1.0);
        vec3 zenith = vec3(0.02, 0.045, 0.12);
        vec3 mid = vec3(0.06, 0.08, 0.16);
        vec3 hor = mix(vec3(0.55, 0.22, 0.12), vec3(0.18, 0.28, 0.48), 0.45 + 0.35 * vDir.x);
        hor += vec3(0.18, 0.06, 0.02) * pow(1.0 - y, 2.5);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.28, y));
        col = mix(col, zenith, smoothstep(0.22, 0.8, y));
        float sd = max(dot(normalize(vDir), normalize(uSun)), 0.0);
        col += vec3(0.55, 0.28, 0.12) * pow(sd, 8.0) * 0.7;
        col += vec3(1.3, 0.75, 0.35) * pow(sd, 40.0) * 0.85;
        col += vec3(1.8, 1.35, 0.85) * smoothstep(0.997, 0.9995, sd);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(19000, 32, 20), domeMat);
  scene.add(dome);
  world.sky = dome;

  // Soft dusk starfield (dim — blue hour, not midnight)
  const starCnt = 700;
  const starPos = new Float32Array(starCnt * 3);
  const starCol = new Float32Array(starCnt * 3);
  for (let i = 0; i < starCnt; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(0.2 + Math.random() * 0.8);
    const r = 17500;
    starPos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
    starPos[i * 3 + 1] = Math.cos(ph) * r;
    starPos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
    const b = 0.25 + Math.random() * 0.4;
    starCol[i * 3] = b; starCol[i * 3 + 1] = b * 0.95; starCol[i * 3 + 2] = b * 1.05;
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  sGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.55,
    fog: false, depthWrite: false, map: TX.glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 32), alphaTest: 0.02,
  })));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 16), domeMat));
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: 0x1a1814 }));
  gnd.rotation.x = -Math.PI / 2; gnd.position.y = -30; envScene.add(gnd);
  // Warm city-glow bands for car paint reflections
  for (const [nx, ny, nz, nw, nh, ry, nc] of [
    [0, 90, -380, 220, 70, 0, new THREE.Color(1.1, 0.55, 0.22)],
    [380, 85, 0, 200, 65, Math.PI / 2, new THREE.Color(0.8, 0.45, 0.25)],
    [0, 95, 380, 220, 70, Math.PI, new THREE.Color(0.25, 0.35, 0.8)],
    [-380, 80, 0, 200, 60, -Math.PI / 2, new THREE.Color(1.0, 0.35, 0.15)],
  ]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(nw, nh), new THREE.MeshBasicMaterial({ color: nc, side: THREE.DoubleSide }));
    m.position.set(nx, ny, nz); m.rotation.y = ry; envScene.add(m);
  }
  if (world.envMap) world.envMap.dispose();
  world.envMap = pmrem.fromScene(envScene, 0.04).texture;
  world.scene.environment = world.envMap;
  pmrem.dispose();

  world.scene.fog = new THREE.FogExp2(new THREE.Color(0.055, 0.06, 0.1), 0.0003);

  scene.add(new THREE.HemisphereLight(0x6a88c8, 0x3a2818, 0.85));
  const dl = new THREE.DirectionalLight(0xffb078, 1.35);
  dl.position.copy(sun).multiplyScalar(400);
  dl.castShadow = true;
  dl.shadow.mapSize.set(2048, 2048);
  const S = 110;
  Object.assign(dl.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 1200 });
  dl.shadow.bias = -0.0004; dl.shadow.normalBias = 0.6;
  scene.add(dl); scene.add(dl.target);
  world.sunLight = dl;

  const flareTex0 = TX.glowTexture('rgba(255,200,140,1)', 'rgba(255,120,60,0)', 256);
  const flareTex1 = TX.glowTexture('rgba(255,160,100,0.45)', 'rgba(200,80,40,0)', 128);
  const lf = new Lensflare();
  lf.addElement(new LensflareElement(flareTex0, 240, 0, new THREE.Color(0.7, 0.45, 0.28)));
  lf.addElement(new LensflareElement(flareTex1, 60, 0.55, new THREE.Color(0.35, 0.2, 0.12)));
  lf.addElement(new LensflareElement(flareTex1, 90, 0.8, new THREE.Color(0.25, 0.15, 0.3)));
  const flareHolder = new THREE.Object3D();
  flareHolder.position.copy(sun).multiplyScalar(9000);
  flareHolder.add(lf);
  scene.add(flareHolder);
  world.flare = flareHolder;
}

/** Fernsehturm needle + Neues Schloss on Schlossplatz. */
export function buildStuttgartLandmarks(world, tower, S, H, W) {
  const root = world.root;
  // ---- Fernsehturm ----
  const g = new THREE.Group();
  g.name = 'Fernsehturm';
  const concrete = new THREE.MeshStandardMaterial({ color: 0xc8c4bc, roughness: 0.55, metalness: 0.15 });
  const basketMat = new THREE.MeshStandardMaterial({
    color: 0xd8d2c8, emissive: new THREE.Color(1.6, 1.05, 0.5), emissiveIntensity: 1.15, roughness: 0.4, metalness: 0.35,
  });
  const shaftH = 210;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 5.5, shaftH, 16), concrete);
  shaft.position.y = shaftH / 2; g.add(shaft);
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(11, 13, 18, 20), basketMat);
  basket.position.y = shaftH + 2; g.add(basket);
  const basketTop = new THREE.Mesh(new THREE.CylinderGeometry(7, 11, 8, 16), basketMat);
  basketTop.position.y = shaftH + 14; g.add(basketTop);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.4, 55, 8), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.85, roughness: 0.3 }));
  mast.position.y = shaftH + 45; g.add(mast);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.8) }));
  tip.position.y = shaftH + 74; g.add(tip);
  // observation ring lights
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 2.4, 1.0) }));
    l.position.set(Math.cos(a) * 12.2, shaftH + 2, Math.sin(a) * 12.2); g.add(l);
  }
  g.position.set(tower.cx, 0.3, tower.cz);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.add(g);
  world.statics.addBox(tower.cx - 18, tower.cz - 18, tower.cx + 18, tower.cz + 18, 'block');
  const bm = new THREE.PointLight(0xffa060, 700, 200, 2); bm.position.set(tower.cx, 50, tower.cz); root.add(bm);
  world.updaters.push((_dt, t) => { tip.material.color.setRGB(4 * (0.4 + 0.6 * (Math.sin(t * 1.8) > 0 ? 1 : 0)), 2.2, 0.8); });

  // ---- Neues Schloss (palace on plaza near origin) ----
  const schloss = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xd2c4a8, roughness: 0.7, metalness: 0.05 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x3a4558, roughness: 0.55, metalness: 0.2, emissive: 0x1a2030, emissiveIntensity: 0.15 });
  const wing = (wx, wz, ww, wd, wh) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(ww, wh, wd), stone); b.position.set(wx, wh / 2, wz); schloss.add(b);
    const r = new THREE.Mesh(new THREE.BoxGeometry(ww + 1, 2.2, wd + 1), roof); r.position.set(wx, wh + 1.1, wz); schloss.add(r);
  };
  wing(0, 0, 78, 28, 18);
  wing(-48, 8, 28, 42, 16);
  wing(48, 8, 28, 42, 16);
  // colonnade suggestion
  for (let i = -5; i <= 5; i++) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 12, 8), stone);
    col.position.set(i * 6.5, 6, -15); schloss.add(col);
  }
  const ped = new THREE.Mesh(new THREE.BoxGeometry(72, 1.2, 6), stone); ped.position.set(0, 12.6, -15); schloss.add(ped);
  // warm window strip
  const win = new THREE.Mesh(new THREE.BoxGeometry(70, 2.5, 0.3), new THREE.MeshStandardMaterial({
    color: 0x22180c, emissive: new THREE.Color(1.4, 0.9, 0.4), emissiveIntensity: 1.1, roughness: 0.4,
  }));
  win.position.set(0, 9, -14.2); schloss.add(win);
  schloss.name = 'NeuesSchloss';
  schloss.position.set(-60, 0.3, -60);
  schloss.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.add(schloss);
  world.statics.addBox(-102, -102, -18, -18, 'block');

  // Warm plaza fill light
  const pl = new THREE.PointLight(0xffb070, 180, 120, 2); pl.position.set(-60, 18, -40); root.add(pl);
}
