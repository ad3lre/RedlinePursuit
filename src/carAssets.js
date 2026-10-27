// ===== Real (photoscanned/modelled) glTF car assets =====
// GLBs are embedded into the bundle by esbuild (loader .glb=binary) so the game still runs from file:// with zero config.
// Source models + licenses: see assets/CREDITS.md. Optimised with tools/optimize.mjs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import ferrariHi from '../assets/models/ferrari_hi.glb';
import ferrariLo from '../assets/models/ferrari_lo.glb';

const SOURCES = { 'ferrari:hi': ferrariHi, 'ferrari:lo': ferrariLo };
const templates = {};

const parse = (buf) => new Promise((res, rej) => {
  const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  l.parse(ab, '', res, rej);
});

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

function prepare(gltf) {
  const wrap = new THREE.Group(); wrap.rotation.y = Math.PI; // model faces -Z, the game drives +Z
  wrap.add(gltf.scene); wrap.updateMatrixWorld(true);
  // centre the wheelbase on z=0 (game physics pivots about the axle midpoint)
  const wp = (n) => gltf.scene.getObjectByName(n).getWorldPosition(new THREE.Vector3());
  wrap.position.z = -(wp('wheel_fl').z + wp('wheel_rl').z) / 2; wrap.updateMatrixWorld(true);
  const bodyList = [], wheelDefs = {}, steerList = [];
  const wheelOf = (o) => { for (let n = o; n; n = n.parent) if (/^wheel_(fl|fr|rl|rr)$/.test(n.name)) return n; return null; };
  const steerOf = (o) => { for (let n = o; n; n = n.parent) if (n.name === 'steering_wheel') return n; return null; };
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
    const tire = items.find((i) => /tire/i.test(i.name)) || items[0];
    tire.geo.computeBoundingBox();
    const c = tire.geo.boundingBox.getCenter(new THREE.Vector3());
    const r = tire.geo.boundingBox.getSize(new THREE.Vector3()).y / 2;
    wheels.push({ name, side: Math.sign(c.x), center: c, radius: r, parts: mergeBy(items, c), front: /^wheel_f/.test(name) });
  }
  let steer = null;
  if (steerList.length) {
    const bb = new THREE.Box3(); steerList.forEach((i) => { i.geo.computeBoundingBox(); bb.union(i.geo.boundingBox); });
    const c = bb.getCenter(new THREE.Vector3());
    steer = { center: c, parts: mergeBy(steerList, c) };
  }
  const frontZ = wheels.filter((w) => w.front).reduce((a, w) => a + w.center.z, 0) / 2;
  const rearZ = wheels.filter((w) => !w.front).reduce((a, w) => a + w.center.z, 0) / 2;
  return { body: mergeBy(bodyList), wheels, steer, size, box, frontZ, rearZ, wheelR: wheels[0].radius, track: Math.abs(wheels[0].center.x) };
}

export async function loadCarAssets() {
  await Promise.all(Object.entries(SOURCES).map(async ([k, buf]) => { templates[k] = prepare(await parse(buf)); }));
}
export const hasGLB = (model, lod) => !!templates[model + ':' + lod];
export const getTemplate = (model, lod) => templates[model + ':' + lod];
