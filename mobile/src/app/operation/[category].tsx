import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { SavedView } from '../../components/SavedView';
import { DateField, Field, ReceiptField, TextField } from '../../components/form';
import { AppText, EmptyView, PrimaryButton } from '../../components/ui';
import { submitOperation, type SubmitOutcome } from '../../features/daily/submissions';
import { hasErrors, parseAmount, validateOperation, type FieldErrors, type OperationForm } from '../../features/daily/validation';
import { useSession } from '../../lib/auth/session-store';
import { todayIso } from '../../lib/dates';
import type { LocalReceipt } from '../../lib/receipts/storage';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';
import type { OperationCategory } from '../../types/domain';

/** Route segment → API category, title and vendor label. Tyre insurance has its own screen. */
const CATEGORIES: Record<string, { category: OperationCategory; title: string; vendor: string }> = {
  rto: { category: 'RTO', title: 'daily.rto', vendor: 'daily.vendorRto' },
  tyre: { category: 'TYRE', title: 'daily.tyre', vendor: 'daily.vendorTyre' },
  maintenance: { category: 'MAINTENANCE', title: 'daily.maintenance', vendor: 'daily.vendorMaintenance' },
};

/**
 * RTO, tyre and maintenance/service entries. The vehicle is the driver's assigned vehicle; the
 * driver only enters what was paid, when, where and (optionally) what for. Receipts are kept
 * at full quality: service receipts are what the later AI receipt phase will read.
 */
export default function OperationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { category: segment } = useLocalSearchParams<{ category: string }>();
  const config = CATEGORIES[String(segment)];
  const vehicle = useSession((s) => s.driver?.currentAssignment?.vehicle ?? null);

  const [submissionId] = useState(() => randomUUID());
  const [form, setForm] = useState<OperationForm>({ amount: '', date: todayIso(), vendorName: '', description: '' });
  const [receipt, setReceipt] = useState<LocalReceipt | null>(null);
  const [errors, setErrors] = useState<FieldErrors<keyof OperationForm>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);

  if (!config) return <EmptyView title={t('states.errorTitle')} />;

  const set = <K extends keyof OperationForm>(key: K, value: OperationForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = async () => {
    const found = validateOperation(form);
    setErrors(found);
    if (hasErrors(found) || busy) return;
    setBusy(true);
    try {
      setOutcome(
        await submitOperation(
          {
            category: config.category,
            amount: parseAmount(form.amount),
            expenseDate: form.date,
            ...(form.vendorName.trim() ? { vendorName: form.vendorName.trim() } : {}),
            ...(form.description.trim() ? { description: form.description.trim() } : {}),
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
          {t(config.title)}
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

        <Field label={t('daily.amount')} error={errors.amount}>
          <View style={styles.prefixed}>
            <AppText variant="h2" style={styles.prefix}>
              ₹
            </AppText>
            <TextField
              testID="op-amount"
              value={form.amount}
              onChangeText={(value) => set('amount', value)}
              keyboardType="decimal-pad"
              inputMode="decimal"
              invalid={Boolean(errors.amount)}
              style={styles.flex}
              accessibilityLabel={t('daily.amount')}
            />
          </View>
        </Field>

        <Field label={t('daily.date')} error={errors.date}>
          <DateField testID="op-date" value={form.date} onChange={(value) => set('date', value)} />
        </Field>

        <Field label={t(config.vendor)} optional>
          <TextField testID="op-vendor" value={form.vendorName} onChangeText={(value) => set('vendorName', value)} autoCapitalize="words" />
        </Field>

        <Field label={t('daily.description')} optional>
          <TextField
            testID="op-description"
            value={form.description}
            onChangeText={(value) => set('description', value)}
            multiline
            style={styles.multiline}
          />
        </Field>

        <Field label={t('daily.receipt')} optional>
          <ReceiptField purpose="document" receipt={receipt} onChange={setReceipt} />
        </Field>

        <PrimaryButton label={busy ? t('daily.saving') : t('daily.save')} onPress={() => void save()} busy={busy} testID="op-save" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xs },
  back: { minHeight: TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
  body: { padding: spacing.lg, gap: spacing.lg },
  prefixed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prefix: { width: 20 },
  multiline: { minHeight: TOUCH_TARGET * 2, paddingTop: spacing.md, textAlignVertical: 'top' },
  rejected: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md },
});
