// ===== Multiplayer client: thin WebSocket wrapper around the room relay (server/chase-server.mjs) =====
export function defaultUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (location.protocol === 'file:') return 'ws://localhost:3855';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // served under /chase/ in production -> /chase/ws ; dev servers fall back to /ws on the same host
  const base = location.pathname.startsWith('/chase') ? '/chase/ws' : '/ws';
  return `${proto}://${location.host}${base}`;
}

export class Net {
  constructor(url = defaultUrl()) {
    this.url = url; this.ws = null; this.id = null; this.lobby = null; this.ready = null;
    this.listeners = new Set();
  }
  get connected() { return !!this.ws && this.ws.readyState === 1; }
  connect() {
    if (this.ws && this.ws.readyState <= 1) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      let opened = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => { opened = true; resolve(); };
      ws.onerror = () => { if (!opened) reject(new Error('Cannot reach multiplayer server')); };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null; this.id = null; this.lobby = null;
        if (!opened) reject(new Error('Cannot reach multiplayer server'));
        this.emit({ t: 'closed' });
      };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') this.id = m.id;
        if (m.t === 'lobby') this.lobby = m;
        this.emit(m);
      };
    });
    return this.ready;
  }
  send(m) { if (this.connected) this.ws.send(JSON.stringify(m)); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(m) { for (const f of this.listeners) { try { f(m); } catch (e) { console.error(e); } } }
  get isHost() { return !!this.lobby && this.lobby.host === this.id; }
  leave() { this.send({ t: 'leave' }); this.lobby = null; }
}
