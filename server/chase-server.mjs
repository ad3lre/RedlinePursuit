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
const RELAY = new Set(['s', 'wreck', 'spike', 'dmg', 'despawn', 'assign']);

const players = new Map(); // id -> { id, ws, name, state: 'menu'|'ready'|'playing', role, car, mode }
let session = { running: false, event: 'race', sid: 0 };
let nextId = 1;

const clean = (s) => String(s || '').replace(/[^\w \-.!?]/g, '').trim().slice(0, 14) || 'RACER';
const send = (ws, m) => { if (ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };
const all = (m, except) => { const s = JSON.stringify(m); for (const p of players.values()) if (p.id !== except) send(p.ws, s); };

// owner = first connected player; if the owner is idling in the menu, the earliest ready/playing player runs things
function hostId() {
  let first = null;
  for (const p of players.values()) { if (!first) first = p.id; if (p.state !== 'menu') return p.id; }
  return first;
}
function room() {
  all({ t: 'room', host: hostId(), session: { running: session.running, event: session.event }, players: [...players.values()].map((p) => ({ id: p.id, name: p.name, state: p.state, role: p.role, car: p.car, mode: p.mode })) });
}
function checkIdle() { if (![...players.values()].some((p) => p.state === 'playing')) session.running = false; }

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`chase relay ok — ${players.size} online, session ${session.running ? 'running' : 'idle'}\n`); });
const wss = new WebSocketServer({ server, maxPayload: 128 * 1024 });

wss.on('connection', (ws) => {
  if (players.size >= MAX * 2) { ws.close(1013, 'full'); return; }
  const me = { id: 'p' + nextId++, ws, name: 'RACER', state: 'menu', role: 'racer', car: 0, mode: 'race' };
  players.set(me.id, me);
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  send(ws, { t: 'welcome', id: me.id });
  room();
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (RELAY.has(m.t)) {
      m.from = me.id;
      if (m.t === 'assign') { const p = players.get(m.to); if (p) { p.state = 'playing'; send(p.ws, m); room(); } return; }
      const s = JSON.stringify(m);
      for (const p of players.values()) if (p.id !== me.id && p.state === 'playing') send(p.ws, s);
      return;
    }
    switch (m.t) {
      case 'hello': me.name = clean(m.name); room(); break;
      case 'ready': {
        me.name = clean(m.name || me.name); me.role = m.role === 'cop' ? 'cop' : 'racer'; me.car = (m.car | 0) % 3; me.mode = ['race', 'cop', 'free'].includes(m.mode) ? m.mode : 'race';
        me.state = 'ready';
        const h = players.get(hostId());
        if (session.running && h && h.id !== me.id && h.state === 'playing') send(h.ws, { t: 'joinreq', from: me.id, name: me.name, role: me.role, car: me.car });
        room();
        break;
      }
      case 'menu': me.state = 'menu'; all({ t: 'gone', from: me.id }, me.id); checkIdle(); room(); break;
      case 'go': {
        if (hostId() !== me.id) return;
        const parts = [...players.values()].filter((p) => p.state !== 'menu');
        if (!parts.length) return;
        session = { running: true, event: me.mode === 'free' ? 'free' : 'race', sid: session.sid + 1 };
        let r = 0, c = 0;
        const list = parts.map((p) => ({ id: p.id, name: p.name, role: p.role, car: p.car, slot: p.role === 'cop' ? c++ : r++ }));
        const msg = { t: 'start', event: session.event, sid: session.sid, host: me.id, players: list };
        for (const p of parts) { p.state = 'playing'; send(p.ws, msg); }
        room();
        break;
      }
      case 'ping': send(ws, { t: 'pong', c: m.c }); break;
    }
  });
  ws.on('close', () => { players.delete(me.id); all({ t: 'gone', from: me.id }); checkIdle(); room(); });
  ws.on('error', () => {});
});

setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch { /* */ } } }, 15000);
server.listen(PORT, HOST, () => console.log(`chase relay (single room) on ${HOST}:${PORT}`));
