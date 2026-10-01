import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath, URL } from 'node:url';

// Builds the whole prototype into one self-contained HTML file (dist-demo/index.html)
// so it can be shared or hosted as a single page for client demos.
export default defineConfig({
  // `demo` mode switches the app to HashRouter so it also works when opened from disk.
  mode: 'demo',
  plugins: [react(), viteSingleFile()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // MapLibre's web worker is imported as a URL (features/map/MapLibreMap.tsx) and loaded as an ES module.
  // It cannot be inlined into the page: it is emitted as one extra file beside index.html.
  worker: { format: 'es' },
  build: { outDir: 'dist-demo', chunkSizeWarningLimit: 4000 },
});
