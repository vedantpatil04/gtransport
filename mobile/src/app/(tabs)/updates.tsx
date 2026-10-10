import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { AppText, Card } from '../../components/ui';
import { PendingEntryCard } from '../../features/daily/PendingEntryCard';
import { ServiceReceiptStatus } from '../../features/daily/ServiceReceiptStatus';
import { usePendingEntries } from '../../features/daily/usePendingEntries';
import { colors, radius, shadow, spacing, TOUCH_TARGET } from '../../theme/tokens';

/**
 * Daily updates. Petrol / Diesel is the primary action; RTO, tyre, tyre insurance and
 * maintenance/service follow. Parking, food and repair are not offered — they were removed
 * from the production model in Phase 3.
 */
const SECONDARY = [
  { key: 'rto', icon: '🏛️', title: 'daily.rto', href: '/operation/rto' },
  { key: 'tyre', icon: '🛞', title: 'daily.tyre', href: '/operation/tyre' },
  { key: 'tyre-insurance', icon: '🛡️', title: 'daily.tyreInsurance', href: '/operation/tyre-insurance' },
  { key: 'maintenance', icon: '🔧', title: 'daily.maintenance', href: '/operation/maintenance' },
] as const;

export default function UpdatesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pending = usePendingEntries();

  return (
    <View style={styles.flex}>
      <OfflineBanner />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <AppText variant="h1" tone="inverse">
          {t('updates.title')}
        </AppText>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]}>
        <Pressable
          accessibilityRole="button"
          testID="updates-fuel"
          onPress={() => router.push('/fuel/new')}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }]}
        >
          <View style={styles.fuelIcon}>
            <AppText variant="h1" style={{ color: '#111111' }}>
              ⛽
            </AppText>
          </View>
          <View style={styles.flexText}>
            <AppText variant="h1" tone="inverse" numberOfLines={2}>
              {t('daily.fuelTitle')}
            </AppText>
          </View>
        </Pressable>

        <View style={styles.grid}>
          {SECONDARY.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              testID={`updates-${item.key}`}
              onPress={() => router.push(item.href)}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
            >
              <AppText variant="h1">{item.icon}</AppText>
              <AppText style={styles.tileLabel} numberOfLines={2}>
                {t(item.title)}
              </AppText>
            </Pressable>
          ))}
        </View>

        <Pressable accessibilityRole="button" onPress={() => router.push('/fuel/history')} style={styles.historyLink} testID="updates-history">
          <AppText tone="success">{t('daily.history')} ›</AppText>
        </Pressable>

        {pending.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <AppText variant="h2">{t('daily.recentEntries')}</AppText>
            {pending.map((entry) => (
              <PendingEntryCard key={entry.id} entry={entry} />
            ))}
          </View>
        ) : null}

        {/* What became of the service bills already sent. Renders nothing when there are none. */}
        <ServiceReceiptStatus />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  flexText: { flex: 1 },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  body: { padding: spacing.lg, gap: spacing.lg },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: spacing.lg,
    minHeight: TOUCH_TARGET + 32,
    ...shadow.raised,
  },
  fuelIcon: { width: 60, height: 60, borderRadius: radius.lg, backgroundColor: colors.plate, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: TOUCH_TARGET * 2.2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow.card,
  },
  tileLabel: { textAlign: 'center' },
  historyLink: { minHeight: TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
});
