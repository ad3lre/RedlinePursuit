// Sketchfab military GLBs for BLACKOUT (Abrams tank + UH-60 Blackhawk).
// Embedded via esbuild .glb=binary. See assets/CREDITS.md.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import tankGlb from '../assets/models/tank.glb';
import heliGlb from '../assets/models/heli.glb';

const parse = (buf) => new Promise((res, rej) => {
  const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
  l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej);
});

const MAPS = ['map', 'aoMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap'];
function bake(mesh) {
  const src = mesh.geometry, g = new THREE.BufferGeometry();
  const take = (name, size) => {
    const a = src.attributes[name]; if (!a) return;
    const out = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) {
      out[i * size] = a.getX(i); out[i * size + 1] = a.getY(i);
      if (size > 2) out[i * size + 2] = a.getZ(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, size));
  };
  take('position', 3);
  if (src.attributes.normal) take('normal', 3);
  if (src.attributes.uv) take('uv', 2);
  if (src.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index.array), 1));
  g.applyMatrix4(mesh.matrixWorld);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
function sanitize(mat) {
  if (!mat || mat.userData?.milOk) return mat;
  mat.userData = mat.userData || {};
  mat.userData.milOk = true;
  if ((mat.opacity ?? 1) < 0.05) { mat.opacity = 1; mat.transparent = false; }
  if ((mat.transmission || 0) > 0 && !/glass|transparent/i.test(mat.name || '')) {
    mat.transmission = 0; mat.transparent = false; mat.opacity = 1;
  }
  // Brighten olive drab a touch so night asphalt doesn't swallow them
  if (mat.color && /body|Material__2[56]/i.test(mat.name || '')) {
    mat.color.offsetHSL(0, 0.02, 0.06);
    mat.emissive = mat.emissive || new THREE.Color(0x000000);
    if (mat.emissiveIntensity < 0.08) {
      mat.emissive.setRGB(0.05, 0.07, 0.03);
      mat.emissiveIntensity = 0.18;
    }
  }
  mat.side = THREE.DoubleSide;
  mat.needsUpdate = true;
  return mat;
}

function prepare(gltf, tag) {
  const wrap = new THREE.Group();
  wrap.add(gltf.scene);
  wrap.updateMatrixWorld(true);
  const body = [], rotors = [], glass = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) sanitize(m);
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const mn = (mat?.name || '') + ' ' + (o.name || '');
    const item = { geo: bake(o), mat: sanitize(mat?.clone?.() || mat) };
    if (/rotor/i.test(mn)) rotors.push(item);
    else if (/glass|transparent/i.test(mn)) glass.push(item);
    else body.push(item);
  });
  const box = new THREE.Box3().setFromObject(wrap);
  const size = box.getSize(new THREE.Vector3());
  const merge = (list) => {
    if (!list.length) return [];
    const by = new Map();
    for (const it of list) {
      const key = (it.mat?.name || 'm') + ':' + (it.mat?.map?.uuid || '');
      if (!by.has(key)) by.set(key, { mat: it.mat, geos: [] });
      by.get(key).geos.push(it.geo);
    }
    const out = [];
    for (const { mat, geos } of by.values()) {
      const g = geos.length > 1 ? mergeGeometries(geos) : geos[0];
      if (!g) continue;
      g.computeBoundingSphere();
      out.push({ geo: g, mat });
    }
    return out;
  };
  return {
    tag,
    body: merge(body),
    rotors: merge(rotors),
    glass: merge(glass),
    size,
    box,
  };
}

const templates = {};
export async function loadMilitaryAssets() {
  const [tank, heli] = await Promise.all([parse(tankGlb), parse(heliGlb)]);
  templates.tank = prepare(tank, 'tank');
  templates.heli = prepare(heli, 'heli');
}
export const getMilitary = (id) => templates[id];
export const hasMilitary = (id) => !!templates[id];
