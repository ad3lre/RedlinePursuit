// ===== On-screen touch controls for phones / tablets =====
// Buttons feed the same key set the keyboard uses, so every game system works unchanged.
// Hold buttons (steer, gas, brake, drift, nitro, rear view, EMP) -> keys; tap buttons (pause, camera, reset, spikes) -> one-shot presses.

export const isTouchDevice = () =>
  (typeof window !== 'undefined') &&
  (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));

const CSS = `
body.touch { touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; overscroll-behavior: none; }
#touch { position: absolute; inset: 0; z-index: 30; pointer-events: none; display: none; font-family: 'Rajdhani', sans-serif; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
#touch.on { display: block; }
#touch .tb { position: absolute; pointer-events: auto; touch-action: none; display: flex; align-items: center; justify-content: center; flex-direction: column;
  color: #fff; font-weight: 700; letter-spacing: .08em; text-shadow: 0 1px 4px #000; border-radius: 50%;
  background: rgba(10,12,18,.42); border: 2px solid rgba(255,255,255,.35); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
  transition: transform .06s, background .06s; }
#touch .tb small { font-size: .55em; opacity: .75; letter-spacing: .12em; }
#touch .tb.sq { border-radius: 22px; }
#touch .tb.down { transform: scale(.92); background: rgba(255,255,255,.28); border-color: #fff; }
#touch .tb.gas { background: rgba(30,200,110,.32); border-color: rgba(60,255,150,.7); }
#touch .tb.gas.down { background: rgba(60,255,150,.55); }
#touch .tb.brk { background: rgba(255,60,60,.28); border-color: rgba(255,90,90,.7); }
#touch .tb.brk.down { background: rgba(255,90,90,.55); }
#touch .tb.nit { background: rgba(40,140,255,.32); border-color: rgba(90,180,255,.8); }
#touch .tb.nit.down { background: rgba(90,180,255,.6); }
#touch .tb.cop { background: rgba(60,120,255,.3); border-color: rgba(100,160,255,.8); }
#touch .tb.mini { background: rgba(0,0,0,.45); border-color: rgba(255,255,255,.25); }
#touch .tb .ic { font-size: 1.6em; line-height: 1; }
#rotate-hint { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.92); color: #fff; display: none; flex-direction: column; align-items: center; justify-content: center; font-size: 22px; letter-spacing: .15em; text-align: center; font-family: 'Rajdhani', sans-serif; }
#rotate-hint .ph { font-size: 64px; display: block; animation: rot 1.6s infinite ease-in-out; }
@keyframes rot { 0%,30% { transform: rotate(0); } 70%,100% { transform: rotate(90deg); } }
@media (orientation: portrait) { body.touch.in-game #rotate-hint { display: flex; } }
body.touch #controls-hint, body.touch #mouse-hint, body.touch #abilities, body.touch #camlabel + #radio { }
body.touch #controls-hint, body.touch #mouse-hint, body.touch #abilities { display: none !important; }
body.touch #minimap-wrap { transform: scale(.52); transform-origin: top right; right: calc(8px + env(safe-area-inset-right)); top: 8px; }
body.touch #speedo-wrap { right: auto; left: calc(185px + env(safe-area-inset-left)); bottom: 0; transform: scale(.5); transform-origin: bottom left; }
body.touch #hud-tl { top: 10px; left: calc(12px + env(safe-area-inset-left)); transform: scale(.78); transform-origin: top left; }
body.touch .panel { max-height: 100vh; overflow-y: auto; -webkit-overflow-scrolling: touch; }
`;

// id, label, extra class, hold-key or tap-key, geometry (css), mode
const SIZE = 'clamp(58px, 15vmin, 96px)';
const BIG = 'clamp(74px, 20vmin, 124px)';

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.enabled = isTouchDevice();
    this.visible = false;
    this.btns = new Map();
    if (!this.enabled) return;
    document.body.classList.add('touch');
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const root = (this.root = document.createElement('div')); root.id = 'touch';
    document.getElementById('app').appendChild(root);
    const rot = document.createElement('div'); rot.id = 'rotate-hint'; rot.innerHTML = '<span class="ph">📱</span>ROTATE YOUR DEVICE<small style="font-size:13px;opacity:.7;margin-top:8px">Landscape is required to drive</small>';
    document.body.appendChild(rot);

    const m = '14px';
    const mk = (id, html, cls, geo, key, mode) => this.add(id, html, cls, geo, key, mode);
    // steering: bottom-left
    mk('left', '<span class="ic">◀</span>', '', `left:calc(${m} + 0px);bottom:${m};width:${BIG};height:${BIG}`, 'KeyA', 'hold');
    mk('right', '<span class="ic">▶</span>', '', `left:calc(${m} + ${BIG} + 14px);bottom:${m};width:${BIG};height:${BIG}`, 'KeyD', 'hold');
    // pedals: bottom-right
    mk('gas', 'GAS<small>ACCEL</small>', 'gas', `right:${m};bottom:${m};width:${BIG};height:calc(${BIG} * 1.35);border-radius:40px`, 'KeyW', 'hold');
    mk('brake', 'BRAKE', 'brk', `right:calc(${m} + ${BIG} + 14px);bottom:${m};width:${SIZE};height:${SIZE}`, 'KeyS', 'hold');
    mk('nitro', 'NITRO', 'nit', `right:calc(${m} + ${BIG} + 14px);bottom:calc(${m} + ${SIZE} + 12px);width:${SIZE};height:${SIZE}`, 'ShiftLeft', 'hold');
    mk('drift', 'DRIFT', '', `right:calc(${m} + ${BIG} + ${SIZE} + 28px);bottom:${m};width:${SIZE};height:${SIZE}`, 'Space', 'hold');
    // utility: top-center row
    const uSize = 'clamp(38px, 9vmin, 54px)';
    mk('pause', '❚❚', 'mini', `right:calc(8px + (${uSize} + 6px) * 4);top:calc(8px + 125px + 6px);width:${uSize};height:${uSize};font-size:15px`, 'Escape', 'tap');
    mk('cam', '📷', 'mini', `right:calc(8px + (${uSize} + 6px) * 3);top:calc(8px + 125px + 6px);width:${uSize};height:${uSize};font-size:17px`, 'KeyC', 'tap');
    mk('rear', '⇦', 'mini', `right:calc(8px + (${uSize} + 6px) * 2);top:calc(8px + 125px + 6px);width:${uSize};height:${uSize};font-size:17px`, 'KeyV', 'hold');
    mk('reset', '↺', 'mini', `right:calc(8px + (${uSize} + 6px) * 1);top:calc(8px + 125px + 6px);width:${uSize};height:${uSize};font-size:20px`, 'KeyR', 'tap');
    mk('mute', '♪', 'mini', `right:calc(8px + (${uSize} + 6px) * 0);top:calc(8px + 125px + 6px);width:${uSize};height:${uSize};font-size:18px`, 'KeyM', 'tap');
    // police abilities (shown only in Interceptor mode)
    mk('spike', 'SPIKE', 'cop sq', `left:${m};bottom:calc(${m} + ${BIG} + 16px);width:${SIZE};height:calc(${SIZE} * .8)`, 'KeyQ', 'tap');
    mk('emp', 'EMP', 'cop sq', `left:calc(${m} + ${SIZE} + 12px);bottom:calc(${m} + ${BIG} + 16px);width:${SIZE};height:calc(${SIZE} * .8)`, 'KeyE', 'hold');
    this.btns.get('spike').el.dataset.cop = '1'; this.btns.get('emp').el.dataset.cop = '1';

    // release everything if the page loses focus or a touch is cancelled
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    // block pinch-zoom / double-tap zoom / context menu while playing
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => { if (this.visible) e.preventDefault(); });
    document.addEventListener('touchmove', (e) => { if (this.visible && !e.target.closest('.panel')) e.preventDefault(); }, { passive: false });

    // title screen wording
    const press = document.querySelector('#title .press');
    if (press) press.innerHTML = 'TAP TO START<small>Landscape mode · touch controls enabled</small>';
    const ch = document.getElementById('controls-hint'); if (ch) ch.remove();
  }

  add(id, html, cls, geo, key, mode) {
    const el = document.createElement('div');
    el.className = 'tb ' + cls; el.style.cssText = geo; el.innerHTML = html;
    this.root.appendChild(el);
    const b = { el, key, mode, ptrs: new Set() };
    this.btns.set(id, b);
    const down = (e) => {
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      b.ptrs.add(e.pointerId); el.classList.add('down');
      if (!this.input.keys.has(key)) this.input.pressed.add(key);
      this.input.keys.add(key);
      if (navigator.vibrate && mode === 'tap') navigator.vibrate(8);
    };
    const up = (e) => {
      b.ptrs.delete(e.pointerId);
      if (b.ptrs.size) return;
      el.classList.remove('down');
      this.input.keys.delete(key);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    return b;
  }

  releaseAll() {
    if (!this.enabled) return;
    for (const b of this.btns.values()) { b.ptrs.clear(); b.el.classList.remove('down'); this.input.keys.delete(b.key); }
  }

  // called every frame by main loop
  update(show, cop) {
    if (!this.enabled) return;
    if (show !== this.visible) {
      this.visible = show;
      this.root.classList.toggle('on', show);
      document.body.classList.toggle('in-game', show);
      if (!show) this.releaseAll();
    }
    if (show && cop !== this.cop) {
      this.cop = cop;
      for (const b of this.btns.values()) if (b.el.dataset.cop) b.el.style.display = cop ? 'flex' : 'none';
    }
  }

  // best-effort fullscreen (Android / iPad; iPhone Safari ignores it)
  fullscreen() {
    if (!this.enabled) return;
    const el = document.documentElement;
    try {
      const f = el.requestFullscreen || el.webkitRequestFullscreen;
      if (f && !document.fullscreenElement && !document.webkitFullscreenElement) { const p = f.call(el); if (p && p.catch) p.catch(() => {}); }
      const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {});
    } catch (e) { /* ignore */ }
  }
}
