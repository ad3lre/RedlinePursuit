// ===== Procedural canvas textures =====
import * as THREE from 'three';
import { mulberry32, makeNoise2D } from './util.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 16; // reduces road/building shimmer at grazing angles (cheap on modern GPUs)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function noiseFill(ctx, w, h, base, amp, seed, scale = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const rnd = mulberry32(seed);
  const nz = makeNoise2D(seed);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const n = (rnd() - 0.5) * amp + nz(x / (18 * scale), y / (18 * scale)) * amp * 0.6;
    img.data[i] = Math.max(0, Math.min(255, base[0] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, base[1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, base[2] + n));
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export function asphaltTexture() {
  const c = canvas(512, 512), ctx = c.getContext('2d');
  noiseFill(ctx, 512, 512, [58, 58, 62], 26, 11);
  // patches / cracks
  const rnd = mulberry32(5);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${20 + rnd() * 30},${20 + rnd() * 30},${24 + rnd() * 30},${0.08 + rnd() * 0.12})`;
    ctx.beginPath(); ctx.ellipse(rnd() * 512, rnd() * 512, 20 + rnd() * 70, 10 + rnd() * 40, rnd() * 3, 0, 7); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(15,15,15,0.35)'; ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath(); let x = rnd() * 512, y = rnd() * 512; ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return tex(c);
}

// Highway / connector texture. u across road, v along.
/** style: 'tokyo' | 'de' | 'us' (default) */
export function roadTexture(lanesPerDir, highway, style = 'us') {
  const tokyo = style === 'tokyo', de = style === 'de';
  const W = 512, H = 1024;
  const c = canvas(W, H), ctx = c.getContext('2d');
  noiseFill(ctx, W, H, tokyo ? [28, 30, 38] : de ? [44, 46, 50] : [52, 52, 56], tokyo ? 18 : 22, tokyo ? 88 : de ? 55 : 21);
  // tire wear darker bands
  const laneW = (W * 0.86) / (lanesPerDir * 2);
  const x0 = W * 0.07;
  for (let l = 0; l < lanesPerDir * 2; l++) {
    for (const f of [0.28, 0.72]) {
      const g = ctx.createLinearGradient(x0 + laneW * (l + f) - 14, 0, x0 + laneW * (l + f) + 14, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, tokyo ? 'rgba(4,6,14,0.42)' : 'rgba(10,10,12,0.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x0 + laneW * (l + f) - 14, 0, 28, H);
    }
  }
  if (tokyo) {
    // Japanese Shuto Expressway / Touge markings: red deceleration shoulder bars, crisp white edge lines, white/amber center divider & diamond ◇ symbols
    ctx.fillStyle = highway ? 'rgba(0,220,255,0.22)' : 'rgba(220,40,50,0.35)';
    for (let y = 0; y < H; y += 32) { ctx.fillRect(x0 - 24, y, 14, 18); ctx.fillRect(W - x0 + 10, y, 14, 18); }
    ctx.fillStyle = '#f0f4ff';
    ctx.fillRect(x0 - 8, 0, 7, H); ctx.fillRect(W - x0 + 1, 0, 7, H);
    // center median line (white + amber reflector strip on Shuto, orange touge line on mountain roads)
    ctx.fillStyle = highway ? '#f0f4ff' : '#ff9818';
    ctx.fillRect(W / 2 - 8, 0, 5, H); ctx.fillRect(W / 2 + 3, 0, 5, H);
    if (highway) {
      ctx.fillStyle = '#00e5ff';
      for (let y = 0; y < H; y += 128) ctx.fillRect(W / 2 - 2, y + 20, 4, 48);
    }
    ctx.fillStyle = '#e8f0ff';
    for (let l = 1; l < lanesPerDir * 2; l++) {
      if (l === lanesPerDir) continue;
      const x = x0 + laneW * l;
      for (let y = 0; y < H; y += 256) ctx.fillRect(x - 3, y, 6, 110);
    }
    // Japanese road diamond ◇ marking in lanes
    ctx.strokeStyle = 'rgba(240,245,255,0.55)'; ctx.lineWidth = 4;
    for (let l = 0; l < lanesPerDir * 2; l++) {
      const cx = x0 + laneW * (l + 0.5), cy = (l % 2) * 512 + 256;
      ctx.beginPath(); ctx.moveTo(cx, cy - 38); ctx.lineTo(cx + 14, cy); ctx.lineTo(cx, cy + 38); ctx.lineTo(cx - 14, cy); ctx.closePath(); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(22,24,34,0.95)';
    ctx.fillRect(0, 0, x0 - 28, H); ctx.fillRect(W - x0 + 28, 0, x0 - 28, H);
    return tex(c);
  }
  if (de) {
    // German StVO-style: white edges, white dashed lanes, solid white center on Autobahn, no US yellow
    ctx.fillStyle = '#f2f4f6';
    ctx.fillRect(x0 - 8, 0, 6, H); ctx.fillRect(W - x0 + 2, 0, 6, H);
    if (highway) {
      ctx.fillRect(W / 2 - 4, 0, 5, H);
      // green reflective studs vibe on Autobahn shoulder
      ctx.fillStyle = 'rgba(40,180,90,0.35)';
      for (let y = 0; y < H; y += 28) { ctx.fillRect(x0 - 22, y, 10, 10); ctx.fillRect(W - x0 + 12, y, 10, 10); }
    } else {
      ctx.fillStyle = '#f2f4f6';
      for (let y = 0; y < H; y += 220) ctx.fillRect(W / 2 - 3, y, 5, 100);
    }
    ctx.fillStyle = '#f2f4f6';
    for (let l = 1; l < lanesPerDir * 2; l++) {
      if (l === lanesPerDir) continue;
      const x = x0 + laneW * l;
      for (let y = 0; y < H; y += 240) ctx.fillRect(x - 2, y, 5, 95);
    }
    ctx.fillStyle = 'rgba(55,58,52,0.92)';
    ctx.fillRect(0, 0, x0 - 28, H); ctx.fillRect(W - x0 + 28, 0, x0 - 28, H);
    return tex(c);
  }
  // edge lines
  ctx.fillStyle = '#e8e8e0';
  ctx.fillRect(x0 - 8, 0, 7, H); ctx.fillRect(W - x0 + 1, 0, 7, H);
  // center double yellow
  ctx.fillStyle = '#e0b020';
  ctx.fillRect(W / 2 - 9, 0, 6, H); ctx.fillRect(W / 2 + 3, 0, 6, H);
  // dashed lane lines
  ctx.fillStyle = '#e8e8e0';
  for (let l = 1; l < lanesPerDir * 2; l++) {
    if (l === lanesPerDir) continue;
    const x = x0 + laneW * l;
    for (let y = 0; y < H; y += 256) ctx.fillRect(x - 3, y, 6, 110);
  }
  // shoulder rumble strip
  if (highway) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let y = 0; y < H; y += 16) { ctx.fillRect(x0 - 26, y, 14, 8); ctx.fillRect(W - x0 + 12, y, 14, 8); }
  }
  // outside edge dirt
  ctx.fillStyle = 'rgba(70,62,50,0.9)';
  ctx.fillRect(0, 0, x0 - 30, H); ctx.fillRect(W - x0 + 30, 0, x0 - 30, H);
  const t = tex(c);
  return t;
}

export function grassDetailTexture() {
  const c = canvas(512, 512), ctx = c.getContext('2d');
  noiseFill(ctx, 512, 512, [150, 150, 150], 70, 31, 0.4);
  const t = tex(c, true, false);
  return t;
}

export function concreteTexture() {
  const c = canvas(256, 256), ctx = c.getContext('2d');
  noiseFill(ctx, 256, 256, [150, 148, 142], 22, 41);
  ctx.strokeStyle = 'rgba(60,60,60,0.5)'; ctx.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke(); }
  return tex(c);
}

export function waterNormalTexture() {
  const S = 256;
  const c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const nz = makeNoise2D(99);
  const hgt = (x, y) => {
    // tileable by sampling on torus-ish via sin/cos combos
    const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
    return nz(Math.cos(a) * 2 + 10, Math.sin(a) * 2 + Math.cos(b) * 2) * 0.6 + nz(Math.cos(a) * 5, Math.sin(b) * 5 + Math.sin(a)) * 0.3 + nz(Math.sin(b) * 9 + 3, Math.cos(a) * 9) * 0.15;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
    const nx = -dx * 4, ny = -dy * 4, nzv = 1; const l = Math.hypot(nx, ny, nzv);
    const i = (y * S + x) * 4;
    img.data[i] = ((nx / l) * 0.5 + 0.5) * 255; img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255; img.data[i + 2] = ((nzv / l) * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, true, false);
}

export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.5)')); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return tex(c, false, true);
}

/** Soft multi-stop radial for lamp flares (bright core, long pretty falloff). */
export function softGlowTexture(r, g, b, size = 256) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gr.addColorStop(0.08, `rgba(${r},${g},${b},0.95)`);
  gr.addColorStop(0.22, `rgba(${r},${g},${b},0.45)`);
  gr.addColorStop(0.5, `rgba(${r},${g},${b},0.12)`);
  gr.addColorStop(0.78, `rgba(${r},${g},${b},0.03)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, size, size);
  return tex(c, false, true);
}

/** Elongated headlight volume: bright near tip, soft edges, fades along length. */
/**
 * Projected headlamp pattern for SpotLight.map (canvas top = up in the light's view).
 * Low beam: hot spot just below the horizon, sharp horizontal cut-off with the classic 15° kick-up on the kerb side
 * (right-hand traffic), wide soft foreground spread. High beam adds a long centred hot spot above the cut-off.
 */
export function headlampPattern(size = 256, high = false) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size - 0.5, v = 0.5 - (y + 0.5) / size; // u: right +, v: up +
    const r = Math.hypot(u, v);
    const cone = 1 - sm(0.42, 0.5, r); // round lens edge
    // cut-off: flat on the left, rising 15° to the right of centre
    const cut = u > 0.02 ? Math.min(0.09, (u - 0.02) * Math.tan(15 * Math.PI / 180)) : 0;
    const below = 1 - sm(cut - 0.012, cut + 0.012, v);
    const hot = Math.exp(-((u / 0.24) ** 2 + ((v + 0.05) / 0.09) ** 2)); // concentrated just under the cut-off
    const spread = Math.exp(-((u / 0.42) ** 2 + ((v + 0.18) / 0.26) ** 2)) * 0.8; // wide foreground wash
    let a = below * (0.35 * hot + 0.65 * Math.max(hot, spread) + 0.12) + 0.04 * (1 - below) * Math.exp(-((u / 0.3) ** 2)); // floor so the whole lens area lights
    if (high) a = Math.max(a, Math.exp(-((u / 0.16) ** 2 + (v / 0.12) ** 2)) * 1.1 + Math.exp(-((u / 0.34) ** 2 + (v / 0.22) ** 2)) * 0.35);
    a = Math.min(1, a) * cone;
    const i = (y * size + x) * 4;
    img.data[i] = 255 * a; img.data[i + 1] = 247 * a; img.data[i + 2] = 232 * a; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // linear data (a light mask), NOT sRGB: sRGB decoding squared the mid-tones and darkened the whole beam
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

export function beamTexture(size = 256) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    // After PlaneGeometry.rotateX(-PI/2), v=1 lands near the car and v=0 at the far tip
    const along = 1 - v; // 0 = near car, 1 = far
    const across = Math.abs(u - 0.5) * 2;
    const width = 0.12 + along * 0.88;
    const edge = Math.max(0, 1 - across / Math.max(width, 1e-3));
    const a = edge ** 1.6 * (1 - along) ** 1.15 * (0.55 + 0.45 * (1 - along));
    const i = (y * size + x) * 4;
    img.data[i] = 255; img.data[i + 1] = 244; img.data[i + 2] = 220; img.data[i + 3] = Math.max(0, Math.min(255, a * 255));
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, false, true);
}

export function smokeTexture() {
  const S = 128; const c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const nz = makeNoise2D(7);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
    const r = Math.sqrt(dx * dx + dy * dy);
    const n = nz(x / 20, y / 20) * 0.5 + nz(x / 9, y / 9) * 0.25;
    const a = Math.max(0, 1 - r) ** 1.5 * (0.7 + n);
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.max(0, Math.min(255, a * 255));
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, false, true);
}

export function textTexture(text, opts = {}) {
  const { w = 512, h = 128, bg = '#0b5d2a', fg = '#fff', font = 'bold 64px Arial', border = true, sub = null } = opts;
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  if (border) { ctx.strokeStyle = fg; ctx.lineWidth = 6; ctx.strokeRect(8, 8, w - 16, h - 16); }
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, sub ? h * 0.38 : h / 2);
  if (sub) { ctx.font = 'bold 34px Arial'; ctx.fillText(sub, w / 2, h * 0.75); }
  return tex(c, false, true);
}

let _tokyoSignCache = null;
export function tokyoSignTextures() {
  if (_tokyoSignCache) return _tokyoSignCache;
  const H_SIGNS = [
    { jp: '東京ナイト', en: 'TOKYO NIGHT · 首都高', bg1: '#180526', bg2: '#070a1c', fg: '#ff2aa4', sub: '#00f0ff', accent: '#ff2aa4' },
    { jp: '湾岸ミッドナイト', en: 'WANGAN EXPRESS · C1', bg1: '#041428', bg2: '#020812', fg: '#00f0ff', sub: '#ffe640', accent: '#00f0ff' },
    { jp: 'レッドライン', en: 'REDLINE DRIFT CLUB', bg1: '#26060c', bg2: '#0a0408', fg: '#ff3a3a', sub: '#ffae00', accent: '#ff3a3a' },
    { jp: '渋谷スクランブル', en: 'SHIBUYA VISION 24H', bg1: '#0a0628', bg2: '#1d0832', fg: '#b84dff', sub: '#00ffcc', accent: '#00ffcc' },
    { jp: '秋葉原サイバー', en: 'AKIBA CYBER ARCADE', bg1: '#051e1c', bg2: '#040a14', fg: '#00ff9d', sub: '#ff38b8', accent: '#00ff9d' },
    { jp: '新宿歌舞伎町', en: 'KABUKICHO NEON PLAZA', bg1: '#280818', bg2: '#0c0410', fg: '#ffae00', sub: '#ff2a70', accent: '#ffae00' },
  ];
  const V_SIGNS = [
    { chars: ['新', '宿', '夜', '景'], sub: 'SHINJUKU', bg: '#160420', fg: '#ff2a95', border: '#00f0ff' },
    { chars: ['湾', '岸', '最', '速'], sub: 'WANGAN', bg: '#031224', fg: '#00f0ff', border: '#ffae00' },
    { chars: ['渋', '谷', '電', '脳'], sub: 'SHIBUYA', bg: '#100528', fg: '#c44dff', border: '#ff2a95' },
    { chars: ['一', '番', 'ラ', 'ー', 'メ', 'ン'], sub: 'RAMEN 24H', bg: '#260606', fg: '#ffe040', border: '#ff3030' },
    { chars: ['ゲ', 'ー', 'ム', '天', '国'], sub: 'ARCADE', bg: '#041c18', fg: '#00ff95', border: '#00e5ff' },
    { chars: ['東', '京', 'ドリ', 'フト'], sub: 'DRIFT', bg: '#1e0a04', fg: '#ff881a', border: '#ffe640' },
  ];
  const horiz = H_SIGNS.map((s) => {
    const W = 512, H = 256;
    const c = canvas(W, H), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, s.bg1); g.addColorStop(1, s.bg2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // scanlines
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2);
    // neon frame
    ctx.strokeStyle = s.accent; ctx.lineWidth = 8; ctx.shadowColor = s.accent; ctx.shadowBlur = 18;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.strokeStyle = s.sub; ctx.lineWidth = 2; ctx.strokeRect(20, 20, W - 40, H - 40);
    // main kanji
    ctx.fillStyle = s.fg; ctx.shadowColor = s.fg; ctx.shadowBlur = 22;
    ctx.font = '900 72px "Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s.jp, W / 2, H * 0.42);
    // subtitle
    ctx.fillStyle = s.sub; ctx.shadowColor = s.sub; ctx.shadowBlur = 14;
    ctx.font = '700 30px "Rajdhani", Arial, sans-serif';
    ctx.fillText(s.en, W / 2, H * 0.77);
    return tex(c, false, true);
  });
  const vert = V_SIGNS.map((s) => {
    const W = 128, H = 512;
    const c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = s.bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = s.border; ctx.lineWidth = 6; ctx.shadowColor = s.border; ctx.shadowBlur = 14;
    ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.fillStyle = s.fg; ctx.shadowColor = s.fg; ctx.shadowBlur = 18;
    ctx.font = '900 54px "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const n = s.chars.length;
    const span = H * 0.74;
    s.chars.forEach((ch, i) => {
      ctx.fillText(ch, W / 2, 46 + (i + 0.5) * (span / n));
    });
    ctx.fillStyle = '#ffffff'; ctx.shadowColor = s.border; ctx.shadowBlur = 10;
    ctx.font = '700 20px "Rajdhani", Arial, sans-serif';
    ctx.fillText(s.sub, W / 2, H - 26);
    return tex(c, false, true);
  });
  _tokyoSignCache = { horiz, vert };
  return _tokyoSignCache;
}
