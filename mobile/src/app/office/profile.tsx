import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { ChangePasswordCard } from '../../components/ChangePasswordCard';
import { AppText, Card, Row } from '../../components/ui';
import { OfficeScreen } from '../../features/office/ui';
import { LANGUAGES, setLanguage, type LanguageCode } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

/** Office profile: who is signed in and as what, language, password and log out. */
export default function OfficeProfile() {
  const { t, i18n } = useTranslation();
  const user = useSession((s) => s.user);
  const role = useSession((s) => s.role);
  const signOut = useSession((s) => s.signOut);

  const confirmLogout = () =>
    Alert.alert(t('profile.logoutConfirm'), t('profile.logoutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.logout'), style: 'destructive', onPress: () => void signOut() },
    ]);

  return (
    <OfficeScreen title={user?.displayName ?? t('office.nav.profile')} subtitle={role ? t(`office.role.${role}`) : undefined} testID="office-profile">
      <Card style={styles.flush}>
        <Row label={t('office.signInId')} value={user?.email ?? user?.phone ?? '—'} />
        <View style={styles.divider} />
        <Row label={t('office.roleLabel')} value={role ? t(`office.role.${role}`) : '—'} />
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

      <ChangePasswordCard testIDPrefix="office" />

      <Pressable accessibilityRole="button" onPress={confirmLogout} style={({ pressed }) => [styles.logout, pressed && { opacity: 0.85 }]} testID="office-logout">
        <AppText tone="danger" variant="h2">{t('profile.logout')}</AppText>
      </Pressable>
    </OfficeScreen>
  );
}

const styles = StyleSheet.create({
  flush: { paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
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
  logout: { minHeight: TOUCH_TARGET + 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.dangerSoft },
});
