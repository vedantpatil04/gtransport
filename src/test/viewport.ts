import { vi } from 'vitest';

/**
 * jsdom has no layout, so `matchMedia` is the app's only window onto the viewport. This answers
 * `(min-width: Npx)` queries — the only kind the app asks — from a width the test chooses.
 */
let width = 1280;

function matches(query: string): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  return min ? width >= Number(min[1]) : false;
}

export function setViewportWidth(next: number): void {
  width = next;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

export function resetViewport(): void {
  setViewportWidth(1280);
}

resetViewport();
