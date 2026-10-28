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
- Changes: rescaled to metres, nose turned to +Z, fused axle meshes split into four wheels (tyres decimated), interior simplified (hi) or removed (lo), textures resized (2048 / 512 px WebP), meshopt-compressed. Source (not committed, 62 MB): `assets/source/cybertruck_hi_src.glb`; pipeline: `node tools/prepcybertruck.mjs assets/source/cybertruck_hi_src.glb assets/models/cybertruck_hi.glb hi` (and `... _lo.glb lo`).
- **Tesla / Cybertruck are trademarks of Tesla, Inc.; verify trademark situation before any public/commercial release** (same caveat as the Ferrari).

## Generic passenger car pack (traffic + rival cars: sedan, wagon, hatchback, compact, coupe, minivan, SUV, offroad, pickup, sport)
- "Generic passenger car pack" by **Comrade1280** on Sketchfab: https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5
- Licensed under **Creative Commons Attribution 4.0 (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: split into one file per car, units converted, oriented/centred, wheels separated for spinning/steering, textures resized (512–1024 px WebP), meshopt-compressed. Source: `assets/source/carpack.glb`; pipeline: `tools/splitpack.mjs` then `tools/optimize.mjs`.

## Environment assets (Poly Haven, CC0 / public domain, no attribution required; listed for reference)
- pine_tree_01 (bark + needle textures), jacaranda_tree (bark + leaf textures), boulder_01, rock_09, street_lamp_01 (Josh Dean), metal_trash_can, concrete_road_barrier: https://polyhaven.com
- Changes: scan meshes decimated to ~0.3-2k triangles, textures resized to 128-512 px WebP; tree crowns are procedurally generated alpha-card foliage using the original textures. Sources are not committed (assets/env_src, 1.3 GB); fetch with `node tools/phdl.mjs <id>` and rebuild with `tools/envopt.mjs` / `tools/envcards.mjs`.
