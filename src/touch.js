// ===== On-screen touch controls — landscape phone / tablet HUD =====
// Analog steer pad + pedal cluster feed Input the same way a pad would.
// Hold buttons still inject keyboard codes for utility / abilities.

export const isTouchDevice = () =>
  (typeof window !== 'undefined') &&
  (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));

const ICO = {
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></svg>`,
  cam: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="14" height="11" rx="2"/><path d="M17 10l4-2v10l-4-2"/><circle cx="10" cy="12.5" r="2.5"/></svg>`,
  rear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h14M10 6l-6 6 6 6"/><path d="M18 7v10" opacity=".55"/></svg>`,
  reset: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/></svg>`,
  mute: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9c1.2 1 1.8 2.2 1.8 3s-.6 2-1.8 3M19 7c2 1.7 3 3.5 3 5s-1 3.3-3 5"/></svg>`,
  gas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 19V7M8 11l4-4 4 4"/></svg>`,
  brake: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  nitro: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h7l-1 8 10-14h-7l1-6z"/></svg>`,
  drift: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 16c3-1 5-4 8-4s5 3 8 4"/><path d="M7 12c2-.8 3.5-2.5 5-2.5S15 11 17 12" opacity=".55"/></svg>`,
  spike: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17h18v2H3zm2-3l2-8h2l2 8H7zm8 0l2-8h2l2 8h-6z"/></svg>`,
  emp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M5 19l2.1-2.1"/></svg>`,
  phone: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="18" y="6" width="28" height="52" rx="5"/><circle cx="32" cy="50" r="2.2" fill="currentColor" stroke="none"/><path d="M26 12h12"/></svg>`,
};

const CSS = `
body.touch {
  touch-action: none; -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; overscroll-behavior: none;
}
#touch {
  position: absolute; inset: 0; z-index: 30; pointer-events: none; display: none;
  font-family: 'Rajdhani', sans-serif;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
#touch.on { display: block; }

/* ---- shared chrome ---- */
#touch .chip, #touch .pedal, #touch .util, #touch .abil {
  pointer-events: auto; touch-action: none; -webkit-user-select: none; user-select: none;
  display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 2px;
  color: rgba(255,255,255,0.92); font-weight: 700; letter-spacing: 0.14em;
  border: 1px solid rgba(255,255,255,0.18);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02)),
    rgba(6, 8, 12, 0.52);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.14),
    inset 0 -1px 0 rgba(0,0,0,0.35),
    0 8px 22px rgba(0,0,0,0.35);
  backdrop-filter: blur(10px) saturate(1.2);
  -webkit-backdrop-filter: blur(10px) saturate(1.2);
  transition: transform .08s ease, background .08s ease, border-color .08s ease, box-shadow .08s ease;
}
#touch .chip.down, #touch .pedal.down, #touch .util.down, #touch .abil.down {
  transform: scale(0.94);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.06)),
    rgba(18, 22, 30, 0.72);
  border-color: rgba(255,255,255,0.55);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.28),
    0 0 0 1px rgba(255,154,26,0.25),
    0 6px 18px rgba(0,0,0,0.4);
}
#touch .lbl {
  font-size: clamp(9px, 2.1vmin, 11px); opacity: 0.72; letter-spacing: 0.18em; line-height: 1;
}
#touch svg { width: 1em; height: 1em; display: block; pointer-events: none; }

/* ---- steer pad (left) ---- */
#touch .steer {
  position: absolute; left: calc(10px + env(safe-area-inset-left)); bottom: calc(12px + env(safe-area-inset-bottom));
  width: clamp(132px, 34vmin, 200px); height: clamp(132px, 34vmin, 200px);
  pointer-events: auto; touch-action: none;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 42%, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 42%, transparent 68%),
    rgba(6, 8, 12, 0.45);
  border: 1px solid rgba(255,255,255,0.16);
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.06),
    inset 0 18px 40px rgba(0,0,0,0.35),
    0 10px 28px rgba(0,0,0,0.35);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
#touch .steer::before {
  content: ''; position: absolute; inset: 18%; border-radius: 50%;
  border: 1px dashed rgba(255,255,255,0.12); pointer-events: none;
}
#touch .steer .ring {
  position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  background: conic-gradient(from 210deg, transparent 0 40deg, rgba(255,154,26,0.0) 40deg, rgba(255,154,26,0.18) 90deg, transparent 140deg 360deg);
  opacity: 0; transition: opacity .15s;
}
#touch .steer.active .ring { opacity: 1; }
#touch .steer .knob {
  position: absolute; width: 42%; height: 42%; left: 29%; top: 29%;
  border-radius: 50%;
  background:
    radial-gradient(circle at 35% 30%, rgba(255,255,255,0.35), rgba(255,255,255,0.05) 40%, transparent 70%),
    linear-gradient(160deg, rgba(40,46,58,0.95), rgba(10,12,16,0.95));
  border: 1px solid rgba(255,255,255,0.28);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.25),
    0 6px 16px rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,0.55); font-size: clamp(10px, 2.4vmin, 12px); letter-spacing: 0.22em;
  will-change: transform;
}
#touch .steer .hint {
  position: absolute; left: 50%; bottom: 10%; transform: translateX(-50%);
  font-size: clamp(9px, 2vmin, 11px); letter-spacing: 0.28em; color: rgba(255,255,255,0.35);
  pointer-events: none;
}
#touch .steer.active .hint { opacity: 0; }

/* ---- pedals (right) ---- */
#touch .pedals {
  position: absolute; right: calc(10px + env(safe-area-inset-right)); bottom: calc(12px + env(safe-area-inset-bottom));
  display: grid;
  grid-template-columns: clamp(64px, 15vmin, 88px) clamp(76px, 18vmin, 108px);
  grid-template-rows: clamp(64px, 15vmin, 88px) clamp(64px, 15vmin, 88px) clamp(64px, 15vmin, 88px);
  grid-template-areas:
    "nitro gas"
    "drift gas"
    "brake gas";
  gap: 10px;
  pointer-events: none;
  align-items: stretch;
}
#touch .pedal {
  width: 100%; height: 100%;
  border-radius: 22px; font-size: clamp(20px, 5vmin, 28px);
}
#touch .pedal.nit { grid-area: nitro; }
#touch .pedal.drift { grid-area: drift; }
#touch .pedal.brk { grid-area: brake; }
#touch .pedal.gas {
  grid-area: gas;
  border-radius: 28px;
  background:
    linear-gradient(180deg, rgba(60,255,150,0.22), rgba(30,160,90,0.08)),
    rgba(6, 8, 12, 0.5);
  border-color: rgba(80,255,160,0.4);
  color: #b8ffd4;
}
#touch .pedal.gas.down {
  background:
    linear-gradient(180deg, rgba(80,255,170,0.45), rgba(40,200,110,0.2)),
    rgba(8, 20, 14, 0.7);
  border-color: #6affb0;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.25), 0 0 24px rgba(60,255,150,0.35);
  color: #fff;
}
#touch .pedal.brk {
  background:
    linear-gradient(180deg, rgba(255,70,70,0.22), rgba(180,30,30,0.08)),
    rgba(6, 8, 12, 0.5);
  border-color: rgba(255,100,100,0.42);
  color: #ffb0b0;
}
#touch .pedal.brk.down {
  background: linear-gradient(180deg, rgba(255,90,90,0.48), rgba(200,40,40,0.22));
  border-color: #ff8080;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.2), 0 0 22px rgba(255,60,60,0.35);
  color: #fff;
}
#touch .pedal.nit {
  background:
    linear-gradient(180deg, rgba(60,150,255,0.26), rgba(30,90,200,0.08)),
    rgba(6, 8, 12, 0.5);
  border-color: rgba(100,180,255,0.45);
  color: #b8dcff;
}
#touch .pedal.nit.down {
  background: linear-gradient(180deg, rgba(90,180,255,0.5), rgba(40,120,255,0.22));
  border-color: #8ec8ff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.25), 0 0 26px rgba(60,150,255,0.4);
  color: #fff;
}
#touch .pedal.drift {
  color: rgba(255,220,140,0.9);
  border-color: rgba(255,180,60,0.35);
}
#touch .pedal.drift.down {
  background: linear-gradient(180deg, rgba(255,180,60,0.4), rgba(200,100,20,0.18));
  border-color: #ffc050;
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.2), 0 0 20px rgba(255,160,40,0.35);
}

/* ---- utility rail (top-right, under minimap) ---- */
#touch .utils {
  position: absolute;
  right: calc(10px + env(safe-area-inset-right));
  top: calc(8px + env(safe-area-inset-top) + min(28vmin, 132px));
  display: flex; gap: 8px; pointer-events: none;
}
#touch .util {
  width: clamp(40px, 9.5vmin, 52px); height: clamp(40px, 9.5vmin, 52px);
  border-radius: 14px; font-size: clamp(16px, 4vmin, 20px); pointer-events: auto;
}
#touch .util.down { color: #fff; border-color: rgba(255,154,26,0.7); }

/* ---- police abilities ---- */
#touch .abils {
  position: absolute;
  left: calc(10px + env(safe-area-inset-left));
  bottom: calc(12px + env(safe-area-inset-bottom) + clamp(132px, 34vmin, 200px) + 12px);
  display: none; gap: 10px; pointer-events: none;
}
#touch .abils.on { display: flex; }
#touch .abil {
  width: clamp(72px, 16vmin, 96px); height: clamp(52px, 12vmin, 68px);
  border-radius: 16px; font-size: clamp(16px, 4vmin, 20px); pointer-events: auto;
  background:
    linear-gradient(180deg, rgba(60,130,255,0.28), rgba(30,70,180,0.1)),
    rgba(6, 8, 12, 0.55);
  border-color: rgba(100,160,255,0.45);
  color: #c8dcff;
}
#touch .abil.down {
  background: linear-gradient(180deg, rgba(90,160,255,0.5), rgba(40,100,220,0.25));
  border-color: #9ec0ff; color: #fff;
  box-shadow: 0 0 22px rgba(60,140,255,0.4);
}

/* ---- rotate overlay ---- */
#rotate-hint {
  position: fixed; inset: 0; z-index: 60; display: none;
  flex-direction: column; align-items: center; justify-content: center; gap: 18px;
  background:
    radial-gradient(ellipse at 50% 40%, rgba(42,20,6,0.55), transparent 55%),
    rgba(0,0,0,0.94);
  color: #fff; text-align: center; font-family: 'Rajdhani', sans-serif;
  padding: 24px;
}
#rotate-hint .ph {
  width: 72px; height: 72px; color: var(--acc, #ff9a1a);
  animation: rotPhone 1.8s ease-in-out infinite;
  filter: drop-shadow(0 0 18px rgba(255,140,20,0.45));
}
#rotate-hint .ph svg { width: 100%; height: 100%; }
#rotate-hint b {
  font-size: clamp(22px, 5vw, 32px); font-style: italic; letter-spacing: 0.28em; font-weight: 700;
}
#rotate-hint small {
  display: block; margin-top: 6px; font-family: 'Noto Sans JP', sans-serif;
  font-size: 13px; letter-spacing: 0.08em; color: rgba(255,255,255,0.55); font-weight: 400;
}
@keyframes rotPhone {
  0%, 18% { transform: rotate(0deg); }
  45%, 70% { transform: rotate(90deg); }
  100% { transform: rotate(90deg); }
}
@media (orientation: portrait) {
  body.touch.in-game #rotate-hint { display: flex; }
}

/* ---- in-game HUD retarget for thumbs ---- */
body.touch #controls-hint,
body.touch #mouse-hint,
body.touch #abilities { display: none !important; }

body.touch #minimap-wrap {
  width: min(28vmin, 148px); height: min(28vmin, 148px);
  right: calc(10px + env(safe-area-inset-right));
  top: calc(8px + env(safe-area-inset-top));
  transform: none;
}
body.touch #minimap-wrap canvas { width: 100% !important; height: 100% !important; }

body.touch #speedo-wrap {
  right: auto;
  left: 50%;
  bottom: calc(4px + env(safe-area-inset-bottom));
  width: min(34vmin, 168px); height: min(34vmin, 168px);
  transform: translateX(-50%);
  opacity: 0.92;
  pointer-events: none;
}
body.touch #speedo-wrap::before { inset: 16%; }
body.touch #speedo-wrap canvas { width: 100% !important; height: 100% !important; }

body.touch #gmeter-wrap {
  display: none !important; /* too crowded with pedals; speedo carries the feel */
}
body.touch #trip {
  left: 50%; right: auto; bottom: calc(2px + env(safe-area-inset-bottom));
  transform: translateX(-50%); text-align: center;
  font-size: 11px; opacity: 0.7; pointer-events: none;
}

body.touch #hud-tl {
  top: calc(8px + env(safe-area-inset-top));
  left: calc(10px + env(safe-area-inset-left));
  transform: none;
}
body.touch #hud-mode { font-size: 11px; letter-spacing: 0.28em; }
body.touch #pos-num { font-size: clamp(36px, 9vmin, 52px); }
body.touch #pos-box small { font-size: clamp(16px, 4vmin, 22px); }
body.touch #bounty-num, body.touch #busted-num { font-size: clamp(26px, 6vmin, 36px); }
body.touch #hud-time { font-size: clamp(18px, 4.5vmin, 24px); }
body.touch #cp, body.touch #dist { font-size: 12px; }

body.touch #heat { top: calc(6px + env(safe-area-inset-top)); }
body.touch #heat .hb { width: 22px; height: 7px; }
body.touch #heat-label { font-size: 11px; letter-spacing: 0.28em; }
body.touch #bustbar { top: calc(52px + env(safe-area-inset-top)); width: min(280px, 70vw); }
body.touch #countdown { font-size: clamp(72px, 22vmin, 120px); }
body.touch #notify { top: 18%; }
body.touch .note .nt { font-size: clamp(22px, 5.5vmin, 30px); }
body.touch .note.big .nt { font-size: clamp(36px, 9vmin, 52px); }
body.touch #radio {
  left: calc(10px + env(safe-area-inset-left));
  bottom: calc(12px + env(safe-area-inset-bottom) + clamp(132px, 34vmin, 200px) + 72px);
  max-width: min(42vw, 280px); font-size: 13px; padding: 6px 10px;
}
body.touch #now-playing { display: none !important; }
body.touch #camlabel { bottom: calc(8px + env(safe-area-inset-bottom) + min(34vmin, 168px)); font-size: 13px; }
body.touch #draft, body.touch #drift-tag {
  bottom: calc(10px + env(safe-area-inset-bottom) + min(34vmin, 168px) + 8px);
  font-size: 12px;
}
body.touch #net-pill {
  right: calc(10px + env(safe-area-inset-right));
  top: calc(8px + env(safe-area-inset-top) + min(28vmin, 148px) + 56px);
  font-size: 10px; padding: 4px 8px;
}
body.touch #wait-banner {
  bottom: calc(18px + env(safe-area-inset-bottom));
  font-size: 14px; padding: 8px 14px; max-width: 90vw; text-align: center;
}
body.touch #btn-go { bottom: calc(64px + env(safe-area-inset-bottom)); font-size: 18px; min-width: 140px; }
body.touch #spec-banner {
  top: calc(56px + env(safe-area-inset-top));
  max-width: 92vw; gap: 8px; padding: 6px 10px; font-size: 14px;
}
body.touch #spec-banner > div { min-width: 0; }
body.touch #spec-banner b { font-size: 18px; }

/* ---- menus / garage on touch ---- */
body.touch .side {
  width: min(520px, 100vw);
  padding: calc(4vh + env(safe-area-inset-top)) calc(4vw + env(safe-area-inset-left)) calc(4vh + env(safe-area-inset-bottom)) calc(4vw + env(safe-area-inset-left));
  background: linear-gradient(90deg, rgba(4,5,8,0.94) 0%, rgba(4,5,8,0.82) 78%, rgba(4,5,8,0.15) 100%);
}
body.touch .side .logo .l1 { font-size: clamp(40px, 10vw, 56px); }
body.touch .side .logo .l2 { font-size: clamp(16px, 4vw, 20px); }
body.touch .h2 { margin: 22px 0 10px; font-size: 13px; }
body.touch .mode { padding: 12px 14px; margin-bottom: 8px; }
body.touch .mode b { font-size: clamp(18px, 4.5vw, 22px); }
body.touch .mode span { font-size: 12px; line-height: 1.35; }
body.touch .padhint { display: none; }
body.touch .namebox input { font-size: 18px; padding: 12px 14px; }
body.touch .panel {
  width: min(640px, 96vw); max-height: calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px);
  padding: 20px 18px; -webkit-overflow-scrolling: touch; overflow-y: auto;
}
body.touch .panel h1 { font-size: 28px; }
body.touch .set-row { flex-wrap: wrap; gap: 10px; padding: 10px 0; }
body.touch .set-row label { width: 100%; font-size: 13px; }
body.touch .rng input { width: min(220px, 60vw); }
body.touch .ctl { grid-template-columns: 100px 1fr; font-size: 13px; gap: 6px 10px; }
body.touch #garage .top {
  top: calc(14px + env(safe-area-inset-top));
  left: calc(4vw + env(safe-area-inset-left));
  right: calc(4vw + env(safe-area-inset-right));
}
body.touch #garage-mode { font-size: clamp(22px, 5.5vw, 30px); }
body.touch #garage-sub { font-size: 12px; max-width: 70vw; }
body.touch #garage .bottom {
  padding: 16px calc(3vw + env(safe-area-inset-left)) calc(16px + env(safe-area-inset-bottom)) calc(3vw + env(safe-area-inset-right));
  gap: 14px; align-items: stretch;
  background: linear-gradient(0deg, rgba(4,5,8,0.96) 0%, rgba(4,5,8,0.78) 70%, rgba(4,5,8,0) 100%);
}
body.touch #car-name { font-size: clamp(26px, 6.5vw, 40px); min-width: 0; }
body.touch #car-desc { font-size: 12px; }
body.touch #car-stats { width: min(280px, 42vw); }
body.touch .gbtns { margin-left: 0; width: 100%; justify-content: flex-end; flex-wrap: wrap; }
body.touch .gbtns .padhint { display: none; }
body.touch .btn.primary { font-size: 18px; padding: 12px 28px; }
body.touch .arrowbtn { width: 44px; height: 44px; }
body.touch #title .press { font-size: 18px; letter-spacing: 0.28em; margin-top: 48px; }
body.touch #loading .tip { bottom: calc(18px + env(safe-area-inset-bottom)); left: 16px; right: 16px; text-align: center; font-size: 12px; }
body.touch #res-title { font-size: clamp(36px, 9vw, 48px); }
body.touch #sound-hint { bottom: calc(12px + env(safe-area-inset-bottom)); font-size: 12px; max-width: 92vw; text-align: center; }
`;

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.enabled = isTouchDevice();
    this.visible = false;
    this.cop = null;
    this.btns = new Map();
    this._steerPtr = null;
    this._steerX = 0;
    this._steerY = 0;
    if (!this.enabled) return;

    document.body.classList.add('touch');
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    const root = (this.root = document.createElement('div')); root.id = 'touch';
    document.getElementById('app').appendChild(root);

    const rot = document.createElement('div');
    rot.id = 'rotate-hint';
    rot.innerHTML = `<div class="ph">${ICO.phone}</div><div><b>ROTATE DEVICE</b><small>Landscape required to drive</small></div>`;
    document.body.appendChild(rot);

    this._buildSteer();
    this._buildPedals();
    this._buildUtils();
    this._buildAbils();

    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => { if (this.visible) e.preventDefault(); });
    document.addEventListener('touchmove', (e) => {
      if (this.visible && !e.target.closest('.panel, .side, .namebox, input, textarea')) e.preventDefault();
    }, { passive: false });

    const press = document.querySelector('#title .press');
    if (press) press.innerHTML = 'TAP TO START<small>Landscape · on-screen controls</small>';
    const ch = document.getElementById('controls-hint'); if (ch) ch.remove();
  }

  _buildSteer() {
    const el = document.createElement('div');
    el.className = 'steer';
    el.innerHTML = `<div class="ring"></div><div class="knob">STEER</div><div class="hint">STEER</div>`;
    this.root.appendChild(el);
    this.steerEl = el;
    this.knobEl = el.querySelector('.knob');

    const setFrom = (cx, cy) => {
      const r = el.getBoundingClientRect();
      const px = (cx - (r.left + r.width / 2)) / (r.width * 0.38);
      const py = (cy - (r.top + r.height / 2)) / (r.height * 0.38);
      const len = Math.hypot(px, py);
      const k = len > 1 ? 1 / len : 1;
      this._steerX = px * k;
      this._steerY = py * k;
      this.knobEl.style.transform = `translate(${this._steerX * 48}%, ${this._steerY * 48}%)`;
      // Finger left → positive steer (same as KeyA)
      this.input.touchSteer = -this._steerX;
    };
    const clear = () => {
      this._steerPtr = null; this._steerX = 0; this._steerY = 0;
      this.knobEl.style.transform = '';
      this.input.touchSteer = 0;
      el.classList.remove('active');
    };

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { /* */ }
      this._steerPtr = e.pointerId;
      el.classList.add('active');
      setFrom(e.clientX, e.clientY);
    });
    el.addEventListener('pointermove', (e) => {
      if (this._steerPtr !== e.pointerId) return;
      e.preventDefault();
      setFrom(e.clientX, e.clientY);
    });
    el.addEventListener('pointerup', (e) => { if (this._steerPtr === e.pointerId) clear(); });
    el.addEventListener('pointercancel', (e) => { if (this._steerPtr === e.pointerId) clear(); });
    el.addEventListener('lostpointercapture', () => { if (this._steerPtr != null) clear(); });
  }

  _buildPedals() {
    const wrap = document.createElement('div');
    wrap.className = 'pedals';
    this.root.appendChild(wrap);
    const mk = (id, label, cls, key, mode, ico) => {
      const el = document.createElement('div');
      el.className = 'pedal ' + cls;
      el.innerHTML = `<span style="font-size:1em">${ico}</span><span class="lbl">${label}</span>`;
      wrap.appendChild(el);
      this._wire(id, el, key, mode);
    };
    mk('nitro', 'NITRO', 'nit', 'ShiftLeft', 'hold', ICO.nitro);
    mk('gas', 'GAS', 'gas', 'KeyW', 'hold', ICO.gas);
    mk('drift', 'DRIFT', 'drift', 'Space', 'hold', ICO.drift);
    mk('brake', 'BRAKE', 'brk', 'KeyS', 'hold', ICO.brake);
  }

  _buildUtils() {
    const wrap = document.createElement('div');
    wrap.className = 'utils';
    this.root.appendChild(wrap);
    const items = [
      ['pause', ICO.pause, 'Escape', 'tap'],
      ['cam', ICO.cam, 'KeyC', 'tap'],
      ['rear', ICO.rear, 'KeyV', 'hold'],
      ['reset', ICO.reset, 'KeyR', 'tap'],
      ['mute', ICO.mute, 'KeyM', 'tap'],
    ];
    for (const [id, ico, key, mode] of items) {
      const el = document.createElement('div');
      el.className = 'util';
      el.innerHTML = ico;
      el.setAttribute('aria-label', id);
      wrap.appendChild(el);
      this._wire(id, el, key, mode);
    }
  }

  _buildAbils() {
    const wrap = document.createElement('div');
    wrap.className = 'abils';
    this.root.appendChild(wrap);
    this.abilsEl = wrap;
    const items = [
      ['spike', 'SPIKE', ICO.spike, 'KeyQ', 'tap'],
      ['emp', 'EMP', ICO.emp, 'KeyE', 'hold'],
    ];
    for (const [id, label, ico, key, mode] of items) {
      const el = document.createElement('div');
      el.className = 'abil';
      el.innerHTML = `${ico}<span class="lbl">${label}</span>`;
      wrap.appendChild(el);
      this._wire(id, el, key, mode);
    }
  }

  _wire(id, el, key, mode) {
    const b = { el, key, mode, ptrs: new Set() };
    this.btns.set(id, b);
    const down = (e) => {
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { /* */ }
      b.ptrs.add(e.pointerId); el.classList.add('down');
      if (!this.input.keys.has(key)) this.input.pressed.add(key);
      this.input.keys.add(key);
      if (navigator.vibrate && mode === 'tap') navigator.vibrate(10);
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
  }

  releaseAll() {
    if (!this.enabled) return;
    for (const b of this.btns.values()) {
      b.ptrs.clear(); b.el.classList.remove('down'); this.input.keys.delete(b.key);
    }
    this._steerPtr = null; this._steerX = 0; this._steerY = 0;
    this.input.touchSteer = 0;
    if (this.knobEl) this.knobEl.style.transform = '';
    if (this.steerEl) this.steerEl.classList.remove('active');
  }

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
      if (this.abilsEl) this.abilsEl.classList.toggle('on', !!cop);
    }
  }

  fullscreen() {
    if (!this.enabled) return;
    const el = document.documentElement;
    try {
      const f = el.requestFullscreen || el.webkitRequestFullscreen;
      if (f && !document.fullscreenElement && !document.webkitFullscreenElement) {
        const p = f.call(el); if (p && p.catch) p.catch(() => {});
      }
      const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {});
    } catch { /* */ }
  }
}
