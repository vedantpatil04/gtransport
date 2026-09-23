import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { AppText, Card, ErrorView, Loading, Plate } from '../../components/ui';
import { LocationStatusCard } from '../../features/location/LocationStatusCard';
import { useSession } from '../../lib/auth/session-store';
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(false);
    try {
      await refreshDriver();
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
              <AppText variant="label" tone="muted">{t('home.demoData')}</AppText>
            </View>
            <View style={styles.summaryRow}>
              {[
                { key: 'fuel', label: t('home.fuel') },
                { key: 'other', label: t('home.otherExpenses') },
                { key: 'received', label: t('home.received') },
              ].map((cell) => (
                <View key={cell.key} style={styles.summaryCell}>
                  <AppText variant="label" tone="muted" numberOfLines={2}>{cell.label}</AppText>
                  {/* Placeholder until the fuel and payment phases provide real figures. */}
                  <AppText variant="figure" tone="muted" style={{ marginTop: spacing.xs }}>—</AppText>
                </View>
              ))}
            </View>
            <AppText variant="label" tone="muted" style={{ marginTop: spacing.md }}>{t('home.demoNotice')}</AppText>
          </Card>

          {/* The dominant action in the approved design; the workflow itself is a later phase. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            disabled
            testID="add-fuel"
            style={[styles.addFuel, { opacity: 0.55 }]}
          >
            <View style={styles.fuelIcon}>
              <AppText variant="h1" style={{ color: '#111111' }}>⛽</AppText>
            </View>
            <View style={styles.flex}>
              <AppText variant="h1" tone="inverse" numberOfLines={1}>{t('home.addFuel')}</AppText>
              <AppText variant="label" tone="inverse" style={{ opacity: 0.75 }} numberOfLines={1}>
                {t('home.comingSoon')}
              </AppText>
            </View>
          </Pressable>

          {[
            { key: 'updates', title: t('home.otherUpdates') },
            { key: 'payments', title: t('home.payments') },
            { key: 'documents', title: t('home.documents') },
          ].map((section) => (
            <Card key={section.key} style={styles.sectionCard}>
              <AppText variant="h2">{section.title}</AppText>
              <AppText variant="label" tone="muted" style={{ marginTop: spacing.xs }}>{t('home.comingSoon')}</AppText>
            </Card>
          ))}
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
