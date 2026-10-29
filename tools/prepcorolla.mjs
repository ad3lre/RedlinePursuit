// Toyota Corolla 2020 (ItsDiyor, CC BY) -> game-ready GLBs.
// Source: 5 material meshes under a 0.1-scaled root, nose +Z, Y-up, ~4.66 m. Wheels are NOT separate nodes — tyres,
// rims and brakes are fused into the material meshes, so they are split out here by connected component: every island
// whose bounds sit inside a wheel well (around the detected axle centres) becomes part of wheel_{f,r}{l,r}.
// Output: scaled to 4.63 m (E210 sedan), four wheel_* nodes, hi/lo budgets, webp + meshopt.
// usage: node tools/prepcorolla.mjs assets/source/corolla_src.glb assets/models/corolla_hi.glb hi
//        node tools/prepcorolla.mjs assets/source/corolla_src.glb assets/models/corolla_lo.glb lo
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { transformPrimitive, prune, dedup, reorder, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'; import draco3d from 'draco3dgltf'; import sharp from 'sharp';
const [inp, out, variant = 'hi'] = process.argv.slice(2); const LO = variant === 'lo';
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp); const root = doc.getRoot(); const scene = root.listScenes()[0]; const buffer = root.listBuffers()[0];
const tris = (p) => p.getIndices().getCount() / 3;
const count = () => { let t = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) t += tris(p); return Math.round(t); };
console.log('source tris', count());
for (const n of root.listNodes()) if (/light|camera/i.test(n.getName()) && !n.getMesh()) n.dispose();

// ---- bake world transforms + scale to target length ----
const meshNodes = root.listNodes().filter((n) => n.getMesh());
let zMin = Infinity, zMax = -Infinity;
for (const n of meshNodes) {
  const M = n.getWorldMatrix();
  for (const p of n.getMesh().listPrimitives()) { const a = p.getAttribute('POSITION').getArray(); for (let i = 0; i < a.length; i += 3) { const Z = M[2] * a[i] + M[6] * a[i + 1] + M[10] * a[i + 2] + M[14]; zMin = Math.min(zMin, Z); zMax = Math.max(zMax, Z); } }
}
const S = 4.63 / (zMax - zMin);
console.log('source length', (zMax - zMin).toFixed(3), 'scale', S.toFixed(4));
const SC = [S, 0, 0, 0, 0, S, 0, 0, 0, 0, S, 0, 0, 0, 0, 1];
const mulM = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const shared = new Set();
for (const n of meshNodes) {
  const M = mulM(SC, n.getWorldMatrix());
  for (const p of n.getMesh().listPrimitives()) { if (shared.has(p)) continue; shared.add(p); transformPrimitive(p, M); }
  const par = n.getParentNode();
  n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  if (par) par.removeChild(n); scene.addChild(n);
}
for (const n of [...root.listNodes()]) if (!n.getMesh() && n.listChildren().length === 0) n.dispose();

// ---- connected components (vertices welded by position) ----
function components(prim) {
  const pos = prim.getAttribute('POSITION').getArray(), idx = prim.getIndices().getArray(), nv = pos.length / 3;
  const key = new Map(), rep = new Int32Array(nv);
  for (let i = 0; i < nv; i++) { const k = Math.round(pos[3 * i] * 1e4) + ',' + Math.round(pos[3 * i + 1] * 1e4) + ',' + Math.round(pos[3 * i + 2] * 1e4); let r = key.get(k); if (r === undefined) { r = i; key.set(k, i); } rep[i] = r; }
  const par = new Int32Array(nv); for (let i = 0; i < nv; i++) par[i] = i;
  const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < idx.length; t += 3) { const a = f(rep[idx[t]]); par[f(rep[idx[t + 1]])] = a; par[f(rep[idx[t + 2]])] = a; }
  const comp = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const r = f(rep[idx[t]]); let e = comp.get(r);
    if (!e) { e = { tris: [], mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9] }; comp.set(r, e); }
    e.tris.push(t / 3);
    for (const v of [idx[t], idx[t + 1], idx[t + 2]]) for (let k = 0; k < 3; k++) { e.mn[k] = Math.min(e.mn[k], pos[3 * v + k]); e.mx[k] = Math.max(e.mx[k], pos[3 * v + k]); }
  }
  return [...comp.values()];
}
// new primitive with a subset of triangles (same material)
function subset(prim, triList) {
  const idx = prim.getIndices().getArray(); const used = new Map(), keep = [], ni = new Uint32Array(triList.length * 3);
  triList.forEach((t, j) => { for (let c = 0; c < 3; c++) { const v = idx[t * 3 + c]; let u = used.get(v); if (u === undefined) { u = keep.length; used.set(v, u); keep.push(v); } ni[j * 3 + c] = u; } });
  const np = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
  for (const sem of prim.listSemantics()) { const a = prim.getAttribute(sem), sz = a.getElementSize(), src = a.getArray(); const dst = new src.constructor(keep.length * sz); keep.forEach((v, j) => { for (let c = 0; c < sz; c++) dst[j * sz + c] = src[v * sz + c]; }); np.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setBuffer(buffer).setNormalized(a.getNormalized())); }
  np.setIndices(doc.createAccessor().setType('SCALAR').setArray(ni).setBuffer(buffer));
  return np;
}

// ---- find the tyres: tall, thin, round islands low on the car's flanks ----
const all = [];
for (const n of root.listNodes().filter((n) => n.getMesh())) for (const p of n.getMesh().listPrimitives()) all.push({ n, p, comps: components(p) });
const tyres = [];
for (const { comps } of all) for (const e of comps) {
  const sx = e.mx[0] - e.mn[0], sy = e.mx[1] - e.mn[1], sz = e.mx[2] - e.mn[2];
  const cx = (e.mn[0] + e.mx[0]) / 2;
  if (Math.abs(cx) > 0.6 && sy > 0.5 && sy < 0.8 && Math.abs(sy - sz) < 0.06 && sx < 0.4 && e.mn[1] < 0.05) tyres.push({ cx, cy: (e.mn[1] + e.mx[1]) / 2, cz: (e.mn[2] + e.mx[2]) / 2, r: sy / 2 });
}
const axle = (front) => { const t = tyres.filter((q) => (q.cz > 0) === front); return t.length ? { z: t.reduce((a, q) => a + q.cz, 0) / t.length, x: t.reduce((a, q) => a + Math.abs(q.cx), 0) / t.length, y: t.reduce((a, q) => a + q.cy, 0) / t.length, r: Math.max(...t.map((q) => q.r)) } : null; };
const AF = axle(true), AR = axle(false);
if (!AF || !AR) throw new Error('could not locate tyres: ' + JSON.stringify(tyres));
console.log('front axle', AF, 'rear axle', AR, 'wheelbase', (AF.z - AR.z).toFixed(3));

// ---- assign islands to wheels ----
const wheels = { fl: [], fr: [], rl: [], rr: [] };
for (const rec of all) {
  const body = [];
  const byWheel = { fl: [], fr: [], rl: [], rr: [] };
  for (const e of rec.comps) {
    const cx = (e.mn[0] + e.mx[0]) / 2, cy = (e.mn[1] + e.mx[1]) / 2, cz = (e.mn[2] + e.mx[2]) / 2;
    const A = cz > 0 ? AF : AR, r = A.r;
    const inWell = Math.abs(Math.abs(cx) - A.x) < 0.32 && Math.abs(cy - A.y) < r * 0.4 && Math.abs(cz - A.z) < r * 0.4
      && e.mx[1] - e.mn[1] < r * 2.1 && e.mx[2] - e.mn[2] < r * 2.1 && e.mx[0] - e.mn[0] < 0.6
      && Math.abs(e.mx[0]) < A.x + 0.25 && e.mx[1] < A.y + r * 1.05;
    if (inWell) byWheel[(cz > 0 ? 'f' : 'r') + (cx < 0 ? 'l' : 'r')].push(...e.tris);
    else body.push(...e.tris);
  }
  let moved = 0;
  for (const k of Object.keys(byWheel)) if (byWheel[k].length) { wheels[k].push(subset(rec.p, byWheel[k])); moved += byWheel[k].length; }
  if (moved) {
    const mesh = rec.n.getMesh();
    if (body.length) mesh.addPrimitive(subset(rec.p, body));
    mesh.removePrimitive(rec.p);
  }
}
// game convention (see prepvito/prepmini): +X = left side of the car? -> use the same signed rule as prepmini: left = x < 0
for (const [k, prims] of Object.entries(wheels)) {
  const name = 'wheel_' + k; const wn = doc.createNode(name); const wm = doc.createMesh('w_' + name);
  for (const p of prims) wm.addPrimitive(p);
  wn.setMesh(wm); scene.addChild(wn);
  console.log(name, 'tris', Math.round(prims.reduce((a, p) => a + tris(p), 0)));
}

// ---- LOD budget ----
const simplify = (prim, ratio, minTris = 250) => {
  if (ratio >= 1) return; const idxA = prim.getIndices(), posA = prim.getAttribute('POSITION'); if (!idxA || idxA.getCount() / 3 < minTris) return;
  const idx = idxA.getArray(), pos = posA.getArray(); const target = Math.max(80, Math.floor(idx.length * ratio / 3)) * 3;
  let si; try { [si] = MeshoptSimplifier.simplify(new Uint32Array(idx), pos, 3, target, 0.02, ['LockBorder']); } catch { return; }
  if (!si || si.length < 3) return;
  const used = new Map(), ni = new Uint32Array(si.length), keep = [];
  for (let i = 0; i < si.length; i++) { let u = used.get(si[i]); if (u === undefined) { u = keep.length; used.set(si[i], u); keep.push(si[i]); } ni[i] = u; }
  for (const sem of prim.listSemantics()) { const a = prim.getAttribute(sem), sz = a.getElementSize(), src = a.getArray(); const dst = new src.constructor(keep.length * sz); keep.forEach((v, j) => { for (let c = 0; c < sz; c++) dst[j * sz + c] = src[v * sz + c]; }); prim.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setBuffer(buffer).setNormalized(a.getNormalized())); }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ni).setBuffer(buffer));
};
for (const n of root.listNodes()) {
  if (!n.getMesh()) continue;
  const isWheel = /^wheel_/.test(n.getName());
  const r = isWheel ? (LO ? 0.3 : 0.7) : (LO ? 0.3 : 0.75);
  for (const p of n.getMesh().listPrimitives()) simplify(p, r, 200);
}
console.log(variant, 'tris before dedup', count());
await doc.transform(dedup(), prune());
const T = LO ? 512 : 1024;
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [T, T], quality: 82 }), prune(), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
console.log(variant, 'FINAL tris', count(), 'nodes', root.listNodes().filter((n) => n.getMesh()).map((n) => n.getName()).join(','));
await io.write(out, doc); console.log('wrote', out);
