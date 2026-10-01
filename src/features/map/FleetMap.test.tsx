import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi, type MockInstance } from 'vitest';
import i18n from '@/i18n';
import { FakeMap, FakeMarker, currentMap, markerFor } from '@/test/fakeMaplibre';
import { FleetMap, type FleetMapProps } from './FleetMap';
import type { MapMarker } from './provider';

const STYLE = 'https://tiles.example.com/styles/basic/style.json';

const vehicle = (id: string, latitude: number, longitude: number, overrides: Partial<MapMarker> = {}): MapMarker => ({
  id,
  latitude,
  longitude,
  headingDeg: null,
  tone: 'moving',
  label: id.toUpperCase(),
  ...overrides,
});

const NONE: MapMarker = vehicle('none', 0, 0, { tone: 'none' });

function renderMap(props: Partial<FleetMapProps> = {}) {
  const onSelect = vi.fn();
  const base: FleetMapProps = { markers: [], selectedId: null, onSelect };
  const utils = render(<FleetMap {...base} {...props} />);
  return { ...utils, onSelect, rerender: (next: Partial<FleetMapProps>) => utils.rerender(<FleetMap {...base} {...props} {...next} />) };
}

const ready = () =>
  act(() => {
    currentMap().fire('style.load');
    currentMap().fire('load');
  });
const failToLoad = () => act(() => currentMap().fire('error', { error: { message: 'Not Found (404)', status: 404, url: STYLE } }));

let errorLog: MockInstance<typeof console.error>;

beforeEach(() => {
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('when no map style is configured', () => {
  it('says so, plainly, and draws no map', () => {
    vi.stubEnv('VITE_MAP_STYLE_URL', '');
    renderMap({ markers: [vehicle('d1', 15.85, 74.498)] });

    expect(screen.getByText('Map configuration is unavailable.')).toBeTruthy();
    expect(screen.getByText(/driver list and each driver's details are still available/)).toBeTruthy();
    expect(FakeMap.instances).toHaveLength(0);
    expect(FakeMarker.instances).toHaveLength(0);
    expect(document.querySelector('[data-testid="fleet-map"]')).toBeNull();
  });

  it('is the same for an unusable value, such as a Mapbox style MapLibre cannot read', () => {
    vi.stubEnv('VITE_MAP_STYLE_URL', 'mapbox://styles/mapbox/streets-v12');
    renderMap();
    expect(screen.getByText('Map configuration is unavailable.')).toBeTruthy();
    expect(FakeMap.instances).toHaveLength(0);
  });

  it('logs why for whoever deploys it, without echoing the configured value', () => {
    // Unusable (wrong scheme) while still carrying a would-be key.
    vi.stubEnv('VITE_MAP_STYLE_URL', 'ftp://tiles.example.com/style.json?key=SECRET-KEY');
    renderMap();
    expect(errorLog).toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('SECRET-KEY');
    expect(JSON.stringify(errorLog.mock.calls)).toContain('VITE_MAP_STYLE_URL');
  });

  it('offers no retry, because trying again cannot change the configuration', () => {
    vi.stubEnv('VITE_MAP_STYLE_URL', '');
    renderMap();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('keeps the message clear of the driver panel when one is open', () => {
    vi.stubEnv('VITE_MAP_STYLE_URL', '');
    renderMap({ focusInsetLeft: 352 });
    expect(screen.getByTestId('fleet-map-config-error').style.paddingLeft).toBe('368px');
  });

  it('is a role="alert" so it is announced, not just shown', () => {
    vi.stubEnv('VITE_MAP_STYLE_URL', '');
    renderMap();
    expect(screen.getByRole('alert').textContent).toContain('Map configuration is unavailable.');
  });
});

describe('when a style is configured', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MAP_STYLE_URL', STYLE);
  });

  it('initialises MapLibre with exactly that style', () => {
    renderMap();
    expect(FakeMap.instances).toHaveLength(1);
    expect(currentMap().options.style).toBe(STYLE);
  });

  it('says it is loading until MapLibre reports the map ready', () => {
    renderMap({ markers: [vehicle('d1', 15.85, 74.498)] });
    expect(screen.getByText('Loading fleet map...')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading fleet map...');

    ready();

    expect(screen.queryByText('Loading fleet map...')).toBeNull();
  });

  it('plots the vehicles it is given at their real coordinates', () => {
    renderMap({ markers: [vehicle('d1', 15.85, 74.498), vehicle('d2', 16.705, 74.243)] });
    expect(markerFor('d1').lngLat).toEqual([74.498, 15.85]);
    expect(markerFor('d2').lngLat).toEqual([74.243, 16.705]);
  });

  it('passes a click on a pin to onSelect', () => {
    const { onSelect } = renderMap({ markers: [vehicle('d1', 15.85, 74.498)] });
    fireEvent.click(markerFor('d1').element);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('d1');
  });

  describe('legend', () => {
    it('explains the three colours', () => {
      renderMap();
      const legend = screen.getByTestId('fleet-map-legend');
      for (const label of ['Moving', 'Stopped', 'Offline']) expect(legend.textContent).toContain(label);
      expect(legend.textContent).not.toContain('Simulated');
    });

    it('says when the positions are simulated, as the prototype’s are', () => {
      renderMap({ simulated: true });
      expect(screen.getByTestId('fleet-map-legend').textContent).toContain('Simulated positions');
    });

    it('is shown while loading and once ready, but not over a failure', () => {
      renderMap();
      expect(screen.queryByTestId('fleet-map-legend')).not.toBeNull();
      ready();
      expect(screen.queryByTestId('fleet-map-legend')).not.toBeNull();
    });
  });

  describe('when nobody has a position to show', () => {
    it('says so once the map is ready', () => {
      renderMap({ markers: [] });
      expect(screen.queryByText('No drivers are currently reporting location.')).toBeNull();

      ready();

      expect(screen.getByText('No drivers are currently reporting location.')).toBeTruthy();
    });

    it('says so when drivers exist but none has a fix yet', () => {
      renderMap({ markers: [NONE, vehicle('also-none', 0, 0, { tone: 'none' })] });
      ready();
      expect(screen.getByText('No drivers are currently reporting location.')).toBeTruthy();
    });

    it('does not say so while the fleet is still loading, when empty only means "not here yet"', () => {
      const { rerender } = renderMap({ markers: [], loading: true });
      ready();
      expect(screen.queryByText('No drivers are currently reporting location.')).toBeNull();

      rerender({ markers: [], loading: false });
      expect(screen.getByText('No drivers are currently reporting location.')).toBeTruthy();
    });

    it('goes away as soon as a vehicle has a position', () => {
      const { rerender } = renderMap({ markers: [] });
      ready();
      expect(screen.getByText('No drivers are currently reporting location.')).toBeTruthy();

      rerender({ markers: [vehicle('d1', 15.85, 74.498)] });

      expect(screen.queryByText('No drivers are currently reporting location.')).toBeNull();
    });

    it('still shows the real map beneath the message, not a blank', () => {
      renderMap({ markers: [] });
      ready();
      expect(document.querySelector('[data-testid="fleet-map"]')).not.toBeNull();
      expect(FakeMap.instances[0]!.removed).toBe(false);
    });
  });

  describe('when the map cannot be loaded', () => {
    it('says so, offers a retry, and tells the office the rest still works', () => {
      renderMap({ markers: [vehicle('d1', 15.85, 74.498)] });
      failToLoad();

      expect(screen.getByText('Map could not be loaded.')).toBeTruthy();
      expect(screen.getByText(/including coordinates and Open in Google Maps, are still available/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
      expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('does not pretend: no loading message, no legend, no empty message', () => {
      renderMap({ markers: [] });
      failToLoad();
      expect(screen.queryByText('Loading fleet map...')).toBeNull();
      expect(screen.queryByTestId('fleet-map-legend')).toBeNull();
      expect(screen.queryByText('No drivers are currently reporting location.')).toBeNull();
    });

    it('covers the half-drawn map so it cannot be mistaken for live data', () => {
      renderMap({ markers: [vehicle('d1', 15.85, 74.498)] });
      failToLoad();
      const overlay = screen.getByTestId('fleet-map-error').parentElement!;
      expect(overlay.className).toContain('bg-card');
      expect(overlay.className).toContain('inset-0');
    });

    it('is the same when MapLibre cannot start at all, as when WebGL is unavailable', () => {
      FakeMap.constructorError = new Error('Failed to initialize WebGL');
      renderMap();
      expect(screen.getByText('Map could not be loaded.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    });

    it('retries with a brand-new map, which says it is loading again', () => {
      renderMap({ markers: [vehicle('d1', 15.85, 74.498)] });
      const first = currentMap();
      failToLoad();

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(FakeMap.instances).toHaveLength(2);
      expect(first.removed).toBe(true);
      expect(currentMap().options.style).toBe(STYLE);
      expect(screen.queryByText('Map could not be loaded.')).toBeNull();
      expect(screen.getByText('Loading fleet map...')).toBeTruthy();
    });

    it('recovers when the retry succeeds, with the vehicles back on the new map', () => {
      renderMap({ markers: [vehicle('d1', 15.85, 74.498)] });
      failToLoad();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

      ready();

      expect(screen.queryByText('Map could not be loaded.')).toBeNull();
      expect(screen.queryByText('Loading fleet map...')).toBeNull();
      expect(screen.getByTestId('fleet-map-legend')).toBeTruthy();
      expect(markerFor('d1').map).toBe(currentMap());
    });

    it('can fail again, and be retried again', () => {
      renderMap();
      failToLoad();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      failToLoad();
      expect(screen.getByText('Map could not be loaded.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(FakeMap.instances).toHaveLength(3);
    });

    it('keeps the message clear of the driver panel when one is open', () => {
      renderMap({ focusInsetLeft: 352 });
      failToLoad();
      expect(screen.getByTestId('fleet-map-error').parentElement!.style.paddingLeft).toBe('368px');
    });
  });

  describe('when the map itself crashes while rendering', () => {
    it('shows the same honest message instead of taking the screen down, and can try again', () => {
      // React rethrows a render error in development and jsdom reports it as uncaught; this one is
      // deliberate, so keep it out of the test output.
      const swallow = (event: ErrorEvent) => event.preventDefault();
      window.addEventListener('error', swallow);
      onTestFinished(() => window.removeEventListener('error', swallow));

      // A marker list that is not a list makes the map component throw as it renders.
      renderMap({ markers: null as unknown as MapMarker[] });

      expect(screen.getByText('Map could not be loaded.')).toBeTruthy();
      expect(screen.getByTestId('fleet-map-crashed')).toBeTruthy();
      expect(errorLog.mock.calls.some((call) => String(call[0]).includes('[fleet-map] the map crashed while rendering'))).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      // Still broken input, so it fails again — but the retry was attempted and the screen is intact.
      expect(screen.getByText('Map could not be loaded.')).toBeTruthy();
    });
  });
});

describe('copy', () => {
  const KEYS = [
    'map.label', 'map.zoomIn', 'map.zoomOut', 'map.fit', 'map.fullscreen', 'map.exitFullscreen', 'map.simulated',
    'map.loading', 'map.empty', 'map.loadFailed', 'map.loadFailedBody', 'map.configUnavailable', 'map.configUnavailableBody', 'map.retry',
  ];

  it('has every map string in English and Hindi, the two languages the office console offers', () => {
    for (const lng of ['en', 'hi']) {
      for (const key of KEYS) {
        expect(i18n.exists(key, { lng }), `${lng}: ${key}`).toBe(true);
      }
    }
  });

  it('is actually translated, not the English repeated', () => {
    for (const key of KEYS) {
      expect(i18n.t(key, { lng: 'hi' }), key).not.toBe(i18n.t(key, { lng: 'en' }));
    }
  });

  it('uses the exact wording the product specifies for the four map states', () => {
    expect(i18n.t('map.loading', { lng: 'en' })).toBe('Loading fleet map...');
    expect(i18n.t('map.empty', { lng: 'en' })).toBe('No drivers are currently reporting location.');
    expect(i18n.t('map.loadFailed', { lng: 'en' })).toBe('Map could not be loaded.');
    expect(i18n.t('map.configUnavailable', { lng: 'en' })).toBe('Map configuration is unavailable.');
  });
});
