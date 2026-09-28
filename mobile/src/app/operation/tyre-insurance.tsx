import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { SavedView } from '../../components/SavedView';
import { DateField, Field, ReceiptField, TextField } from '../../components/form';
import { AppText, PrimaryButton } from '../../components/ui';
import { submitTyreInsurance, type SubmitOutcome } from '../../features/daily/submissions';
import { hasErrors, parseAmount, validateTyreInsurance, type FieldErrors, type TyreInsuranceForm } from '../../features/daily/validation';
import { useSession } from '../../lib/auth/session-store';
import type { LocalReceipt } from '../../lib/receipts/storage';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

/**
 * Tyre insurance is a policy with an expiry date, not a one-off expense, so it records the
 * insurer, policy number, premium and dates. It is stored as a document on the vehicle so the
 * compliance phase can warn before it lapses.
 */
export default function TyreInsuranceScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const vehicle = useSession((s) => s.driver?.currentAssignment?.vehicle ?? null);

  const [submissionId] = useState(() => randomUUID());
  const [form, setForm] = useState<TyreInsuranceForm>({ insurer: '', policyNumber: '', premium: '', startDate: null, expiryDate: null });
  const [receipt, setReceipt] = useState<LocalReceipt | null>(null);
  const [errors, setErrors] = useState<FieldErrors<keyof TyreInsuranceForm>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);

  const set = <K extends keyof TyreInsuranceForm>(key: K, value: TyreInsuranceForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = async () => {
    const found = validateTyreInsurance(form);
    setErrors(found);
    if (hasErrors(found) || busy) return;
    setBusy(true);
    try {
      setOutcome(
        await submitTyreInsurance(
          {
            insurer: form.insurer.trim(),
            ...(form.policyNumber.trim() ? { policyNumber: form.policyNumber.trim() } : {}),
            ...(form.premium.trim() ? { premium: parseAmount(form.premium) } : {}),
            ...(form.startDate ? { startDate: form.startDate } : {}),
            expiryDate: form.expiryDate!,
            clientSubmissionId: submissionId,
          },
          receipt,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  if (outcome && outcome !== 'rejected') {
    return <SavedView pending={outcome === 'pending'} onDone={() => router.back()} />;
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <AppText tone="inverse">‹ {t('common.back')}</AppText>
        </Pressable>
        <AppText variant="h1" tone="inverse">
          {t('daily.tyreInsurance')}
        </AppText>
        {vehicle ? (
          <AppText tone="inverse" style={{ opacity: 0.75 }}>
            {vehicle.registrationNumber}
          </AppText>
        ) : null}
      </View>
      <OfflineBanner />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xxl }]} keyboardShouldPersistTaps="handled">
        {outcome === 'rejected' ? (
          <View style={styles.rejected}>
            <AppText tone="danger">{t('daily.rejected')}</AppText>
          </View>
        ) : null}

        <Field label={t('daily.insurer')} error={errors.insurer}>
          <TextField testID="ti-insurer" value={form.insurer} onChangeText={(value) => set('insurer', value)} autoCapitalize="words" invalid={Boolean(errors.insurer)} />
        </Field>
        <Field label={t('daily.policyNumber')} optional>
          <TextField testID="ti-policy" value={form.policyNumber} onChangeText={(value) => set('policyNumber', value)} autoCapitalize="characters" />
        </Field>
        <Field label={t('daily.premium')} optional error={errors.premium}>
          <TextField testID="ti-premium" value={form.premium} onChangeText={(value) => set('premium', value)} keyboardType="decimal-pad" inputMode="decimal" />
        </Field>
        <Field label={t('daily.startDate')} optional error={errors.startDate}>
          <DateField value={form.startDate} onChange={(value) => set('startDate', value)} maximumToday={false} />
        </Field>
        <Field label={t('daily.expiryDate')} error={errors.expiryDate}>
          <DateField testID="ti-expiry" value={form.expiryDate} onChange={(value) => set('expiryDate', value)} maximumToday={false} />
        </Field>
        <Field label={t('daily.receipt')} optional>
          <ReceiptField purpose="document" receipt={receipt} onChange={setReceipt} />
        </Field>

        <PrimaryButton label={busy ? t('daily.saving') : t('daily.save')} onPress={() => void save()} busy={busy} testID="ti-save" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xs },
  back: { minHeight: TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
  body: { padding: spacing.lg, gap: spacing.lg },
  rejected: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md },
});
