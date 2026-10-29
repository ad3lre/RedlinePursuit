// ===== Arcade feel director: couples cam / blur / rumble / audio punches into one event =====
import { clamp, damp } from './util.js';

/** Presets: strength is 0..1+, duration in seconds for the visual kick decay. */
const PRESETS = {
  nitro:     { fov: 8,  blur: 0.55, shake: 0.35, rumbleMs: 280, rumbleLo: 0.45, rumbleHi: 0.75, bloom: 0.35 },
  nearMiss:  { fov: 4,  blur: 0.4,  shake: 0.22, rumbleMs: 140, rumbleLo: 0.2,  rumbleHi: 0.85, bloom: 0.15 },
  graze:     { fov: 1.5,blur: 0.12, shake: 0.12, rumbleMs: 70,  rumbleLo: 0.25, rumbleHi: 0.35, bloom: 0 },
  hit:       { fov: 3,  blur: 0.22, shake: 0.45, rumbleMs: 160, rumbleLo: 0.55, rumbleHi: 0.4,  bloom: 0.08 },
  smash:     { fov: 6,  blur: 0.35, shake: 0.95, rumbleMs: 320, rumbleLo: 1.0,  rumbleHi: 0.55, bloom: 0.2 },
  driftEnter:{ fov: 2,  blur: 0.15, shake: 0.1,  rumbleMs: 90,  rumbleLo: 0.15, rumbleHi: 0.45, bloom: 0.05 },
  driftExit: { fov: 5,  blur: 0.4,  shake: 0.28, rumbleMs: 200, rumbleLo: 0.35, rumbleHi: 0.7,  bloom: 0.25 },
  landing:   { fov: 2,  blur: 0.1,  shake: 0.4,  rumbleMs: 180, rumbleLo: 0.5,  rumbleHi: 0.35, bloom: 0 },
  heatUp:    { fov: 3,  blur: 0.2,  shake: 0.2,  rumbleMs: 220, rumbleLo: 0.3,  rumbleHi: 0.5,  bloom: 0.1 },
};

export class Feel {
  constructor() {
    this.fovKick = 0;
    this.blurKick = 0;
    this.bloomKick = 0;
    this.nitroBoost = 0; // extra nitro edge intensity beyond binary nitroActive
    this.speedBias = 0;  // temporary "lie about speed" for post FX
  }

  /** Fire a named arcade event. `scale` multiplies the preset (default 1). */
  punch(kind, scale = 1, ctx = null) {
    const p = PRESETS[kind];
    if (!p) return;
    const s = clamp(scale, 0.15, 1.6);
    this.fovKick = Math.max(this.fovKick, p.fov * s);
    this.blurKick = Math.max(this.blurKick, p.blur * s);
    this.bloomKick = Math.max(this.bloomKick, (p.bloom || 0) * s);
    if (kind === 'nitro' || kind === 'driftExit') this.nitroBoost = Math.max(this.nitroBoost, 0.55 * s);
    if (kind === 'nearMiss' || kind === 'nitro') this.speedBias = Math.max(this.speedBias, 0.35 * s);
    if (ctx?.rig && p.shake) ctx.rig.addShake(p.shake * s);
    if (ctx?.input && p.rumbleMs) ctx.input.vibrate(p.rumbleMs * s, p.rumbleLo * s, p.rumbleHi * s);
  }

  update(dt) {
    this.fovKick = damp(this.fovKick, 0, 5.5, dt);
    this.blurKick = damp(this.blurKick, 0, 4.2, dt);
    this.bloomKick = damp(this.bloomKick, 0, 3.5, dt);
    this.nitroBoost = damp(this.nitroBoost, 0, 3.8, dt);
    this.speedBias = damp(this.speedBias, 0, 3.2, dt);
  }

  /** Classify impact magnitude into graze / hit / smash. */
  static impactTier(impact) {
    if (impact < 6) return 'graze';
    if (impact < 16) return 'hit';
    return 'smash';
  }
}
