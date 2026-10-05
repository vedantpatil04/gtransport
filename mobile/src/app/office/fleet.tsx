import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppText, Card, EmptyView, Loading, Plate } from '../../components/ui';
import { FleetMap } from '../../features/fleet/FleetMap';
import {
  countByFilter,
  FLEET_FILTERS,
  fleetStatus,
  googleMapsUrl,
  hoursAndMinutes,
  matchesFilter,
  TONE_COLOR,
  validPosition,
  type FleetFilter,
} from '../../features/fleet/model';
import {
  DASH,
  LoadError,
  ModuleGuard,
  OfficeScreen,
  officeStyles,
  Pill,
  useDebounced,
  useOfficeData,
} from '../../features/office/ui';
import { officeApi, type OfficeFleetLocation, type OfficeLocationPing } from '../../lib/api/office';
import { useSession } from '../../lib/auth/session-store';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

function relTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const diffMs = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${Math.max(1, secs)}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Speed only from a current fix: an old reading is not the vehicle's speed now. */
function currentSpeed(row: OfficeFleetLocation): number | null {
  const speed = row.position?.speedKmh;
  return speed !== null && speed !== undefined && !row.stale && row.status !== 'STALE' ? Math.round(speed) : null;
}

/** Detail sheet for one driver, kept current by the parent as each poll lands. */
function DriverDetailModal({
  driver,
  onClose,
  onAcknowledged,
}: {
  driver: OfficeFleetLocation | null;
  onClose: () => void;
  onAcknowledged: () => void;
}) {
  const token = useSession((s) => s.token);
  const [history, setHistory] = useState<OfficeLocationPing[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [ackFailed, setAckFailed] = useState(false);

  const driverId = driver?.driverId ?? null;
  const capturedAt = driver?.capturedAt ?? null;

  // Refetched when a different driver opens or a newer fix arrives — not on every poll.
  useEffect(() => {
    if (!driverId || !token) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    setLoadingHistory(true);
    officeApi
      .driverHistory(token, driverId, { limit: 5 })
      .then((res) => {
        if (!cancelled) setHistory(res.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [driverId, capturedAt, token]);

  useEffect(() => setAckFailed(false), [driverId]);

  if (!driver) return null;

  const status = fleetStatus(driver);
  const position = validPosition(driver);
  const hasAlert = driver.alert?.status === 'ACTIVE';
  const speed = currentSpeed(driver);

  const handleAcknowledge = async () => {
    if (!token || !driver.alert || acknowledging) return;
    setAcknowledging(true);
    setAckFailed(false);
    try {
      await officeApi.acknowledgeAlert(token, driver.alert.id, 'Acknowledged from mobile');
      onAcknowledged();
    } catch {
      setAckFailed(true);
    } finally {
      setAcknowledging(false);
    }
  };

  const openGoogleMaps = () => {
    if (!position) return;
    void Linking.openURL(googleMapsUrl(position)).catch(() => undefined);
  };

  const callPhone = () => {
    if (!driver.employee.phone) return;
    void Linking.openURL(`tel:${driver.employee.phone}`).catch(() => undefined);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet} testID="fleet-driver-detail">
          {/* Header */}
          <View style={modalStyles.headerRow}>
            <View style={{ flex: 1 }}>
              <AppText variant="h2">{driver.employee.fullName}</AppText>
              <AppText variant="label" tone="muted">
                {driver.employee.employeeCode} · {driver.driverCode}
              </AppText>
            </View>
            <Pressable onPress={onClose} style={modalStyles.closeBtn} accessibilityLabel="Close" testID="fleet-detail-close">
              <AppText variant="h2" tone="muted">✕</AppText>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.sm }}>
            {/* Status & Vehicle */}
            <View style={officeStyles.row}>
              {driver.vehicle ? (
                <Plate reg={driver.vehicle.registrationNumber} size="sm" />
              ) : (
                <AppText tone="muted">No vehicle</AppText>
              )}
              <Pill label={status.label} tone={status.tone} />
            </View>

            {/* Stationary Alert Warning */}
            {hasAlert && (
              <Card style={modalStyles.alertCard} testID="fleet-detail-alert">
                <AppText variant="h2" tone="danger">⚠️ Stationary Alert</AppText>
                <AppText style={{ marginTop: 2 }}>
                  Vehicle stationary for {hoursAndMinutes(driver.alert?.durationMinutes ?? 0)}.
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void handleAcknowledge()}
                  disabled={acknowledging}
                  style={modalStyles.ackBtn}
                  testID="fleet-acknowledge"
                >
                  <AppText tone="inverse" style={{ fontWeight: '700' }}>
                    {acknowledging ? 'Acknowledging…' : 'Acknowledge Alert'}
                  </AppText>
                </Pressable>
                {ackFailed && (
                  <AppText variant="label" tone="danger" testID="fleet-acknowledge-error">
                    Could not acknowledge the alert. Try again.
                  </AppText>
                )}
              </Card>
            )}

            {/* Metrics */}
            <View style={officeStyles.grid}>
              <View style={officeStyles.half}>
                <Card style={{ padding: spacing.md }}>
                  <AppText variant="label" tone="muted">Speed</AppText>
                  <AppText variant="figure">{speed !== null ? `${speed} km/h` : DASH}</AppText>
                </Card>
              </View>
              <View style={officeStyles.half}>
                <Card style={{ padding: spacing.md }}>
                  <AppText variant="label" tone="muted">Last Updated</AppText>
                  <AppText variant="figure" style={{ fontSize: 16 }} testID="fleet-detail-last-updated">
                    {relTime(driver.capturedAt || driver.lastSeenAt)}
                  </AppText>
                </Card>
              </View>
            </View>

            {/* Position Coordinates */}
            {position ? (
              <Card style={{ padding: spacing.md }}>
                <AppText variant="label" tone="muted">Coordinates</AppText>
                <AppText style={{ fontWeight: '600', marginTop: 2 }} testID="fleet-detail-coordinates">
                  {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
                </AppText>
                {driver.position?.accuracyMeters !== null && driver.position?.accuracyMeters !== undefined && (
                  <AppText variant="label" tone="muted">
                    Accuracy: ±{Math.round(driver.position.accuracyMeters)}m
                  </AppText>
                )}
              </Card>
            ) : (
              <Card style={{ padding: spacing.md }} testID="fleet-detail-location-unavailable">
                <AppText variant="label" tone="muted">Coordinates</AppText>
                <AppText style={{ fontWeight: '600', marginTop: 2 }}>Location unavailable</AppText>
              </Card>
            )}

            {/* Recent Location Pings */}
            <View style={{ gap: spacing.xs }}>
              <AppText variant="label" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Recent Pings
              </AppText>
              {loadingHistory && history.length === 0 ? (
                <AppText tone="muted">Loading fixes…</AppText>
              ) : history.length === 0 ? (
                <AppText tone="muted">No recent fixes recorded</AppText>
              ) : (
                history.map((ping) => (
                  <View key={ping.id} style={modalStyles.pingRow} testID={`fleet-ping-${ping.id}`}>
                    <AppText variant="label">
                      {ping.latitude.toFixed(4)}, {ping.longitude.toFixed(4)}
                    </AppText>
                    <AppText variant="label" tone="muted">
                      {relTime(ping.capturedAt)}
                    </AppText>
                  </View>
                ))
              )}
            </View>

            {/* External Actions */}
            <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
              {position && (
                <Pressable
                  accessibilityRole="button"
                  onPress={openGoogleMaps}
                  style={modalStyles.actionBtn}
                  testID="fleet-open-google-maps"
                >
                  <AppText style={modalStyles.actionBtnText}>🗺️ Open in Google Maps</AppText>
                </Pressable>
              )}

              {driver.employee.phone && (
                <Pressable
                  accessibilityRole="button"
                  onPress={callPhone}
                  style={modalStyles.actionBtn}
                  testID="fleet-call-driver"
                >
                  <AppText style={modalStyles.actionBtnText}>📞 Call {driver.employee.phone}</AppText>
                </Pressable>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function OfficeFleetBody() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<FleetFilter>('all');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query.trim());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Each response remembers the search it answers, so the map re-frames when those results land —
  // not when the text changes and the previous results are still on screen.
  const fleet = useOfficeData(
    useCallback(
      async (tok: string) => ({ q: debouncedQuery, response: await officeApi.fleet(tok, { q: debouncedQuery || undefined }) }),
      [debouncedQuery],
    ),
    [debouncedQuery],
  );

  // Polls at the interval the server asks for.
  const refreshInterval = fleet.data?.response.refreshSeconds ?? 30;
  const reload = fleet.reload;
  useEffect(() => {
    const timer = setInterval(() => {
      void reload();
    }, Math.max(10, refreshInterval) * 1000);
    return () => clearInterval(timer);
  }, [refreshInterval, reload]);

  const rows = useMemo(() => fleet.data?.response.data ?? [], [fleet.data]);
  const counts = useMemo(() => countByFilter(rows), [rows]);
  const filtered = useMemo(() => rows.filter((r) => matchesFilter(r, filter)), [rows, filter]);
  // The selection is an id; the row shown is always the latest one the server sent.
  const selectedDriver = selectedId ? (rows.find((r) => r.driverId === selectedId) ?? null) : null;

  return (
    <OfficeScreen
      title={t('office.nav.fleet', { defaultValue: 'Live Fleet' })}
      subtitle={fleet.data ? `${counts.active} active of ${counts.all} drivers` : undefined}
      onRefresh={() => void fleet.reload()}
      refreshing={fleet.refreshing}
      testID="office-fleet"
    >
      {/* Alert Banner */}
      {counts.alerting > 0 && (
        <Pressable onPress={() => setFilter('alerting')}>
          <Card style={screenStyles.alertBanner} testID="fleet-alert-banner">
            <AppText tone="danger" style={{ fontWeight: '700' }}>
              ⚠️ {counts.alerting} driver(s) stationary for over 4 hours
            </AppText>
          </Card>
        </Pressable>
      )}

      {/* Map: drawn once there is a real fleet response to place on it. */}
      {fleet.data && (
        <FleetMap
          rows={filtered}
          selectedId={selectedId}
          onSelect={setSelectedId}
          frameKey={`${filter}|${fleet.data.q}`}
        />
      )}

      {/* Search Input */}
      <TextInput
        style={officeStyles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search driver, vehicle or code"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        accessibilityLabel="Search drivers"
        testID="fleet-search-input"
      />

      {/* Filter Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={screenStyles.filterRow}>
        {FLEET_FILTERS.map((f) => (
          <Pressable
            key={f}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f }}
            onPress={() => setFilter(f)}
            style={[screenStyles.filterChip, filter === f && screenStyles.filterChipActive]}
            testID={`fleet-filter-${f}`}
          >
            <AppText variant="label" style={[screenStyles.filterText, filter === f && screenStyles.filterTextActive]}>
              {f.toUpperCase()} ({counts[f]})
            </AppText>
          </Pressable>
        ))}
      </ScrollView>

      {/* Errors & Loading */}
      {fleet.error && <LoadError error={fleet.error} onRetry={() => void fleet.reload()} />}
      {fleet.loading && !fleet.data ? (
        <Loading />
      ) : !fleet.data ? null : rows.length === 0 ? (
        <EmptyView
          title={debouncedQuery ? 'No matching drivers' : 'No drivers reporting'}
          hint={debouncedQuery ? undefined : 'Drivers appear here once their app reports a location.'}
        />
      ) : filtered.length === 0 ? (
        <EmptyView title="No drivers in this view" />
      ) : (
        /* Driver Rows */
        filtered.map((driver) => {
          const status = fleetStatus(driver);
          const speed = currentSpeed(driver);
          const located = validPosition(driver) !== null;

          return (
            <Pressable
              key={driver.driverId}
              accessibilityRole="button"
              onPress={() => setSelectedId(driver.driverId)}
              style={({ pressed }) => [pressed && { opacity: 0.85 }]}
              testID={`fleet-driver-${driver.driverId}`}
            >
              <Card style={screenStyles.driverCard}>
                <View style={officeStyles.row}>
                  <View style={[screenStyles.statusIndicator, { backgroundColor: TONE_COLOR[status.tone] }]} />
                  <View style={officeStyles.grow}>
                    <View style={officeStyles.row}>
                      <AppText style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>
                        {driver.employee.fullName}
                      </AppText>
                      {driver.vehicle ? <Plate reg={driver.vehicle.registrationNumber} size="sm" /> : null}
                    </View>

                    <View style={[officeStyles.row, { marginTop: 4 }]}>
                      <AppText variant="label" tone="muted" testID={`fleet-driver-status-${driver.driverId}`}>
                        {status.label} · {driver.driverCode}
                        {speed !== null ? ` · ${speed} km/h` : ''}
                      </AppText>
                      <AppText variant="label" tone="muted">
                        · {relTime(driver.capturedAt || driver.lastSeenAt)}
                      </AppText>
                    </View>

                    {!located && (
                      <AppText variant="label" tone="muted" style={{ marginTop: 2 }} testID={`fleet-driver-no-location-${driver.driverId}`}>
                        Location unavailable
                      </AppText>
                    )}
                  </View>
                </View>

                {driver.alert?.status === 'ACTIVE' && (
                  <View style={[screenStyles.subAlertBadge, { marginTop: 8 }]}>
                    <AppText variant="label" tone="danger" style={{ fontWeight: '700' }}>
                      ⚠️ Stationary {hoursAndMinutes(driver.alert.durationMinutes)}
                    </AppText>
                  </View>
                )}
              </Card>
            </Pressable>
          );
        })
      )}

      {/* Detailed Driver Modal */}
      <DriverDetailModal
        driver={selectedDriver}
        onClose={() => setSelectedId(null)}
        onAcknowledged={() => {
          setSelectedId(null);
          void fleet.reload();
        }}
      />
    </OfficeScreen>
  );
}

export default function OfficeFleet() {
  return (
    <ModuleGuard module="fleet">
      <OfficeFleetBody />
    </ModuleGuard>
  );
}

const screenStyles = StyleSheet.create({
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    fontWeight: '700',
    fontSize: 11,
    color: colors.mutedForeground,
  },
  filterTextActive: {
    color: colors.primaryForeground,
  },
  alertBanner: {
    backgroundColor: '#FEF2F2',
    borderColor: '#F87171',
  },
  driverCard: {
    gap: 4,
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  subAlertBadge: {
    backgroundColor: '#FEF2F2',
    padding: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: '85%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  alertCard: {
    backgroundColor: '#FEF2F2',
    borderColor: '#F87171',
    gap: spacing.xs,
  },
  ackBtn: {
    backgroundColor: '#DC2626',
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  pingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  actionBtn: {
    minHeight: TOUCH_TARGET,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  actionBtnText: {
    fontWeight: '600',
    color: colors.foreground,
  },
});
