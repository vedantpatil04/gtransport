import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/ui';
import { driverApi } from '../../lib/api/driver';
import { useSession } from '../../lib/auth/session-store';
import {
  openLocationSettings, readPermission, requestPermission, toApiPermission, toDisplayStatus,
  type LocationPermissionSnapshot,
} from '../../lib/location/permission';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

/**
 * Location sharing status, shown honestly.
 *
 * Tracking is required by policy, but the OS decides. When permission is missing the driver is
 * told plainly and offered the one action that helps — the prompt, or Settings once the
 * prompt will no longer appear.
 */
export function LocationStatusCard({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { t } = useTranslation();
  const token = useSession((s) => s.token);
  const [snapshot, setSnapshot] = useState<LocationPermissionSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const report = useCallback(
    async (next: LocationPermissionSnapshot) => {
      setSnapshot(next);
      if (!token) return;
      // Best effort: the office learns whether tracking can work. Failure must not block the UI.
      try {
        await driverApi.reportLocationState(token, {
          permission: toApiPermission(next),
          status: toDisplayStatus(next),
          locationServicesEnabled: next.servicesEnabled,
        });
      } catch {
        /* reported again on the next launch */
      }
    },
    [token],
  );

  useEffect(() => {
    readPermission().then(report).catch(() => undefined);
  }, [report]);

  const onPress = async () => {
    if (!snapshot || busy) return;
    setBusy(true);
    try {
      // Once Android stops showing the prompt, only Settings can change the answer.
      if (snapshot.stage === 'LOCATION_SERVICES_OFF' || !snapshot.canAskAgain || snapshot.foreground === 'RESTRICTED') {
        await openLocationSettings();
        return;
      }
      await report(await requestPermission({ includeBackground: snapshot.foreground === 'GRANTED' }));
    } finally {
      setBusy(false);
    }
  };

  const label = (() => {
    if (!snapshot) return t('location.checking');
    if (!snapshot.servicesEnabled) return t('location.servicesOff');
    if (snapshot.foreground === 'RESTRICTED') return t('location.restricted');
    if (snapshot.foreground === 'DENIED') return t('location.denied');
    if (snapshot.foreground === 'UNKNOWN') return t('location.unknown');
    if (snapshot.background !== 'GRANTED') return t('location.backgroundRequired');
    return t('location.active');
  })();

  const ok = snapshot?.foreground === 'GRANTED' && snapshot.servicesEnabled;
  const settled = ok && snapshot?.background === 'GRANTED';
  const inverse = tone === 'dark';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t('location.title')}: ${label}`}
      testID="location-status"
      style={({ pressed }) => [styles.wrapper, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: settled ? colors.success : ok ? colors.warning : colors.danger }]} />
        <View style={styles.text}>
          <AppText variant="label" tone={inverse ? 'inverse' : 'muted'} style={inverse ? { opacity: 0.7 } : undefined}>
            {t('location.title')}
          </AppText>
          <AppText tone={inverse ? 'inverse' : 'default'} numberOfLines={2}>{label}</AppText>
        </View>
      </View>
      {!settled && snapshot && (
        <AppText variant="label" tone={inverse ? 'inverse' : 'muted'} style={styles.action}>
          {snapshot.servicesEnabled && snapshot.canAskAgain && snapshot.foreground !== 'RESTRICTED'
            ? t('location.allow')
            : t('location.openSettings')}
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
