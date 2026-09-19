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
  build: { outDir: 'dist-demo', chunkSizeWarningLimit: 4000 },
});
