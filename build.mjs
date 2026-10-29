import { build } from 'esbuild';
await build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', minify: !process.argv.includes('--dev'), outfile: 'game.js', loader: { '.glb': 'binary', '.webp': 'dataurl', '.wav': 'binary' }, logLevel: 'info' });
