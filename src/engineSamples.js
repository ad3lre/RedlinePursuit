// ===== Recorded engine layer: real-car RPM sample banks =====
// Short seamless loops cut from real recordings (CC BY 3.0, see assets/CREDITS.md; built by tools/prepEngineSamples.py).
// Each loop was recorded at a known steady RPM. At runtime every loop plays continuously; the two loops bracketing the
// current engine RPM are crossfaded (equal power) and each is pitch-shifted by playbackRate = rpm / sampleRpm.
import bank from '../assets/audio/engine/bank.json';
import viper0 from '../assets/audio/engine/viper_0.wav';
import viper1 from '../assets/audio/engine/viper_1.wav';
import viper2 from '../assets/audio/engine/viper_2.wav';
import kaiser0 from '../assets/audio/engine/kaiser_0.wav';
import kaiser1 from '../assets/audio/engine/kaiser_1.wav';
import kaiser2 from '../assets/audio/engine/kaiser_2.wav';
import kaiser3 from '../assets/audio/engine/kaiser_3.wav';
import bruiser0 from '../assets/audio/engine/bruiser_0.wav';
import bruiser1 from '../assets/audio/engine/bruiser_1.wav';
import bruiser2 from '../assets/audio/engine/bruiser_2.wav';
import gt3rs0 from '../assets/audio/engine/gt3rs_0.wav';
import gt3rs1 from '../assets/audio/engine/gt3rs_1.wav';
import gt3rs2 from '../assets/audio/engine/gt3rs_2.wav';
import gt3rs3 from '../assets/audio/engine/gt3rs_3.wav';
import mini0 from '../assets/audio/engine/mini_0.wav';
import mini1 from '../assets/audio/engine/mini_1.wav';
import mini2 from '../assets/audio/engine/mini_2.wav';
import mini3 from '../assets/audio/engine/mini_3.wav';
import vito0 from '../assets/audio/engine/vito_0.wav';
import vito1 from '../assets/audio/engine/vito_1.wav';
import vito2 from '../assets/audio/engine/vito_2.wav';

const DATA = {
  'viper_0.wav': viper0, 'viper_1.wav': viper1, 'viper_2.wav': viper2,
  'kaiser_0.wav': kaiser0, 'kaiser_1.wav': kaiser1, 'kaiser_2.wav': kaiser2, 'kaiser_3.wav': kaiser3,
  'bruiser_0.wav': bruiser0, 'bruiser_1.wav': bruiser1, 'bruiser_2.wav': bruiser2,
  'gt3rs_0.wav': gt3rs0, 'gt3rs_1.wav': gt3rs1, 'gt3rs_2.wav': gt3rs2, 'gt3rs_3.wav': gt3rs3,
  'mini_0.wav': mini0, 'mini_1.wav': mini1, 'mini_2.wav': mini2, 'mini_3.wav': mini3,
  'vito_0.wav': vito0, 'vito_1.wav': vito1, 'vito_2.wav': vito2,
};

const decoded = new Map(); // file -> Promise<AudioBuffer>
function decode(ctx, file) {
  if (!decoded.has(file)) {
    const bytes = DATA[file];
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    decoded.set(file, ctx.decodeAudioData(copy).catch(() => null));
  }
  return decoded.get(file);
}

export function hasBank(carId) { return !!(carId && bank[carId]); }

/**
 * Sample layer for one engine voice. Output node `out` should be mixed into the engine chain.
 */
export class EngineSampler {
  constructor(ctx) {
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 4000; this.tone.Q.value = 0.5;
    this.tone.connect(this.out);
    this.voices = []; this.carId = null; this.ready = false; this._gen = 0;
  }

  async setCar(carId) {
    if (carId === this.carId) return;
    this.carId = carId;
    const gen = ++this._gen;
    for (const v of this.voices) { try { v.src.stop(); } catch (e) { /* */ } v.g.disconnect(); }
    this.voices = []; this.ready = false;
    const list = bank[carId];
    if (!list) return;
    const bufs = await Promise.all(list.map((s) => decode(this.ctx, s.file)));
    if (gen !== this._gen || bufs.some((b) => !b)) return;
    const ctx = this.ctx;
    this.voices = list.map((s, i) => {
      const src = ctx.createBufferSource(); src.buffer = bufs[i]; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(g); g.connect(this.tone);
      // random start offset so stacked loops never phase-align
      src.start(0, Math.random() * bufs[i].duration);
      return { src, g, rpm: s.rpm };
    });
    this.ready = true;
  }

  /** rpm: absolute engine RPM; thr 0..1; level: overall gain; now: ctx time */
  update(rpm, thr, level, now) {
    if (!this.ready || !this.voices.length) { this.out.gain.setTargetAtTime(0, now, 0.05); return; }
    const vs = this.voices;
    // find bracketing pair
    let hi = vs.findIndex((v) => v.rpm >= rpm);
    if (hi === -1) hi = vs.length - 1;
    const lo = Math.max(0, hi - 1);
    let t = 0;
    if (hi !== lo) t = Math.min(1, Math.max(0, (Math.log(rpm) - Math.log(vs[lo].rpm)) / (Math.log(vs[hi].rpm) - Math.log(vs[lo].rpm))));
    else t = 1;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      const w = i === lo && i === hi ? 1 : i === lo ? Math.cos(t * Math.PI / 2) : i === hi ? Math.sin(t * Math.PI / 2) : 0;
      // clamp pitch shift: beyond ~2.4x the recording turns cartoonish; the synth layer covers the rest
      const rate = Math.min(2.4, Math.max(0.45, rpm / v.rpm));
      v.src.playbackRate.setTargetAtTime(rate, now, 0.03);
      v.g.gain.setTargetAtTime(w, now, 0.04);
    }
    // off-throttle sounds duller / quieter (overrun), on load opens up
    this.tone.frequency.setTargetAtTime(1600 + thr * 5200 + Math.min(1, rpm / 7000) * 1500, now, 0.06);
    this.out.gain.setTargetAtTime(level * (0.55 + 0.45 * thr), now, 0.04);
  }

  /** how much of the current RPM is beyond the bank's highest recording (0..1) — synth fills that region */
  overTop(rpm) {
    if (!this.voices.length) return 1;
    const top = this.voices[this.voices.length - 1].rpm * 2.4;
    return Math.min(1, Math.max(0, (rpm - top * 0.8) / (top * 0.4)));
  }
}
