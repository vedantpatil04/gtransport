import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const VENDOR_CHUNKS: Record<string, RegExp> = {
  react: /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run)\//,
  charts: /node_modules\/(recharts|d3-[^/]+|victory-vendor|internmap|decimal\.js-light|eventemitter3|react-smooth|recharts-scale|lodash)\//,
  ui: /node_modules\/(@radix-ui|@floating-ui|sonner|lucide-react|class-variance-authority|clsx|tailwind-merge)\//,
  forms: /node_modules\/(react-hook-form|@hookform|zod)\//,
  i18n: /node_modules\/(i18next|react-i18next)\//,
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          for (const [name, re] of Object.entries(VENDOR_CHUNKS)) if (re.test(id)) return `vendor-${name}`;
          return undefined;
        },
      },
    },
  },
});
