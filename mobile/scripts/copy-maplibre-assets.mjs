import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);
const maplibrePkgPath = require.resolve('maplibre-gl/package.json');
const maplibreDist = path.join(path.dirname(maplibrePkgPath), 'dist');

const targetDir = path.resolve(__dirname, '../public/maplibre');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const filesToCopy = [
  'maplibre-gl-worker.mjs',
  'maplibre-gl-shared.mjs',
  'maplibre-gl.css',
];

for (const file of filesToCopy) {
  const src = path.join(maplibreDist, file);
  const dest = path.join(targetDir, file);
  if (!fs.existsSync(src)) {
    throw new Error(`MapLibre source file not found: ${src}`);
  }
  fs.copyFileSync(src, dest);
  console.log(`[copy-maplibre] Copied ${file} to ${dest}`);
}
