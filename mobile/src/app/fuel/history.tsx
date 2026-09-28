import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { AppText, Card, ErrorView, Loading } from '../../components/ui';
import { discardEntry, KIND, toPendingEntry, type PendingEntry } from '../../features/daily/submissions';
import { ApiError } from '../../lib/api/client';
import { fuelApi, receiptSource } from '../../lib/api/operations';
import { useSession } from '../../lib/auth/session-store';
import { daysAgoIso, displayDate, monthStartIso, todayIso } from '../../lib/dates';
import { offlineQueue } from '../../lib/offline/queue';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';
import type { FuelEntry, FuelTotals } from '../../types/domain';

type Range = 'today' | 'last7' | 'thisMonth';

const rangeFrom = (range: Range): string => (range === 'today' ? todayIso() : range === 'last7' ? daysAgoIso(6) : monthStartIso());

const rupees = (value: string | number) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * The driver's own fuel history: a simple date filter, a total, and each fill-up with its
 * receipt. Entries saved offline appear at the top as "waiting to sync" until they reach the
 * server, so nothing the driver entered ever seems to vanish.
 */
export default function FuelHistoryScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const token = useSession((s) => s.token);

  const [range, setRange] = useState<Range>('today');
  const [entries, setEntries] = useState<FuelEntry[] | null>(null);
  const [totals, setTotals] = useState<FuelTotals | null>(null);
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [receipt, setReceipt] = useState<FuelEntry | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const page = await fuelApi.list(token, { from: rangeFrom(range), to: todayIso(), limit: 50 });
      setEntries(page.data);
      setTotals(page.totals);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError('unknown', 0, 'error'));
    }
  }, [token, range]);

  useEffect(() => {
    setEntries(null);
    void load();
  }, [load]);

  // Entries still on the phone, updated live as the queue syncs.
  useEffect(
    () =>
      offlineQueue.subscribe((items) =>
        setPending(items.map(toPendingEntry).filter((entry): entry is PendingEntry => entry?.kind === KIND.fuel)),
      ),
    [],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await offlineQueue.drain();
    await load();
    setRefreshing(false);
  };

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <AppText tone="inverse">‹ {t('common.back')}</AppText>
        </Pressable>
        <AppText variant="h1" tone="inverse">
          {t('daily.history')}
        </AppText>
      </View>
      <OfflineBanner />

      <View style={styles.ranges} accessibilityRole="tablist">
        {(['today', 'last7', 'thisMonth'] as Range[]).map((key) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: range === key }}
            onPress={() => setRange(key)}
            style={[styles.rangeButton, range === key && styles.rangeActive]}
            testID={`range-${key}`}
          >
            <AppText variant="label" tone={range === key ? 'inverse' : 'default'} numberOfLines={1}>
              {t(`daily.${key}`)}
            </AppText>
          </Pressable>
        ))}
      </View>

      {error && !entries ? (
        <ErrorView onRetry={() => void load()} />
      ) : !entries ? (
        <Loading />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />}
        >
          {pending.map((entry) => (
            <Card key={entry.id} style={[styles.entry, entry.state === 'REJECTED' ? styles.rejected : styles.pending]}>
              <View style={styles.entryRow}>
                <View style={styles.flexText}>
                  <AppText variant="h2">{rupees(entry.amount)}</AppText>
                  <AppText tone="muted" numberOfLines={1}>
                    {entry.label} · {displayDate(entry.date, i18n.language)}
                  </AppText>
                </View>
                <AppText variant="label" tone={entry.state === 'REJECTED' ? 'danger' : 'warning'}>
                  {entry.state === 'REJECTED' ? t('daily.rejected') : t('daily.pendingSync')}
                </AppText>
              </View>
              {entry.state === 'REJECTED' ? (
                <Pressable accessibilityRole="button" onPress={() => void discardEntry(entry.id)} style={styles.discard}>
                  <AppText tone="danger">{t('daily.discard')}</AppText>
                </Pressable>
              ) : null}
            </Card>
          ))}

          {totals ? (
            <Card style={styles.totals}>
              <AppText variant="label" tone="muted">
                {t('daily.total')}
              </AppText>
              <AppText variant="h1" testID="fuel-total">
                {rupees(totals.amount)}
              </AppText>
              <AppText tone="muted">
                {t('daily.litresValue', { value: Number(totals.litres).toLocaleString('en-IN', { maximumFractionDigits: 1 }) })}
                {totals.averageRate ? ` · ${t('daily.perLitre', { rate: totals.averageRate })}` : ''}
              </AppText>
            </Card>
          ) : null}

          {entries.length === 0 && pending.length === 0 ? (
            <AppText tone="muted" style={styles.empty}>
              {t('daily.noFuel')}
            </AppText>
          ) : null}

          {entries.map((entry) => (
            <Card key={entry.id} style={styles.entry}>
              <View style={styles.entryRow}>
                <View style={styles.flexText}>
                  <AppText variant="label" tone="muted">
                    {entry.fuelType === 'PETROL' ? t('daily.petrol') : t('daily.diesel')} · {displayDate(entry.transactionDate, i18n.language)}
                  </AppText>
                  <AppText variant="h2">{rupees(entry.amount)}</AppText>
                  <AppText tone="muted" numberOfLines={1}>
                    {t('daily.litresValue', { value: Number(entry.litres).toLocaleString('en-IN', { maximumFractionDigits: 2 }) })} · {entry.fuelStation}
                  </AppText>
                </View>
                {entry.receiptFileId ? (
                  <Pressable accessibilityRole="button" onPress={() => setReceipt(entry)} style={styles.receiptButton}>
                    <AppText variant="label" tone="success">
                      {t('daily.viewReceipt')}
                    </AppText>
                  </Pressable>
                ) : (
                  <AppText variant="label" tone="muted">
                    {t('daily.noReceipt')}
                  </AppText>
                )}
              </View>
            </Card>
          ))}
        </ScrollView>
      )}

      <Modal visible={Boolean(receipt)} animationType="fade" transparent onRequestClose={() => setReceipt(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setReceipt(null)} accessibilityRole="button">
          {receipt?.receiptFileId && token ? (
            <Image source={receiptSource(token, receipt.receiptFileId)} style={styles.modalImage} resizeMode="contain" accessibilityLabel={t('daily.receipt')} />
          ) : null}
          <AppText tone="inverse" style={styles.modalClose}>
            {t('common.close')}
          </AppText>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  flexText: { flex: 1, gap: 2 },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xs },
  back: { minHeight: TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
  ranges: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: 0 },
  rangeButton: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xs,
  },
  rangeActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  body: { padding: spacing.lg, gap: spacing.md },
  totals: { gap: spacing.xs },
  entry: { gap: spacing.sm },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pending: { borderLeftWidth: 4, borderLeftColor: colors.warning },
  rejected: { borderLeftWidth: 4, borderLeftColor: colors.danger },
  discard: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  receiptButton: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.sm },
  empty: { textAlign: 'center', marginTop: spacing.xl },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalImage: { width: '100%', height: '80%' },
  modalClose: { marginTop: spacing.lg },
});
