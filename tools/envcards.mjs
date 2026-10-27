// Build alpha-cutout foliage card textures from Poly Haven diffuse+alpha JPGs (colour is bled into transparent texels so mip-maps don't get dark fringes).
import sharp from 'sharp';
const T = 'assets/env_src/tex/'; let GAIN = 2.6; // source scans are ~20% grey; game lighting at dusk needs brighter albedo
async function crop(diff, alpha, box, out, size) {
  const a = await sharp(T + alpha + '.jpg').greyscale().extract(box).raw().toBuffer();
  const { data: rgb, info } = await sharp(T + diff + '.jpg').removeAlpha().extract(box).raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < a.length; i++) if (a[i] > 200) { r += rgb[i * 3]; g += rgb[i * 3 + 1]; b += rgb[i * 3 + 2]; n++; }
  const m = [r / n, g / n, b / n]; const o = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < a.length; i++) { const k = Math.min(1, (a[i] / 255) * 1.6); for (let c = 0; c < 3; c++) o[i * 4 + c] = Math.min(255, (rgb[i * 3 + c] * k + m[c] * (1 - k)) * GAIN); o[i * 4 + 3] = a[i]; }
  await sharp(o, { raw: { width: info.width, height: info.height, channels: 4 } }).resize(size[0], size[1], { fit: 'fill' }).webp({ quality: 88, alphaQuality: 95 }).toFile('assets/env/' + out);
  console.log(out, n, 'opaque px');
}
await crop('pine_tree_01_twig_diff', 'pine_tree_01_twig_alpha', { left: 40, top: 56, width: 175, height: 380 }, 'pine_card.webp', [112, 256]);
GAIN = 1.5;
await crop('jacaranda_tree_leaves_diff', 'jacaranda_tree_leaves_alpha', { left: 170, top: 10, width: 850, height: 500 }, 'jac_card.webp', [256, 160]);
for (const [s, o] of [['pine_tree_01_bark_diff', 'bark_pine.webp'], ['jacaranda_tree_trunk_diff', 'bark_broad.webp']]) await sharp(T + s + '.jpg').resize(256, 256).webp({ quality: 80 }).toFile('assets/env/' + o);
const pv = await Promise.all(['pine_card', 'jac_card'].map((f) => sharp('assets/env/' + f + '.webp').flatten({ background: '#7a838c' }).resize(256, 256, { fit: 'contain', background: '#7a838c' }).png().toBuffer()));
await sharp({ create: { width: 512, height: 256, channels: 3, background: '#7a838c' } }).composite([{ input: pv[0], left: 0, top: 0 }, { input: pv[1], left: 256, top: 0 }]).png().toFile('shots/cards.png');
