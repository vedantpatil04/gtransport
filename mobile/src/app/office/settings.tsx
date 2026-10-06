import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Card, Row } from '../../components/ui';
import { ModuleGuard, OfficeScreen } from '../../features/office/ui';
import { LANGUAGES, setLanguage, type LanguageCode } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import { API_URL, APP_ENV } from '../../lib/config';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

/** The API's host name, e.g. "gtransport-7vgf.onrender.com" — enough to tell which server this is. */
function serverHost(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/**
 * Settings for an administrator on the phone: the signed-in account, the app language, and which
 * build and server this is. Administration itself — logins, roles, the company mailbox — happens in
 * the office web console, and the screen says so rather than offering controls that do nothing.
 */
function OfficeSettingsBody() {
  const { t, i18n } = useTranslation();
  const user = useSession((s) => s.user);
  const role = useSession((s) => s.role);
  const signOut = useSession((s) => s.signOut);
  const version = Constants.expoConfig?.version ?? '—';

  const confirmLogout = () =>
    Alert.alert(t('profile.logoutConfirm'), t('profile.logoutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.logout'), style: 'destructive', onPress: () => void signOut() },
    ]);

  return (
    <OfficeScreen title={t('office.nav.settings')} subtitle={t('office.settings.subtitle')} testID="office-settings">
      <AppText variant="h2">{t('office.settings.account')}</AppText>
      <Card style={styles.flush} testID="settings-account-card">
        <Row label={t('office.settings.name')} value={user?.displayName ?? '—'} />
        <View style={styles.divider} />
        <Row label={t('office.roleLabel')} value={role ? t(`office.role.${role}`) : '—'} />
        <View style={styles.divider} />
        <Row label={t('office.signInId')} value={user?.email ?? user?.phone ?? '—'} />
      </Card>

      <AppText variant="h2" style={styles.section}>{t('profile.chooseLanguage')}</AppText>
      <Card testID="settings-language-card">
        <View style={styles.languages}>
          {LANGUAGES.map((language) => {
            const active = i18n.language === language.code;
            return (
              <Pressable
                key={language.code}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`settings-lang-${language.code}`}
                onPress={() => void setLanguage(language.code as LanguageCode)}
                style={({ pressed }) => [styles.language, active && styles.languageActive, pressed && { opacity: 0.85 }]}
              >
                <AppText tone={active ? 'inverse' : 'default'}>{language.native}</AppText>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <AppText variant="h2" style={styles.section}>{t('office.settings.app')}</AppText>
      <Card style={styles.flush} testID="settings-system-card">
        <Row label={t('office.settings.version')} value={version} />
        <View style={styles.divider} />
        <Row label={t('office.settings.environment')} value={t(`office.settings.env.${APP_ENV}`)} />
        <View style={styles.divider} />
        <Row label={t('office.settings.server')} value={serverHost(API_URL)} />
      </Card>

      <Card>
        <AppText tone="muted">{t('office.settings.consoleNote')}</AppText>
      </Card>

      <Pressable
        accessibilityRole="button"
        onPress={confirmLogout}
        style={({ pressed }) => [styles.logout, pressed && { opacity: 0.85 }]}
        testID="settings-sign-out"
      >
        <AppText tone="danger" variant="h2">{t('profile.logout')}</AppText>
      </Pressable>
    </OfficeScreen>
  );
}

export default function OfficeSettings() {
  return (
    <ModuleGuard module="settings">
      <OfficeSettingsBody />
    </ModuleGuard>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.sm },
  flush: { paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg },
  languages: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
  logout: { minHeight: TOUCH_TARGET + 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.dangerSoft },
});
