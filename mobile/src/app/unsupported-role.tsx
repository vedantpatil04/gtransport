import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, PrimaryButton } from '../components/ui';
import { useSession } from '../lib/auth/session-store';
import { colors, spacing, TOUCH_TARGET } from '../theme/tokens';

/**
 * A signed-in account whose role this app does not know. Nothing is guessed — neither the driver
 * app nor the office console opens. The person can check again (the role is re-read from the API)
 * or sign out.
 */
export default function UnsupportedRoleScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    try {
      await useSession.getState().restore();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl }]} testID="unsupported-role">
      <AppText variant="h2" style={{ textAlign: 'center' }}>{t('console.unsupportedTitle')}</AppText>
      <AppText tone="muted" style={{ marginTop: spacing.sm, textAlign: 'center' }}>{t('console.unsupportedBody')}</AppText>
      <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>
        <PrimaryButton label={t('common.retry')} onPress={() => void retry()} busy={busy} testID="unsupported-retry" />
      </View>
      <Pressable accessibilityRole="button" onPress={() => void useSession.getState().signOut()} style={styles.secondary} testID="unsupported-sign-out">
        <AppText tone="muted">{t('console.signOut')}</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xxl, backgroundColor: colors.background },
  secondary: { marginTop: spacing.md, minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
});
