import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/ui';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';
import { useTracking } from './useTracking';

/**
 * Location sharing, stated honestly.
 *
 * Tracking is required by company policy, but the operating system decides whether it is possible.
 * This card says which of those is true right now, and offers the single action that would help —
 * the permission prompt, or the OS settings screen once the prompt will no longer appear.
 *
 * Deliberately not a GPS dashboard. A driver needs to know whether the office can see them and
 * what to tap if not; coordinates, accuracy and heading are the office's business and appear on
 * the admin screen, not here.
 */
export function LocationStatusCard({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { t } = useTranslation();
  const { state, pendingUploads, busy, action, resolve, sync } = useTracking();

  const label = (() => {
    switch (state) {
      case 'active':
        return t('location.active');
      case 'syncPending':
        return t('location.syncPending', { count: pendingUploads });
      case 'servicesOff':
        return t('location.servicesOff');
      case 'needsPermission':
        return t('location.needsPermission');
      case 'paused':
        return t('location.paused');
      case 'unavailable':
      default:
        return t('location.unavailable');
    }
  })();

  const dot = state === 'active' ? colors.success : state === 'syncPending' || state === 'paused' ? colors.warning : colors.danger;
  const inverse = tone === 'dark';

  const onPress = () => {
    if (busy) return;
    // A sync backlog is the one state where the useful action is "try again now" rather than a
    // permission change — tracking is working, the network is not.
    if (action === 'none') {
      if (state === 'syncPending') void sync();
      return;
    }
    void resolve();
  };

  const actionLabel =
    action === 'openSettings'
      ? t('location.openSettings')
      : action === 'requestPermission'
        ? t('location.allow')
        : state === 'syncPending'
          ? t('location.syncNow')
          : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={busy || (action === 'none' && state !== 'syncPending')}
      accessibilityRole="button"
      accessibilityLabel={`${t('location.title')}: ${label}`}
      accessibilityState={{ busy }}
      testID="location-status"
      style={({ pressed }) => [styles.wrapper, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: dot }]} testID="location-status-dot" />
        <View style={styles.text}>
          <AppText variant="label" tone={inverse ? 'inverse' : 'muted'} style={inverse ? { opacity: 0.7 } : undefined}>
            {t('location.title')}
          </AppText>
          <AppText tone={inverse ? 'inverse' : 'default'} numberOfLines={2}>
            {label}
          </AppText>
        </View>
      </View>
      {actionLabel && (
        <AppText variant="label" tone={inverse ? 'inverse' : 'muted'} style={styles.action}>
          {actionLabel}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingVertical: spacing.sm, borderRadius: radius.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { flex: 1 },
  action: { marginTop: spacing.xs, marginLeft: 22, textDecorationLine: 'underline' },
});
