// Pack Poly Haven PBR sets into small tileable WebPs: <id>_c.webp (colour), <id>_n.webp (normal), roughness folded into normal's alpha-free copy (<id>_r.webp)
import sharp from 'sharp';
const S = +process.argv[2] || 512;
for (const id of ['asphalt_02', 'aerial_grass_rock', 'leafy_grass', 'aerial_rocks_02', 'coast_sand_01', 'concrete_floor_02', 'forrest_ground_01']) {
  for (const [o, q] of [['diff', 82], ['nor', 85], ['rough', 80]]) {
    const src = `assets/env_src/pbr/${id}_${o}.jpg`;
    await sharp(src).resize(S, S).webp({ quality: q }).toFile(`assets/env/${id}_${o}.webp`);
  }
}
console.log('packed');
