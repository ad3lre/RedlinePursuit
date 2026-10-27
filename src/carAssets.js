// ===== Real (photoscanned/modelled) glTF car assets =====
// GLBs are embedded into the bundle by esbuild (loader .glb=binary) so the game still runs from file:// with zero config.
// Source models + licenses: see assets/CREDITS.md. Optimised with tools/optimize.mjs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import ferrariHi from '../assets/models/ferrari_hi.glb';
import ferrariLo from '../assets/models/ferrari_lo.glb';
import conceptHi from '../assets/models/concept_hi.glb';
import conceptLo from '../assets/models/concept_lo.glb';

const SOURCES = { 'ferrari:hi': ferrariHi, 'ferrari:lo': ferrariLo, 'concept:hi': conceptHi, 'concept:lo': conceptLo };
// Per-model node/material mapping. rotY: radians to turn the model so its nose points +Z (game forward).
export const MODEL_DEFS = {
  ferrari: { rotY: Math.PI, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, tireMesh: /tire/i, steer: /^steering_wheel$/, paintMat: /^Body_Color$/, glassMat: /^Glass_Gray$/, tailMat: /^Taillight_Glass$/, tailPaintCombine: false },
  concept: { rotY: 0, wheelNode: /^Wheel(Front|Rear)(L|R)$/, frontWheel: /^WheelFront/, tireMesh: null, steer: /^InteriorSteeringCylinder$/, paintMat: /^Paint [12] /, glassMat: /^Glass$/, tailMat: /^Brakelight$/, headMat: /^Headlight$/ },
};
const templates = {};

const parse = (buf) => new Promise((res, rej) => {
  const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  l.parse(ab, '', res, rej);
});

const MAPS = ['map', 'aoMap', 'lightMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'transmissionMap', 'alphaMap', 'bumpMap'];
const usesUV1 = (m) => MAPS.some((k) => m[k] && m[k].channel === 1);
function bake(mesh) {
  // flatten (quantized / interleaved) attributes into plain Float32 so merging works
  const src = mesh.geometry, g = new THREE.BufferGeometry();
  const take = (name, size) => {
    const a = src.attributes[name]; const out = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) { out[i * size] = a.getX(i); out[i * size + 1] = a.getY(i); if (size > 2) out[i * size + 2] = a.getZ(i); }
    g.setAttribute(name, new THREE.BufferAttribute(out, size));
  };
  take('position', 3);
  if (src.attributes.normal) take('normal', 3);
  if (src.attributes.uv1) take('uv1', 2); else if (usesUV1(mesh.material)) g.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
  if (src.attributes.uv) take('uv', 2); else g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
  if (src.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index.array), 1));
  g.applyMatrix4(mesh.matrixWorld);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
function mergeBy(list, center) {
  // list: [{geo, mat}] -> [{geo, mat}] merged per material
  const by = new Map();
  for (const it of list) { if (!by.has(it.mat)) by.set(it.mat, []); by.get(it.mat).push(it.geo); }
  const out = [];
  for (const [mat, geos] of by) {
    const g = geos.length > 1 ? mergeGeometries(geos) : geos[0];
    if (center) g.translate(-center.x, -center.y, -center.z);
    g.computeBoundingSphere();
    out.push({ geo: g, mat });
  }
  return out;
}

function prepare(gltf, def) {
  const wrap = new THREE.Group(); wrap.rotation.y = def.rotY; // orient so the nose points +Z (game forward)
  wrap.add(gltf.scene); wrap.updateMatrixWorld(true);
  const isWheelNode = (n) => def.wheelNode.test(n.name);
  const wheelNodes = []; gltf.scene.traverse((o) => { if (isWheelNode(o)) wheelNodes.push(o); });
  // ground the tyres on y=0 and centre the wheelbase on z=0 (game physics pivots about the axle midpoint)
  const wb = new THREE.Box3(); wheelNodes.forEach((n) => wb.expandByObject(n));
  const wc = (n) => new THREE.Box3().setFromObject(n).getCenter(new THREE.Vector3());
  const fz = wheelNodes.filter((n) => def.frontWheel.test(n.name)).map((n) => wc(n).z), rz = wheelNodes.filter((n) => !def.frontWheel.test(n.name)).map((n) => wc(n).z);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  wrap.position.y = -wb.min.y; wrap.position.z = -(avg(fz) + avg(rz)) / 2; wrap.updateMatrixWorld(true);
  const wheelOf = (o) => { for (let n = o; n; n = n.parent) if (isWheelNode(n)) return n; return null; };
  const steerOf = (o) => { for (let n = o; n; n = n.parent) if (def.steer.test(n.name)) return n; return null; };
  const bodyList = [], wheelDefs = {}, steerList = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const item = { geo: bake(o), mat: o.material, name: o.name };
    const w = wheelOf(o), s = steerOf(o);
    if (w) (wheelDefs[w.name] ||= []).push(item);
    else if (s) steerList.push(item);
    else bodyList.push(item);
  });
  const box = new THREE.Box3().setFromObject(wrap);
  const size = box.getSize(new THREE.Vector3());
  const wheels = [];
  for (const [name, items] of Object.entries(wheelDefs)) {
    const tires = items.filter((i) => /tire/i.test(i.name) || /tire/i.test(i.mat.name));
    const ref = tires.length ? tires : items;
    const bb = new THREE.Box3(); ref.forEach((i) => { i.geo.computeBoundingBox(); bb.union(i.geo.boundingBox); });
    const c = bb.getCenter(new THREE.Vector3());
    const sz = bb.getSize(new THREE.Vector3());
    wheels.push({ name, side: Math.sign(c.x), center: c, radius: Math.max(sz.y, sz.z) / 2, parts: mergeBy(items, c), front: def.frontWheel.test(name) });
  }
  let steer = null;
  if (steerList.length) {
    const bb = new THREE.Box3(); steerList.forEach((i) => { i.geo.computeBoundingBox(); bb.union(i.geo.boundingBox); });
    const c = bb.getCenter(new THREE.Vector3());
    steer = { center: c, parts: mergeBy(steerList, c) };
  }
  const frontZ = avg(wheels.filter((w) => w.front).map((w) => w.center.z));
  const rearZ = avg(wheels.filter((w) => !w.front).map((w) => w.center.z));
  const body = mergeBy(bodyList);
  // locate lamp clusters (per side) so the glow sprites sit on the real lamps
  const lamp = (re) => {
    const out = {};
    for (const sx of [-1, 1]) {
      const bb = new THREE.Box3();
      for (const it of body) { if (!re.test(it.mat.name)) continue; const p = it.geo.attributes.position; for (let i = 0; i < p.count; i++) if (Math.sign(p.getX(i)) === sx) bb.expandByPoint(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i))); }
      if (!bb.isEmpty()) { const c = bb.getCenter(new THREE.Vector3()); out[sx] = { x: c.x, y: c.y, z: sx > 0 ? bb.max.z : bb.max.z }; out[sx].z = bb.max.z > 0 && Math.abs(bb.max.z) > Math.abs(bb.min.z) ? bb.max.z : bb.min.z; }
    }
    return out;
  };
  const heads = def.headMat ? lamp(def.headMat) : null, tails = def.tailMat ? lamp(def.tailMat) : null;
  return { def, body, wheels, steer, size, box, frontZ, rearZ, wheelR: avg(wheels.map((w) => w.radius)), track: Math.abs(wheels[0].center.x), heads, tails };
}

export async function loadCarAssets() {
  await Promise.all(Object.entries(SOURCES).map(async ([k, buf]) => { templates[k] = prepare(await parse(buf), MODEL_DEFS[k.split(':')[0]]); }));
}
export const hasGLB = (model, lod) => !!templates[model + ':' + lod];
export const getTemplate = (model, lod) => templates[model + ':' + lod];
