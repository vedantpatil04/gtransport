import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      // Components import stylesheets (MapLibre's among them); the tests do not need them processed.
      css: false,
      // The suite must not depend on a developer's local .env: no API (the app's demo mode) and no map
      // style unless a test sets one.
      env: { VITE_API_URL: '', VITE_MAP_STYLE_URL: '' },
    },
  }),
);
