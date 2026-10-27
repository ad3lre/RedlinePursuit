# 🏎️ REDLINE PURSUIT

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-r160-black.svg?logo=three.js)](https://threejs.org/)

**A thrilling 3D open-world highway police-chase racing game that runs right in your browser.**
No server, no install. Play in Chrome / Edge / Safari on PC or Mac.

(English translation of the original Japanese README and UI. Original game by [haruka_apps](https://github.com/harukaappscreate/RedlinePursuit).)

---

## 🎮 Overview

**REDLINE PURSUIT** is a 3D street-racing and police-chase game rendered with Three.js. Drive across a huge 4 km × 4 km open-world map: break through police blockades with drifts and nitro as a racer, or take the wheel of a patrol car and hunt down illegal racers with EMP and spike strips.

Audio is generated procedurally with the Web Audio API, so there are no large sound files to wait for.

---

## 🔥 Game modes

### 1. 🏁 HOT PURSUIT RACE
Race 3 rival street racers around an ~8.7 km highway circuit while the police close in (heat levels 1–5: backup, roadblocks, spike strips). Shake them off and finish 1st.

### 2. 🚨 INTERCEPTOR
Play as the police and bust 4 illegal racers. Use **ramming**, **spike strips (`Q` / `LB`)** and **EMP lock-on (hold `E` / `RB`)** to take them down.

### 3. 🗺️ FREE RUN
Roam the 4 km open-world map freely. If a patrol spots you, the chase begins. Break line of sight and stay hidden for 14 seconds to escape and earn a bounty.

---

## 🕹️ Controls

Keyboard and gamepad (Xbox / PlayStation / generic) are fully supported.

| Key | Action |
|:---|:---|
| <kbd>W</kbd> / <kbd>↑</kbd> | Accelerate |
| <kbd>S</kbd> / <kbd>↓</kbd> | Brake / reverse |
| <kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd> | Steer |
| <kbd>SPACE</kbd> | Handbrake (start a drift) |
| <kbd>SHIFT</kbd> / <kbd>N</kbd> | Nitro (charged by drifting, near misses, etc.) |
| <kbd>C</kbd> | Camera: 3rd person near → far → cockpit → hood |
| <kbd>V</kbd> | Look behind (hold) |
| Mouse | Look around (drag or mouse lock; configurable) |
| <kbd>Q</kbd> | [Police] Deploy spike strip behind you |
| <kbd>E</kbd> (hold) | [Police] EMP lock-on to the target ahead |
| <kbd>R</kbd> | Respawn on track |
| <kbd>M</kbd> | Music on/off |
| <kbd>ESC</kbd> / <kbd>P</kbd> | Pause |

### Mouse look
Choose in **Settings → Mouse look** (default: Drag).
- **Drag**: hold a mouse button and move to orbit the camera around the car.
- **Mouse lock**: click the screen to capture the cursor and look around freely. <kbd>ESC</kbd> releases it (and pauses).
- **OFF**: the mouse doesn't move the camera.

In first-person views (cockpit / hood) you can turn your head left/right and up/down. Sensitivity, Y-inversion and auto-recenter are configurable.

### Gamepad
RT accelerate · LT brake · left stick steer · A nitro · X/B handbrake (drift) · Y camera · LB spike strip · RB EMP · D-pad ↓ look behind · START pause · BACK reset.
Menus: D-pad / left stick to move, **A** confirm, **B** back.

> [!NOTE]
> Due to browser autoplay policy, audio may not start with gamepad input alone. Click the screen once or press any key.

---

## ✨ Features

- **3D physics & handling**: drifting, slipstream, counter-steer and weighty collisions.
- **Heat levels & dynamic AI**: police box you in, set roadblocks and lay spike strips.
- **4 camera views**: from cockpit to wide third person.
- **Rich HUD**: speedometer, tachometer, minimap, heat indicator, takedown effects.
- **Fully standalone**: world, effects and audio are generated from code; only the car models are glTF files, embedded in the bundle.

---

## 🎯 Comfort settings

Tune in **SETTINGS** to reduce motion sickness:
- **Camera roll stabilisation**: the camera always keeps the horizon level.
- **Camera shake**: OFF by default.
- **Field of view** slider.
- **Speed effects** (blur / dynamic FOV) toggle.
- **Center dot** to give your eyes a fixed point.
- **Takedown slow-motion** toggle.

---

## 🛠️ Build

Open `index.html` locally to play, or rebuild from `src/` (Three.js r160 + esbuild):

```bash
npm install
npm run build      # node build.mjs -> game.js (glTF models embedded)
./deploy.sh        # build and publish to the web folder served at /chase/
```

## 🚗 Realistic car assets (work in progress)
Supercar-class cars (`super` = Ferrari 458, `gt` = Khronos Car Concept, `muscle` = Ferrari 458 for now) use real glTF models instead of procedural boxes (`src/carAssets.js`, `src/carModel.js`). Paint shader, liveries, damage, lights and sirens are unchanged. Sedan / SUV / truck are still procedural.
Credits: `assets/CREDITS.md`. Tools: `tools/optimize.mjs`, `tools/inspect.mjs`, `tools/shot.mjs` (headless screenshots).

---

## 👤 Author & license

- **Developer**: haruka_apps
- **Repository**: [RedlinePursuit](https://github.com/harukaappscreate/RedlinePursuit)
- **License**: [MIT License](LICENSE)
