// ===== Synthesized audio: realistic engine, gear shifts, driving surfaces, sirens, SFX =====
import { clamp } from './util.js';
import { Music } from './music.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Per-car engine acoustic profiles: cylinder firing order, idle/redline Hz, exhaust formants & burble
const PROFILES = {
  muscle: { f0: 27, fSpan: 112, sub: 0.72, h05: 0.58, h15: 0.42, h2: 0.35, h3: 0.16, lope: 6.5, lopeAmt: 0.28, fA: 125, fB: 430, qA: 4.2, qB: 3.0, turbo: 0.25, whine: 0.5, burble: 1.4, red: 0.93 },
  super:  { f0: 44, fSpan: 245, sub: 0.28, h05: 0.18, h15: 0.50, h2: 0.58, h3: 0.42, lope: 11,  lopeAmt: 0.06, fA: 240, fB: 960, qA: 3.4, qB: 4.2, turbo: 0.85, whine: 1.1, burble: 1.1, red: 0.94 },
  gt:     { f0: 36, fSpan: 195, sub: 0.44, h05: 0.30, h15: 0.38, h2: 0.48, h3: 0.30, lope: 8.5, lopeAmt: 0.12, fA: 175, fB: 660, qA: 3.6, qB: 3.4, turbo: 1.15, whine: 0.85, burble: 1.25, red: 0.93 },
  suv:    { f0: 29, fSpan: 128, sub: 0.62, h05: 0.45, h15: 0.30, h2: 0.30, h3: 0.14, lope: 7.0, lopeAmt: 0.18, fA: 135, fB: 460, qA: 3.8, qB: 2.6, turbo: 0.45, whine: 0.4, burble: 0.7, red: 0.92 },
  sedan:  { f0: 33, fSpan: 155, sub: 0.38, h05: 0.22, h15: 0.25, h2: 0.40, h3: 0.20, lope: 8.0, lopeAmt: 0.08, fA: 165, fB: 580, qA: 3.0, qB: 2.5, turbo: 0.35, whine: 0.35, burble: 0.5, red: 0.93 },
  truck:  { f0: 21, fSpan: 78,  sub: 0.82, h05: 0.62, h15: 0.35, h2: 0.24, h3: 0.10, lope: 5.2, lopeAmt: 0.24, fA: 98,  fB: 310, qA: 4.5, qB: 2.8, turbo: 1.35, whine: 0.6, burble: 0.3, red: 0.90 },
};

function makeCurve(fn, n = 1024) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = fn((i / (n / 2)) - 1);
  return c;
}

export class AudioSys {
  constructor() { this.ready = false; this.settings = { master: 0.8, music: 0.6, sfx: 0.9 }; }

  init() {
    if (this.ready) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -13; comp.knee.value = 10; comp.ratio.value = 4.2; comp.attack.value = 0.003; comp.release.value = 0.18;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);

    // White & pink noise buffers
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    this.pink = ctx.createBuffer(1, len, ctx.sampleRate);
    const dw = this.noise.getChannelData(0), dp = this.pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      dw[i] = w;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      dp[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }

    // Lush reverb + urban slapback echo (for sirens & backfires)
    this.reverb = ctx.createConvolver();
    const rl = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < rl; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 2.8); }
    this.reverb.buffer = ir;
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0.35;
    this.revSend.connect(this.reverb); this.reverb.connect(this.musicBus);
    this.sfxRev = ctx.createGain(); this.sfxRev.gain.value = 0.26; this.sfxRev.connect(this.reverb);

    this.echo = ctx.createDelay(0.5); this.echo.delayTime.value = 0.165;
    const efb = ctx.createGain(); efb.gain.value = 0.28;
    const eflt = ctx.createBiquadFilter(); eflt.type = 'bandpass'; eflt.frequency.value = 1150; eflt.Q.value = 0.85;
    this.echo.connect(eflt); eflt.connect(efb); efb.connect(this.echo);
    const eOut = ctx.createGain(); eOut.gain.value = 0.32; eflt.connect(eOut); eOut.connect(this.sfxBus); eOut.connect(this.sfxRev);
    this.echoSend = ctx.createGain(); this.echoSend.gain.value = 0.35; this.echoSend.connect(this.echo);

    // Delay for music arps
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = (60 / 128) * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2500;
    this.delay.connect(dl); dl.connect(fb); fb.connect(this.delay); dl.connect(this.musicBus);
    this.delaySend = ctx.createGain(); this.delaySend.gain.value = 0.3; this.delaySend.connect(this.delay);

    this.ready = true;
    this.applyVolumes();
    this.buildLoops();
    this.music = new Music(this);
  }

  applyVolumes() {
    if (!this.ready) return;
    const s = this.settings;
    this.master.gain.value = s.master;
    this.musicBus.gain.value = s.music * 0.55;
    this.sfxBus.gain.value = s.sfx;
  }

  noiseSrc(loop = true, pink = false) {
    const s = this.ctx.createBufferSource(); s.buffer = pink ? this.pink : this.noise; s.loop = loop;
    if (loop) { s.loopStart = Math.random() * 0.8; s.loopEnd = s.loopStart + 1.1; }
    return s;
  }

  buildLoops() {
    const ctx = this.ctx;
    const mk = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
    const bp = (f, q) => { const flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = f; flt.Q.value = q; return flt; };
    const lp = (f, q = 0.7) => { const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = f; flt.Q.value = q; return flt; };

    // ---------- MULTI-HARMONIC ENGINE + DUAL EXHAUST RESONATOR + TRANSMISSION ----------
    const e = (this.engine = {});
    e.out = ctx.createGain(); e.out.gain.value = 0; e.out.connect(this.sfxBus);
    e.cabinLP = lp(6500, 0.8); e.cabinLP.connect(e.out);

    // Exhaust body resonators (A: chest thump, B: throat rasp, C: high metallic bark) + main lowpass
    e.resA = bp(150, 3.8); e.resAG = ctx.createGain(); e.resAG.gain.value = 0.72;
    e.resB = bp(580, 3.2); e.resBG = ctx.createGain(); e.resBG.gain.value = 0.52;
    e.resC = bp(1550, 2.2); e.resCG = ctx.createGain(); e.resCG.gain.value = 0.25;
    e.filter = lp(1800, 1.9);
    e.shaper = ctx.createWaveShaper();
    e.shaper.curve = makeCurve((x) => Math.tanh(x * 3.1 + 0.14 * x * x) - 0.05);
    e.shaper.oversample = '2x';
    e.am = ctx.createGain(); e.am.gain.value = 0.76;

    // Harmonic stack: sub-octave (V8 rumble), half-order (cross-plane), fundamental pair, 1.5x (V6/V10), 2x, 3x
    e.oSub = mk('triangle', 30); e.gSub = ctx.createGain(); e.gSub.gain.value = 0.5;
    e.o05 = mk('square', 30);    e.g05 = ctx.createGain();  e.g05.gain.value = 0.35;
    e.o1 = mk('sawtooth', 60);   e.o1b = mk('sawtooth', 60.5);
    e.o15 = mk('sawtooth', 90);  e.g15 = ctx.createGain();  e.g15.gain.value = 0.35;
    e.o2 = mk('square', 120);    e.g2 = ctx.createGain();   e.g2.gain.value = 0.4;
    e.o3 = mk('sawtooth', 180);  e.g3 = ctx.createGain();   e.g3.gain.value = 0.22;

    // Firing pulse AM + idle lope wobble + redline limiter flutter
    e.lfo = mk('sine', 30); e.lfoG = ctx.createGain(); e.lfoG.gain.value = 0.28;
    e.lope = mk('sine', 7.5); e.lopeG = ctx.createGain(); e.lopeG.gain.value = 0;
    e.lim = mk('square', 19); e.limG = ctx.createGain(); e.limG.gain.value = 0;
    e.lfo.connect(e.lfoG); e.lfoG.connect(e.am.gain);
    e.lope.connect(e.lopeG); e.lopeG.connect(e.o1.frequency); e.lopeG.connect(e.o1b.frequency);
    e.lim.connect(e.limG); e.limG.connect(e.am.gain);

    e.oSub.connect(e.gSub); e.gSub.connect(e.am);
    e.o05.connect(e.g05);   e.g05.connect(e.am);
    e.o1.connect(e.am);     e.o1b.connect(e.am);
    e.o15.connect(e.g15);   e.g15.connect(e.am);
    e.o2.connect(e.g2);     e.g2.connect(e.am);
    e.o3.connect(e.g3);     e.g3.connect(e.am);

    e.am.connect(e.shaper);
    e.shaper.connect(e.filter); e.filter.connect(e.cabinLP);
    e.shaper.connect(e.resA); e.resA.connect(e.resAG); e.resAG.connect(e.cabinLP);
    e.shaper.connect(e.resB); e.resB.connect(e.resBG); e.resBG.connect(e.cabinLP);
    e.shaper.connect(e.resC); e.resC.connect(e.resCG); e.resCG.connect(e.cabinLP);

    // Combustion/exhaust chuff + induction roar under load
    e.nz = this.noiseSrc(true, true); e.nzF = bp(650, 1.2); e.nzG = ctx.createGain(); e.nzG.gain.value = 0;
    e.nz.connect(e.nzF); e.nzF.connect(e.nzG); e.nzG.connect(e.cabinLP);
    e.exNz = this.noiseSrc(true, true); e.exF = lp(240, 2.0); e.exG = ctx.createGain(); e.exG.gain.value = 0;
    e.exNz.connect(e.exF); e.exF.connect(e.exG); e.exG.connect(e.shaper);

    // Turbocharger spool whistle + boost hiss + straight-cut gearbox whine
    e.turbo = mk('sine', 2400); e.turbo2 = mk('triangle', 4800);
    e.turboG = ctx.createGain(); e.turboG.gain.value = 0;
    const t2g = ctx.createGain(); t2g.gain.value = 0.25;
    e.turbo.connect(e.turboG); e.turbo2.connect(t2g); t2g.connect(e.turboG); e.turboG.connect(this.sfxBus);
    e.whine = mk('sine', 600); e.whine2 = mk('triangle', 1200);
    e.whineF = bp(1200, 3.5); e.whineG = ctx.createGain(); e.whineG.gain.value = 0;
    const w2g = ctx.createGain(); w2g.gain.value = 0.35;
    e.whine.connect(e.whineF); e.whine2.connect(w2g); w2g.connect(e.whineF); e.whineF.connect(e.whineG); e.whineG.connect(this.sfxBus);
    e.spool = 0;

    [e.oSub, e.o05, e.o1, e.o1b, e.o15, e.o2, e.o3, e.lfo, e.lope, e.lim, e.nz, e.exNz, e.turbo, e.turbo2, e.whine, e.whine2].forEach((o) => o.start());

    // ---------- TIRE ROLL, SLIP HOWL, SCREECH & BRAKE SQUEAL ----------
    const t = (this.tire = {});
    t.rollSrc = this.noiseSrc(true, true); t.rollF = bp(210, 1.1); t.rollF2 = bp(680, 1.6);
    t.rollG = ctx.createGain(); t.rollG.gain.value = 0;
    t.rollSrc.connect(t.rollF); t.rollSrc.connect(t.rollF2); t.rollF.connect(t.rollG); t.rollF2.connect(t.rollG); t.rollG.connect(this.sfxBus);

    t.src = this.noiseSrc();
    t.f1 = bp(980, 5.5); t.f2 = bp(2150, 6.5); t.f3 = bp(3400, 4.5);
    t.howl = mk('sawtooth', 520); t.howlF = bp(1050, 7.0); t.howlG = ctx.createGain(); t.howlG.gain.value = 0.32;
    t.shaper = ctx.createWaveShaper(); t.shaper.curve = makeCurve((x) => Math.tanh(x * 2.2));
    t.g = ctx.createGain(); t.g.gain.value = 0;
    t.src.connect(t.f1); t.src.connect(t.f2); t.src.connect(t.f3);
    t.howl.connect(t.howlF); t.howlF.connect(t.howlG); t.howlG.connect(t.shaper);
    t.f1.connect(t.shaper); t.f2.connect(t.shaper); t.f3.connect(t.shaper);
    t.shaper.connect(t.g); t.g.connect(this.sfxBus);

    t.brk = mk('sine', 4100); t.brkF = bp(4100, 8); t.brkG = ctx.createGain(); t.brkG.gain.value = 0;
    t.brk.connect(t.brkF); t.brkF.connect(t.brkG); t.brkG.connect(this.sfxBus);
    [t.rollSrc, t.src, t.howl, t.brk].forEach((o) => o.start());

    // ---------- AERO WIND, OFFROAD GRAVEL & NITRO JET ----------
    const w = (this.wind = {});
    w.src = this.noiseSrc(true, true); w.f = lp(380, 0.9); w.fHi = bp(1400, 1.4);
    w.g = ctx.createGain(); w.g.gain.value = 0; w.gHi = ctx.createGain(); w.gHi.gain.value = 0;
    w.src.connect(w.f); w.f.connect(w.g); w.g.connect(this.sfxBus);
    w.src.connect(w.fHi); w.fHi.connect(w.gHi); w.gHi.connect(this.sfxBus); w.src.start();

    const r = (this.rumble = {});
    r.src = this.noiseSrc(true, true); r.f = lp(155, 1.4); r.gritF = bp(2400, 1.8);
    r.g = ctx.createGain(); r.g.gain.value = 0; r.gritG = ctx.createGain(); r.gritG.gain.value = 0;
    r.src.connect(r.f); r.f.connect(r.g); r.g.connect(this.sfxBus);
    r.src.connect(r.gritF); r.gritF.connect(r.gritG); r.gritG.connect(this.sfxBus); r.src.start();

    const n = (this.nitro = {});
    n.src = this.noiseSrc(); n.f = bp(480, 0.85); n.fHi = bp(2800, 1.8);
    n.sub = mk('sawtooth', 58); n.subG = ctx.createGain(); n.subG.gain.value = 0.25;
    n.g = ctx.createGain(); n.g.gain.value = 0;
    n.src.connect(n.f); n.src.connect(n.fHi); n.sub.connect(n.subG); n.subG.connect(n.f);
    n.f.connect(n.g); n.fHi.connect(n.g); n.g.connect(this.sfxBus); n.src.start(); n.sub.start();

    // ---------- 4 POLICE SIREN VOICES (Horn driver + waveshaper + distance LPF + urban echo) ----------
    const hornCurve = makeCurve((x) => Math.tanh(x * 2.4));
    this.sirens = [0, 1, 2, 3].map((i) => {
      const o = mk('sawtooth', 750), o2 = mk('square', 753);
      const g2 = ctx.createGain(); g2.gain.value = 0.55;
      const sh = ctx.createWaveShaper(); sh.curve = hornCurve;
      const horn1 = bp(1050, 2.4), horn2 = bp(2350, 3.0);
      const distLP = lp(3200, 0.7);
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      const ec = ctx.createGain(); ec.gain.value = 0.35;
      o.connect(sh); o2.connect(g2); g2.connect(sh);
      sh.connect(horn1); sh.connect(horn2);
      horn1.connect(distLP); horn2.connect(distLP);
      distLP.connect(g); g.connect(p); p.connect(this.sfxBus);
      p.connect(ec); ec.connect(this.echoSend);
      o.start(); o2.start();
      return { o, o2, distLP, g, p, ec, mode: i % 3, t: i * 1.17 };
    });

    // ---------- 4 RIVAL / TRAFFIC / COP PROXIMITY ENGINE VOICES (with Doppler & panning) ----------
    this.otherEngines = [0, 1, 2, 3].map(() => {
      const o1 = mk('sawtooth', 65), o2 = mk('square', 32.5);
      const g2 = ctx.createGain(); g2.gain.value = 0.5;
      const f = bp(260, 1.8), lpf = lp(1400, 1.2);
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(lpf); lpf.connect(g); g.connect(p); p.connect(this.sfxBus);
      o1.start(); o2.start();
      return { o1, o2, f, lpf, g, p };
    });

    this.lastThrottle = 0; this.shiftCut = 0; this.shiftDir = 0; this.roadSeamT = 0; this.burbleCd = 0;
  }

  update(dt, st) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const e = this.engine;
    const on = st.active ? 1 : 0;
    const pr = PROFILES[st.kind] || PROFILES.super;
    const rpm = clamp(st.rpm ?? 0.2, 0.12, 1.05);
    const thr = clamp(st.throttle ?? 0, 0, 1);
    const brk = clamp(st.brake ?? 0, 0, 1);
    const sp = st.speed ?? 0;
    const gear = st.gear || 1;
    const fp = st.fp ? 1 : 0;

    // Gear shift trigger: upshift ignition cut + pop + clutch clunk, or downshift rev-match throttle blip
    if (st.shifted && on) {
      this.shiftDir = st.shifted;
      this.shiftCut = st.shifted > 0 ? 0.13 : 0.16;
      this.gearShift(st.shifted, rpm, thr, pr);
    }
    if (this.shiftCut > 0) this.shiftCut = Math.max(0, this.shiftCut - dt);

    // Pitch transient during shift: brief dip on upshift cut, sharp rev-match spike on downshift
    const shiftMod = this.shiftCut > 0 ? (this.shiftDir > 0 ? -0.07 * (this.shiftCut / 0.13) : 0.14 * Math.sin((this.shiftCut / 0.16) * Math.PI)) : 0;
    const effRpm = clamp(rpm + shiftMod, 0.12, 1.08);
    const f = pr.f0 + effRpm * pr.fSpan;
    const k = 0.032;

    e.oSub.frequency.setTargetAtTime(f * 0.5, now, k);
    e.o05.frequency.setTargetAtTime(f * 0.502, now, k);
    e.o1.frequency.setTargetAtTime(f, now, k);
    e.o1b.frequency.setTargetAtTime(f * 1.007, now, k);
    e.o15.frequency.setTargetAtTime(f * 1.5, now, k);
    e.o2.frequency.setTargetAtTime(f * 2, now, k);
    e.o3.frequency.setTargetAtTime(f * 3, now, k);
    e.lfo.frequency.setTargetAtTime(f * 0.5, now, k);
    e.lope.frequency.setTargetAtTime(pr.lope, now, 0.1);

    // Idle cam lope fades out as revs climb; redline fuel-cut limiter chatters above pr.red
    const idleFactor = clamp(1 - (effRpm - 0.18) * 3.8, 0, 1) * (1 - thr * 0.7);
    e.lopeG.gain.setTargetAtTime(idleFactor * pr.lopeAmt * f * 0.12, now, 0.06);
    const atLimiter = effRpm > pr.red && thr > 0.7 ? clamp((effRpm - pr.red) * 18, 0, 1) : 0;
    e.limG.gain.setTargetAtTime(atLimiter * 0.48, now, 0.015);

    // Harmonic balance shifts from deep sub-rumble at low RPM to screaming upper harmonics under high-RPM load
    const hiLoad = (0.35 + 0.65 * thr) * clamp((effRpm - 0.25) / 0.75, 0, 1);
    e.gSub.gain.setTargetAtTime(pr.sub * (1.15 - effRpm * 0.4), now, 0.05);
    e.g05.gain.setTargetAtTime(pr.h05 * (0.7 + thr * 0.45), now, 0.05);
    e.g15.gain.setTargetAtTime(pr.h15 * (0.55 + hiLoad * 0.6), now, 0.05);
    e.g2.gain.setTargetAtTime(pr.h2 * (0.5 + hiLoad * 0.75), now, 0.05);
    e.g3.gain.setTargetAtTime(pr.h3 * (0.3 + hiLoad * 0.95), now, 0.05);

    // Exhaust formant resonators track RPM + load; ignition cut dips gain sharply on upshift
    e.resA.frequency.setTargetAtTime(pr.fA * (0.85 + effRpm * 0.55), now, 0.05); e.resA.Q.setTargetAtTime(pr.qA, now, 0.1);
    e.resB.frequency.setTargetAtTime(pr.fB * (0.8 + effRpm * 0.75 + thr * 0.2), now, 0.05); e.resB.Q.setTargetAtTime(pr.qB, now, 0.1);
    e.resC.frequency.setTargetAtTime(1300 + effRpm * 1600 + thr * 500, now, 0.05);
    e.filter.frequency.setTargetAtTime(280 + thr * 2400 + effRpm * 2100 + (st.nitro ? 900 : 0), now, 0.045);
    e.cabinLP.frequency.setTargetAtTime(fp ? 3600 + thr * 1400 : 6800, now, 0.08);

    const cutMult = this.shiftCut > 0 && this.shiftDir > 0 ? 0.18 : 1.0;
    const engGain = on * cutMult * (0.15 + thr * 0.12 + effRpm * 0.07 + (st.nitro ? 0.04 : 0));
    e.out.gain.setTargetAtTime(engGain, now, this.shiftCut > 0 ? 0.012 : 0.055);

    // Intake suction roar + exhaust pulse chuff
    e.nzG.gain.setTargetAtTime(on * (0.015 + thr * effRpm * 0.15), now, 0.06);
    e.nzF.frequency.setTargetAtTime(380 + effRpm * 1700 + thr * 500, now, 0.07);
    e.exG.gain.setTargetAtTime(on * (0.04 + thr * 0.11) * (1.2 - effRpm * 0.4), now, 0.06);
    e.exF.frequency.setTargetAtTime(f * 1.6, now, 0.05);

    // Turbo spool inertia + blowoff flutter on sharp lift-off + deceleration exhaust crackle/burble
    const targetSpool = clamp(thr * Math.max(0, effRpm - 0.28) * 1.45 + (st.nitro ? 0.35 : 0), 0, 1);
    e.spool += (targetSpool - e.spool) * Math.min(1, dt * (targetSpool > e.spool ? 3.2 : 6.5));
    e.turbo.frequency.setTargetAtTime(1650 + e.spool * 3600, now, 0.08);
    e.turbo2.frequency.setTargetAtTime(3300 + e.spool * 5200, now, 0.08);
    e.turboG.gain.setTargetAtTime(on * e.spool * e.spool * 0.022 * pr.turbo, now, 0.08);

    // Straight-cut transmission gear whine (pitched by wheel speed + current gear mesh ratio)
    const wf = 190 + sp * 18 + gear * 85 + effRpm * 260;
    e.whine.frequency.setTargetAtTime(wf, now, 0.05);
    e.whine2.frequency.setTargetAtTime(wf * 2.02, now, 0.05);
    e.whineF.frequency.setTargetAtTime(wf * 1.35, now, 0.06);
    const loadWhine = (0.35 + 0.65 * Math.abs(thr - 0.35)) * clamp(sp / 55, 0, 1);
    e.whineG.gain.setTargetAtTime(on * loadWhine * 0.018 * pr.whine * (fp ? 1.35 : 1), now, 0.07);

    // Lift-off blowoff valve flutter + overrun exhaust burble/backfire
    if (this.lastThrottle > 0.72 && thr < 0.22 && effRpm > 0.52 && on) {
      if (e.spool > 0.35 && pr.turbo > 0.3) this.blowoff(e.spool * pr.turbo);
      if (Math.random() < 0.75) this.backfire(clamp(effRpm * pr.burble, 0.4, 1.3));
    }
    this.lastThrottle = thr;
    this.burbleCd = Math.max(0, this.burbleCd - dt);
    if (on && thr < 0.12 && effRpm > 0.45 && sp > 14 && this.burbleCd <= 0 && Math.random() < dt * 9 * pr.burble) {
      this.burblePop(0.35 + effRpm * 0.5);
      this.burbleCd = 0.055 + Math.random() * 0.11;
    }

    // ---------- TIRE ROLLING, EXPANSION SEAMS, SLIP HOWL, SCREECH & BRAKE SQUEAL ----------
    const spNorm = clamp(sp / 75, 0, 1);
    const grounded = st.grounded !== false;
    const rollAmt = on && grounded ? clamp(sp / 22, 0, 1) * (st.offroad ? 0.35 : 1) : 0;
    this.tire.rollG.gain.setTargetAtTime(rollAmt * (0.065 + spNorm * 0.06) * (st.flat ? 1.8 : 1), now, 0.07);
    this.tire.rollF.frequency.setTargetAtTime((st.flat ? 95 : 165) + sp * 3.5, now, 0.08);
    this.tire.rollF2.frequency.setTargetAtTime(520 + sp * 8, now, 0.08);

    // Highway expansion joints / surface seams thump (and flat-tire rim thump)
    if (on && grounded && sp > 7) {
      const rate = st.flat ? sp * 0.65 : (!st.offroad ? sp * 0.19 : 0);
      this.roadSeamT += dt * rate;
      if (this.roadSeamT >= 1) {
        this.roadSeamT -= 1;
        this.roadJoint(st.flat ? 0.65 : clamp(sp / 85, 0.15, 0.5));
      }
    }

    const sk = on && grounded ? clamp(st.skid ?? 0, 0, 1) * clamp(sp / 9, 0, 1) : 0;
    const slip = clamp(st.slip ?? 0, 0, 1);
    const jitter = Math.sin(now * 47) * 35 + (Math.random() - 0.5) * 50;
    this.tire.g.gain.setTargetAtTime(sk * (st.offroad ? 0.09 : 0.24), now, 0.04);
    this.tire.f1.frequency.setTargetAtTime(820 + sk * 480 + slip * 260 + jitter, now, 0.04);
    this.tire.f2.frequency.setTargetAtTime(1850 + sk * 720 + jitter * 1.4, now, 0.04);
    this.tire.howl.frequency.setTargetAtTime(460 + sk * 240 + slip * 180, now, 0.045);
    this.tire.howlF.frequency.setTargetAtTime(920 + sk * 520, now, 0.045);

    const brkSqueal = on && grounded && brk > 0.55 && sp > 6 && sp < 42 && !st.offroad ? (brk - 0.5) * clamp(1 - sp / 45, 0.2, 1) : 0;
    this.tire.brk.frequency.setTargetAtTime(3950 + Math.sin(now * 31) * 90, now, 0.04);
    this.tire.brkG.gain.setTargetAtTime(brkSqueal * 0.025, now, 0.05);

    // ---------- WIND BUFFETING, OFFROAD GRAVEL SPRAY & NITRO AFTERBURNER ----------
    const windGain = on * (spNorm ** 1.85) * (fp ? 0.16 : 0.23);
    this.wind.g.gain.setTargetAtTime(windGain, now, 0.09);
    this.wind.f.frequency.setTargetAtTime(210 + sp * 15, now, 0.09);
    this.wind.gHi.gain.setTargetAtTime(windGain * 0.38, now, 0.09);
    this.wind.fHi.frequency.setTargetAtTime(950 + sp * 22, now, 0.09);

    const offAmt = on && st.offroad ? clamp(sp / 26, 0, 1) : 0;
    this.rumble.g.gain.setTargetAtTime(offAmt * 0.46, now, 0.06);
    this.rumble.f.frequency.setTargetAtTime(125 + sp * 2.4, now, 0.08);
    this.rumble.gritG.gain.setTargetAtTime(offAmt * 0.16, now, 0.06);
    this.rumble.gritF.frequency.setTargetAtTime(1900 + Math.random() * 900, now, 0.05);
    if (offAmt > 0.2 && Math.random() < dt * 22 * offAmt) this.gravelTick(offAmt);

    this.nitro.g.gain.setTargetAtTime(on * (st.nitro ? 0.28 : 0), now, 0.05);
    this.nitro.f.frequency.setTargetAtTime(st.nitro ? 640 + effRpm * 380 : 300, now, 0.15);
    this.nitro.sub.frequency.setTargetAtTime(48 + effRpm * 35, now, 0.1);

    // ---------- POLICE SIRENS: WAIL (0), YELP (1), HI-LO (2), PIERCE/PHASER (3) + DOPPLER + DISTANCE LPF ----------
    const list = st.sirens || [];
    this.sirens.forEach((s, i) => {
      const c = list[i];
      if (!c || !on) { s.g.gain.setTargetAtTime(0, now, 0.09); return; }
      s.t += dt;
      const mode = c.mode ?? s.mode;
      let base;
      if (mode === 0) {
        // Authentic mechanical wail: asymmetric rise/fall curve (580 Hz -> 1240 Hz over ~4.2s)
        const ph = (s.t / 4.2) % 1;
        const curve = ph < 0.58 ? Math.pow(ph / 0.58, 1.25) : 1 - Math.pow((ph - 0.58) / 0.42, 1.45);
        base = 580 + 660 * curve;
      } else if (mode === 1) {
        // Fast electronic yelp sweep (3.3 Hz triangle-curved sweep)
        const ph = (s.t * 3.3) % 1;
        const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
        base = 640 + 680 * (tri * tri * (3 - 2 * tri));
      } else if (mode === 2) {
        // European / Pursuit two-tone Hi-Lo (660 Hz / 880 Hz alternating)
        base = ((s.t * 1.85) % 1) < 0.5 ? 660 : 880;
      } else {
        // Priority / Piercer rapid hyper-yelp when right on the bumper (8.5 Hz)
        const ph = (s.t * 8.5) % 1;
        base = 780 + 720 * (ph < 0.5 ? ph * 2 : 2 - ph * 2);
      }
      const dop = clamp(343 / (343 + (c.vrel || 0) * 1.15), 0.76, 1.30);
      const dist = c.dist ?? 40;
      s.o.frequency.setTargetAtTime(base * dop, now, 0.016);
      s.o2.frequency.setTargetAtTime(base * dop * 1.004, now, 0.016);
      s.distLP.frequency.setTargetAtTime(clamp(4400 - dist * 7.8, 680, 4400) * (fp ? 0.72 : 1), now, 0.07);
      s.g.gain.setTargetAtTime(c.gain * 0.095, now, 0.06);
      s.ec.gain.setTargetAtTime(clamp(dist / 160, 0.15, 0.55), now, 0.1);
      if (s.p.pan) s.p.pan.setTargetAtTime(clamp(c.pan, -0.92, 0.92), now, 0.045);
    });

    // ---------- PROXIMITY ENGINES FOR NEARBY RIVALS, COPS & TRAFFIC ----------
    const others = st.others || [];
    this.otherEngines.forEach((oe, i) => {
      const o = others[i];
      if (!o || !on) { oe.g.gain.setTargetAtTime(0, now, 0.08); return; }
      const opr = PROFILES[o.kind] || PROFILES.sedan;
      const dop = clamp(343 / (343 + (o.vrel || 0) * 1.1), 0.78, 1.28);
      const of = (opr.f0 + (o.rpm || 0.4) * opr.fSpan) * dop;
      oe.o1.frequency.setTargetAtTime(of, now, 0.04);
      oe.o2.frequency.setTargetAtTime(of * 0.5, now, 0.04);
      oe.f.frequency.setTargetAtTime(of * 2.4, now, 0.05);
      oe.lpf.frequency.setTargetAtTime(clamp(2600 - o.d * 14, 420, 2600), now, 0.06);
      oe.g.gain.setTargetAtTime(o.gain * (0.045 + (o.thr || 0.4) * 0.04), now, 0.06);
      if (oe.p.pan) oe.p.pan.setTargetAtTime(clamp(o.pan, -0.92, 0.92), now, 0.045);
    });
  }

  silence() {
    if (!this.ready) return;
    this.update(0.016, { active: false });
  }

  // ---------- ONE-SHOT SYNTHESIS ----------
  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  burst({ t = 0, dur = 0.3, type = 'lowpass', f0 = 1000, f1 = null, q = 1, gain = 0.5, attack = 0.002, bus = null, rev = 0, pink = false }) {
    const ctx = this.ctx, now = ctx.currentTime + t;
    const s = this.noiseSrc(false, pink), f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(f0, now); f.Q.value = q;
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = ctx.createGain(); this.env(g, now, attack, gain, dur);
    s.connect(f); f.connect(g); g.connect(bus || this.sfxBus);
    if (rev) { const r = ctx.createGain(); r.gain.value = rev; g.connect(r); r.connect(this.sfxRev); }
    s.start(now, Math.random() * 0.9); s.stop(now + dur + attack + 0.05);
  }
  tone({ t = 0, type = 'sine', f0 = 440, f1 = null, dur = 0.2, gain = 0.3, attack = 0.005, bus = null, rev = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime + t;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, now);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(18, f1), now + dur);
    const g = ctx.createGain(); this.env(g, now, attack, gain, dur);
    o.connect(g); g.connect(bus || this.sfxBus);
    if (rev) { const r = ctx.createGain(); r.gain.value = rev; g.connect(r); r.connect(this.sfxRev); }
    o.start(now); o.stop(now + dur + attack + 0.05);
  }

  // Realistic gear shift: mechanical linkage clunk + clutch thump + upshift exhaust bark / turbo chirp OR downshift rev-match blip
  gearShift(dir = 1, rpm = 0.7, thr = 0.8, pr = PROFILES.super) {
    if (!this.ready) return;
    // Mechanical dog-box / synchro engagement clunk + driveline thump
    this.tone({ type: 'triangle', f0: 145, f1: 48, dur: 0.065, gain: 0.22, attack: 0.002 });
    this.burst({ dur: 0.032, type: 'bandpass', f0: 2100, f1: 950, q: 3.5, gain: 0.11, attack: 0.001 });
    if (dir > 0) {
      // Upshift: fuel-cut exhaust bark/bang in the tailpipe + brief wastegate chirp if under load
      const load = clamp(thr * rpm, 0.2, 1);
      this.burst({ t: 0.018, dur: 0.085, type: 'bandpass', f0: 360 + rpm * 320, f1: 140, q: 1.6, gain: 0.26 * load, rev: 0.28, pink: true });
      this.tone({ t: 0.015, type: 'sawtooth', f0: 110 + rpm * 60, f1: 42, dur: 0.075, gain: 0.18 * load });
      if (thr > 0.65 && rpm > 0.55 && pr.turbo > 0.4) this.blowoff(0.55 * pr.turbo);
    } else {
      // Downshift: throttle blip growl + overrun pop
      const bf = pr.f0 + clamp(rpm + 0.18, 0.3, 1) * pr.fSpan;
      this.tone({ t: 0.01, type: 'sawtooth', f0: bf * 0.85, f1: bf * 1.25, dur: 0.11, gain: 0.14, attack: 0.012 });
      this.burst({ t: 0.02, dur: 0.09, type: 'bandpass', f0: bf * 3.2, f1: bf * 1.8, q: 2.2, gain: 0.12, pink: true });
      if (rpm > 0.45 && Math.random() < 0.65) this.burblePop(0.45);
    }
  }
  shiftPop() { this.gearShift(1, 0.75, 0.85); }

  // Compressor surge "stu-tu-tu" flutter + wastegate "psshh"
  blowoff(intensity = 0.8) {
    if (!this.ready) return;
    const p = clamp(intensity, 0.2, 1.3);
    this.burst({ dur: 0.28, type: 'bandpass', f0: 3400, f1: 1600, q: 1.8, gain: 0.075 * p, attack: 0.004 });
    for (let i = 0; i < 4; i++) {
      this.burst({ t: 0.025 + i * 0.048, dur: 0.036, type: 'bandpass', f0: 2900 - i * 280, q: 4.2, gain: 0.065 * p * Math.pow(0.76, i), attack: 0.002 });
    }
  }
  burblePop(p = 0.5) {
    if (!this.ready) return;
    this.burst({ dur: 0.045 + Math.random() * 0.03, type: 'bandpass', f0: 260 + Math.random() * 240, f1: 110, q: 1.8, gain: 0.16 * p, rev: 0.22, pink: true });
    this.tone({ type: 'sine', f0: 95 + Math.random() * 40, f1: 38, dur: 0.05, gain: 0.14 * p, attack: 0.001 });
  }
  backfire(p = 0.9) {
    if (!this.ready) return;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const dt = 0.03 + i * (0.055 + Math.random() * 0.065);
      const g = (0.28 - i * 0.05) * p;
      this.burst({ t: dt, dur: 0.065, type: 'bandpass', f0: 480 + Math.random() * 380, f1: 140, q: 1.4, gain: g, rev: 0.38, pink: true });
      this.tone({ t: dt, type: 'triangle', f0: 115 + Math.random() * 45, f1: 40, dur: 0.06, gain: g * 0.75, attack: 0.001 });
    }
  }
  roadJoint(p = 0.3) {
    if (!this.ready) return;
    this.tone({ type: 'sine', f0: 82, f1: 36, dur: 0.038, gain: 0.09 * p, attack: 0.001 });
    this.tone({ t: 0.018, type: 'sine', f0: 76, f1: 34, dur: 0.038, gain: 0.075 * p, attack: 0.001 });
  }
  gravelTick(p = 0.5) {
    if (!this.ready) return;
    this.burst({ dur: 0.014 + Math.random() * 0.015, type: 'highpass', f0: 3200 + Math.random() * 2500, gain: 0.07 * p, attack: 0.001 });
  }

  crash(power = 1) {
    if (!this.ready) return;
    const p = clamp(power, 0.1, 1.5);
    // Low chassis sub-punch + metal body crunch + glass shatter & debris scatter
    this.tone({ type: 'sine', f0: 105, f1: 32, dur: 0.38, gain: 0.65 * p, attack: 0.002 });
    this.burst({ dur: 0.28 + p * 0.32, type: 'bandpass', f0: 1400, f1: 260, q: 1.1, gain: 0.42 * p, rev: 0.45, pink: true });
    for (let i = 0; i < 4; i++) {
      this.tone({ t: Math.random() * 0.04, type: 'sawtooth', f0: 260 + Math.random() * 820, f1: 140 + Math.random() * 180, dur: 0.11 + Math.random() * 0.18, gain: 0.065 * p });
    }
    if (p > 0.55) {
      for (let i = 0; i < 6; i++) {
        this.burst({ t: 0.02 + Math.random() * 0.26, dur: 0.05 + Math.random() * 0.05, type: 'highpass', f0: 4800 + Math.random() * 2400, gain: 0.14 * p, attack: 0.001 });
      }
    }
  }
  scrape(power = 0.5) {
    if (!this.ready) return;
    this.burst({ dur: 0.22, type: 'bandpass', f0: 1950, f1: 1200, q: 4.5, gain: 0.22 * power });
    this.tone({ type: 'sawtooth', f0: 620 + Math.random() * 250, f1: 420, dur: 0.16, gain: 0.05 * power });
  }
  landing(power = 1) {
    if (!this.ready) return;
    const p = clamp(power, 0.2, 1.3);
    this.tone({ f0: 78, f1: 30, dur: 0.32, gain: 0.55 * p, attack: 0.002 });
    this.burst({ dur: 0.18, type: 'lowpass', f0: 420, f1: 120, gain: 0.28 * p, pink: true });
    this.burst({ t: 0.02, dur: 0.09, type: 'bandpass', f0: 1450, q: 3, gain: 0.11 * p }); // suspension bottom-out chirp
  }
  nitroStart() {
    if (!this.ready) return;
    this.burst({ dur: 0.55, type: 'bandpass', f0: 280, f1: 2200, q: 1.1, gain: 0.36 });
    this.tone({ type: 'sawtooth', f0: 55, f1: 135, dur: 0.48, gain: 0.26 });
    this.burst({ dur: 0.12, type: 'highpass', f0: 3600, gain: 0.15 }); // N2O solenoid valve crack
  }
  nearMiss() {
    if (!this.ready) return;
    // Fast Doppler horn/air whoosh pass-by
    this.burst({ dur: 0.36, type: 'bandpass', f0: 1850, f1: 320, q: 2.2, gain: 0.28, attack: 0.04, pink: true });
    this.tone({ type: 'sawtooth', f0: 390, f1: 240, dur: 0.32, gain: 0.08, attack: 0.05 });
  }
  checkpoint() { if (!this.ready) return; [0, 4, 7, 12].forEach((n, i) => this.tone({ t: i * 0.06, type: 'triangle', f0: mtof(76 + n), dur: 0.25, gain: 0.18, rev: 0.4 })); }
  beep(high = false) { if (this.ready) this.tone({ type: 'square', f0: high ? 1320 : 660, dur: high ? 0.6 : 0.18, gain: 0.12, rev: 0.3 }); }
  click() { if (this.ready) this.tone({ type: 'triangle', f0: 1200, f1: 800, dur: 0.05, gain: 0.08 }); }
  hover() { if (this.ready) this.tone({ type: 'sine', f0: 1800, dur: 0.03, gain: 0.03 }); }
  spikes() {
    if (!this.ready) return;
    for (let i = 0; i < 4; i++) this.burst({ t: i * 0.065, dur: 0.11, type: 'highpass', f0: 1600, gain: 0.38 });
    this.burst({ t: 0.08, dur: 1.25, type: 'bandpass', f0: 3200, f1: 480, q: 1.5, gain: 0.22 }); // tire rapid air deflation hiss
  }
  takedown() {
    if (!this.ready) return;
    this.crash(1.4);
    this.tone({ type: 'sine', f0: 160, f1: 30, dur: 1.2, gain: 0.7 });
    this.burst({ dur: 1.5, f0: 6000, f1: 200, gain: 0.25, rev: 0.8 });
    [0, 3, 7].forEach((n) => this.tone({ t: 0.15, type: 'sawtooth', f0: mtof(45 + n), dur: 1.4, gain: 0.08, rev: 0.6 }));
  }
  busted() { if (!this.ready) return; [0, 3, 6, 10].forEach((n) => this.tone({ type: 'sawtooth', f0: mtof(40 + n), dur: 2.5, attack: 0.05, gain: 0.1, rev: 0.8 })); this.tone({ f0: 80, f1: 30, dur: 2, gain: 0.5 }); }
  victory() { if (!this.ready) return; [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone({ t: i * 0.09, type: 'square', f0: mtof(64 + n), dur: 0.4, gain: 0.08, rev: 0.5 })); [0, 4, 7].forEach((n) => this.tone({ t: 0.65, type: 'sawtooth', f0: mtof(52 + n), dur: 2, attack: 0.05, gain: 0.08, rev: 0.6 })); }
  empCharge(t) { if (this.ready) this.tone({ type: 'sine', f0: 300 + t * 1500, dur: 0.08, gain: 0.05 }); }
  empFire() { if (!this.ready) return; this.tone({ type: 'square', f0: 2000, f1: 80, dur: 0.6, gain: 0.25 }); this.burst({ dur: 0.5, type: 'bandpass', f0: 4000, f1: 500, q: 3, gain: 0.3 }); }
  radio() {
    if (!this.ready) return;
    // Police P25 digital radio Motorola MDC1200 PTT chirp + squelch tail
    this.tone({ t: 0.0, type: 'sine', f0: 1200, dur: 0.028, gain: 0.055 });
    this.tone({ t: 0.03, type: 'sine', f0: 1800, dur: 0.032, gain: 0.055 });
    this.burst({ t: 0.06, dur: 0.16, type: 'bandpass', f0: 2350, q: 2.8, gain: 0.11 });
  }
  whoosh() { if (this.ready) this.burst({ dur: 0.5, type: 'bandpass', f0: 300, f1: 1500, q: 1, gain: 0.3, pink: true }); }
}


