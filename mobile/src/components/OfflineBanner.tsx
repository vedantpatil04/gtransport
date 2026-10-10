import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useNetwork } from '../lib/offline/useNetwork';
import { colors, spacing } from '../theme/tokens';
import { AppText } from './ui';

/** Small, permanent honesty about connectivity: offline, syncing, waiting, failed — or nothing when all is sent. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const { online, pending, failed, syncing } = useNetwork();

  if (online && pending === 0 && failed === 0 && !syncing) return null;

  const tone = !online ? colors.warningSoft : syncing ? colors.successSoft : failed > 0 && pending === 0 ? colors.dangerSoft : colors.warningSoft;
  const textTone = !online ? 'warning' : syncing ? 'success' : failed > 0 && pending === 0 ? 'danger' : 'warning';
  const message = !online
    ? t('states.offline')
    : syncing
      ? t('states.syncing')
      : pending > 0
        ? t('states.pending', { count: pending })
        : t('states.failed', { count: failed });

  return (
    <View style={[styles.banner, { backgroundColor: tone }]} accessibilityLiveRegion="polite" testID="offline-banner">
      <AppText variant="label" tone={textTone}>{message}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center' },
});
