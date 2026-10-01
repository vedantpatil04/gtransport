import { describe, expect, it, vi } from 'vitest';
import { isPlottable, loggableUrl, resolveMapStyle, scrubQueryStrings, type MapMarker } from './provider';

describe('resolveMapStyle', () => {
  it('reports a missing style when the variable is unset, empty or blank', () => {
    expect(resolveMapStyle(undefined)).toEqual({ status: 'unavailable', reason: 'missing' });
    expect(resolveMapStyle('')).toEqual({ status: 'unavailable', reason: 'missing' });
    expect(resolveMapStyle('   ')).toEqual({ status: 'unavailable', reason: 'missing' });
  });

  it('accepts an absolute https URL, trimming whitespace around it', () => {
    expect(resolveMapStyle('  https://tiles.example.com/styles/basic/style.json  ')).toEqual({
      status: 'ready',
      styleUrl: 'https://tiles.example.com/styles/basic/style.json',
    });
  });

  it('accepts http, which a local tile server legitimately uses', () => {
    expect(resolveMapStyle('http://localhost:8080/style.json')).toMatchObject({ status: 'ready' });
  });

  it('resolves a root-relative path against the app’s own origin', () => {
    expect(resolveMapStyle('/map/style.json')).toEqual({ status: 'ready', styleUrl: `${window.location.origin}/map/style.json` });
  });

  it('keeps a provider key in the query string, because the renderer needs it', () => {
    const result = resolveMapStyle('https://tiles.example.com/style.json?key=PUBLIC_BROWSER_KEY');
    expect(result).toEqual({ status: 'ready', styleUrl: 'https://tiles.example.com/style.json?key=PUBLIC_BROWSER_KEY' });
  });

  it.each([
    ['a Mapbox style, which MapLibre cannot read', 'mapbox://styles/mapbox/streets-v12'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:application/json,{}'],
    ['a file: URL', 'file:///etc/style.json'],
    ['a protocol-relative URL, which has no scheme to trust', '//tiles.example.com/style.json'],
    ['text that is not a URL', 'not a url'],
  ])('rejects %s as invalid', (_label, value) => {
    expect(resolveMapStyle(value)).toEqual({ status: 'unavailable', reason: 'invalid' });
  });

  it('reads VITE_MAP_STYLE_URL from the environment when no value is passed', () => {
    vi.stubEnv('VITE_MAP_STYLE_URL', 'https://tiles.example.com/style.json');
    expect(resolveMapStyle()).toEqual({ status: 'ready', styleUrl: 'https://tiles.example.com/style.json' });

    vi.stubEnv('VITE_MAP_STYLE_URL', '');
    expect(resolveMapStyle()).toEqual({ status: 'unavailable', reason: 'missing' });
  });
});

const marker = (overrides: Partial<MapMarker> = {}): MapMarker => ({
  id: 'd1',
  latitude: 15.85,
  longitude: 74.498,
  headingDeg: null,
  tone: 'moving',
  ...overrides,
});

describe('isPlottable', () => {
  it('accepts a real position', () => {
    expect(isPlottable(marker())).toBe(true);
  });

  it('rejects the "no fix yet" tone, whatever coordinates it carries', () => {
    expect(isPlottable(marker({ tone: 'none' }))).toBe(false);
  });

  it('rejects a marker whose coordinates are not finite numbers', () => {
    expect(isPlottable(marker({ latitude: Number.NaN }))).toBe(false);
    expect(isPlottable(marker({ longitude: Number.POSITIVE_INFINITY }))).toBe(false);
  });

  it('rejects coordinates outside the valid range', () => {
    expect(isPlottable(marker({ latitude: 91 }))).toBe(false);
    expect(isPlottable(marker({ longitude: -181 }))).toBe(false);
  });

  it('rejects (0, 0), where a device with no fix tends to report itself', () => {
    expect(isPlottable(marker({ latitude: 0, longitude: 0 }))).toBe(false);
  });

  it('still accepts a coordinate that has a zero in only one axis', () => {
    // The old check was `!lat || !lng`, which silently dropped the equator and the prime meridian.
    expect(isPlottable(marker({ latitude: 0, longitude: 36.8 }))).toBe(true);
    expect(isPlottable(marker({ latitude: 51.5, longitude: 0 }))).toBe(true);
  });
});

describe('what is safe to log', () => {
  it('reduces a URL to its origin and path, dropping a key in the query string', () => {
    expect(loggableUrl('https://tiles.example.com/styles/basic/style.json?key=SECRET&x=1')).toBe('https://tiles.example.com/styles/basic/style.json');
  });

  it('copes with a URL it cannot parse', () => {
    expect(loggableUrl('http://')).toBe('[unparseable url]');
  });

  it('cuts query strings out of free text, whatever the provider calls its key', () => {
    expect(scrubQueryStrings('AJAXError: Not Found (404): https://tiles.example.com/style.json?apikey=SECRET&v=2 failed')).toBe(
      'AJAXError: Not Found (404): https://tiles.example.com/style.json?… failed',
    );
    expect(scrubQueryStrings(undefined)).toBeUndefined();
  });
});
