import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useNetwork } from '../lib/offline/useNetwork';
import { colors, spacing } from '../theme/tokens';
import { AppText } from './ui';

/** Small, permanent honesty about connectivity: offline, syncing, or everything sent. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const { online, pending, syncing } = useNetwork();

  if (online && pending === 0 && !syncing) return null;

  const tone = online ? colors.successSoft : colors.warningSoft;
  const message = !online
    ? t('states.offline')
    : syncing
      ? t('states.syncing')
      : t('states.pending', { count: pending });

  return (
    <View style={[styles.banner, { backgroundColor: tone }]} accessibilityLiveRegion="polite" testID="offline-banner">
      <AppText variant="label" tone={online ? 'success' : 'warning'}>{message}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center' },
});
