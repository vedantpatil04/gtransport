import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
// Real English copy: tests assert on what the office actually reads, and a missing key shows up as a key name.
import '@/i18n';
import { resetFakeMaplibre } from './fakeMaplibre';
import { resetViewport } from './viewport';

// Real MapLibre needs WebGL, so every test gets the recording fake (see fakeMaplibre.ts), along with
// a stand-in for the web-worker URL the app imports through Vite.
vi.mock('maplibre-gl', async () => await import('./fakeMaplibre'));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '/maplibre-gl-worker.js' }));

beforeEach(() => {
  resetFakeMaplibre();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetViewport();
});

// jsdom has no ResizeObserver; Radix primitives and layout hooks reach for it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Radix dialogs call these on open.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
