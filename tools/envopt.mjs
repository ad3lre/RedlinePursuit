// Scan-grade environment asset -> game-ready GLB. usage: node tools/envopt.mjs in.gltf out.glb targetTris [texSize] [dropRegex]
// Merges all primitives that share a material, decimates each to its share of targetTris (sloppy simplifier: tolerates the
// non-manifold leaf/needle soup), recomputes smooth normals, crushes textures to WebP, meshopt-compresses.
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt, reorder, flatten, join, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'; import sharp from 'sharp'; import draco3d from 'draco3dgltf';
const [inp, out, tgtArg, texArg = '512', dropArg] = process.argv.slice(2); const target = +tgtArg; const drop = dropArg ? new RegExp(dropArg, 'i') : null;
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp); const root = doc.getRoot(); const buffer = root.listBuffers()[0];
if (drop) for (const n of root.listNodes()) if (drop.test(n.getName())) n.setMesh(null);
await doc.transform(flatten(), join({ keepMeshes: false, keepNamed: false }), prune());
const prims = root.listMeshes().flatMap((m) => m.listPrimitives()); const tri = (p) => (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
const total = prims.reduce((a, p) => a + tri(p), 0); console.log('tris before', Math.round(total), 'prims', prims.length);
for (const prim of prims) {
  const idxA = prim.getIndices(); if (!idxA) continue; const pos = prim.getAttribute('POSITION').getArray(), idx = idxA.getArray();
  const t = Math.max(300, Math.floor(target * tri(prim) / total)) * 3; if (idx.length <= t) continue;
  let si;
  if (process.env.SLOPPY) [si] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx), pos, 3, null, t, 0.5);
  else { // real edge-collapse on position-welded topology; UV seams are preserved by locking vertices that are split in the source
    [si] = MeshoptSimplifier.simplify(new Uint32Array(idx), pos, 3, t, 0.6, []);
  }
  const used = new Map(), ni = new Uint32Array(si.length), keep = [];
  for (let i = 0; i < si.length; i++) { let u = used.get(si[i]); if (u === undefined) { u = keep.length; used.set(si[i], u); keep.push(si[i]); } ni[i] = u; }
  for (const sem of prim.listSemantics()) { const a = prim.getAttribute(sem), sz = a.getElementSize(), src = a.getArray(), dst = new src.constructor(keep.length * sz); keep.forEach((v, j) => { for (let c = 0; c < sz; c++) dst[j * sz + c] = src[v * sz + c]; }); prim.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setBuffer(buffer).setNormalized(a.getNormalized())); }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ni).setBuffer(buffer));
}
await doc.transform(prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+texArg, +texArg], quality: 80 }), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
console.log('tris after', Math.round(root.listMeshes().flatMap((m) => m.listPrimitives()).reduce((a, p) => a + tri(p), 0)));
await io.write(out, doc);
