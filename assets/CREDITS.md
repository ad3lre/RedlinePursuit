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

## Generic passenger car pack (traffic + rival cars: sedan, wagon, hatchback, compact, coupe, minivan, SUV, offroad, pickup, sport)
- "Generic passenger car pack" by **Comrade1280** on Sketchfab: https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5
- Licensed under **Creative Commons Attribution 4.0 (CC BY 4.0)**: https://creativecommons.org/licenses/by/4.0/ . Commercial use allowed with credit.
- Changes: split into one file per car, units converted, oriented/centred, wheels separated for spinning/steering, textures resized (512–1024 px WebP), meshopt-compressed. Source: `assets/source/carpack.glb`; pipeline: `tools/splitpack.mjs` then `tools/optimize.mjs`.
