// ===== Synthesized audio: realistic engine, gear shifts, driving surfaces, sirens, SFX =====
import { clamp } from './util.js';
import { Music } from './music.js';
import { resolveEngine, firingHz, absRpm } from './engineProfiles.js';
import { buildEngine, updateEngine, buildOtherEngine, updateOtherEngine } from './engineAudio.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function makeCurve(fn, n = 1024) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = fn((i / (n / 2)) - 1);
  return c;
}

export class AudioSys {
  constructor() { this.ready = false; this.settings = { master: 0.8, music: 0.6, sfx: 0.9, mix: 'synth' }; }

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
    if (this.settings.mix) this.music.setMix(this.settings.mix);
  }

  applyVolumes() {
    if (!this.ready) return;
    const s = this.settings;
    this.master.gain.value = s.master;
    const duck = this._dramaDuck ?? 1;
    this.musicBus.gain.value = s.music * 0.55 * duck;
    this.sfxBus.gain.value = s.sfx;
    if (this.music && s.mix) this.music.setMix(s.mix);
  }

  /** Pursuit drama: duck music under chaos; drive DJ mood / heat-matched track energy. */
  setDrama(level = 0, heat = 0) {
    if (!this.ready) return;
    // level 0..3, heat 0..5 — leave room for engine/sirens at peak chase
    const duck = 1 - clamp(level * 0.06 + heat * 0.035, 0, 0.28);
    this._dramaDuck = duck;
    const s = this.settings;
    this.musicBus.gain.value = s.music * 0.55 * duck;
    if (this.music) {
      this.music.setLevel(level);
      this.music.setHeat(heat);
    }
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

    // ---------- MULTI-LAYER ENGINE (per-car profiles: V10/V8/I6/flat-6/I4/diesel/EV) ----------
    this.engine = buildEngine(ctx, (loop, pink) => this.noiseSrc(loop, pink), this.sfxBus);

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
    this.otherEngines = [0, 1, 2, 3].map(() => buildOtherEngine(ctx, this.sfxBus));

    this.lastThrottle = 0; this.shiftCut = 0; this.shiftDir = 0; this.roadSeamT = 0; this.burbleCd = 0;
  }

  update(dt, st) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const on = st.active ? 1 : 0;
    const brk = clamp(st.brake ?? 0, 0, 1);
    const sp = st.speed ?? 0;
    const fp = st.fp ? 1 : 0;

    updateEngine(this.engine, dt, st, now, this);
    const effRpm = clamp(st.rpm ?? 0.2, 0.12, 1.05);

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
      updateOtherEngine(oe, o, now);
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
  gearShift(dir = 1, rpm = 0.7, thr = 0.8, pr = null, quiet = false) {
    if (!this.ready) return;
    pr = pr || resolveEngine(null, 'super');
    // Mechanical dog-box / synchro engagement clunk + driveline thump
    this.tone({ type: 'triangle', f0: 145, f1: 48, dur: 0.065, gain: quiet ? 0.12 : 0.22, attack: 0.002 });
    if (quiet) return;
    this.burst({ dur: 0.032, type: 'bandpass', f0: 2100, f1: 950, q: 3.5, gain: 0.11, attack: 0.001 });
    if (dir > 0) {
      // Upshift: fuel-cut exhaust bark/bang in the tailpipe + brief wastegate chirp if under load
      const load = clamp(thr * rpm, 0.2, 1);
      this.burst({ t: 0.018, dur: 0.085, type: 'bandpass', f0: 360 + rpm * 320, f1: 140, q: 1.6, gain: 0.26 * load, rev: 0.28, pink: true });
      this.tone({ t: 0.015, type: 'sawtooth', f0: 110 + rpm * 60, f1: 42, dur: 0.075, gain: 0.18 * load });
      if (thr > 0.65 && rpm > 0.55 && pr.turbo > 0.4) this.blowoff(0.55 * pr.turbo);
    } else {
      // Downshift: throttle blip growl + overrun pop (pitched to real firing Hz)
      // Downshift: short low rev-match blip at the real firing frequency (low-passed, no high sawtooth sweep)
      const bf = firingHz(pr, absRpm(pr, clamp(rpm + 0.08, 0.15, 0.9)));
      this.tone({ t: 0.01, type: 'triangle', f0: bf * 0.9, f1: bf * 1.08, dur: 0.09, gain: 0.08, attack: 0.012 });
      this.burst({ t: 0.02, dur: 0.07, type: 'lowpass', f0: Math.min(1400, bf * 2.2), f1: Math.min(900, bf * 1.4), q: 0.8, gain: 0.06, pink: true });
      if (rpm > 0.55 && pr.burble > 0.8 && Math.random() < 0.35) this.burblePop(0.3);
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
    // Fast Doppler horn/air whoosh pass-by — louder so style moments punch through the mix
    this.burst({ dur: 0.42, type: 'bandpass', f0: 2100, f1: 280, q: 2.0, gain: 0.42, attack: 0.03, pink: true });
    this.tone({ type: 'sawtooth', f0: 420, f1: 180, dur: 0.36, gain: 0.12, attack: 0.04 });
    this.tone({ type: 'sine', f0: 90, f1: 48, dur: 0.22, gain: 0.18, attack: 0.01 }); // chest thump
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


