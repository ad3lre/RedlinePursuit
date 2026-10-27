// usage: node tools/tris.mjs file.glb [topN] -> triangle count per mesh node (finds what to strip for low LODs)
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import draco3d from 'draco3dgltf';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(process.argv[2]); const rows = []; let total = 0;
for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (!m) continue; let t = 0; for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3; total += t; rows.push([n.getName(), t]); }
rows.sort((a, b) => b[1] - a[1]); console.log('total', total, 'meshNodes', rows.length); console.log(rows.slice(0, +process.argv[3] || 25).map((r) => r.join(':')).join(' | '));
