import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { AppText, EmptyView } from '../../components/ui';
import { colors, spacing } from '../../theme/tokens';

/**
 * Daily updates tab. The shell and navigation exist now; the workflow behind it belongs to a later
 * phase, so the screen says so rather than showing invented records.
 */
export default function UpdatesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.flex}>
      <OfflineBanner />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <AppText variant="h1" tone="inverse">{t('updates.title')}</AppText>
      </View>
      <EmptyView title={t('updates.empty')} hint={t('updates.phaseNote')} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
});
