import {
  AttributionControl,
  Map as MapGL,
  Marker as MapMarker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppText, Card } from '../../components/ui';
import type { OfficeFleetLocation } from '../../lib/api/office';
import { colors, radius, spacing } from '../../theme/tokens';
import { loggableUrl, resolveMapStyle } from './map-style';
import { cameraTarget, fleetStatus, TONE_COLOR, validPosition, type Coordinate } from './model';

// In Metro/Expo Web, MapLibre's default worker resolution (relative to bundle URL) fails.
// Point setWorkerUrl to the same-origin static worker asset served from /maplibre/.
if (typeof window !== 'undefined') {
  setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
}

const MAP_HEIGHT = 280;
const FIT_PADDING = 48;
const SINGLE_VEHICLE_ZOOM = 12;
const STYLE_TIMEOUT_MS = 30_000;

function ensureMapLibreCss(): void {
  if (typeof document === 'undefined') return;
  const id = 'maplibre-gl-css';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = '/maplibre/maplibre-gl.css';
  link.onerror = () => {
    link.href = 'https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.css';
  };
  document.head.appendChild(link);
}

export interface FleetMapProps {
  rows: OfficeFleetLocation[];
  selectedId: string | null;
  onSelect: (driverId: string) => void;
  frameKey: string;
}

export function FleetMap(props: FleetMapProps) {
  const config = useMemo(() => resolveMapStyle(), []);

  useEffect(() => {
    if (config.status === 'ready') return;
    console.error(
      config.reason === 'missing'
        ? '[fleet-map-web] EXPO_PUBLIC_MAP_STYLE_URL is not set, so the Live Fleet map cannot be drawn.'
        : '[fleet-map-web] EXPO_PUBLIC_MAP_STYLE_URL is not a usable MapLibre style URL (expected an absolute http(s) URL).',
    );
  }, [config]);

  if (config.status !== 'ready') {
    return (
      <Card style={styles.container} testID="fleet-map-config-error">
        <View style={[styles.frame, styles.centered]}>
          <AppText style={styles.problemTitle}>Map configuration is unavailable.</AppText>
          <AppText variant="label" tone="muted" style={styles.problemBody}>
            The driver list, details and Google Maps links below still work.
          </AppText>
        </View>
      </Card>
    );
  }

  return <WebLiveMap {...props} styleUrl={config.styleUrl} />;
}

type LoadState = 'loading' | 'ready' | 'error';

interface Plotted {
  row: OfficeFleetLocation;
  coordinate: Coordinate;
}

function WebLiveMap({ rows, selectedId, onSelect, frameKey, styleUrl }: FleetMapProps & { styleUrl: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapGL | null>(null);
  const markersRef = useRef<Map<string, MapMarker>>(new Map());

  const plotted = useMemo<Plotted[]>(
    () =>
      rows.flatMap((row) => {
        const coordinate = validPosition(row);
        return coordinate ? [{ row, coordinate }] : [];
      }),
    [rows],
  );
  const points = useMemo(() => plotted.map((p) => p.coordinate), [plotted]);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const frame = useCallback((animated: boolean) => {
    const map = mapRef.current;
    if (!map) return false;
    const target = cameraTarget(pointsRef.current);
    if (!target) return false;
    const duration = animated ? 600 : 0;
    try {
      if (target.kind === 'center') {
        map.easeTo({ center: target.center, zoom: SINGLE_VEHICLE_ZOOM, duration });
      } else {
        const [w, s, e, n] = target.bounds;
        map.fitBounds(
          [
            [w, s],
            [e, n],
          ],
          { padding: FIT_PADDING, duration },
        );
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  // Initialize MapLibre on web
  useEffect(() => {
    ensureMapLibreCss();
    if (typeof window === 'undefined' || !containerRef.current) return;

    setLoadState('loading');
    const initialTarget = cameraTarget(pointsRef.current);
    const initialCenter = initialTarget
      ? initialTarget.kind === 'center'
        ? initialTarget.center
        : [(initialTarget.bounds[0] + initialTarget.bounds[2]) / 2, (initialTarget.bounds[1] + initialTarget.bounds[3]) / 2]
      : [74.5, 16.5];

    let activeMap: MapGL | null = null;
    try {
      const mapInstance = new MapGL({
        container: containerRef.current,
        style: styleUrl,
        center: initialCenter as [number, number],
        zoom: initialTarget ? SINGLE_VEHICLE_ZOOM : 7,
        attributionControl: false,
      });

      mapInstance.addControl(new AttributionControl({ compact: true }), 'bottom-right');
      mapInstance.addControl(new NavigationControl({ showCompass: true, showZoom: true }), 'top-right');

      mapInstance.on('load', () => {
        setLoadState('ready');
        frame(false);
      });

      mapInstance.on('error', (e) => {
        if (e.error && (e.error.message?.includes('style') || !mapInstance.isStyleLoaded())) {
          console.warn(`[fleet-map-web] Map style failed: ${loggableUrl(styleUrl)}`);
          setLoadState('error');
        }
      });

      activeMap = mapInstance;
      mapRef.current = mapInstance;
    } catch (err) {
      console.warn('[fleet-map-web] Map creation error:', err);
      setLoadState('error');
    }

    const timeout = setTimeout(() => {
      if (!activeMap?.isStyleLoaded()) {
        console.warn(`[fleet-map-web] Style timeout: ${loggableUrl(styleUrl)}`);
        setLoadState('error');
      }
    }, STYLE_TIMEOUT_MS);

    return () => {
      clearTimeout(timeout);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      if (activeMap) {
        try {
          activeMap.remove();
        } catch {
          // Ignore removal errors
        }
      }
      mapRef.current = null;
    };
  }, [styleUrl, attempt, frame]);

  // Update markers on web map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || loadState !== 'ready') return;

    const currentMarkers = markersRef.current;
    const activeDriverIds = new Set<string>();

    plotted.forEach(({ row, coordinate }) => {
      activeDriverIds.add(row.driverId);
      const isSelected = row.driverId === selectedId;
      const status = fleetStatus(row);
      const color = TONE_COLOR[status.tone];
      const label = row.vehicle?.registrationNumber ?? row.driverCode;

      let marker = currentMarkers.get(row.driverId);
      if (!marker) {
        const el = document.createElement('div');
        el.className = 'fleet-web-marker';
        el.style.width = '28px';
        el.style.height = '28px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = color;
        el.style.border = isSelected ? '3px solid #FFFFFF' : '2px solid rgba(255, 255, 255, 0.9)';
        el.style.boxShadow = isSelected
          ? '0 0 0 3px #0284C7, 0 4px 8px rgba(0,0,0,0.35)'
          : '0 2px 6px rgba(0,0,0,0.25)';
        el.style.cursor = 'pointer';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.title = `${label} (${status.label})`;

        const inner = document.createElement('div');
        inner.style.width = '10px';
        inner.style.height = '10px';
        inner.style.borderRadius = '50%';
        inner.style.backgroundColor = '#FFFFFF';
        el.appendChild(inner);

        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onSelect(row.driverId);
        });

        marker = new MapMarker({ element: el })
          .setLngLat([coordinate.longitude, coordinate.latitude])
          .addTo(map);

        currentMarkers.set(row.driverId, marker);
      } else {
        marker.setLngLat([coordinate.longitude, coordinate.latitude]);
        const el = marker.getElement();
        el.style.backgroundColor = color;
        el.style.border = isSelected ? '3px solid #FFFFFF' : '2px solid rgba(255, 255, 255, 0.9)';
        el.style.boxShadow = isSelected
          ? '0 0 0 3px #0284C7, 0 4px 8px rgba(0,0,0,0.35)'
          : '0 2px 6px rgba(0,0,0,0.25)';
      }
    });

    // Remove markers that are no longer in plotted list
    currentMarkers.forEach((marker, driverId) => {
      if (!activeDriverIds.has(driverId) && marker) {
        marker.remove();
        currentMarkers.delete(driverId);
      }
    });
  }, [plotted, selectedId, loadState, onSelect]);

  // Re-frame camera on frameKey change
  const lastFrameKey = useRef(frameKey);
  useEffect(() => {
    if (lastFrameKey.current === frameKey) return;
    lastFrameKey.current = frameKey;
    if (loadState === 'ready') frame(true);
  }, [frameKey, loadState, frame]);

  const retry = () => {
    setLoadState('loading');
    setAttempt((n) => n + 1);
  };

  return (
    <Card style={styles.container} testID="fleet-map">
      <View style={styles.frame}>
        {/* DOM Canvas container for MapLibre */}
        <div
          ref={containerRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            height: '100%',
          }}
        />

        {loadState === 'loading' && (
          <View style={[StyleSheet.absoluteFill, styles.centered, styles.veil]} pointerEvents="none" testID="fleet-map-loading">
            <ActivityIndicator color={colors.primary} />
            <AppText variant="label" tone="muted" style={{ marginTop: spacing.xs }}>
              Loading map…
            </AppText>
          </View>
        )}

        {loadState === 'error' && (
          <View style={[StyleSheet.absoluteFill, styles.centered, styles.veilSolid]} testID="fleet-map-error">
            <AppText style={styles.problemTitle}>The map could not be loaded.</AppText>
            <AppText variant="label" tone="muted" style={styles.problemBody}>
              Check the connection. The driver list below is unaffected.
            </AppText>
            <Pressable accessibilityRole="button" onPress={retry} style={styles.retry} testID="fleet-map-retry">
              <AppText tone="inverse" style={{ fontWeight: '700' }}>
                Retry map
              </AppText>
            </Pressable>
          </View>
        )}

        {loadState === 'ready' && plotted.length === 0 && (
          <View style={styles.notice} pointerEvents="none" testID="fleet-map-no-positions">
            <AppText variant="label" style={{ fontWeight: '700' }}>
              {rows.length === 0 ? 'No drivers in this view' : 'Location unavailable'}
            </AppText>
            {rows.length > 0 && (
              <AppText variant="label" tone="muted">
                No driver in this view has reported a position.
              </AppText>
            )}
          </View>
        )}

        {plotted.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fit map to vehicles"
            onPress={() => {
              frame(true);
            }}
            style={styles.fit}
            testID="fleet-map-fit"
          >
            <Text style={styles.fitIcon}>⌖</Text>
          </Pressable>
        )}

        <View style={styles.legend} pointerEvents="none">
          <LegendDot color={TONE_COLOR.success} label="Moving" />
          <LegendDot color={TONE_COLOR.warning} label="Stopped/Stale" />
          <LegendDot color={TONE_COLOR.danger} label="Offline/Alert" />
        </View>
      </View>
    </Card>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <AppText variant="label" tone="muted" style={styles.legendLabel}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 0,
    overflow: 'hidden',
  },
  frame: {
    height: MAP_HEIGHT,
    backgroundColor: '#0F172A',
    position: 'relative',
    overflow: 'hidden',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  veil: {
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  veilSolid: {
    backgroundColor: '#0F172A',
  },
  problemTitle: {
    fontWeight: '700',
    color: '#F8FAFC',
    textAlign: 'center',
  },
  problemBody: {
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: 280,
  },
  retry: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  notice: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  fit: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  fitIcon: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '700',
  },
  legend: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 10,
  },
});
