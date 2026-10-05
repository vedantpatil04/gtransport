import type { CameraRef, InitialViewState } from '@maplibre/maplibre-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppText, Card } from '../../components/ui';
import type { OfficeFleetLocation } from '../../lib/api/office';
import { colors, radius, spacing } from '../../theme/tokens';
import { loggableUrl, resolveMapStyle } from './map-style';
import { cameraTarget, fleetStatus, TONE_COLOR, validPosition, type Coordinate } from './model';

type MapLibreType = typeof import('@maplibre/maplibre-react-native');
let MapLibre: MapLibreType | null = null;
try {
  MapLibre = require('@maplibre/maplibre-react-native');
} catch (e) {
  console.warn('[fleet-map] MapLibre native module unavailable in this environment:', e);
}

/**
 * The office Live Fleet map: native MapLibre drawing real map tiles, with one marker per driver at
 * the latitude and longitude the server reported.
 *
 * It is a convenience, not the record. The list below it answers every operational question, so a
 * map that cannot draw says so — with a retry — and never stands in a drawing of the region. Rows
 * without a usable position get no marker at all.
 */

const MAP_HEIGHT = 280;
const DOT_SIZE = 24;
const FIT_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };
const SINGLE_VEHICLE_ZOOM = 12;
const CAMERA_ANIMATION_MS = 600;
/** A style that has neither loaded nor failed by now is declared stuck rather than spinning forever. */
const STYLE_TIMEOUT_MS = 30_000;

export interface FleetMapProps {
  /** The drivers in view — already filtered and searched. Each is drawn only if it has a real position. */
  rows: OfficeFleetLocation[];
  selectedId: string | null;
  onSelect: (driverId: string) => void;
  /**
   * Changes when the office changes *what* is shown (filter, search). The camera re-frames then —
   * never on a poll, so a refresh moves markers and leaves the view where the user put it.
   */
  frameKey: string;
}

export function FleetMap(props: FleetMapProps) {
  const { t } = useTranslation();
  // Build-time configuration: it cannot change while the app is open.
  const config = useMemo(() => resolveMapStyle(), []);

  useEffect(() => {
    if (config.status === 'ready') return;
    console.error(
      config.reason === 'missing'
        ? '[fleet-map] EXPO_PUBLIC_MAP_STYLE_URL is not set, so the Live Fleet map cannot be drawn.'
        : '[fleet-map] EXPO_PUBLIC_MAP_STYLE_URL is not a usable MapLibre style URL (expected an absolute http(s) URL).',
    );
  }, [config]);

  if (!MapLibre) {
    return (
      <Card style={styles.container} testID="fleet-map-native-unavailable">
        <View style={[styles.frame, styles.centered]}>
          <AppText style={styles.problemTitle}>{t('office.map.nativeUnavailable')}</AppText>
          <AppText variant="label" tone="muted" style={styles.problemBody}>
            {t('office.map.listStillWorks')}
          </AppText>
        </View>
      </Card>
    );
  }

  if (config.status !== 'ready') {
    return (
      <Card style={styles.container} testID="fleet-map-config-error">
        <View style={[styles.frame, styles.centered]}>
          <AppText style={styles.problemTitle}>{t('office.map.configUnavailable')}</AppText>
          <AppText variant="label" tone="muted" style={styles.problemBody}>
            {t('office.map.listStillWorks')}
          </AppText>
        </View>
      </Card>
    );
  }

  return <LiveMap {...props} styleUrl={config.styleUrl} />;
}

type LoadState = 'loading' | 'ready' | 'error';

interface Plotted {
  row: OfficeFleetLocation;
  coordinate: Coordinate;
}

function viewFor(points: Coordinate[]): InitialViewState | undefined {
  const target = cameraTarget(points);
  if (!target) return undefined;
  return target.kind === 'center'
    ? { center: target.center, zoom: SINGLE_VEHICLE_ZOOM }
    : { bounds: target.bounds, padding: FIT_PADDING };
}

function LiveMap({ rows, selectedId, onSelect, frameKey, styleUrl }: FleetMapProps & { styleUrl: string }) {
  const { t } = useTranslation();
  if (!MapLibre) return null;
  const { Map: MapLibreMap, Camera } = MapLibre;
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const cameraRef = useRef<CameraRef>(null);

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

  // The first view is set before the map draws, so opening Fleet never animates from somewhere else.
  // With no reported position there is nothing to frame, and the camera is left at the style's own.
  const [initialViewState] = useState(() => viewFor(points));
  const framed = useRef(initialViewState !== undefined);

  const frame = useCallback((animated: boolean) => {
    const target = cameraTarget(pointsRef.current);
    if (!target || !cameraRef.current) return false;
    const duration = animated ? CAMERA_ANIMATION_MS : 0;
    try {
      if (target.kind === 'center') {
        cameraRef.current.easeTo({ center: target.center, zoom: SINGLE_VEHICLE_ZOOM, duration });
      } else {
        cameraRef.current.fitBounds(target.bounds, { padding: FIT_PADDING, duration });
      }
      return true;
    } catch {
      // The native camera is not attached yet; the next frame request will try again.
      return false;
    }
  }, []);

  // A different selection of drivers: show them. Skipped on mount, which initialViewState covered.
  const lastFrameKey = useRef(frameKey);
  useEffect(() => {
    if (lastFrameKey.current === frameKey) return;
    lastFrameKey.current = frameKey;
    framed.current = frame(true);
  }, [frameKey, frame]);

  // Nobody had a position when Fleet opened and somebody now does: frame them, once.
  useEffect(() => {
    if (!framed.current && points.length > 0) framed.current = frame(true);
  }, [points, frame]);

  useEffect(() => {
    if (loadState !== 'loading') return;
    const timer = setTimeout(() => {
      console.warn(`[fleet-map] Map style did not load within ${STYLE_TIMEOUT_MS / 1000}s: ${loggableUrl(styleUrl)}`);
      setLoadState('error');
    }, STYLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loadState, styleUrl, attempt]);

  const retry = () => {
    setLoadState('loading');
    setAttempt((n) => n + 1);
  };

  return (
    <Card style={styles.container} testID="fleet-map">
      <View style={styles.frame}>
        <MapLibreMap
          // A new key is a new native map: the one retry that cannot inherit whatever broke the last.
          key={attempt}
          testID="fleet-map-view"
          style={StyleSheet.absoluteFill}
          mapStyle={styleUrl}
          // A TextureView scrolls and clips like any other view inside the Fleet screen's ScrollView.
          androidView="texture"
          logo={false}
          attribution
          attributionPosition={{ bottom: 8, right: 8 }}
          compass
          touchPitch={false}
          onDidFinishLoadingStyle={() => setLoadState('ready')}
          onDidFailLoadingMap={() => {
            console.warn(`[fleet-map] Map style failed to load: ${loggableUrl(styleUrl)}`);
            setLoadState('error');
          }}
        >
          <Camera ref={cameraRef} initialViewState={initialViewState} />
          {plotted.map(({ row, coordinate }) => (
            <DriverMarker
              key={row.driverId}
              row={row}
              coordinate={coordinate}
              selected={row.driverId === selectedId}
              onPress={onSelect}
            />
          ))}
        </MapLibreMap>

        {loadState === 'loading' && (
          <View style={[StyleSheet.absoluteFill, styles.centered, styles.veil]} pointerEvents="none" testID="fleet-map-loading">
            <ActivityIndicator color={colors.primary} />
            <AppText variant="label" tone="muted" style={{ marginTop: spacing.xs }}>{t('office.map.loading')}</AppText>
          </View>
        )}

        {loadState === 'error' && (
          <View style={[StyleSheet.absoluteFill, styles.centered, styles.veilSolid]} testID="fleet-map-error">
            <AppText style={styles.problemTitle}>{t('office.map.loadFailed')}</AppText>
            <AppText variant="label" tone="muted" style={styles.problemBody}>
              {t('office.map.loadFailedBody')}
            </AppText>
            <Pressable accessibilityRole="button" onPress={retry} style={styles.retry} testID="fleet-map-retry">
              <AppText tone="inverse" style={{ fontWeight: '700' }}>{t('office.map.retry')}</AppText>
            </Pressable>
          </View>
        )}

        {loadState === 'ready' && plotted.length === 0 && (
          <View style={styles.notice} pointerEvents="none" testID="fleet-map-no-positions">
            <AppText variant="label" style={{ fontWeight: '700' }}>
              {rows.length === 0 ? t('office.map.noDrivers') : t('office.map.noPosition')}
            </AppText>
            {rows.length > 0 && (
              <AppText variant="label" tone="muted">{t('office.map.noPositionBody')}</AppText>
            )}
          </View>
        )}

        {plotted.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('office.map.fit')}
            onPress={() => {
              framed.current = frame(true);
            }}
            style={styles.fit}
            testID="fleet-map-fit"
          >
            <Text style={styles.fitIcon}>⌖</Text>
          </Pressable>
        )}

        <View style={styles.legend} pointerEvents="none">
          <LegendDot color={TONE_COLOR.success} label={t('office.map.legend.moving')} />
          <LegendDot color={TONE_COLOR.warning} label={t('office.map.legend.stopped')} />
          <LegendDot color={TONE_COLOR.danger} label={t('office.map.legend.alert')} />
        </View>
      </View>
    </Card>
  );
}

function DriverMarker({
  row,
  coordinate,
  selected,
  onPress,
}: {
  row: OfficeFleetLocation;
  coordinate: Coordinate;
  selected: boolean;
  onPress: (driverId: string) => void;
}) {
  const { t } = useTranslation();
  const status = fleetStatus(row);
  const color = TONE_COLOR[status.tone];
  const label = row.vehicle?.registrationNumber ?? row.driverCode;
  const Marker = MapLibre?.Marker;
  if (!Marker) return null;

  return (
    <Marker
      id={`driver-${row.driverId}`}
      lngLat={[coordinate.longitude, coordinate.latitude]}
      // Top-centre, raised by half the dot: the dot's centre sits exactly on the reported position.
      anchor="top"
      offset={[0, -DOT_SIZE / 2]}
      onPress={() => onPress(row.driverId)}
    >
      <View
        style={styles.marker}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${row.employee.fullName}, ${label}, ${t(status.labelKey)}`}
        testID={`fleet-marker-${row.driverId}`}
      >
        <View style={[styles.dotRing, { borderColor: color }, selected && styles.dotRingSelected]}>
          <View style={[styles.dotCore, { backgroundColor: color }]} />
        </View>
        <View style={[styles.tag, status.key === 'alerting' && styles.tagAlert, selected && styles.tagSelected]}>
          <Text numberOfLines={1} style={styles.tagText}>
            {label}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  frame: {
    height: MAP_HEIGHT,
    backgroundColor: colors.muted,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  veil: {
    backgroundColor: 'rgba(242, 244, 247, 0.6)',
  },
  veilSolid: {
    backgroundColor: colors.muted,
  },
  problemTitle: {
    fontWeight: '700',
    textAlign: 'center',
  },
  problemBody: {
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  retry: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  notice: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    right: 56,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  fit: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  fitIcon: {
    fontSize: 22,
    color: colors.foreground,
  },
  legend: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 10,
    color: colors.foreground,
  },
  marker: {
    alignItems: 'center',
  },
  dotRing: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  dotRingSelected: {
    borderWidth: 4,
  },
  dotCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  tag: {
    marginTop: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
    maxWidth: 140,
  },
  tagAlert: {
    backgroundColor: colors.danger,
  },
  tagSelected: {
    backgroundColor: colors.primary,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#F8FAFC',
  },
});
