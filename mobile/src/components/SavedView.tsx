import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, TOUCH_TARGET } from '../theme/tokens';
import { AppText, PrimaryButton } from './ui';

/** The plain-language result: saved and synced, or saved on the phone for later. */
export function SavedView({ pending, onDone, onHistory }: { pending: boolean; onDone: () => void; onHistory?: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.saved, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]} testID="save-result">
      <View style={[styles.savedIcon, { backgroundColor: pending ? colors.warningSoft : colors.successSoft }]}>
        <AppText variant="h1" tone={pending ? 'warning' : 'success'}>
          {pending ? '⏳' : '✓'}
        </AppText>
      </View>
      <AppText variant="h1" style={styles.center}>
        {t('daily.saved')}
      </AppText>
      <AppText tone="muted" style={styles.center} testID="save-message">
        {pending ? t('daily.savedPending') : t('daily.synced')}
      </AppText>
      <View style={styles.savedActions}>
        <PrimaryButton label={t('common.close')} onPress={onDone} testID="save-done" />
        {onHistory ? (
          <Pressable accessibilityRole="button" onPress={onHistory} style={styles.linkButton}>
            <AppText tone="success">{t('daily.history')}</AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  saved: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  savedIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  savedActions: { alignSelf: 'stretch', marginTop: spacing.xl, gap: spacing.sm },
  linkButton: { minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
});
