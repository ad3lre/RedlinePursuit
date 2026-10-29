// ===== Real-engine acoustic + gearing signatures per playable car =====
// Tuned from characteristic traits of the real vehicles each id references:
//   viper   → Dodge Viper V10 (even-fire, deep bark)
//   kaiser  → twin-turbo straight-6 GT (BMW M-style)
//   bruiser → cross-plane American V8 muscle
//   cyber   → dual-motor EV (Cybertruck)
//   gt3rs   → Porsche flat-6 NA track car
//   vito    → Mercedes diesel van
//   mini    → turbocharged Mini Cooper S I4
// Kind fallbacks cover traffic / rivals / cops.

/** @typedef {'v10'|'v8'|'i6'|'f6'|'i4'|'diesel4'|'ev'} EngineLayout */

/**
 * @typedef {object} EngineProfile
 * @property {EngineLayout} layout
 * @property {number} cyl            cylinders (1 for EV “virtual”)
 * @property {number} idleRpm
 * @property {number} redlineRpm
 * @property {number} sub            sub-octave gain
 * @property {number} h05            half-order (cross-plane V8 etc.)
 * @property {number} h15            1.5× harmonic
 * @property {number} h2
 * @property {number} h3
 * @property {number} h4             upper scream / rasp
 * @property {number} lope           idle cam/irregularity Hz
 * @property {number} lopeAmt
 * @property {number} fA             chest exhaust formant Hz
 * @property {number} fB             throat formant Hz
 * @property {number} fC             metallic bark formant Hz
 * @property {number} qA
 * @property {number} qB
 * @property {number} qC
 * @property {number} turbo          turbo/supercharger intensity (0 = NA)
 * @property {number} whine          gearbox mesh whine
 * @property {number} burble         overrun crackle
 * @property {number} diesel         diesel knock / clatter
 * @property {number} electric       EV motor / inverter presence
 * @property {number} red            normalised RPM where limiter chatters
 * @property {number} intake         induction roar scale
 * @property {number} body           overall engine body gain scale
 * @property {number[]} gears        transmission ratios (1st…top)
 * @property {number} finalDrive
 * @property {number[]} shiftSpeeds  absolute |vF| upshift thresholds (m/s)
 */

/** @type {Record<string, EngineProfile>} */
export const CAR_ENGINES = {
  // Dodge Viper-style even-fire V10 — deep, even pulse, no turbo, big exhaust
  viper: {
    layout: 'v10', cyl: 10, idleRpm: 800, redlineRpm: 6200,
    sub: 0.55, h05: 0.12, h15: 0.48, h2: 0.52, h3: 0.38, h4: 0.22,
    lope: 5.8, lopeAmt: 0.10,
    fA: 118, fB: 520, fC: 1480, qA: 4.0, qB: 3.2, qC: 2.4,
    turbo: 0, whine: 0.55, burble: 1.15, diesel: 0, electric: 0, red: 0.94,
    intake: 0.85, body: 1.15,
    gears: [2.66, 1.78, 1.30, 1.00, 0.74, 0.50], finalDrive: 3.07,
    shiftSpeeds: [15, 28, 42, 58, 74],
  },
  // Twin-turbo I6 GT — refined idle, angry midrange, strong spool whistle
  kaiser: {
    layout: 'i6', cyl: 6, idleRpm: 750, redlineRpm: 7200,
    sub: 0.32, h05: 0.08, h15: 0.42, h2: 0.55, h3: 0.40, h4: 0.28,
    lope: 8.2, lopeAmt: 0.07,
    fA: 165, fB: 720, fC: 1750, qA: 3.4, qB: 3.8, qC: 2.8,
    turbo: 1.25, whine: 0.7, burble: 1.2, diesel: 0, electric: 0, red: 0.93,
    intake: 1.05, body: 1.0,
    gears: [4.11, 2.32, 1.55, 1.18, 1.00, 0.85], finalDrive: 3.15,
    shiftSpeeds: [14, 27, 42, 58, 78],
  },
  // Cross-plane pushrod V8 — half-order lope, chest thump, overrun burble
  bruiser: {
    layout: 'v8', cyl: 8, idleRpm: 650, redlineRpm: 6000,
    sub: 0.78, h05: 0.62, h15: 0.35, h2: 0.32, h3: 0.16, h4: 0.10,
    lope: 6.2, lopeAmt: 0.32,
    fA: 98, fB: 380, fC: 1180, qA: 4.6, qB: 2.8, qC: 2.0,
    turbo: 0.15, whine: 0.4, burble: 1.55, diesel: 0, electric: 0, red: 0.92,
    intake: 0.7, body: 1.25,
    gears: [2.97, 2.07, 1.43, 1.00, 0.84, 0.57], finalDrive: 3.73,
    shiftSpeeds: [14, 26, 40, 55, 70],
  },
  // Dual-motor EV — no combustion; PWM inverter + gear reduction whine
  cyber: {
    layout: 'ev', cyl: 1, idleRpm: 0, redlineRpm: 16000,
    sub: 0.45, h05: 0, h15: 0.15, h2: 0.35, h3: 0.55, h4: 0.7,
    lope: 0, lopeAmt: 0,
    fA: 90, fB: 420, fC: 2400, qA: 2.2, qB: 1.8, qC: 4.5,
    turbo: 0, whine: 1.4, burble: 0, diesel: 0, electric: 1, red: 0.98,
    intake: 0.15, body: 0.85,
    gears: [1], finalDrive: 9.0,
    shiftSpeeds: [],
  },
  // Porsche flat-6 NA — metallic high-rev scream, intake snarl, PDK snap
  gt3rs: {
    layout: 'f6', cyl: 6, idleRpm: 900, redlineRpm: 9000,
    sub: 0.22, h05: 0.05, h15: 0.55, h2: 0.62, h3: 0.48, h4: 0.42,
    lope: 9.5, lopeAmt: 0.05,
    fA: 210, fB: 980, fC: 2650, qA: 3.2, qB: 4.5, qC: 3.6,
    turbo: 0, whine: 1.15, burble: 0.85, diesel: 0, electric: 0, red: 0.95,
    intake: 1.35, body: 1.05,
    gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96], finalDrive: 4.00,
    shiftSpeeds: [16, 30, 46, 62, 80],
  },
  // Mercedes diesel van — low-rev clatter, turbo whistle, soft exhaust
  vito: {
    layout: 'diesel4', cyl: 4, idleRpm: 700, redlineRpm: 4200,
    sub: 0.58, h05: 0.28, h15: 0.22, h2: 0.38, h3: 0.18, h4: 0.08,
    lope: 7.0, lopeAmt: 0.14,
    fA: 110, fB: 340, fC: 900, qA: 3.6, qB: 2.4, qC: 1.8,
    turbo: 1.1, whine: 0.35, burble: 0.15, diesel: 1, electric: 0, red: 0.90,
    intake: 0.55, body: 0.95,
    gears: [4.40, 2.40, 1.50, 1.00, 0.80, 0.65], finalDrive: 3.45,
    shiftSpeeds: [12, 22, 34, 48, 62],
  },
  // Toyota Corolla 2.0 Dynamic Force I4 (M20A-FKS, NA) — smooth, unobtrusive, CVT-style long gearing
  corolla: {
    layout: 'i4', cyl: 4, idleRpm: 700, redlineRpm: 6600,
    sub: 0.22, h05: 0.06, h15: 0.22, h2: 0.42, h3: 0.24, h4: 0.14,
    lope: 9, lopeAmt: 0.04,
    fA: 170, fB: 700, fC: 1800, qA: 2.6, qB: 3.0, qC: 2.6,
    turbo: 0, whine: 0.35, burble: 0.2, diesel: 0, electric: 0, red: 0.94,
    intake: 0.9, body: 0.85,
    gears: [3.38, 2.04, 1.40, 1.04, 0.82, 0.66], finalDrive: 3.94,
    shiftSpeeds: [12, 22, 33, 45, 57],
  },
  // Mini Cooper S turbo I4 — raspy, induction whoosh, wastegate chirp
  mini: {
    layout: 'i4', cyl: 4, idleRpm: 850, redlineRpm: 6500,
    sub: 0.28, h05: 0.1, h15: 0.3, h2: 0.5, h3: 0.35, h4: 0.25,
    lope: 8.5, lopeAmt: 0.08,
    fA: 185, fB: 780, fC: 2100, qA: 3.0, qB: 3.5, qC: 3.0,
    turbo: 1.05, whine: 0.5, burble: 0.9, diesel: 0, electric: 0, red: 0.93,
    intake: 1.2, body: 0.95,
    gears: [3.92, 2.29, 1.61, 1.21, 1.00, 0.84], finalDrive: 3.59,
    shiftSpeeds: [13, 24, 38, 52, 66],
  },
};

/** Kind-level fallbacks for traffic / rivals / cops */
/** @type {Record<string, EngineProfile>} */
export const KIND_ENGINES = {
  muscle: CAR_ENGINES.bruiser,
  super:  CAR_ENGINES.viper,
  gt:     CAR_ENGINES.kaiser,
  suv: {
    layout: 'i6', cyl: 6, idleRpm: 700, redlineRpm: 5500,
    sub: 0.55, h05: 0.35, h15: 0.28, h2: 0.32, h3: 0.16, h4: 0.1,
    lope: 7.0, lopeAmt: 0.16,
    fA: 130, fB: 440, fC: 1200, qA: 3.8, qB: 2.6, qC: 2.0,
    turbo: 0.55, whine: 0.4, burble: 0.55, diesel: 0.15, electric: 0, red: 0.92,
    intake: 0.6, body: 1.0,
    gears: [3.5, 2.1, 1.45, 1.1, 0.9, 0.7], finalDrive: 3.5,
    shiftSpeeds: [13, 24, 38, 52, 68],
  },
  sedan: {
    layout: 'i4', cyl: 4, idleRpm: 750, redlineRpm: 6000,
    sub: 0.34, h05: 0.12, h15: 0.22, h2: 0.42, h3: 0.22, h4: 0.14,
    lope: 8.0, lopeAmt: 0.07,
    fA: 155, fB: 560, fC: 1500, qA: 3.0, qB: 2.5, qC: 2.2,
    turbo: 0.4, whine: 0.35, burble: 0.4, diesel: 0, electric: 0, red: 0.93,
    intake: 0.7, body: 0.9,
    gears: [3.6, 2.1, 1.45, 1.1, 0.9, 0.75], finalDrive: 3.4,
    shiftSpeeds: [13, 25, 38, 52, 68],
  },
  truck: {
    layout: 'diesel4', cyl: 6, idleRpm: 600, redlineRpm: 3800,
    sub: 0.8, h05: 0.45, h15: 0.3, h2: 0.26, h3: 0.12, h4: 0.06,
    lope: 5.2, lopeAmt: 0.2,
    fA: 95, fB: 300, fC: 780, qA: 4.4, qB: 2.6, qC: 1.6,
    turbo: 1.4, whine: 0.55, burble: 0.2, diesel: 0.85, electric: 0, red: 0.90,
    intake: 0.5, body: 1.1,
    gears: [5.0, 2.8, 1.7, 1.2, 0.9, 0.7], finalDrive: 4.1,
    shiftSpeeds: [10, 18, 28, 40, 52],
  },
};

/**
 * Resolve the engine profile for a vehicle.
 * @param {string|undefined|null} id
 * @param {string|undefined|null} kind
 * @returns {EngineProfile}
 */
export function resolveEngine(id, kind) {
  if (id && CAR_ENGINES[id]) return CAR_ENGINES[id];
  if (kind && KIND_ENGINES[kind]) return KIND_ENGINES[kind];
  return KIND_ENGINES.sedan;
}

/** Firing fundamental (Hz) for a 4-stroke at engine RPM. EV uses motor electrical freq. */
export function firingHz(pr, rpmAbs) {
  if (pr.electric > 0.5) return Math.max(18, rpmAbs / 60); // motor mechanical Hz
  const rpm = Math.max(pr.idleRpm || 600, rpmAbs);
  return (rpm / 60) * (pr.cyl / 2);
}

/** Map normalised 0..1 game RPM → absolute engine RPM for this profile. */
export function absRpm(pr, n) {
  if (pr.electric > 0.5) return Math.max(0, n) * pr.redlineRpm;
  const idle = pr.idleRpm, red = pr.redlineRpm;
  return idle + clamp01(n) * (red - idle);
}

/** Normalised RPM from absolute. */
export function normRpm(pr, rpmAbs) {
  if (pr.electric > 0.5) return clamp01(rpmAbs / Math.max(1, pr.redlineRpm));
  return clamp01((rpmAbs - pr.idleRpm) / Math.max(1, pr.redlineRpm - pr.idleRpm));
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
