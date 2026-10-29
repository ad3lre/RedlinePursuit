// 2023 Koenigsegg Jesko Attack (ddiaz-design, Sketchfab, CC BY-NC-SA 4.0) -> game-ready GLBs.
// Source: FBX export, Y-up, nose +Z, Sketchfab/FBX root rotations cancel out; geometry is ~100x too small (0.01 node scale) so we
// normalise by measured length to 4.61 m. Wheel groups (Ani_Wheel_FL / Ani_Disc_Scale_FR / Ani_Wheel_BR / SK_Rim_101 + SK_Brake_101) become
// four wheel_* nodes (left = -X like the other prepped cars), brake calipers stay with the body, bodywork is merged per material.
// usage: node tools/prepjesko.mjs assets/source/jesko_src.glb assets/models/jesko_hi.glb hi
//        node tools/prepjesko.mjs assets/source/jesko_src.glb assets/models/jesko_lo.glb lo
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { transformPrimitive, prune, dedup, reorder, meshopt, textureCompress, join, flatten } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'; import draco3d from 'draco3dgltf'; import sharp from 'sharp';
const [inp, out, variant = 'hi'] = process.argv.slice(2); const LO = variant === 'lo';
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp); const root = doc.getRoot(); const scene = root.listScenes()[0]; const buffer = root.listBuffers()[0];
const tris = (p) => (p.getIndices()?.getCount() || 0) / 3;
const count = () => { let t = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) t += tris(p); return Math.round(t); };
console.log('source tris', count());

const mulM = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const meshNodes = root.listNodes().filter((n) => n.getMesh());
// 1. measure length (Z) in world space
let zMin = Infinity, zMax = -Infinity;
for (const n of meshNodes) { const M = n.getWorldMatrix(); for (const p of n.getMesh().listPrimitives()) { const a = p.getAttribute('POSITION').getArray(); for (let i = 0; i < a.length; i += 3) { const Z = M[2] * a[i] + M[6] * a[i + 1] + M[10] * a[i + 2] + M[14]; if (Z < zMin) zMin = Z; if (Z > zMax) zMax = Z; } } }
const S = 4.61 / (zMax - zMin); console.log('source length', (zMax - zMin).toFixed(4), 'scale', S.toFixed(3));
const SC = [S, 0, 0, 0, 0, S, 0, 0, 0, 0, S, 0, 0, 0, 0, 1];

// 2. wheel membership by ancestor name (before we flatten the hierarchy)
const WHEEL_KEYS = [/Ani_Wheel_FL/, /Ani_Disc_Scale_FR/, /Ani_Wheel_BR/, /SK_Rim_101|SK_Brake_101/];
const chain = (n) => { let s = ''; for (let p = n; p; p = p.getParentNode()) s += '/' + p.getName(); return s; };
const wheelOf = new Map();
for (const n of meshNodes) { const c = chain(n); if (/Caliper/i.test(c)) continue; const k = WHEEL_KEYS.findIndex((re) => re.test(c)); if (k >= 0) wheelOf.set(n, k); }

// 3. bake world*scale, flatten under the scene root
for (const n of meshNodes) { const M = mulM(SC, n.getWorldMatrix()); for (const p of n.getMesh().listPrimitives()) transformPrimitive(p, M); }
for (const n of meshNodes) { const par = n.getParentNode(); n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); if (par) par.removeChild(n); scene.addChild(n); }
for (const n of [...root.listNodes()]) if (!n.getMesh() && !scene.listChildren().includes(n) && n.listChildren().length === 0) n.dispose();
for (const n of [...scene.listChildren()]) if (!n.getMesh()) { n.listChildren().forEach((c) => n.removeChild(c)); scene.removeChild(n); n.dispose(); }

const simplify = (prim, ratio, minTris = 300) => {
  if (ratio >= 1) return; const idxA = prim.getIndices(), posA = prim.getAttribute('POSITION'); if (!idxA || idxA.getCount() / 3 < minTris) return;
  const idx = idxA.getArray(), pos = posA.getArray(); const target = Math.max(120, Math.floor(idx.length * ratio / 3)) * 3;
  let si; try { [si] = MeshoptSimplifier.simplify(new Uint32Array(idx), pos, 3, target, 0.02, ['LockBorder']); } catch { return; }
  if (!si || si.length < 3) return;
  const used = new Map(), ni = new Uint32Array(si.length), keep = [];
  for (let i = 0; i < si.length; i++) { let u = used.get(si[i]); if (u === undefined) { u = keep.length; used.set(si[i], u); keep.push(si[i]); } ni[i] = u; }
  for (const sem of prim.listSemantics()) { const a = prim.getAttribute(sem), sz = a.getElementSize(), src = a.getArray(); const dst = new src.constructor(keep.length * sz); keep.forEach((v, j) => { for (let c = 0; c < sz; c++) dst[j * sz + c] = src[v * sz + c]; }); prim.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setBuffer(buffer).setNormalized(a.getNormalized())); }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ni).setBuffer(buffer));
};

// 4. wheels -> wheel_fl/fr/rl/rr (name by signed position: +Z = front, -X = left)
const NAMES = ['', '', '', ''];
const WR = LO ? 0.3 : 0.7;
for (let k = 0; k < 4; k++) {
  const nodes = [...wheelOf].filter(([, v]) => v === k).map(([n]) => n); if (!nodes.length) { console.log('MISSING wheel group', k); continue; }
  let cx = 0, cz = 0, cn = 0; // centre from the tyre-sized (largest) extents
  for (const n of nodes) for (const p of n.getMesh().listPrimitives()) { const a = p.getAttribute('POSITION').getArray(); for (let i = 0; i < a.length; i += 3) { cx += a[i]; cz += a[i + 2]; cn++; } }
  cx /= cn; cz /= cn;
  const name = 'wheel_' + (cz > 0 ? 'f' : 'r') + (cx < 0 ? 'l' : 'r'); NAMES[k] = name;
  const wn = doc.createNode(name); const wm = doc.createMesh('w_' + name);
  for (const n of nodes) { for (const p of n.getMesh().listPrimitives()) { simplify(p, WR, 250); wm.addPrimitive(p); } n.setMesh(null); scene.removeChild(n); n.dispose(); }
  wn.setMesh(wm); scene.addChild(wn);
  console.log(name, 'centre x', cx.toFixed(2), 'z', cz.toFixed(2), 'tris', Math.round(wm.listPrimitives().reduce((a, p) => a + tris(p), 0)));
}
if (new Set(NAMES).size !== 4) throw new Error('wheel naming collision: ' + NAMES.join(','));

// 5. body: interior is kept (reduced) on hi for the cockpit camera, dropped on lo; carbon / paint stay readable
const INTERIOR = /Cabin|Dashboard|Stitch|Leather/i, ENGINE = /Engine/i;
for (const n of [...root.listNodes()]) {
  if (!n.getMesh() || /^wheel_/.test(n.getName())) continue;
  const mats = n.getMesh().listPrimitives().map((p) => p.getMaterial()?.getName() || '');
  const interior = mats.every((m) => INTERIOR.test(m)), engine = mats.every((m) => ENGINE.test(m));
  if ((interior || engine) && LO) { n.setMesh(null); scene.removeChild(n); n.dispose(); continue; }
  if (engine) { n.setMesh(null); scene.removeChild(n); n.dispose(); continue; } // engine bay is never seen in game (hood does not open)
  const r = interior ? 0.22 : mats.some((m) => /Carbon/i.test(m)) ? (LO ? 0.16 : 0.34) : (LO ? 0.14 : 0.3);
  for (const p of n.getMesh().listPrimitives()) simplify(p, r, 400);
}
// glass reads as glass
for (const m of root.listMaterials()) if (/glass/i.test(m.getName())) m.setAlphaMode('BLEND').setBaseColorFactor([0.04, 0.06, 0.08, 0.35]);

console.log(variant, 'tris before join', count(), 'meshes', root.listNodes().filter((n) => n.getMesh()).length);
await doc.transform(dedup(), prune());
// merge bodywork per material -> a handful of draw calls instead of ~150
const wheelsNodes = root.listNodes().filter((n) => /^wheel_/.test(n.getName()));
try { await doc.transform(join({ keepNamed: true })); } catch (e) { console.log('join skipped:', e.message); }
const T = LO ? 512 : 1024;
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [T, T], quality: 80 }), prune(), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
console.log(variant, 'FINAL tris', count(), 'mesh nodes', root.listNodes().filter((n) => n.getMesh()).length, 'wheels', wheelsNodes.map((n) => n.getName()).join(','));
await io.write(out, doc); console.log('wrote', out);
