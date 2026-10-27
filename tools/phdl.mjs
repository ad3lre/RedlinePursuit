// Download Poly Haven (CC0) models: node tools/phdl.mjs id1 id2 ...  -> assets/env_src/<id>/<id>_1k.gltf + textures
import fs from 'fs'; import path from 'path';
for (const id of process.argv.slice(2)) {
  const j = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json(); const g = j.gltf['1k'].gltf;
  const dir = `assets/env_src/${id}`; fs.mkdirSync(dir, { recursive: true });
  const get = async (url, dest) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); const r = await fetch(url); fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer())); };
  await get(g.url, `${dir}/${path.basename(g.url)}`);
  for (const [rel, f] of Object.entries(g.include)) await get(f.url, `${dir}/${rel}`);
  console.log(id, 'ok', Object.keys(g.include).length, 'files');
}
