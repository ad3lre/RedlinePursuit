// ===== Procedural car models =====
import * as THREE from 'three';
import { glowTexture, softGlowTexture, textTexture } from './textures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hasGLB, getTemplate } from './carAssets.js';

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
    list.forEach((m) => group.remove(m));
    const mm = new THREE.Mesh(merged, mat);
    group.add(mm); out.set(mat, mm);
  }
  return out;
}

const shared = {};
function S() {
  if (shared.ready) return shared;
  shared.glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0e14, metalness: 0.2, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.6 });
  shared.glassCheap = new THREE.MeshStandardMaterial({ color: 0x0a0e14, metalness: 0.25, roughness: 0.12, envMapIntensity: 1.2 });
  shared.tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 });
  shared.rim = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.22 });
  shared.darkRim = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.9, roughness: 0.3 });
  shared.black = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.6, metalness: 0.3 });
  shared.chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.1 });
  shared.head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 5.5 });
  shared.glowW = softGlowTexture(255, 248, 230, 256);
  shared.glowR = softGlowTexture(255, 36, 28, 256);
  shared.glowB = softGlowTexture(48, 110, 255, 256);
  shared.glowWCore = glowTexture('rgba(255,252,245,1)', 'rgba(255,240,210,0)', 128);
  shared.glowRCore = glowTexture('rgba(255,70,55,1)', 'rgba(255,20,10,0)', 128);
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
GLB_MODELS.gt3rs = { model: 'gt3rs', auto: true, hud: 0xd8d018 };
// Tall keepTextures cabins need hand-tuned eyes — auto H*0.82 sits inside the roof.
GLB_MODELS.cybertruck = { model: 'cybertruck', auto: true, hud: 0xb8bcc2, eye: { x: 0.36, y: 1.52, z: 0.85 }, hoodEye: { x: 0, y: 1.15, z: 2.15 } };
GLB_MODELS.vito = { model: 'vito', auto: true, hud: 0xf2f2f2, eye: { x: 0.45, y: 1.36, z: 0.62 }, hoodEye: { x: 0, y: 1.12, z: 2.00 } };
GLB_MODELS.mini = { model: 'mini', auto: true, hud: 0xc8102e };
GLB_MODELS.corolla = { model: 'corolla', auto: true, hud: 0xc8ccd2 };
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
    ? new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.38, envMapIntensity: 1.05 })
    : new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.25 });
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
      { float fr = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0); totalEmissiveRadiance += diffuseColor.rgb * fr * 0.10; }`);
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

/** Layered lamp flare: tight hot core + soft bloom halo. kind: 'head' | 'tail'. sparse=true → core only (AI/traffic). */
function addLampFlare(body, pos, kind, heads, sparse = false) {
  const sh = S();
  const isHead = kind === 'head';
  const core = sprite(isHead ? sh.glowWCore : sh.glowRCore, isHead ? 0.55 : 0.38, isHead ? 0xfff8ec : 0xff6048, isHead ? 0.95 : 0.85);
  core.position.copy(pos); core.userData.lamp = kind; core.userData.layer = 'core';
  body.add(core); heads.push(core);
  if (sparse) return;
  const halo = sprite(isHead ? sh.glowW : sh.glowR, isHead ? 2.4 : 1.55, isHead ? 0xffe8c8 : 0xff2a18, isHead ? 0.42 : 0.5);
  halo.position.copy(pos); halo.userData.lamp = kind; halo.userData.layer = 'halo';
  body.add(halo); heads.push(halo);
  if (isHead) {
    const bloom = sprite(sh.glowW, 4.2, 0xffd9a0, 0.18);
    bloom.position.copy(pos); bloom.userData.lamp = kind; bloom.userData.layer = 'bloom';
    body.add(bloom); heads.push(bloom);
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
  paint.side = THREE.DoubleSide; // lets the cockpit camera see the hood/roof from inside
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1810, emissiveIntensity: 1.6, transparent: true, opacity: 0.92, roughness: 0.18 });
  const D = T.def;
  const dmgMats = [];
  const glassMat = cheap ? sh.glassCheap : sh.glass;
  const pick = (mat) => {
    if (D.paintMat && D.paintMat.test(mat.name)) return paint;
    if (D.tailMat && D.tailMat.test(mat.name)) return tailMat;
    if (mat.transmission > 0) return glassMat;
    if (D.keepTextures && opts.police && /^Body/i.test(mat.name)) return paint; // police livery repaints the body
    if (D.keepTextures && /^Body/i.test(mat.name)) { const c = mat.clone(); dmgMats.push(c); return c; } // own copy so crash damage can darken just this car
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
  const parts = [glassMesh].filter(Boolean);
  if (cfg.hud !== undefined && !opts.police) paint.color.set(cfg.hud); // minimap / HUD colour
  const hl = p.L / 2;
  const heads = [];
  const sparseFx = cheap;
  for (const sx of [-1, 1]) {
    const H = cfg.head ? { x: sx * cfg.head.x, y: cfg.head.y, z: cfg.head.z } : (T.heads && T.heads[sx]) || { x: sx * p.W * 0.3, y: p.roofH * 0.5, z: p.L / 2 - 0.12 };
    const Tl = cfg.tailL ? { x: sx * cfg.tailL.x, y: cfg.tailL.y, z: cfg.tailL.z } : (T.tails && T.tails[sx]) || { x: sx * p.W * 0.3, y: p.roofH * 0.52, z: -p.L / 2 + 0.12 };
    addLampFlare(body, new THREE.Vector3(H.x, H.y, H.z + 0.1), 'head', heads, sparseFx);
    addLampFlare(body, new THREE.Vector3(Tl.x, Tl.y, Tl.z - 0.1), 'tail', heads, sparseFx);
  }
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
    root.add(pivot); wheels.push({ pivot, spin, front: w.front, side: w.side, blur: cheap ? null : addBlurDisc(pivot, T.wheelR, w.side) });
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = !(o.material && o.material.transparent); o.receiveShadow = false; } });
  root.userData.sharedGeo = true;
  return { root, body, wheels, paint, tailMat, dmgMats, heads, siren, dims: { L: p.L, W: p.W, wheelR: p.wheelR, wb: p.wb, roofH: p.roofH }, profile: p, parts, glb: T, glbCfg: cfg };
}

// kind: super|gt|muscle|sedan|suv|truck ; opts: {color, color2, livery, police, taxi}
export function buildCar(kind, opts = {}) {
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
  // lights
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1810, emissiveIntensity: 1.6 });
  const tailY = kind === 'truck' ? 0.9 : p.tail - 0.1;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(p.W * 0.82, 0.08, 0.05), tailMat);
  tail.position.set(0, tailY, -hl - 0.03); body.add(tail);
  for (const sx of [-1, 1]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), tailMat); tl.position.set(sx * (p.W / 2 - 0.3), tailY, -hl - 0.03); body.add(tl);
  }
  const headY = kind === 'truck' ? 0.95 : p.hoodFront - 0.08;
  const headZ = kind === 'truck' ? 3.17 : hl - 0.2;
  const heads = [];
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.2), sh.head);
    h.position.set(sx * (p.W / 2 - 0.38), headY, headZ); h.rotation.x = -0.25; body.add(h);
    addLampFlare(body, new THREE.Vector3(sx * (p.W / 2 - 0.38), headY, headZ + 0.25), 'head', heads);
    addLampFlare(body, new THREE.Vector3(sx * (p.W / 2 - 0.3), tailY, -hl - 0.15), 'tail', heads);
  }
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
    root.add(pivot);
    wheels.push({ pivot, spin: w, front, side: sx, blur: addBlurDisc(pivot, p.wheelR, sx) });
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = !(o.material && o.material.transparent); o.receiveShadow = false; } });
  return { root, body, wheels, paint, tailMat, heads, siren, dims: { L: p.L, W: p.W, wheelR: p.wheelR, wb: p.wb, roofH: p.roofH || 2.5 }, profile: p, parts };
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
