// Split the "Generic passenger car pack" (10 cars + loose wheels in one scene, cm units, random rotations) into clean per-car GLBs:
// world transforms baked into vertices, metres, wheelbase centred on the origin, nose toward +Z, wheels named wheel_{f,r}{l,r}.
// usage: node tools/splitpack.mjs assets/source/carpack.glb assets/source/cars [flip,list]
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { transformPrimitive, prune, dedup, textureCompress } from '@gltf-transform/functions'; import draco3d from 'draco3dgltf'; import sharp from 'sharp';
const [inp, outDir, flipArg = ''] = process.argv.slice(2); const FLIP = new Set(flipArg.split(',').filter(Boolean));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const names = (await io.read(inp)).getRoot().listNodes().filter((n) => / body$/i.test(n.getName())).map((n) => n.getName());
const mul = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const rotY = (a) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
const trs = (t, s = 1) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, t[0], t[1], t[2], 1];
const meshNodes = (n, out = []) => { if (n.getMesh()) out.push(n); n.listChildren().forEach((c) => meshNodes(c, out)); return out; };
const bounds = (items) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const p of items) { const a = p.getAttribute('POSITION').getArray(); for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a[i + k]); mx[k] = Math.max(mx[k], a[i + k]); } } return { mn, mx, c: mn.map((v, k) => (v + mx[k]) / 2), s: mx.map((v, k) => v - mn[k]) }; };
for (const bodyName of names) {
  const doc = await io.read(inp); const root = doc.getRoot(); const scene = root.listScenes()[0];
  const nodes = root.listNodes(); const body = nodes.find((n) => n.getName() === bodyName); const bw = body.getWorldTranslation();
  const tops = nodes.filter((n) => /^Wheel_[A-Z]\d*$/.test(n.getName()));
  const mine = tops.map((w) => ({ w, d: Math.hypot(w.getWorldTranslation()[0] - bw[0], w.getWorldTranslation()[2] - bw[2]) })).sort((a, b) => a.d - b.d).slice(0, 4).map((x) => x.w);
  // 1. bake world matrices of every mesh under the body / wheels
  const bake = (n) => meshNodes(n).map((mn) => { const M = mn.getWorldMatrix(); for (const p of mn.getMesh().listPrimitives()) transformPrimitive(p, M); return mn; });
  const bodyMeshes = bake(body); const wheelMeshes = mine.map((w) => ({ w, meshes: bake(w) }));
  const allPrims = [...bodyMeshes, ...wheelMeshes.flatMap((x) => x.meshes)].flatMap((n) => n.getMesh().listPrimitives());
  // 2. find the long horizontal axis (after the fbx rotations it may be X or Z) and which end is the nose
  const wc = wheelMeshes.map((x) => bounds(x.meshes.flatMap((n) => n.getMesh().listPrimitives())).c);
  const cen = [0, 1, 2].map((k) => wc.reduce((a, c) => a + c[k], 0) / 4);
  // heading from the 4 wheel centres (cars sit at arbitrary yaw): the longer rectangle edge is the wheelbase
  const P0 = wc[0]; const dd = wc.slice(1).map((c) => ({ c, d: Math.hypot(c[0] - P0[0], c[2] - P0[2]) })).sort((x, y) => x.d - y.d);
  const dx = dd[1].c[0] - P0[0], dz = dd[1].c[2] - P0[2];
  let ang = Math.atan2(-dx, dz);
  const rot = (a, p) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
  const glass = bodyMeshes.filter((n) => /glass/i.test(n.getName())).flatMap((n) => n.getMesh().listPrimitives());
  const gb = bounds(glass.length ? glass : allPrims), bb = bounds(bodyMeshes.flatMap((n) => n.getMesh().listPrimitives()));
  // cabin sits toward the rear of the body bbox centre -> nose is the opposite end
  const cabinZ = rot(ang, gb.c)[2] - rot(ang, bb.c)[2];
  let noseSign = cabinZ > 0 ? -1 : 1; if (FLIP.has(bodyName.split(' ')[0].toLowerCase())) noseSign = -noseSign;
  if (noseSign < 0) ang += Math.PI;
  const wmin = Math.min(...wheelMeshes.map((x) => bounds(x.meshes.flatMap((n) => n.getMesh().listPrimitives())).mn[1]));
  const S = mul(rotY(ang), trs([-cen[0], -wmin, -cen[2]], 1));
  for (const p of allPrims) transformPrimitive(p, S);
  // 4. rebuild a clean scene: car body + 4 named wheels, everything at identity
  const newBody = doc.createNode('body'); const wheelNodes = [];
  for (const mn of bodyMeshes) { mn.setTranslation([0, 0, 0]); mn.setRotation([0, 0, 0, 1]); mn.setScale([1, 1, 1]); newBody.addChild(mn); }
  const wb = wheelMeshes.map((x) => ({ x, c: bounds(x.meshes.flatMap((n) => n.getMesh().listPrimitives())).c }));
  for (const { x, c } of wb) { const nw = doc.createNode('wheel_' + ((c[2] > 0 ? 'f' : 'r') + (c[0] > 0 ? 'l' : 'r'))); for (const mn of x.meshes) { mn.setTranslation([0, 0, 0]); mn.setRotation([0, 0, 0, 1]); mn.setScale([1, 1, 1]); nw.addChild(mn); } wheelNodes.push(nw); }
  for (const c of scene.listChildren()) scene.removeChild(c);
  scene.addChild(newBody); wheelNodes.forEach((w) => scene.addChild(w));
  await doc.transform(prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 }), prune());
  const all = bounds(scene.listChildren().flatMap((n) => meshNodes(n)).flatMap((n) => n.getMesh().listPrimitives()));
  const out = `${outDir}/${bodyName.split(' ')[0].toLowerCase()}.glb`; await io.write(out, doc);
  console.log(out.padEnd(34), 'size(m)', all.s.map((v) => v.toFixed(2)).join(' x '), 'minY', all.mn[1].toFixed(2), 'wheels', wheelNodes.map((w) => w.getName()).join(','), 'textures', root.listTextures().length, 'noseSign', noseSign);
}
