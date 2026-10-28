// Verify every bundled car template has 4 wheels after prepare().
// Polyfills Uint8Array.fromBase64 for Node <25 (esbuild binary loader).
import { build } from 'esbuild';

if (typeof Uint8Array.fromBase64 !== 'function') {
  Uint8Array.fromBase64 = (b64) => Uint8Array.from(Buffer.from(b64, 'base64'));
}
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.URL = URL;
globalThis.Blob = Blob;
// GLTFLoader WebP probe needs a DOM Image; geometry-only verify does not need real decode.
if (typeof globalThis.Image === 'undefined') {
  globalThis.Image = class Image {
    constructor() { this.width = 1; this.height = 1; this.complete = true; this._src = ''; }
    set src(v) {
      this._src = v;
      this.complete = true;
      Promise.resolve().then(() => { if (this.onload) this.onload(); });
    }
    get src() { return this._src; }
    decode() { return Promise.resolve(); }
  };
}
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
}

await build({
  entryPoints: ['tools/_wheelcheck_entry.mjs'],
  bundle: true,
  format: 'esm',
  outfile: 'tools/_wheelcheck_bundle.mjs',
  platform: 'node',
  loader: { '.glb': 'binary' },
  logLevel: 'silent',
});
await import(new URL('./_wheelcheck_bundle.mjs', import.meta.url).href);
