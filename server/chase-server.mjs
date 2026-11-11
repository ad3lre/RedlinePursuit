// ===== Redline Pursuit match / room server =====
// Speedway: dedicated authority (inputs in → binary snapshots out). Auto-queue, no peer host.
// Other modes: legacy peer relay (clients sim own cars; host owns bots) until those modes migrate.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Match } from './match.mjs';
import { decodeInput } from '../shared/protocol.js';

const PORT = +process.env.PORT || 3855;
const HOST = process.env.HOST || '127.0.0.1';
const MAX = 12;
const FILL_MS = 7000; // solo Speedway queue → fill with bots
const clampCar = (c) => Math.max(0, Math.min(63, c | 0));
const RELAY = new Set(['s', 'wreck', 'spike', 'dmg', 'despawn', 'assign', 'bust', 'escape']);
const MODES = new Set(['race', 'cop', 'free', 'speed']);
const MAPS = new Set(['coast', 'tokyo', 'stuttgart', 'speedway']);

const players = new Map(); // id -> player
let session = { running: false, event: 'race', sid: 0, map: 'coast', kind: 'peer' };
let nextId = 1;
let match = null; // active Speedway Match
let fillTimer = null;

const clean = (s) => String(s || '').replace(/[^\w \-.!?']/g, '').trim().slice(0, 14) || 'RACER';
const send = (ws, m) => { if (ws && ws.readyState === 1) { try { ws.send(typeof m === 'string' ? m : JSON.stringify(m)); } catch { /* */ } } };
const all = (m, except) => { const s = JSON.stringify(m); for (const p of players.values()) if (p.id !== except) send(p.ws, s); };
const allPlaying = (m, except) => {
  const s = JSON.stringify(m);
  for (const p of players.values()) if (p.id !== except && p.state === 'playing' && p.ws) send(p.ws, s);
};

const HOST_PW = process.env.CHASE_HOST_PASSWORD || 'alcatelidol41';
let hostOverride = null;
function hostId() {
  if (hostOverride && players.has(hostOverride)) return hostOverride;
  hostOverride = null;
  let first = null;
  for (const p of players.values()) { if (!first) first = p.id; if (p.state !== 'menu') return p.id; }
  return first;
}
function sessionPlayers() {
  return [...players.values()]
    .filter((p) => p.state === 'playing')
    .map((p) => ({ id: p.id, name: p.name, role: p.role, car: p.car, slot: p.slot | 0 }));
}
function room() {
  if (session.running && session.kind === 'peer') {
    const h = players.get(session.host);
    if (!h || !h.ws || h.state !== 'playing') {
      const nh = sessionHost();
      if (nh) session.host = nh.id;
    }
  }
  all({
    t: 'room',
    host: hostId(),
    session: {
      running: session.running, event: session.event, map: session.map, sid: session.sid,
      host: session.host, kind: session.kind || 'peer',
    },
    players: [...players.values()].map((p) => ({
      id: p.id, name: p.name, state: p.state, role: p.role, car: p.car, mode: p.mode, away: !p.ws,
    })),
    queue: speedQueue().map((p) => p.id),
  });
}
function checkIdle() {
  if (session.kind === 'server' && match) return;
  if (![...players.values()].some((p) => p.state === 'playing')) {
    session.running = false;
    session.kind = 'peer';
  }
}
function sessionHost() {
  const h = players.get(session.host);
  if (h && h.ws && h.state === 'playing') return h;
  for (const p of players.values()) if (p.ws && p.state === 'playing') return p;
  return null;
}

function speedQueue() {
  return [...players.values()].filter((p) => p.state === 'ready' && p.mode === 'speed' && p.ws);
}

function clearFill() {
  if (fillTimer) { clearTimeout(fillTimer); fillTimer = null; }
}

function tryStartSpeed() {
  if (match) return;
  const q = speedQueue();
  if (!q.length) { clearFill(); return; }
  if (q.length >= 2) { launchSpeed(q); return; }
  // One racer waiting — arm fill timer for bot pack
  if (!fillTimer) {
    fillTimer = setTimeout(() => {
      fillTimer = null;
      if (match) return;
      const q2 = speedQueue();
      if (q2.length) launchSpeed(q2);
    }, FILL_MS);
  }
}

function launchSpeed(parts) {
  clearFill();
  if (match) return;
  const sid = session.sid + 1;
  session = { running: true, event: 'speed', sid, map: 'speedway', kind: 'server', host: null };
  for (const p of parts) { p.state = 'playing'; p.slot = 0; }
  match = new Match({
    sid,
    humans: parts.map((p) => ({ id: p.id, name: p.name, car: p.car, ws: p.ws })),
    broadcast: (m, except) => allPlaying(m, except),
    sendBin: (ws, data) => { if (ws && ws.readyState === 1) try { ws.send(data); } catch { /* */ } },
    onEnd: () => {
      match = null;
      session.running = false;
      session.kind = 'peer';
      for (const p of players.values()) {
        if (p.state === 'playing' && p.mode === 'speed') p.state = 'menu';
      }
      room();
    },
  });
  match.start();
  room();
}

const GRACE_PLAY_MS = 45000;
const GRACE_READY_MS = 30000;
function drop(p) {
  if (!players.has(p.id)) return;
  if (hostOverride === p.id) hostOverride = null;
  clearTimeout(p.graceT); p.graceT = null;
  if (match && match.byPlayer.has(p.id)) match.removePlayer(p.id);
  players.delete(p.id);
  all({ t: 'gone', from: p.id });
  checkIdle();
  tryStartSpeed();
  room();
}
function armGrace(p, ms) {
  clearTimeout(p.graceT);
  p.graceT = setTimeout(() => { if (!p.ws) drop(p); }, ms);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  const kind = match ? `speed-match sid=${match.sid} tick=${match.tick}` : (session.running ? 'peer-session' : 'idle');
  res.end(`chase server ok — ${players.size} online, ${kind}\n`);
});
const wss = new WebSocketServer({ server, maxPayload: 128 * 1024, perMessageDeflate: false, clientTracking: true });

wss.on('connection', (ws) => {
  if (players.size >= MAX * 2) { ws.close(1013, 'full'); return; }

  let me = null;
  let claimed = false;
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const publishNew = () => {
    if (claimed || me) return;
    claimed = true;
    me = {
      id: 'p' + nextId++, ws, token, name: 'RACER', state: 'menu',
      role: 'racer', car: 0, mode: 'race', map: 'coast', slot: 0, misses: 0,
    };
    players.set(me.id, me);
    send(ws, { t: 'welcome', id: me.id, token: me.token, sid: session.sid });
    room();
  };
  const publishT = setTimeout(publishNew, 80);

  ws.isAlive = true;
  ws.misses = 0;
  ws.on('pong', () => { ws.isAlive = true; ws.misses = 0; if (me) me.misses = 0; });

  ws.on('message', (buf, isBinary) => {
    // Binary input for dedicated Speedway match
    if (isBinary) {
      if (!me) publishNew();
      if (!me || !match || me.state !== 'playing') return;
      const inp = decodeInput(buf);
      if (inp) match.setInput(me.id, inp);
      return;
    }

    let m; try { m = JSON.parse(typeof buf === 'string' ? buf : buf.toString()); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'resume') {
      clearTimeout(publishT);
      const old = players.get(m.id);
      if (!old || old.token !== m.token) {
        if (!me) publishNew();
        send(ws, { t: 'resume', ok: false, id: me.id, token: me.token });
        return;
      }
      claimed = true;
      clearTimeout(old.graceT); old.graceT = null;
      if (old.ws && old.ws !== ws) { try { old.ws.terminate(); } catch { /* */ } }
      if (me && me !== old) { players.delete(me.id); }
      old.ws = ws; old.misses = 0; me = old;
      if (match && match.byPlayer.has(me.id)) match.rebind(me.id, ws);
      const payload = {
        t: 'resume', ok: true, id: me.id, token: me.token,
        sid: session.sid, running: session.running, state: me.state,
        kind: session.kind || 'peer',
      };
      if (me.state === 'playing' && session.running) {
        if (session.kind === 'server' && match) {
          payload.rejoin = match.matchMessage();
          payload.rejoin.rejoin = true;
        } else {
          payload.rejoin = {
            event: session.event, map: session.map, sid: session.sid, host: session.host,
            players: sessionPlayers().length ? sessionPlayers() : [{ id: me.id, name: me.name, role: me.role, car: me.car, slot: me.slot | 0 }],
          };
        }
      }
      send(ws, payload);
      room();
      return;
    }

    if (!me) publishNew();
    if (!me) return;

    // Peer RELAY — skip for Speedway server-authority sessions
    if (RELAY.has(m.t)) {
      if (me.state !== 'playing') return;
      if (session.kind === 'server' && match) {
        // Events from clients are ignored; server owns wreck/bust. Spike still allowed as request?
        // Spec: clients send inputs only. Drop peer pose spam.
        if (m.t === 's' || m.t === 'assign') return;
        // Allow cosmetic relay of spike/wreck from client only if we later add request opcodes — for now drop.
        if (m.t === 'wreck' || m.t === 'spike' || m.t === 'bust' || m.t === 'escape' || m.t === 'dmg' || m.t === 'despawn') return;
      }
      m.from = me.id;
      if (m.t === 'dmg' && m.to) { const p = players.get(m.to); if (p) send(p.ws, m); return; }
      if (m.t === 'assign') {
        const p = players.get(m.to);
        if (p) { p.state = 'playing'; p.slot = 0; send(p.ws, m); room(); }
        if (m.takeBot) all({ t: 'taken', bot: m.takeBot, by: m.to, from: me.id }, me.id);
        return;
      }
      const s = JSON.stringify(m);
      for (const p of players.values()) if (p.id !== me.id && p.state === 'playing' && p.ws) send(p.ws, s);
      return;
    }

    switch (m.t) {
      case 'hello': me.name = clean(m.name); room(); break;
      case 'ready': {
        me.name = clean(m.name || me.name);
        me.role = m.role === 'cop' ? 'cop' : 'racer';
        me.car = clampCar(m.car);
        me.mode = MODES.has(m.mode) ? m.mode : 'race';
        me.map = me.mode === 'speed' ? 'speedway' : (MAPS.has(m.map) ? m.map : 'coast');
        me.state = 'ready';
        clearTimeout(me.graceT); me.graceT = null;

        if (me.mode === 'speed') {
          // Dedicated path: late-join running match, else queue
          if (match && session.kind === 'server') {
            me.state = 'playing';
            match.addLate({ id: me.id, name: me.name, car: me.car, ws: me.ws });
            room();
            break;
          }
          room();
          tryStartSpeed();
          break;
        }

        // Legacy peer: notify host of late join
        const h = session.running && session.kind === 'peer' ? sessionHost() : null;
        if (h && h.id !== me.id) send(h.ws, { t: 'joinreq', from: me.id, name: me.name, role: me.role, car: me.car });
        room();
        break;
      }
      case 'menu': {
        const wasPlaying = me.state === 'playing';
        const wasReady = me.state === 'ready';
        me.state = 'menu';
        clearTimeout(me.graceT); me.graceT = null;
        if (wasPlaying && match && match.byPlayer.has(me.id)) match.removePlayer(me.id);
        if (wasPlaying) all({ t: 'gone', from: me.id }, me.id);
        checkIdle();
        if (wasReady && me.mode === 'speed') tryStartSpeed();
        room();
        break;
      }
      case 'go': {
        // Speedway never uses GO — dedicated auto-start only
        if (me.mode === 'speed') return;
        if (hostId() !== me.id) return;
        if (match) return;
        const parts = [...players.values()].filter((p) => p.state !== 'menu' && p.ws && p.mode !== 'speed');
        if (!parts.length) return;
        const event = me.mode === 'free' ? 'free' : 'race';
        const map = me.map || 'coast';
        session = { running: true, event, sid: session.sid + 1, map, host: me.id, kind: 'peer' };
        let r = 0, c = 0;
        const list = parts.map((p) => {
          const slot = p.role === 'cop' ? c++ : r++;
          p.slot = slot;
          return { id: p.id, name: p.name, role: p.role, car: p.car, slot };
        });
        const msg = { t: 'start', event: session.event, map: session.map, sid: session.sid, host: me.id, players: list };
        for (const p of parts) { p.state = 'playing'; send(p.ws, msg); }
        room();
        break;
      }
      case 'claim': {
        me.claimTries = (me.claimTries || 0) + 1;
        if (me.claimTries > 5) { send(ws, { t: 'claim', ok: false, msg: 'Too many attempts' }); break; }
        if (typeof m.pw === 'string' && m.pw.length === HOST_PW.length && m.pw === HOST_PW) {
          hostOverride = me.id; me.claimTries = 0; send(ws, { t: 'claim', ok: true }); room();
        } else send(ws, { t: 'claim', ok: false, msg: 'Wrong password' });
        break;
      }
      case 'ping': send(ws, { t: 'pong', c: m.c }); break;
    }
  });

  ws.on('close', () => {
    clearTimeout(publishT);
    if (!me || me.ws !== ws) return;
    me.ws = null;
    if (me.state === 'playing' && session.running) {
      if (match && match.byPlayer.has(me.id)) match.rebind(me.id, null);
      armGrace(me, GRACE_PLAY_MS);
      room();
    } else if (me.state === 'ready') {
      armGrace(me, GRACE_READY_MS);
      room();
    } else {
      drop(me);
    }
  });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.misses = (ws.misses || 0) + 1;
      if (ws.misses >= 2) { try { ws.terminate(); } catch { /* */ } continue; }
    } else {
      ws.misses = 0;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* */ }
  }
}, 25000);

server.listen(PORT, HOST, () => console.log(`chase server (speed authority + peer relay) on ${HOST}:${PORT}`));
