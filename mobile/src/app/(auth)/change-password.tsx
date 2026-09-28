import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, PrimaryButton } from '../../components/ui';
import { ApiError } from '../../lib/api/client';
import { useSession } from '../../lib/auth/session-store';
import { useNetwork } from '../../lib/offline/useNetwork';
import { colors, radius, spacing, TOUCH_TARGET, typography } from '../../theme/tokens';

const MIN_LENGTH = 8;

/**
 * First sign-in with a temporary password (a new account, or one the office reset). The API
 * allows nothing else until a new password is set, so the app shows nothing else either.
 */
export default function ChangePasswordScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { online } = useNetwork();
  const name = useSession((s) => s.user?.displayName ?? '');
  const changePassword = useSession((s) => s.changePassword);
  const signOut = useSession((s) => s.signOut);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!current || !next) return setError(t('password.errMissing'));
    if (next.length < MIN_LENGTH) return setError(t('password.rules'));
    if (next !== repeat) return setError(t('password.errRepeat'));
    if (!online) return setError(t('login.errOffline'));
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      // The gate sees the new session and opens the right app.
    } catch (cause) {
      if (cause instanceof ApiError && cause.fields.currentPassword) setError(t('password.errCurrent'));
      else if (cause instanceof ApiError && cause.fields.newPassword) setError(t('password.rules'));
      else if (cause instanceof ApiError && (cause.kind === 'network' || cause.kind === 'timeout')) setError(t('states.errorBody'));
      else setError(t('states.errorBody'));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void, testID: string, last = false) => (
    <View style={styles.field}>
      <AppText variant="label" tone="muted">{label}</AppText>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        maxFontSizeMultiplier={typography.maxFontSizeMultiplier}
        onSubmitEditing={last ? submit : undefined}
        returnKeyType={last ? 'go' : 'next'}
        testID={testID}
        accessibilityLabel={label}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Image source={require('../../../assets/branding/mark.png')} style={styles.mark} resizeMode="contain" accessible={false} />
          <AppText variant="h1" style={styles.title}>{t('password.title')}</AppText>
          <AppText tone="muted" style={styles.center}>{t('password.body', { name })}</AppText>
        </View>

        {field(t('password.current'), current, setCurrent, 'password-current')}
        {field(t('password.new'), next, setNext, 'password-new')}
        <AppText variant="label" tone="muted">{t('password.rules')}</AppText>
        {field(t('password.repeat'), repeat, setRepeat, 'password-repeat', true)}

        {error && (
          <View style={styles.error} accessibilityLiveRegion="assertive">
            <AppText tone="danger">{error}</AppText>
          </View>
        )}

        <PrimaryButton label={t('password.save')} onPress={submit} busy={busy} testID="password-submit" />
        <Pressable onPress={() => void signOut()} style={styles.link} accessibilityRole="button">
          <AppText tone="muted">{t('profile.logout')}</AppText>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  brand: { alignItems: 'center', marginBottom: spacing.lg },
  mark: { width: 72, height: 72 },
  title: { marginTop: spacing.md, textAlign: 'center' },
  center: { textAlign: 'center', marginTop: spacing.xs },
  field: { gap: spacing.xs },
  input: {
    minHeight: TOUCH_TARGET + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    fontSize: 20,
    color: colors.foreground,
  },
  error: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md },
  link: { minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
});
