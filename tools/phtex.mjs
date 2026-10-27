// Download Poly Haven PBR texture sets (1k jpg): node tools/phtex.mjs id... -> assets/env_src/pbr/<id>_{diff,nor,rough}.jpg
import fs from 'fs';
for (const id of process.argv.slice(2)) {
  const j = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
  for (const [k, o] of [['Diffuse', 'diff'], ['nor_gl', 'nor'], ['Rough', 'rough']]) { const u = j[k]?.['1k']?.jpg?.url; if (!u) { console.log(id, 'missing', k); continue; } fs.writeFileSync(`assets/env_src/pbr/${id}_${o}.jpg`, Buffer.from(await (await fetch(u)).arrayBuffer())); }
  console.log(id, 'ok');
}
