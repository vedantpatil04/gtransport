import { vi } from 'vitest';

/**
 * A stand-in for maplibre-gl, used everywhere in the test suite (see setup.ts).
 *
 * Real MapLibre needs WebGL, which jsdom does not have, so these tests are about *our* behaviour
 * around the map: how often it is created, what it is told, what it does when it fails. They record
 * every construction, camera call and marker coordinate so that can be asserted. Whether tiles
 * actually draw is a different question, answered by running the app in a browser.
 */

type Handler = (event: Record<string, unknown>) => void;

export class FakeMap {
  static instances: FakeMap[] = [];
  /** Set to make the next constructions throw, as MapLibre does when WebGL is unavailable. */
  static constructorError: Error | null = null;

  readonly options: Record<string, unknown>;
  readonly container: HTMLElement;
  readonly controls: { control: unknown; position?: string }[] = [];
  readonly calls: { method: string; args: unknown[] }[] = [];
  readonly keyboard = { disableRotation: vi.fn() };
  readonly touchZoomRotate = { disableRotation: vi.fn() };
  removed = false;
  zoom: number;
  /** Where `project` puts a coordinate. Tests replace it to put a marker on, or off, the screen. */
  projectImpl: (lngLat: [number, number]) => { x: number; y: number } = () => ({ x: 600, y: 300 });
  private readonly handlers = new Map<string, Handler[]>();

  constructor(options: Record<string, unknown>) {
    if (FakeMap.constructorError) throw FakeMap.constructorError;
    this.options = options;
    this.container = options.container as HTMLElement;
    this.zoom = (options.zoom as number | undefined) ?? 0;
    // jsdom has no layout; give the map a plausible viewport.
    Object.defineProperty(this.container, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(this.container, 'clientHeight', { value: 600, configurable: true });
    FakeMap.instances.push(this);
  }

  on(type: string, handler: Handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
    return { unsubscribe: () => {} };
  }

  /** Emit an event the way MapLibre would. Wrap in act() when it should reach React state. */
  fire(type: string, event: Record<string, unknown> = {}) {
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler({ type, ...event });
  }

  addControl(control: unknown, position?: string) {
    this.controls.push({ control, position });
    return this;
  }

  getZoom() {
    return this.zoom;
  }
  /** Test helper: change zoom and tell listeners, as a user zooming would. */
  setZoom(zoom: number) {
    this.zoom = zoom;
    this.fire('zoom');
  }
  getContainer() {
    return this.container;
  }
  project(lngLat: [number, number]) {
    return this.projectImpl(lngLat);
  }
  fitBounds(...args: unknown[]) {
    this.calls.push({ method: 'fitBounds', args });
    return this;
  }
  easeTo(...args: unknown[]) {
    this.calls.push({ method: 'easeTo', args });
    return this;
  }
  jumpTo(...args: unknown[]) {
    this.calls.push({ method: 'jumpTo', args });
    return this;
  }
  remove() {
    this.removed = true;
  }

  callsTo(method: string) {
    return this.calls.filter((call) => call.method === method);
  }
}

export class FakeMarker {
  static instances: FakeMarker[] = [];

  readonly element: HTMLElement;
  readonly options: Record<string, unknown>;
  lngLat: [number, number] | null = null;
  map: FakeMap | null = null;
  removed = false;
  setLngLatCalls = 0;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    this.element = options.element as HTMLElement;
    FakeMarker.instances.push(this);
  }

  setLngLat(lngLat: [number, number]) {
    this.lngLat = [lngLat[0], lngLat[1]];
    this.setLngLatCalls += 1;
    return this;
  }
  getLngLat() {
    return { lng: this.lngLat![0], lat: this.lngLat![1] };
  }
  addTo(map: FakeMap) {
    this.map = map;
    map.container.append(this.element);
    return this;
  }
  remove() {
    this.removed = true;
    this.element.remove();
    return this;
  }
}

export class NavigationControl {
  constructor(readonly options?: Record<string, unknown>) {}
}

export class FullscreenControl {
  constructor(readonly options?: Record<string, unknown>) {}
}

export const setWorkerUrl = vi.fn();

export { FakeMap as Map, FakeMarker as Marker };

export function resetFakeMaplibre() {
  FakeMap.instances = [];
  FakeMap.constructorError = null;
  FakeMarker.instances = [];
  setWorkerUrl.mockClear();
}

/** The most recent map the app created. */
export const currentMap = () => {
  const map = FakeMap.instances.at(-1);
  if (!map) throw new Error('no map has been created');
  return map;
};

/** The live (not removed) pin for a driver, found by its coordinate-bearing marker element. */
export const markerFor = (id: string) => {
  const marker = [...FakeMarker.instances].reverse().find((candidate) => !candidate.removed && candidate.element.getAttribute('data-testid') === `fleet-marker-${id}`);
  if (!marker) throw new Error(`no live marker for ${id}`);
  return marker;
};
