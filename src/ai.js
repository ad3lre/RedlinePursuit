// ===== AI controllers: racers, police, traffic =====
import { clamp, wrapAngle, lerp } from './util.js';
import { projectOnRoute, pointAtDist } from './roads.js';

const P = {}; const P2 = {}; const P3 = {};

function steerToward(car, tx, tz, gain = 2.1) {
  const desired = Math.atan2(tx - car.pos.x, tz - car.pos.z);
  const diff = wrapAngle(desired - car.yaw);
  // car.js already scales max wheel angle to the physical grip limit at current speed; map heading error cleanly with yaw-rate damping
  const dampTerm = (car.angVel || 0) * 0.09;
  return { steer: clamp((diff - dampTerm) * gain, -1, 1), diff };
}
function speedControl(car, desired) {
  const v = car.vF;
  if (v < desired - 1) { car.input.throttle = clamp((desired - v) / 6, 0.35, 1); car.input.brake = 0; }
  else if (v > desired + 2.5) { car.input.throttle = 0; car.input.brake = clamp((v - desired) / 9, 0.25, 1); }
  else { car.input.throttle = 0.3; car.input.brake = 0; }
}

// lateral avoidance of cars ahead
function avoidance(car, cars, range = 32) {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  const rx = -fz, rz = fx;
  let push = 0, block = 999;
  for (const o of cars) {
    if (o === car || !o.active) continue;
    const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z;
    const fwd = dx * fx + dz * fz;
    if (fwd < 2 || fwd > range) continue;
    const lat = dx * rx + dz * rz;
    if (Math.abs(lat) > 4) continue;
    const relV = car.vF - (o.vel.x * fx + o.vel.y * fz);
    if (relV < 2 && fwd > 10) continue;
    const w = (1 - fwd / range) * (1 - Math.abs(lat) / 4);
    push += (lat >= 0 ? -1 : 1) * w;
    if (Math.abs(lat) < 2.2) block = Math.min(block, fwd);
  }
  return { push, block };
}

function curvatureSpeed(route, prog, latA, carYaw) {
  const a = pointAtDist(route, prog, P);
  const ax = carYaw !== undefined ? Math.sin(carYaw) : a.dx;
  const az = carYaw !== undefined ? Math.cos(carYaw) : a.dz;
  const baseAng = Math.atan2(ax, az);
  let vmax = 999, sharpNear = false;
  for (const d of [8, 16, 26, 40, 60, 85, 115, 150]) {
    const b = pointAtDist(route, prog + d, P2);
    const c = pointAtDist(route, prog + d + 12, P3);
    const ang1 = Math.abs(wrapAngle(Math.atan2(b.dx, b.dz) - baseAng));
    const localAng = Math.abs(wrapAngle(Math.atan2(c.dx, c.dz) - Math.atan2(b.dx, b.dz)));
    if (d <= 30 && (ang1 > 0.45 || localAng > 0.45)) sharpNear = true;
    if (ang1 > 0.03) {
      const R = Math.max(10, d / ang1);
      const vc = Math.sqrt(latA * R);
      const v = Math.sqrt(vc * vc + 2 * 11.5 * Math.max(0, d - 12));
      vmax = Math.min(vmax, v);
    }
    if (localAng > 0.08) {
      const Rloc = Math.max(10, 12 / localAng);
      const vc = Math.sqrt(latA * Rloc);
      const v = Math.sqrt(vc * vc + 2 * 11.5 * Math.max(0, d - 10));
      vmax = Math.min(vmax, v);
    }
  }
  return { vmax, sharpNear };
}

export class RacerAI {
  constructor(car, route, skill = 1) {
    this.car = car; this.route = route; this.skill = skill;
    this.idx = 0; this.progress = 0; this.lane = (Math.random() - 0.5) * 5; this.laneT = this.lane;
    this.stuck = 0; this.reverseT = 0; this.finished = false;
  }
  update(dt, game) {
    const car = this.car;
    if (car.wrecked || this.finished) { car.input.throttle = 0; car.input.brake = 1; car.input.nitro = 0; return; }
    const pr = projectOnRoute(this.route, car.pos.x, car.pos.z, this.idx, 30);
    this.idx = pr.index; this.progress = pr.dist;
    const sp = car.speed;
    const { vmax, sharpNear } = curvatureSpeed(this.route, this.progress, car.gripLimit() * 0.82, car.yaw);
    const look = sharpNear ? clamp(9 + sp * 0.25, 9, 16) : clamp(11 + sp * 0.42, 11, 28);
    const t = pointAtDist(this.route, this.progress + look, P);
    const av = avoidance(car, game.cars);
    const lim = sharpNear ? 2.2 : Math.abs(car.pos.x) < 640 && Math.abs(car.pos.z) < 640 ? 3.8 : 4.8;
    this.laneT = clamp(this.laneT + av.push * dt * 12, -lim, lim);
    if (car.offroad || pr.off > 6 || sharpNear) this.laneT = lerp(this.laneT, 0, dt * 4);
    else if (Math.abs(av.push) < 0.01) this.laneT = lerp(this.laneT, clamp(this.lane, -lim, lim), dt * 0.5);
    const rx = -t.dz, rz = t.dx;
    let tx = t.x + rx * this.laneT, tz = t.z + rz * this.laneT;
    if (pr.off > 10 || car.offroad) { const q = pointAtDist(this.route, this.progress + 12, P2); tx = q.x; tz = q.z; }
    const s = steerToward(car, tx, tz, 2.2);
    car.input.steer = s.steer;
    let desired = Math.min(car.spec.top, vmax) * this.skill;
    // rubber band relative to player
    const pl = game.player;
    if (game.multi && game.mode === 'free') car.boost = 1;
    else if (pl && game.mode !== 'cop') {
      const pp = game.playerProgress ?? this.progress;
      const gap = pp - this.progress;
      desired *= 1 + clamp(gap / 900, -0.12, 0.14);
      car.boost = 1 + clamp(gap / 1500, -0.05, 0.12);
    } else if (game.mode === 'cop') { const d = game.player.pos.distanceTo(car.pos); car.boost = d < 60 ? 1.09 : 1.04; if (d < 80) car.nitro = Math.min(1, car.nitro + dt * 0.06); }
    if (av.block < 14 && sp > 10) desired = Math.min(desired, sp * 0.9);
    if (Math.abs(s.diff) > 0.6) desired = Math.min(desired, 18);
    speedControl(car, desired);
    car.input.handbrake = Math.abs(s.diff) > 0.9 && sp > 22 && sp < 40 ? 1 : 0; // only for slow hairpins: at speed the tyre model scrubs speed anyway
    car.input.nitro = car.nitro > 0.2 && desired > car.spec.top * 0.85 && Math.abs(s.diff) < 0.1 ? 1 : 0;
    car.nitro = Math.min(1, car.nitro + dt * 0.035);
    this.handleStuck(dt, game);
  }
  handleStuck(dt, game) {
    const car = this.car;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      car.input.throttle = 0; car.input.brake = 1; car.input.steer = -car.input.steer; car.input.handbrake = 0; car.input.nitro = 0;
      return;
    }
    if (car.speed < 2.5 && car.input.throttle > 0.2) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 1.6) { this.reverseT = 1.1; this.stuck = 0; this.stuckCount = (this.stuckCount || 0) + 1; }
    if (this.stuckCount > 3) {
      this.stuckCount = 0;
      if (game.distToCamera(car) > 60) {
        const p = pointAtDist(this.route, this.progress + 20, P);
        car.place(p.x, p.z, Math.atan2(p.dx, p.dz), 15);
      }
    }
  }
}

export class CopAI {
  constructor(car, game) {
    this.car = car; this.target = null; this.path = null; this.pathIdx = 0; this.replan = 0;
    this.mode = 'pursue'; this.stuck = 0; this.reverseT = 0; this.spikeCd = 6 + Math.random() * 6; this.direct = false;
    this.parked = false;
  }
  update(dt, game) {
    const car = this.car;
    if (car.wrecked) { car.input.throttle = 0; car.input.brake = 1; car.input.nitro = 0; return; }
    if (this.patrol && this.trafficAI) { this.trafficAI.update(dt, game); return; }
    if (this.parked) { car.input.throttle = 0; car.input.brake = 1; car.input.steer = 0; car.input.handbrake = 1; return; }
    const tg = this.target;
    if (!tg || tg.wrecked) { car.input.throttle = 0; car.input.brake = 0.5; return; }
    const dx = tg.pos.x - car.pos.x, dz = tg.pos.z - car.pos.z;
    const dist = Math.hypot(dx, dz);
    this.dist = dist;
    this.replan -= dt;
    if (this.replan <= 0) {
      this.replan = 0.6 + Math.random() * 0.3;
      const mx = (car.pos.x + tg.pos.x) * 0.5, mz = (car.pos.z + tg.pos.z) * 0.5;
      const onSameRoad = !car.offroad && game.world.hf.onRoad(mx, mz) && (Math.abs(mx) > 612 || Math.abs(mz) > 612 ? game.world.hf.roadDist(mx, mz) < -1 : (Math.min(Math.abs(mx - Math.round(mx / 120) * 120), Math.abs(mz - Math.round(mz / 120) * 120)) < 9.5));
      this.direct = dist < 38 && onSameRoad && game.world.statics.los(car.pos.x, car.pos.z, tg.pos.x, tg.pos.z);
      if (!this.direct) {
        const nav = game.world.nav;
        const a = nav.nearest(car.pos.x, car.pos.z), b = nav.nearest(tg.pos.x + tg.vel.x * 0.8, tg.pos.z + tg.vel.y * 0.8);
        const ids = a && b ? nav.astar(a.id, b.id) : null;
        if (ids && ids.length > 1) {
          let d = 0; const pts = ids.map((id, i) => { const n = nav.nodes[id]; if (i) { const q = nav.nodes[ids[i - 1]]; d += Math.hypot(n.x - q.x, n.z - q.z); } return { x: n.x, z: n.z, d }; });
          this.path = { pts, length: d }; this.pathIdx = 0;
        } else this.path = null;
      }
    }
    let tx, tz, desired;
    const sp = car.speed;
    if (this.direct) {
      const lead = clamp(dist / 55, 0, 1.3);
      tx = tg.pos.x + tg.vel.x * lead; tz = tg.pos.z + tg.vel.y * lead;
      if (dist < 16) {
        // aim slightly toward the target's rear corner for PIT style hits
        const tfx = Math.sin(tg.yaw), tfz = Math.cos(tg.yaw);
        const side = (dx * -tfz + dz * tfx) > 0 ? -1 : 1;
        tx = tg.pos.x - tfx * 1.5 + -tfz * side * 1.2; tz = tg.pos.z - tfz * 1.5 + tfx * side * 1.2;
      }
      desired = tg.speed + clamp(dist * 0.6, 4, 30);
      // avoid suicidal head-on: when approaching from the front, pass alongside then turn around
      const hd = Math.cos(car.yaw - tg.yaw);
      const cfx = Math.sin(car.yaw), cfz = Math.cos(car.yaw);
      const inFront = (dx * cfx + dz * cfz) > 0;
      if (hd < -0.4 && inFront && dist < 90 && dist > 8) {
        const trx = -Math.cos(tg.yaw), trz = Math.sin(tg.yaw);
        const side = ((car.pos.x - tg.pos.x) * trx + (car.pos.z - tg.pos.z) * trz) >= 0 ? 1 : -1;
        tx = tg.pos.x + trx * 8 * side; tz = tg.pos.z + trz * 8 * side;
        desired = 14;
      }
    } else if (this.path) {
      const pr = projectOnRoute(this.path, car.pos.x, car.pos.z, this.pathIdx, 20);
      this.pathIdx = pr.index;
      const { vmax, sharpNear } = curvatureSpeed(this.path, pr.dist, car.gripLimit() * 0.82, car.yaw);
      const t = pointAtDist(this.path, pr.dist + (sharpNear ? 11 : 10 + sp * 0.4), P);
      tx = t.x; tz = t.z;
      desired = Math.min(car.spec.top, vmax);
      if (pr.dist > this.path.length - 30) this.replan = 0;
    } else {
      // No LOS and no A* — drive toward nearest road node by the target (don't cut across terrain)
      const nav = game.world.nav;
      const n = nav.nearest(tg.pos.x, tg.pos.z) || nav.nearest(car.pos.x, car.pos.z);
      tx = n ? n.x : tg.pos.x; tz = n ? n.z : tg.pos.z;
      desired = Math.min(22, tg.speed + 6);
      this.replan = Math.min(this.replan, 0.25);
    }
    const s = steerToward(car, tx, tz, 1.7);
    const av = avoidance(car, game.traffic, 26);
    // avoidance.push is a lane-offset cue (left-axis); for steer, flip so we swerve AWAY
    car.input.steer = clamp(s.steer - av.push * 0.45, -1, 1);
    if (Math.abs(s.diff) > 0.7) desired = Math.min(desired, 16);
    desired = Math.min(desired, car.spec.top * 1.1);
    speedControl(car, desired);
    car.input.handbrake = Math.abs(s.diff) > 0.9 && sp > 22 && sp < 40 ? 1 : 0;
    car.input.nitro = car.nitro > 0.2 && dist > 45 && Math.abs(s.diff) < 0.1 ? 1 : 0;
    car.nitro = Math.min(1, car.nitro + dt * 0.05);
    // rubber band
    car.boost = dist > 250 ? 1.18 : dist > 120 ? 1.1 : dist > 40 ? 1.04 : 1.0;
    // spike strip decision: cop ahead of target and target approaching
    this.spikeCd -= dt;
    if (this.spikeCd < 0 && game.heat >= 2 && dist < 70 && dist > 20) {
      const tfx = Math.sin(tg.yaw), tfz = Math.cos(tg.yaw);
      const ahead = (-dx) * tfx + (-dz) * tfz;
      if (ahead > 20 && tg.speed > 20) { game.dropSpike(car, tg); this.spikeCd = 14 + Math.random() * 8; }
    }
    // stuck
    if (this.reverseT > 0) { this.reverseT -= dt; car.input.throttle = 0; car.input.brake = 1; car.input.steer = -s.steer; car.input.nitro = 0; return; }
    if (sp < 2.5 && car.input.throttle > 0.2) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 1.4) { this.reverseT = 1.0; this.stuck = 0; }
  }
}

export class TrafficAI {
  constructor(car, game) {
    this.car = car; this.game = game; this.cur = null; this.next = null; this.prev = null; this.stunned = 0;
    this.cruise = 14; this.stuck = 0; this.reverseT = 0;
  }
  spawnAt(node, game, dirX = null, dirZ = null) {
    const nav = game.world.nav;
    this.prev = null; this.cur = node; this.stuck = 0; this.reverseT = 0;
    let e = node.edges[Math.floor(Math.random() * node.edges.length)];
    if (dirX !== null && dirZ !== null) {
      let bestD = -2;
      for (const cand of node.edges) {
        const m = nav.nodes[cand.to];
        const ex = m.x - node.x, ez = m.z - node.z, el = Math.hypot(ex, ez) || 1;
        const dot = (ex * dirX + ez * dirZ) / el;
        if (dot > bestD) { bestD = dot; e = cand; }
      }
    }
    this.next = nav.nodes[e.to];
    const dx = this.next.x - node.x, dz = this.next.z - node.z; const l = Math.hypot(dx, dz) || 1;
    this.plannedExit = this.pickExit(nav, this.cur, this.next, dx / l, dz / l, true);
    const lane = this.lane = this.laneFor(node, this.next);
    const x = node.x + (-dz / l) * lane, z = node.z + (dx / l) * lane;
    this.car.place(x, z, Math.atan2(dx, dz), this.cruise * 0.8);
    this.car.health = 1; this.car.wrecked = false; this.stunned = 0;
  }
  laneFor(n, next = null) {
    const city = Math.abs(n.x) <= 600 && Math.abs(n.z) <= 600;
    if (city) {
      this.cruise = 13 + Math.random() * 3.5;
      // On the outer ±600 city perimeter street, keep lane offset smaller so right-hand traffic stays well inside the asphalt
      const onBorder = Math.abs(n.x) >= 595 || Math.abs(n.z) >= 595 || (next && (Math.abs(next.x) >= 595 || Math.abs(next.z) >= 595));
      return onBorder ? 3.2 : 4.6;
    }
    const hw = n.h !== undefined && n.h > 0 && this.game.world.hf.roadDist(n.x, n.z) < 0 && Math.hypot(n.x, n.z) > 1000;
    this.cruise = hw ? 23 + Math.random() * 4 : 18 + Math.random() * 3.5;
    return hw ? 5.8 : 4.2;
  }
  pickExit(nav, from, at, inDx, inDz, roll = false) {
    let opts = at.edges.filter((e) => e.to !== from.id);
    if (!opts.length) return at.edges[0];
    // Avoid routing onto the outer ±600 city perimeter unless already on a connector
    const interior = opts.filter((e) => {
      const m = nav.nodes[e.to];
      return !(Math.abs(m.x) === 600 && Math.abs(at.x) === 600 && Math.abs(m.z) <= 600) &&
             !(Math.abs(m.z) === 600 && Math.abs(at.z) === 600 && Math.abs(m.x) <= 600);
    });
    if (interior.length) opts = interior;
    // Prefer continuing straight; never pick a near-U-turn when a milder option exists
    let best = opts[0], bs = -2;
    for (const e of opts) {
      const m = nav.nodes[e.to];
      const ex = m.x - at.x, ez = m.z - at.z; const el = Math.hypot(ex, ez) || 1;
      const d = (ex * inDx + ez * inDz) / el;
      if (d > bs) { bs = d; best = e; }
    }
    if (roll && opts.length > 1 && Math.random() < 0.25) {
      const mild = opts.filter((e) => {
        const m = nav.nodes[e.to];
        const ex = m.x - at.x, ez = m.z - at.z; const el = Math.hypot(ex, ez) || 1;
        return (ex * inDx + ez * inDz) / el > 0.2;
      });
      if (mild.length) best = mild[Math.floor(Math.random() * mild.length)];
    }
    return best;
  }
  update(dt, game) {
    const car = this.car;
    if (this.stunned > 0) { this.stunned -= dt; car.input.throttle = 0; car.input.brake = 1; car.input.steer = 0; return; }
    if (!this.next) return;
    const nav = game.world.nav;
    const c = this.cur, n = this.next;
    let dx = n.x - c.x, dz = n.z - c.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const along = (car.pos.x - c.x) * dx + (car.pos.z - c.z) * dz;
    const latOff = (car.pos.x - c.x) * (-dz) + (car.pos.z - c.z) * dx;
    if (!this.plannedExit) this.plannedExit = this.pickExit(nav, c, n, dx, dz, true);
    if (along > l - 6 || (along > l * 0.55 && ((n.x - car.pos.x) * dx + (n.z - car.pos.z) * dz) < 0)) {
      const best = this.plannedExit || this.pickExit(nav, c, n, dx, dz, true);
      this.prev = c; this.cur = n; this.next = nav.nodes[best.to];
      const ndx = this.next.x - this.cur.x, ndz = this.next.z - this.cur.z, nl = Math.hypot(ndx, ndz) || 1;
      this.plannedExit = this.pickExit(nav, this.cur, this.next, ndx / nl, ndz / nl, true);
      this.lane = this.laneFor(this.cur, this.next);
    }
    // Recompute after possible advance
    const c2 = this.cur, n2 = this.next;
    let dx2 = n2.x - c2.x, dz2 = n2.z - c2.z; const l2 = Math.hypot(dx2, dz2) || 1; dx2 /= l2; dz2 /= l2;
    const along2 = (car.pos.x - c2.x) * dx2 + (car.pos.z - c2.z) * dz2;
    const exit = this.plannedExit || this.pickExit(nav, c2, n2, dx2, dz2, false);
    const m = nav.nodes[exit.to];
    const ex = m.x - n2.x, ez = m.z - n2.z; const el = Math.hypot(ex, ez) || 1;
    const turnDot = (ex * dx2 + ez * dz2) / el;
    const distToNode = Math.max(0, l2 - along2);
    const look = turnDot < 0.75 ? clamp(9 + car.speed * 0.35, 9, 15) : 11 + car.speed * 0.5;
    let tx, tz;
    if (along2 + look > l2 - 1) {
      const over = along2 + look - l2;
      const ax = n2.x + (ex / el) * over;
      const az = n2.z + (ez / el) * over;
      const nextLane = this.laneFor(n2, m);
      tx = ax - (ez / el) * nextLane;
      tz = az + (ex / el) * nextLane;
    } else {
      const ax = c2.x + dx2 * clamp(along2 + look, 0, l2);
      const az = c2.z + dz2 * clamp(along2 + look, 0, l2);
      tx = ax - dz2 * this.lane;
      tz = az + dx2 * this.lane;
    }
    const dd = Math.hypot(tx - car.pos.x, tz - car.pos.z);
    const s = steerToward(car, tx, tz, 1.85);
    car.input.steer = lerp(car.input.steer || 0, s.steer, clamp(dt * 12, 0, 1));
    let desired = this.cruise;
    if (turnDot < 0.85 && distToNode < 38) {
      const vCorner = 7.5 + 8 * Math.max(0, turnDot);
      desired = Math.min(desired, Math.sqrt(vCorner * vCorner + 2 * 9 * Math.max(0, distToNode - 8)));
    }
    if (Math.abs(s.diff) > 0.3) desired = Math.min(desired, 8.5);
    if (Math.abs(latOff - this.lane) > 5 || dd > 28) desired = Math.min(desired, 9.5);
    const av = avoidance(car, game.carsNear(car, 30), 22);
    if (av.block < 20) desired = Math.min(desired, Math.max(0, (av.block - 7) * 1.2));
    // Stuck: reverse briefly instead of spinning in place at full lock
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      car.input.throttle = 0; car.input.brake = 1; car.input.steer = -Math.sign(s.steer || 1) * 0.7; car.input.handbrake = 0; car.input.nitro = 0;
      return;
    }
    if (car.speed < 2.2 && (car.input.throttle > 0.2 || Math.abs(s.diff) > 0.7)) this.stuck += dt;
    else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 1.5) {
      this.reverseT = 1.0; this.stuck = 0;
      this.stuckCount = (this.stuckCount || 0) + 1;
      if (this.stuckCount > 2) {
        this.stuckCount = 0;
        const nn = nav.nearest(car.pos.x, car.pos.z);
        if (nn) this.spawnAt(nn, game);
        return;
      }
    }
    speedControl(car, desired);
    car.input.handbrake = 0; car.input.nitro = 0;
    // Recover if we drifted way off the graph (loft / bounce / collision)
    if (dd > 80 || Math.abs(latOff) > 40) {
      this.offT = (this.offT || 0) + dt;
      if (this.offT > 2.2) { this.offT = 0; const nn = nav.nearest(car.pos.x, car.pos.z); if (nn) this.spawnAt(nn, game); }
    } else this.offT = 0;
  }
}
