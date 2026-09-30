import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Card, PrimaryButton } from '../../components/ui';
import { useSession } from '../../lib/auth/session-store';
import { colors, radius, shadow, spacing, TOUCH_TARGET } from '../../theme/tokens';
import { useTracking } from './useTracking';

/**
 * Enforces mandatory real-time GPS tracking for active drivers.
 *
 * Gangamata Transport fleet policy requires active location sharing while a driver is on duty.
 * If location permission is missing or device location services are off, this guard presents
 * a non-bypassable screen preventing app usage until location tracking is active.
 */
export function CompulsoryLocationGuard({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const token = useSession((s) => s.token);
  const role = useSession((s) => s.role);
  const driver = useSession((s) => s.driver);
  const signOut = useSession((s) => s.signOut);

  const { state, action, resolve, busy, snapshot } = useTracking();

  // Tracking is mandatory for authenticated drivers on active duty
  const isDriverOnDuty =
    Boolean(token) &&
    role === 'DRIVER' &&
    driver !== null &&
    (driver.status === 'ACTIVE' || driver.status === undefined);

  // Auto-prompt on mount if permission hasn't been granted yet
  useEffect(() => {
    if (isDriverOnDuty && state === 'needsPermission' && action === 'requestPermission' && !busy) {
      void resolve();
    }
  }, [isDriverOnDuty, state, action, busy, resolve]);

  // Non-drivers or off-duty drivers bypass the gate
  if (!isDriverOnDuty) {
    return <>{children}</>;
  }

  // Active tracking or buffered sync pending allows access to driver screens
  if (state === 'active' || state === 'syncPending') {
    return <>{children}</>;
  }

  // Location is disabled, denied, or unavailable: display compulsory blocking screen
  const isServicesOff = state === 'servicesOff' || !snapshot?.permission.servicesEnabled;
  const isDenied = state === 'needsPermission' || state === 'unavailable';

  const issueText = isServicesOff
    ? t('location.compulsoryServicesOff')
    : isDenied
      ? t('location.compulsoryPermissionRequired')
      : t('location.required');

  const actionButtonText =
    action === 'openSettings'
      ? t('location.compulsorySettingsBtn')
      : t('location.compulsoryEnableBtn');

  const confirmSignOut = () => {
    Alert.alert(t('profile.logoutConfirm'), t('profile.logoutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.logout'), style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandRow}>
          <Image
            source={require('../../../assets/branding/mark.png')}
            style={styles.logo}
            resizeMode="contain"
            accessible={false}
          />
          <View style={styles.brandText}>
            <AppText variant="label" tone="inverse" style={{ letterSpacing: 1 }}>
              {t('brand.name')}
            </AppText>
            <AppText variant="h2" tone="inverse">
              {driver.employee.fullName} ({driver.driverCode})
            </AppText>
          </View>
        </View>

        <Card style={styles.card}>
          <View style={styles.pulseContainer}>
            <View style={styles.radarPulse}>
              <View style={styles.radarInner}>
                <AppText style={styles.radarIcon}>📍</AppText>
              </View>
            </View>
            <View style={styles.mandatoryBadge}>
              <View style={styles.liveDot} />
              <AppText variant="label" tone="danger" style={{ fontWeight: '700' }}>
                {t('location.compulsoryBadge')}
              </AppText>
            </View>
          </View>

          <AppText variant="h1" style={styles.title}>
            {t('location.compulsoryTitle')}
          </AppText>

          <AppText tone="muted" style={styles.body}>
            {t('location.compulsoryBody')}
          </AppText>

          <View style={styles.issueNotice}>
            <AppText style={styles.warningIcon}>⚠️</AppText>
            <AppText variant="label" tone="warning" style={styles.issueText}>
              {issueText}
            </AppText>
          </View>

          <View style={styles.actionContainer}>
            <PrimaryButton
              label={actionButtonText}
              onPress={() => void resolve()}
              busy={busy}
              testID="compulsory-location-action"
            />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => void resolve()}
            style={styles.retryLink}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <AppText variant="label" tone="muted" style={{ textDecorationLine: 'underline' }}>
                {t('common.retry')}
              </AppText>
            )}
          </Pressable>
        </Card>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={confirmSignOut}
            style={styles.signOutButton}
            testID="compulsory-location-signout"
          >
            <AppText tone="inverse" variant="label" style={{ opacity: 0.85 }}>
              {t('location.compulsorySignOut')}
            </AppText>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.md,
  },
  logo: {
    width: 48,
    height: 48,
  },
  brandText: {
    flex: 1,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.lg,
    ...shadow.raised,
  },
  pulseContainer: {
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  radarPulse: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.danger,
  },
  radarIcon: {
    fontSize: 26,
  },
  mandatoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  title: {
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  body: {
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacing.sm,
  },
  issueNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    width: '100%',
    marginTop: spacing.sm,
  },
  warningIcon: {
    fontSize: 16,
  },
  issueText: {
    flex: 1,
  },
  actionContainer: {
    width: '100%',
    marginTop: spacing.md,
  },
  retryLink: {
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  signOutButton: {
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
});
