import { StrictMode } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { FakeMap, FakeMarker, currentMap, markerFor, setWorkerUrl } from '@/test/fakeMaplibre';
import { MapLibreMap, type MapLibreMapProps } from './MapLibreMap';
import type { MapMarker, MapStatus } from './provider';

// Captured at import: the app hands MapLibre its worker URL once, when the module loads.
const workerUrlCalls = [...setWorkerUrl.mock.calls];

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

const BELAGAVI = vehicle('d1', 15.85, 74.498);
const KOLHAPUR = vehicle('d2', 16.705, 74.243);

function setup(props: Partial<MapLibreMapProps> = {}) {
  const onSelect = vi.fn();
  const onStatusChange = vi.fn();
  const base: MapLibreMapProps = { styleUrl: STYLE, markers: [], selectedId: null, onSelect, onStatusChange };
  const utils = render(<MapLibreMap {...base} {...props} />);
  const rerender = (next: Partial<MapLibreMapProps>) => utils.rerender(<MapLibreMap {...base} {...props} {...next} />);
  return { ...utils, rerender, onSelect, onStatusChange };
}

/** MapLibre finishing: the style parsed, then the first complete render. */
const finishLoading = (map: FakeMap = currentMap()) =>
  act(() => {
    map.fire('style.load');
    map.fire('load');
  });

const statuses = (onStatusChange: Mock) => onStatusChange.mock.calls.map(([status]) => (status as MapStatus).state);
const lastStatus = (onStatusChange: Mock) => onStatusChange.mock.calls.at(-1)?.[0] as MapStatus | undefined;

/** The DOM of one pin: [alert ring, dot, plate]. */
const plateOf = (id: string) => markerFor(id).element.children[2] as HTMLElement;

let errorLog: MockInstance<typeof console.error>;
let warnLog: MockInstance<typeof console.warn>;

beforeEach(() => {
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('creating the map', () => {
  it('hands MapLibre its web-worker URL as the module loads', () => {
    expect(workerUrlCalls).toEqual([['/maplibre-gl-worker.js']]);
  });

  it('creates exactly one map, on the configured style', () => {
    setup();
    expect(FakeMap.instances).toHaveLength(1);
    expect(currentMap().options.style).toBe(STYLE);
    expect(currentMap().container.closest('[data-testid="fleet-map"]')).not.toBeNull();
  });

  it('starts on the operating region rather than the middle of the ocean', () => {
    setup();
    expect(currentMap().options.center).toEqual([74.5, 16.5]);
    expect(currentMap().options.zoom).toBe(7);
  });

  it('keeps the map north-up, because the heading arrows assume it', () => {
    setup();
    const { options, keyboard, touchZoomRotate } = currentMap();
    expect(options).toMatchObject({ dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0 });
    expect(keyboard.disableRotation).toHaveBeenCalled();
    expect(touchZoomRotate.disableRotation).toHaveBeenCalled();
  });

  it('keeps the data attribution, which the OpenStreetMap licence requires', () => {
    setup();
    expect(currentMap().options.attributionControl).toEqual({ compact: true });
  });

  it('adds zoom, fullscreen and fit controls on the right', () => {
    setup();
    const { controls } = currentMap();
    expect(controls.map((entry) => entry.position)).toEqual(['top-right', 'top-right', 'top-right']);
    expect(controls[0]!.control).toMatchObject({ options: { showCompass: false } });
  });

  it('labels the controls in the office’s language', () => {
    setup();
    expect(currentMap().options.locale).toMatchObject({
      'Map.Title': 'Fleet map',
      'NavigationControl.ZoomIn': 'Zoom in',
      'NavigationControl.ZoomOut': 'Zoom out',
      'FullscreenControl.Enter': 'Enter fullscreen',
      'FullscreenControl.Exit': 'Exit fullscreen',
    });
  });
});

describe('map lifecycle', () => {
  it('does not recreate the map when the vehicles change', () => {
    const { rerender } = setup({ markers: [BELAGAVI] });
    const first = currentMap();

    rerender({ markers: [vehicle('d1', 15.9, 74.5)] });
    rerender({ markers: [vehicle('d1', 16.0, 74.4), KOLHAPUR] });
    rerender({ markers: [] });

    expect(FakeMap.instances).toHaveLength(1);
    expect(first.removed).toBe(false);
  });

  it('does not recreate the map when the selection or the callbacks change', () => {
    const { rerender } = setup({ markers: [BELAGAVI] });
    rerender({ selectedId: 'd1', onSelect: vi.fn(), onStatusChange: vi.fn() });
    rerender({ selectedId: null, onSelect: vi.fn() });
    expect(FakeMap.instances).toHaveLength(1);
  });

  it('creates a new map only when the style itself changes, and removes the old one', () => {
    const { rerender } = setup();
    const first = currentMap();
    rerender({ styleUrl: 'https://other.example.com/style.json' });
    expect(FakeMap.instances).toHaveLength(2);
    expect(first.removed).toBe(true);
    expect(currentMap().options.style).toBe('https://other.example.com/style.json');
  });

  it('removes the map and every pin when it unmounts', () => {
    const { unmount } = setup({ markers: [BELAGAVI, KOLHAPUR] });
    const map = currentMap();
    const pins = [...FakeMarker.instances];
    expect(pins).toHaveLength(2);

    unmount();

    expect(map.removed).toBe(true);
    expect(pins.every((pin) => pin.removed)).toBe(true);
    expect(document.querySelectorAll('[data-testid^="fleet-marker-"]')).toHaveLength(0);
  });

  it('survives React StrictMode’s mount-unmount-mount: one live map, the first fully torn down', () => {
    const onStatusChange = vi.fn();
    render(
      <StrictMode>
        <MapLibreMap styleUrl={STYLE} markers={[BELAGAVI]} selectedId={null} onSelect={vi.fn()} onStatusChange={onStatusChange} />
      </StrictMode>,
    );

    expect(FakeMap.instances).toHaveLength(2);
    const [first, second] = FakeMap.instances;
    expect(first!.removed).toBe(true);
    expect(second!.removed).toBe(false);

    // Only the live map's pin is in the document.
    expect(document.querySelectorAll('[data-testid="fleet-marker-d1"]')).toHaveLength(1);
    expect(FakeMarker.instances.filter((pin) => !pin.removed)).toHaveLength(1);
  });

  it('ignores a failure from the map StrictMode discarded, and reports the live one once', () => {
    const onStatusChange = vi.fn();
    render(
      <StrictMode>
        <MapLibreMap styleUrl={STYLE} markers={[]} selectedId={null} onSelect={vi.fn()} onStatusChange={onStatusChange} />
      </StrictMode>,
    );
    const [discarded, live] = FakeMap.instances;
    const failure = { error: { message: 'Not Found (404)', status: 404, url: STYLE } };

    act(() => discarded!.fire('error', failure));
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();

    act(() => live!.fire('error', failure));
    act(() => live!.fire('error', failure));
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});

describe('vehicle pins', () => {
  it('places each vehicle at its real coordinates, longitude first', () => {
    setup({ markers: [BELAGAVI, KOLHAPUR] });
    expect(markerFor('d1').lngLat).toEqual([74.498, 15.85]);
    expect(markerFor('d2').lngLat).toEqual([74.243, 16.705]);
    expect(markerFor('d1').options.anchor).toBe('center');
  });

  it('moves only the vehicle that moved, and reuses its element', () => {
    const { rerender } = setup({ markers: [BELAGAVI, KOLHAPUR] });
    const d1Element = markerFor('d1').element;
    const d2Element = markerFor('d2').element;

    rerender({ markers: [vehicle('d1', 16.021, 74.447), KOLHAPUR] });

    expect(markerFor('d1').lngLat).toEqual([74.447, 16.021]);
    expect(markerFor('d1').setLngLatCalls).toBe(2);
    expect(markerFor('d2').setLngLatCalls).toBe(1);
    expect(markerFor('d1').element).toBe(d1Element);
    expect(markerFor('d2').element).toBe(d2Element);
    expect(FakeMarker.instances).toHaveLength(2);
  });

  it('adds vehicles that appear and removes vehicles that go', () => {
    const { rerender } = setup({ markers: [BELAGAVI] });
    expect(document.querySelectorAll('[data-testid^="fleet-marker-"]')).toHaveLength(1);

    rerender({ markers: [KOLHAPUR, vehicle('d3', 17.66, 75.906)] });

    expect(document.querySelectorAll('[data-testid="fleet-marker-d1"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="fleet-marker-d2"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="fleet-marker-d3"]')).toHaveLength(1);
    expect(FakeMarker.instances.find((pin) => pin.element.getAttribute('data-testid') === 'fleet-marker-d1')!.removed).toBe(true);
  });

  it('draws nothing for a driver with no position, however the row says so', () => {
    setup({
      markers: [
        vehicle('none', 0, 0, { tone: 'none' }),
        vehicle('origin', 0, 0),
        vehicle('nan', Number.NaN, 74),
        vehicle('far', 95, 74),
        BELAGAVI,
      ],
    });
    expect(FakeMarker.instances).toHaveLength(1);
    expect(markerFor('d1')).toBeDefined();
  });

  it('draws a vehicle that is on the equator, where only one coordinate is zero', () => {
    setup({ markers: [vehicle('eq', 0, 36.8)] });
    expect(markerFor('eq').lngLat).toEqual([36.8, 0]);
  });

  it('describes each pin by its plate and state', () => {
    setup({ markers: [BELAGAVI, vehicle('d2', 16, 74, { tone: 'stopped' })] });
    expect(markerFor('d1').element.getAttribute('aria-label')).toBe('D1 · Moving');
    expect(markerFor('d2').element.getAttribute('aria-label')).toBe('D2 · Stopped');
  });

  it('highlights the selected pin', () => {
    const { rerender } = setup({ markers: [BELAGAVI, KOLHAPUR] });
    const dot = (id: string) => markerFor(id).element.children[1] as HTMLElement;
    expect(dot('d1').style.transform).toBe('');

    rerender({ markers: [BELAGAVI, KOLHAPUR], selectedId: 'd1' });
    expect(dot('d1').style.transform).toBe('scale(1.2)');
    expect(dot('d2').style.transform).toBe('');
  });
});

describe('selecting a vehicle on the map', () => {
  it('reports the vehicle that was clicked', () => {
    const { onSelect } = setup({ markers: [BELAGAVI, KOLHAPUR] });
    fireEvent.click(markerFor('d2').element);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('d2');
  });

  it('works from the keyboard', () => {
    const { onSelect } = setup({ markers: [BELAGAVI] });
    fireEvent.keyDown(markerFor('d1').element, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('d1');
  });

  it('calls the current handler, not the one from when the pin was created', () => {
    // The old Mapbox code captured onSelect at creation. Selecting then used a stale copy of the
    // URL parameters and quietly dropped whatever filter had been chosen since.
    const { rerender, onSelect } = setup({ markers: [BELAGAVI] });
    const latest = vi.fn();
    rerender({ markers: [BELAGAVI], onSelect: latest });

    fireEvent.click(markerFor('d1').element);

    expect(latest).toHaveBeenCalledExactlyOnceWith('d1');
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('framing the fleet', () => {
  it('frames every vehicle once, as soon as the map is ready', () => {
    setup({ markers: [BELAGAVI, KOLHAPUR] });
    expect(currentMap().callsTo('fitBounds')).toHaveLength(0);

    finishLoading();

    const [call] = currentMap().callsTo('fitBounds');
    expect(call!.args[0]).toEqual([
      [74.243, 15.85],
      [74.498, 16.705],
    ]);
    expect(call!.args[1]).toMatchObject({ padding: { top: 60, right: 60, bottom: 60, left: 60 }, maxZoom: 13 });
  });

  it('never frames again on later updates, so panning and zooming stay put', () => {
    const { rerender } = setup({ markers: [BELAGAVI, KOLHAPUR] });
    finishLoading();

    rerender({ markers: [vehicle('d1', 16.0, 74.4), vehicle('d2', 17.0, 75.0)] });
    rerender({ markers: [vehicle('d1', 16.1, 74.3), vehicle('d2', 17.1, 75.1), vehicle('d3', 12.97, 77.59)] });

    expect(currentMap().callsTo('fitBounds')).toHaveLength(1);
    expect(currentMap().callsTo('easeTo')).toHaveLength(0);
  });

  it('waits for the first positions, then frames once', () => {
    const { rerender } = setup({ markers: [] });
    finishLoading();
    expect(currentMap().callsTo('fitBounds')).toHaveLength(0);

    rerender({ markers: [vehicle('none', 0, 0, { tone: 'none' })] });
    expect(currentMap().callsTo('fitBounds')).toHaveLength(0);

    rerender({ markers: [BELAGAVI, KOLHAPUR] });
    rerender({ markers: [BELAGAVI] });
    expect(currentMap().callsTo('fitBounds')).toHaveLength(1);
  });

  it('does not frame before the map is ready, however many vehicles there are', () => {
    const { rerender } = setup({ markers: [BELAGAVI] });
    rerender({ markers: [BELAGAVI, KOLHAPUR] });
    expect(currentMap().calls).toHaveLength(0);
  });

  it('centres on a lone vehicle at a regional zoom, instead of zooming in as far as it can', () => {
    setup({ markers: [BELAGAVI] });
    finishLoading();

    expect(currentMap().callsTo('fitBounds')).toHaveLength(0);
    const [call] = currentMap().callsTo('easeTo');
    expect(call!.args[0]).toMatchObject({ center: [74.498, 15.85], zoom: 11 });
  });

  it('treats vehicles parked at the same spot as one place', () => {
    setup({ markers: [BELAGAVI, vehicle('d2', 15.85, 74.498)] });
    finishLoading();
    expect(currentMap().callsTo('fitBounds')).toHaveLength(0);
    expect(currentMap().callsTo('easeTo')).toHaveLength(1);
  });

  it('keeps the framing clear of the driver panel on the left', () => {
    setup({ markers: [BELAGAVI, KOLHAPUR], focusInsetLeft: 352 });
    finishLoading();
    expect(currentMap().callsTo('fitBounds')[0]!.args[1]).toMatchObject({ padding: { left: 60 + 352, right: 60 } });
  });

  it('keeps a lone vehicle clear of the panel too', () => {
    setup({ markers: [BELAGAVI], focusInsetLeft: 352 });
    finishLoading();
    expect(currentMap().callsTo('easeTo')[0]!.args[0]).toMatchObject({ offset: [176, 0] });
  });
});

describe('the fit-to-vehicles control', () => {
  const fitButton = () => {
    const element = (currentMap().controls[2]!.control as { onAdd: () => HTMLElement }).onAdd();
    return element.querySelector('button') as HTMLButtonElement;
  };

  it('is a labelled button', () => {
    setup({ markers: [BELAGAVI] });
    expect(fitButton().getAttribute('aria-label')).toBe('Fit to vehicles');
    expect(fitButton().title).toBe('Fit to vehicles');
  });

  it('returns to the whole fleet after the office has panned away', () => {
    setup({ markers: [BELAGAVI, KOLHAPUR] });
    finishLoading();
    const before = currentMap().callsTo('fitBounds').length;

    fitButton().click();

    expect(currentMap().callsTo('fitBounds')).toHaveLength(before + 1);
  });

  it('focuses on the selected vehicle when there is one', () => {
    setup({ markers: [BELAGAVI, KOLHAPUR], selectedId: 'd2' });
    finishLoading();

    fitButton().click();

    const easeCalls = currentMap().callsTo('easeTo');
    expect(easeCalls.at(-1)!.args[0]).toMatchObject({ center: [74.243, 16.705], zoom: 11 });
  });

  it('is removed with the map, not left behind in the page', () => {
    const { unmount } = setup({ markers: [BELAGAVI] });
    const control = currentMap().controls[2]!.control as { onAdd: () => HTMLElement; onRemove: () => void };
    const element = control.onAdd();
    document.body.append(element);
    control.onRemove();
    expect(document.body.contains(element)).toBe(false);
    unmount();
  });
});

describe('bringing a selected vehicle into view', () => {
  it('pans to a newly selected vehicle that is off-screen, and leaves the zoom alone', () => {
    const { rerender } = setup({ markers: [BELAGAVI] });
    currentMap().projectImpl = () => ({ x: -200, y: 300 });

    rerender({ markers: [BELAGAVI], selectedId: 'd1' });

    const [call] = currentMap().callsTo('easeTo');
    expect(call!.args[0]).toMatchObject({ center: [74.498, 15.85], offset: [0, 0] });
    expect(call!.args[0]).not.toHaveProperty('zoom');
  });

  it('does not pan when the selected vehicle is already comfortably in view', () => {
    const { rerender } = setup({ markers: [BELAGAVI] });
    currentMap().projectImpl = () => ({ x: 500, y: 300 });
    rerender({ markers: [BELAGAVI], selectedId: 'd1' });
    expect(currentMap().callsTo('easeTo')).toHaveLength(0);
  });

  it('treats a vehicle at the very edge as out of view', () => {
    const { rerender } = setup({ markers: [BELAGAVI] });
    currentMap().projectImpl = () => ({ x: 990, y: 300 }); // a 1000 px wide map: 10 px from the right edge
    rerender({ markers: [BELAGAVI], selectedId: 'd1' });
    expect(currentMap().callsTo('easeTo')).toHaveLength(1);
  });

  it('brings a vehicle out from behind the driver panel, and nudges clear ones not at all', () => {
    const { rerender } = setup({ markers: [BELAGAVI, KOLHAPUR], focusInsetLeft: 352 });
    currentMap().projectImpl = ([lng]) => ({ x: lng === 74.498 ? 200 : 700, y: 300 });

    rerender({ markers: [BELAGAVI, KOLHAPUR], focusInsetLeft: 352, selectedId: 'd1' });
    expect(currentMap().callsTo('easeTo')).toHaveLength(1);
    expect(currentMap().callsTo('easeTo')[0]!.args[0]).toMatchObject({ center: [74.498, 15.85], offset: [176, 0] });

    rerender({ markers: [BELAGAVI, KOLHAPUR], focusInsetLeft: 352, selectedId: 'd2' });
    expect(currentMap().callsTo('easeTo')).toHaveLength(1);
  });

  it('does not re-centre on every data refresh while a vehicle stays selected', () => {
    // The old behaviour: a poll every few seconds flew the map back to the selected driver,
    // undoing whatever panning the office had done in between.
    const { rerender } = setup({ markers: [BELAGAVI] });
    currentMap().projectImpl = () => ({ x: -200, y: 300 });
    rerender({ markers: [BELAGAVI], selectedId: 'd1' });
    expect(currentMap().callsTo('easeTo')).toHaveLength(1);

    rerender({ markers: [vehicle('d1', 15.9, 74.5)], selectedId: 'd1' });
    rerender({ markers: [vehicle('d1', 16.0, 74.6)], selectedId: 'd1' });
    rerender({ markers: [vehicle('d1', 16.1, 74.7)], selectedId: 'd1' });

    expect(currentMap().callsTo('easeTo')).toHaveLength(1);
  });

  it('does nothing for a selected driver who has no position to go to', () => {
    const { rerender } = setup({ markers: [vehicle('d9', 0, 0, { tone: 'none' })] });
    rerender({ markers: [vehicle('d9', 0, 0, { tone: 'none' })], selectedId: 'd9' });
    expect(currentMap().calls).toHaveLength(0);
  });

  it('does nothing for a selection that is not in the list', () => {
    const { rerender } = setup({ markers: [BELAGAVI] });
    rerender({ markers: [BELAGAVI], selectedId: 'ghost' });
    expect(currentMap().calls).toHaveLength(0);
  });
});

describe('plates by zoom', () => {
  const shown = (id: string) => plateOf(id).style.display !== 'none';

  it('hides plates at regional zoom, where they would pile up, and shows them zoomed in', () => {
    setup({ markers: [BELAGAVI, KOLHAPUR] });
    expect(shown('d1')).toBe(false);
    expect(shown('d2')).toBe(false);

    act(() => currentMap().setZoom(10));
    expect(shown('d1')).toBe(true);
    expect(shown('d2')).toBe(true);

    act(() => currentMap().setZoom(8));
    expect(shown('d1')).toBe(false);
  });

  it('always shows the plate of the selected vehicle', () => {
    setup({ markers: [BELAGAVI, KOLHAPUR], selectedId: 'd1' });
    expect(shown('d1')).toBe(true);
    expect(shown('d2')).toBe(false);
  });

  it('always shows the plate of a vehicle with an alert', () => {
    setup({ markers: [vehicle('d1', 15.85, 74.498, { flagged: true })] });
    expect(shown('d1')).toBe(true);
  });
});

describe('reporting the map’s status', () => {
  it('is ready only once MapLibre says it has loaded', () => {
    const { onStatusChange } = setup();
    expect(onStatusChange).not.toHaveBeenCalled();

    act(() => currentMap().fire('style.load'));
    expect(onStatusChange).not.toHaveBeenCalled();

    act(() => currentMap().fire('load'));
    expect(statuses(onStatusChange)).toEqual(['ready']);
  });

  it('is an error when the style cannot be fetched, and says why in the log without echoing a key', () => {
    const { onStatusChange } = setup({ styleUrl: `${STYLE}?key=SECRET-KEY` });

    act(() =>
      currentMap().fire('error', {
        error: { message: `AJAXError: Not Found (404): ${STYLE}?key=SECRET-KEY`, status: 404, url: `${STYLE}?key=SECRET-KEY` },
      }),
    );

    expect(lastStatus(onStatusChange)).toEqual({ state: 'error', reason: 'style' });
    expect(errorLog).toHaveBeenCalledOnce();
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).toContain('404');
    expect(logged).toContain(STYLE);
    expect(logged).not.toContain('SECRET-KEY');
  });

  it('is an error when the style is not valid JSON', () => {
    const { onStatusChange } = setup();
    act(() => currentMap().fire('error', { error: { message: 'Unexpected token \'<\', "<!doctype "... is not valid JSON' } }));
    expect(lastStatus(onStatusChange)).toEqual({ state: 'error', reason: 'style' });
  });

  it('is an error when a source’s own definition cannot be read, even though the style loaded', () => {
    const { onStatusChange } = setup();
    act(() => currentMap().fire('style.load'));
    act(() => currentMap().fire('error', { sourceId: 'openmaptiles', error: { message: 'Failed to fetch', status: 0, url: 'https://tiles.example.com/planet' } }));
    expect(lastStatus(onStatusChange)).toEqual({ state: 'error', reason: 'style' });
  });

  it('is not an error when a single tile fails: the map still draws, with a gap', () => {
    const { onStatusChange } = setup();
    act(() => currentMap().fire('style.load'));
    act(() => currentMap().fire('error', { sourceId: 'openmaptiles', tile: {}, error: { message: 'Failed to fetch', status: 0, url: 'https://tiles.example.com/7/90/58.pbf' } }));
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(warnLog).toHaveBeenCalledOnce();

    act(() => currentMap().fire('load'));
    expect(statuses(onStatusChange)).toEqual(['ready']);
  });

  it('is not an error when a sprite or glyph fails, which belongs to no source', () => {
    const { onStatusChange } = setup();
    act(() => currentMap().fire('style.load'));
    act(() => currentMap().fire('error', { error: { message: 'Failed to fetch', status: 0, url: 'https://tiles.example.com/sprites/ofm.png' } }));
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('is not an error when something fails after the map has loaded', () => {
    const { onStatusChange } = setup();
    finishLoading();
    act(() => currentMap().fire('error', { error: { message: 'Not Found (404)', status: 404, url: STYLE } }));
    act(() => currentMap().fire('error', { sourceId: 'openmaptiles', error: { message: 'boom' } }));
    expect(statuses(onStatusChange)).toEqual(['ready']);
  });

  it('is an error when the web worker will not start, since nothing can be drawn without it', () => {
    const { onStatusChange } = setup();
    act(() => currentMap().fire('style.load'));
    act(() => currentMap().fire('error', { error: { message: 'Worker failed to load. Check that the worker URL is correct.' } }));
    expect(lastStatus(onStatusChange)).toEqual({ state: 'error', reason: 'init' });
  });

  it('is an error when MapLibre cannot start at all, as when WebGL is unavailable', () => {
    FakeMap.constructorError = new Error('Failed to initialize WebGL');
    const { onStatusChange } = setup({ markers: [BELAGAVI] });

    expect(lastStatus(onStatusChange)).toEqual({ state: 'error', reason: 'init' });
    expect(errorLog).toHaveBeenCalled();
    expect(FakeMap.instances).toHaveLength(0);
    // No map, so no pins either: nothing is drawn to look as though it were live.
    expect(FakeMarker.instances).toHaveLength(0);
  });

  it('logs only the first few resource failures, however many tiles fail', () => {
    setup();
    act(() => currentMap().fire('style.load'));
    for (let i = 0; i < 40; i += 1) {
      act(() => currentMap().fire('error', { sourceId: 'v', tile: {}, error: { message: `Failed to fetch ${i}` } }));
    }
    expect(warnLog).toHaveBeenCalledTimes(5);
  });

  it('keeps a style error final: a later load does not make a broken map look fine', () => {
    const { onStatusChange } = setup();
    act(() => currentMap().fire('error', { error: { message: 'Not Found (404)', status: 404 } }));
    act(() => currentMap().fire('load'));
    expect(statuses(onStatusChange)).toEqual(['error']);
  });
});

describe('a map that never finishes loading', () => {
  const setHidden = (hidden: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });

  afterEach(() => {
    // Remove the instance override so the prototype’s own `hidden` shows through again.
    Reflect.deleteProperty(document, 'hidden');
  });

  it('is declared stuck after thirty seconds of visible waiting', () => {
    vi.useFakeTimers();
    const { onStatusChange } = setup();

    act(() => vi.advanceTimersByTime(29_000));
    expect(onStatusChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_000));
    expect(lastStatus(onStatusChange)).toEqual({ state: 'error', reason: 'timeout' });
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it('does not count time spent in a background tab, where MapLibre paints nothing', () => {
    vi.useFakeTimers();
    const { onStatusChange } = setup();

    setHidden(true);
    act(() => vi.advanceTimersByTime(120_000));
    expect(onStatusChange).not.toHaveBeenCalled();

    // Back in front: the clock resumes from where it stopped, not from zero and not from the end.
    setHidden(false);
    act(() => vi.advanceTimersByTime(29_000));
    expect(onStatusChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_000));
    expect(lastStatus(onStatusChange)).toEqual({ state: 'error', reason: 'timeout' });
  });

  it('recovers if the map does finish loading after being declared stuck', () => {
    vi.useFakeTimers();
    const { onStatusChange } = setup({ markers: [BELAGAVI, KOLHAPUR] });
    act(() => vi.advanceTimersByTime(30_000));
    expect(lastStatus(onStatusChange)).toEqual({ state: 'error', reason: 'timeout' });

    finishLoading();

    expect(statuses(onStatusChange)).toEqual(['error', 'ready']);
    // And the fleet is still framed once, now that there is a map to frame it on.
    expect(currentMap().callsTo('fitBounds')).toHaveLength(1);
  });

  it('stops waiting once the map has loaded', () => {
    vi.useFakeTimers();
    const { onStatusChange } = setup();
    finishLoading();
    act(() => vi.advanceTimersByTime(120_000));
    expect(statuses(onStatusChange)).toEqual(['ready']);
  });

  it('stops waiting when the map is torn down', () => {
    vi.useFakeTimers();
    const { onStatusChange, unmount } = setup();
    unmount();
    act(() => vi.advanceTimersByTime(120_000));
    expect(onStatusChange).not.toHaveBeenCalled();
  });
});
