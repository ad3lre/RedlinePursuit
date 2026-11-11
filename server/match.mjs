// One dedicated Speedway match: fixed-tick sim, binary snapshots, win/bust rules.
import {
  createSimCar, placeSimCar, stepSimCar, collideSimPair,
} from '../shared/carSim.js';
import {
  resolveSpec, COP_SPEC, COP_HEAVY, RACER_COLORS, BOT_NAMES, PLAYER_SPECS,
} from '../shared/carSpecs.js';
import {
  buildSpeedwayRoute, makeSpeedwayWorld, placeOnGrid, pointAtDist, projectOnRoute,
} from '../shared/speedway.js';
import {
  encodeSnap, driveFromKeys, F_WRECKED, F_NITRO_ON, F_FINISHED, F_OUT, F_BOT, F_COP,
} from '../shared/protocol.js';
import { OvalRacerAI, OvalCopAI } from './sim/botAI.mjs';

export const TICK_MS = 50;       // 20 Hz sim + snap
export const SNAP_EVERY = 1;     // snapshot every tick (20 Hz); tune later
export const TARGET_RACERS = 6;
export const TARGET_COPS = 3;
export const FINISH_LAPS = 1;    // one lap past start grid (~route.length)
export const COUNTDOWN_S = 3.5;

export class Match {
  /**
   * @param {object} opts
   * @param {number} opts.sid
   * @param {Array<{id:string,name:string,car:number,ws:any}>} opts.humans
   * @param {(m:any, except?:string)=>void} opts.broadcast JSON broadcast to match players
   * @param {(ws:any, data:ArrayBuffer)=>void} opts.sendBin
   * @param {()=>void} [opts.onEnd]
   */
  constructor(opts) {
    this.sid = opts.sid;
    this.broadcast = opts.broadcast;
    this.sendBin = opts.sendBin;
    this.onEnd = opts.onEnd || (() => {});
    this.seed = (Math.random() * 1e9) | 0;
    this.route = buildSpeedwayRoute(10);
    this.world = makeSpeedwayWorld(this.route);
    this.finishDist = Math.max(200, this.route.length - 80);
    this.tick = 0;
    this.time = 0;
    this.countdown = COUNTDOWN_S;
    this.running = true;
    this.ended = false;
    this.entities = []; // { slot, id, human, bot, cop, player?, car, ai?, ws? }
    this.byPlayer = new Map(); // playerId -> entity
    this.inputs = new Map(); // playerId -> { seq, keys, steer, at }
    this._timer = null;
    this._snapAcc = 0;

    let slot = 0;
    const humans = opts.humans.slice(0, 12);
    for (const h of humans) {
      const spec = resolveSpec(h.car);
      const car = createSimCar(spec, { role: 'player', name: h.name, nitro: 1 });
      const pose = placeOnGrid(this.route, slot);
      placeSimCar(car, pose.x, pose.z, pose.yaw, 0, this.world.heightAt);
      car.progress = pose.dist;
      const ent = { slot, id: h.id, human: true, bot: false, cop: false, name: h.name, carIdx: h.car | 0, car, ws: h.ws, color: spec.color, color2: spec.color2 };
      this.entities.push(ent);
      this.byPlayer.set(h.id, ent);
      slot++;
    }
    const needBots = Math.max(0, TARGET_RACERS - humans.length);
    for (let i = 0; i < needBots; i++) {
      const carIdx = (i + 1) % PLAYER_SPECS.length;
      const base = resolveSpec(carIdx);
      const col = RACER_COLORS[i % RACER_COLORS.length];
      const pace = 1.02 + i * 0.015;
      const spec = { ...base, top: base.top * pace, color: col[0], color2: col[1] };
      const car = createSimCar(spec, { role: 'racer', name: 'BOT ' + BOT_NAMES[i % BOT_NAMES.length], nitro: 0.85 });
      const pose = placeOnGrid(this.route, slot);
      placeSimCar(car, pose.x, pose.z, pose.yaw, 0, this.world.heightAt);
      car.progress = pose.dist;
      const ai = new OvalRacerAI(car, this.route, 1.02 + i * 0.02);
      ai.lane = pose.lat;
      const id = 'b' + i;
      this.entities.push({
        slot, id, human: false, bot: true, cop: false,
        name: car.name, carIdx, car, ai, color: col[0], color2: col[1],
      });
      slot++;
    }
    for (let i = 0; i < TARGET_COPS; i++) {
      const spec = i === 2 ? COP_HEAVY : COP_SPEC;
      const car = createSimCar(spec, { role: 'cop', police: true, name: spec.name, nitro: 1 });
      const pose = placeOnGrid(this.route, Math.min(slot, 11));
      // cops start a bit behind
      const behind = pointAtDist(this.route, Math.max(0, pose.dist - 18 - i * 10), {});
      const lat = i % 2 ? 8 : -8;
      placeSimCar(car, behind.x + -behind.dz * lat, behind.z + behind.dx * lat, Math.atan2(behind.dx, behind.dz), 0, this.world.heightAt);
      const ai = new OvalCopAI(car, this.route);
      const id = 'c' + i;
      this.entities.push({
        slot, id, human: false, bot: true, cop: true,
        name: spec.name, carIdx: 0, car, ai, color: 0x0b0b0d, color2: 0xf2f2f2,
      });
      slot++;
    }
    this._assignCopTargets();
  }

  roster() {
    return this.entities.map((e) => ({
      id: e.id, name: e.name, role: e.cop ? 'cop' : 'racer',
      car: e.carIdx | 0, slot: e.slot, bot: !!e.bot, human: !!e.human,
      color: e.color, color2: e.color2,
    }));
  }

  matchMessage() {
    return {
      t: 'match',
      sid: this.sid,
      map: 'speedway',
      mode: 'speed',
      event: 'speed',
      seed: this.seed,
      authority: 'server',
      host: null,
      players: this.roster().filter((p) => p.human),
      roster: this.roster(),
      finishDist: this.finishDist,
      tickMs: TICK_MS,
    };
  }

  start() {
    const msg = this.matchMessage();
    for (const e of this.entities) {
      if (e.human && e.ws) {
        try { e.ws.send(JSON.stringify(msg)); } catch { /* */ }
      }
    }
    this._timer = setInterval(() => this._step(), TICK_MS);
  }

  stop() {
    this.running = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  setInput(playerId, inp) {
    if (!this.byPlayer.has(playerId)) return;
    this.inputs.set(playerId, { ...inp, at: this.time });
  }

  /** Late join: take a bot slot or free grid. */
  addLate(player) {
    if (this.ended || this.byPlayer.has(player.id)) return null;
    let bot = this.entities.find((e) => e.bot && !e.cop && !e.wreckTaken && !e.car.wrecked && !e.car.finished);
    if (!bot) bot = this.entities.find((e) => e.bot && !e.cop);
    if (bot) {
      // Replace bot with human at current pose
      bot.wreckTaken = true;
      const spec = resolveSpec(player.car);
      const car = createSimCar(spec, { role: 'player', name: player.name, nitro: bot.car.nitro });
      placeSimCar(car, bot.car.x, bot.car.z, bot.car.yaw, bot.car.speed, this.world.heightAt);
      car.progress = bot.car.progress;
      car.health = bot.car.health;
      const ent = {
        slot: bot.slot, id: player.id, human: true, bot: false, cop: false,
        name: player.name, carIdx: player.car | 0, car, ws: player.ws,
        color: spec.color, color2: spec.color2,
      };
      // remove bot from list
      this.entities = this.entities.filter((e) => e !== bot);
      this.entities.push(ent);
      this.byPlayer.set(player.id, ent);
      this._assignCopTargets();
      const msg = { ...this.matchMessage(), late: true, spawn: { x: car.x, z: car.z, yaw: car.yaw, speed: car.speed, progress: car.progress } };
      try { player.ws.send(JSON.stringify(msg)); } catch { /* */ }
      this.broadcast({ t: 'joined', id: player.id, name: player.name, car: player.car, slot: ent.slot, takeBot: bot.id }, player.id);
      return ent;
    }
    // fresh grid slot
    const slot = this.entities.length;
    const spec = resolveSpec(player.car);
    const car = createSimCar(spec, { role: 'player', name: player.name, nitro: 1 });
    const pose = placeOnGrid(this.route, slot % 12);
    placeSimCar(car, pose.x, pose.z, pose.yaw, 0, this.world.heightAt);
    car.progress = pose.dist;
    const ent = {
      slot, id: player.id, human: true, bot: false, cop: false,
      name: player.name, carIdx: player.car | 0, car, ws: player.ws,
      color: spec.color, color2: spec.color2,
    };
    this.entities.push(ent);
    this.byPlayer.set(player.id, ent);
    const msg = { ...this.matchMessage(), late: true, spawn: { x: car.x, z: car.z, yaw: car.yaw, speed: 0, progress: car.progress } };
    try { player.ws.send(JSON.stringify(msg)); } catch { /* */ }
    this.broadcast({ t: 'joined', id: player.id, name: player.name, car: player.car, slot }, player.id);
    return ent;
  }

  rebind(playerId, ws) {
    const e = this.byPlayer.get(playerId);
    if (e) e.ws = ws;
  }

  removePlayer(playerId) {
    const e = this.byPlayer.get(playerId);
    if (!e) return;
    // Convert to coasting bot so the pack doesn't vanish
    e.human = false; e.bot = true; e.ws = null;
    e.id = e.id.startsWith('b') ? e.id : ('b_' + e.id);
    e.ai = new OvalRacerAI(e.car, this.route, 1.0);
    e.car.role = 'racer';
    this.byPlayer.delete(playerId);
    this.inputs.delete(playerId);
    if (![...this.byPlayer.values()].some((x) => x.human)) this.end('empty');
  }

  _assignCopTargets() {
    const racers = this.entities.filter((e) => !e.cop && !e.car.out);
    let i = 0;
    for (const e of this.entities) {
      if (!e.cop || !e.ai) continue;
      e.ai.target = racers[i % Math.max(1, racers.length)]?.car || null;
      i++;
    }
  }

  _step() {
    if (!this.running || this.ended) return;
    const dt = TICK_MS / 1000;
    this.tick++;
    this.time += dt;
    if (this.countdown > 0) {
      this.countdown -= dt;
      // still broadcast snaps so clients can pose the grid
      this._broadcastSnap();
      return;
    }

    const cars = this.entities.map((e) => e.car);
    let lead = 0;
    for (const e of this.entities) if (!e.cop) lead = Math.max(lead, e.car.progress || 0);

    for (const e of this.entities) {
      if (e.human) {
        const inp = this.inputs.get(e.id);
        if (inp) e.car.input = driveFromKeys(inp.keys, inp.steer);
        else e.car.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 };
      } else if (e.ai) {
        if (e.cop) e.ai.update(dt, cars);
        else e.ai.update(dt, cars, lead);
      }
      stepSimCar(e.car, dt, this.world);
      if (!e.cop) {
        const pr = projectOnRoute(this.route, e.car.x, e.car.z, e.ai?.idx || 0, 40);
        if (e.ai) e.ai.idx = pr.index;
        // only advance progress forward (prevents wrong-way lap cheese)
        if (pr.dist > e.car.progress - 30) e.car.progress = Math.max(e.car.progress, pr.dist);
        if (!e.car.finished && e.car.progress >= this.finishDist) {
          e.car.finished = true;
          this.broadcast({ t: 'event', kind: 'finish', id: e.id, name: e.name, progress: e.car.progress });
        }
      }
      if (e.car.health <= 0 && !e.car.wrecked) {
        e.car.wrecked = true;
        this.broadcast({ t: 'wreck', id: e.id, from: 'server' });
      }
    }

    // pairwise collide
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) collideSimPair(cars[i], cars[j]);
    }

    // bust: cop near slow human racer
    for (const e of this.entities) {
      if (!e.human || e.cop || e.car.out || e.car.finished) continue;
      if (e.car.speed > 6) { e._bust = 0; continue; }
      for (const c of this.entities) {
        if (!c.cop || c.car.wrecked) continue;
        const d = Math.hypot(c.car.x - e.car.x, c.car.z - e.car.z);
        if (d < 10) {
          e._bust = (e._bust || 0) + dt;
          if (e._bust > 3.2) {
            e.car.out = true;
            this.broadcast({ t: 'bust', id: e.id, name: e.name });
          }
        }
      }
    }

    this._broadcastSnap();

    // end when all humans finished/out or one finished and 20s grace
    const humans = this.entities.filter((e) => e.human);
    if (!humans.length) { this.end('empty'); return; }
    if (humans.every((e) => e.car.finished || e.car.out || e.car.wrecked)) {
      this.end('complete');
    }
  }

  _broadcastSnap() {
    const cars = this.entities.map((e) => {
      let flags = 0;
      if (e.car.wrecked) flags |= F_WRECKED;
      if (e.car.nitroActive) flags |= F_NITRO_ON;
      if (e.car.finished) flags |= F_FINISHED;
      if (e.car.out) flags |= F_OUT;
      if (e.bot) flags |= F_BOT;
      if (e.cop) flags |= F_COP;
      return {
        slot: e.slot,
        flags,
        x: e.car.x, y: e.car.y, z: e.car.z,
        yaw: e.car.yaw, vx: e.car.vx, vz: e.car.vz, av: e.car.angVel,
        health: e.car.health, nitro: e.car.nitro,
        progress: e.car.progress || 0,
        id: e.id,
      };
    });
    const bin = encodeSnap(this.tick, this.time, cars);
    for (const e of this.entities) {
      if (e.human && e.ws && e.ws.readyState === 1) {
        try { e.ws.send(bin); } catch { /* */ }
      }
    }
  }

  end(reason) {
    if (this.ended) return;
    this.ended = true;
    this.stop();
    const standings = this.entities
      .filter((e) => !e.cop)
      .map((e) => ({ id: e.id, name: e.name, progress: e.car.progress, finished: !!e.car.finished, out: !!e.car.out }))
      .sort((a, b) => (b.finished - a.finished) || (b.progress - a.progress));
    this.broadcast({ t: 'end', sid: this.sid, reason, standings });
    this.onEnd();
  }
}
