// ===== Redline Pursuit room relay — ONE shared room =====
// Everyone who opens the game is in the same room. Players pick mode + car through the normal menu and
// press START -> "ready". The host (owner) launches the session with GO (button / G key). Humans take
// racer or cop slots; the host's game fills every other slot with bots and simulates them. Players who
// ready up while a session is running are handed a bot's car by the host (joinreq -> assign).
// Each client simulates its own car; the server only relays. Served at wss://rxnd.de/chase/ws.
import http from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = +process.env.PORT || 3855;
const HOST = process.env.HOST || '127.0.0.1';
const MAX = 12;
// Allow any non-negative car index (client clamps with % PLAYER_CARS.length), so adding cars never needs a relay cap bump.
const clampCar = (c) => Math.max(0, Math.min(63, c | 0));
const RELAY = new Set(['s', 'wreck', 'spike', 'dmg', 'despawn', 'assign', 'bust', 'escape']);

const players = new Map(); // id -> { id, ws, name, state: 'menu'|'ready'|'playing', role, car, mode }
let session = { running: false, event: 'race', sid: 0, map: 'coast' };
const MAPS = new Set(['coast', 'tokyo', 'stuttgart']);
let nextId = 1;

const clean = (s) => String(s || '').replace(/[^\w \-.!?]/g, '').trim().slice(0, 14) || 'RACER';
const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };
const all = (m, except) => { const s = JSON.stringify(m); for (const p of players.values()) if (p.id !== except) send(p.ws, s); };

// owner = first connected player; if the owner is idling in the menu, the earliest ready/playing player runs things
// Host takeover (Shift+A in the client): whoever proves the password becomes owner until they disconnect.
// Override with CHASE_HOST_PASSWORD in the service environment; the value below is the default.
const HOST_PW = process.env.CHASE_HOST_PASSWORD || 'alcatelidol41';
let hostOverride = null;
function hostId() {
  if (hostOverride && players.has(hostOverride)) return hostOverride;
  hostOverride = null;
  let first = null;
  for (const p of players.values()) { if (!first) first = p.id; if (p.state !== 'menu') return p.id; }
  return first;
}
function room() {
  all({ t: 'room', host: hostId(), session: { running: session.running, event: session.event, map: session.map, sid: session.sid, host: session.host }, players: [...players.values()].map((p) => ({ id: p.id, name: p.name, state: p.state, role: p.role, car: p.car, mode: p.mode, away: !p.ws })) });
}
function checkIdle() { if (![...players.values()].some((p) => p.state === 'playing')) session.running = false; }
// who answers join requests for the running session: the host that launched it (it simulates the bots), else any player still in it
function sessionHost() {
  const h = players.get(session.host);
  if (h && h.ws && h.state === 'playing') return h;
  for (const p of players.values()) if (p.ws && p.state === 'playing') return p;
  return null;
}
const GRACE_MS = 20000; // a playing client that drops keeps its slot this long so it can resume without a split
function drop(p) {
  if (!players.has(p.id)) return;
  if (hostOverride === p.id) hostOverride = null;
  players.delete(p.id); all({ t: 'gone', from: p.id }); checkIdle(); room();
}

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`chase relay ok — ${players.size} online, session ${session.running ? 'running' : 'idle'}\n`); });
const wss = new WebSocketServer({ server, maxPayload: 128 * 1024 });

wss.on('connection', (ws) => {
  if (players.size >= MAX * 2) { ws.close(1013, 'full'); return; }
  let me = { id: 'p' + nextId++, ws, token: Math.random().toString(36).slice(2) + Date.now().toString(36), name: 'RACER', state: 'menu', role: 'racer', car: 0, mode: 'race' };
  players.set(me.id, me);
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  send(ws, { t: 'welcome', id: me.id, token: me.token, sid: session.sid });
  room();
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (RELAY.has(m.t)) {
      m.from = me.id;
      if (m.t === 'dmg' && m.to) { const p = players.get(m.to); if (p) send(p.ws, m); return; }
      if (m.t === 'assign') {
        const p = players.get(m.to);
        if (p) { p.state = 'playing'; send(p.ws, m); room(); }
        // tell everyone else in the session which bot was handed over, so nobody keeps a frozen copy of it
        if (m.takeBot) all({ t: 'taken', bot: m.takeBot, by: m.to, from: me.id }, me.id);
        return;
      }
      const s = JSON.stringify(m);
      for (const p of players.values()) if (p.id !== me.id && p.state === 'playing') send(p.ws, s);
      return;
    }
    switch (m.t) {
      case 'resume': {
        // reconnect after a drop: re-attach this socket to the old player record (same id, same slot, same session)
        const old = players.get(m.id);
        if (!old || old === me || old.token !== m.token) { send(ws, { t: 'resume', ok: false, id: me.id, token: me.token }); break; }
        clearTimeout(old.graceT); old.graceT = null;
        if (old.ws && old.ws !== ws) { try { old.ws.terminate(); } catch { /* */ } }
        players.delete(me.id);
        old.ws = ws; me = old;
        send(ws, { t: 'resume', ok: true, id: me.id, token: me.token, sid: session.sid, running: session.running, state: me.state });
        room();
        break;
      }
      case 'hello': me.name = clean(m.name); room(); break;
      case 'ready': {
        me.name = clean(m.name || me.name); me.role = m.role === 'cop' ? 'cop' : 'racer'; me.car = clampCar(m.car); me.mode = ['race', 'cop', 'free'].includes(m.mode) ? m.mode : 'race';
        me.map = MAPS.has(m.map) ? m.map : 'coast';
        me.state = 'ready';
        const h = session.running ? sessionHost() : null;
        if (h && h.id !== me.id) send(h.ws, { t: 'joinreq', from: me.id, name: me.name, role: me.role, car: me.car });
        room();
        break;
      }
      case 'menu': me.state = 'menu'; all({ t: 'gone', from: me.id }, me.id); checkIdle(); room(); break;
      case 'go': {
        if (hostId() !== me.id) return;
        const parts = [...players.values()].filter((p) => p.state !== 'menu');
        if (!parts.length) return;
        session = { running: true, event: me.mode === 'free' ? 'free' : 'race', sid: session.sid + 1, map: me.map || 'coast', host: me.id };
        let r = 0, c = 0;
        const list = parts.map((p) => ({ id: p.id, name: p.name, role: p.role, car: p.car, slot: p.role === 'cop' ? c++ : r++ }));
        const msg = { t: 'start', event: session.event, map: session.map, sid: session.sid, host: me.id, players: list };
        for (const p of parts) { p.state = 'playing'; send(p.ws, msg); }
        room();
        break;
      }
      case 'claim': {
        // brute-force guard: 5 tries per connection, then locked for that connection
        me.claimTries = (me.claimTries || 0) + 1;
        if (me.claimTries > 5) { send(ws, { t: 'claim', ok: false, msg: 'Too many attempts' }); break; }
        if (typeof m.pw === 'string' && m.pw.length === HOST_PW.length && m.pw === HOST_PW) { hostOverride = me.id; me.claimTries = 0; send(ws, { t: 'claim', ok: true }); room(); }
        else send(ws, { t: 'claim', ok: false, msg: 'Wrong password' });
        break;
      }
      case 'ping': send(ws, { t: 'pong', c: m.c }); break;
    }
  });
  ws.on('close', () => {
    if (me.ws !== ws) return; // this socket was superseded by a resume
    me.ws = null;
    if (me.state === 'playing' && session.running) {
      // keep the slot: others keep seeing the car (frozen-extrapolated) until resume or grace expiry
      const p = me;
      p.graceT = setTimeout(() => { if (!p.ws) drop(p); }, GRACE_MS);
      room();
    } else drop(me);
  });
  ws.on('error', () => {});
});

setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch { /* */ } } }, 15000);
server.listen(PORT, HOST, () => console.log(`chase relay (single room) on ${HOST}:${PORT}`));
