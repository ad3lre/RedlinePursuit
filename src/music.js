// ===== Redline soundtrack DJ =====
// Default: shuffled Suno playlist. Synth beds / Echo radio are opt-in via Settings.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const ramp = (x, a, w) => Math.min(1, Math.max(0, (x - a) / w));
const LOW_CPU = (typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches)
  || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

const PHRASES = [
  [0, -1, -1, 2, -1, 3, -1, -1, 4, -1, 3, -1, 2, -1, -1, -1],
  [3, -1, 2, -1, 0, -1, -1, 1, -1, 2, -1, -1, 3, -1, 4, -1],
  [4, -1, -1, 3, -1, 2, -1, 3, 4, -1, -1, 5, -1, 4, -1, -1],
  [2, -1, 0, -1, 2, -1, 3, -1, -1, 2, -1, 0, -1, -1, 1, -1],
];
const ARP1 = [0, 1, 2, 3, 2, 1, 2, 4, 0, 1, 2, 5, 4, 3, 2, 1];
const ARP2 = [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 2, 1, 3, 2, 1];
const ARP3 = [0, 3, 1, 4, 2, 5, 3, 4, 0, 3, 1, 4, 2, 5, 4, 3];
const ch = (r, ...t) => ({ r, t });

/**
 * Pursuit / neon-night synthwave beds — deeper, moodier, cinematic.
 * energy 0..1 drives next-track pick vs heat/level.
 */
const PRESETS = [
  {
    id: 'afterglow', title: 'Afterglow', bpm: 96, energy: 0.28, loops: 3, arp: ARP2,
    arpWave: 'triangle', padWave: 'sawtooth', leadWave: 'sine', bassWave: 'sine',
    // Am9 — Fmaj7 — C — Em  (dusk cruise)
    chords: [ch(45, 57, 60, 64, 67), ch(41, 53, 57, 60, 64), ch(48, 55, 60, 64), ch(40, 55, 59, 64),
      ch(45, 57, 60, 64, 67), ch(41, 53, 57, 60, 64), ch(43, 55, 58, 62), ch(45, 52, 57, 60)],
    bass: { 0: 0, 8: 0, 12: 7 }, pent: [64, 67, 69, 72, 74, 76],
    kicks: [0, 8], ghost: [], snares: [12], hats: 'eighth', adjust: (m) => m,
  },
  {
    id: 'neon-rain', title: 'Neon Rain', bpm: 108, energy: 0.45, loops: 3, arp: ARP2,
    arpWave: 'triangle', padWave: 'sawtooth', leadWave: 'triangle', bassWave: 'sawtooth',
    // Dm — Bb — F — C  (wet streets)
    chords: [ch(38, 50, 53, 57), ch(46, 53, 58, 62), ch(41, 53, 57, 60), ch(48, 52, 55, 60),
      ch(38, 50, 53, 57), ch(46, 53, 58, 62), ch(43, 55, 58, 62), ch(45, 52, 57, 61)],
    bass: { 0: 0, 7: 0, 10: 7, 14: 12 }, pent: [62, 65, 67, 69, 72, 74],
    kicks: [0, 8], ghost: [6], snares: [8], hats: 'eighth',
    adjust: (m, bar) => (bar === 7 && m % 12 === 0 ? m + 1 : m),
  },
  {
    id: 'night-drive', title: 'Night Drive', bpm: 114, energy: 0.55, loops: 3, arp: ARP1,
    arpWave: 'square', padWave: 'sawtooth', leadWave: 'triangle', bassWave: 'sawtooth',
    // Am — F — C — G  (classic night-drive)
    chords: [ch(45, 57, 60, 64), ch(41, 53, 57, 60), ch(48, 55, 60, 64), ch(43, 55, 59, 62),
      ch(45, 57, 60, 64), ch(41, 53, 57, 60), ch(43, 55, 59, 62), ch(40, 56, 59, 64)],
    bass: { 0: 0, 3: 0, 6: 12, 8: 0, 11: 7, 13: 12 }, pent: [69, 72, 74, 76, 79, 81],
    kicks: [0, 4, 8, 12], ghost: [10], snares: [4, 12], hats: 'eighth',
    adjust: (m, bar) => (bar === 7 ? (m % 12 === 7 ? m + 1 : m % 12 === 0 ? m - 1 : m) : m),
  },
  {
    id: 'redline-heat', title: 'Redline Heat', bpm: 122, energy: 0.72, loops: 3, arp: ARP3,
    arpWave: 'square', padWave: 'sawtooth', leadWave: 'sawtooth', bassWave: 'sawtooth',
    // Em — C — G — D  (pursuit building)
    chords: [ch(40, 52, 55, 59), ch(48, 55, 60, 64), ch(43, 55, 59, 62), ch(38, 54, 57, 62),
      ch(40, 52, 55, 59), ch(48, 55, 60, 64), ch(38, 54, 57, 62), ch(40, 52, 55, 59)],
    bass: { 0: 0, 2: 0, 4: 0, 6: 12, 8: 0, 10: 0, 12: 7, 14: 12 }, pent: [64, 67, 69, 71, 74, 76],
    kicks: [0, 4, 8, 12], ghost: [14], snares: [4, 12], hats: 'eighth', adjust: (m) => m,
  },
  {
    id: 'blackout-run', title: 'Blackout Run', bpm: 128, energy: 0.88, loops: 3, arp: ARP1,
    arpWave: 'square', padWave: 'sawtooth', leadWave: 'sawtooth', bassWave: 'sawtooth',
    // Em — Bm — C — D  (helicopter heat)
    chords: [ch(40, 52, 55, 59), ch(35, 47, 50, 54), ch(48, 55, 60, 64), ch(38, 50, 54, 57),
      ch(40, 52, 55, 59), ch(35, 47, 50, 54), ch(38, 54, 57, 62), ch(38, 54, 57, 62)],
    bass: { 0: 0, 2: 0, 4: 12, 6: 0, 8: 0, 10: 12, 12: 7, 14: 12 }, pent: [64, 67, 71, 74, 76, 79],
    kicks: [0, 4, 8, 12], ghost: [6, 14], snares: [4, 12], hats: 'eighth', adjust: (m) => m,
  },
  {
    id: 'coast-escape', title: 'Coast Escape', bpm: 102, energy: 0.38, loops: 2, arp: ARP2,
    arpWave: 'sine', padWave: 'sawtooth', leadWave: 'sine', bassWave: 'triangle',
    // F — Am — Dm — G  (breath after the chase)
    chords: [ch(41, 53, 57, 60), ch(45, 57, 60, 64), ch(38, 50, 53, 57), ch(43, 55, 59, 62),
      ch(41, 53, 57, 60), ch(45, 57, 60, 64), ch(38, 50, 53, 57), ch(43, 55, 58, 62)],
    bass: { 0: 0, 8: 0, 12: 7 }, pent: [65, 67, 69, 72, 74, 76],
    kicks: [0, 8], ghost: [], snares: [12], hats: 'eighth', adjust: (m) => m,
  },
];

const BARS = 8;
const XFADE = 2.4; // shorter handoff — less mud
const PREFETCH = 20;
const MIXES = ['playlist', 'synth', 'radio'];
const MIX_LABEL = { playlist: 'Playlist', synth: 'Pursuit', radio: 'Radio (Echo)' };

// Default Suno playlist — shuffled bag, never energy-weighted.
const SUNO = [
  ['one-breath-a', 'One Breath Then We\'re Gone', 0.55, 227],
  ['one-breath-b', 'One Breath Then We\'re Gone (B)', 0.55, 238],
  ['thread-of-red-a', 'Thread of Red', 0.7, 274],
  ['thread-of-red-b', 'Thread of Red (B)', 0.72, 280],
  ['messages-from-the-stars', 'Messages From the Stars', 0.5, 180],
  ['broken-hearted', 'Broken Hearted', 0.45, 243],
  ['tommie', 'Tommie', 0.65, 106],
  ['president-a', 'President', 0.6, 83],
  ['president-b', 'President (B)', 0.6, 87],
  ['rj', 'RJ', 0.5, 63],
  ['deep-cut', 'Deep Cut', 0.6, 240],
  ['prison-of-shadows', 'Prison of Shadows', 0.55, 135],
  ['did-you-return-it', 'Did You Return It?', 0.65, 225],
  ['indo', 'INDO!', 0.75, 165],
].map(([id, title, e, d]) => ({
  id: 'suno-' + id, kind: 'suno', title, group: 'Playlist', e, d,
  url: 'audio/playlist/' + id + '.mp3',
}));

// Echo ringtones — opt-in only (mix === 'radio').
const ECHO = [
  ['kiki', 'Kiki', 'Bops', 0.7, 120], ['beach-bowling', 'Beach Bowling', 'Bops', 0.5, 92], ['impala', 'Impala', 'Bops', 0.62, 120],
  ['glitch-dance', 'Glitch Dance', 'Dialtone', 0.85, 120], ['glitchy-banger', 'Glitchy Banger', 'Dialtone', 0.92, 96], ['digi-date', 'Digi-date', 'Dialtone', 0.6, 120],
  ['echo-machine', 'Echo Machine', 'Dialtone', 0.72, 120], ['fnc-dance', 'FNC Dance', 'Dialtone', 0.8, 60],
  ['8bit-battle', '8-Bit Battle', 'Retro', 0.95, 60], ['pixel-dance', 'Pixel Dance', 'Retro', 0.75, 90], ['pixel-party', 'Pixel Party', 'Retro', 0.66, 85],
  ['rsl', 'RSL', 'Retro', 0.6, 120], ['80s-commercial', '80s Commercial', 'Retro', 0.5, 120],
  ['neutron', 'Neutron', 'Vibes', 0.7, 120], ['galaxy-dance', 'Galaxy Dance', 'Vibes', 0.76, 120], ['galactic-drake', 'Galactic Drake', 'Vibes', 0.6, 120],
  ['groovey-glass', 'Groovey Glass', 'Vibes', 0.42, 120], ['glass-wait', 'Glass Wait', 'Vibes', 0.3, 88], ['modest-ring', 'Modest Ring', 'Vibes', 0.35, 117],
  ['wobbly-glass', 'Wobbly Glass', 'Vibes', 0.46, 120], ['downward-spiraling', 'Downward Spiraling', 'Vibes', 0.3, 120], ['one-eight-nine', 'One Eight Nine', 'Vibes', 0.4, 87],
].map(([id, title, group, e, d]) => ({
  id: 'echo-' + id, kind: 'echo', title, group, e, d,
  url: 'audio/echo/' + id + '.mp3',
}));

const SYNTH = PRESETS.map((P) => ({ id: P.id, kind: 'synth', title: P.title, group: 'Pursuit', e: P.energy, P }));
const PLAYLIST = [...SUNO, ...SYNTH, ...ECHO];
const isBed = (k) => k === 'echo' || k === 'suno';

let _noise = null;
function noiseBuffer(c) {
  if (_noise && _noise.sampleRate === c.sampleRate) return _noise;
  const len = c.sampleRate;
  _noise = c.createBuffer(1, len, c.sampleRate);
  const d = _noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return _noise;
}

/** Safe gain ramp (avoids setValueCurveAtTime exceptions that leave two tracks full-volume). */
function fadeGain(g, t, to, dur) {
  const from = Math.max(0.0001, g.value);
  try { g.cancelScheduledValues(t); } catch { /* */ }
  g.setValueAtTime(from, t);
  g.linearRampToValueAtTime(Math.max(0.0001, to), t + dur);
}

class SynthTrack {
  constructor(ctx, dest, P) {
    this.ctx = ctx; this.P = P; this.kind = 'synth'; this.def = null; this.dead = false;
    this.step = 60 / P.bpm / 4;
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(dest);
    this.bus = ctx.createGain(); this.bus.connect(this.out);
    this.pump = ctx.createGain(); this.pump.connect(this.bus);
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = this.step * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 1800;
    this.delay.connect(dlp); dlp.connect(fb); fb.connect(this.delay);
    const wet = ctx.createGain(); wet.gain.value = 0.22; dlp.connect(wet); wet.connect(this.pump);
    this.send = ctx.createGain(); this.send.connect(this.delay);
    this.pan = [-0.3, 0.3].map((p) => {
      const n = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      if (n.pan) n.pan.value = p;
      n.connect(this.pump); n.connect(this.send); return n;
    });
    this.noise = noiseBuffer(ctx);
    this.target = 0.14; this.level = 0.14; this.stepNo = 0; this.next = 0;
  }
  start(t0) { this.next = t0; this.stepNo = 0; }
  tick(until) {
    if (this.dead) return;
    while (this.next < until) { this.play(this.stepNo, this.next); this.next += this.step; this.stepNo++; }
  }
  remaining() { return (this.P.loops * BARS * 16 - this.stepNo) * this.step; }
  setMood(tgt, duck, instant) {
    this.target = tgt;
    if (instant) this.level = tgt;
    this.bus.gain.setTargetAtTime(duck, this.ctx.currentTime, 0.3);
  }
  stop() {
    this.dead = true;
    try { this.out.gain.value = 0; this.out.disconnect(); } catch { /* */ }
  }

  tone(type, freq, t, dur, dest, o = {}) {
    if (this.dead) return;
    const c = this.ctx, osc = c.createOscillator(), g = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + (o.slideT ?? dur));
    if (o.detune) osc.detune.value = o.detune;
    let last = osc;
    if (o.lp) {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o.q ?? 0.7;
      f.frequency.setValueAtTime(o.lp, t); if (o.lpEnd) f.frequency.exponentialRampToValueAtTime(o.lpEnd, t + dur);
      osc.connect(f); last = f;
    }
    const a = o.a ?? 0.004, r = o.r ?? 0.08, v = o.v ?? 0.1;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a);
    if (o.hold) { g.gain.setValueAtTime(v, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + r); }
    else g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    last.connect(g); g.connect(dest); osc.start(t); osc.stop(t + dur + (o.hold ? r : 0) + 0.03);
  }
  hit(t, dur, v, type, f, q, dest) {
    if (this.dead) return;
    const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  kick(t, vel) {
    this.tone('sine', 140, t, 0.28, this.bus, { slideTo: 38, slideT: 0.14, v: 0.85 * vel, a: 0.002 });
    this.hit(t, 0.018, 0.12 * vel, 'highpass', 2200, 0.7, this.bus);
    this.pump.gain.cancelScheduledValues(t); this.pump.gain.setValueAtTime(0.45, t); this.pump.gain.linearRampToValueAtTime(1, t + 0.24);
  }
  snare(t, vel) {
    this.hit(t, 0.16, 0.38 * vel, 'bandpass', 1600, 0.7, this.bus);
    this.tone('triangle', 180, t, 0.1, this.bus, { slideTo: 100, v: 0.18 * vel });
  }
  hat(t, vel, open) { this.hit(t, open ? 0.18 : 0.04, 0.1 * vel, 'highpass', 7500, 0.6, this.bus); }

  play(n, t) {
    this.level += (this.target - this.level) * 0.18;
    const P = this.P, L = this.level, s = n % 16, bar = Math.floor(n / 16) % BARS, chord = P.chords[bar];
    const drums = ramp(L, 0.2, 0.15), snare = ramp(L, 0.28, 0.14), arpV = 0.25 + 0.75 * ramp(L, 0.3, 0.3), lead = ramp(L, 0.58, 0.22);
    if (s === 0) {
      const dur = this.step * 16, lp = 480 + L * 900;
      for (const m of chord.t) for (const dt of (LOW_CPU ? [0] : [-6, 6])) {
        this.tone(P.padWave, mtof(m), t, dur, this.pump, {
          v: P.padWave === 'triangle' ? 0.018 : 0.009, a: 0.65, r: 0.9, hold: true, lp, detune: dt,
        });
      }
    }
    if (s in P.bass) {
      const f = mtof(chord.r + P.bass[s]), dur = this.step * 1.7, lv = 0.85 + 0.15 * L;
      this.tone(P.bassWave, f, t, dur, this.bus, { v: 0.22 * lv, lp: 220 + L * 700, lpEnd: 120, q: 2.4, a: 0.006 });
      this.tone('sine', f * 0.5, t, dur, this.bus, { v: 0.28 * lv });
    }
    if (drums > 0.02) {
      if (P.kicks.includes(s)) this.kick(t, 0.45 + 0.55 * drums);
      else if (P.ghost.includes(s) && bar % 2 === 1 && L > 0.75) this.kick(t, 0.7);
    } else if (s === 0 || s === 8) this.kick(t, 0.4);
    if (snare > 0.02 && P.snares.includes(s)) this.snare(t, snare * 0.85);
    if (snare > 0.02 && bar === 7 && s >= 12) this.snare(t + this.step * 0.5, snare * (0.3 + (s - 12) * 0.15));
    if (drums > 0.02) {
      const sixteenth = ramp(L, 0.72, 0.12);
      if (P.hats === 'eighth' && s % 2 === 0) this.hat(t, drums * (s % 4 === 2 ? 0.85 : 0.45), false);
      else if (s % 2 === 0 ? s % 4 === 2 : sixteenth > 0.02) this.hat(t, drums * (s % 4 === 2 ? 0.7 : 0.35 * sixteenth), false);
    }
    if (s % 2 === 0 || L >= 0.45) {
      const notes = [...chord.t, ...chord.t.map((m) => m + 12)], m = notes[P.arp[s] % notes.length];
      this.tone(P.arpWave, mtof(m + 12 * (L > 0.85 && s % 8 === 7 ? 1 : 0)), t, this.step * 0.85, this.pan[n & 1], {
        v: 0.02 * arpV, lp: 1100 + L * 1800, lpEnd: 420, q: 1.6, a: 0.004,
      });
    }
    if (lead > 0.02) {
      const ph = PHRASES[(bar + (bar > 3 ? 1 : 0)) % 4][s];
      if (ph >= 0) {
        const m = P.adjust(P.pent[ph], bar);
        this.tone(P.leadWave, mtof(m), t, this.step * 1.9, this.pan[1], { v: 0.026 * lead, lp: 2200, lpEnd: 700, a: 0.02, r: 0.16 });
        if (!LOW_CPU) this.tone(P.leadWave, mtof(m), t, this.step * 1.9, this.pan[0], { v: 0.012 * lead, lp: 1800, detune: 7, a: 0.02 });
      }
    }
  }
}

class EchoTrack {
  constructor(ctx, dest, def) {
    this.ctx = ctx; this.def = def; this.kind = def.kind === 'suno' ? 'suno' : 'echo'; this.started = false; this.dead = false;
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(dest);
    this.bus = ctx.createGain(); this.bus.connect(this.out);
    this.el = new Audio(); this.el.preload = 'auto'; this.el.loop = false; this.el.crossOrigin = 'anonymous';
    this.el.src = def.url;
    this.src = ctx.createMediaElementSource(this.el); this.src.connect(this.bus);
  }
  ready() {
    const el = this.el;
    if (el.readyState >= 3) return Promise.resolve();
    return new Promise((res, rej) => {
      const done = (f, v) => { el.removeEventListener('canplaythrough', ok); el.removeEventListener('error', bad); clearTimeout(to); f(v); };
      const ok = () => done(res), bad = () => done(rej, new Error('load'));
      const to = setTimeout(() => (el.readyState >= 2 ? done(res) : done(rej, new Error('timeout'))), 10000);
      el.addEventListener('canplaythrough', ok); el.addEventListener('error', bad); el.load();
    });
  }
  start() { this.started = true; return this.el.play().catch(() => {}); }
  remaining() {
    const d = isFinite(this.el.duration) && this.el.duration > 0 ? this.el.duration : this.def.d;
    return this.el.ended ? 0 : d - this.el.currentTime;
  }
  tick() {}
  setMood(tgt, duck) { this.bus.gain.setTargetAtTime(duck * (0.75 + 0.25 * tgt), this.ctx.currentTime, 0.3); }
  get level() { return 0.45; }
  stop() {
    this.dead = true;
    try { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); } catch { /* */ }
    try { this.src.disconnect(); this.out.gain.value = 0; this.out.disconnect(); } catch { /* */ }
  }
}

/**
 * DJ soundtrack. Default mix = shuffled Suno playlist.
 * Synth / Echo radio are opt-in via Settings.
 */
export class Music {
  constructor(a) {
    this.a = a;
    this.ctx = a.ctx;
    this.mix = 'playlist';
    this._level = 0;
    this._heat = 0;
    this.playing = false;
    this.started = false;
    this._bpm = PRESETS[0].bpm;

    this.musicLP = a.ctx.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.frequency.value = 7200;
    this.musicLP.Q.value = 0.5;
    this.musicLP.connect(a.musicBus);

    this.cur = null;
    this.players = [];
    this.pending = null;
    this.switching = false;
    this.history = [];
    this.trackAt = 0;
    this.wasOn = true;
    this.timer = 0;
    this._trackListeners = new Set();
    this._xfadeUntil = 0;
    this._bag = [];
  }

  get bpm() { return this.cur?.kind === 'synth' ? this.cur.P.bpm : this._bpm; }
  set bpm(v) { this._bpm = v; }

  onTrack(fn) { this._trackListeners.add(fn); return () => this._trackListeners.delete(fn); }
  nowPlaying() {
    if (!this.cur) {
      const d = SUNO[0] || SYNTH[0];
      return { id: d.id, title: d.title, group: d.group, kind: d.kind === 'suno' ? 'playlist' : 'synth' };
    }
    const d = this.cur.def;
    const kind = d.kind === 'suno' ? 'playlist' : d.kind === 'echo' ? 'radio' : 'synth';
    return { id: d.id, title: d.title, group: d.group, kind };
  }
  _emitTrack() {
    const np = this.nowPlaying();
    for (const f of this._trackListeners) f(np);
  }

  _normalizeMix(m) {
    if (m === 'all' || !MIXES.includes(m)) return 'playlist';
    return m;
  }

  _defOk(def) {
    if (!def) return false;
    if (this.mix === 'playlist') return def.kind === 'suno';
    if (this.mix === 'radio') return def.kind === 'echo';
    return def.kind === 'synth';
  }

  setMix(m) {
    const next = this._normalizeMix(m);
    if (next === this.mix) return;
    this.mix = next;
    this._bag = [];
    if (!this.playing || !this.cur) return;
    if (!this._defOk(this.cur.def)) {
      this._killPending();
      this._advance();
    } else if (this.pending && !this._defOk(this.pending.def)) {
      this._killPending();
    }
  }

  setLevel(l) {
    this._level = Math.max(0, Math.min(3, l | 0));
    this._applyMood();
  }

  setHeat(h = 0) {
    const next = Math.max(0, Math.min(5, +h || 0));
    const prevTier = this._heat >= 4 ? 2 : this._heat >= 2 ? 1 : 0;
    const nextTier = next >= 4 ? 2 : next >= 2 ? 1 : 0;
    this._heat = next;
    this._applyMood(false, nextTier > prevTier);
  }

  _moodTarget() {
    const L = this._level, H = this._heat;
    if (!this.playing) return { tgt: 0.16, cut: 6200, duck: 1 };
    const tgt = Math.min(1, 0.2 + L * 0.2 + H * 0.05);
    return { tgt, cut: 4200 + tgt * 9000, duck: 1 };
  }

  _applyMood(instant = false, heatJump = false) {
    if (!this.cur || !this.ctx) return;
    const m = this._moodTarget(), t = this.ctx.currentTime;
    this.cur.setMood(m.tgt, m.duck, instant);
    this.musicLP.frequency.setTargetAtTime(m.cut, t, 0.25);
    // heat jump: only swap within current mix, never mid-xfade
    if (heatJump && this.playing && this._level >= 2 && this._heat >= 4 && !this.switching
      && t > this._xfadeUntil && t - this.trackAt > 28) this._advance();
  }

  _pool() {
    if (this.mix === 'radio') return ECHO.slice();
    if (this.mix === 'synth') return SYNTH.slice();
    return SUNO.slice();
  }

  _reshuffleBag(pool) {
    const bag = pool.map((d) => d.id);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
    const curId = this.cur?.def?.id;
    if (curId && bag.length > 1 && bag[0] === curId) {
      const swap = 1 + Math.floor(Math.random() * (bag.length - 1));
      const t = bag[0]; bag[0] = bag[swap]; bag[swap] = t;
    }
    this._bag = bag;
  }

  _pickShuffle() {
    const pool = this._pool();
    if (!pool.length) return SYNTH[0];
    if (!this._bag.length) this._reshuffleBag(pool);
    const id = this._bag.shift();
    return pool.find((d) => d.id === id) || pool[Math.floor(Math.random() * pool.length)];
  }

  _pick() {
    if (this.mix === 'playlist') return this._pickShuffle();
    const pool = this._pool();
    if (!pool.length) return SYNTH[0];
    const avoid = new Set(this.history.slice(-Math.min(4, Math.max(0, pool.length - 2))));
    const cand = pool.filter((d) => !avoid.has(d.id) && d !== this.cur?.def);
    const list = cand.length ? cand : pool;
    const want = 0.22 + 0.58 * this._moodTarget().tgt;
    let tot = 0;
    const w = list.map((d) => (tot += 0.15 + Math.pow(1 - Math.abs(d.e - want), 3)));
    let r = Math.random() * tot;
    for (let i = 0; i < list.length; i++) {
      if ((r -= w[i] - (i ? w[i - 1] : 0)) <= 0 || i === list.length - 1) return list[i];
    }
    return list[0];
  }

  _make(def) {
    if (def.kind === 'synth') {
      const m = new SynthTrack(this.ctx, this.musicLP, def.P);
      m.def = def;
      return m;
    }
    return new EchoTrack(this.ctx, this.musicLP, def);
  }

  _killPending() {
    if (!this.pending) return;
    try { this.pending.tr.stop(); } catch { /* */ }
    this.pending = null;
  }

  _stopAllPlayers() {
    this._killPending();
    for (const p of this.players) { try { p.stop(); } catch { /* */ } }
    this.players = [];
    this.cur = null;
  }

  _prefetch() {
    if (this.pending || !this.ctx || this.switching) return;
    const def = this._pick();
    if (!this._defOk(def)) return;
    let tr;
    try { tr = this._make(def); } catch { return; }
    this.pending = { def, tr, ready: isBed(def.kind) ? tr.ready() : Promise.resolve() };
    this.pending.ready.catch(() => {});
  }

  async _advance() {
    if (this.switching || !this.ctx || !this.playing) return;
    this.switching = true;
    try {
      if (!this.pending) this._prefetch();
      let p = this.pending; this.pending = null;
      if (!p) return;
      // drop pending if mix changed under us
      if (!this._defOk(p.def)) {
        p.tr.stop();
        this._prefetch();
        p = this.pending; this.pending = null;
        if (!p) return;
      }
      try { await p.ready; } catch {
        p.tr.stop();
        const pool = this._pool().filter((d) => d !== this.cur?.def);
        const def = pool[Math.floor(Math.random() * pool.length)] || this._pool()[0] || SYNTH[0];
        p = { def, tr: this._make(def), ready: isBed(def.kind) ? null : Promise.resolve() };
        if (isBed(def.kind)) {
          try { await p.tr.ready(); } catch { p.tr.stop(); return; }
        }
      }
      if (!this.ctx || !this.playing) { p.tr.stop(); return; }

      const t = this.ctx.currentTime + 0.04;
      const old = this.cur;
      const tr = p.tr;
      const m = this._moodTarget();
      tr.setMood(m.tgt, m.duck, true);
      if (tr.kind === 'synth') tr.start(t); else tr.start();

      // only ever two voices during xfade — kill any stuck extras first
      for (const x of this.players) {
        if (x !== old) { try { x.stop(); } catch { /* */ } }
      }
      this.players = old ? [old, tr] : [tr];

      fadeGain(tr.out.gain, t, 1, XFADE);
      if (old) {
        fadeGain(old.out.gain, t, 0.0001, XFADE);
        const dying = old;
        setTimeout(() => {
          try { dying.stop(); } catch { /* */ }
          this.players = this.players.filter((x) => x !== dying && !x.dead);
        }, XFADE * 1000 + 200);
      }

      this.cur = tr;
      this.trackAt = t;
      this._xfadeUntil = t + XFADE + 0.15;
      this.history.push(p.def.id); if (this.history.length > 10) this.history.shift();
      this._emitTrack();
    } finally { this.switching = false; }
  }

  _pump() {
    if (!this.ctx || this.ctx.state !== 'running' || !this.playing) return;
    const musicOn = (this.a.settings?.music ?? 1) > 0;
    const on = musicOn, now = this.ctx.currentTime;

    // only schedule notes for the current track (fading-out synth stops generating — prevents mud)
    for (const p of this.players) {
      if (p.dead) continue;
      if (isBed(p.kind)) {
        if (!p.started) continue;
        if (!on) { if (!p.el.paused) p.el.pause(); }
        else if (p === this.cur && p.el.paused && !p.el.ended) p.el.play().catch(() => {});
        else if (p !== this.cur && !p.el.paused) p.el.pause(); // never leave a second bed running
        continue;
      }
      if (p !== this.cur) continue; // don't tick fading synth — old notes die with gain ramp
      if (!on) { p.next = now + 0.1; continue; }
      if (!this.wasOn) { p.stepNo = Math.ceil(p.stepNo / 16) * 16; p.next = now + 0.1; }
      if (p.next < now - 0.05) p.next = now + 0.05;
      p.tick(now + 0.2);
    }
    this.wasOn = on;
    this.players = this.players.filter((x) => !x.dead);

    if (!on || this.switching || !this.cur || now < this._xfadeUntil) return;
    const rem = this.cur.remaining();
    if (rem < PREFETCH && !this.pending) this._prefetch();
    if (rem < XFADE) this._advance();
  }

  start() {
    if (this.playing) return;
    this._stopAllPlayers();
    this.playing = true; this.started = true;
    this.mix = this._normalizeMix(this.mix);
    this._bag = [];
    const first = this._pick();
    this.cur = this._make(first);
    this.players = [this.cur];
    const m = this._moodTarget();
    this.cur.setMood(m.tgt, m.duck, true);
    this.cur.out.gain.value = 1;
    if (first.kind === 'synth') this.cur.start(this.ctx.currentTime + 0.12);
    else {
      const boot = this.cur;
      boot.ready().then(() => { if (this.playing && this.cur === boot) boot.start(); }).catch(() => this._advance());
    }
    this.trackAt = this.ctx.currentTime;
    this._xfadeUntil = this.ctx.currentTime + 0.5;
    this.history = [first.id];
    this._emitTrack();
    clearInterval(this.timer);
    this.timer = setInterval(() => this._pump(), 25);
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer); this.timer = 0;
    this._stopAllPlayers();
  }
}

export { MIXES, MIX_LABEL, PLAYLIST, SYNTH, ECHO };
