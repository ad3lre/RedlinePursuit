// Tesla Cybertruck (TAIGA-ZOE, CC BY 4.0) -> game-ready GLBs.
// Source: nose toward -X, +Y up, ~cm units, both wheels of an axle fused into one mesh (285k tris of tyres).
// Output: metres (5.68 m long), nose toward +Z, four separate wheels named wheel_{f,r}{l,r} (hi: ~12% of source tyre tris, lo: 2.5%).
// usage: node tools/prepcybertruck.mjs assets/source/cybertruck_hi_src.glb assets/models/cybertruck_hi.glb hi
//        node tools/prepcybertruck.mjs assets/source/cybertruck_hi_src.glb assets/models/cybertruck_lo.glb lo
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { transformPrimitive, prune, dedup, reorder, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'; import draco3d from 'draco3dgltf'; import sharp from 'sharp';
const [inp, out, variant = 'hi'] = process.argv.slice(2); const LO = variant === 'lo';
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp); const root = doc.getRoot(); const scene = root.listScenes()[0]; const buffer = root.listBuffers()[0];
const S = 5.68 / 313.4; // measured source length 313.4 -> 5.68 m
const mulM = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const ROT = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]; // +90 deg about Y: (x,y,z) -> (z,y,-x): nose -X becomes +Z
const SC = [S, 0, 0, 0, 0, S, 0, 0, 0, 0, S, 0, 0, 0, 0, 1];
const FIX = mulM(ROT, SC);
const tris = (p) => p.getIndices().getCount() / 3;
const meshNodes = root.listNodes().filter((n) => n.getMesh());
// 1. bake every mesh into final space
for (const n of meshNodes) { const M = mulM(FIX, n.getWorldMatrix()); for (const p of n.getMesh().listPrimitives()) transformPrimitive(p, M); }
const old = root.listNodes().filter((n) => !n.getMesh());
for (const n of meshNodes) { n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); scene.addChild(n); }
for (const n of old) { if (scene.listChildren().includes(n)) scene.removeChild(n); n.dispose(); }
// 2. split the fused axle meshes into 4 wheels
function subset(prim, keepTri) {
  const idx = prim.getIndices().getArray(); const remap = new Map(); const keep = []; const ni = [];
  for (let t = 0; t < idx.length / 3; t++) { if (!keepTri(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2])) continue; for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; let u = remap.get(v); if (u === undefined) { u = keep.length; remap.set(v, u); keep.push(v); } ni.push(u); } }
  const np = doc.createPrimitive().setMaterial(prim.getMaterial()).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(ni)).setBuffer(buffer));
  for (const sem of prim.listSemantics()) { const a = prim.getAttribute(sem), sz = a.getElementSize(), src = a.getArray(); const dst = new src.constructor(keep.length * sz); keep.forEach((v, j) => { for (let c = 0; c < sz; c++) dst[j * sz + c] = src[v * sz + c]; }); np.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setBuffer(buffer).setNormalized(a.getNormalized())); }
  return np;
}
const simplify = (prim, ratio, minTris = 400) => {
  const idxA = prim.getIndices(), posA = prim.getAttribute('POSITION'); if (!idxA || idxA.getCount() / 3 < minTris) return;
  const idx = idxA.getArray(), pos = posA.getArray(); const target = Math.max(250, Math.floor(idx.length * ratio / 3)) * 3;
  const [si] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx), pos, 3, null, target, 0.05);
  const used = new Map(), ni = new Uint32Array(si.length), keep = [];
  for (let i = 0; i < si.length; i++) { let u = used.get(si[i]); if (u === undefined) { u = keep.length; used.set(si[i], u); keep.push(si[i]); } ni[i] = u; }
  for (const sem of prim.listSemantics()) { const a = prim.getAttribute(sem), sz = a.getElementSize(), src = a.getArray(); const dst = new src.constructor(keep.length * sz); keep.forEach((v, j) => { for (let c = 0; c < sz; c++) dst[j * sz + c] = src[v * sz + c]; }); prim.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setBuffer(buffer).setNormalized(a.getNormalized())); }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ni).setBuffer(buffer));
};
const avgZ = (prim) => { const a = prim.getAttribute('POSITION').getArray(); let s = 0; for (let i = 2; i < a.length; i += 3) s += a[i]; return s / (a.length / 3); };
const WR = LO ? 0.025 : 0.12;
for (const n of meshNodes) {
  if (!/^Cube\.(027|138)_Tire_0$/.test(n.getName())) continue;
  const prims = n.getMesh().listPrimitives(); const front = avgZ(prims[0]) > 0;
  for (const side of ['l', 'r']) {
    const wn = doc.createNode('wheel_' + (front ? 'f' : 'r') + side); const wm = doc.createMesh('w_' + wn.getName());
    for (const p of prims) { const pos = p.getAttribute('POSITION').getArray(); const sp = subset(p, (a, b, c) => { const x = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3; return side === 'l' ? x > 0 : x <= 0; }); simplify(sp, WR, 300); wm.addPrimitive(sp); }
    wn.setMesh(wm); scene.addChild(wn);
  }
  n.setMesh(null); scene.removeChild(n); n.dispose();
}
// 3. interior (cockpit seats/dash/yoke): hi keeps 35%, lo drops it
for (const n of root.listNodes()) {
  if (!n.getMesh() || !/^Cube.003_In_0$/.test(n.getName())) continue;
  if (LO) { n.setMesh(null); scene.removeChild(n); n.dispose(); } else for (const p of n.getMesh().listPrimitives()) simplify(p, 0.35);
}
const count = () => { let t = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) t += tris(p); return Math.round(t); };
console.log(variant, 'tris', count(), 'nodes', root.listNodes().filter((n) => n.getMesh()).length);
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [LO ? 512 : 2048, LO ? 512 : 2048], quality: 82 }), prune(), dedup(), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(out, doc); console.log('wrote', out);
