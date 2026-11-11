// ===== Multi-layer engine synthesizer driven by real per-car profiles =====
import { clamp } from './util.js';
import { resolveEngine, firingHz, absRpm } from './engineProfiles.js';
import { EngineSampler, hasBank } from './engineSamples.js';

function makeCurve(fn, n = 1024) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = fn((i / (n / 2)) - 1);
  return c;
}

/**
 * Build the player engine voice graph.
 * Layers: combustion harmonics, exhaust formants, intake, diesel knock,
 * turbo spool, gearbox whine, EV inverter PWM.
 */
export function buildEngine(ctx, noiseSrc, sfxBus) {
  const mk = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
  const bp = (f, q) => { const flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = f; flt.Q.value = q; return flt; };
  const lp = (f, q = 0.7) => { const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = f; flt.Q.value = q; return flt; };
  const hp = (f, q = 0.7) => { const flt = ctx.createBiquadFilter(); flt.type = 'highpass'; flt.frequency.value = f; flt.Q.value = q; return flt; };

  const e = {};
  e.out = ctx.createGain(); e.out.gain.value = 0; e.out.connect(sfxBus);
  e.cabinLP = lp(6500, 0.8); e.cabinLP.connect(e.out);

  // Exhaust body resonators (chest / throat / metallic bark)
  e.resA = bp(150, 3.8); e.resAG = ctx.createGain(); e.resAG.gain.value = 0.72;
  e.resB = bp(580, 3.2); e.resBG = ctx.createGain(); e.resBG.gain.value = 0.52;
  e.resC = bp(1550, 2.2); e.resCG = ctx.createGain(); e.resCG.gain.value = 0.25;
  e.filter = lp(1800, 1.9);
  e.shaper = ctx.createWaveShaper();
  e.shaper.curve = makeCurve((x) => Math.tanh(x * 3.1 + 0.14 * x * x) - 0.05);
  e.shaper.oversample = '2x';
  e.am = ctx.createGain(); e.am.gain.value = 0.76;

  // Harmonic stack keyed to firing fundamental
  e.oSub = mk('triangle', 30); e.gSub = ctx.createGain(); e.gSub.gain.value = 0.5;
  e.o05 = mk('square', 30);    e.g05 = ctx.createGain();  e.g05.gain.value = 0.35;
  e.o1 = mk('sawtooth', 60);   e.o1b = mk('sawtooth', 60.5); e.g1 = ctx.createGain(); e.g1.gain.value = 0.7;
  e.o15 = mk('sawtooth', 90);  e.g15 = ctx.createGain();  e.g15.gain.value = 0.35;
  e.o2 = mk('square', 120);    e.g2 = ctx.createGain();   e.g2.gain.value = 0.4;
  e.o3 = mk('sawtooth', 180);  e.g3 = ctx.createGain();   e.g3.gain.value = 0.22;
  e.o4 = mk('sawtooth', 240);  e.g4 = ctx.createGain();   e.g4.gain.value = 0.12;

  // Firing pulse AM + idle lope + redline limiter flutter
  e.lfo = mk('sine', 30); e.lfoG = ctx.createGain(); e.lfoG.gain.value = 0.28;
  e.lope = mk('sine', 7.5); e.lopeG = ctx.createGain(); e.lopeG.gain.value = 0;
  e.lim = mk('square', 19); e.limG = ctx.createGain(); e.limG.gain.value = 0;
  e.lfo.connect(e.lfoG); e.lfoG.connect(e.am.gain);
  e.lope.connect(e.lopeG); e.lopeG.connect(e.o1.frequency); e.lopeG.connect(e.o1b.frequency);
  e.lim.connect(e.limG); e.limG.connect(e.am.gain);

  e.oSub.connect(e.gSub); e.gSub.connect(e.am);
  e.o05.connect(e.g05);   e.g05.connect(e.am);
  e.o1.connect(e.g1); e.o1b.connect(e.g1); e.g1.connect(e.am);
  e.o15.connect(e.g15);   e.g15.connect(e.am);
  e.o2.connect(e.g2);     e.g2.connect(e.am);
  e.o3.connect(e.g3);     e.g3.connect(e.am);
  e.o4.connect(e.g4);     e.g4.connect(e.am);

  e.am.connect(e.shaper);
  e.shaper.connect(e.filter); e.filter.connect(e.cabinLP);
  e.shaper.connect(e.resA); e.resA.connect(e.resAG); e.resAG.connect(e.cabinLP);
  e.shaper.connect(e.resB); e.resB.connect(e.resBG); e.resBG.connect(e.cabinLP);
  e.shaper.connect(e.resC); e.resC.connect(e.resCG); e.resCG.connect(e.cabinLP);

  // Combustion chuff + induction roar
  e.nz = noiseSrc(true, true); e.nzF = bp(650, 1.2); e.nzG = ctx.createGain(); e.nzG.gain.value = 0;
  e.nz.connect(e.nzF); e.nzF.connect(e.nzG); e.nzG.connect(e.cabinLP);
  e.exNz = noiseSrc(true, true); e.exF = lp(240, 2.0); e.exG = ctx.createGain(); e.exG.gain.value = 0;
  e.exNz.connect(e.exF); e.exF.connect(e.exG); e.exG.connect(e.shaper);

  // Diesel knock: high-Q bandpass noise amplitude-modulated by a unipolar firing pulse
  e.dNz = noiseSrc(true, false); e.dF = bp(1800, 6.5);
  e.dGate = ctx.createGain(); e.dGate.gain.value = 0;
  e.dG = ctx.createGain(); e.dG.gain.value = 0;
  e.dPulse = mk('sine', 12);
  // rectify LFO into 0..1 ticks via waveshaper so gain never goes negative
  e.dSh = ctx.createWaveShaper();
  e.dSh.curve = makeCurve((x) => Math.max(0, x) * 1.6);
  e.dPulse.connect(e.dSh); e.dSh.connect(e.dGate.gain);
  e.dNz.connect(e.dF); e.dF.connect(e.dGate); e.dGate.connect(e.dG); e.dG.connect(e.cabinLP);

  // Turbo spool + gearbox whine
  e.turbo = mk('sine', 2400); e.turbo2 = mk('triangle', 4800);
  e.turboG = ctx.createGain(); e.turboG.gain.value = 0;
  const t2g = ctx.createGain(); t2g.gain.value = 0.25;
  e.turbo.connect(e.turboG); e.turbo2.connect(t2g); t2g.connect(e.turboG); e.turboG.connect(sfxBus);
  e.whine = mk('sine', 600); e.whine2 = mk('triangle', 1200);
  e.whineF = bp(1200, 3.5); e.whineG = ctx.createGain(); e.whineG.gain.value = 0;
  const w2g = ctx.createGain(); w2g.gain.value = 0.35;
  e.whine.connect(e.whineF); e.whine2.connect(w2g); w2g.connect(e.whineF); e.whineF.connect(e.whineG); e.whineG.connect(sfxBus);

  // EV inverter: dual PWM carriers + motor tone + reduction gear
  e.ev1 = mk('sawtooth', 400); e.ev2 = mk('sawtooth', 800); e.ev3 = mk('sine', 120);
  e.evF = bp(2000, 2.8); e.evHP = hp(280, 0.7); e.evG = ctx.createGain(); e.evG.gain.value = 0;
  e.ev1G = ctx.createGain(); e.ev1G.gain.value = 0.45;
  e.ev2G = ctx.createGain(); e.ev2G.gain.value = 0.3;
  e.ev3G = ctx.createGain(); e.ev3G.gain.value = 0.55;
  e.ev1.connect(e.ev1G); e.ev1G.connect(e.evF);
  e.ev2.connect(e.ev2G); e.ev2G.connect(e.evF);
  e.ev3.connect(e.ev3G); e.ev3G.connect(e.evHP);
  e.evF.connect(e.evG); e.evHP.connect(e.evG); e.evG.connect(sfxBus);
  e.evWhine = mk('triangle', 900); e.evWhineF = bp(1400, 5); e.evWhineG = ctx.createGain(); e.evWhineG.gain.value = 0;
  e.evWhine.connect(e.evWhineF); e.evWhineF.connect(e.evWhineG); e.evWhineG.connect(sfxBus);

  // Recorded real-engine layer (RPM sample bank), mixed post-synth so cabin filter / shift cuts apply to it too
  e.sampler = new EngineSampler(ctx);
  e.sampler.out.connect(e.cabinLP);
  e.synthMix = ctx.createGain(); e.synthMix.gain.value = 1;
  // re-route the synth combustion stack through synthMix so it can be lowered when recordings are available
  e.shaper.disconnect();
  e.shaper.connect(e.synthMix);
  e.synthMix.connect(e.filter); e.synthMix.connect(e.resA); e.synthMix.connect(e.resB); e.synthMix.connect(e.resC);

  e.spool = 0;
  e.prId = null;

  const starters = [
    e.oSub, e.o05, e.o1, e.o1b, e.o15, e.o2, e.o3, e.o4, e.lfo, e.lope, e.lim,
    e.nz, e.exNz, e.dNz, e.dPulse, e.turbo, e.turbo2, e.whine, e.whine2,
    e.ev1, e.ev2, e.ev3, e.evWhine,
  ];
  // dGate.gain is driven by the diesel pulse shaper (starts at 0)
  for (const o of starters) o.start();
  return e;
}

/** Apply static profile gains that only need refresh when the car changes. */
function applyProfileStatic(e, pr, now) {
  e.resAG.gain.setTargetAtTime(0.55 + pr.sub * 0.35, now, 0.15);
  e.resBG.gain.setTargetAtTime(0.35 + pr.h2 * 0.4, now, 0.15);
  e.resCG.gain.setTargetAtTime(0.15 + pr.h4 * 0.55, now, 0.15);
  e.shaper.curve = makeCurve((x) => {
    const drive = 2.4 + pr.sub * 1.4 + pr.diesel * 0.8;
    return Math.tanh(x * drive + 0.12 * x * x) - 0.04;
  });
}

/**
 * @param {object} e engine voice from buildEngine
 * @param {number} dt
 * @param {object} st audio state from game
 * @param {number} now AudioContext.currentTime
 * @param {{ lastThrottle:number, shiftCut:number, shiftDir:number, burbleCd:number,
 *           gearShift:Function, blowoff:Function, backfire:Function, burblePop:Function }} hooks
 */
export function updateEngine(e, dt, st, now, hooks) {
  const on = st.active ? 1 : 0;
  const pr = resolveEngine(st.carId, st.kind);
  if (e.prId !== (st.carId || st.kind)) {
    e.prId = st.carId || st.kind;
    applyProfileStatic(e, pr, now);
    e.sampler.setCar(hasBank(st.carId) ? st.carId : null);
  }

  const rpmN = clamp(st.rpm ?? 0.2, 0.0, 1.08);
  const thr = clamp(st.throttle ?? 0, 0, 1);
  const sp = st.speed ?? 0;
  const gear = Math.max(1, st.gear || 1);
  const fp = st.fp ? 1 : 0;
  const isEv = pr.electric > 0.5;

  // Shift transients. RPM itself now follows the real gear ratio (car.js), so only a short fuel-cut dip (up) or a
  // small rev-match blip (down) is layered here. Rapid repeated shifts are rate-limited so mashing ↓ can't stack
  // blips/pops into a continuous screech.
  hooks.shiftCd = Math.max(0, (hooks.shiftCd || 0) - dt);
  if (st.shifted && on && !isEv) {
    hooks.shiftDir = st.shifted;
    hooks.shiftCut = st.shifted > 0 ? 0.11 : 0.12;
    if (hooks.shiftCd <= 0) hooks.gearShift(st.shifted, rpmN, thr, pr);
    else hooks.gearShift(st.shifted, rpmN, thr, pr, true); // quiet: clunk only
    hooks.shiftCd = 0.22;
  }
  if (hooks.shiftCut > 0) hooks.shiftCut = Math.max(0, hooks.shiftCut - dt);

  const shiftMod = hooks.shiftCut > 0
    ? (hooks.shiftDir > 0 ? -0.05 * (hooks.shiftCut / 0.11) : 0.05 * Math.sin((hooks.shiftCut / 0.12) * Math.PI))
    : 0;
  const effN = clamp(rpmN + shiftMod, 0, 1.0);
  // audible pitch curve: rises normally through the mid range but compresses near redline (top ≈ 80% of redline
  // pitch) so revving out a gear sounds like a strained engine, not a whistle. Physics RPM is unchanged.
  const pitchN = clamp(effN, 0, 1) * (1 - 0.2 * clamp(effN, 0, 1) ** 2);
  const rpmAbs = absRpm(pr, pitchN);
  const f = Math.max(12, firingHz(pr, Math.max(rpmAbs, pr.idleRpm || 1)));
  const k = 0.028;

  // ---- Harmonic frequencies track real firing fundamental ----
  e.oSub.frequency.setTargetAtTime(f * 0.5, now, k);
  e.o05.frequency.setTargetAtTime(f * 0.502, now, k);
  e.o1.frequency.setTargetAtTime(f, now, k);
  e.o1b.frequency.setTargetAtTime(f * 1.006, now, k);
  e.o15.frequency.setTargetAtTime(f * 1.5, now, k);
  e.o2.frequency.setTargetAtTime(f * 2, now, k);
  e.o3.frequency.setTargetAtTime(f * 3, now, k);
  e.o4.frequency.setTargetAtTime(f * 4.02, now, k);
  e.lfo.frequency.setTargetAtTime(f * (pr.layout === 'v8' ? 0.5 : 1), now, k);
  e.lope.frequency.setTargetAtTime(pr.lope || 1, now, 0.1);

  // Idle lope / limiter
  const idleFactor = isEv ? 0 : clamp(1 - (effN - 0.12) * 4.2, 0, 1) * (1 - thr * 0.7);
  e.lopeG.gain.setTargetAtTime(idleFactor * pr.lopeAmt * f * 0.12, now, 0.06);
  // Rev limiter: only right at the cut-off, and a soft low-rate fuel-cut bounce (a real limiter "brrap"), not a buzz.
  // Sitting on the limiter in a low gear used to drive this at 0.48 depth / ~24 Hz continuously = the screech.
  const atLimiter = !isEv && effN > 0.985 && thr > 0.7 ? clamp((effN - 0.985) * 60, 0, 1) : 0;
  e.limG.gain.setTargetAtTime(atLimiter * 0.14, now, 0.03);
  e.lim.frequency.setTargetAtTime(9, now, 0.05);

  // Harmonic balance vs RPM / load (layout-aware). Upper harmonics (3rd/4th = ~1-2 kHz sawtooths at high RPM, then
  // through the waveshaper) are what made high revs shrill: they now fall away near redline instead of peaking there.
  // Low gears (1–2): boost chest-grunt body and pull the whistle band harder so WOT reads as load, not pitch.
  const lowGear = !isEv && gear <= 2;
  const grunt = lowGear ? 1 + (gear === 1 ? 0.55 : 0.32) * (0.45 + 0.55 * thr) : 1;
  const hiLoad = (0.3 + 0.7 * thr) * clamp((effN - 0.2) / 0.8, 0, 1);
  const topTame = 1 - 0.7 * clamp((effN - 0.55) / 0.45, 0, 1) ** 1.5; // 1 at mid revs -> 0.3 at redline
  const lowWhistle = lowGear ? (1 - 0.75 * clamp((effN - 0.35) / 0.55, 0, 1)) : 1; // mute 3rd/4th under high rpmN in 1–2
  const combGain = isEv ? 0.08 : 1; // nearly mute combustion stack for EV
  e.gSub.gain.setTargetAtTime(pr.sub * (1.2 - effN * 0.3) * grunt * combGain, now, 0.05);
  e.g05.gain.setTargetAtTime(pr.h05 * (0.65 + thr * 0.5) * grunt * combGain, now, 0.05);
  e.g1.gain.setTargetAtTime((0.6 + thr * 0.3) * combGain, now, 0.05);
  e.g15.gain.setTargetAtTime(pr.h15 * (0.5 + hiLoad * 0.5) * combGain, now, 0.05);
  e.g2.gain.setTargetAtTime(pr.h2 * (0.45 + hiLoad * 0.55) * (0.6 + 0.4 * topTame) * combGain, now, 0.05);
  e.g3.gain.setTargetAtTime(pr.h3 * (0.2 + hiLoad * 0.6) * topTame * lowWhistle * combGain, now, 0.05);
  e.g4.gain.setTargetAtTime(pr.h4 * (0.1 + hiLoad * 0.5) * topTame * lowWhistle * combGain, now, 0.05);

  // Exhaust formants track RPM + load
  e.resA.frequency.setTargetAtTime(pr.fA * (0.85 + effN * 0.55), now, 0.05);
  e.resA.Q.setTargetAtTime(pr.qA, now, 0.1);
  e.resB.frequency.setTargetAtTime(pr.fB * (0.8 + effN * 0.75 + thr * 0.2), now, 0.05);
  e.resB.Q.setTargetAtTime(pr.qB, now, 0.1);
  e.resC.frequency.setTargetAtTime(pr.fC * (0.75 + effN * 0.35 + thr * 0.1), now, 0.05);
  e.resC.Q.setTargetAtTime(pr.qC, now, 0.1);
  e.resCG.gain.setTargetAtTime((0.15 + pr.h4 * 0.55) * (0.45 + 0.55 * topTame) * lowWhistle, now, 0.1);
  // overall brightness capped (~3.4 kHz): darker still in low gears under load
  const brightCap = lowGear ? 2400 : 3400;
  e.filter.frequency.setTargetAtTime(Math.min(brightCap, 300 + thr * (lowGear ? 900 : 1500) + effN * (lowGear ? 700 : 1300) + (st.nitro ? 500 : 0)), now, 0.045);
  // final tone ceiling: low gears stay darker so revs read as grunt
  const cabinBase = fp ? 3000 + thr * 900 : 4800;
  const cabinDark = (1 - 0.3 * clamp((effN - 0.6) / 0.4, 0, 1)) * (lowGear ? 0.62 : 1);
  e.cabinLP.frequency.setTargetAtTime(cabinBase * cabinDark, now, 0.08);

  // Real recording carries the engine's character; the synth stays underneath for body, and takes over above the
  // highest recorded RPM (where pitch-shifting a recording would sound artificial).
  const smp = e.sampler;
  if (smp.ready && !isEv) {
    const over = smp.overTop(rpmAbs);
    smp.update(rpmAbs, thr, on * (1 - 0.55 * over) * 2.4, now);
    e.synthMix.gain.setTargetAtTime(0.28 + 0.6 * over, now, 0.08);
  } else {
    smp.update(rpmAbs, thr, 0, now);
    e.synthMix.gain.setTargetAtTime(1, now, 0.08);
  }

  const cutMult = hooks.shiftCut > 0 && hooks.shiftDir > 0 ? 0.18 : 1.0;
  const engGain = on * cutMult * pr.body * (0.12 + thr * 0.13 + effN * 0.08 + (st.nitro ? 0.04 : 0));
  e.out.gain.setTargetAtTime(isEv ? engGain * 0.35 : engGain, now, hooks.shiftCut > 0 ? 0.012 : 0.055);

  // Intake / exhaust noise
  e.nzG.gain.setTargetAtTime(on * pr.intake * (0.012 + thr * effN * 0.16) * (isEv ? 0.15 : 1), now, 0.06);
  e.nzF.frequency.setTargetAtTime(340 + effN * 900 + thr * 350, now, 0.07);
  e.exG.gain.setTargetAtTime(on * (0.035 + thr * 0.12) * (1.15 - effN * 0.35) * grunt * (isEv ? 0 : 1), now, 0.06);
  e.exF.frequency.setTargetAtTime(f * (lowGear ? 1.15 : 1.55), now, 0.05);

  // Diesel knock pulse at half firing rate (stronger at idle / light load)
  const dAmt = on * pr.diesel * (0.05 + (1 - thr * 0.55) * 0.1) * clamp(1.15 - effN * 0.75, 0.2, 1);
  e.dG.gain.setTargetAtTime(dAmt * 0.28, now, 0.05);
  e.dPulse.frequency.setTargetAtTime(Math.max(8, f * 0.5), now, 0.04);
  e.dF.frequency.setTargetAtTime(1400 + effN * 900 + thr * 400, now, 0.06);

  // Turbo spool inertia
  const targetSpool = isEv ? 0 : clamp(thr * Math.max(0, effN - 0.22) * 1.5 + (st.nitro ? 0.35 : 0), 0, 1);
  e.spool += (targetSpool - e.spool) * Math.min(1, dt * (targetSpool > e.spool ? 3.0 : 6.5));
  // turbo whistle: lower and quieter (was sine sweeping up to 5.7 / 8.6 kHz at full spool = piercing at max revs)
  e.turbo.frequency.setTargetAtTime(1100 + e.spool * 1900, now, 0.08);
  e.turbo2.frequency.setTargetAtTime(2200 + e.spool * 2600, now, 0.08);
  e.turboG.gain.setTargetAtTime(on * e.spool * e.spool * 0.012 * pr.turbo, now, 0.08);

  // Gearbox mesh whine: pitched by gear ratio × wheel speed
  const ratios = pr.gears || [1];
  const gIdx = isEv ? 0 : clamp(gear - 1, 0, ratios.length - 1);
  const mesh = ratios[gIdx] * (pr.finalDrive || 3.5);
  const shaftHz = Math.max(0, sp) * mesh * 0.55; // ~proportional to input shaft speed
  // Near-mute in 1–2; faint only in high gears. Cap shaft pitch so low-gear WOT can't whistle.
  const wf = isEv ? (40 + sp * 22) : Math.min(lowGear ? 420 : 620, 110 + shaftHz * 1.6 + effN * 50);
  e.whine.frequency.setTargetAtTime(wf, now, 0.05);
  e.whine2.frequency.setTargetAtTime(wf * 2.03, now, 0.05);
  e.whineF.frequency.setTargetAtTime(wf * 1.2, now, 0.06);
  const gearFade = isEv ? 1 : (gear <= 2 ? 0.02 : clamp((gear - 2) / 3, 0.12, 1));
  const loadWhine = (0.3 + 0.7 * Math.abs(thr - 0.3)) * clamp(sp / 50, 0, 1) * gearFade;
  e.whineG.gain.setTargetAtTime(on * loadWhine * (isEv ? 0.02 : 0.008) * pr.whine * (fp ? 1.3 : 1) * (isEv ? 0.35 : 1), now, 0.07);

  // EV inverter / motor layers
  const evOn = on * pr.electric;
  const motorHz = Math.max(8, rpmAbs / 60);
  e.ev1.frequency.setTargetAtTime(motorHz * 6.5 + 180, now, 0.04);
  e.ev2.frequency.setTargetAtTime(motorHz * 13 + 360, now, 0.04);
  e.ev3.frequency.setTargetAtTime(motorHz * 2.1, now, 0.04);
  e.evF.frequency.setTargetAtTime(900 + motorHz * 18 + thr * 600, now, 0.05);
  e.evG.gain.setTargetAtTime(evOn * (0.02 + thr * 0.07 + clamp(sp / 80, 0, 1) * 0.05), now, 0.06);
  e.evWhine.frequency.setTargetAtTime(220 + sp * 28 + thr * 120, now, 0.05);
  e.evWhineF.frequency.setTargetAtTime(400 + sp * 35, now, 0.05);
  e.evWhineG.gain.setTargetAtTime(evOn * clamp(sp / 40, 0, 1) * (0.015 + thr * 0.02), now, 0.07);

  // Lift-off blowoff / overrun burble (combustion only)
  if (!isEv && hooks.lastThrottle > 0.72 && thr < 0.22 && effN > 0.5 && on) {
    if (e.spool > 0.35 && pr.turbo > 0.3) hooks.blowoff(e.spool * pr.turbo);
    if (Math.random() < 0.75 * pr.burble) hooks.backfire(clamp(effN * pr.burble, 0.4, 1.3));
  }
  hooks.lastThrottle = thr;
  hooks.burbleCd = Math.max(0, hooks.burbleCd - dt);
  if (!isEv && on && thr < 0.12 && effN > 0.42 && sp > 14 && hooks.burbleCd <= 0 && Math.random() < dt * 9 * pr.burble) {
    hooks.burblePop(0.35 + effN * 0.5);
    hooks.burbleCd = 0.05 + Math.random() * 0.1;
  }

  return pr;
}

/** Compact proximity engine for rivals / traffic / cops. */
export function buildOtherEngine(ctx, sfxBus) {
  const mk = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
  const bp = (f, q) => { const flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = f; flt.Q.value = q; return flt; };
  const lp = (f, q = 0.7) => { const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = f; flt.Q.value = q; return flt; };
  const o1 = mk('sawtooth', 65), o2 = mk('square', 32.5), o3 = mk('sawtooth', 130);
  const g2 = ctx.createGain(); g2.gain.value = 0.45;
  const g3 = ctx.createGain(); g3.gain.value = 0.22;
  const f = bp(260, 1.8), lpf = lp(1400, 1.2);
  const g = ctx.createGain(); g.gain.value = 0;
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  o1.connect(f); o2.connect(g2); g2.connect(f); o3.connect(g3); g3.connect(f);
  f.connect(lpf); lpf.connect(g); g.connect(p); p.connect(sfxBus);
  o1.start(); o2.start(); o3.start();
  return { o1, o2, o3, f, lpf, g, p };
}

export function updateOtherEngine(oe, o, now) {
  const pr = resolveEngine(o.carId, o.kind);
  const dop = clamp(343 / (343 + (o.vrel || 0) * 1.1), 0.78, 1.28);
  const rpmAbs = absRpm(pr, clamp(o.rpm || 0.4, 0, 1));
  const of = firingHz(pr, Math.max(rpmAbs, pr.idleRpm || 1)) * dop;
  oe.o1.frequency.setTargetAtTime(of, now, 0.04);
  oe.o2.frequency.setTargetAtTime(of * (pr.layout === 'v8' ? 0.5 : 0.5), now, 0.04);
  oe.o3.frequency.setTargetAtTime(of * 2, now, 0.04);
  oe.f.frequency.setTargetAtTime(of * 2.2 + pr.fB * 0.15, now, 0.05);
  oe.lpf.frequency.setTargetAtTime(clamp(2800 - o.d * 14, 420, 2800), now, 0.06);
  const thr = o.thr || 0.4;
  oe.g.gain.setTargetAtTime(o.gain * (0.04 + thr * 0.045) * pr.body * (pr.electric > 0.5 ? 0.7 : 1), now, 0.06);
  if (oe.p.pan) oe.p.pan.setTargetAtTime(clamp(o.pan, -0.92, 0.92), now, 0.045);
}
