import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText, Card, PrimaryButton, Row } from '../../components/ui';
import { OfficeScreen } from '../../features/office/ui';
import { LANGUAGES, setLanguage, type LanguageCode } from '../../i18n';
import { ApiError } from '../../lib/api/client';
import { useSession } from '../../lib/auth/session-store';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

/** Office profile: who is signed in and as what, language, password and sign-out. */
export default function OfficeProfile() {
  const { t, i18n } = useTranslation();
  const user = useSession((s) => s.user);
  const role = useSession((s) => s.role);
  const signOut = useSession((s) => s.signOut);
  const changePassword = useSession((s) => s.changePassword);

  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);

  const confirmLogout = () =>
    Alert.alert(t('profile.logoutConfirm'), t('profile.logoutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.logout'), style: 'destructive', onPress: () => void signOut() },
    ]);

  const save = async () => {
    if (next.length < 8) return setMessage({ tone: 'danger', text: t('password.rules') });
    if (next !== repeat) return setMessage({ tone: 'danger', text: t('password.errRepeat') });
    setBusy(true);
    setMessage(null);
    try {
      await changePassword(current, next);
      setChanging(false);
      setCurrent('');
      setNext('');
      setRepeat('');
      setMessage({ tone: 'success', text: t('password.changed') });
    } catch (cause) {
      const text = cause instanceof ApiError && cause.fields.currentPassword ? t('password.errCurrent') : cause instanceof ApiError && cause.fields.newPassword ? t('password.rules') : t('states.errorBody');
      setMessage({ tone: 'danger', text });
    } finally {
      setBusy(false);
    }
  };

  const input = (label: string, value: string, onChange: (v: string) => void, testID: string) => (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="label" tone="muted">{label}</AppText>
      <TextInput style={styles.input} value={value} onChangeText={onChange} secureTextEntry autoCapitalize="none" autoCorrect={false} testID={testID} accessibilityLabel={label} />
    </View>
  );

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

      <Card style={{ gap: spacing.md }}>
        <Pressable accessibilityRole="button" onPress={() => setChanging((v) => !v)} style={styles.action} testID="office-change-password">
          <AppText variant="h2">{t('password.change')}</AppText>
        </Pressable>
        {changing && (
          <>
            {input(t('password.current'), current, setCurrent, 'office-password-current')}
            {input(t('password.new'), next, setNext, 'office-password-new')}
            <AppText variant="label" tone="muted">{t('password.rules')}</AppText>
            {input(t('password.repeat'), repeat, setRepeat, 'office-password-repeat')}
            <PrimaryButton label={t('password.save')} onPress={save} busy={busy} />
          </>
        )}
        {message && <AppText tone={message.tone}>{message.text}</AppText>}
      </Card>

      <Pressable accessibilityRole="button" onPress={confirmLogout} style={({ pressed }) => [styles.logout, pressed && { opacity: 0.85 }]} testID="office-logout">
        <AppText tone="danger">{t('profile.logout')}</AppText>
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
  action: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  input: {
    minHeight: TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    fontSize: 18,
    color: colors.foreground,
  },
  logout: { minHeight: TOUCH_TARGET + 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.dangerSoft },
});
