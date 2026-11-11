# Asset credits

## Ferrari 458 Italia (`assets/source/ferrari.glb`, optimised into `assets/models/ferrari_hi.glb` / `ferrari_lo.glb`)
- Model by **vicent091036** (Sketchfab: https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6), as distributed in the three.js examples (`examples/models/gltf/ferrari.glb`, three.js r160).
- **Verify the Sketchfab license and trademark situation (Ferrari badging) before any public/commercial release.**
- Regenerate with: `node tools/optimize.mjs assets/source/ferrari.glb assets/models/ferrari_hi.glb 1` and
  `node tools/optimize.mjs assets/source/ferrari.glb assets/models/ferrari_lo.glb 1 'interior|carpet|leather|steering|carbon|wipers|^brakes?(_\d+)?$|^grills'`

## Car Concept (`assets/source/carconcept.glb`, optimised into `assets/models/concept_hi.glb` / `concept_lo.glb`)
- © 2024 Khronos Group / Darmstadt Graphics Group GmbH. Model and textures by **Eric Chadwick**.
- Licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/
- Source: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept
- Changes: geometry untouched except removed engine/wipers (hi) and interior/engine/pedals/seats/plate (lo); textures resized to 1024 px WebP; meshopt-compressed; paint materials replaced by the game's paint shader so colours/liveries/damage work.
- Regenerate: `node tools/optimize.mjs assets/source/carconcept.glb assets/models/concept_hi.glb 1 'Engine|WindshieldWipers'` and
  `node tools/optimize.mjs assets/source/carconcept.glb assets/models/concept_lo.glb 1 'Interior|Engine|Wipers|HoodUnder|Pedal|Seats|Plate'`

## Tesla Cybertruck (`assets/models/cybertruck_hi.glb` / `cybertruck_lo.glb`)
- "Tesla Cybertruck" by **TAIGA-ZOE** on Sketchfab: https://sketchfab.com/3d-models/tesla-cybertruck-8950fc178e254c9198b2a8555ef1590a
- Licensed under **Creative Commons Attribution 4.0 (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: rescaled to metres, nose turned to +Z, fused axle meshes split into four wheels (tyres decimated with sloppy simplify), body shell quality-simplified with LockBorder (sloppy shreds door UVs), interior removed, textures resized (1024 / 512 px WebP), meshopt-compressed. Source (not committed, 62 MB): `assets/source/cybertruck_hi_src.glb`; pipeline: `node tools/prepcybertruck.mjs assets/source/cybertruck_hi_src.glb assets/models/cybertruck_hi.glb hi` (and `... _lo.glb lo`).
- **Tesla / Cybertruck are trademarks of Tesla, Inc.; verify trademark situation before any public/commercial release** (same caveat as the Ferrari).

## 2024 Manthey Racing Porsche 911 GT3 RS (`assets/models/gt3rs_hi.glb` / `gt3rs_lo.glb`)
- "2024 Manthey Racing Porsche 911 GT3 RS (REVAMP)" by **HYPR:IMPS 3D** on Sketchfab: https://sketchfab.com/3d-models/2024-manthey-racing-porsche-911-gt3-rs-revamp-09ccead93fb34944bde812d4b4684eff
- Licensed under **Creative Commons Attribution 4.0 (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: world transforms baked, wheels regrouped into four spinning/steering nodes, geometry decimated (730k -> ~190k hi / ~81k lo triangles), duplicate materials merged, textures resized (1024 / 512 px WebP), meshopt-compressed. Source (not committed): `assets/source/gt3rs_src.glb`; pipeline: `node tools/prepgt3.mjs assets/source/gt3rs_src.glb assets/models/gt3rs_hi.glb hi` (and `... _lo.glb lo`).
- **Porsche, 911 and GT3 RS are trademarks of Dr. Ing. h.c. F. Porsche AG; verify trademark situation before any public/commercial release** (same caveat as the Ferrari and the Cybertruck).

## Mercedes Vito Utility Car (`assets/models/vito_hi.glb` / `vito_lo.glb`)
- "Mercedes Vito Utility Car" by **solid3DDD** on Sketchfab: https://sketchfab.com/3d-models/mercedes-vito-utility-car-fe704a2aa87a4921990d4973a6eef36d
- Licensed under **Creative Commons Attribution (CC BY)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: scaled to 5.14 m (Vito Long), nose kept +Z, wheels regrouped into four spinning/steering nodes (source L/R names were mirrored), Body/Plastic quality-simplified with LockBorder (sloppy shreds rear quarter), cabin dropped, textures resized (1024 / 512 px WebP), meshopt-compressed. Source (not committed): `assets/source/vito_src.glb`; pipeline: `node tools/prepvito.mjs assets/source/vito_src.glb assets/models/vito_hi.glb hi` (and `... _lo.glb lo`).
- **Mercedes-Benz / Vito are trademarks of Mercedes-Benz Group AG; verify trademark situation before any public/commercial release** (same caveat as the Ferrari / Cybertruck / GT3 RS).

## Mini Cooper S (`assets/models/mini_hi.glb` / `mini_lo.glb`)
- "Mini Cooper S" by **シRuletăシ** (@romanian_guy_0069) on Sketchfab: https://sketchfab.com/3d-models/mini-cooper-s-7d407f7a1db44fefb206d17e12680576
- Licensed under **Creative Commons Attribution (CC BY)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: scaled to 3.85 m, nose kept +Z, SketchUp wheel groups regrouped into four spinning nodes, geometry joined/decimated, textures resized (1024 / 512 px WebP), meshopt-compressed. Source (not committed): `assets/source/mini_src.glb`; pipeline: `node tools/prepmini.mjs assets/source/mini_src.glb assets/models/mini_hi.glb hi` (and `... _lo.glb lo`).
- **MINI / Cooper are trademarks of BMW AG; verify trademark situation before any public/commercial release** (same caveat as the other branded cars).

## Generic passenger car pack (traffic + rival cars: sedan, wagon, hatchback, compact, coupe, minivan, SUV, offroad, pickup, sport)
- "Generic passenger car pack" by **Comrade1280** on Sketchfab: https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5
- Licensed under **Creative Commons Attribution 4.0 (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: split into one file per car, units converted, oriented/centred, wheels separated for spinning/steering, textures resized (512–1024 px WebP), meshopt-compressed. Source: `assets/source/carpack.glb`; pipeline: `tools/splitpack.mjs` then `tools/optimize.mjs`.

## Toyota Corolla 2020 (`assets/models/corolla_hi.glb` / `corolla_lo.glb`)
- "Toyota Corolla 2020" by **ItsDiyor** on Sketchfab: https://sketchfab.com/3d-models/toyota-corolla-2020-6d7d34ee42734d1ab28a6b1f1c5fc4fc
- Licensed under **Creative Commons Attribution (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: scaled to 4.63 m, tyres/rims/brakes split out of the fused body meshes into four wheel nodes, geometry simplified (hi ~150k / lo ~75k triangles), textures resized (1024 / 512 px WebP), meshopt-compressed; body paint replaced by the game's paint shader. Source (not committed): `assets/source/corolla_src.glb`; pipeline: `node tools/prepcorolla.mjs assets/source/corolla_src.glb assets/models/corolla_hi.glb hi` (and `... _lo.glb lo`).
- **Toyota and Corolla are trademarks of Toyota Motor Corporation; verify trademark situation before any public/commercial release** (same caveat as the Ferrari, Cybertruck and Porsche).

## Engine sound recordings (`assets/audio/engine/*.wav`, built by `tools/prepEngineSamples.py`)
Short steady-RPM loops cut from these Wikimedia Commons recordings, all licensed **CC BY 3.0** (https://creativecommons.org/licenses/by/3.0/). Changes: mono 22.05 kHz, 0.5 s excerpts, loudness-normalised, crossfaded into seamless loops; pitch-shifted by RPM at runtime.
- Viper (V10): "Dodge Viper GTS - engine and exhaust sound" by **Erwin Lindsen** — https://commons.wikimedia.org/wiki/File:Dodge_Viper_GTS_-_engine_and_exhaust_sound_(YouTube_tfZiZqQQBOE).opus and https://commons.wikimedia.org/wiki/File:Dodge_Viper_GTS_-_engine_and_exhaust_sound_(YouTube_Kcy6fjTiun8).opus
- Kaiser (turbo I6): "BMW M2 Competition with Remus exhaust - engine and exhaust sound" by **PointShiftDrive** — https://commons.wikimedia.org/wiki/File:BMW_M2_Competition_with_Remus_exhaust_-_engine_and_exhaust_sound_(YouTube_51_uOnGip4w).opus
- Bruiser (V8): "Ford Mustang GT (S550) - engine and exhaust sound" by **Cestni dirkač** — https://commons.wikimedia.org/wiki/File:Ford_Mustang_GT_(S550)_-_engine_and_exhaust_sound_(YouTube_2ceiDjGgpI8).opus
- GT3 RS (flat-6): "Porsche 911 GT3 RS (991) - engine and exhaust sound" by **Automotion Media** — https://commons.wikimedia.org/wiki/File:Porsche_911_GT3_RS_(991)_-_engine_and_exhaust_sound_(YouTube_otznJ2rBoks).opus
- Mini (turbo I4, stand-in: no Mini recording available): "Volkswagen Golf GTI - engine and exhaust sound" by **9000 Giri • Elaborazioni Auto Sportive** — https://commons.wikimedia.org/wiki/File:Volkswagen_Golf_GTI_-_engine_and_exhaust_sound_(YouTube_NrA1GgbjFRg).opus
- Vito (diesel I4, stand-in: no Vito recording available): "Volkswagen Passat B5 1.9 TDI (remapped, 185 hp) - engine and exhaust sound" by **tomeko0o3769** — https://commons.wikimedia.org/wiki/File:Volkswagen_Passat_B5_1.9_TDI_(remapped,_185_hp)_-_engine_and_exhaust_sound_(YouTube_12P7SQ_48k4).opus

## Environment assets (Poly Haven, CC0 / public domain, no attribution required; listed for reference)
- pine_tree_01 (bark + needle textures), jacaranda_tree (bark + leaf textures), boulder_01, rock_09, street_lamp_01 (Josh Dean), metal_trash_can, concrete_road_barrier: https://polyhaven.com
- Changes: scan meshes decimated to ~0.3-2k triangles, textures resized to 128-512 px WebP; tree crowns are procedurally generated alpha-card foliage using the original textures. Sources are not committed (assets/env_src, 1.3 GB); fetch with `node tools/phdl.mjs <id>` and rebuild with `tools/envopt.mjs` / `tools/envcards.mjs`.

## Mercedes-Benz G 63 AMG (`assets/models/gwagon_hi.glb` / `gwagon_lo.glb`)
- "Mersedes-Benz G63 AMG" by **Black Snow** (@BlackSnow02) on Sketchfab: https://sketchfab.com/3d-models/mersedes-benz-g63-amg-e5e2a1d2238048a1a494b3df983c16bb
- Licensed under **Creative Commons Attribution 4.0 (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: scaled to 4.82 m, nose kept +Z, tyre + AMG rim groups regrouped into four spinning wheels, cabin/dash/seats dropped, geometry decimated (hi ~174k / lo ~141k triangles), textures resized (1024 / 512 px WebP), meshopt-compressed. Source (not committed): `assets/source/gwagon_src.glb`; pipeline: `node tools/prepgwagon.mjs assets/source/gwagon_src.glb assets/models/gwagon_hi.glb hi` (and `... _lo.glb lo`).
- **Mercedes-Benz / G-Class / AMG are trademarks of Mercedes-Benz Group AG; verify trademark situation before any public/commercial release**.

## 2017 McLaren 720S (`assets/models/mclaren_hi.glb` / `mclaren_lo.glb`)
- "2017 McLaren 720S" by **Ddiaz Design** (@ddiaz-design) on Sketchfab: https://sketchfab.com/3d-models/2017-mclaren-720s-738727995dd7489086975659fe852637
- Licensed under **Creative Commons Attribution 4.0 (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: scaled to 4.54 m, nose kept +Z, four wheel meshes regrouped into spinning nodes, engine bay removed, interior simplified (hi) / dropped (lo), geometry decimated (hi ~101k / lo ~77k triangles), textures resized (1024 / 512 px WebP), meshopt-compressed. Source (not committed): `assets/source/mclaren_src.glb`; pipeline: `node tools/prepmclaren.mjs assets/source/mclaren_src.glb assets/models/mclaren_hi.glb hi` (and `... _lo.glb lo`).
- **McLaren / 720S are trademarks of McLaren Automotive Ltd.; verify trademark situation before any public/commercial release**.

## Tesla Model S P100D (`assets/models/model_s_hi.glb` / `model_s_lo.glb`)
- "Tesla Model P100D" by **Ameer Studio** (@uchiha.321abc) on Sketchfab: https://sketchfab.com/3d-models/tesla-model-p100d-26ef15adc5ee4d8bbcb4a4f95ca49168
- Licensed under **Creative Commons Attribution 4.0 (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: scaled to 4.97 m, nose turned from -Z to +Z, fused L+R axle meshes split into four spinning wheels, steering wheel dropped, geometry decimated (hi ~180k / lo ~92k triangles), textures resized (1024 / 512 px WebP), meshopt-compressed. Source (not committed): `assets/source/model_s_src.glb`; pipeline: `node tools/prepmodels.mjs assets/source/model_s_src.glb assets/models/model_s_hi.glb hi` (and `... _lo.glb lo`).
- **Tesla / Model S are trademarks of Tesla, Inc.; verify trademark situation before any public/commercial release** (same caveat as the Cybertruck).

## 2023 Koenigsegg Jesko Attack (`assets/models/jesko_hi.glb`, `jesko_lo.glb`)
"2023 Koenigsegg Jesko Attack" by **ddiaz-design** on Sketchfab: https://sketchfab.com/3d-models/2023-koenigsegg-jesko-attack-18240b21b4d747c7b7e86a404c3a195a
Licensed **CC BY-NC-SA 4.0** (https://creativecommons.org/licenses/by-nc-sa/4.0/): attribution required, **non-commercial use only**, derivatives must be shared under the same license.
Changes: rescaled to 4.61 m, wheels regrouped into four spinning nodes, engine bay removed, meshes decimated (hi ~120k / lo ~59k triangles), textures resized to 1024 / 512 px WebP, meshopt-compressed (`tools/prepjesko.mjs`). Source is not committed.

## M1A2 Abrams Main Battle Tank (`assets/models/tank.glb`) — BLACKOUT armor
- "General Dynamics M1A2 Abrams Main Battle Tank" by **Muhamad Mirza Arrafi** (@MirzaArrafiERV_45) on Sketchfab: https://sketchfab.com/3d-models/general-dynamics-m1a2-abrams-main-battle-tank-10a16c96ca8b4ebc855915f5d5202046
- Licensed under **Creative Commons Attribution 4.0 (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: Sketchfab axis baked, scaled to 7.9 m length, nose +Z, ground at y=0, textures 1024 px WebP, meshopt-compressed. Pipeline: `node tools/prepmilitary.mjs tank assets/source/tank_src.glb assets/models/tank.glb`.

## Honda Civic Type R EK9 (`assets/models/civic_hi.glb` / `civic_lo.glb`)
- "Honda Civic Type R -98 (Free Asset)" by **tiedtke** on Sketchfab: https://sketchfab.com/3d-models/honda-civic-type-r-98-free-asset-b9604dd71c6546ec842702682019492a
- Licensed under **Creative Commons Attribution 4.0 (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: scaled to 4.00 m, nose kept +Z, Wheel_* groups regrouped into four spinning nodes (source L/R mirrored), geometry decimated (hi ~115k / lo ~67k triangles), textures resized (1024 / 512 px WebP), meshopt-compressed. Source (not committed): `assets/source/civic_src.glb`; pipeline: `node tools/prepcivic.mjs assets/source/civic_src.glb assets/models/civic_hi.glb hi` (and `... _lo.glb lo`).
- **Honda / Civic / Type R are trademarks of Honda Motor Co., Ltd.; verify trademark situation before any public/commercial release**.

## UH-60 Blackhawk (`assets/models/heli.glb`) — BLACKOUT air support
- "UH-60 Blackhawk military helicopter" by **Larcenie Grant** (@GrantLarcenie) on Sketchfab: https://sketchfab.com/3d-models/uh-60-blackhawk-military-helicopter-3f10f2fa2ca040a898a49e1b46008470
- Licensed under **Creative Commons Attribution 4.0 (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit (author note: credit k26_k29).
- Changes: Sketchfab axis baked, scaled to 15.3 m length, nose +Z, ground at y=0, geometry simplified (~96k → ~43k tris), textures 512 px WebP, meshopt-compressed. Pipeline: `node tools/prepmilitary.mjs heli assets/source/heli_src.glb assets/models/heli.glb`.
