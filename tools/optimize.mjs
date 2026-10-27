// Offline asset pipeline: source GLB (Draco) -> LOD'd, meshopt-compressed GLB.
// usage: node tools/optimize.mjs in.glb out.glb ratio [dropNodeRegex]
// Source meshes have split (non-shared) vertices, so stock simplify stalls. We weld by position only,
// simplify on the welded topology, then re-emit survivors using the attributes of a representative vertex.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, meshopt, reorder, dedup, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
const [inp, out, ratioArg, dropArg] = process.argv.slice(2);
const ratio = parseFloat(ratioArg || '0.3');
const drop = dropArg ? new RegExp(dropArg, 'i') : null;
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp);
for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression') e.dispose();
const root = doc.getRoot(); const buffer = root.listBuffers()[0];
const count = () => { let n = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); n += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; } return Math.round(n); };
console.log('tris before', count());
if (drop) for (const n of root.listNodes()) if (drop.test(n.getName())) { n.setMesh(null); }
// Source meshes are non-manifold layered soups, so topology-based simplify wrecks them (and rebuilt normals shatter).
// ratio>=1 : keep geometry untouched (hero LOD). ratio<1 : simplifySloppy on ORIGINAL vertices, keeping authored normals/UVs.
if (ratio < 1) for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const posA = prim.getAttribute('POSITION'), idxA = prim.getIndices();
  if (!posA || !idxA || idxA.getCount() / 3 < 400) continue;
  const pos = posA.getArray(), idx = idxA.getArray();
  const target = Math.max(300, Math.floor(idx.length * ratio / 3)) * 3;
  const [si] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx), pos, 3, null, target, 0.05);
  const used = new Map(); const ni = new Uint32Array(si.length); const keep = [];
  for (let i = 0; i < si.length; i++) { let u = used.get(si[i]); if (u === undefined) { u = keep.length; used.set(si[i], u); keep.push(si[i]); } ni[i] = u; }
  for (const sem of prim.listSemantics()) {
    const a = prim.getAttribute(sem), sz = a.getElementSize(), src = a.getArray(); const dst = new src.constructor(keep.length * sz);
    keep.forEach((v, j) => { for (let c = 0; c < sz; c++) dst[j*sz+c] = src[v*sz+c]; });
    prim.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setBuffer(buffer).setNormalized(a.getNormalized()));
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ni).setBuffer(buffer));
}
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }), prune(), dedup(), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
console.log('tris after', count());
await io.write(out, doc);
