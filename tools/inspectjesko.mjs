import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer'; import draco3d from 'draco3dgltf';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]); const root = doc.getRoot();
let tot = 0; const bb = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
const rows = [];
for (const n of root.listNodes()) {
  const m = n.getMesh(); if (!m) continue;
  const M = n.getWorldMatrix(); let t = 0; const mats = new Set(); const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const p of m.listPrimitives()) {
    t += (p.getIndices()?.getCount() || 0) / 3; mats.add(p.getMaterial()?.getName() || '-');
    const a = p.getAttribute('POSITION').getArray();
    for (let i = 0; i < a.length; i += 3) { const w = [M[0]*a[i]+M[4]*a[i+1]+M[8]*a[i+2]+M[12], M[1]*a[i]+M[5]*a[i+1]+M[9]*a[i+2]+M[13], M[2]*a[i]+M[6]*a[i+1]+M[10]*a[i+2]+M[14]]; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); bb.min[k] = Math.min(bb.min[k], w[k]); bb.max[k] = Math.max(bb.max[k], w[k]); } }
  }
  tot += t; rows.push({ node: n.getName(), parent: n.getParentNode()?.getName() || '', tris: Math.round(t), mats: [...mats].join(','), c: lo.map((v, k) => +((v + hi[k]) / 2).toFixed(2)).join(','), ext: lo.map((v, k) => +(hi[k] - v).toFixed(2)).join('x') });
}
console.log('nodes', root.listNodes().length, 'meshes', root.listMeshes().length, 'mats', root.listMaterials().length, 'textures', root.listTextures().length, 'total tris', Math.round(tot));
console.log('bbox min', bb.min.map((v) => +v.toFixed(2)), 'max', bb.max.map((v) => +v.toFixed(2)), 'size', bb.max.map((v, k) => +(v - bb.min[k]).toFixed(2)));
console.log('scene roots', root.listScenes()[0].listChildren().map((n) => n.getName()));
rows.sort((a, b) => b.tris - a.tris); for (const r of rows.slice(0, 60)) console.log(JSON.stringify(r));
console.log('materials', root.listMaterials().map((m) => m.getName()).join(' | '));
