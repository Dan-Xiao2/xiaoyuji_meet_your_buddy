import { build } from 'esbuild';
await build({ entryPoints: ['src/voice-lab/page.js'], bundle: true, format: 'esm', outfile: 'src/voice-lab/client.bundle.js', target: 'es2022', minify: true });
console.log('Built voice lab client');
