import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: {
    'background/index': resolve(root, 'src/background/index.ts'),
    'content/index': resolve(root, 'src/content/index.ts'),
    'popup/index': resolve(root, 'src/popup/index.ts')
  },
  outdir: out,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: false,
  minify: false,
  logLevel: 'info'
});

await cp(resolve(root, 'extension/manifest.json'), resolve(out, 'manifest.json'));
await cp(resolve(root, 'extension/popup.html'), resolve(out, 'popup.html'));
await cp(resolve(root, 'src/popup/styles.css'), resolve(out, 'styles.css'));

const manifest = JSON.parse(await readFile(resolve(out, 'manifest.json'), 'utf8'));
manifest.background.service_worker = 'background/index.js';
manifest.action.default_popup = 'popup.html';
manifest.content_scripts[0].js = ['content/index.js'];
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
