// ===== Procedural music (split from audio.js) =====
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(a) {
    this.a = a; this.ctx = a.ctx;
    this.bpm = 128; this.step = 0; this.nextTime = 0; this.level = 0; this.targetLevel = 0; this.playing = false;
    this.bar = 0;
    this.prog = [
      { root: 45, tones: [0, 3, 7] }, // Am
      { root: 41, tones: [0, 4, 7] }, // F
      { root: 48, tones: [0, 4, 7] }, // C
      { root: 43, tones: [0, 4, 7] }, // G
    ];
    this.progB = [
      { root: 45, tones: [0, 3, 7] }, { root: 45, tones: [0, 3, 7] }, { root: 41, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] },
      { root: 38, tones: [0, 3, 7] }, { root: 41, tones: [0, 4, 7] }, { root: 40, tones: [0, 4, 7] }, { root: 40, tones: [0, 4, 7] },
    ];
    this.lead = [12, -1, 10, 12, -1, 15, -1, 12, 10, -1, 7, -1, 10, -1, 12, -1, 7, -1, 5, 7, -1, 10, -1, 7, 3, -1, 5, -1, 7, -1, -1, -1];
    this.out = this.ctx.createGain(); this.out.gain.value = 0.9; this.out.connect(a.musicBus);
    this.bassDist = this.ctx.createWaveShaper();
    const c = new Float32Array(512); for (let i = 0; i < 512; i++) { const x = i / 256 - 1; c[i] = Math.tanh(x * 3); } this.bassDist.curve = c;
    this.bassBus = this.ctx.createGain(); this.bassBus.connect(this.out);
    this.bassDist.connect(this.bassBus);
  }
  start() {
    if (this.playing) return;
    this.playing = true; this.nextTime = this.ctx.currentTime + 0.1; this.step = 0; this.bar = 0;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  stop() { this.playing = false; clearInterval(this.timer); }
  setLevel(l) { this.targetLevel = l; }
  schedule() {
    const spb = 60 / this.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime, spb);
      this.nextTime += spb;
      this.step++;
      if (this.step % 16 === 0) { this.bar++; this.level = this.targetLevel; }
    }
  }
  playStep(step, t, spb) {
    const s = step % 16, lv = this.level;
    const useB = lv >= 2;
    const prog = useB ? this.progB : this.prog;
    const ch = prog[this.bar % prog.length];
    // pads at bar start
    if (s === 0) this.pad(t, ch, spb * 16, lv);
    // drums
    if (lv >= 1) {
      if (s % 4 === 0) this.kick(t, 1);
      if (lv >= 2 && (s === 4 || s === 12)) this.snare(t, 1);
      if (lv >= 2 && this.bar % 4 === 3 && s >= 12) this.snare(t, 0.4 + (s - 12) * 0.15);
      if (lv >= 3 && s === 0 && this.bar % 4 === 0) this.crash(t);
    }
    if (s % 2 === 1 || lv >= 2) this.hat(t, s % 4 === 2 ? 0.6 : 0.3, lv >= 1 && s % 4 === 2);
    if (lv === 0 && s % 4 === 2) this.hat(t, 0.15, false);
    // bass
    if (lv === 0) { if (s === 0) this.bass(t, ch.root - 12, spb * 14, 0.5, lv); }
    else if (lv === 1) { if (s % 4 === 2 || s % 8 === 0) this.bass(t, ch.root - 12 + (s % 8 === 6 ? 12 : 0), spb * 1.6, 0.8, lv); }
    else { const oct = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 0, 12, 3, 0][s]; this.bass(t, ch.root - 12 + oct, spb * 0.9, 0.85, lv); }
    // arp
    if (lv >= 2) {
      const seq = [0, 1, 2, 3, 2, 1, 0, 2, 1, 2, 3, 4, 3, 2, 1, 2];
      const idx = seq[s];
      const tone = ch.tones[idx % 3] + 12 * Math.floor(idx / 3);
      this.arp(t, ch.root + 12 + tone, spb * 0.9);
    } else if (lv === 1 && s % 2 === 0) {
      const tone = ch.tones[(s / 2) % 3];
      this.arp(t, ch.root + 24 + tone, spb * 0.7, 0.5);
    }
    // lead
    if (lv >= 3 && s % 2 === 0) {
      const li = ((this.bar % 4) * 8 + s / 2) % this.lead.length;
      const n = this.lead[li];
      if (n >= 0) this.leadNote(t, 57 + n, spb * 2.2);
    }
  }
  vgain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  kick(t, v) {
    const c = this.ctx; const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9 * v, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.4);
  }
  snare(t, v) {
    const c = this.ctx; const s = this.a.noiseSrc(false); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35 * v, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    s.connect(f); f.connect(g); g.connect(this.out); g.connect(this.a.revSend); s.start(t, Math.random()); s.stop(t + 0.25);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
    const g2 = c.createGain(); g2.gain.setValueAtTime(0.3 * v, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g2); g2.connect(this.out); o.start(t); o.stop(t + 0.15);
  }
  hat(t, v, open) {
    const c = this.ctx; const s = this.a.noiseSrc(false); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const d = open ? 0.22 : 0.045;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.13 * v, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t, Math.random()); s.stop(t + d + 0.02);
  }
  crash(t) {
    const c = this.ctx; const s = this.a.noiseSrc(false); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4000;
    const g = c.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    s.connect(f); f.connect(g); g.connect(this.out); g.connect(this.a.revSend); s.start(t, Math.random()); s.stop(t + 1.7);
  }
  bass(t, note, dur, v, lv) {
    const c = this.ctx; const f = mtof(note);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = f / 2;
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 6;
    const peak = lv >= 2 ? 1600 : 900;
    flt.frequency.setValueAtTime(120, t); flt.frequency.linearRampToValueAtTime(peak, t + 0.01); flt.frequency.exponentialRampToValueAtTime(180, t + Math.max(0.08, dur));
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.28 * v, t + 0.005); g.gain.setValueAtTime(0.28 * v, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = this.vgain(0.5);
    o.connect(flt); o2.connect(g2); g2.connect(flt); flt.connect(g);
    g.connect(lv >= 3 ? this.bassDist : this.bassBus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }
  arp(t, note, dur, v = 1) {
    const c = this.ctx; const o = c.createOscillator(); o.type = 'square'; o.frequency.value = mtof(note);
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.setValueAtTime(3200, t); flt.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(flt); flt.connect(g); g.connect(this.out); g.connect(this.a.delaySend);
    o.start(t); o.stop(t + dur + 0.02);
  }
  leadNote(t, note, dur) {
    const c = this.ctx; const f = mtof(note);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.02); g.gain.setValueAtTime(0.05, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 2800;
    const vib = c.createOscillator(); vib.frequency.value = 5.5; const vg = c.createGain(); vg.gain.value = f * 0.01; vib.connect(vg);
    for (const d of [0, 7, -7]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; vg.connect(o.frequency);
      o.connect(flt); o.start(t); o.stop(t + dur + 0.02);
    }
    flt.connect(g); g.connect(this.out); g.connect(this.a.delaySend); g.connect(this.a.revSend);
    vib.start(t); vib.stop(t + dur + 0.02);
  }
  pad(t, ch, dur, lv) {
    const c = this.ctx;
    const g = c.createGain(); const peak = lv >= 2 ? 0.035 : 0.05;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.5); g.gain.setValueAtTime(peak, t + dur - 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = lv >= 2 ? 1400 : 900; flt.Q.value = 1;
    flt.connect(g); g.connect(this.out); g.connect(this.a.revSend);
    for (const tn of ch.tones) for (const d of [-8, 8]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(ch.root + 12 + tn); o.detune.value = d;
      o.connect(flt); o.start(t); o.stop(t + dur + 0.5);
    }
  }
}
