import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { AppText, EmptyView } from '../../components/ui';
import { colors, spacing } from '../../theme/tokens';

/**
 * Payments tab. The shell and navigation exist now; the workflow behind it belongs to a later
 * phase, so the screen says so rather than showing invented records.
 */
export default function PaymentsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.flex}>
      <OfflineBanner />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <AppText variant="h1" tone="inverse">{t('payments.title')}</AppText>
      </View>
      <EmptyView title={t('payments.empty')} hint={t('payments.phaseNote')} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
});
