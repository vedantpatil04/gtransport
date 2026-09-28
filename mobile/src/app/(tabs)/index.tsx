import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { AppText, Card, ErrorView, Loading, Plate } from '../../components/ui';
import { LocationStatusCard } from '../../features/location/LocationStatusCard';
import { fuelApi, operationsApi } from '../../lib/api/operations';
import { useSession } from '../../lib/auth/session-store';
import { todayIso } from '../../lib/dates';
import { colors, radius, shadow, spacing, TOUCH_TARGET } from '../../theme/tokens';

/**
 * Driver Home, keeping the approved hierarchy: who you are, your vehicle, location status,
 * today's summary, then ADD FUEL as the dominant action, then everything else.
 *
 * Identity and vehicle are real API data. Today's amounts, payments and documents are sample
 * values until their phases connect — labelled as such, never presented as records.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const driver = useSession((s) => s.driver);
  const refreshDriver = useSession((s) => s.refreshDriver);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const router = useRouter();
  const token = useSession((s) => s.token);
  const [today, setToday] = useState<{ fuel: string; other: string } | null>(null);

  const loadToday = useCallback(async () => {
    if (!token) return;
    const date = todayIso();
    try {
      const [fuel, other] = await Promise.all([
        fuelApi.list(token, { from: date, to: date, limit: 1 }),
        operationsApi.list(token, { from: date, to: date }),
      ]);
      setToday({ fuel: fuel.totals.amount, other: other.total });
    } catch {
      // Offline: the summary simply shows no figures rather than wrong ones.
      setToday(null);
    }
  }, [token]);

  // Refresh whenever Home comes back into view, e.g. after saving a fill-up.
  useFocusEffect(
    useCallback(() => {
      void loadToday();
    }, [loadToday]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(false);
    try {
      await Promise.all([refreshDriver(), loadToday()]);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, [refreshDriver]);

  if (!driver && error) return <ErrorView onRetry={() => void onRefresh()} />;
  if (!driver) return <Loading />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'home.greetingMorning' : hour < 17 ? 'home.greetingAfternoon' : 'home.greetingEvening';
  const firstName = driver.employee.fullName.split(' ')[0];
  const vehicle = driver.currentAssignment?.vehicle ?? null;

  return (
    <View style={styles.flex}>
      <OfflineBanner />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <AppText variant="h1" tone="inverse" testID="driver-greeting">
            {t(greeting, { name: firstName })}
          </AppText>

          <View style={styles.vehicleRow}>
            {vehicle ? (
              <>
                <Plate reg={vehicle.registrationNumber} size="lg" />
                <View style={styles.vehicleText}>
                  <AppText variant="label" tone="inverse" style={{ opacity: 0.7 }}>{t('home.yourVehicle')}</AppText>
                  <AppText tone="inverse" numberOfLines={1}>{t(`vehicleKind.${vehicle.kind}`, { defaultValue: vehicle.kind })}</AppText>
                </View>
              </>
            ) : (
              <AppText tone="inverse">{t('home.noVehicle')}</AppText>
            )}
          </View>

          <LocationStatusCard tone="dark" />
        </View>

        <View style={styles.body}>
          <Card>
            <View style={styles.cardHead}>
              <AppText variant="h2">{t('home.todaySummary')}</AppText>
            </View>
            <View style={styles.summaryRow}>
              {[
                { key: 'fuel', label: t('home.fuel'), value: today?.fuel ?? null },
                { key: 'other', label: t('home.otherExpenses'), value: today?.other ?? null },
                // Payments arrive with the payments phase; nothing is shown until they are real.
                { key: 'received', label: t('home.received'), value: null },
              ].map((cell) => (
                <View key={cell.key} style={styles.summaryCell} testID={`summary-${cell.key}`}>
                  <AppText variant="label" tone="muted" numberOfLines={2}>{cell.label}</AppText>
                  <AppText variant="figure" tone={cell.value === null ? 'muted' : 'default'} style={{ marginTop: spacing.xs }}>
                    {cell.value === null ? '—' : `₹${Number(cell.value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                  </AppText>
                </View>
              ))}
            </View>
          </Card>

          {/* The dominant action in the approved design. */}
          <Pressable
            accessibilityRole="button"
            testID="add-fuel"
            onPress={() => router.push('/fuel/new')}
            style={({ pressed }) => [styles.addFuel, pressed && { opacity: 0.9 }]}
          >
            <View style={styles.fuelIcon}>
              <AppText variant="h1" style={{ color: '#111111' }}>⛽</AppText>
            </View>
            <View style={styles.flex}>
              <AppText variant="h1" tone="inverse" numberOfLines={1}>{t('home.addFuel')}</AppText>
              <AppText variant="label" tone="inverse" style={{ opacity: 0.75 }} numberOfLines={1}>
                {t('home.addFuelHint')}
              </AppText>
            </View>
          </Pressable>

          <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/updates')} testID="home-updates">
            <Card style={styles.sectionCard}>
              <AppText variant="h2">{t('home.otherUpdates')}</AppText>
              <AppText variant="label" tone="muted" style={{ marginTop: spacing.xs }}>
                {[t('daily.rto'), t('daily.tyre'), t('daily.tyreInsurance'), t('daily.maintenance')].join(' · ')}
              </AppText>
            </Card>
          </Pressable>

          <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/documents')} testID="home-documents">
            <Card style={styles.sectionCard}>
              <AppText variant="h2">{t('home.documents')}</AppText>
              <AppText variant="label" tone="muted" style={{ marginTop: spacing.xs }}>{t('tabs.documents')}</AppText>
            </Card>
          </Pressable>

          <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/payments')} testID="home-payments">
            <Card style={styles.sectionCard}>
              <AppText variant="h2">{t('home.payments')}</AppText>
              <AppText variant="label" tone="muted" style={{ marginTop: spacing.xs }}>{t('home.comingSoon')}</AppText>
            </Card>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.md },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleText: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.lg, marginTop: -spacing.md },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  summaryRow: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.md },
  summaryCell: { flex: 1 },
  addFuel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: spacing.lg,
    minHeight: TOUCH_TARGET + 32,
    ...shadow.raised,
  },
  fuelIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    backgroundColor: colors.plate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCard: {},
});
