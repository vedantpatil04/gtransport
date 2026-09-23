import { Image } from 'react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, PrimaryButton } from '../../components/ui';
import { ApiError } from '../../lib/api/client';
import { NotADriverError, useSession } from '../../lib/auth/session-store';
import { useNetwork } from '../../lib/offline/useNetwork';
import { colors, radius, spacing, TOUCH_TARGET, typography } from '../../theme/tokens';

/**
 * Driver sign-in, deliberately plain: mobile number, then passcode.
 *
 * The backend authenticates an identifier and password, so the passcode step uses that. A
 * one-tap OTP flow would need an SMS provider and a backend endpoint that do not exist yet.
 */
export default function LoginScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const signIn = useSession((s) => s.signIn);
  const expired = useSession((s) => s.expiredMessage);
  const { online } = useNetwork();

  const [step, setStep] = useState<'mobile' | 'passcode'>('mobile');
  const [mobile, setMobile] = useState('');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = mobile.replace(/\D/g, '');

  const goToPasscode = () => {
    if (digits.length < 10) return setError(t('login.errMobile'));
    setError(null);
    setStep('passcode');
  };

  const submit = async () => {
    if (!passcode) return setError(t('login.errPasscode'));
    if (!online) return setError(t('login.errOffline'));

    setBusy(true);
    setError(null);
    try {
      await signIn(digits, passcode);
    } catch (cause) {
      if (cause instanceof NotADriverError) setError(t('login.errNotDriver'));
      else if (cause instanceof ApiError && cause.kind === 'unauthorized') setError(t('login.errInvalid'));
      else if (cause instanceof ApiError && (cause.kind === 'network' || cause.kind === 'timeout')) setError(t('states.errorBody'));
      else setError(cause instanceof ApiError ? cause.message : t('states.errorBody'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Image source={require('../../../assets/branding/mark.png')} style={styles.mark} resizeMode="contain" accessible={false} />
          <AppText variant="h1" style={styles.brandName}>{t('login.title')}</AppText>
          <AppText tone="muted" style={{ marginTop: spacing.xs }}>{t('login.subtitle')}</AppText>
        </View>

        {expired && (
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <AppText tone="warning">{t('states.sessionExpired')}</AppText>
          </View>
        )}

        {step === 'mobile' ? (
          <View style={styles.field}>
            <AppText variant="label" tone="muted">{t('login.mobileNumber')}</AppText>
            <TextInput
              style={styles.input}
              value={mobile}
              onChangeText={setMobile}
              keyboardType="phone-pad"
              autoComplete="tel"
              inputMode="tel"
              maxLength={13}
              placeholder="98450 12345"
              placeholderTextColor={colors.mutedForeground}
              maxFontSizeMultiplier={typography.maxFontSizeMultiplier}
              onSubmitEditing={goToPasscode}
              returnKeyType="next"
              testID="login-mobile"
              accessibilityLabel={t('login.mobileNumber')}
            />
            <AppText variant="label" tone="muted" style={{ marginTop: spacing.xs }}>{t('login.mobileHint')}</AppText>
          </View>
        ) : (
          <View style={styles.field}>
            <AppText variant="label" tone="muted">{t('login.passcode')}</AppText>
            <TextInput
              style={styles.input}
              value={passcode}
              onChangeText={setPasscode}
              secureTextEntry
              autoFocus
              maxFontSizeMultiplier={typography.maxFontSizeMultiplier}
              onSubmitEditing={submit}
              returnKeyType="go"
              testID="login-passcode"
              accessibilityLabel={t('login.passcode')}
            />
            <AppText variant="label" tone="muted" style={{ marginTop: spacing.xs }}>{t('login.passcodeHint')}</AppText>
            <Pressable
              onPress={() => {
                setStep('mobile');
                setPasscode('');
                setError(null);
              }}
              style={styles.linkButton}
              accessibilityRole="button"
            >
              <AppText tone="muted">{t('login.changeNumber')} · +91 {digits}</AppText>
            </Pressable>
          </View>
        )}

        {error && (
          <View style={styles.error} accessibilityLiveRegion="assertive">
            <AppText tone="danger">{error}</AppText>
          </View>
        )}

        {!online && (
          <View style={styles.notice}>
            <AppText tone="warning">{t('states.offline')}</AppText>
          </View>
        )}

        <PrimaryButton
          label={step === 'mobile' ? t('login.continue') : t('login.signIn')}
          onPress={step === 'mobile' ? goToPasscode : submit}
          busy={busy}
          testID="login-submit"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  mark: { width: 96, height: 96 },
  brandName: { marginTop: spacing.md, textAlign: 'center' },
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
  linkButton: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  notice: { backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: spacing.md },
  error: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md },
});
