import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FullscreenControl, Map as MapGL, Marker, NavigationControl, setWorkerUrl, type ErrorEvent, type IControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 looks for its web worker beside the module that imported it, which a bundler's hashed
// output never preserves — in dev or in production. Bundling the worker ourselves and handing over
// its URL is the supported way around that; without it the style loads and no tile ever draws.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { cn } from '@/lib/utils';
import { createMarkerView, type MarkerView } from './markerView';
import { isPlottable, loggableUrl, scrubQueryStrings, type MapMarker, type MapStatus } from './provider';

setWorkerUrl(workerUrl);

/** Western Maharashtra to Belagavi, where the fleet works. Shown until there is something to fit to. */
const DEFAULT_CENTER: [number, number] = [74.5, 16.5];
const DEFAULT_ZOOM = 7;
const FIT_PADDING = 60;
/** Two vehicles in one depot must not zoom the map in to street level. */
const FIT_MAX_ZOOM = 13;
const SINGLE_PLACE_ZOOM = 11;
/** Plates are drawn from here up. Below it a regional view would be a pile of overlapping labels. */
const LABEL_MIN_ZOOM = 9;
/** How close to an edge a selected vehicle may sit before the map pans to it. */
const EDGE_MARGIN = 48;
/** Visible seconds after which a map that has neither loaded nor failed is declared stuck. */
const STYLE_TIMEOUT_MS = 30_000;
/** Individual tile failures can number in the dozens; the first few say everything useful. */
const MAX_RESOURCE_WARNINGS = 5;

export interface MapLibreMapProps {
  styleUrl: string;
  markers: MapMarker[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onStatusChange: (status: MapStatus) => void;
  /**
   * Pixels on the left edge that something else (the driver panel) covers. A vehicle selected while
   * off-screen is brought into the clear part of the map, not in behind that panel.
   */
  focusInsetLeft?: number;
  className?: string;
  /** Overlays — legend, status messages — drawn over the map and carried with it into fullscreen. */
  children?: ReactNode;
}

interface Pin {
  marker: Marker;
  view: MarkerView;
  latitude: number;
  longitude: number;
}

const CROSSHAIR =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>';

/** "Fit to vehicles": the way back after panning away, without a refresh. */
class FitControl implements IControl {
  private container: HTMLElement | null = null;

  constructor(
    private readonly label: string,
    private readonly onFit: () => void,
  ) {}

  onAdd(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const button = document.createElement('button');
    button.type = 'button';
    button.title = this.label;
    button.setAttribute('aria-label', this.label);
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.innerHTML = CROSSHAIR;
    button.addEventListener('click', this.onFit);
    container.append(button);
    this.container = container;
    return container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
  }
}

/**
 * Frames the given vehicles. Returns false when none of them has a position to frame.
 *
 * Padding keeps pins off the map's edges, and off the driver panel on its left.
 */
function fitToMarkers(map: MapGL, markers: MapMarker[], insetLeft: number, duration: number): boolean {
  const points = markers.filter(isPlottable);
  if (!points.length) return false;

  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const point of points) {
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
  }

  if (west === east && south === north) {
    // One place — a single vehicle, or several parked together. fitBounds would zoom in as far as
    // it is allowed; a regional zoom keeps the nearby city and highway in view.
    map.easeTo({ center: [west, south], zoom: SINGLE_PLACE_ZOOM, offset: [insetLeft / 2, 0], duration });
  } else {
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: { top: FIT_PADDING, right: FIT_PADDING, bottom: FIT_PADDING, left: FIT_PADDING + insetLeft }, maxZoom: FIT_MAX_ZOOM, duration },
    );
  }
  return true;
}

/**
 * The fleet on a MapLibre map.
 *
 * The map instance is created once per style and lives until the component unmounts. Everything
 * that changes after that — the vehicles, the selection, the language — reaches it through
 * refs and a reconcile step, never by rebuilding the map: a poll that moves one vehicle moves one
 * pin. The camera is framed once, when the first positions arrive, and never again unprompted, so
 * panning and zooming stay where the office left them.
 *
 * Whether the map is usable is reported through `onStatusChange`, and only ever truthfully: it is
 * "ready" once MapLibre says the style has loaded, "error" when the style, its sources or the
 * renderer fail to come up, and there is no substitute drawing in between.
 */
export function MapLibreMap({ styleUrl, markers, selectedId, onSelect, onStatusChange, focusInsetLeft = 0, className, children }: MapLibreMapProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapGL | null>(null);
  const pinsRef = useRef(new Map<string, Pin>());
  const loadedRef = useRef(false);
  const fittedRef = useRef(false);
  const labelsOnRef = useRef(false);

  // The latest props, for the handlers that are created once with the map and outlive any render.
  const latest = useRef({ markers, selectedId, onSelect, onStatusChange, focusInsetLeft, t });
  latest.current = { markers, selectedId, onSelect, onStatusChange, focusInsetLeft, t };

  /** Brings the pins in line with the latest markers: add, move and repaint what changed, drop the rest. */
  const syncPins = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const { markers: current, selectedId: selected, t: translate } = latest.current;
    const pins = pinsRef.current;
    const seen = new Set<string>();

    for (const marker of current) {
      if (!isPlottable(marker)) continue;
      seen.add(marker.id);

      let pin = pins.get(marker.id);
      if (!pin) {
        const view = createMarkerView(marker.id, () => latest.current.onSelect(marker.id));
        pin = {
          marker: new Marker({ element: view.element, anchor: 'center' }).setLngLat([marker.longitude, marker.latitude]).addTo(map),
          view,
          latitude: marker.latitude,
          longitude: marker.longitude,
        };
        pins.set(marker.id, pin);
      } else if (pin.latitude !== marker.latitude || pin.longitude !== marker.longitude) {
        pin.marker.setLngLat([marker.longitude, marker.latitude]);
        pin.latitude = marker.latitude;
        pin.longitude = marker.longitude;
      }

      const state = translate(`enum.motion.${marker.tone}`);
      pin.view.update(marker, {
        selected: marker.id === selected,
        showLabel: labelsOnRef.current,
        description: marker.label ? `${marker.label} · ${state}` : state,
      });
    }

    for (const [id, pin] of pins) {
      if (seen.has(id)) continue;
      pin.marker.remove();
      pins.delete(id);
    }
  }, []);

  /** The one automatic framing: as soon as the map is ready and there is something to frame. */
  const fitOnce = useCallback(() => {
    const map = mapRef.current;
    if (!map || fittedRef.current || !loadedRef.current) return;
    const { markers: current, focusInsetLeft: inset } = latest.current;
    if (fitToMarkers(map, current, inset, 800)) fittedRef.current = true;
  }, []);

  // Create the map once per style; tear it all down on unmount.
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    let disposed = false;
    let loaded = false;
    let failure: 'init' | 'style' | 'timeout' | null = null;
    let styleLoaded = false;
    let waitedMs = 0;
    let warnings = 0;
    const report = (status: MapStatus) => {
      if (!disposed) latest.current.onStatusChange(status);
    };

    // Control labels are set once, with the map. `t` is deliberately not a dependency: a language
    // switch repaints the pins (below) but does not rebuild the map for the sake of a tooltip.
    let map: MapGL;
    try {
      map = new MapGL({
        container,
        style: styleUrl,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: { compact: true },
        // A fleet map is north-up: the heading arrows assume it, and a tilted map helps nobody here.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
        locale: {
          'Map.Title': t('map.label'),
          'NavigationControl.ZoomIn': t('map.zoomIn'),
          'NavigationControl.ZoomOut': t('map.zoomOut'),
          'FullscreenControl.Enter': t('map.fullscreen'),
          'FullscreenControl.Exit': t('map.exitFullscreen'),
        },
      });
    } catch (error) {
      // No WebGL, or MapLibre otherwise refused to start. Say so; there is no other renderer.
      console.error('[fleet-map] MapLibre could not start', error);
      report({ state: 'error', reason: 'init' });
      return;
    }

    map.keyboard.disableRotation();
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new FullscreenControl({ container: rootRef.current ?? undefined }), 'top-right');
    map.addControl(
      new FitControl(t('map.fit'), () => {
        const { markers: current, selectedId: selected, focusInsetLeft: inset } = latest.current;
        const target = current.filter((marker) => marker.id === selected && isPlottable(marker));
        fitToMarkers(map, target.length ? target : current, inset, 600);
      }),
      'top-right',
    );

    mapRef.current = map;
    loadedRef.current = false;
    fittedRef.current = false;
    labelsOnRef.current = map.getZoom() >= LABEL_MIN_ZOOM;

    // 'init' and 'style' are final. A timeout is only a verdict on slowness, so `load` can overturn it.
    const fail = (reason: 'init' | 'style' | 'timeout', detail: Record<string, unknown>) => {
      if (loaded || disposed || failure === 'init' || failure === 'style' || failure === reason) return;
      failure = reason;
      window.clearInterval(clock);
      console.error(`[fleet-map] the map could not be loaded (${reason})`, { style: loggableUrl(styleUrl), ...detail });
      report({ state: 'error', reason });
    };

    // MapLibre finishes loading only while frames are being painted, and a hidden tab paints none.
    // So the clock runs only while the page is visible; otherwise a Live Fleet opened in a background
    // tab would be declared failed before anyone had looked at it.
    const clock = window.setInterval(() => {
      if (document.hidden) return;
      waitedMs += 1_000;
      if (waitedMs >= STYLE_TIMEOUT_MS) fail('timeout', { waitedMs });
    }, 1_000);

    map.on('style.load', () => {
      styleLoaded = true;
    });

    map.on('load', () => {
      if (disposed || failure === 'init' || failure === 'style') return;
      loaded = true;
      loadedRef.current = true;
      failure = null;
      window.clearInterval(clock);
      report({ state: 'ready' });
      fitOnce();
    });

    map.on('error', (event) => {
      const { error, sourceId, tile } = event as ErrorEvent & { sourceId?: string; tile?: unknown };
      const problem = error as { message?: string; status?: number; url?: string };
      const detail = { message: scrubQueryStrings(problem.message), status: problem.status, url: problem.url ? loggableUrl(problem.url) : undefined, sourceId };

      // Nothing can be drawn if the web worker will not start, if the style itself could not be
      // read, or if a source's own definition could not. One tile, glyph or sprite failing — before
      // or after load — is not that: the map still draws, just with a gap.
      if (!loaded && /worker/i.test(problem.message ?? '')) return fail('init', detail);
      if (!loaded && !tile && (!styleLoaded || sourceId !== undefined)) return fail('style', detail);
      if (warnings++ < MAX_RESOURCE_WARNINGS) console.warn('[fleet-map] a map resource failed to load', detail);
    });

    // Plates come and go with the zoom; only the crossing of the threshold matters.
    map.on('zoom', () => {
      const on = map.getZoom() >= LABEL_MIN_ZOOM;
      if (on === labelsOnRef.current) return;
      labelsOnRef.current = on;
      syncPins();
    });

    syncPins();

    return () => {
      disposed = true;
      window.clearInterval(clock);
      for (const pin of pinsRef.current.values()) pin.marker.remove();
      pinsRef.current.clear();
      mapRef.current = null;
      loadedRef.current = false;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl, fitOnce, syncPins]);

  // Vehicles, selection or language changed: reconcile the pins, and frame the fleet if this is the first fix.
  useEffect(() => {
    syncPins();
    fitOnce();
  }, [markers, selectedId, t, syncPins, fitOnce]);

  // A newly selected vehicle that is off-screen, or behind the driver panel, is brought into view.
  // Zoom is left alone, and a poll that merely refreshes the markers never gets here.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const { markers: current, focusInsetLeft: inset } = latest.current;
    const marker = current.find((candidate) => candidate.id === selectedId);
    if (!marker || !isPlottable(marker)) return;

    const container = map.getContainer();
    const point = map.project([marker.longitude, marker.latitude]);
    const clear =
      point.x > inset + EDGE_MARGIN && point.x < container.clientWidth - EDGE_MARGIN && point.y > EDGE_MARGIN && point.y < container.clientHeight - EDGE_MARGIN;
    if (!clear) map.easeTo({ center: [marker.longitude, marker.latitude], offset: [inset / 2, 0], duration: 600 });
    // Keyed on the selection alone, by design: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return (
    <div ref={rootRef} className={cn('relative isolate overflow-hidden bg-muted', className)} data-testid="fleet-map">
      {/* Positioned inline on purpose. MapLibre's stylesheet gives its container `position: relative`,
          which beats a utility class and collapses the map to zero height inside this wrapper. */}
      <div ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
      {children}
    </div>
  );
}
