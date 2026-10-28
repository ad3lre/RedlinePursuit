// ===== Keyboard + gamepad input =====
// Gamepad: all connected pads are merged (some systems expose a "ghost" device at index 0).
// Menu navigation events (NavUp/NavDown/NavLeft/NavRight) are generated from the D-pad and
// the left stick with key-repeat, separately from the raw Pad* buttons used while driving.
const PAD_MAP = { 0: 'PadA', 1: 'PadB', 2: 'PadX', 3: 'PadY', 4: 'PadLB', 5: 'PadRB', 8: 'PadBack', 9: 'PadStart', 10: 'PadL3', 11: 'PadR3', 12: 'PadUp', 13: 'PadDown', 14: 'PadLeft', 15: 'PadRight' };
// Non-"standard" pads (generic USB, some Switch/PS clones) expose their own layout; guess the common DInput ordering so triggers / sticks still work.
const guessAxes = (p) => (p.mapping === 'standard' ? { lx: 0, ly: 1, rx: 2, ry: 3 } : { lx: 0, ly: 1, rx: p.axes.length > 4 ? 2 : 2, ry: p.axes.length > 4 ? 3 : 3 });
const dz = (v, d) => (Math.abs(v) < d ? 0 : Math.sign(v) * ((Math.abs(v) - d) / (1 - d)));

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.pad = null;
    this.padCount = 0;
    this.padPrev = [];
    this.padVals = [];
    this.padAxes = [0, 0]; this.padRight = [0, 0]; this.deadzone = 0.12; this.kind = 'xbox'; this.rumble = true; this._rumbleUntil = 0;
    this.navDir = null; this.navNext = 0;
    this.lastPadInput = 0;
    this.steerSmooth = 0;
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  k(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }

  pollPad() {
    let list = [];
    try { list = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter((p) => p && p.connected); } catch (e) { list = []; }
    this.padCount = list.length;
    this.pad = list.find((p) => p.mapping === 'standard') || list[0] || null;
    const b = [], v = [];
    let ax = 0, ay = 0, rx = 0, ry = 0;
    for (const p of list) {
      const m = guessAxes(p);
      const id = (p.id || '').toLowerCase();
      this.kind = /054c|dualshock|dualsense|playstation|wireless controller/.test(id) ? 'ps' : /057e|switch|pro controller/.test(id) ? 'switch' : 'xbox';
      p.buttons.forEach((x, i) => {
        const val = typeof x === 'object' ? x.value : x;
        const pr = typeof x === 'object' ? x.pressed || x.value > 0.5 : x > 0.5;
        if (pr) b[i] = true;
        v[i] = Math.max(v[i] || 0, val || 0);
      });
      const a0 = p.axes[m.lx] || 0, a1 = p.axes[m.ly] || 0, a2 = p.axes[m.rx] || 0, a3 = p.axes[m.ry] || 0;
      if (Math.abs(a0) > Math.abs(ax)) ax = a0;
      if (Math.abs(a1) > Math.abs(ay)) ay = a1;
      if (Math.abs(a2) > Math.abs(rx)) rx = a2;
      if (Math.abs(a3) > Math.abs(ry)) ry = a3;
      this.pads = list;
    }
    this.padVals = v; this.padAxes = [ax, ay]; this.padRight = [dz(rx, 0.18), dz(ry, 0.18)];
    let any = false;
    for (const [i, name] of Object.entries(PAD_MAP)) {
      if (b[i] && !this.padPrev[i]) { this.pressed.add(name); any = true; }
      if (b[i]) this.keys.add(name); else this.keys.delete(name);
    }
    // any other button (e.g. sticks click, triggers) also counts as activity
    if (!any) for (let i = 0; i < b.length; i++) if (b[i] && !this.padPrev[i]) { any = true; break; }
    this.padPrev = b;
    // menu navigation with auto-repeat (D-pad or left stick)
    let dir = null;
    if (b[12]) dir = 'NavUp'; else if (b[13]) dir = 'NavDown'; else if (b[14]) dir = 'NavLeft'; else if (b[15]) dir = 'NavRight';
    else if (Math.abs(ax) > 0.55 || Math.abs(ay) > 0.55) dir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'NavRight' : 'NavLeft') : (ay > 0 ? 'NavDown' : 'NavUp');
    const now = performance.now();
    if (dir !== this.navDir) {
      this.navDir = dir;
      if (dir) { this.pressed.add(dir); this.navNext = now + 380; any = true; }
    } else if (dir && now > this.navNext) { this.pressed.add(dir); this.navNext = now + 120; }
    if (any) this.lastPadInput = now;
  }

  // produce driving input
  drive(dt) {
    let steer = 0, throttle = 0, brake = 0;
    const left = this.k('KeyA', 'ArrowLeft'), right = this.k('KeyD', 'ArrowRight');
    const target = (left ? 1 : 0) - (right ? 1 : 0);
    // keyboard steering ramps for smoothness
    const rate = target === 0 ? 7 : Math.sign(target) !== Math.sign(this.steerSmooth) ? 9 : 4.2;
    this.steerSmooth += Math.max(-rate * dt, Math.min(rate * dt, target - this.steerSmooth));
    steer = this.steerSmooth;
    throttle = this.k('KeyW', 'ArrowUp') ? 1 : 0;
    brake = this.k('KeyS', 'ArrowDown') ? 1 : 0;
    let handbrake = this.k('Space') ? 1 : 0;
    let nitro = this.k('ShiftLeft', 'ShiftRight', 'KeyN') ? 1 : 0;
    if (this.padCount) {
      const ax = this.padAxes[0], D = this.deadzone;
      if (Math.abs(ax) > D) steer = -Math.sign(ax) * ((Math.abs(ax) - D) / (1 - D)) ** 1.4;
      const rt = this.padVals[7] || 0, lt = this.padVals[6] || 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (this.k('PadX', 'PadB')) handbrake = 1;
      if (this.k('PadA')) nitro = 1;
    }
    return { steer, throttle, brake, handbrake, nitro };
  }
  // Controller rumble (dual-rumble where supported). strong = low-frequency body, weak = high-frequency buzz.
  vibrate(ms, strong = 0.6, weak = 0.4) {
    if (!this.rumble || !this.padCount) return;
    const now = performance.now(); if (now < this._rumbleUntil - ms * 0.5 && strong < 0.8) return; // don't spam small hits over a big one
    this._rumbleUntil = now + ms;
    for (const p of this.pads || []) {
      const a = p.vibrationActuator; if (!a) continue;
      try { if (a.playEffect) a.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: Math.min(1, weak), strongMagnitude: Math.min(1, strong) }); else if (a.pulse) a.pulse(Math.min(1, strong), ms); } catch (e) { /* unsupported */ }
    }
  }
  stopRumble() { for (const p of this.pads || []) { try { p.vibrationActuator?.reset?.(); } catch (e) { /* */ } } this._rumbleUntil = 0; }
  endFrame() { this.pressed.clear(); }
}
