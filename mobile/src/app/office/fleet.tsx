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
import { relativeTime } from '../../lib/relative';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

/** Speed only from a current fix: an old reading is not the vehicle's speed now. */
function currentSpeed(row: OfficeFleetLocation): number | null {
  const speed = row.position?.speedKmh;
  return speed !== null && speed !== undefined && !row.stale && row.status !== 'STALE' ? Math.round(speed) : null;
}

/** "5 h 5 min" in the reader's language. */
function useDuration() {
  const { t } = useTranslation();
  return (totalMinutes: number) => t('office.fleet.duration', hoursAndMinutes(totalMinutes));
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
  const { t } = useTranslation();
  const duration = useDuration();
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
      // Stored on the alert as the office's note (data, not interface text).
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
          <View style={modalStyles.headerRow}>
            <View style={{ flex: 1 }}>
              <AppText variant="h2">{driver.employee.fullName}</AppText>
              <AppText variant="label" tone="muted">
                {driver.employee.employeeCode} · {driver.driverCode}
              </AppText>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={modalStyles.closeBtn} accessibilityLabel={t('common.close')} testID="fleet-detail-close">
              <AppText variant="h2" tone="muted">✕</AppText>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.sm }}>
            <View style={officeStyles.row}>
              {driver.vehicle ? <Plate reg={driver.vehicle.registrationNumber} size="sm" /> : <AppText tone="muted">{t('office.fleet.noVehicle')}</AppText>}
              <Pill label={t(status.labelKey)} tone={status.tone} />
            </View>

            {hasAlert && (
              <Card style={modalStyles.alertCard} testID="fleet-detail-alert">
                <AppText variant="h2" tone="danger">{t('office.fleet.stationaryAlert')}</AppText>
                <AppText style={{ marginTop: 2 }}>{t('office.fleet.stationaryFor', { duration: duration(driver.alert?.durationMinutes ?? 0) })}</AppText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void handleAcknowledge()}
                  disabled={acknowledging}
                  style={[modalStyles.ackBtn, acknowledging && { opacity: 0.6 }]}
                  testID="fleet-acknowledge"
                >
                  <AppText tone="inverse" style={{ fontWeight: '700' }}>
                    {acknowledging ? t('office.fleet.acknowledging') : t('office.fleet.acknowledge')}
                  </AppText>
                </Pressable>
                {ackFailed && (
                  <AppText variant="label" tone="danger" testID="fleet-acknowledge-error">
                    {t('office.fleet.ackFailed')}
                  </AppText>
                )}
              </Card>
            )}

            <View style={officeStyles.grid}>
              <View style={officeStyles.half}>
                <Card style={{ padding: spacing.md }}>
                  <AppText variant="label" tone="muted">{t('office.fleet.speed')}</AppText>
                  <AppText variant="figure">{speed !== null ? t('office.fleet.speedValue', { speed }) : DASH}</AppText>
                </Card>
              </View>
              <View style={officeStyles.half}>
                <Card style={{ padding: spacing.md }}>
                  <AppText variant="label" tone="muted">{t('office.fleet.lastUpdated')}</AppText>
                  <AppText variant="figure" style={{ fontSize: 16 }} testID="fleet-detail-last-updated">
                    {relativeTime(driver.capturedAt || driver.lastSeenAt, t)}
                  </AppText>
                </Card>
              </View>
            </View>

            {position ? (
              <Card style={{ padding: spacing.md }}>
                <AppText variant="label" tone="muted">{t('office.fleet.coordinates')}</AppText>
                <AppText style={{ fontWeight: '600', marginTop: 2 }} testID="fleet-detail-coordinates">
                  {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
                </AppText>
                {driver.position?.accuracyMeters !== null && driver.position?.accuracyMeters !== undefined && (
                  <AppText variant="label" tone="muted">
                    {t('office.fleet.accuracy', { metres: Math.round(driver.position.accuracyMeters) })}
                  </AppText>
                )}
              </Card>
            ) : (
              <Card style={{ padding: spacing.md }} testID="fleet-detail-location-unavailable">
                <AppText variant="label" tone="muted">{t('office.fleet.coordinates')}</AppText>
                <AppText style={{ fontWeight: '600', marginTop: 2 }}>{t('office.fleet.noLocation')}</AppText>
              </Card>
            )}

            <View style={{ gap: spacing.xs }}>
              <AppText variant="label" tone="muted" style={modalStyles.sectionLabel}>
                {t('office.fleet.recentFixes')}
              </AppText>
              {loadingHistory && history.length === 0 ? (
                <AppText tone="muted">{t('office.fleet.loadingFixes')}</AppText>
              ) : history.length === 0 ? (
                <AppText tone="muted">{t('office.fleet.noFixes')}</AppText>
              ) : (
                history.map((ping) => (
                  <View key={ping.id} style={modalStyles.pingRow} testID={`fleet-ping-${ping.id}`}>
                    <AppText variant="label">
                      {ping.latitude.toFixed(4)}, {ping.longitude.toFixed(4)}
                    </AppText>
                    <AppText variant="label" tone="muted">
                      {relativeTime(ping.capturedAt, t)}
                    </AppText>
                  </View>
                ))
              )}
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
              {position && (
                <Pressable accessibilityRole="button" onPress={openGoogleMaps} style={modalStyles.actionBtn} testID="fleet-open-google-maps">
                  <AppText style={modalStyles.actionBtnText}>{t('office.fleet.openGoogleMaps')}</AppText>
                </Pressable>
              )}

              {driver.employee.phone && (
                <Pressable accessibilityRole="button" onPress={callPhone} style={modalStyles.actionBtn} testID="fleet-call-driver">
                  <AppText style={modalStyles.actionBtnText}>{t('office.fleet.call', { phone: driver.employee.phone })}</AppText>
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
  const duration = useDuration();
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
      title={t('office.nav.fleet')}
      subtitle={fleet.data ? t('office.fleet.subtitle', { active: counts.active, total: counts.all }) : undefined}
      onRefresh={() => void fleet.reload()}
      refreshing={fleet.refreshing}
      testID="office-fleet"
    >
      {counts.alerting > 0 && (
        <Pressable accessibilityRole="button" onPress={() => setFilter('alerting')}>
          <Card style={screenStyles.alertBanner} testID="fleet-alert-banner">
            <AppText tone="danger" style={{ fontWeight: '700' }}>
              {t('office.fleet.alertBanner', { count: counts.alerting })}
            </AppText>
          </Card>
        </Pressable>
      )}

      {/* Map: drawn once there is a real fleet response to place on it. */}
      {fleet.data && <FleetMap rows={filtered} selectedId={selectedId} onSelect={setSelectedId} frameKey={`${filter}|${fleet.data.q}`} />}

      <TextInput
        style={officeStyles.search}
        value={query}
        onChangeText={setQuery}
        placeholder={t('office.fleet.search')}
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        accessibilityLabel={t('office.fleet.search')}
        testID="fleet-search-input"
      />

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
              {`${t(`office.fleet.filter.${f}`)} (${counts[f]})`}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>

      {fleet.error && <LoadError error={fleet.error} onRetry={() => void fleet.reload()} />}
      {fleet.loading && !fleet.data ? (
        <Loading />
      ) : !fleet.data ? null : rows.length === 0 ? (
        <EmptyView
          title={debouncedQuery ? t('office.fleet.emptyMatching') : t('office.fleet.emptyNone')}
          hint={debouncedQuery ? undefined : t('office.fleet.emptyNoneHint')}
        />
      ) : filtered.length === 0 ? (
        <EmptyView title={t('office.fleet.emptyFilter')} />
      ) : (
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
                        {t(status.labelKey)} · {driver.driverCode}
                        {speed !== null ? ` · ${t('office.fleet.speedValue', { speed })}` : ''}
                      </AppText>
                      <AppText variant="label" tone="muted">
                        · {relativeTime(driver.capturedAt || driver.lastSeenAt, t)}
                      </AppText>
                    </View>

                    {!located && (
                      <AppText variant="label" tone="muted" style={{ marginTop: 2 }} testID={`fleet-driver-no-location-${driver.driverId}`}>
                        {t('office.fleet.noLocation')}
                      </AppText>
                    )}
                  </View>
                </View>

                {driver.alert?.status === 'ACTIVE' && (
                  <View style={[screenStyles.subAlertBadge, { marginTop: 8 }]}>
                    <AppText variant="label" tone="danger" style={{ fontWeight: '700' }}>
                      {t('office.fleet.stoppedFor', { duration: duration(driver.alert.durationMinutes) })}
                    </AppText>
                  </View>
                )}
              </Card>
            </Pressable>
          );
        })
      )}

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
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
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
    color: colors.mutedForeground,
  },
  filterTextActive: {
    color: colors.primaryForeground,
  },
  alertBanner: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
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
    backgroundColor: colors.dangerSoft,
    padding: spacing.xs,
    borderRadius: radius.sm,
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
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertCard: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
    gap: spacing.xs,
  },
  ackBtn: {
    minHeight: TOUCH_TARGET,
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
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
