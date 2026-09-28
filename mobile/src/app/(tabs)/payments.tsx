import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { AppText, Card, EmptyView, ErrorView, Loading } from '../../components/ui';
import { driverPaymentState, paymentsApi, rupees, type DriverPayment, type DriverPaymentState } from '../../lib/api/payments';
import { useSession } from '../../lib/auth/session-store';
import { displayDate } from '../../lib/dates';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

const PAGE_SIZE = 30;

const PILL: Record<DriverPaymentState, { fg: string; bg: string }> = {
  received: { fg: colors.success, bg: colors.successSoft },
  processing: { fg: colors.warning, bg: colors.warningSoft },
  pending: { fg: colors.mutedForeground, bg: colors.muted },
  failed: { fg: colors.danger, bg: colors.dangerSoft },
  cancelled: { fg: colors.mutedForeground, bg: colors.muted },
  returned: { fg: colors.danger, bg: colors.dangerSoft },
};

/** "Salary · September 2026", "Advance", … */
function title(payment: DriverPayment, t: (key: string) => string, language: string): string {
  const kind = t(`payments.type.${payment.type}`);
  if (!payment.payPeriod) return kind;
  const month = displayDate(`${payment.payPeriod}-01`, language).replace(/^\d+\s/, '');
  return `${kind} · ${month}`;
}

/**
 * The driver's payments: salary, advances and allowances the office has paid or is paying.
 * Read-only and online-only — the office decides payments; the phone only shows them.
 */
export default function PaymentsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const token = useSession((s) => s.token);
  const [items, setItems] = useState<DriverPayment[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const page = await paymentsApi.mine(token, { limit: PAGE_SIZE });
      setItems(page.data);
      setNextCursor(page.page.nextCursor);
      setError(false);
    } catch {
      setError(true);
    }
  }, [token]);

  const loadMore = async () => {
    if (!token || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await paymentsApi.mine(token, { limit: PAGE_SIZE, cursor: nextCursor });
      setItems((current) => [...(current ?? []), ...page.data]);
      setNextCursor(page.page.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  // Reload whenever the tab is shown, so a payment made meanwhile appears.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const lastReceived = items?.find((p) => p.status === 'PAID') ?? null;

  return (
    <View style={styles.flex}>
      <OfflineBanner />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <AppText variant="h1" tone="inverse">
          {t('payments.title')}
        </AppText>
      </View>

      {!items && error ? (
        <ErrorView onRetry={() => void load()} />
      ) : !items ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyView title={t('payments.empty')} hint={t('payments.emptyHint')} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={colors.primary}
            />
          }
        >
          {lastReceived && (
            <Card testID="payments-last-received">
              <AppText variant="label" tone="muted">{t('payments.lastReceived')}</AppText>
              <AppText variant="figure" tone="success">{rupees(lastReceived.amount)}</AppText>
              <AppText tone="muted">
                {title(lastReceived, t, i18n.language)}
                {lastReceived.paidAt ? ` · ${displayDate(lastReceived.paidAt.slice(0, 10), i18n.language)}` : ''}
              </AppText>
            </Card>
          )}

          {/* Offline or a failed refresh: keep showing what was loaded, and say it may be stale. */}
          {error && <AppText tone="danger">{t('payments.refreshFailed')}</AppText>}

          {items.map((payment) => {
            const state = driverPaymentState(payment.status);
            const date = (payment.paidAt ?? payment.createdAt).slice(0, 10);
            return (
              <Card key={payment.id} testID={`payment-${payment.id}`} style={styles.card}>
                <View style={styles.row}>
                  <View style={styles.flexText}>
                    <AppText variant="h2">{title(payment, t, i18n.language)}</AppText>
                    <AppText tone="muted">{displayDate(date, i18n.language)}</AppText>
                  </View>
                  <AppText variant="figure">{rupees(payment.amount)}</AppText>
                </View>
                <View style={styles.row}>
                  <View style={[styles.pill, { backgroundColor: PILL[state].bg }]}>
                    <AppText variant="label" style={{ color: PILL[state].fg }} testID={`payment-status-${payment.id}`}>
                      {t(`payments.status.${state}`)}
                    </AppText>
                  </View>
                  <AppText variant="label" tone="muted" style={styles.method}>
                    {t(`payments.method.${payment.method}`)}
                    {payment.recipientSummary ? ` · ${payment.recipientSummary}` : ''}
                  </AppText>
                </View>
                {payment.utr && (
                  <AppText variant="label" tone="muted">
                    {t('payments.utr', { utr: payment.utr })}
                  </AppText>
                )}
                {(state === 'returned' || state === 'failed') && (
                  <AppText variant="label" tone="danger">{t('payments.officeWillFix')}</AppText>
                )}
                {payment.description && <AppText variant="label" tone="muted">{payment.description}</AppText>}
              </Card>
            );
          })}

          {nextCursor && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadMore()}
              disabled={loadingMore}
              style={({ pressed }) => [styles.more, pressed && { opacity: 0.7 }]}
            >
              <AppText tone="success">{loadingMore ? t('common.loading') : t('payments.loadMore')}</AppText>
            </Pressable>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  body: { padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flexText: { flex: 1, gap: 2 },
  pill: { borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  method: { flex: 1 },
  more: { minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
});
