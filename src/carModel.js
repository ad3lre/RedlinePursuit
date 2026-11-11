// ===== Procedural car models =====
import * as THREE from 'three';
import { glowTexture, softGlowTexture, textTexture } from './textures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hasGLB, getTemplate } from './carAssets.js';
import { buildTank } from './military.js';

function mergeByMaterial(group) {
  const byMat = new Map();
  for (const c of [...group.children]) {
    if (!c.isMesh) continue;
    let a = byMat.get(c.material); if (!a) byMat.set(c.material, (a = [])); a.push(c);
  }
  const out = new Map();
  for (const [mat, list] of byMat) {
    if (list.length < 2) { out.set(mat, list[0]); continue; }
    const geos = list.map((m) => { m.updateMatrix(); const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()); g.applyMatrix4(m.matrix); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; });
    const merged = mergeGeometries(geos);
    // Never drop parts on a failed merge — attribute mismatches used to erase whole glass/body groups
    if (!merged) { out.set(mat, list[0]); continue; }
    list.forEach((m) => group.remove(m));
    const mm = new THREE.Mesh(merged, mat);
    group.add(mm); out.set(mat, mm);
  }
  return out;
}

const shared = {};
function S() {
  if (shared.ready) return shared;
  // Opaque tinted glass (DoubleSide). Transparent glass + culled cabin = "missing body panels".
  shared.glass = new THREE.MeshStandardMaterial({ color: 0x12161e, metalness: 0.2, roughness: 0.28, envMapIntensity: 0.22, side: THREE.DoubleSide, depthWrite: true });
  shared.glassCheap = new THREE.MeshStandardMaterial({ color: 0x10141a, metalness: 0.15, roughness: 0.4, envMapIntensity: 0.12, side: THREE.DoubleSide, depthWrite: true });
  shared.tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 });
  shared.rim = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.22 });
  shared.darkRim = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.9, roughness: 0.3 });
  shared.black = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.6, metalness: 0.3 });
  shared.chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.1 });
  shared.head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 5.5 });
  shared.glowW = softGlowTexture(255, 248, 230, 256);
  shared.glowR = softGlowTexture(255, 36, 28, 256);
  shared.glowB = softGlowTexture(48, 110, 255, 256);
  shared.glowA = softGlowTexture(255, 160, 40, 256);
  shared.glowWCore = glowTexture('rgba(255,252,245,1)', 'rgba(255,240,210,0)', 128);
  shared.glowRCore = glowTexture('rgba(255,70,55,1)', 'rgba(255,20,10,0)', 128);
  shared.glowACore = glowTexture('rgba(255,190,60,1)', 'rgba(255,120,20,0)', 128);
  shared.policeTex = textTexture('POLICE', { bg: 'rgba(0,0,0,0)', fg: '#0a0a0a', font: 'bold 90px Arial Black, Arial', border: false });
  shared.interior = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.8 });
  shared.ready = true;
  return shared;
}

const PROFILES = {
  super: { L: 4.55, W: 1.98, roofH: 1.18, belt: 0.86, hoodFront: 0.6, wsBase: 0.45, roofF: -0.35, roofR: -1.05, rearWin: -1.85, deck: 0.92, tail: 0.86, wheelR: 0.36, wb: 1.38, spoiler: true, cabinW: 1.5 },
  gt: { L: 4.7, W: 1.96, roofH: 1.28, belt: 0.9, hoodFront: 0.66, wsBase: 0.55, roofF: -0.15, roofR: -1.0, rearWin: -1.95, deck: 0.95, tail: 0.9, wheelR: 0.37, wb: 1.45, spoiler: false, cabinW: 1.52 },
  muscle: { L: 4.8, W: 1.98, roofH: 1.34, belt: 0.98, hoodFront: 0.82, wsBase: 0.3, roofF: -0.35, roofR: -1.25, rearWin: -1.9, deck: 1.0, tail: 0.98, wheelR: 0.38, wb: 1.5, spoiler: true, cabinW: 1.55 },
  sedan: { L: 4.7, W: 1.85, roofH: 1.48, belt: 0.95, hoodFront: 0.78, wsBase: 0.85, roofF: 0.25, roofR: -1.1, rearWin: -1.7, deck: 1.0, tail: 0.98, wheelR: 0.34, wb: 1.42, spoiler: false, cabinW: 1.6 },
  suv: { L: 4.8, W: 1.95, roofH: 1.85, belt: 1.15, hoodFront: 1.0, wsBase: 1.0, roofF: 0.5, roofR: -2.1, rearWin: -2.3, deck: 1.8, tail: 1.2, wheelR: 0.42, wb: 1.5, spoiler: false, cabinW: 1.75 },
};

// kind -> glTF asset + hand-tuned profile (car-space metres, +Z forward, wheelbase centred on 0)
const GLB_MODELS = {
  super: { model: 'ferrari', L: 4.53, W: 1.98, roofH: 1.14, belt: 0.82, hoodFront: 0.92, wsBase: 0.55, roofF: -0.05, roofR: -1.0, rearWin: -1.7, deck: 0.98, tail: 0.95, spoiler: false, cabinW: 1.5, eye: { x: 0.36, y: 1.0, z: -0.12 }, head: { x: 0.66, y: 0.66, z: 2.0 }, tailL: { x: 0.68, y: 0.86, z: -2.2 } },
};
GLB_MODELS.gt = { model: 'concept', L: 4.4, W: 2.05, roofH: 1.2, belt: 0.85, hoodFront: 0.9, wsBase: 0.7, roofF: 0.0, roofR: -1.0, rearWin: -1.7, deck: 0.98, tail: 0.95, spoiler: false, cabinW: 1.5 };
GLB_MODELS.muscle = { ...GLB_MODELS.super };
// Direct model-id keys — buildCar(gid) looks up opts.model first; without these, model:'concept' fell through to kind→ferrari
GLB_MODELS.ferrari = { ...GLB_MODELS.super, model: 'ferrari', auto: true, hud: 0xcc1010 };
GLB_MODELS.concept = { ...GLB_MODELS.gt, model: 'concept', auto: true, hud: 0xc0c4c8 };
GLB_MODELS.gt3rs = { model: 'gt3rs', auto: true, hud: 0xd8d018, head: { x: 0.72, y: 0.58, z: 2.15 }, tailL: { x: 0.7, y: 0.62, z: -2.2 } };
// Tall keepTextures cabins need hand-tuned eyes — auto H*0.82 sits inside the roof.
GLB_MODELS.cybertruck = { model: 'cybertruck', auto: true, hud: 0xb8bcc2, eye: { x: 0.36, y: 1.52, z: 0.85 }, hoodEye: { x: 0, y: 1.15, z: 2.15 }, head: { x: 0.78, y: 0.72, z: 2.65 }, tailL: { x: 0.82, y: 0.95, z: -2.7 } };
GLB_MODELS.vito = { model: 'vito', auto: true, hud: 0xf2f2f2, eye: { x: 0.45, y: 1.36, z: 0.62 }, hoodEye: { x: 0, y: 1.12, z: 2.00 }, head: { x: 0.78, y: 0.78, z: 2.4 }, tailL: { x: 0.82, y: 1.05, z: -2.45 } };
GLB_MODELS.jesko = { model: 'jesko', auto: true, hud: 0xe8e8ea, head: { x: 0.7, y: 0.48, z: 2.15 }, tailL: { x: 0.55, y: 0.55, z: -2.2 } };
GLB_MODELS.mini = { model: 'mini', auto: true, hud: 0xc8102e };
GLB_MODELS.corolla = { model: 'corolla', auto: true, hud: 0xc8ccd2, head: { x: 0.7, y: 0.62, z: 2.15 }, tailL: { x: 0.68, y: 0.72, z: -2.2 } };
GLB_MODELS.model_s = { model: 'model_s', auto: true, hud: 0x1a1a1e, head: { x: 0.72, y: 0.62, z: 2.3 }, tailL: { x: 0.7, y: 0.78, z: -2.35 } };
GLB_MODELS.mclaren = { model: 'mclaren', auto: true, hud: 0xe85a00, head: { x: 0.72, y: 0.52, z: 2.15 }, tailL: { x: 0.68, y: 0.58, z: -2.15 } };
GLB_MODELS.gwagon = { model: 'gwagon', auto: true, hud: 0x1a1a1a, eye: { x: 0.42, y: 1.55, z: 0.55 }, hoodEye: { x: 0, y: 1.35, z: 2.05 }, head: { x: 0.62, y: 0.9, z: 2.25 }, tailL: { x: 0.72, y: 1.05, z: -2.25 } };
GLB_MODELS.civic = { model: 'civic', auto: true, hud: 0xc8102e, eye: { x: 0.38, y: 1.12, z: 0.35 }, hoodEye: { x: 0, y: 0.95, z: 1.75 }, head: { x: 0.68, y: 0.58, z: 1.85 }, tailL: { x: 0.65, y: 0.72, z: -1.85 } };
for (const id of ['compact', 'coupe', 'hatchback', 'minivan', 'offroad', 'pickup', 'sedan', 'sport', 'suv', 'wagon']) GLB_MODELS[id] = { model: id, auto: true, hud: { compact: 0x4cc0e0, coupe: 0x2030c0, hatchback: 0xe8d040, minivan: 0x801818, offroad: 0x2a4a20, pickup: 0x1a6a2a, sedan: 0xb0a040, sport: 0xc81818, suv: 0x202020, wagon: 0x4a90a0 }[id] };

function bodyShape(p) {
  const hl = p.L / 2;
  const s = new THREE.Shape();
  const g = 0.26, r = p.wheelR + 0.08;
  s.moveTo(-hl + 0.12, g);
  s.lineTo(-p.wb - r - 0.02, g);
  s.absarc(-p.wb, g + 0.06, r, Math.PI, 0, true);
  s.lineTo(p.wb - r, g);
  s.absarc(p.wb, g + 0.06, r, Math.PI, 0, true);
  s.lineTo(hl - 0.1, g);
  s.quadraticCurveTo(hl + 0.05, g + 0.05, hl + 0.02, g + 0.22);
  s.quadraticCurveTo(hl, p.hoodFront, hl - 0.28, p.hoodFront + 0.02);
  s.quadraticCurveTo(p.wsBase + 0.6, p.belt + 0.02, p.wsBase, p.belt + 0.04);
  s.lineTo(p.rearWin, p.belt + 0.06);
  s.quadraticCurveTo(-hl + 0.3, p.deck + 0.02, -hl + 0.05, p.tail);
  s.quadraticCurveTo(-hl - 0.04, (p.tail + g) / 2, -hl + 0.02, g + 0.12);
  s.lineTo(-hl + 0.12, g);
  return s;
}
function cabinShape(p) {
  const s = new THREE.Shape();
  s.moveTo(p.wsBase + 0.05, p.belt);
  s.quadraticCurveTo((p.wsBase + p.roofF) / 2 + 0.1, (p.belt + p.roofH) / 2 + 0.12, p.roofF, p.roofH);
  s.lineTo(p.roofR, p.roofH + 0.01);
  s.quadraticCurveTo((p.roofR + p.rearWin) / 2 - 0.1, (p.roofH + p.belt) / 2 + 0.1, p.rearWin - 0.05, p.belt + 0.04);
  s.lineTo(p.wsBase + 0.05, p.belt);
  return s;
}

function extrude(shape, width, bevel = 0.1) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 4, curveSegments: 14 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // shape x -> world z ; extrude z -> world -x
  g.computeVertexNormals();
  return g;
}

export { extrude };
export function makePaint(color, livery = 'plain', color2 = 0xffffff, cheap = false) {
  // AI/traffic: MeshStandard (no clearcoat). Player: Physical + clearcoat for the show-car look.
  const m = cheap
    ? new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.38, envMapIntensity: 0.95 })
    : new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1 });
  const u = { uC2: { value: new THREE.Color(color2) }, uLiv: { value: { plain: 0, stripe: 1, police: 2, taxi: 3, split: 4 }[livery] || 0 }, uDmg: { value: 0 } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLoc;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vLoc; uniform vec3 uC2; uniform float uLiv; uniform float uDmg;
      float dh(vec3 p){ vec3 p3 = fract(p * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }`);
    if (!cheap) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float fr = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0); totalEmissiveRadiance += diffuseColor.rgb * fr * 0.05; }`);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      float m2 = 0.0;
      if (uLiv > 0.5 && uLiv < 1.5) { float ax = abs(vLoc.x); m2 = step(0.1, ax) * step(ax, 0.26) * step(0.7, vLoc.y); }
      else if (uLiv > 1.5 && uLiv < 2.5) { m2 = step(abs(vLoc.z - 0.1), 1.05) * step(vLoc.y, 0.84) + step(1.1, vLoc.y); m2 = clamp(m2, 0.0, 1.0); }
      else if (uLiv > 2.5 && uLiv < 3.5) { m2 = step(abs(vLoc.y - 0.62), 0.05) * step(0.9, abs(vLoc.x)); }
      else if (uLiv > 3.5) { m2 = step(vLoc.y, 0.62); }
      diffuseColor.rgb = mix(diffuseColor.rgb, uC2, m2);
      float scr = dh(floor(vLoc * 18.0));
      diffuseColor.rgb *= 1.0 - uDmg * (0.55 + 0.35 * scr);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.85, uDmg * scr);`);
  };
  return m;
}

function makeWheel(r, w, rimMat) {
  const sh = S();
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18, 1), sh.tire);
  tire.rotation.z = Math.PI / 2;
  g.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.68, r * 0.68, w + 0.02, 18, 1), sh.darkRim);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, w + 0.06, 8), rimMat); hub.rotation.z = Math.PI / 2; g.add(hub);
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, r * 1.2, 0.07), rimMat);
    sp.rotation.x = (i / 5) * Math.PI;
    g.add(sp);
  }
  mergeByMaterial(g);
  return g;
}

let blurDiscTex = null;
function addHubDisc(pivot, r, side) {
  // Opaque disc in the wheel plane — open spokes otherwise read as "see-through / missing" into the wheel well
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r * 0.88, 20),
    new THREE.MeshBasicMaterial({ color: 0x0c0c0e, side: THREE.DoubleSide })
  );
  m.rotation.y = Math.PI / 2;
  m.position.x = side * 0.01;
  m.castShadow = false; m.receiveShadow = false;
  pivot.add(m);
  return m;
}
function addBlurDisc(pivot, r, side) {
  // translucent disc that fades in with speed: hides wagon-wheel strobing and reads as real spinning-wheel motion blur
  if (!blurDiscTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 8, 64, 64, 62); gr.addColorStop(0, 'rgba(70,72,78,0.9)'); gr.addColorStop(0.55, 'rgba(40,41,45,0.95)'); gr.addColorStop(0.92, 'rgba(14,14,16,1)'); gr.addColorStop(1, 'rgba(14,14,16,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); blurDiscTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.CircleGeometry(r * 0.97, 28), new THREE.MeshBasicMaterial({ map: blurDiscTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.rotation.y = Math.PI / 2; m.position.x = side * 0.14; m.visible = false; m.castShadow = false; m.renderOrder = 2;
  pivot.add(m); return m;
}

function sprite(tex, size, color = 0xffffff, opacity = 1) {
  const m = new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true, opacity });
  const s = new THREE.Sprite(m); s.scale.set(size, size, 1);
  s.userData.baseScale = size; s.userData.baseOpacity = opacity;
  return s;
}
// Lamp glare sprite that never slices into the ground / bodywork: the billboard is pulled toward the camera before the
// depth test (so the half that would sit "inside" the road/bumper isn't cut off with a hard horizontal edge), and the
// glow fades out when the lamp itself is hidden behind geometry is handled by the core staying depth-tested.
function glareSprite(tex, size, color, opacity, pull) {
  const m = new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true, opacity });
  // pull is a compile-time constant (2 variants total), so the program is shared across all cars
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('gl_Position = projectionMatrix * mvPosition;',
      // move the billboard toward the camera by up to `pull` metres (never past the near plane)
      `mvPosition.xyz *= max(0.05, 1.0 - ${pull.toFixed(2)} / max(0.1, length(mvPosition.xyz)));\n gl_Position = projectionMatrix * mvPosition;`);
  };
  m.customProgramCacheKey = () => 'glare' + pull;
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, 1); s.userData.baseScale = size; s.userData.baseOpacity = opacity;
  return s;
}

/** Layered lamp flare: tight hot core + soft bloom halo. kind: 'head' | 'tail'. sparse=true → core only (AI/traffic). */
function addLampFlare(body, pos, kind, heads, sparse = false) {
  const sh = S();
  const isHead = kind === 'head';
  const coreCol = isHead ? 0xfff8ec : 0xff6048;
  const core = sprite(isHead ? sh.glowWCore : sh.glowRCore, isHead ? 0.55 : 0.38, coreCol, isHead ? 0.95 : 0.85);
  core.position.copy(pos); core.userData.lamp = kind; core.userData.layer = 'core';
  core.userData.baseColor = coreCol;
  body.add(core); heads.push(core);
  if (sparse) return;
  // halo/bloom are big soft billboards around a lamp ~0.6 m off the road: depth-tested in place they were cut by the
  // asphalt and the bumper (hard horizontal edge = "cheap asset" look). Pulled toward the camera instead + smaller.
  const haloCol = isHead ? 0xffe8c8 : 0xff2a18;
  const halo = glareSprite(isHead ? sh.glowW : sh.glowR, isHead ? 1.5 : 1.15, haloCol, isHead ? 0.38 : 0.45, 1.2);
  halo.position.copy(pos); halo.userData.lamp = kind; halo.userData.layer = 'halo';
  halo.userData.baseColor = haloCol;
  body.add(halo); heads.push(halo);
  if (isHead) {
    const bloomCol = 0xffd9a0;
    const bloom = glareSprite(sh.glowW, 2.6, bloomCol, 0.12, 2.0);
    bloom.position.copy(pos); bloom.userData.lamp = kind; bloom.userData.layer = 'bloom';
    bloom.userData.baseColor = bloomCol;
    body.add(bloom); heads.push(bloom);
  }
}

/** Tag a body lamp mesh so blinkers pulse its emissive — never floating sprites outside the car. */
function tagSignalMesh(mesh, side, signals) {
  if (!mesh?.material || mesh.isSprite) return;
  let mat = mesh.material;
  // Clone so L/R (and cars sharing a palette mat) can blink independently
  if (!mat.userData?._signalOwned) {
    mat = mat.clone();
    mat.userData = { ...(mesh.material.userData || {}), _signalOwned: true };
    mesh.material = mat;
  }
  if (!mat.emissive) mat.emissive = new THREE.Color(0x000000);
  if (mat.userData.baseEm == null) mat.userData.baseEm = mat.emissiveIntensity ?? 1;
  if (mat.userData.baseEmColor == null) mat.userData.baseEmColor = mat.emissive.getHex();
  mesh.userData.signalSide = side;
  if (!signals[side].includes(mat)) signals[side].push(mat);
}

/**
 * Collect side lamp materials from the car body (GLB light meshes / procedural head+tail boxes).
 * Full-width light bars are skipped — they can't signal left vs right.
 */
function signalsFromBody(body) {
  const signals = { L: [], R: [] };
  body.traverse((o) => {
    if (!o.isMesh || !o.material || o.isSprite) return;
    if (o.userData.signalSide === 'L' || o.userData.signalSide === 'R') {
      tagSignalMesh(o, o.userData.signalSide, signals);
      return;
    }
    const n = `${o.material.name || ''} ${o.name || ''}`;
    if (!/light|tail|lamp|head|luz|optik|SLight|indicator|blink|signal|turn/i.test(n)) return;
    if (/glass|window|vidrios|windshield|paint|body|tire|tyre|chrome|rim|llanta/i.test(n) && !/light|lamp|tail|head|optik|SLight|indicator|blink|signal/i.test(n)) return;
    if (!o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    if (!bb) return;
    const cx = (bb.min.x + bb.max.x) * 0.5 + o.position.x;
    const span = bb.max.x - bb.min.x;
    if (span > 1.15 && Math.abs(cx) < 0.2) return; // centre light bar
    tagSignalMesh(o, cx < 0 ? 'L' : 'R', signals);
  });
  return (signals.L.length || signals.R.length) ? signals : null;
}

/** Small amber corner markers on procedural cars — part of the body, not billboards. */
function addCornerBlinkers(body, p, headY, headZ, tailY, hl, signals) {
  const mk = (sx, y, z) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a1800, emissive: 0xffa018, emissiveIntensity: 0.15, roughness: 0.35, metalness: 0.1,
    });
    mat.userData._signalOwned = true;
    mat.userData.baseEm = 0.15;
    mat.userData.baseEmColor = 0xffa018;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.06), mat);
    m.position.set(sx * (p.W / 2 - 0.18), y, z);
    m.userData.signalSide = sx < 0 ? 'L' : 'R';
    m.castShadow = false; m.receiveShadow = false;
    body.add(m);
    signals[m.userData.signalSide].push(mat);
  };
  for (const sx of [-1, 1]) {
    mk(sx, headY, headZ + 0.02);
    mk(sx, tailY, -hl - 0.01);
  }
}

function addPoliceGear(body, p, hl, siren) {
  const sh = S();
  // police light bar + decals
  {
    const barY = (p.roofH || 1.3) + 0.14;
    const barZ = ((p.roofF ?? 0) + (p.roofR ?? -1)) / 2;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.3), sh.black); base.position.set(0, barY, barZ); body.add(base);
    const rMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff0000, emissiveIntensity: 0 });
    const bMat = new THREE.MeshStandardMaterial({ color: 0x000040, emissive: 0x0030ff, emissiveIntensity: 0 });
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.12, 0.26), rMat); r.position.set(0.32, barY + 0.08, barZ); body.add(r);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.12, 0.26), bMat); b.position.set(-0.32, barY + 0.08, barZ); body.add(b);
    const rs = sprite(sh.glowR, 6.5, 0xffffff, 0.9); rs.position.set(0.35, barY + 0.15, barZ); body.add(rs);
    const bs = sprite(sh.glowB, 6.5, 0xffffff, 0.9); bs.position.set(-0.35, barY + 0.15, barZ); body.add(bs);
    // grille strobes
    const rs2 = sprite(sh.glowR, 2.2, 0xffffff, 0.85); rs2.position.set(0.3, 0.45, hl + 0.1); body.add(rs2);
    const bs2 = sprite(sh.glowB, 2.2, 0xffffff, 0.85); bs2.position.set(-0.3, 0.45, hl + 0.1); body.add(bs2);
    Object.assign(siren, { rMat, bMat, rs, bs, rs2, bs2 });
    // POLICE text
    for (const sx of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshStandardMaterial({ map: sh.policeTex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }));
      d.position.set(sx * (p.W / 2 + 0.005), 0.58, 0.1); d.rotation.y = sx * Math.PI / 2; body.add(d);
    }
  }
}


function buildGLBCar(kind, opts) {
  const sh = S();
  const cfg = { ...GLB_MODELS[kind] };
  const T = getTemplate(cfg.model, opts.lod === 'lo' ? 'lo' : 'hi') || getTemplate(cfg.model, 'hi');
  const handEye = cfg.eye, handHood = cfg.hoodEye;
  if (cfg.auto) { // derive the hand-tuned profile numbers from the model's own bounds
    const H = T.size.y, Lz = T.size.z;
    // Eye sits near belt height, slightly forward of centre — H*0.82 was burying tall vans/trucks in the roof.
    const belt = H * 0.62;
    Object.assign(cfg, { L: Lz, W: T.size.x, roofH: H, belt, hoodFront: H * 0.55, wsBase: Lz * 0.12, roofF: Lz * 0.04, roofR: -Lz * 0.26, rearWin: -Lz * 0.38, deck: H * 0.6, tail: H * 0.6, spoiler: false, cabinW: T.size.x * 0.8, eye: { x: T.size.x * 0.18, y: belt + (H - belt) * 0.28, z: Lz * 0.06 } });
  }
  if (handEye) cfg.eye = handEye;
  if (handHood) cfg.hoodEye = handHood;
  const p = { ...cfg, wheelR: T.wheelR, wb: (T.frontZ - T.rearZ) / 2 };
  // Prefer a real steering-wheel pivot when we didn't hand-tune the eye (driver seat ≈ wheel + offset).
  if (!handEye && T.steer) p.eye = { x: T.steer.center.x, y: T.steer.center.y + 0.12, z: T.steer.center.z - 0.48 };
  p.L = T.size.z; p.W = cfg.auto ? T.size.x : Math.min(T.size.x, cfg.W + 0.1);
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
  const cheap = opts.lod === 'lo';
  const paint = makePaint(opts.color ?? 0xcc1010, opts.livery || 'plain', opts.color2 ?? 0xffffff, cheap);
  // DoubleSide: several hero GLBs have mixed winding on doors/skirts; FrontSide made panels vanish
  paint.side = THREE.DoubleSide;
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1810, emissiveIntensity: 1.6, transparent: true, opacity: 0.92, roughness: 0.18, depthWrite: true });
  const D = T.def;
  const dmgMats = [];
  const glassMat = cheap ? sh.glassCheap : sh.glass;
  const pick = (mat) => {
    const mn = mat.name || '';
    if (D.paintMat && D.paintMat.test(mn)) return paint;
    if (D.tailMat && D.tailMat.test(mn)) return tailMat;
    // Only remap real glass — transmission on grilles/badges must not become windshield material
    if (D.glassMat && D.glassMat.test(mn)) return glassMat;
    if ((mat.transmission > 0 || mat.transparent) && /glass|window|vidrios|windshield|windscreen|lightglass/i.test(mn)) return glassMat;
    if (D.keepTextures && opts.police && /^Body/i.test(mn)) return paint; // police livery repaints the body
    if (D.keepTextures && /^Body/i.test(mn)) { const c = mat.clone(); dmgMats.push(c); return c; } // own copy so crash damage can darken just this car
    return mat;
  };
  let glassMesh = null;
  // Exterior shell meshes get hidden in cockpit (same idea as procedural cars hiding the body) so the camera isn't buried in double-sided body/roof.
  const cockpitHide = D.cockpitHide || /^(Bodyl?|Plastic|Chrome(_Matte|_red)?|rubber_exterior|underside|Fake_tails|COOPER2?$|cromo|bajo|parrilla)/i;
  const cockpitKeep = D.glassMat || /glass|vidrios|interior|int\b|luz|Light|tire|llanta|rin|disk|steer/i;
  for (const it of T.body) {
    const m = new THREE.Mesh(it.geo, pick(it.mat)); body.add(m);
    const mn = it.mat.name || '';
    if (D.glassMat && D.glassMat.test(mn)) glassMesh = m;
    if (cockpitHide.test(mn) && !cockpitKeep.test(mn)) m.userData.cockpitHide = true;
  }
  // pick() remaps many mats onto shared paint/glass/tail — collapse duplicate material refs into one draw each
  mergeByMaterial(body);
  glassMesh = [...body.children].find((c) => c.isMesh && c.material === glassMat) || glassMesh;
  // Force every remapped/kept glass mesh fully opaque + depth-writing (authored BLEND glass otherwise punches holes)
  for (const c of body.children) {
    if (!c.isMesh || !c.material) continue;
    const mn = c.material.name || '';
    const isG = c.material === glassMat || (D.glassMat && D.glassMat.test(mn)) || /glass|window|vidrios|windshield|windscreen|lightglass/i.test(mn);
    if (!isG) continue;
    c.material.transparent = false;
    c.material.opacity = 1;
    c.material.transmission = 0;
    c.material.depthWrite = true;
    c.material.side = THREE.DoubleSide;
    c.material.needsUpdate = true;
  }
  // Hi-only occluders for authored body cutouts (side intakes / open arches / mid-engine bays)
  if (!cheap) {
    const black = new THREE.MeshBasicMaterial({ color: 0x050506, side: THREE.DoubleSide });
    const wb = Math.max(0.9, p.wb || p.L * 0.28);
    const hx = Math.max(0.55, p.W * 0.38);
    const modelId = (cfg.model || '').toLowerCase();
    // Deep cavity liners only — never sit on the outer shell (that paints black rectangles over doors).
    // 720S intakes are meant to look open; we only block see-through to asphalt / the far side.
    const liner = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.35, roughness: 0.72, envMapIntensity: 0.15, side: THREE.DoubleSide });
    if (modelId === 'mclaren') {
      // Keep |x| well inside the shell (~±1.07) so liners never punch black triangles through door paint
      for (const sx of [-1, 1]) {
        const duct = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 1.8), liner);
        duct.position.set(sx * 0.38, 0.48, -0.1);
        duct.castShadow = false; duct.receiveShadow = false;
        duct.userData.cockpitHide = true;
        body.add(duct);
        const sill = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 1.8), liner);
        sill.position.set(sx * 0.5, 0.22, -0.15);
        sill.castShadow = false; sill.receiveShadow = false;
        body.add(sill);
        const pocketR = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.42, 0.8), liner);
        pocketR.position.set(sx * 0.48, 0.38, -wb * 0.48);
        pocketR.castShadow = false; pocketR.receiveShadow = false;
        body.add(pocketR);
        const pocketF = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.45, 0.85), liner);
        pocketF.position.set(sx * 0.48, 0.4, wb * 0.48);
        pocketF.castShadow = false; pocketF.receiveShadow = false;
        body.add(pocketF);
        // Rear rocker / intake cutout only (z < -0.35) — mid-door stays paint.
        // Keep plugs inset so they read as cavity depth, not painted boxes on the door.
        const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 1.05), liner);
        rocker.position.set(sx * 0.78, 0.34, -0.55);
        rocker.castShadow = false; rocker.receiveShadow = false;
        body.add(rocker);
        const intake = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.48, 1.0), liner);
        intake.position.set(sx * 0.62, 0.46, -0.52);
        intake.castShadow = false; intake.receiveShadow = false;
        body.add(intake);
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.28, 0.85), liner);
        skirt.position.set(sx * 0.82, 0.18, -0.38);
        skirt.castShadow = false; skirt.receiveShadow = false;
        body.add(skirt);
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.7), liner);
        bridge.position.set(sx * 0.74, 0.52, -0.42);
        bridge.castShadow = false; bridge.receiveShadow = false;
        body.add(bridge);
        const fUpper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 0.65), liner);
        fUpper.position.set(sx * 0.8, 0.58, wb * 0.5);
        fUpper.castShadow = false; fUpper.receiveShadow = false;
        body.add(fUpper);
      }
      const floor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 2.8), liner);
      floor.position.set(0, 0.2, 0);
      floor.castShadow = false; floor.receiveShadow = false;
      floor.userData.cockpitHide = true;
      body.add(floor);
      const bay = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 1.1), liner);
      bay.position.set(0, 0.5, -p.L * 0.28);
      bay.castShadow = false; bay.receiveShadow = false;
      bay.userData.cockpitHide = true;
      body.add(bay);
      for (const w of T.wheels) {
        const sx = Math.sign(w.center.x) || 1;
        const well = new THREE.Mesh(new THREE.BoxGeometry(0.18, T.wheelR * 1.7, T.wheelR * 1.7), liner);
        well.position.set(sx * (Math.abs(w.center.x) - 0.28), w.center.y, w.center.z);
        well.castShadow = false; well.receiveShadow = false;
        body.add(well);
      }
    } else {
      // Generic arch walls — skip vans/trucks that have their own plugs (these paint black slabs on Vito/CT)
      if (!/^(vito|cybertruck|gwagon)$/i.test(modelId)) {
        for (const sx of [-1, 1]) {
          for (const [z, len, y, h] of [[wb * 0.55, 1.0, 0.48, 0.6], [-wb * 0.55, 0.9, 0.45, 0.55]]) {
            const wall = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, len), black);
            wall.position.set(sx * Math.min(hx, p.W * 0.32), y, z);
            wall.castShadow = false; wall.receiveShadow = false;
            body.add(wall);
          }
        }
      }
      // Mini: short hatch — extra-low floor so low cams don't see asphalt through the sill
      if (modelId === 'mini') {
        const tray = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1.15, p.W * 0.62), 0.2, p.L * 0.58), black);
        tray.position.set(0, 0.12, 0);
        tray.castShadow = false; tray.receiveShadow = false;
        tray.userData.cockpitHide = true;
        body.add(tray);
        for (const sx of [-1, 1]) {
          const lip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, p.L * 0.5), black);
          lip.position.set(sx * Math.min(0.82, p.W * 0.42), 0.18, 0);
          lip.castShadow = false; lip.receiveShadow = false;
          body.add(lip);
        }
        for (const w of T.wheels) {
          const sx = Math.sign(w.center.x) || 1;
          const well = new THREE.Mesh(new THREE.BoxGeometry(0.24, T.wheelR * 2.0, T.wheelR * 2.0), black);
          well.position.set(sx * (Math.abs(w.center.x) - 0.2), w.center.y + 0.04, w.center.z);
          well.castShadow = false; well.receiveShadow = false;
          body.add(well);
        }
      }
      // G-Wagon: tall box — thin under-sill + wells (no outer door slabs)
      if (modelId === 'gwagon') {
        const floor = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1.2, p.W * 0.58), 0.16, p.L * 0.55), black);
        floor.position.set(0, 0.18, 0);
        floor.castShadow = false; floor.receiveShadow = false;
        floor.userData.cockpitHide = true;
        body.add(floor);
        for (const sx of [-1, 1]) {
          const sill = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, p.L * 0.48), black);
          sill.position.set(sx * Math.min(0.72, p.W * 0.36), 0.22, 0);
          sill.castShadow = false; sill.receiveShadow = false;
          body.add(sill);
        }
        for (const w of T.wheels) {
          const sx = Math.sign(w.center.x) || 1;
          const well = new THREE.Mesh(new THREE.BoxGeometry(0.22, T.wheelR * 1.9, T.wheelR * 1.9), black);
          well.position.set(sx * (Math.abs(w.center.x) - 0.22), w.center.y + 0.05, w.center.z);
          well.castShadow = false; well.receiveShadow = false;
          body.add(well);
        }
      }
      for (const sx of [-1, 1]) {
        // Inset rocker shelf — Jesko / Model S / GT3 side skirts often open to asphalt.
        // Stay inside the shell so black plugs never paint bars over door paint.
        if (/^(jesko|gt3rs|model_s|ferrari|concept|mini)$/i.test(modelId)) {
          const outX = Math.min(0.68, p.W * 0.34);
          const sill = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, p.L * 0.5), black);
          sill.position.set(sx * outX, 0.26, 0);
          sill.castShadow = false; sill.receiveShadow = false;
          body.add(sill);
          const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, p.L * 0.4), black);
          skirt.position.set(sx * Math.min(0.78, p.W * 0.4), 0.16, 0);
          skirt.castShadow = false; skirt.receiveShadow = false;
          body.add(skirt);
        }
      }
      if (/^(jesko|ferrari|gt3rs|concept)$/i.test(modelId)) {
        const bay = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.7, p.W * 0.5), 0.5, Math.max(0.7, p.L * 0.22)), black);
        bay.position.set(0, 0.52, -p.L * 0.28);
        bay.castShadow = false; bay.receiveShadow = false;
        bay.userData.cockpitHide = true;
        body.add(bay);
      }
      if (/^(jesko|model_s|ferrari|concept|mini)$/i.test(modelId)) {
        const floor = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1.0, p.W * 0.55), 0.12, p.L * 0.6), black);
        floor.position.set(0, 0.16, 0);
        floor.castShadow = false; floor.receiveShadow = false;
        floor.userData.cockpitHide = true;
        body.add(floor);
        for (const w of T.wheels) {
          const sx = Math.sign(w.center.x) || 1;
          const deep = /^(ferrari|concept)$/i.test(modelId);
          const well = new THREE.Mesh(new THREE.BoxGeometry(
            modelId === 'model_s' ? 0.22 : deep ? 0.28 : 0.16,
            T.wheelR * (deep ? 2.1 : 1.75),
            T.wheelR * (deep ? 2.1 : 1.75),
          ), black);
          well.position.set(
            sx * (Math.abs(w.center.x) - (modelId === 'model_s' ? 0.2 : deep ? 0.18 : 0.25)),
            w.center.y + (deep ? 0.06 : 0),
            w.center.z,
          );
          well.castShadow = false; well.receiveShadow = false;
          body.add(well);
        }
        if (modelId === 'model_s') {
          for (const sx of [-1, 1]) {
            // Inset rocker→rear-arch seam plug (outside this |x| paints black over the door)
            const arch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.65), black);
            arch.position.set(sx * Math.min(0.7, p.W * 0.36), 0.28, -wb * 0.55);
            arch.castShadow = false; arch.receiveShadow = false;
            body.add(arch);
          }
        }
      }
      // Vito: unlit black plugs (lit Standard mats read as grey slabs under the bumper)
      if (modelId === 'vito') {
        const cavity = new THREE.MeshBasicMaterial({ color: 0x030304, side: THREE.DoubleSide });
        const fill = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1.45, p.W * 0.7), 0.48, p.L * 0.58), cavity);
        fill.position.set(0, 0.3, 0.08);
        fill.castShadow = false; fill.receiveShadow = false;
        fill.userData.cockpitHide = true;
        body.add(fill);
        // Rear under-bumper tray — closes the asphalt “grey rectangle” from rear-three-quarter
        const rearTray = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1.4, p.W * 0.72), 0.14, 1.05), cavity);
        rearTray.position.set(0, 0.14, -p.L * 0.3);
        rearTray.castShadow = false; rearTray.receiveShadow = false;
        body.add(rearTray);
        const rearFace = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1.25, p.W * 0.64), 0.32, 0.45), cavity);
        rearFace.position.set(0, 0.26, -p.L * 0.38);
        rearFace.castShadow = false; rearFace.receiveShadow = false;
        body.add(rearFace);
        for (const w of T.wheels) {
          const sx = Math.sign(w.center.x) || 1;
          const well = new THREE.Mesh(new THREE.BoxGeometry(0.14, T.wheelR * 1.35, T.wheelR * 1.35), cavity);
          well.position.set(sx * (Math.abs(w.center.x) - 0.36), w.center.y, w.center.z);
          well.castShadow = false; well.receiveShadow = false;
          body.add(well);
        }
      }
      // Cybertruck wells — deep inset liners only (chassis fill added after HUD colour)
      if (modelId === 'cybertruck') {
        for (const w of T.wheels) {
          const sx = Math.sign(w.center.x) || 1;
          const well = new THREE.Mesh(new THREE.BoxGeometry(0.26, T.wheelR * 2.05, T.wheelR * 2.05), black);
          well.position.set(sx * (Math.abs(w.center.x) - 0.22), w.center.y + 0.1, w.center.z);
          well.castShadow = false; well.receiveShadow = false;
          body.add(well);
        }
      }
    }
  }
  const parts = [glassMesh].filter(Boolean);
  if (cfg.hud !== undefined && !opts.police) paint.color.set(cfg.hud); // minimap / HUD colour
  if (!cheap && (cfg.model || '').toLowerCase() === 'cybertruck') {
    // Thin low cladding under the sill — unlit so it reads as void, not a grey box
    const clad = new THREE.MeshBasicMaterial({ color: 0x0a0a0c, side: THREE.DoubleSide });
    const trackX = Math.abs((T.wheels[0] && T.wheels[0].center.x) || p.W * 0.45);
    const faceX = Math.min(trackX - 0.1, p.W * 0.36);
    for (const sx of [-1, 1]) {
      const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, p.L * 0.44), clad);
      rocker.position.set(sx * faceX, 0.12, 0);
      rocker.castShadow = false; rocker.receiveShadow = false;
      body.add(rocker);
    }
    const tray = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1.45, p.W * 0.68), 0.16, p.L * 0.46), clad);
    tray.position.set(0, 0.08, 0);
    tray.castShadow = false; tray.receiveShadow = false;
    tray.userData.cockpitHide = true;
    body.add(tray);
  }
  // Authored panels with mixed winding vanish from one side — force DS on shell
  if (!cheap && /^(vito|cybertruck)$/i.test((cfg.model || ''))) {
    body.traverse((c) => {
      if (!c.isMesh || !c.material) return;
      const n = c.material.name || '';
      if (/glass|vidrios|window/i.test(n)) return;
      c.material.side = THREE.DoubleSide;
      c.material.needsUpdate = true;
    });
  }
  // Model S widebody skirts: thin paint-matched seals after HUD colour (black plugs alone leave asphalt peeks)
  if (!cheap && (cfg.model || '').toLowerCase() === 'model_s') {
    const seal = paint.clone();
    seal.side = THREE.DoubleSide;
    seal.envMapIntensity = Math.min(seal.envMapIntensity || 1, 0.65);
    const wbSeal = Math.max(0.9, p.wb || p.L * 0.28);
    for (const sx of [-1, 1]) {
      const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, p.L * 0.42), seal);
      rocker.position.set(sx * Math.min(0.86, p.W * 0.44), 0.24, 0);
      rocker.castShadow = false; rocker.receiveShadow = false;
      body.add(rocker);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, p.L * 0.36), seal);
      lip.position.set(sx * Math.min(0.9, p.W * 0.46), 0.14, 0);
      lip.castShadow = false; lip.receiveShadow = false;
      body.add(lip);
      // Behind front arch — common asphalt peek angle on the widebody kit
      const fArch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.35), seal);
      fArch.position.set(sx * Math.min(0.88, p.W * 0.45), 0.22, wbSeal * 0.45);
      fArch.castShadow = false; fArch.receiveShadow = false;
      body.add(fArch);
      // B-pillar / door-gap light leak
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.18), seal);
      pillar.position.set(sx * Math.min(0.84, p.W * 0.42), 0.55, 0.05);
      pillar.castShadow = false; pillar.receiveShadow = false;
      body.add(pillar);
      const rearGap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.22), seal);
      rearGap.position.set(sx * Math.min(0.84, p.W * 0.42), 0.48, -wbSeal * 0.35);
      rearGap.castShadow = false; rearGap.receiveShadow = false;
      body.add(rearGap);
    }
  }
  const hl = p.L / 2;
  const heads = [];
  // lo LOD / traffic: authored emissive lamps only — skip halo/signal sprite stacks (many blend draws)
  const sparseFx = cheap || !!D.keepTextures;
  const lampY = Math.max(T.wheelR + 0.28, p.roofH * 0.32);
  if (!cheap) {
    for (const sx of [-1, 1]) {
      const H = cfg.head ? { x: sx * cfg.head.x, y: cfg.head.y, z: cfg.head.z } : (T.heads && T.heads[sx]) || { x: sx * p.W * 0.32, y: lampY, z: p.L / 2 - 0.14 };
      const Tl = cfg.tailL ? { x: sx * cfg.tailL.x, y: cfg.tailL.y, z: cfg.tailL.z } : (T.tails && T.tails[sx]) || { x: sx * p.W * 0.32, y: lampY + 0.06, z: -p.L / 2 + 0.12 };
      addLampFlare(body, new THREE.Vector3(H.x, H.y, H.z + 0.1), 'head', heads, sparseFx);
      addLampFlare(body, new THREE.Vector3(Tl.x, Tl.y, Tl.z - 0.1), 'tail', heads, sparseFx);
    }
  }
  const signals = cheap ? null : signalsFromBody(body);
  const siren = {};
  if (opts.police) addPoliceGear(body, p, hl, siren);
  if (opts.taxi) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.35), new THREE.MeshStandardMaterial({ color: 0xffdd55, emissive: 0xffcc33, emissiveIntensity: 1.2 }));
    t.position.set(0, p.roofH + 0.22, (p.roofF + p.roofR) / 2); body.add(t);
  }
  const wheels = [];
  for (const w of T.wheels) {
    const pivot = new THREE.Group(); pivot.position.set(w.center.x, w.center.y, w.center.z);
    const spin = new THREE.Group(); pivot.add(spin);
    for (const it of w.parts) spin.add(new THREE.Mesh(it.geo, opts.police && /rim|wheel/i.test(it.mat.name || '') ? sh.darkRim : it.mat));
    mergeByMaterial(spin);
    // Hub discs plug see-through spokes on hero cars; traffic skips the extra draw per wheel
    if (!cheap) addHubDisc(pivot, T.wheelR, w.side);
    root.add(pivot); wheels.push({ pivot, spin, front: w.front, side: w.side, blur: cheap ? null : addBlurDisc(pivot, T.wheelR, w.side) });
  }
  // Shadow casters: body paint + glass + tyres only — trim/chrome/flares were flooding the sun map
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const n = (m && m.name) || '';
    const cast = m === paint || m === glassMat || /tire|tyre|llanta|Body|bodypaint|paint|Paint/i.test(n) || (m && dmgMats.includes(m));
    o.castShadow = !!(cast && !(m && m.transparent));
    o.userData.shadowCaster = o.castShadow;
    o.receiveShadow = false;
  });
  root.userData.sharedGeo = true;
  return { root, body, wheels, paint, tailMat, dmgMats, heads, signals, siren, dims: { L: p.L, W: p.W, wheelR: p.wheelR, wb: p.wb, roofH: p.roofH }, profile: p, parts, glb: T, glbCfg: cfg };
}

// kind: super|gt|muscle|sedan|suv|truck|tank ; opts: {color, color2, livery, police, taxi}
export function buildCar(kind, opts = {}) {
  if (kind === 'tank') return buildTank(opts);
  const gid = opts.model && GLB_MODELS[opts.model] ? opts.model : kind;
  if (GLB_MODELS[gid] && hasGLB(GLB_MODELS[gid].model, 'hi')) return buildGLBCar(gid, opts);
  const sh = S();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  let p = PROFILES[kind] || PROFILES.sedan;
  const cheap = opts.lod === 'lo';
  const paint = makePaint(opts.color ?? 0xcc1010, opts.livery || 'plain', opts.color2 ?? 0xffffff, cheap);
  const glass = cheap ? sh.glassCheap : sh.glass;
  const parts = [];
  if (kind === 'truck') {
    p = { L: 6.6, W: 2.3, wheelR: 0.45, wb: 2.2 };
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.9, 1.9), paint); cab.position.set(0, 1.45, 2.2);
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 0.05), glass); win.position.set(0, 1.95, 3.16);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 4.3), new THREE.MeshStandardMaterial({ color: opts.color2 ?? 0xe8e8e8, roughness: 0.6 })); box.position.set(0, 1.85, -1.0);
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.4, 6.4), sh.black); chassis.position.set(0, 0.55, 0);
    parts.push(cab, win, box, chassis);
    body.add(cab, win, box, chassis);
  } else {
    const bg = extrude(bodyShape(p), p.W, 0.14);
    const bm = new THREE.Mesh(bg, paint);
    body.add(bm); parts.push(bm);
    const cg = extrude(cabinShape(p), p.cabinW, 0.12);
    const cm = new THREE.Mesh(cg, glass); body.add(cm); parts.push(cm);
    // roof panel
    const roofLen = p.roofF - p.roofR;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(p.cabinW - 0.18, 0.06, roofLen * 0.95), paint);
    roof.geometry.translate(0, p.roofH + 0.08, (p.roofF + p.roofR) / 2 - 0.02);
    body.add(roof); parts.push(roof);
    // lower skirt / diffuser
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(p.W - 0.1, 0.12, p.L - 0.4), sh.black); skirt.position.y = 0.24; body.add(skirt);
    // grille
    const gr = new THREE.Mesh(new THREE.BoxGeometry(p.W * 0.6, 0.16, 0.08), sh.black); gr.position.set(0, 0.4, p.L / 2 + 0.02); body.add(gr);
    // mirrors
    for (const sx of [-1, 1]) {
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.16), paint); mir.geometry.translate(sx * (p.W / 2 + 0.06), p.belt + 0.1, p.wsBase - 0.2); body.add(mir);
    }
    // exhausts
    for (const sx of [-0.45, 0.45]) {
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10), sh.chrome); ex.rotation.x = Math.PI / 2; ex.position.set(sx, 0.34, -p.L / 2 - 0.02); body.add(ex);
    }
    if (p.spoiler && !opts.police) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(p.W - 0.1, 0.05, 0.36), paint);
      wing.geometry.translate(0, p.tail + 0.32, -p.L / 2 + 0.3); body.add(wing);
      for (const sx of [-0.55, 0.55]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.12), sh.black); st.position.set(sx, p.tail + 0.16, -p.L / 2 + 0.32); body.add(st); }
    }
    if (opts.taxi) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.35), new THREE.MeshStandardMaterial({ color: 0xffdd55, emissive: 0xffcc33, emissiveIntensity: 1.2 }));
      t.position.set(0, p.roofH + 0.22, (p.roofF + p.roofR) / 2); body.add(t);
    }
  }
  const hl = p.L / 2;
  // lights — full-width tail bar for brakes; per-side heads/tails hold blinker emissives (body meshes, not sprites)
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1810, emissiveIntensity: 1.6 });
  const tailY = kind === 'truck' ? 0.9 : p.tail - 0.1;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(p.W * 0.82, 0.08, 0.05), tailMat);
  tail.position.set(0, tailY, -hl - 0.03); body.add(tail);
  const headY = kind === 'truck' ? 0.95 : p.hoodFront - 0.08;
  const headZ = kind === 'truck' ? 3.17 : hl - 0.2;
  const heads = [];
  const signals = cheap ? null : { L: [], R: [] };
  for (const sx of [-1, 1]) {
    const side = sx < 0 ? 'L' : 'R';
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.2), sh.head.clone());
    h.position.set(sx * (p.W / 2 - 0.38), headY, headZ); h.rotation.x = -0.25; body.add(h);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), tailMat.clone());
    tl.position.set(sx * (p.W / 2 - 0.3), tailY, -hl - 0.03); body.add(tl);
    if (signals) { tagSignalMesh(h, side, signals); tagSignalMesh(tl, side, signals); }
    if (!cheap) {
      addLampFlare(body, new THREE.Vector3(sx * (p.W / 2 - 0.38), headY, headZ + 0.25), 'head', heads);
      addLampFlare(body, new THREE.Vector3(sx * (p.W / 2 - 0.3), tailY, -hl - 0.15), 'tail', heads);
    }
  }
  if (signals) addCornerBlinkers(body, p, headY, headZ, tailY, hl, signals);
  const siren = {};
  if (opts.police) addPoliceGear(body, p, hl, siren);
  // merge static body meshes per material to cut draw calls
  const merged = mergeByMaterial(body);
  const partsOut = [merged.get(paint), merged.get(glass)].filter(Boolean);
  if (kind !== 'truck') { parts.length = 0; parts.push(...partsOut); }
  // wheels
  const wheels = [];
  const rimMat = opts.police ? sh.darkRim : sh.rim;
  const wx = p.W / 2 - 0.2;
  for (const [sx, sz, front] of [[1, 1, true], [-1, 1, true], [1, -1, false], [-1, -1, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * wx, p.wheelR, sz * p.wb);
    const w = makeWheel(p.wheelR, 0.3, rimMat);
    pivot.add(w);
    addHubDisc(pivot, p.wheelR, sx);
    root.add(pivot);
    wheels.push({ pivot, spin: w, front, side: sx, blur: addBlurDisc(pivot, p.wheelR, sx) });
  }
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = !(o.material && o.material.transparent);
    o.userData.shadowCaster = o.castShadow;
    o.receiveShadow = false;
  });
  return { root, body, wheels, paint, tailMat, heads, signals, siren, dims: { L: p.L, W: p.W, wheelR: p.wheelR, wb: p.wb, roofH: p.roofH || 2.5 }, profile: p, parts };
}

// Cockpit interior for first person view
export function buildInterior(model) {
  if (model.glb) return buildGLBInterior(model);
  const sh = S();
  const p = model.profile;
  const g = new THREE.Group();
  const hl = p.L / 2;
  // hood (visible through windshield) - separate so the body shell can be hidden
  const hs = new THREE.Shape();
  hs.moveTo(hl - 0.06, p.hoodFront - 0.3);
  hs.lineTo(hl - 0.06, p.hoodFront - 0.04);
  hs.quadraticCurveTo(hl - 0.1, p.hoodFront + 0.02, hl - 0.28, p.hoodFront + 0.02);
  hs.quadraticCurveTo(p.wsBase + 0.6, p.belt + 0.02, p.wsBase, p.belt + 0.04);
  hs.lineTo(p.wsBase, p.belt - 0.3);
  hs.lineTo(hl - 0.06, p.hoodFront - 0.3);
  const hood = new THREE.Mesh(extrude(hs, p.W - 0.06, 0.08), model.paint);
  g.add(hood);
  // door tops (paint) and inner door panels
  const len = p.wsBase - p.rearWin;
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, len), model.paint);
    rail.geometry.translate(sx * (p.W / 2 - 0.1), p.belt + 0.02, (p.wsBase + p.rearWin) / 2);
    g.add(rail);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, len), sh.interior);
    door.position.set(sx * (p.W / 2 - 0.2), p.belt - 0.2, (p.wsBase + p.rearWin) / 2); g.add(door);
  }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(p.W - 0.3, 0.16, 0.5), sh.interior);
  dash.position.set(0, p.belt - 0.04, p.wsBase - 0.15);
  g.add(dash);
  const cluster = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.16), sh.interior); cluster.position.set(0.38, p.belt + 0.07, p.wsBase - 0.34); g.add(cluster);
  const gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.07), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.4, 0.7) }));
  gauge.position.set(0.38, p.belt + 0.07, p.wsBase - 0.425); gauge.rotation.y = Math.PI; g.add(gauge);
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.024, 8, 32), sh.interior);
  wheel.add(rim);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.03), sh.interior); wheel.add(spoke);
  const spoke2 = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.17, 0.03), sh.interior); spoke2.position.y = -0.085; wheel.add(spoke2);
  const logo = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), new THREE.MeshStandardMaterial({ color: 0xff9a1a, emissive: 0xff6a00, emissiveIntensity: 0.2 }));
  logo.position.z = -0.02; logo.rotation.y = Math.PI; wheel.add(logo);
  wheel.position.set(0.38, p.belt - 0.06, p.wsBase - 0.62);
  wheel.rotation.x = -0.3;
  g.add(wheel);
  // pillars & roof frame
  for (const sx of [-1, 1]) {
    const pl = Math.hypot(p.wsBase - p.roofF, p.roofH - p.belt);
    const pil = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, pl), sh.interior);
    pil.position.set(sx * (p.cabinW / 2 - 0.06), (p.belt + p.roofH) / 2, (p.wsBase + p.roofF) / 2);
    pil.rotation.x = Math.atan2(p.roofH - p.belt, p.wsBase - p.roofF);
    g.add(pil);
  }
  g.visible = false;
  model.body.add(g);
  return { group: g, wheel };
}

function buildGLBInterior(model) {
  // the glTF carries its own cockpit (seats, dash, wheel); just add a steering pivot that turns with the front wheels
  const T = model.glb;
  const g = new THREE.Group();
  let steer = () => {};
  if (T.steer) {
    const pivot = new THREE.Group(); pivot.position.copy(T.steer.center);
    for (const it of T.steer.parts) pivot.add(new THREE.Mesh(it.geo, it.mat));
    pivot.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    g.add(pivot);
    steer = (a) => { pivot.rotation.z = a; };
  }
  g.visible = false;
  model.body.add(g);
  return { group: g, wheel: { rotation: { set z(v) { steer(v); } } } };
}
