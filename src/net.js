// ===== Multiplayer client: thin WebSocket wrapper around the room relay (server/chase-server.mjs) =====
// If the socket drops mid-session, the client reconnects and sends {t:'resume', id, token}: the relay re-attaches
// it to the same player record (same id/slot/session) so the other players never see it leave — no split worlds.
export function defaultUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (location.protocol === 'file:') return 'ws://localhost:3855';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // served under /chase/ in production -> /chase/ws ; dev servers fall back to /ws on the same host
  const base = location.pathname.startsWith('/chase') ? '/chase/ws' : '/ws';
  return `${proto}://${location.host}${base}`;
}

const RESUME_WINDOW_MS = 18000; // a little under the relay's 20 s grace

export class Net {
  constructor(url = defaultUrl()) {
    this.url = url; this.ws = null; this.id = null; this.token = null; this.lobby = null; this.ready = null;
    this.listeners = new Set();
    this.inSession = false; // set by the game while a multiplayer session runs -> drops are resumed, not reported
    this._resumeUntil = 0; this._resuming = false;
    // tab coming back from background / network change: make sure we're connected
    window.addEventListener('online', () => this._kick());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this._kick(); });
  }
  get connected() { return !!this.ws && this.ws.readyState === 1; }
  _kick() { if (this._resuming && !this.connected) this._open(); }
  connect() {
    if (this.ws && this.ws.readyState <= 1) return this.ready;
    this.ready = new Promise((resolve, reject) => this._open(resolve, reject));
    return this.ready;
  }
  _open(resolve = () => {}, reject = () => {}) {
    let opened = false;
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { reject(e); return; }
    this.ws = ws;
    ws.onopen = () => {
      opened = true; this._everOpened = true; this._retry = 0;
      if (this._resuming && this.id && this.token) ws.send(JSON.stringify({ t: 'resume', id: this.id, token: this.token }));
      resolve();
    };
    ws.onerror = () => { if (!opened) reject(new Error('Cannot reach multiplayer server')); };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!opened) reject(new Error('Cannot reach multiplayer server'));
      // mid-session drop: try to resume the same identity before giving up
      if ((this.inSession || this._resuming) && this.id && this.token) {
        if (!this._resuming) { this._resuming = true; this._resumeUntil = performance.now() + RESUME_WINDOW_MS; this.emit({ t: 'netstatus', state: 'reconnecting' }); }
        if (performance.now() < this._resumeUntil) { setTimeout(() => { if (!this.connected) this._open(); }, 800); return; }
      }
      this._resuming = false;
      this.id = null; this.token = null; this.lobby = null;
      this.emit({ t: 'closed' });
      // lobby: never sit silently offline (that made START fall back to a solo game = a separate world). Keep retrying.
      if (opened || this._everOpened) {
        this._retry = Math.min(10000, (this._retry || 1000) * 1.6);
        setTimeout(() => { if (!this.ws) this.connect().then(() => this.emit({ t: 'reopened' })).catch(() => {}); }, this._retry);
      }
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') {
        if (this._resuming) return; // a resume follows; don't adopt the throw-away id
        this.id = m.id; this.token = m.token;
      }
      if (m.t === 'resume') {
        this._resuming = false;
        if (m.ok) { this.id = m.id; this.token = m.token; this.emit({ t: 'netstatus', state: 'resumed', running: m.running, sid: m.sid, playerState: m.state }); return; }
        // slot already expired on the relay: we are a brand new player now
        this.id = m.id; this.token = m.token || null; this.emit({ t: 'netstatus', state: 'expired' }); return;
      }
      if (m.t === 'lobby') this.lobby = m;
      this.emit(m);
    };
  }
  send(m) { if (this.connected) this.ws.send(JSON.stringify(m)); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(m) { for (const f of this.listeners) { try { f(m); } catch (e) { console.error(e); } } }
  get isHost() { return !!this.lobby && this.lobby.host === this.id; }
  leave() { this.send({ t: 'leave' }); this.lobby = null; }
}
