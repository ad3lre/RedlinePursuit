# Asset credits

## Ferrari 458 Italia (`assets/source/ferrari.glb`, optimised into `assets/models/ferrari_hi.glb` / `ferrari_lo.glb`)
- Model by **vicent091036** (Sketchfab: https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6), as distributed in the three.js examples (`examples/models/gltf/ferrari.glb`, three.js r160).
- **Verify the Sketchfab license and trademark situation (Ferrari badging) before any public/commercial release.**
- Regenerate with: `node tools/optimize.mjs assets/source/ferrari.glb assets/models/ferrari_hi.glb 1` and
  `node tools/optimize.mjs assets/source/ferrari.glb assets/models/ferrari_lo.glb 1 'interior|carpet|leather|steering|carbon|wipers|^brakes?(_\d+)?$|^grills'`
