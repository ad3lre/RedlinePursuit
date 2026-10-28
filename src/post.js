// ===== Post-processing chain =====
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Depth-reprojection camera motion blur: reconstructs each pixel's world position from the depth buffer, projects it with the
// previous frame's camera, and blurs along the screen-space motion. Static world streaks with camera speed (like a real shutter),
// the player's own car (which travels with the camera) is masked out so it stays crisp.
const MotionBlurShader = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uScale: { value: 0 }, uCar: { value: new THREE.Vector3() }, uCarR: { value: 3 }, uMax: { value: 0.03 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse, tDepth; uniform mat4 uInvVP, uPrevVP; uniform float uScale, uCarR, uMax; uniform vec3 uCar;
    varying vec2 vUv;
    float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      if (uScale < 0.001) { gl_FragColor = base; return; }
      float d = texture2D(tDepth, vUv).x;
      // sky / far water sit at the far plane where reprojection divides by ~0 -> NaN speckle; skip them (they barely move on screen anyway)
      if (d > 0.99995) { gl_FragColor = base; return; }
      vec4 wp = uInvVP * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      if (abs(wp.w) < 1e-6) { gl_FragColor = base; return; }
      wp /= wp.w;
      vec4 pc = uPrevVP * wp;
      if (pc.w < 1e-4) { gl_FragColor = base; return; }
      vec2 pu = (pc.xy / pc.w) * 0.5 + 0.5;
      vec2 vel = (vUv - pu) * uScale;
      if (!(vel.x == vel.x) || !(vel.y == vel.y)) { gl_FragColor = base; return; }
      vel *= smoothstep(uCarR * 0.75, uCarR * 1.5, distance(wp.xyz, uCar));
      float l = length(vel); if (l > uMax) vel *= uMax / l;
      if (l < 0.0006) { gl_FragColor = base; return; }
      vec3 acc = vec3(0.0); float jit = ign(gl_FragCoord.xy) - 0.5;
      for (int i = 0; i < 12; i++) { float t = (float(i) + 0.5 + jit) / 12.0 - 0.5; acc += texture2D(tDiffuse, clamp(vUv + vel * t, 0.001, 0.999)).rgb; }
      vec3 outc = acc / 12.0; if (!(outc.r == outc.r) || !(outc.g == outc.g) || !(outc.b == outc.b)) outc = base.rgb;
      gl_FragColor = vec4(outc, base.a);
    }`,
};
class MotionBlurPass extends Pass {
  constructor(camera) {
    super(); this.camera = camera; this.needsSwap = true;
    this.mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(MotionBlurShader.uniforms), vertexShader: MotionBlurShader.vertexShader, fragmentShader: MotionBlurShader.fragmentShader, depthTest: false, depthWrite: false });
    this.u = this.mat.uniforms; this.quad = new FullScreenQuad(this.mat);
    this.vp = new THREE.Matrix4(); this.prev = new THREE.Matrix4(); this.have = false; this.shutter = 0.5;
  }
  render(renderer, writeBuffer, readBuffer, dt) {
    this.vp.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    if (!this.have) { this.prev.copy(this.vp); this.have = true; }
    this.u.tDiffuse.value = readBuffer.texture; this.u.tDepth.value = readBuffer.depthTexture;
    this.u.uInvVP.value.copy(this.vp).invert(); this.u.uPrevVP.value.copy(this.prev);
    this.u.uScale.value = this.strength ? Math.min(1.6, (this.shutter / 60 * 2) / Math.max(dt, 1 / 240)) * this.strength : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    this.prev.copy(this.vp);
  }
  dispose() { this.mat.dispose(); this.quad.dispose(); }
}


const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uSpeed: { value: 0 }, uBlur: { value: 1 }, uTime: { value: 0 },
    uDamage: { value: 0 }, uNitro: { value: 0 }, uMB: { value: 0 }, uVig: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) }, uSiren: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(0.5, 0.5, 0) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSpeed, uBlur, uTime, uDamage, uNitro, uVig, uMB; uniform vec2 uRes; uniform vec3 uSiren, uSun;
    varying vec2 vUv;
    float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec2 c = vec2(0.5, 0.52);
      vec2 d = vUv - c;
      float r = length(d);
      float mask = smoothstep(0.18, 0.75, r);
      float amt = uSpeed * uBlur + uNitro * 0.45 * uBlur; // nitro adds its own radial rush even at moderate speed
      vec3 col = vec3(0.0);
      if (amt > 0.01) {
        float st = (0.028 - 0.016 * uMB) * amt * mask;
        float tot = 0.0;
        for (int i = 0; i < 8; i++) { float f = float(i) / 7.0; float w = 1.0 - f * 0.6; col += texture2D(tDiffuse, vUv - d * st * f).rgb * w; tot += w; }
        col /= tot;
      } else col = texture2D(tDiffuse, vUv).rgb;
      // chromatic aberration toward edges
      float ca = (0.0012 + 0.0035 * amt) * mask;
      col.r = mix(col.r, texture2D(tDiffuse, vUv + d * ca * 2.0).r, 0.7);
      col.b = mix(col.b, texture2D(tDiffuse, vUv - d * ca * 2.0).b, 0.7);
      // speed streaks
      if (amt > 0.05) {
        float ang = atan(d.y, d.x);
        float lane = floor(ang * 70.0);
        float s = step(0.965, h(vec2(lane + 300.0, mod(floor(uTime * 14.0 + lane * 0.37), 997.0))));
        float along = fract(r * 3.0 - uTime * 4.0 + h(vec2(lane, 1.0)));
        col += mix(vec3(0.7, 0.8, 1.0), vec3(0.35, 0.65, 1.0), uNitro) * s * smoothstep(0.35, 0.9, r) * smoothstep(0.0, 0.3, along) * (1.0 - along) * amt * 0.5;
      }
      // sun shafts: march from the pixel toward the sun, keep only HDR-bright samples (sun disc / sky glow); hills and buildings occlude naturally
      if (uSun.z > 0.01) {
        vec2 sd = (uSun.xy - vUv) * 0.55; float jt = h(gl_FragCoord.xy) * 0.5; vec3 acc = vec3(0.0);
        for (int i = 0; i < 10; i++) { float t = (float(i) + jt) / 10.0; vec3 sm = texture2D(tDiffuse, vUv + sd * t).rgb; acc += max(sm - vec3(1.1), 0.0) * (1.0 - t); }
        float fall = 1.0 - smoothstep(0.0, 1.2, length(vUv - uSun.xy));
        col += min(acc * 0.1, vec3(1.5)) * vec3(1.0, 0.72, 0.45) * uSun.z * (0.35 + 0.65 * fall);
      }
      // grading: slight saturation + contrast in linear
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.14);
      // filmic split-tone: cool shadows, warm highlights, gentle toe contrast
      col *= mix(vec3(0.97, 1.0, 1.05), vec3(1.05, 1.0, 0.93), smoothstep(0.05, 1.4, l));
      col = col * (1.0 + 0.10 * smoothstep(0.0, 0.6, l)) - 0.004;
      // vignette
      float vig = 1.0 - smoothstep(0.45, 1.05, r * 1.25) * 0.55 * uVig;
      col *= vig;
      // damage & nitro & siren edge glow
      float edge = smoothstep(0.35, 0.85, r);
      col = mix(col, col * vec3(1.6, 0.3, 0.3) + vec3(0.25, 0.0, 0.0), edge * uDamage);
      col += vec3(0.1, 0.3, 1.0) * edge * uNitro * (0.5 + 0.1 * sin(uTime * 38.0)) + vec3(0.25, 0.5, 1.0) * smoothstep(0.55, 1.0, r) * uNitro * 0.35;
      col += vec3(uSiren.x, 0.0, uSiren.y) * edge * 0.25 * uSiren.z;
      // grain
      col += (h(vUv * uRes + fract(uTime * 7.0) * 311.0) - 0.5) * 0.015;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
    rt.depthTexture = new THREE.DepthTexture(size.x * pr, size.y * pr); rt.depthTexture.type = THREE.UnsignedIntType; rt.depthTexture.format = THREE.DepthFormat;
    this.composer = new EffectComposer(renderer, rt);
    this.render = new RenderPass(scene, camera);
    this.composer.addPass(this.render);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.5, 1.0);
    this.composer.addPass(this.bloom);
    this.mb = new MotionBlurPass(camera); this.mb.strength = 0;
    this.composer.addPass(this.mb);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
    this.u = this.final.uniforms;
  }
  setSize(w, h) { this.composer.setSize(w, h); this.u.uRes.value.set(w, h); }
  setQuality(q) { this.bloom.enabled = q > 0; this.mb.enabled = q > 0; }
  draw(dt) { this.u.uTime.value += dt; this.composer.render(dt); }
}
