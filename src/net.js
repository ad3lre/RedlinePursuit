// ===== Multiplayer client: WebSocket to chase-server (peer relay + dedicated Speedway) =====
// Identity (id+token) is kept in sessionStorage so a refresh / brief drop can resume the same seat.
// Mid-session drops reconnect automatically within the relay grace window.
import { decodeSnap, OP_SNAP } from '../shared/protocol.js';

export function defaultUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (location.protocol === 'file:') return 'ws://localhost:3855';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const base = location.pathname.startsWith('/chase') ? '/chase/ws' : '/ws';
  return `${proto}://${location.host}${base}`;
}

const RESUME_WINDOW_MS = 40000;
const PING_MS = 2500;
const ID_KEY = 'chase-net-id';
const TOK_KEY = 'chase-net-token';

function loadIdentity() {
  try { return { id: sessionStorage.getItem(ID_KEY), token: sessionStorage.getItem(TOK_KEY) }; }
  catch { return { id: null, token: null }; }
}
function saveIdentity(id, token) {
  try {
    if (id && token) { sessionStorage.setItem(ID_KEY, id); sessionStorage.setItem(TOK_KEY, token); }
    else { sessionStorage.removeItem(ID_KEY); sessionStorage.removeItem(TOK_KEY); }
  } catch { /* private mode */ }
}

export class Net {
  constructor(url = defaultUrl()) {
    this.url = url; this.ws = null; this.id = null; this.token = null; this.lobby = null; this.ready = null;
    this.listeners = new Set();
    this.inSession = false;
    this.wantSeat = false;
    this._resumeUntil = 0; this._resuming = false;
    this.rtt = 0.08;
    this.quality = 1;
    this._pingTimer = null; this._pingAt = 0; this._missedPongs = 0;
    this._outbox = [];
    this._retry = 0; this._openGen = 0;
    // Dedicated match clock (server tick / time from last snap)
    this.matchTick = 0;
    this.matchTime = 0;
    this.authority = null; // 'server' | null (peer)
    const saved = loadIdentity();
    if (saved.id && saved.token) { this.id = saved.id; this.token = saved.token; }
    window.addEventListener('online', () => this._kick(true));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this._kick(true); });
  }
  get connected() { return !!this.ws && this.ws.readyState === 1; }
  _shouldResume() {
    return !!(this.id && this.token && (this.inSession || this.wantSeat || this._resuming));
  }
  _kick(force = false) {
    if (this.connected) return;
    if (force || this._resuming || this._shouldResume() || this._everOpened) this._open();
  }
  connect() {
    if (this.ws && this.ws.readyState <= 1) return this.ready || Promise.resolve();
    this.ready = new Promise((resolve, reject) => this._open(resolve, reject));
    return this.ready;
  }
  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (!this.connected) return;
      if (this._pingAt && performance.now() - this._pingAt > PING_MS * 2) {
        this._missedPongs = Math.min(8, this._missedPongs + 1);
        this.quality = Math.max(0, 1 - this._missedPongs * 0.12 - Math.max(0, this.rtt - 0.12) * 2);
      }
      this._pingAt = performance.now();
      this.send({ t: 'ping', c: this._pingAt });
    }, PING_MS);
  }
  _stopPing() { if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; } }
  _flushOutbox() {
    if (!this.connected || !this._outbox.length) return;
    const q = this._outbox.splice(0, this._outbox.length);
    for (const m of q) {
      try {
        if (m instanceof ArrayBuffer || ArrayBuffer.isView(m)) this.ws.send(m);
        else this.ws.send(JSON.stringify(m));
      } catch { this._outbox.push(m); break; }
    }
  }
  _open(resolve = () => {}, reject = () => {}) {
    if (this.ws && this.ws.readyState <= 1) {
      try { this.ws.onclose = null; this.ws.close(); } catch { /* */ }
      this.ws = null;
    }
    const gen = ++this._openGen;
    let opened = false;
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { reject(e); this._scheduleRetry(); return; }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      if (gen !== this._openGen) return;
      opened = true; this._everOpened = true; this._retry = 0; this._missedPongs = 0;
      if (this._shouldResume()) {
        this._resuming = true;
        ws.send(JSON.stringify({ t: 'resume', id: this.id, token: this.token }));
      }
      this._startPing();
      resolve();
    };
    ws.onerror = () => { if (!opened && gen === this._openGen) reject(new Error('Cannot reach multiplayer server')); };
    ws.onclose = () => {
      if (gen !== this._openGen) return;
      if (this.ws === ws) this.ws = null;
      this._stopPing();
      if (!opened) reject(new Error('Cannot reach multiplayer server'));
      const keepTrying = this._shouldResume() || this.wantSeat || this.inSession;
      if (keepTrying && this.id && this.token) {
        if (!this._resuming) {
          this._resuming = true;
          this._resumeUntil = performance.now() + RESUME_WINDOW_MS;
          this.emit({ t: 'netstatus', state: 'reconnecting' });
        }
        if (performance.now() < this._resumeUntil) {
          const wait = Math.min(2000, 250 + (this._retry || 0));
          this._retry = (this._retry || 0) + 250;
          setTimeout(() => { if (!this.connected && gen === this._openGen) this._open(); }, wait);
          return;
        }
        this._resuming = false;
        this.id = null; this.token = null; saveIdentity(null, null);
        this.emit({ t: 'netstatus', state: 'expired' });
        this.emit({ t: 'closed' });
        this._scheduleRetry(true);
        return;
      }
      this._resuming = false;
      this.emit({ t: 'closed' });
      this._scheduleRetry(true);
    };
    ws.onmessage = (e) => {
      if (gen !== this._openGen) return;
      // Binary snapshot from dedicated match server
      if (e.data instanceof ArrayBuffer) {
        const u8 = new Uint8Array(e.data);
        if (u8[0] === OP_SNAP) {
          const snap = decodeSnap(e.data);
          if (snap) {
            this.matchTick = snap.tick;
            this.matchTime = snap.time;
            // Stamp receive time for interp buffer (same shape as peer RemoteAI)
            snap.recvAt = performance.now() * 0.001;
            this.emit({ t: 'snap', snap });
          }
        }
        return;
      }
      let m; try { m = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)); } catch { return; }
      if (m.t === 'pong') {
        if (typeof m.c === 'number') {
          const sample = Math.max(0.01, (performance.now() - m.c) * 0.001);
          this.rtt = this.rtt ? this.rtt * 0.7 + sample * 0.3 : sample;
          this._missedPongs = 0;
          this.quality = Math.max(0, Math.min(1, 1 - Math.max(0, this.rtt - 0.08) * 2.5));
        }
        return;
      }
      if (m.t === 'welcome') {
        if (this._resuming) return;
        this.id = m.id; this.token = m.token; saveIdentity(this.id, this.token);
        this._flushOutbox();
      }
      if (m.t === 'resume') {
        this._resuming = false; this._retry = 0;
        if (m.ok) {
          this.id = m.id; this.token = m.token; saveIdentity(this.id, this.token);
          this._flushOutbox();
          this.emit({
            t: 'netstatus', state: 'resumed', running: m.running, sid: m.sid,
            playerState: m.state, rejoin: m.rejoin || null, kind: m.kind || null,
          });
          return;
        }
        this.id = m.id; this.token = m.token || null; saveIdentity(this.id, this.token);
        this.emit({ t: 'netstatus', state: 'expired' });
        return;
      }
      if (m.t === 'lobby' || m.t === 'room') this.lobby = m;
      if (m.t === 'match' || (m.t === 'start' && m.authority === 'server')) this.authority = 'server';
      if (m.t === 'end') this.authority = null;
      this.emit(m);
    };
  }
  _scheduleRetry(fresh = false) {
    if (!this._everOpened && !this.wantSeat) return;
    this._retry = Math.min(8000, Math.max(600, (this._retry || 600) * (fresh ? 1.4 : 1.2)));
    setTimeout(() => {
      if (this.ws) return;
      this.connect().then(() => this.emit({ t: 'reopened' })).catch(() => {});
    }, this._retry);
  }
  send(m) {
    if (this.connected) {
      try {
        if (m instanceof ArrayBuffer || ArrayBuffer.isView(m)) { this.ws.send(m); return true; }
        this.ws.send(JSON.stringify(m)); return true;
      } catch { /* fall through */ }
    }
    if (m && !(m instanceof ArrayBuffer) && !ArrayBuffer.isView(m)
      && (m.t === 's' || m.t === 'ready' || m.t === 'hello' || m.t === 'menu' || m.t === 'go')) {
      if (m.t === 's') this._outbox = this._outbox.filter((x) => x.t !== 's');
      if (this._outbox.length < 16) this._outbox.push(m);
    }
    return false;
  }
  /** Send binary input (Speedway authority). */
  sendBin(buf) {
    if (this.connected) {
      try { this.ws.send(buf); return true; } catch { /* */ }
    }
    return false;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(m) { for (const f of this.listeners) { try { f(m); } catch (e) { console.error(e); } } }
  get isHost() { return !!this.lobby && this.lobby.host === this.id; }
  leave() {
    this.wantSeat = false; this.inSession = false; this.authority = null;
    this.send({ t: 'menu' }); this.lobby = null;
  }
}
