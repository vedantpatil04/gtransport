import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { AppText, Card, Loading, Plate, Row } from '../../components/ui';
import { LocationStatusCard } from '../../features/location/LocationStatusCard';
import { LANGUAGES, setLanguage, type LanguageCode } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import { isEnabled as notificationsEnabled, setEnabled as setNotificationsEnabled } from '../../lib/notifications/notifications';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

/** Driver profile: real account data, language, notifications, location, help and logout. */
export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const driver = useSession((s) => s.driver);
  const signOut = useSession((s) => s.signOut);

  const [notifications, setNotifications] = useState(true);

  useEffect(() => {
    notificationsEnabled().then(setNotifications).catch(() => undefined);
  }, []);

  if (!driver) return <Loading />;

  const vehicle = driver.currentAssignment?.vehicle ?? null;

  const confirmLogout = () => {
    Alert.alert(t('profile.logoutConfirm'), t('profile.logoutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.logout'), style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  const onToggleNotifications = async (next: boolean) => {
    setNotifications(next);
    await setNotificationsEnabled(next);
  };

  return (
    <View style={styles.flex}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <AppText variant="h1" tone="inverse">{driver.employee.fullName}</AppText>
          <AppText tone="inverse" style={{ opacity: 0.75 }}>{driver.driverCode}</AppText>
        </View>

        <View style={styles.body}>
          <Card style={styles.cardFlush}>
            <Row label={t('profile.employeeId')} value={driver.employee.employeeCode} />
            <View style={styles.divider} />
            <Row label={t('profile.driverCode')} value={driver.driverCode} />
            <View style={styles.divider} />
            <Row label={t('profile.phone')} value={driver.employee.phone ?? '—'} />
            <View style={styles.divider} />
            <Row
              label={t('profile.vehicle')}
              value={vehicle ? <View style={{ marginTop: 4 }}><Plate reg={vehicle.registrationNumber} size="sm" /></View> : t('home.noVehicle')}
            />
            <View style={styles.divider} />
            <Row label={t('profile.status')} value={t(`driverStatus.${driver.status}`, { defaultValue: driver.status })} />
          </Card>

          <Card>
            <AppText variant="h2">{t('profile.chooseLanguage')}</AppText>
            <View style={styles.languages}>
              {LANGUAGES.map((language) => {
                const active = i18n.language === language.code;
                return (
                  <Pressable
                    key={language.code}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    testID={`language-${language.code}`}
                    onPress={() => void setLanguage(language.code as LanguageCode)}
                    style={({ pressed }) => [styles.language, active && styles.languageActive, pressed && { opacity: 0.85 }]}
                  >
                    <AppText tone={active ? 'inverse' : 'default'}>{language.native}</AppText>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          <Card style={styles.cardFlush}>
            <Row
              label={t('profile.notifications')}
              value={t('profile.notificationsHint')}
              right={
                <Switch
                  value={notifications}
                  onValueChange={(next) => void onToggleNotifications(next)}
                  trackColor={{ true: colors.success, false: colors.border }}
                  testID="notifications-toggle"
                />
              }
            />
          </Card>

          <Card>
            <LocationStatusCard />
          </Card>

          <Card>
            <AppText variant="h2">{t('profile.help')}</AppText>
            <AppText tone="muted" style={{ marginTop: spacing.xs }}>{t('profile.helpBody')}</AppText>
            {driver.emergencyContact.phone ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void Linking.openURL(`tel:${driver.emergencyContact.phone}`)}
                style={styles.helpAction}
              >
                <AppText tone="success">{driver.emergencyContact.phone}</AppText>
              </Pressable>
            ) : null}
          </Card>

          <Pressable
            accessibilityRole="button"
            onPress={confirmLogout}
            testID="logout"
            style={({ pressed }) => [styles.logout, pressed && { opacity: 0.85 }]}
          >
            <AppText tone="danger" variant="h2">{t('profile.logout')}</AppText>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.xs },
  body: { padding: spacing.lg, gap: spacing.lg },
  cardFlush: { paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg },
  languages: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  language: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  languageActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  helpAction: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  logout: {
    minHeight: TOUCH_TARGET + 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
});
