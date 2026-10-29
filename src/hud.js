// ===== HUD: speedometer, G-meter, minimap, notifications, markers =====
import * as THREE from 'three';
import { clamp } from './util.js';
import { fmtTime } from './game.js';
import { WORLD_HALF } from './terrain.js';
import { pointAtDist } from './roads.js';
import { MS_TO_KMH, MS2_TO_G, fmtDistance } from './units.js';

const $ = (id) => document.getElementById(id);
const v = new THREE.Vector3();

export class HUD {
  constructor() {
    this.root = $('hud');
    this.speedo = $('speedo').getContext('2d');
    this.gmeter = $('gmeter') ? $('gmeter').getContext('2d') : null;
    this.mini = $('minimap').getContext('2d');
    this.notifyBox = $('notify');
    this.markers = $('markers');
    this.markerPool = [];
    this.dmgFlash = 0;
    this.radioBox = $('radio');
  }
  show(b) { this.root.classList.toggle('hidden', !b); }
  setMode(mode, game) {
    this.mode = mode;
    $('hud-mode').textContent = { race: 'HOT PURSUIT RACE', cop: 'INTERCEPTOR', free: 'FREE RUN' }[mode];
    $('abilities').classList.toggle('hidden', mode !== 'cop');
    $('pos-box').classList.toggle('hidden', mode !== 'race');
    $('bounty-box').classList.toggle('hidden', mode !== 'free');
    $('busted-box').classList.toggle('hidden', mode !== 'cop');
    $('heat').classList.toggle('hidden', mode === 'cop');
    this.notifyBox.innerHTML = '';
  }
  notify(t, sub, color, big) {
    const d = document.createElement('div');
    d.className = 'note' + (big ? ' big' : '');
    d.style.setProperty('--c', color);
    d.innerHTML = `<div class="nt">${t}</div>${sub ? `<div class="ns">${sub}</div>` : ''}`;
    this.notifyBox.appendChild(d);
    while (this.notifyBox.children.length > 4) this.notifyBox.removeChild(this.notifyBox.firstChild);
    setTimeout(() => d.classList.add('out'), big ? 2600 : 1700);
    setTimeout(() => d.remove(), big ? 3200 : 2300);
  }
  radio(text) {
    const r = this.radioBox;
    r.innerHTML = `<span class="rtag">POLICE RADIO</span> ${text}`;
    r.classList.remove('hidden'); r.classList.remove('rfade'); void r.offsetWidth; r.classList.add('rfade');
  }
  countdown(n) {
    const c = $('countdown');
    c.textContent = n; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
    if (n === 'GO!') setTimeout(() => (c.textContent = ''), 900);
  }
  flashDamage(a) { this.dmgFlash = Math.max(this.dmgFlash, a); }
  camLabel(text) {
    const c = $('camlabel'); c.textContent = 'Camera: ' + text; c.classList.remove('rfade'); void c.offsetWidth; c.classList.add('rfade');
  }

  update(dt, g, camera, world, settings) {
    const pl = g.player; if (!pl) return;
    this.dmgFlash = Math.max(0, this.dmgFlash - dt * 1.5);
    const kmh = Math.round(pl.speed * MS_TO_KMH);
    this._manual = !!pl.manual;
    this.drawSpeedo(kmh, pl.rpm, pl.gear, pl.nitro, pl.health, pl.nitroActive, pl.vF < -0.5);
    this.drawGMeter(pl.accelLong, pl.accelLat);
    const trip = $('trip');
    if (trip) trip.innerHTML = `TRIP <b>${fmtDistance(pl.odometer)}</b>`;
    // top-left info
    $('hud-time').textContent = fmtTime(g.raceTime || 0);
    if (g.mode === 'race') {
      $('pos-num').textContent = g.position || '-';
      $('cp').textContent = `CP ${Math.min(g.checkIdx, g.checkpoints.length - 1)}/${g.checkpoints.length - 1}`;
      $('dist').textContent = `${Math.max(0, (g.finishDist - g.playerProgress) / 1000).toFixed(1)} km left`;
    } else if (g.mode === 'cop') {
      $('busted-num').textContent = `${g.bustedRacers}/${g.racerTotal ? g.racerTotal() : 4}`;
      $('cp').textContent = `Escaped ${g.escapedRacers}`;
      $('dist').textContent = '';
    } else {
      $('bounty-num').textContent = Math.round(g.bounty).toLocaleString();
      $('cp').textContent = g.pursuit ? `Pursuit ${fmtTime(g.pursuitTime)}` : g.cooldown > 0 ? 'Cooling down' : 'Patrols on alert';
      $('dist').textContent = `Escapes: ${g.escapes}`;
    }
    // heat
    const heatEl = $('heat');
    if (g.mode !== 'cop') {
      const bars = heatEl.querySelectorAll('.hb');
      bars.forEach((b, i) => b.classList.toggle('on', i < g.heat && g.pursuit));
      $('heat-label').textContent = g.pursuit ? (g.mode === 'free' && g.lastSeen > 2 ? `Losing them… ${Math.max(0, 14 - g.lastSeen).toFixed(0)}` : 'PURSUIT') : g.mode === 'free' ? 'UNDETECTED' : 'STANDBY';
      heatEl.classList.toggle('active', g.pursuit);
      heatEl.classList.toggle('evade', g.mode === 'free' && g.pursuit && g.lastSeen > 2);
    }
    const bb = $('bustbar');
    bb.classList.toggle('hidden', g.bust <= 0.01);
    $('bustfill').style.width = `${Math.round(g.bust * 100)}%`;
    $('wrongway').classList.toggle('hidden', !g.wrongWay);
    $('draft').classList.toggle('hidden', !g.drafting);
    const driftEl = $('drift-tag');
    if (driftEl) {
      const drifting = !!(pl.drifting && pl.speed > 15);
      driftEl.classList.toggle('hidden', !drifting);
      if (drifting) driftEl.textContent = (g.driftT || 0) > 2.2 ? 'PERFECT DRIFT' : (g.driftT || 0) > 1.0 ? `DRIFT  ${(g.driftT || 0).toFixed(1)}s` : 'DRIFTING';
    }
    $('centerdot').classList.toggle('hidden', !settings.centerDot);
    // abilities (cop)
    if (g.mode === 'cop') {
      const sc = g.spikeCd, ec = g.empState.cd;
      $('ab-spike').style.setProperty('--p', `${(1 - sc / 12) * 100}%`);
      $('ab-spike').classList.toggle('ready', sc <= 0);
      $('ab-emp').style.setProperty('--p', `${(1 - ec / 14) * 100}%`);
      $('ab-emp').classList.toggle('ready', ec <= 0);
      $('ab-emp').classList.toggle('locking', g.empState.lock > 0);
      $('emp-lock').style.width = `${Math.min(100, (g.empState.lock / 2) * 100)}%`;
    }
    // checkpoint arrow
    const arrow = $('arrow');
    if (g.gatePos && g.gates.visible) {
      const dx = g.gatePos.x - pl.pos.x, dz = g.gatePos.z - pl.pos.z;
      camera.getWorldDirection(v);
      const camYaw = Math.atan2(v.x, v.z);
      const a = Math.atan2(dx, dz) - camYaw;
      arrow.classList.remove('hidden');
      arrow.style.transform = `translateX(-50%) rotate(${-a}rad)`;
      $('arrow-d').textContent = `${Math.round(Math.hypot(dx, dz))} m`;
    } else arrow.classList.add('hidden');
    this.drawMinimap(g, world, dt);
    this.updateMarkers(g, camera);
  }

  /** Racing G-meter: measured long/lat accel in m/s², displayed in g. Forward accel = up.
   *  Lateral is flipped to match on-screen / steer left-right (A = left): body +X is screen-left
   *  with the chase/cockpit camera looking along +Z, so raw IMU "right" reads opposite the dial. */
  drawGMeter(longMs2, latMs2) {
    const c = this.gmeter; if (!c) return;
    const W = 132, H = 132, cx = 66, cy = 62, R = 52;
    const gMax = 2.0; // dial full-scale (±2 g)
    const gl = (longMs2 || 0) * MS2_TO_G;
    const ga = -(latMs2 || 0) * MS2_TO_G; // negate so L/R match steering & screen
    const mag = Math.hypot(gl, ga);
    c.clearRect(0, 0, W, H);
    // face
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fill();
    c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.2)'; c.stroke();
    // rings at 1g / 2g
    for (const f of [0.5, 1, 1.5]) {
      c.beginPath(); c.arc(cx, cy, R * (f / gMax), 0, Math.PI * 2);
      c.strokeStyle = f === 1 ? 'rgba(255,176,0,0.35)' : 'rgba(255,255,255,0.12)';
      c.lineWidth = f === 1 ? 1.5 : 1; c.stroke();
    }
    // crosshair
    c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
    // labels
    c.fillStyle = 'rgba(255,255,255,0.45)'; c.font = '700 9px Rajdhani, sans-serif'; c.textAlign = 'center';
    c.fillText('ACCEL', cx, cy - R + 11);
    c.fillText('BRAKE', cx, cy + R - 3);
    c.textAlign = 'left'; c.fillText('L', cx - R + 4, cy + 3);
    c.textAlign = 'right'; c.fillText('R', cx + R - 4, cy + 3);
    // ball
    const nx = clamp(ga / gMax, -1, 1), ny = clamp(-gl / gMax, -1, 1);
    const bx = cx + nx * R * 0.92, by = cy + ny * R * 0.92;
    const hot = mag > 1.15;
    c.beginPath(); c.arc(bx, by, 7, 0, Math.PI * 2);
    c.fillStyle = hot ? '#ff4a3a' : '#ffb000';
    c.shadowColor = hot ? '#ff3030' : '#ffb000'; c.shadowBlur = 10; c.fill(); c.shadowBlur = 0;
    c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke();
    // numeric readout (true g from measured m/s²)
    c.textAlign = 'center';
    c.fillStyle = '#fff'; c.font = 'italic 800 18px Rajdhani, sans-serif';
    c.fillText(`${mag.toFixed(2)} g`, cx, H - 4);
    c.fillStyle = 'rgba(255,176,0,0.85)'; c.font = '700 10px Rajdhani, sans-serif';
    c.fillText(`${gl >= 0 ? '+' : ''}${gl.toFixed(2)}↑  ${ga >= 0 ? '+' : ''}${ga.toFixed(2)}→`, cx, 12);
  }

  drawSpeedo(kmh, rpm, gear, nitro, health, nitroOn, rev) {
    const c = this.speedo, W = 300, H = 300, cx = 150, cy = 158;
    c.clearRect(0, 0, W, H);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    // background ring
    c.lineCap = 'round';
    c.lineWidth = 16; c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.beginPath(); c.arc(cx, cy, 118, a0, a1); c.stroke();
    // rpm arc
    const r = clamp(rpm, 0, 1);
    const grad = c.createLinearGradient(30, 0, 270, 0);
    grad.addColorStop(0, '#ffb000'); grad.addColorStop(0.75, '#ff5a00'); grad.addColorStop(1, '#ff1030');
    c.strokeStyle = grad; c.shadowColor = '#ff6a00'; c.shadowBlur = 16;
    c.beginPath(); c.arc(cx, cy, 118, a0, a0 + (a1 - a0) * r); c.stroke();
    c.shadowBlur = 0;
    // ticks
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 2;
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * (i / 10);
      const r1 = 100, r2 = i % 2 ? 94 : 88;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); c.stroke();
    }
    // nitro arc (inner)
    c.lineWidth = 8; c.strokeStyle = 'rgba(80,160,255,0.15)';
    c.beginPath(); c.arc(cx, cy, 78, Math.PI * 0.8, Math.PI * 1.2); c.stroke();
    c.strokeStyle = nitroOn ? '#9fe0ff' : '#2f8cff'; c.shadowColor = '#3fa0ff'; c.shadowBlur = nitroOn ? 20 : 8;
    c.beginPath(); c.arc(cx, cy, 78, Math.PI * 1.2 - Math.PI * 0.4 * clamp(nitro, 0, 1), Math.PI * 1.2); c.stroke();
    // damage arc
    c.shadowBlur = 0; c.strokeStyle = 'rgba(255,60,60,0.15)';
    c.beginPath(); c.arc(cx, cy, 78, Math.PI * 1.8, Math.PI * 2.2); c.stroke();
    const hcol = health > 0.5 ? '#3cff8a' : health > 0.25 ? '#ffc400' : '#ff3030';
    c.strokeStyle = hcol; c.shadowColor = hcol; c.shadowBlur = 8;
    c.beginPath(); c.arc(cx, cy, 78, Math.PI * 1.8, Math.PI * 1.8 + Math.PI * 0.4 * clamp(health, 0, 1)); c.stroke();
    c.shadowBlur = 0;
    // text
    c.fillStyle = '#fff'; c.textAlign = 'center';
    c.font = 'italic 800 78px Rajdhani, "Arial Narrow", sans-serif';
    c.fillText(String(kmh), cx, cy + 22);
    c.font = '700 16px Rajdhani, sans-serif'; c.fillStyle = 'rgba(255,255,255,0.6)';
    c.fillText('km/h', cx, cy + 46);
    c.font = 'italic 800 34px Rajdhani, sans-serif'; c.fillStyle = '#ffb000';
    c.fillText(rev ? 'R' : String(gear), cx, cy + 96);
    if (this._manual) { c.font = '700 12px Rajdhani, sans-serif'; c.fillStyle = 'rgba(255,176,0,0.8)'; c.fillText('MANUAL', cx, cy + 112); }
    c.font = '700 12px Rajdhani, sans-serif'; c.fillStyle = '#6fb8ff'; c.fillText('NITRO', cx - 70, cy + 4 - 40);
    c.fillStyle = hcol; c.fillText('DAMAGE', cx + 70, cy - 36);
  }

  // ---------------- Minimap ----------------
  // Heading-up radar. The view is centred *ahead* of the car (you care about what's coming, not what's behind) and
  // zooms smoothly with speed; Z cycles zoom presets (auto / near / far). Everything that matters but is outside the
  // circle (next checkpoint, racers, chasing cops, finish) is pinned to the rim with a distance tag.
  drawMinimap(g, world, dt = 1 / 60) {
    const c = this.mini, S = 240, R = S / 2, RIN = R - 6;
    const pl = g.player; if (!pl || !world.minimapCanvas) return;
    const now = performance.now();
    const blink = (now / 250) % 2 < 1;
    const zoomMul = [1, 0.55, 2.2][this.mapZoom || 0];
    // ---- smooth zoom / look-ahead (no frame-to-frame pumping) ----
    const targetRange = (190 + clamp(pl.speed * 3.2, 0, 260)) * zoomMul; // metres from centre to rim
    this._mmRange = this._mmRange ? this._mmRange + (targetRange - this._mmRange) * Math.min(1, dt * 2.5) : targetRange;
    const range = this._mmRange, scale = RIN / range; // px per metre
    const ahead = RIN * 0.28; // player sits below centre -> ~64% of the map shows the road ahead
    const rot = Math.PI + pl.yaw; // heading up
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    // world -> screen
    const toS = (x, z) => {
      const dx = (x - pl.pos.x) * scale, dz = (z - pl.pos.z) * scale;
      return [R + dx * cosR - dz * sinR, R + ahead + dx * sinR + dz * cosR];
    };
    const inside = (sx, sy, pad = 0) => (sx - R) ** 2 + (sy - R) ** 2 < (RIN - pad) ** 2;
    // pin a point to the rim along the ray from the map centre
    const pin = (sx, sy, pad) => { const dx = sx - R, dy = sy - R, d = Math.hypot(dx, dy) || 1, r = RIN - pad; return [R + dx / d * r, R + dy / d * r]; };
    const distTag = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + 'k' : Math.round(m / 10) * 10 + '');

    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.arc(R, R, RIN, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#0a0d12'; c.fillRect(0, 0, S, S);
    // ---- base map (pre-rendered terrain + city + roads) ----
    c.save();
    c.translate(R, R + ahead); c.rotate(rot);
    const img = world.minimapCanvas, ms = world.minimapScale;
    const sx = (pl.pos.x + WORLD_HALF) * ms, sz = (pl.pos.z + WORLD_HALF) * ms, span = range * 1.6;
    c.imageSmoothingEnabled = true;
    c.drawImage(img, sx - span * ms, sz - span * ms, span * 2 * ms, span * 2 * ms, -span * scale, -span * scale, span * 2 * scale, span * 2 * scale);
    c.restore();
    // vignette toward the rim for depth
    const vg = c.createRadialGradient(R, R, RIN * 0.55, R, R, RIN);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = vg; c.fillRect(0, 0, S, S);

    // ---- race route: driven part dim, road ahead bright with flowing chevrons ----
    const offMap = []; // [screenX, screenY, colour, label, kind]
    if (g.route) {
      const pts = g.route.pts, idx = g.plIdx || 0, lim = range * 1.7;
      const col = g.mode === 'cop' ? '80,170,255' : '255,180,0';
      const near = (p) => Math.abs(p.x - pl.pos.x) < lim && Math.abs(p.z - pl.pos.z) < lim;
      c.lineJoin = 'round'; c.lineCap = 'round';
      // behind
      c.beginPath(); let first = true;
      for (let i = Math.max(0, idx - 80); i <= idx && i < pts.length; i++) { if (!near(pts[i])) { first = true; continue; } const [x, y] = toS(pts[i].x, pts[i].z); if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y); }
      c.strokeStyle = `rgba(${col},0.28)`; c.lineWidth = 3; c.stroke();
      // ahead: dark under-stroke + bright line
      const ahd = []; for (let i = idx; i < pts.length; i++) { if (!near(pts[i])) { if (ahd.length) break; continue; } ahd.push(toS(pts[i].x, pts[i].z)); }
      if (ahd.length > 1) {
        c.beginPath(); ahd.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 6.5; c.stroke();
        c.strokeStyle = `rgba(${col},0.95)`; c.lineWidth = 3.5; c.stroke();
        c.setLineDash([3, 11]); c.lineDashOffset = -(now / 40) % 14; // chevron flow = direction of travel
        c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 2; c.stroke(); c.setLineDash([]);
      }
      // checkpoints: upcoming ones as small ticks, the next one as a pulsing gate; finish as a chequered flag
      if (g.checkpoints && g.checkpoints.length) {
        const P = {};
        for (let k = g.checkIdx || 0; k < g.checkpoints.length; k++) {
          const isFinish = k === g.checkpoints.length - 1, isNext = k === (g.checkIdx || 0);
          pointAtDist(g.route, g.checkpoints[k], P);
          const [x, y] = toS(P.x, P.z);
          const dist = Math.max(0, g.checkpoints[k] - (g.playerProgress || 0));
          if (!inside(x, y, 8)) { if (isNext || isFinish) offMap.push([x, y, isFinish ? '#ffffff' : '#ffd000', distTag(dist), isFinish ? 'finish' : 'gate']); continue; }
          if (isFinish) this.mmFlag(c, x, y);
          else if (isNext) {
            const pulse = 1 + 0.25 * Math.sin(now / 160);
            c.fillStyle = 'rgba(255,208,0,0.25)'; c.beginPath(); c.arc(x, y, 10 * pulse, 0, 7); c.fill();
            c.fillStyle = '#ffd000'; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 5.5, 0, 7); c.fill(); c.stroke();
          } else { c.fillStyle = 'rgba(255,208,0,0.6)'; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); }
        }
      }
    }
    // ---- hazards ----
    for (const s of g.spikes) {
      const [x, y] = toS(s.x, s.z); if (!inside(x, y)) continue;
      c.save(); c.translate(x, y); c.rotate(rot - (s.yaw || 0) + Math.PI / 2);
      c.fillStyle = '#ff9020'; c.fillRect(-6, -2, 12, 4); c.fillStyle = '#000';
      for (let i = -5; i <= 4; i += 3) c.fillRect(i, -2, 1, 4);
      c.restore();
    }
    for (const rb of g.roadblocks || []) {
      if (rb.x == null) continue;
      const [x, y] = toS(rb.x, rb.z); if (!inside(x, y)) continue;
      c.fillStyle = blink ? '#ff3040' : '#ffffff'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
      c.beginPath(); c.rect(x - 8, y - 3, 16, 6); c.fill(); c.stroke();
    }
    // ---- cars ----
    const arrow = (x, y, yaw, size, fill, stroke = '#000') => {
      c.save(); c.translate(x, y); c.rotate(rot - yaw + Math.PI);
      c.beginPath(); c.moveTo(0, -size * 1.25); c.lineTo(size, size); c.lineTo(0, size * 0.45); c.lineTo(-size, size); c.closePath();
      c.fillStyle = fill; c.fill(); c.strokeStyle = stroke; c.lineWidth = 1.4; c.stroke(); c.restore();
    };
    // traffic first (lowest layer), then cops, then racers
    c.fillStyle = 'rgba(210,215,225,0.55)';
    for (const o of g.cars) {
      if (o.role !== 'traffic') continue;
      const [x, y] = toS(o.pos.x, o.pos.z); if (!inside(x, y)) continue;
      c.save(); c.translate(x, y); c.rotate(rot - o.yaw); c.fillRect(-1.6, -2.6, 3.2, 5.2); c.restore();
    }
    const hunted = g.mode !== 'cop';
    for (const o of g.cars) {
      if (o === pl || o.role === 'traffic') continue;
      const [x, y] = toS(o.pos.x, o.pos.z);
      const dist = Math.hypot(o.pos.x - pl.pos.x, o.pos.z - pl.pos.z);
      if (o.role === 'cop') {
        const chasing = !o.wrecked && !o.ai?.patrol && hunted;
        const col = o.wrecked ? '#4a4a4a' : o.ai?.patrol ? '#9aa6ff' : blink ? '#ff2a3a' : '#2a62ff';
        if (!inside(x, y, 6)) { if (chasing && dist < 900) offMap.push([x, y, col, distTag(dist), 'cop']); continue; }
        // vision cone for cops that are hunting / patrolling — shows where not to drive
        if (!o.wrecked && hunted) {
          const vr = (o.ai?.patrol ? 120 : 90) * scale, a0 = rot - o.yaw - Math.PI / 2;
          const cg = c.createRadialGradient(x, y, 0, x, y, vr);
          cg.addColorStop(0, o.ai?.patrol ? 'rgba(150,160,255,0.28)' : 'rgba(255,60,80,0.3)'); cg.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = cg; c.beginPath(); c.moveTo(x, y); c.arc(x, y, vr, a0 - 0.55, a0 + 0.55); c.closePath(); c.fill();
        }
        arrow(x, y, o.yaw, 5, col, o.wrecked ? '#000' : '#fff');
      } else if (o.role === 'racer') {
        const col = o.wrecked ? '#4a4a4a' : '#' + o.model.paint.color.getHexString();
        if (!inside(x, y, 6)) { if (!o.wrecked && !o.out) offMap.push([x, y, col, distTag(dist), o.net?.human ? 'human' : 'racer']); continue; }
        arrow(x, y, o.yaw, 5, col, o.net?.human ? '#fff' : '#000');
        if (o.net?.human && o.name) { // other human players get a name tag
          c.font = '700 10px Rajdhani, sans-serif'; c.textAlign = 'center';
          c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeText(o.name, x, y - 10); c.fillStyle = '#fff'; c.fillText(o.name, x, y - 10);
        }
      }
    }
    c.restore(); // end clip

    // ---- rim: pursuit ring, compass, off-map pins ----
    const pursuit = g.pursuit && g.mode !== 'cop';
    c.lineWidth = 4;
    c.strokeStyle = pursuit ? (blink ? '#ff3040' : '#3060ff') : 'rgba(255,255,255,0.28)';
    c.beginPath(); c.arc(R, R, R - 3, 0, Math.PI * 2); c.stroke();
    if (pursuit && g.bust > 0) { // bust meter as an arc on the rim
      c.strokeStyle = '#ff3040'; c.lineWidth = 4;
      c.beginPath(); c.arc(R, R, R - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(g.bust, 0, 1)); c.stroke();
    }
    // compass: N/E/S/W letters around the rim (world -Z = north on the base map)
    c.font = '800 11px Rajdhani, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const [lbl, wx, wz] of [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]]) {
      const dx = wx * cosR - wz * sinR, dy = wx * sinR + wz * cosR;
      const x = R + dx * (R - 11), y = R + dy * (R - 11);
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill();
      c.fillStyle = lbl === 'N' ? '#ff5050' : 'rgba(255,255,255,0.7)'; c.fillText(lbl, x, y + 0.5);
    }
    // off-map pins: coloured wedge pointing outward + distance
    for (const [x0, y0, col, tag, kind] of offMap) {
      const [x, y] = pin(x0, y0, 24), a = Math.atan2(y - R, x - R); // inside the compass ring so N/E/S/W never overlap
      c.save(); c.translate(x, y); c.rotate(a);
      c.beginPath(); c.moveTo(8, 0); c.lineTo(-3, -6); c.lineTo(-3, 6); c.closePath();
      c.fillStyle = kind === 'finish' ? '#fff' : col; c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1.2; c.stroke();
      c.restore();
      const tx = R + (x - R) * 0.84, ty = R + (y - R) * 0.84;
      c.font = '700 10px Rajdhani, sans-serif'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.85)';
      c.strokeText(tag, tx, ty); c.fillStyle = kind === 'cop' ? '#ff8090' : '#fff'; c.fillText(tag, tx, ty);
    }
    // ---- player: heading arrow with soft glow, fixed below centre ----
    const px = R, py = R + ahead;
    c.fillStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.arc(px, py, 13, 0, 7); c.fill();
    c.fillStyle = pl.police ? '#4aa0ff' : '#ffb000'; c.shadowColor = c.fillStyle; c.shadowBlur = 8;
    c.beginPath(); c.moveTo(px, py - 11); c.lineTo(px + 7.5, py + 7); c.lineTo(px, py + 2.5); c.lineTo(px - 7.5, py + 7); c.closePath(); c.fill();
    c.shadowBlur = 0; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.stroke();
    // zoom indicator
    if (this.mapZoomShow > 0) {
      this.mapZoomShow -= dt;
      c.font = '800 11px Rajdhani, sans-serif'; c.fillStyle = 'rgba(255,255,255,0.85)'; c.textBaseline = 'alphabetic';
      c.fillText(['ZOOM AUTO', 'ZOOM NEAR', 'ZOOM FAR'][this.mapZoom || 0], R, S - 22);
    }
    c.textBaseline = 'alphabetic';
  }
  mmFlag(c, x, y) {
    c.fillStyle = '#000'; c.fillRect(x - 0.75, y - 12, 1.5, 13);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? '#000' : '#fff'; c.fillRect(x + 0.75 + i * 3, y - 12 + j * 3, 3, 3); }
    c.strokeStyle = '#000'; c.lineWidth = 0.8; c.strokeRect(x + 0.75, y - 12, 9, 6);
  }
  cycleMapZoom() { this.mapZoom = ((this.mapZoom || 0) + 1) % 3; this.mapZoomShow = 1.4; }

  updateMarkers(g, camera) {
    const list = [];
    const pl = g.player;
    for (const o of g.cars) {
      if (o === pl || o.wrecked) continue;
      if (o.role === 'racer' || (o.role === 'cop' && g.mode !== 'cop')) {
        const d = o.pos.distanceTo(pl.pos);
        if (d > 450 || d < 6) continue;
        list.push({ o, d });
      }
    }
    list.sort((a, b) => a.d - b.d);
    const W = window.innerWidth, H = window.innerHeight;
    let used = 0;
    for (const { o, d } of list.slice(0, 8)) {
      v.copy(o.pos); v.y += 2.4;
      v.project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      let el = this.markerPool[used];
      if (!el) { el = document.createElement('div'); el.className = 'mk'; el.innerHTML = '<div class="mk-n"></div><div class="mk-h"><i></i></div><div class="mk-t"></div>'; this.markers.appendChild(el); this.markerPool.push(el); }
      used++;
      el.style.display = 'block';
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px, ${(-v.y * 0.5 + 0.5) * H}px) translate(-50%, -100%)`;
      const cop = o.role === 'cop';
      el.className = 'mk ' + (cop ? 'cop' : 'racer');
      el.querySelector('.mk-n').textContent = cop && !(o.net && o.net.human) ? 'POLICE' : o.name; // a human cop shows their own name
      el.querySelector('.mk-t').textContent = `${Math.round(d)}m`;
      const hb = el.querySelector('.mk-h');
      const showH = (g.mode === 'cop' && !cop) || (cop && d < 120) || (!cop && d < 150);
      hb.style.display = showH ? 'block' : 'none';
      hb.firstChild.style.width = `${Math.round(o.health * 100)}%`;
      el.style.opacity = clamp(1.3 - d / 450, 0.35, 1);
    }
    for (let i = used; i < this.markerPool.length; i++) this.markerPool[i].style.display = 'none';
  }
}
