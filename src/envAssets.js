// ===== High-detail environment assets =====
// Trees: real bark + needle/leaf alpha-card textures (Poly Haven, CC0) on procedurally grown trunks/branches (scan meshes can't be decimated:
// their foliage is cards). Rocks/props: decimated Poly Haven scans embedded as GLB. See assets/CREDITS.md.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from './util.js';
import pineCardUrl from '../assets/env/pine_card.webp';
import jacCardUrl from '../assets/env/jac_card.webp';
import barkPineUrl from '../assets/env/bark_pine.webp';
import barkBroadUrl from '../assets/env/bark_broad.webp';
import shrubGlb from '../assets/env/shrub.glb';
import fernGlb from '../assets/env/fern.glb';
import asphalt_02_diff from '../assets/env/asphalt_02_diff.webp';
import asphalt_02_nor from '../assets/env/asphalt_02_nor.webp';
import asphalt_02_rough from '../assets/env/asphalt_02_rough.webp';
import aerial_grass_rock_diff from '../assets/env/aerial_grass_rock_diff.webp';
import aerial_grass_rock_nor from '../assets/env/aerial_grass_rock_nor.webp';
import aerial_grass_rock_rough from '../assets/env/aerial_grass_rock_rough.webp';
import leafy_grass_diff from '../assets/env/leafy_grass_diff.webp';
import leafy_grass_nor from '../assets/env/leafy_grass_nor.webp';
import leafy_grass_rough from '../assets/env/leafy_grass_rough.webp';
import aerial_rocks_02_diff from '../assets/env/aerial_rocks_02_diff.webp';
import aerial_rocks_02_nor from '../assets/env/aerial_rocks_02_nor.webp';
import aerial_rocks_02_rough from '../assets/env/aerial_rocks_02_rough.webp';
import coast_sand_01_diff from '../assets/env/coast_sand_01_diff.webp';
import coast_sand_01_nor from '../assets/env/coast_sand_01_nor.webp';
import coast_sand_01_rough from '../assets/env/coast_sand_01_rough.webp';
import concrete_floor_02_diff from '../assets/env/concrete_floor_02_diff.webp';
import concrete_floor_02_nor from '../assets/env/concrete_floor_02_nor.webp';
import concrete_floor_02_rough from '../assets/env/concrete_floor_02_rough.webp';
import rockGlb from '../assets/env/rock.glb';
import boulderGlb from '../assets/env/boulder.glb';
import binGlb from '../assets/env/bin.glb';
import barrierGlb from '../assets/env/barrier.glb';
import lampGlb from '../assets/env/lamp.glb';

export const ENV = {};
const texLoader = new THREE.TextureLoader();
const loadTex = (url, srgb = true) => new Promise((res) => texLoader.load(url, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t); }));
const parseGlb = (buf) => new Promise((res, rej) => { const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder); l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej); });

function flat(mesh) { // -> plain float geometry in world space
  const src = mesh.geometry, g = new THREE.BufferGeometry(); mesh.updateWorldMatrix(true, false);
  for (const [n, sz] of [['position', 3], ['normal', 3], ['uv', 2]]) { const a = src.attributes[n]; if (!a) continue; const o = new Float32Array(a.count * sz); for (let i = 0; i < a.count; i++) { o[i * sz] = a.getX(i); o[i * sz + 1] = a.getY(i); if (sz > 2) o[i * sz + 2] = a.getZ(i); } g.setAttribute(n, new THREE.BufferAttribute(o, sz)); }
  if (src.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index.array), 1));
  g.applyMatrix4(mesh.matrixWorld); return g;
}
async function loadProp(buf, { height, ground = true }) {
  const gl = await parseGlb(buf); gl.scene.updateMatrixWorld(true); const parts = [];
  gl.scene.traverse((o) => { if (o.isMesh) parts.push({ geo: flat(o), mat: o.material }); });
  const bb = new THREE.Box3(); parts.forEach((p) => { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox); });
  const s = height / (bb.max.y - bb.min.y), c = bb.getCenter(new THREE.Vector3());
  for (const p of parts) { p.geo.translate(-c.x, -(ground ? bb.min.y : c.y), -c.z); p.geo.scale(s, s, s); p.mat.envMapIntensity = 0.6; }
  return { parts, size: bb.getSize(new THREE.Vector3()).multiplyScalar(s) };
}

// ---- procedural trees ----
function tube(r0, r1, h, seg, vTile = 1) { const g = new THREE.CylinderGeometry(r1, r0, h, seg, 3, true); g.translate(0, h / 2, 0); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * vTile); return g; }
function card(w, h, base = 0) { // quad standing along +Y from its base
  const g = new THREE.PlaneGeometry(w, h, 1, 2); g.translate(0, h / 2 + base, 0); return g;
}
function place(g, pos, dir, roll, normalFn) { // orient a +Y card along dir, roll about dir, move to pos
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()); q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll));
  g.applyQuaternion(q); g.translate(pos.x, pos.y, pos.z);
  // soft canopy lighting: blend normals toward 'outward from crown' so cards don't flicker lit/unlit per face
  const n = g.attributes.normal, p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) { v.set(p.getX(i), p.getY(i), p.getZ(i)); const o = normalFn(v); n.setXYZ(i, o.x, o.y, o.z); }
  return g;
}
function buildPine(seed) {
  const rnd = mulberry32(seed), H = 15 + rnd() * 3, cards = [];
  const trunk = tube(0.42, 0.07, H, 8, 4);
  const crown = (v) => new THREE.Vector3(v.x * 0.6, (v.y - H * 0.5) * 0.1 + 1.1, v.z * 0.6).normalize();
  const layers = 14;
  for (let L = 0; L < layers; L++) {
    const t = L / (layers - 1), y = 2.6 + t * (H - 3.2), len = (1 - t) * 3.6 + 0.8, n = Math.max(4, Math.round(8 - t * 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n + rnd() * 0.12 + L * 0.37) * Math.PI * 2, droop = 0.55 - t * 0.25 + rnd() * 0.2;
      const dir = new THREE.Vector3(Math.cos(a), -droop + (L % 2) * 0.1, Math.sin(a));
      const g = card(len * 0.62, len, 0.05); cards.push(place(g, new THREE.Vector3(Math.cos(a) * 0.1, y + rnd() * 0.5, Math.sin(a) * 0.1), dir.multiplyScalar(1).setY(dir.y + 1.35 - droop * 0.5 * 0), rnd() * 1.2 - 0.6, crown));
    }
  }
  const top = card(1.3, 3.2); cards.push(place(top, new THREE.Vector3(0, H - 1.4, 0), new THREE.Vector3(0, 1, 0), 0, crown)); const top2 = card(1.3, 3.2); cards.push(place(top2, new THREE.Vector3(0, H - 1.4, 0), new THREE.Vector3(0, 1, 0), Math.PI / 2, crown));
  return { trunk, foliage: mergeGeometries(cards.map((g) => g.toNonIndexed ? g.toNonIndexed() : g)), height: H };
}
function buildBroad(seed) {
  const rnd = mulberry32(seed), H = 7 + rnd() * 1.5, parts = [], cards = [];
  const trunk = tube(0.34, 0.16, H * 0.55, 8, 2); parts.push(trunk);
  const crownC = new THREE.Vector3(0, H * 0.78, 0);
  const crown = (v) => { const o = v.clone().sub(crownC); o.y = o.y * 0.35 + 3.2; return o.normalize(); };
  for (let b = 0; b < 6; b++) { const a = (b / 6) * Math.PI * 2 + rnd(), br = tube(0.14, 0.04, 3.2 + rnd(), 5, 1.5); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a) * 0.9, 0.9, Math.sin(a) * 0.9).normalize()); br.applyQuaternion(q); br.translate(0, H * 0.45 + rnd(), 0); parts.push(br); }
  for (let i = 0; i < 120; i++) {
    const u = rnd(), v = rnd() * Math.PI * 2, w = Math.acos(2 * rnd() - 1), R = 1.2 + Math.cbrt(u) * 3.6;
    const pos = new THREE.Vector3(Math.sin(w) * Math.cos(v) * R * 1.15, Math.cos(w) * R * 0.78 + H * 0.78, Math.sin(w) * Math.sin(v) * R * 1.15);
    const g = card(3.0, 1.9, -0.95); cards.push(place(g, pos, new THREE.Vector3(rnd() - 0.5, 0.6 + rnd() * 0.6, rnd() - 0.5), rnd() * 6.28, crown));
  }
  return { trunk: mergeGeometries(parts), foliage: mergeGeometries(cards.map((g) => g.toNonIndexed ? g.toNonIndexed() : g)), height: H + 4 };
}

function vcol(g, c) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
const clean = (g) => { const o = g.toNonIndexed(); for (const k of Object.keys(o.attributes)) if (!['position', 'normal', 'color'].includes(k)) o.deleteAttribute(k); return o; };
function lodPine() { // distant tree: tapered trunk + 4 stacked cones, no textures
  const parts = [vcol(clean(new THREE.CylinderGeometry(0.15, 0.4, 4, 5).translate(0, 2, 0)), new THREE.Color(0.35, 0.26, 0.2))];
  [[3.4, 6, 4.5], [2.7, 5.5, 8], [2.0, 5, 11.2], [1.2, 4, 14]].forEach(([r, h, y]) => parts.push(vcol(clean(new THREE.ConeGeometry(r, h, 7).translate(0, y, 0)), new THREE.Color(0.2, 0.34, 0.16))));
  return mergeGeometries(parts);
}
function lodBroad() {
  const parts = [vcol(clean(new THREE.CylinderGeometry(0.2, 0.34, 4.2, 5).translate(0, 2.1, 0)), new THREE.Color(0.35, 0.26, 0.2))];
  [[0, 6.6, 0, 3.1], [1.8, 5.7, 0.8, 2.2], [-1.6, 5.9, -1, 2.1]].forEach(([x, y, z, r]) => parts.push(vcol(clean(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z)), new THREE.Color(0.28, 0.45, 0.14))));
  return mergeGeometries(parts);
}
const PBR_SRC = { asphalt: [asphalt_02_diff, asphalt_02_nor, asphalt_02_rough], grass: [aerial_grass_rock_diff, aerial_grass_rock_nor, aerial_grass_rock_rough], meadow: [leafy_grass_diff, leafy_grass_nor, leafy_grass_rough], rock: [aerial_rocks_02_diff, aerial_rocks_02_nor, aerial_rocks_02_rough], sand: [coast_sand_01_diff, coast_sand_01_nor, coast_sand_01_rough], concrete: [concrete_floor_02_diff, concrete_floor_02_nor, concrete_floor_02_rough] };
export async function loadEnvAssets() {
  ENV.pbr = {};
  await Promise.all(Object.entries(PBR_SRC).map(async ([k, [d, n, r]]) => { const [dt, nt, rt] = await Promise.all([loadTex(d), loadTex(n, false), loadTex(r, false)]); ENV.pbr[k] = { map: dt, normalMap: nt, roughnessMap: rt }; }));
  const [pineCard, jacCard, barkPine, barkBroad] = await Promise.all([loadTex(pineCardUrl), loadTex(jacCardUrl), loadTex(barkPineUrl), loadTex(barkBroadUrl)]);
  const card = (map, c) => new THREE.MeshStandardMaterial({ map, color: c, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, envMapIntensity: 0.9, shadowSide: THREE.DoubleSide });
  ENV.pineMat = card(pineCard, 0xffffff); ENV.broadMat = card(jacCard, 0xffffff);
  ENV.pineBark = new THREE.MeshStandardMaterial({ map: barkPine, roughness: 1, color: 0xffffff }); ENV.broadBark = new THREE.MeshStandardMaterial({ map: barkBroad, roughness: 1, color: 0xffffff });
  ENV.lodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }); ENV.lodPine = lodPine(); ENV.lodBroad = lodBroad();
  ENV.pines = [1, 2, 3].map((s) => buildPine(100 + s)); ENV.broads = [1, 2, 3].map((s) => buildBroad(200 + s));
  const [shrub, fern] = await Promise.all([loadProp(shrubGlb, { height: 1.1 }), loadProp(fernGlb, { height: 0.9 })]); Object.assign(ENV, { shrub, fern });
  const [rock, boulder, bin, barrier, lamp] = await Promise.all([loadProp(rockGlb, { height: 1 }), loadProp(boulderGlb, { height: 1 }), loadProp(binGlb, { height: 1.05 }), loadProp(barrierGlb, { height: 0.85 }), loadProp(lampGlb, { height: 8 })]);
  Object.assign(ENV, { rock, boulder, bin, barrier, lamp });
}
