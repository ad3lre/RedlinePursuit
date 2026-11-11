// Playable car stats (mirrors src/car.js PLAYER_CARS) + kind dims for headless sim.
export const KIND_DIMS = {
  super: { L: 4.55, W: 1.98, wheelR: 0.36, wb: 1.38 },
  gt: { L: 4.7, W: 1.96, wheelR: 0.37, wb: 1.45 },
  muscle: { L: 4.8, W: 1.98, wheelR: 0.38, wb: 1.5 },
  sedan: { L: 4.7, W: 1.85, wheelR: 0.34, wb: 1.42 },
  suv: { L: 4.8, W: 1.95, wheelR: 0.42, wb: 1.5 },
  truck: { L: 6.6, W: 2.3, wheelR: 0.45, wb: 2.2 },
  tank: { L: 7.0, W: 3.0, wheelR: 0.5, wb: 2.4 },
};

export const PLAYER_SPECS = [
  { id: 'viper', name: 'VIPER GT', kind: 'super', top: 91.7, accel: 18.0, grip: 9.5, steer: 1.0, mass: 1.0, armor: 1.0, color: 0xc8101a, color2: 0x101010, livery: 'stripe' },
  { id: 'kaiser', name: 'KAISER RS', kind: 'gt', top: 87.5, accel: 16.5, grip: 8.8, steer: 0.92, mass: 1.1, armor: 1.1, color: 0xe8ecf0, color2: 0x1846ff, livery: 'stripe' },
  { id: 'bruiser', name: 'BRUISER V8', kind: 'muscle', top: 75.0, accel: 17.5, grip: 8.6, steer: 0.95, mass: 1.45, armor: 1.5, color: 0xff7a00, color2: 0x111111, livery: 'split' },
  { id: 'cyber', name: 'CYBERTRUCK', kind: 'suv', cg: 0.74, top: 58.3, accel: 18.5, grip: 8.0, steer: 0.82, mass: 1.9, armor: 1.9, color: 0xb8bcc2, color2: 0x111111, livery: 'plain' },
  { id: 'gt3rs', name: 'GT3 RS', kind: 'super', cg: 0.44, top: 82.2, accel: 18.5, grip: 10.6, steer: 1.12, mass: 0.95, armor: 0.85, color: 0xd8d018, color2: 0x111111, livery: 'plain' },
  { id: 'vito', name: 'VITO VAN', kind: 'suv', cg: 0.78, top: 55.6, accel: 11.0, grip: 7.4, steer: 0.78, mass: 2.1, armor: 1.7, color: 0xf2f2f2, color2: 0x111111, livery: 'plain' },
  { id: 'mini', name: 'MINI COOPER S', kind: 'sedan', cg: 0.5, top: 66.7, accel: 14.5, grip: 9.4, steer: 1.18, mass: 0.85, armor: 0.75, color: 0xc8102e, color2: 0x111111, livery: 'plain' },
  { id: 'jesko', name: 'JESKO ATTACK', kind: 'super', cg: 0.42, top: 141.7, accel: 22.0, grip: 10.8, steer: 1.04, mass: 1.0, armor: 0.8, color: 0xe8e8ea, color2: 0x111111, livery: 'plain' },
  { id: 'corolla', name: 'COROLLA 2020', kind: 'sedan', cg: 0.52, top: 54.2, accel: 11.5, grip: 8.6, steer: 1.02, mass: 1.0, armor: 1.0, color: 0xc8ccd2, color2: 0x111111, livery: 'plain' },
  { id: 'model_s', name: 'MODEL S P100D', kind: 'gt', cg: 0.48, top: 69.4, accel: 20.5, grip: 9.4, steer: 1.0, mass: 1.35, armor: 1.15, color: 0x1a1a1e, color2: 0x111111, livery: 'plain' },
  { id: 'mclaren', name: '720S', kind: 'super', cg: 0.43, top: 94.7, accel: 19.8, grip: 10.4, steer: 1.1, mass: 0.92, armor: 0.82, color: 0xe85a00, color2: 0x111111, livery: 'plain' },
  { id: 'gwagon', name: 'G 63 AMG', kind: 'suv', cg: 0.76, top: 61.1, accel: 16.8, grip: 8.3, steer: 0.84, mass: 2.05, armor: 1.85, color: 0x1a1a1a, color2: 0x111111, livery: 'plain' },
  { id: 'civic', name: 'CIVIC TYPE R', kind: 'sedan', cg: 0.5, top: 66.7, accel: 15.5, grip: 9.6, steer: 1.15, mass: 0.9, armor: 0.8, color: 0xc8102e, color2: 0x111111, livery: 'plain' },
];

export const COP_SPEC = { id: 'interceptor', name: 'INTERCEPTOR', kind: 'gt', top: 91, accel: 17, grip: 9.6, steer: 1.0, mass: 1.25, armor: 1.0 };
export const COP_HEAVY = { id: 'heavy', name: 'HEAVY SUV', kind: 'suv', top: 84, accel: 15, grip: 9, steer: 0.9, mass: 2.0, armor: 1.8 };

export const RACER_COLORS = [[0x1ec8ff, 0x101010], [0x9aff1e, 0x101010], [0xffd400, 0x101010], [0xa020ff, 0xffffff], [0xffffff, 0xff2050], [0x202020, 0xff6a00]];
export const BOT_NAMES = ['KAZE', 'NOVA', 'VIPERA', 'GHOST', 'RAVEN', 'ZERO', 'BLAZE', 'NITRO'];

export function resolveSpec(carIdx) {
  const i = ((carIdx | 0) % PLAYER_SPECS.length + PLAYER_SPECS.length) % PLAYER_SPECS.length;
  return PLAYER_SPECS[i];
}

export function dimsFor(spec) {
  return KIND_DIMS[spec.kind] || KIND_DIMS.sedan;
}
