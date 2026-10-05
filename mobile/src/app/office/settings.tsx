import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Card, Row } from '../../components/ui';
import {
  ModuleGuard,
  OfficeScreen,
  officeStyles,
  Pill,
} from '../../features/office/ui';
import { LANGUAGES, setLanguage, type LanguageCode } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import { API_URL, APP_ENV } from '../../lib/config';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

function OfficeSettingsBody() {
  const { t, i18n } = useTranslation();
  const user = useSession((s) => s.user);
  const role = useSession((s) => s.role);
  const signOut = useSession((s) => s.signOut);

  const confirmSignOut = () => {
    Alert.alert(
      t('profile.logoutConfirm', { defaultValue: 'Sign out' }),
      t('profile.logoutBody', { defaultValue: 'Are you sure you want to sign out?' }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('profile.logout', { defaultValue: 'Sign Out' }),
          style: 'destructive',
          onPress: () => void signOut(),
        },
      ],
    );
  };

  return (
    <OfficeScreen
      title={t('office.nav.settings', { defaultValue: 'Settings' })}
      subtitle="Administration & System Preferences"
      testID="office-settings"
    >
      {/* User / Session Profile */}
      <AppText variant="h2">Account Information</AppText>
      <Card style={{ gap: spacing.sm }} testID="settings-account-card">
        <Row label="Name" value={user?.displayName ?? '—'} />
        <View style={styles.divider} />
        <Row label="Role" value={role ?? '—'} />
        <View style={styles.divider} />
        <Row label="Email" value={user?.email ?? '—'} />
        <View style={styles.divider} />
        <Row label="Phone" value={user?.phone ?? '—'} />
      </Card>

      {/* Language Preferences */}
      <AppText variant="h2" style={{ marginTop: spacing.md }}>
        Language / भाषा / ಭಾಷೆ
      </AppText>
      <Card style={{ padding: spacing.sm, gap: spacing.xs }} testID="settings-language-card">
        {LANGUAGES.map((lang) => {
          const isSelected = i18n.language === lang.code;
          return (
            <Pressable
              key={lang.code}
              accessibilityRole="button"
              onPress={() => void setLanguage(lang.code as LanguageCode)}
              style={[styles.langRow, isSelected && styles.langRowSelected]}
              testID={`settings-lang-${lang.code}`}
            >
              <View>
                <AppText style={[styles.langLabel, isSelected && { fontWeight: '700' }]}>
                  {lang.native}
                </AppText>
                <AppText variant="label" tone="muted">{lang.code.toUpperCase()}</AppText>
              </View>
              {isSelected && <Pill label="ACTIVE" tone="success" />}
            </Pressable>
          );
        })}
      </Card>

      {/* System Information */}
      <AppText variant="h2" style={{ marginTop: spacing.md }}>
        System Configuration
      </AppText>
      <Card style={{ gap: spacing.sm }} testID="settings-system-card">
        <Row label="Environment" value={APP_ENV.toUpperCase()} />
        <View style={styles.divider} />
        <Row label="API Server" value={API_URL || 'Default Localhost'} />
        <View style={styles.divider} />
        <Row label="Mobile Version" value="v0.1.0 (Build 57)" />
      </Card>

      {/* Sign Out Button */}
      <View style={{ marginTop: spacing.md }}>
        <Pressable
          accessibilityRole="button"
          onPress={confirmSignOut}
          style={styles.signOutBtn}
          testID="settings-sign-out"
        >
          <AppText tone="danger" style={{ fontWeight: '700' }}>
            🚪 Sign Out of Account
          </AppText>
        </Pressable>
      </View>
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
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  langRowSelected: {
    backgroundColor: colors.muted,
  },
  langLabel: {
    fontSize: 15,
  },
  signOutBtn: {
    minHeight: TOUCH_TARGET,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
