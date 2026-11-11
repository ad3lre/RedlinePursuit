// ===== Real (photoscanned/modelled) glTF car assets =====
// GLBs are embedded into the bundle by esbuild (loader .glb=binary) so the game still runs from file:// with zero config.
// Source models + licenses: see assets/CREDITS.md. Optimised with tools/optimize.mjs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import ferrariHi from '../assets/models/ferrari_hi.glb';
import ferrariLo from '../assets/models/ferrari_lo.glb';
import conceptHi from '../assets/models/concept_hi.glb';
import conceptLo from '../assets/models/concept_lo.glb';

import cyberHi from '../assets/models/cybertruck_hi.glb';
import cyberLo from '../assets/models/cybertruck_lo.glb';
import gt3Hi from '../assets/models/gt3rs_hi.glb';
import gt3Lo from '../assets/models/gt3rs_lo.glb';
import vitoHi from '../assets/models/vito_hi.glb';
import vitoLo from '../assets/models/vito_lo.glb';
import jeskoHi from '../assets/models/jesko_hi.glb';
import jeskoLo from '../assets/models/jesko_lo.glb';
import miniHi from '../assets/models/mini_hi.glb';
import miniLo from '../assets/models/mini_lo.glb';
import corollaHi from '../assets/models/corolla_hi.glb';
import corollaLo from '../assets/models/corolla_lo.glb';
import modelSHi from '../assets/models/model_s_hi.glb';
import modelSLo from '../assets/models/model_s_lo.glb';
import mclarenHi from '../assets/models/mclaren_hi.glb';
import mclarenLo from '../assets/models/mclaren_lo.glb';
import gwagonHi from '../assets/models/gwagon_hi.glb';
import gwagonLo from '../assets/models/gwagon_lo.glb';
import civicHi from '../assets/models/civic_hi.glb';
import civicLo from '../assets/models/civic_lo.glb';
import pack_compact from '../assets/models/pack_compact.glb';
import pack_coupe from '../assets/models/pack_coupe.glb';
import pack_hatchback from '../assets/models/pack_hatchback.glb';
import pack_minivan from '../assets/models/pack_minivan.glb';
import pack_offroad from '../assets/models/pack_offroad.glb';
import pack_pickup from '../assets/models/pack_pickup.glb';
import pack_sedan from '../assets/models/pack_sedan.glb';
import pack_sport from '../assets/models/pack_sport.glb';
import pack_suv from '../assets/models/pack_suv.glb';
import pack_wagon from '../assets/models/pack_wagon.glb';

const SOURCES = { 'gt3rs:hi': gt3Hi, 'gt3rs:lo': gt3Lo, 'cybertruck:hi': cyberHi, 'cybertruck:lo': cyberLo, 'vito:hi': vitoHi, 'vito:lo': vitoLo, 'jesko:hi': jeskoHi, 'jesko:lo': jeskoLo, 'mini:hi': miniHi, 'mini:lo': miniLo, 'corolla:hi': corollaHi, 'corolla:lo': corollaLo, 'model_s:hi': modelSHi, 'model_s:lo': modelSLo, 'mclaren:hi': mclarenHi, 'mclaren:lo': mclarenLo, 'gwagon:hi': gwagonHi, 'gwagon:lo': gwagonLo, 'civic:hi': civicHi, 'civic:lo': civicLo, 'ferrari:hi': ferrariHi, 'ferrari:lo': ferrariLo, 'concept:hi': conceptHi, 'concept:lo': conceptLo, 'compact:hi': pack_compact, 'coupe:hi': pack_coupe, 'hatchback:hi': pack_hatchback, 'minivan:hi': pack_minivan, 'offroad:hi': pack_offroad, 'pickup:hi': pack_pickup, 'sedan:hi': pack_sedan, 'sport:hi': pack_sport, 'suv:hi': pack_suv, 'wagon:hi': pack_wagon };
// Per-model node/material mapping. rotY: radians to turn the model so its nose points +Z (game forward).
// "Generic passenger car pack" (CC BY, Comrade1280): pre-split + oriented by tools/splitpack.mjs; keeps its own baked textures (no repaint).
const PACK_DEF = { rotY: 0, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, steer: null, paintMat: null, glassMat: /^Glass/, tailMat: null, headMat: null, keepTextures: true };
export const MODEL_DEFS = {
  ferrari: { rotY: Math.PI, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, tireMesh: /tire/i, steer: /^steering_wheel$/, paintMat: /^Body_Color$/, glassMat: /^Glass_Gray$/, tailMat: /^Taillight_Glass$/, tailPaintCombine: false },
  // Tesla Cybertruck (TAIGA-ZOE, CC BY 4.0), prepared by tools/prepcybertruck.mjs: metres, nose +Z, wheels split. Keeps its own steel textures.
  cybertruck: { rotY: 0, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, steer: null, paintMat: null, glassMat: /^Glass/, tailMat: /^Light_R$/, headMat: /^Light_W$/, keepTextures: true },
  // 2024 Manthey Racing Porsche 911 GT3 RS (HYPR:IMPS 3D, CC BY 4.0), prepared by tools/prepgt3.mjs: metres, nose -Z in the file, wheels regrouped. Keeps its own paint textures.
  gt3rs: { rotY: Math.PI, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, tireMesh: /tire/i, steer: null, paintMat: null, glassMat: /^bw_lightglass/, tailMat: /^lightrear_pattern|^red\.004$/, headMat: /^lightfront_lighta/, keepTextures: true },
  // Mercedes Vito Utility Car (solid3DDD, CC BY), prepared by tools/prepvito.mjs: metres, nose +Z, wheels regrouped. Keeps its own textures.
  vito: { rotY: 0, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, tireMesh: /tire/i, steer: /^steering_wheel$/, paintMat: null, glassMat: /^glass/i, tailMat: /^tailights$/, headMat: /^Fake_tails$/, keepTextures: true },
  // 2023 Koenigsegg Jesko Attack (ddiaz-design, CC BY-NC-SA 4.0), prepared by tools/prepjesko.mjs: metres, nose +Z, wheels regrouped. Keeps its own textures.
  jesko: { rotY: 0, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, tireMesh: /tyre|tire/i, steer: null, paintMat: null, glassMat: /Glass1/i, tailMat: /^AttackMI_Light1$/, headMat: /^AttackMI_Glass_Light1$/, keepTextures: true },
  // Mini Cooper S (シRuletăシ, CC BY), prepared by tools/prepmini.mjs: metres, nose +Z, wheels regrouped. Keeps its own textures.
  mini: { rotY: 0, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, tireMesh: /llanta|COOPER__rin/i, steer: null, paintMat: null, glassMat: /^vidrios$/i, tailMat: /^COOPER_luz2$/, headMat: /^COOPER_luz$/, keepTextures: true },
  // Toyota Corolla 2020 (ItsDiyor, CC BY), prepared by tools/prepcorolla.mjs: metres, nose +Z, wheels split out of the
  // fused source meshes. Body uses a real paint material -> game paint shader (colours / damage); rest keeps textures.
  // No dedicated lamp mats — hand head/tailL on GLB_MODELS.corolla.
  corolla: { rotY: 0, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, tireMesh: null, steer: null, paintMat: /^Paint_Color$/, glassMat: /^Index_0_2$/, tailMat: null, headMat: null, keepTextures: true },
  // Tesla Model S P100D — hand mounts (asymmetric right_front_light only); keep chassis.6 for red tails.
  model_s: { rotY: 0, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, tireMesh: /unnamed\.2/i, steer: null, paintMat: /^primary$/, glassMat: /^glass/i, tailMat: /^chassis\.6$/, headMat: null, keepTextures: true },
  // 2017 McLaren 720S — shared SLight mat spans both ends; hand head/tailL so headlights aren't remapped to red tails.
  mclaren: { rotY: 0, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, tireMesh: /3DWheel|Wheel/i, steer: null, paintMat: /^SPaint_Material1$/, glassMat: /Window|Glass/i, tailMat: null, headMat: null, keepTextures: true },
  // Mercedes-Benz G 63 AMG — main beam LEDs (not fog/DRL); taillight mat for rears.
  gwagon: { rotY: 0, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, tireMesh: /gt_34|black|PAINT_2/i, steer: null, paintMat: /^bodypaint$/, glassMat: /G-class_glass/i, tailMat: /^G-class_taillight_1$/, headMat: /^G-class_lightled$|^nlightsf20$/, keepTextures: true },
  // Honda Civic Type R EK9 (tiedtke, CC BY) — Body_MAT paint, Glass mats, no dedicated lamps (hand mounts on GLB_MODELS.civic).
  civic: { rotY: 0, wheelNode: /^wheel_(fl|fr|rl|rr)$/, frontWheel: /^wheel_f/, tireMesh: /Tire/i, steer: null, paintMat: /^Body_MAT$/, glassMat: /^Glass/, tailMat: null, headMat: null, keepTextures: true },
  compact: PACK_DEF,
  coupe: PACK_DEF,
  hatchback: PACK_DEF,
  minivan: PACK_DEF,
  offroad: PACK_DEF,
  pickup: PACK_DEF,
  sedan: PACK_DEF,
  sport: PACK_DEF,
  suv: PACK_DEF,
  wagon: PACK_DEF,
  concept: { rotY: 0, wheelNode: /^Wheel(Front|Rear)(L|R)$/, frontWheel: /^WheelFront/, tireMesh: null, steer: /^InteriorSteeringCylinder$/, paintMat: /^Paint [12] /, glassMat: /^Glass$/, tailMat: /^Brakelight$/, headMat: /^Headlight$/ },
};
const templates = {};

const parse = (buf) => new Promise((res, rej) => {
  const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  l.parse(ab, '', res, rej);
});

const MAPS = ['map', 'aoMap', 'lightMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'transmissionMap', 'alphaMap', 'bumpMap'];
const usesUV1 = (m) => MAPS.some((k) => m[k] && m[k].channel === 1);
// Authored car GLBs often mark grilles / plastics / badges as BLEND or transmission=1 (or alpha=0),
// which makes body parts invisible or see-through in-engine. Normalise before we merge/bucket.
const GLASS_NAME = /glass|vidrios|lightglass|windshield|windscreen|transpar|(?:^|_)windows?(?:_|$)/i;
const LIGHT_NAME = /light|lamp|tail|head|optik|lens|luz|glow|emis|projector/i;
const CUTOUT_NAME = /grill|grille|mesh|alpha|logo|badge|decal|label|stitch|carbon|disc|disk|tire|tyre|rim|net|cage|vent/i;
function isGlassMat(mat) {
  const n = mat?.name || '';
  if (!GLASS_NAME.test(n) && !((mat.transmission || 0) > 0.2 && /window|glass|vidrios/i.test(n))) return false;
  // window_plastic / window_trim / rubber seals are bodywork, not windshields
  if (/plastic|trim|frame|rubber|seal|black/i.test(n) && !/glass|vidrios|lightglass/i.test(n)) return false;
  return true;
}
function sanitizeMat(mat) {
  if (!mat || mat.userData?.rpSanitized) return mat;
  mat.userData = mat.userData || {};
  mat.userData.rpSanitized = true;
  const n = mat.name || '';
  const isGlass = isGlassMat(mat);
  const isLight = LIGHT_NAME.test(n);
  // Zero-alpha materials discard every fragment (Mini taillight glass, GT3 PLASTIC_EXT, …)
  if ((mat.opacity ?? 1) < 0.05 && !isGlass) {
    mat.opacity = 1;
    if (!mat.alphaMap && !(mat.map && mat.alphaTest > 0)) { mat.transparent = false; mat.alphaTest = 0; }
  }
  // Transmission on non-glass (McLaren grille, etc.) turns solid panels into windows
  if ((mat.transmission || 0) > 0 && !isGlass) {
    mat.transmission = 0;
    if (mat.transmissionMap) { mat.transmissionMap = null; }
    mat.transparent = false;
    mat.opacity = 1;
    mat.alphaTest = 0;
    mat.depthWrite = true;
    // Grille sheets authored as glass-transmission → opaque dark metal, keep depth
    if (/grill|grille|vent|mesh/i.test(n) && mat.color) {
      mat.color.setRGB(0.08, 0.08, 0.09);
      if (mat.metalness != null) mat.metalness = Math.max(mat.metalness, 0.55);
      if (mat.roughness != null) mat.roughness = Math.min(Math.max(mat.roughness, 0.35), 0.7);
    }
  }
  // Prefer alpha-tested cutouts over BLEND for mesh/grille/logo (opaque pass + correct depth).
  // Exception: oversized door-spanning logo/badge sheets with alphaTest punch rectangular holes in bodywork —
  // treat those as opaque decals (drop alpha discard) rather than cutouts.
  if (mat.transparent && !isGlass && !isLight) {
    if (mat.alphaMap || CUTOUT_NAME.test(n) || mat.alphaTest > 0) {
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthWrite = true;
      if (/logo|badge|decal|label|setlogo/i.test(n) && mat.map && !mat.alphaMap) {
        mat.alphaTest = 0;
      } else {
        mat.alphaTest = Math.max(mat.alphaTest || 0, 0.45);
      }
    } else if ((mat.opacity ?? 1) > 0.9) {
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthWrite = true;
    }
  }
  // Already-opaque logo planes that still alpha-test against a colour map → door-sized holes
  if (!isGlass && /logo|badge|decal|setlogo/i.test(n) && mat.alphaTest > 0 && mat.map && !mat.alphaMap) {
    mat.alphaTest = 0;
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
  }
  // Lamp covers authored as BLEND+depthWrite=false punch holes through bodywork when overlapping panels
  if (isLight && mat.transparent && (mat.opacity ?? 1) >= 0.9) {
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
    if (mat.alphaMap) mat.alphaTest = Math.max(mat.alphaTest || 0, 0.4);
  }
  // Real glass stays slightly translucent but must write depth or cabin shows through body panels wrongly
  if (isGlass) {
    mat.transmission = 0;
    if (mat.transmissionMap) mat.transmissionMap = null;
    if (mat.transparent || (mat.opacity ?? 1) < 0.99) {
      mat.transparent = true;
      mat.opacity = Math.min(0.55, Math.max(0.28, mat.opacity || 0.4));
      mat.depthWrite = true;
      mat.alphaTest = 0;
    }
  }
  // Keep authored DoubleSide — many hero GLBs have inverted shell patches that vanish on FrontSide
  mat.needsUpdate = true;
  return mat;
}
function bake(mesh) {
  // flatten (quantized / interleaved) attributes into plain Float32 so merging works
  const src = mesh.geometry, g = new THREE.BufferGeometry();
  const take = (name, size) => {
    const a = src.attributes[name]; const out = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) { out[i * size] = a.getX(i); out[i * size + 1] = a.getY(i); if (size > 2) out[i * size + 2] = a.getZ(i); }
    g.setAttribute(name, new THREE.BufferAttribute(out, size));
  };
  take('position', 3);
  if (src.attributes.normal) take('normal', 3);
  if (src.attributes.uv1) take('uv1', 2); else if (usesUV1(mesh.material)) g.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
  if (src.attributes.uv) take('uv', 2); else g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
  if (src.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index.array), 1));
  g.applyMatrix4(mesh.matrixWorld);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
// Bucket materials so hero cars with dozens of near-identical mats collapse to a handful of draw calls.
// Textured mats stay unique per map; untextured mats quantize to colour/metal/roughness bins.
function matBucket(mat, aggressive) {
  if (!mat) return 'misc';
  const n = mat.name || '';
  // Only true glass — transparent grilles/logos must not share the glass draw (sorting + see-through bugs)
  if (isGlassMat(mat)) return 'glass';
  if (/tire|tyre|rubber|llanta/i.test(n)) return 'rubber';
  // lo: collapse opaque mapped trim into colour bins (traffic never reads unique badge maps)
  if (mat.map) {
    if (aggressive && !mat.transparent && !(mat.alphaTest > 0) && !/paint|body|primary|Body/i.test(n)) {
      const c = mat.color || { r: 1, g: 1, b: 1 };
      const q = (x) => Math.round(Math.min(1, Math.max(0, x)) * 3);
      const met = Math.round((mat.metalness || 0) * 4);
      const rou = Math.round((mat.roughness ?? 0.5) * 4);
      return `loTex:${q(c.r)}${q(c.g)}${q(c.b)}:m${met}:r${rou}`;
    }
    return 'tex:' + mat.map.uuid + ':' + (mat.alphaMap ? mat.alphaMap.uuid : '') + ':' + (mat.transparent ? 1 : 0) + ':' + (mat.alphaTest > 0 ? 1 : 0);
  }
  // hi LOD: keep named untextured mats distinct. Aggressive dark/chrome bucketing was merging the
  // whole G-Wagon into door_handles (60k+ tris) and punching holes in doors/panels.
  if (!aggressive && n) return 'name:' + n;
  const c = mat.color || { r: 1, g: 1, b: 1 };
  const bins = aggressive ? 3 : 6;
  const q = (x) => Math.round(Math.min(1, Math.max(0, x)) * bins);
  const met = Math.round((mat.metalness || 0) * 4);
  const rou = Math.round((mat.roughness ?? 0.5) * 4);
  const em = mat.emissive && typeof mat.emissive.getHex === 'function' ? mat.emissive.getHex() : 0;
  if (em > 0 || /light|lamp|tail|head|optik|emissive|luz/i.test(n)) return 'emis:' + em + ':' + q(c.r) + q(c.g) + q(c.b);
  if (/chrome|metal|alloy|rim|disc|silver|steel/i.test(n) || met >= 3) return `chrome:m${met}:r${rou}`;
  if (/carbon|grill|plastic|black|underside/i.test(n) || (c.r + c.g + c.b < 0.45 && met < 2)) return `dark:m${met}:r${rou}`;
  return `col:${q(c.r)}:${q(c.g)}:${q(c.b)}:m${met}:r${rou}`;
}

function mergeBy(list, center, aggressive = false) {
  // list: [{geo, mat, name?}] -> [{geo, mat}] merged per material bucket
  const by = new Map(); // key -> { mat, geos }
  for (const it of list) {
    const key = matBucket(it.mat, aggressive);
    let b = by.get(key);
    if (!b) { b = { mat: it.mat, geos: [] }; by.set(key, b); }
    b.geos.push(it.geo);
  }
  const out = [];
  for (const { mat, geos } of by.values()) {
    let g = geos.length > 1 ? mergeGeometries(geos) : geos[0];
    if (!g && geos.length > 1) {
      // Keep unmerged pieces — dropping them punched holes in doors/glass on several hero cars
      for (const piece of geos) {
        if (!piece) continue;
        const pg = center ? piece.clone() : piece;
        if (center) pg.translate(-center.x, -center.y, -center.z);
        pg.computeBoundingSphere();
        out.push({ geo: pg, mat });
      }
      continue;
    }
    if (!g) continue;
    if (center) g.translate(-center.x, -center.y, -center.z);
    g.computeBoundingSphere();
    out.push({ geo: g, mat });
  }
  return out;
}

// Cabin-only cull for chase cam. Do NOT match exterior wipers / hood labels / body stitches — those read as "missing parts".
const INTERIOR_DROP = /interior|alcantara|fabrica|noisea|COOPER_int|rollcage|steering|carpet|pedal|(?:^|_| )(?:seat|leather|belt)(?:s?\b|_)/i;

function prepare(gltf, def, lod = 'hi') {
  const aggressive = lod === 'lo';
  const wrap = new THREE.Group(); wrap.rotation.y = def.rotY; // orient so the nose points +Z (game forward)
  wrap.add(gltf.scene); wrap.updateMatrixWorld(true);
  const isWheelNode = (n) => def.wheelNode.test(n.name);
  const wheelNodes = []; gltf.scene.traverse((o) => { if (isWheelNode(o)) wheelNodes.push(o); });
  // ground the tyres on y=0 and centre the wheelbase on z=0 (game physics pivots about the axle midpoint)
  const wb = new THREE.Box3(); wheelNodes.forEach((n) => wb.expandByObject(n));
  const wc = (n) => new THREE.Box3().setFromObject(n).getCenter(new THREE.Vector3());
  const fz = wheelNodes.filter((n) => def.frontWheel.test(n.name)).map((n) => wc(n).z), rz = wheelNodes.filter((n) => !def.frontWheel.test(n.name)).map((n) => wc(n).z);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const tag = def.model || 'model';
  if (!wheelNodes.length || wb.isEmpty()) {
    throw new Error(`carAssets: ${tag} has no wheel node bounds (wheelNode=${def.wheelNode})`);
  }
  wrap.position.y = -wb.min.y;
  wrap.position.z = -((fz.length ? avg(fz) : avg(wheelNodes.map((n) => wc(n).z))) + (rz.length ? avg(rz) : avg(wheelNodes.map((n) => wc(n).z)))) / 2;
  wrap.updateMatrixWorld(true);
  const wheelOf = (o) => { for (let n = o; n; n = n.parent) if (isWheelNode(n)) return n; return null; };
  const steerOf = (o) => { if (!def.steer) return null; for (let n = o; n; n = n.parent) if (def.steer.test(n.name)) return n; return null; };
  const bodyList = [], wheelDefs = {}, steerList = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) sanitizeMat(m);
    const w = wheelOf(o), s = steerOf(o);
    // Classify wheels/steer BEFORE interior culling — tyre/rim mats often match /belt|label|leather/
    // and must never be dropped or wheels[] ends up empty (crash on wheels[0].center).
    if (w || s) {
      const item = { geo: bake(o), mat: o.material, name: o.name };
      if (w) (wheelDefs[w.name] ||= []).push(item);
      else steerList.push(item);
      return;
    }
    const mn = (o.material && o.material.name) || o.name || '';
    // lo: strip cabin upholstery. hi: keep seats/dash so empty cabins don't read as see-through windows;
    // still drop tiny label cards that only waste draws.
    if (INTERIOR_DROP.test(mn) || INTERIOR_DROP.test(o.name || '')) {
      if (aggressive) {
        if (!GLASS_NAME.test(mn) && !isGlassMat(o.material)) return;
      } else if (/labels?|noisea|fabrica|hood_labels/i.test(mn) || /labels?|noisea|fabrica/i.test(o.name || '')) {
        return;
      }
    }
    // Logo/decal planes (esp. G-Wagon setlogo01x) are UV sheets over the whole door with sparse
    // opaque texels — alphaTest discards the rest and punches rectangular holes in bodywork.
    {
      const mn2 = (o.material && o.material.name) || '';
      if (/setlogo|logo|badge|decal/i.test(mn2) || /setlogo|logo|badge|decal/i.test(o.name || '')) return;
    }
    // lo: drop tiny trim / mirror / wiper / label cards — they inflate traffic draw calls
    if (aggressive) {
      const pos = o.geometry?.attributes?.position;
      const tris = pos ? (o.geometry.index ? o.geometry.index.count / 3 : pos.count / 3) : 0;
      const mn2 = (o.material && o.material.name) || o.name || '';
      if (tris > 0 && tris < 80 && !GLASS_NAME.test(mn2) && !/body|paint|primary|chassis|door|hood|bonnet|fender|wing|tire|tyre|wheel|glass/i.test(mn2)) return;
      if (/wiper|mirror|antenna|numberplate|plate|stitch|label|bolt|screw|rivet/i.test(mn2) || /wiper|mirror|antenna|numberplate|plate/i.test(o.name || '')) return;
    }
    bodyList.push({ geo: bake(o), mat: o.material, name: o.name });
  });
  const box = new THREE.Box3().setFromObject(wrap);
  const size = box.getSize(new THREE.Vector3());
  const wheels = [];
  for (const [name, items] of Object.entries(wheelDefs)) {
    if (!items.length) continue;
    const tires = items.filter((i) => /tire/i.test(i.name) || /tire/i.test((i.mat && i.mat.name) || ''));
    const ref = tires.length ? tires : items;
    const bb = new THREE.Box3(); ref.forEach((i) => { i.geo.computeBoundingBox(); bb.union(i.geo.boundingBox); });
    if (bb.isEmpty()) continue;
    const c = bb.getCenter(new THREE.Vector3());
    const sz = bb.getSize(new THREE.Vector3());
    // Wheels: always aggressive bucket (tire + rim is enough)
    wheels.push({ name, side: Math.sign(c.x) || 1, center: c, radius: Math.max(sz.y, sz.z) / 2, parts: mergeBy(items, c, true), front: def.frontWheel.test(name) });
  }
  if (!wheels.length) throw new Error(`carAssets: ${tag} no wheel meshes survived prepare (nodes=${wheelNodes.map((n) => n.name).join(',')})`);
  let steer = null;
  if (steerList.length) {
    const bb = new THREE.Box3(); steerList.forEach((i) => { i.geo.computeBoundingBox(); bb.union(i.geo.boundingBox); });
    const c = bb.getCenter(new THREE.Vector3());
    steer = { center: c, parts: mergeBy(steerList, c, true) };
  }
  const fronts = wheels.filter((w) => w.front), rears = wheels.filter((w) => !w.front);
  const frontZ = fronts.length ? avg(fronts.map((w) => w.center.z)) : avg(wheels.map((w) => w.center.z));
  const rearZ = rears.length ? avg(rears.map((w) => w.center.z)) : avg(wheels.map((w) => w.center.z));
  // keepTextures cars already have authored maps — only collapse mats on lo LOD
  const body = mergeBy(bodyList, null, aggressive);
  // locate lamp clusters (per side) so the glow sprites sit on the real lamps.
  // end='head' → frontmost Z of the cluster; end='tail' → rearmost Z (nose is +Z after prep).
  const lamp = (re, end) => {
    const out = {};
    for (const sx of [-1, 1]) {
      const bb = new THREE.Box3();
      for (const it of body) {
        if (!re.test(it.mat.name || '')) continue;
        const p = it.geo.attributes.position;
        for (let i = 0; i < p.count; i++) if (Math.sign(p.getX(i)) === sx || Math.abs(p.getX(i)) < 1e-4) bb.expandByPoint(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
      }
      if (!bb.isEmpty()) {
        const c = bb.getCenter(new THREE.Vector3());
        out[sx] = { x: c.x, y: c.y, z: end === 'tail' ? bb.min.z : bb.max.z };
      }
    }
    return out;
  };
  const heads = def.headMat ? lamp(def.headMat, 'head') : null, tails = def.tailMat ? lamp(def.tailMat, 'tail') : null;
  const track = Math.abs(wheels[0].center.x) || Math.abs(wheels.find((w) => w.center.x)?.center.x) || size.x * 0.35;
  return { def, body, wheels, steer, size, box, frontZ, rearZ, wheelR: avg(wheels.map((w) => w.radius)), track, heads, tails, lod };
}

export async function loadCarAssets() {
  await Promise.all(Object.entries(SOURCES).map(async ([k, buf]) => {
    const [model, lod] = k.split(':');
    templates[k] = prepare(await parse(buf), { ...MODEL_DEFS[model], model }, lod || 'hi');
  }));
}
export const hasGLB = (model, lod) => !!templates[model + ':' + lod];
export const getTemplate = (model, lod) => templates[model + ':' + lod];
