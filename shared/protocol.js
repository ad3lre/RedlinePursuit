// Binary tick protocol for dedicated Speedway matches.
// Lobby / control stay JSON. Inputs + snapshots are ArrayBuffer.

export const OP_INPUT = 1;
export const OP_SNAP = 2;

// keys bitmask
export const KEY_THROTTLE = 1;
export const KEY_BRAKE = 2;
export const KEY_NITRO = 4;
export const KEY_HANDBRAKE = 8;

// car flags in snapshot
export const F_WRECKED = 1;
export const F_NITRO_ON = 2;
export const F_FINISHED = 4;
export const F_HANDBRAKE = 8;
export const F_NITRO_HELD = 16;
export const F_OUT = 32;
export const F_BOT = 64;
export const F_COP = 128;

const INPUT_BYTES = 1 + 4 + 1 + 4; // op + seq + keys + steer
// snap header: op(1) + tick(u32) + time(f32) + count(u8) = 10
// per car: slot(u8) + flags(u8) + x,y,z,yaw,vx,vz,av(f32×7) + health(u8) + nitro(u8) + progress(f32)
const CAR_BYTES = 1 + 1 + 7 * 4 + 1 + 1 + 4;

export function encodeInput(seq, keys, steer, buf = null) {
  const b = buf && buf.byteLength >= INPUT_BYTES ? buf : new ArrayBuffer(INPUT_BYTES);
  const v = new DataView(b);
  v.setUint8(0, OP_INPUT);
  v.setUint32(1, seq >>> 0, true);
  v.setUint8(5, keys & 0xff);
  v.setFloat32(6, steer, true);
  return b;
}

export function decodeInput(buf) {
  const v = new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
  if (v.byteLength < INPUT_BYTES || v.getUint8(0) !== OP_INPUT) return null;
  return {
    seq: v.getUint32(1, true),
    keys: v.getUint8(5),
    steer: v.getFloat32(6, true),
  };
}

export function keysFromDrive(inp) {
  let k = 0;
  if (inp.throttle > 0.15) k |= KEY_THROTTLE;
  if (inp.brake > 0.15) k |= KEY_BRAKE;
  if (inp.nitro > 0.5) k |= KEY_NITRO;
  if (inp.handbrake > 0.5) k |= KEY_HANDBRAKE;
  return k;
}

export function driveFromKeys(keys, steer) {
  return {
    throttle: keys & KEY_THROTTLE ? 1 : 0,
    brake: keys & KEY_BRAKE ? 1 : 0,
    nitro: keys & KEY_NITRO ? 1 : 0,
    handbrake: keys & KEY_HANDBRAKE ? 1 : 0,
    steer: clampSteer(steer),
  };
}

function clampSteer(s) {
  if (!Number.isFinite(s)) return 0;
  return s < -1 ? -1 : s > 1 ? 1 : s;
}

/**
 * @param {number} tick
 * @param {number} timeSec
 * @param {Array<{slot:number,flags:number,x,y,z,yaw,vx,vz,av,health,nitro,progress}>} cars
 */
export function encodeSnap(tick, timeSec, cars) {
  const n = cars.length;
  const b = new ArrayBuffer(10 + n * CAR_BYTES);
  const v = new DataView(b);
  v.setUint8(0, OP_SNAP);
  v.setUint32(1, tick >>> 0, true);
  v.setFloat32(5, timeSec, true);
  v.setUint8(9, n);
  let o = 10;
  for (const c of cars) {
    v.setUint8(o, c.slot & 0xff); o += 1;
    v.setUint8(o, c.flags & 0xff); o += 1;
    v.setFloat32(o, c.x, true); o += 4;
    v.setFloat32(o, c.y, true); o += 4;
    v.setFloat32(o, c.z, true); o += 4;
    v.setFloat32(o, c.yaw, true); o += 4;
    v.setFloat32(o, c.vx, true); o += 4;
    v.setFloat32(o, c.vz, true); o += 4;
    v.setFloat32(o, c.av, true); o += 4;
    v.setUint8(o, Math.max(0, Math.min(255, Math.round((c.health ?? 1) * 255)))); o += 1;
    v.setUint8(o, Math.max(0, Math.min(255, Math.round((c.nitro ?? 0) * 255)))); o += 1;
    v.setFloat32(o, c.progress || 0, true); o += 4;
  }
  return b;
}

export function decodeSnap(buf) {
  const v = new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
  if (v.byteLength < 10 || v.getUint8(0) !== OP_SNAP) return null;
  const tick = v.getUint32(1, true);
  const time = v.getFloat32(5, true);
  const n = v.getUint8(9);
  if (v.byteLength < 10 + n * CAR_BYTES) return null;
  const cars = [];
  let o = 10;
  for (let i = 0; i < n; i++) {
    const slot = v.getUint8(o); o += 1;
    const flags = v.getUint8(o); o += 1;
    const x = v.getFloat32(o, true); o += 4;
    const y = v.getFloat32(o, true); o += 4;
    const z = v.getFloat32(o, true); o += 4;
    const yaw = v.getFloat32(o, true); o += 4;
    const vx = v.getFloat32(o, true); o += 4;
    const vz = v.getFloat32(o, true); o += 4;
    const av = v.getFloat32(o, true); o += 4;
    const health = v.getUint8(o) / 255; o += 1;
    const nitro = v.getUint8(o) / 255; o += 1;
    const progress = v.getFloat32(o, true); o += 4;
    cars.push({ slot, flags, x, y, z, yaw, vx, vz, av, health, nitro, progress });
  }
  return { tick, time, cars };
}

export { CAR_BYTES, INPUT_BYTES };
