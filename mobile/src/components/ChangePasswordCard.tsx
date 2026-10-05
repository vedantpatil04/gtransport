import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ApiError } from '../lib/api/client';
import { useSession } from '../lib/auth/session-store';
import { useNetwork } from '../lib/offline/useNetwork';
import { colors, radius, spacing, TOUCH_TARGET, typography } from '../theme/tokens';
import { AppText, Card, PrimaryButton } from './ui';

const MIN_LENGTH = 8;

/**
 * Changing your own password from Profile — the same card for drivers and office staff, and the
 * same rules as the office console. The API checks the current password and the strength rules
 * and signs out other devices; this phone carries on with the fresh session it hands back.
 */
export function ChangePasswordCard({ testIDPrefix = 'profile' }: { testIDPrefix?: string }) {
  const { t } = useTranslation();
  const { online } = useNetwork();
  const changePassword = useSession((s) => s.changePassword);

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);

  const save = async () => {
    if (!current || !next) return setMessage({ tone: 'danger', text: t('password.errMissing') });
    if (next.length < MIN_LENGTH) return setMessage({ tone: 'danger', text: t('password.rules') });
    if (next !== repeat) return setMessage({ tone: 'danger', text: t('password.errRepeat') });
    if (!online) return setMessage({ tone: 'danger', text: t('password.errOffline') });
    setBusy(true);
    setMessage(null);
    try {
      await changePassword(current, next);
      setOpen(false);
      setCurrent('');
      setNext('');
      setRepeat('');
      setMessage({ tone: 'success', text: t('password.changed') });
    } catch (cause) {
      const text =
        cause instanceof ApiError && cause.fields.currentPassword
          ? t('password.errCurrent')
          : cause instanceof ApiError && cause.fields.newPassword
            ? t('password.rules')
            : t('states.errorBody');
      setMessage({ tone: 'danger', text });
    } finally {
      setBusy(false);
    }
  };

  const input = (label: string, value: string, onChange: (v: string) => void, testID: string) => (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="label" tone="muted">{label}</AppText>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        maxFontSizeMultiplier={typography.maxFontSizeMultiplier}
        testID={testID}
        accessibilityLabel={label}
      />
    </View>
  );

  return (
    <Card style={{ gap: spacing.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setOpen((v) => !v);
          setMessage(null);
        }}
        style={styles.action}
        testID={`${testIDPrefix}-change-password`}
      >
        <AppText variant="h2">{t('password.change')}</AppText>
        <AppText tone="muted">{open ? '−' : '›'}</AppText>
      </Pressable>
      {open && (
        <>
          {input(t('password.currentOnly'), current, setCurrent, `${testIDPrefix}-password-current`)}
          {input(t('password.new'), next, setNext, `${testIDPrefix}-password-new`)}
          <AppText variant="label" tone="muted">{t('password.rules')}</AppText>
          {input(t('password.repeat'), repeat, setRepeat, `${testIDPrefix}-password-repeat`)}
          <PrimaryButton label={t('password.save')} onPress={() => void save()} busy={busy} testID={`${testIDPrefix}-password-save`} />
        </>
      )}
      {message && (
        <AppText tone={message.tone} testID={`${testIDPrefix}-password-message`}>
          {message.text}
        </AppText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  action: { minHeight: TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
});
