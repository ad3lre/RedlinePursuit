// 2024 Manthey Racing Porsche 911 GT3 RS (HYPR:IMPS 3D, CC BY 4.0) -> game-ready GLBs.
// Source is already in metres, nose toward -Z (the game def rotates it by PI), 332 mesh nodes, 160 materials, 730k tris.
// Output: wheels regrouped into four nodes wheel_{f,r}{l,r} (tyre + rim + disc, spun/steered by the game), duplicate materials merged,
// translucent-but-opaque materials switched to alpha-cutout (no sorting artefacts), hi/lo triangle budgets by part type.
// usage: node tools/prepgt3.mjs assets/source/gt3rs_src.glb assets/models/gt3rs_hi.glb hi
//        node tools/prepgt3.mjs assets/source/gt3rs_src.glb assets/models/gt3rs_lo.glb lo
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { transformPrimitive, prune, dedup, reorder, meshopt, textureCompress, join } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'; import draco3d from 'draco3dgltf'; import sharp from 'sharp';
const [inp, out, variant = 'hi'] = process.argv.slice(2); const LO = variant === 'lo';
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp); const root = doc.getRoot(); const scene = root.listScenes()[0]; const buffer = root.listBuffers()[0];
const tris = (p) => p.getIndices().getCount() / 3;
const count = () => { let t = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) t += tris(p); return Math.round(t); };
console.log('source tris', count());
// ---- 1. bake world transforms, flatten the node tree ----
const meshNodes = root.listNodes().filter((n) => n.getMesh());
for (const n of meshNodes) { const M = n.getWorldMatrix(); for (const p of n.getMesh().listPrimitives()) transformPrimitive(p, M); }
for (const n of meshNodes) { n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); const par = n.getParentNode(); if (par) par.removeChild(n); scene.addChild(n); }
for (const n of root.listNodes()) if (!n.getMesh() && n.listChildren().length === 0) n.dispose();
// ---- 2. helpers ----
function subset(prim, keepTri) {
  const idx = prim.getIndices().getArray(); const remap = new Map(); const keep = []; const ni = [];
  for (let t = 0; t < idx.length / 3; t++) { if (!keepTri(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2])) continue; for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; let u = remap.get(v); if (u === undefined) { u = keep.length; remap.set(v, u); keep.push(v); } ni.push(u); } }
  if (!ni.length) return null;
  const np = doc.createPrimitive().setMaterial(prim.getMaterial()).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(ni)).setBuffer(buffer));
  for (const sem of prim.listSemantics()) { const a = prim.getAttribute(sem), sz = a.getElementSize(), src = a.getArray(); const dst = new src.constructor(keep.length * sz); keep.forEach((v, j) => { for (let c = 0; c < sz; c++) dst[j * sz + c] = src[v * sz + c]; }); np.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setBuffer(buffer).setNormalized(a.getNormalized())); }
  return np;
}
const simplify = (prim, ratio, minTris = 300) => {
  if (ratio >= 1) return; const idxA = prim.getIndices(), posA = prim.getAttribute('POSITION'); if (!idxA || idxA.getCount() / 3 < minTris) return;
  const idx = idxA.getArray(), pos = posA.getArray(); const target = Math.max(120, Math.floor(idx.length * ratio / 3)) * 3;
  const [si] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx), pos, 3, null, target, 0.05);
  const used = new Map(), ni = new Uint32Array(si.length), keep = [];
  for (let i = 0; i < si.length; i++) { let u = used.get(si[i]); if (u === undefined) { u = keep.length; used.set(si[i], u); keep.push(si[i]); } ni[i] = u; }
  for (const sem of prim.listSemantics()) { const a = prim.getAttribute(sem), sz = a.getElementSize(), src = a.getArray(); const dst = new src.constructor(keep.length * sz); keep.forEach((v, j) => { for (let c = 0; c < sz; c++) dst[j * sz + c] = src[v * sz + c]; }); prim.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setBuffer(buffer).setNormalized(a.getNormalized())); }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ni).setBuffer(buffer));
};
const cen = (pos, a, b, c, k) => (pos[a * 3 + k] + pos[b * 3 + k] + pos[c * 3 + k]) / 3;
// ---- 3. regroup wheels: every wheel_* / wheel.* node is split by triangle centroid into 4 corners ----
const WHEEL = /^wheel[._]/i;
const corners = { fl: [], fr: [], rl: [], rr: [] };
for (const n of root.listNodes()) {
  if (!n.getMesh() || !WHEEL.test(n.getName())) continue;
  for (const p of n.getMesh().listPrimitives()) {
    const pos = p.getAttribute('POSITION').getArray();
    for (const [key, fn] of [['fl', (x, z) => x <= 0 && z < 0], ['fr', (x, z) => x > 0 && z < 0], ['rl', (x, z) => x <= 0 && z >= 0], ['rr', (x, z) => x > 0 && z >= 0]]) {
      const sp = subset(p, (a, b, c) => fn(cen(pos, a, b, c, 0), cen(pos, a, b, c, 2))); if (sp) corners[key].push(sp);
    }
  }
  n.setMesh(null); scene.removeChild(n); n.dispose();
}
const WR = LO ? 0.14 : 0.28;
for (const [key, prims] of Object.entries(corners)) {
  const wn = doc.createNode('wheel_' + key); const wm = doc.createMesh('w_' + key);
  for (const p of prims) { simplify(p, WR, 200); wm.addPrimitive(p); } wn.setMesh(wm); scene.addChild(wn);
  console.log('wheel', key, 'parts', prims.length, 'tris', Math.round(prims.reduce((a, p) => a + tris(p), 0)));
}
// ---- 4. triangle budget per part type ----
const DETAIL = /^(interior|misc_s|steeringwheel|chassis|NYAlights|belt|rollcage|extra|W5|hub_)/i;
const DROP_INT = /^(interior|misc_s|steeringwheel|rollcage|belt)/i; // cabin clutter: drop on BOTH lods (cockpit is separate)
const BODY = /^(bodyshell|bonnet|door_|boot|bumper|nyagt3rs_a|Object|brakelight|plastic|carbon)/i;
for (const n of root.listNodes()) {
  if (!n.getMesh() || /^wheel_/.test(n.getName())) continue;
  if (DROP_INT.test(n.getName())) { n.setMesh(null); scene.removeChild(n); n.dispose(); continue; }
  const r = DETAIL.test(n.getName()) ? (LO ? 0.08 : 0.12) : BODY.test(n.getName()) ? (LO ? 0.1 : 0.28) : (LO ? 0.1 : 0.22);
  for (const p of n.getMesh().listPrimitives()) simplify(p, r);
}
// ---- 5. materials: cut-out instead of blend where the surface is opaque ----
for (const m of root.listMaterials()) if (m.getAlphaMode() === 'BLEND' && m.getBaseColorFactor()[3] >= 0.99 && !/glass|window|lens|light/i.test(m.getName())) m.setAlphaMode('MASK').setAlphaCutoff(0.5);
console.log(variant, 'tris before dedup', count(), 'materials', root.listMaterials().length);
await doc.transform(dedup(), prune());
console.log('materials after dedup', root.listMaterials().length, 'mesh nodes', root.listNodes().filter((n) => n.getMesh()).length);
const T = LO ? 512 : 1024;
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [T, T], quality: 80 }), prune(), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
console.log(variant, 'FINAL tris', count()); await io.write(out, doc); console.log('wrote', out);
