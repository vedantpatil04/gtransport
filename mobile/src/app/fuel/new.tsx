import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/OfflineBanner';
import { Choice, DateField, Field, ReceiptField, TextField } from '../../components/form';
import { SavedView } from '../../components/SavedView';
import { AppText, PrimaryButton } from '../../components/ui';
import { submitFuel, type SubmitOutcome } from '../../features/daily/submissions';
import { hasErrors, parseAmount, validateFuel, type FieldErrors, type FuelForm } from '../../features/daily/validation';
import { fuelApi } from '../../lib/api/operations';
import { useSession } from '../../lib/auth/session-store';
import { todayIso } from '../../lib/dates';
import type { LocalReceipt } from '../../lib/receipts/storage';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

/**
 * Petrol / Diesel — the driver's most-used screen. Only the fields the office needs: fuel type,
 * amount, litres, station, date (today unless changed) and a receipt photo. The vehicle and the
 * driver are known from the session and are never asked for; the rate is worked out by the
 * server from amount ÷ litres.
 */
export default function NewFuelScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const token = useSession((s) => s.token);
  const vehicle = useSession((s) => s.driver?.currentAssignment?.vehicle ?? null);

  // One id per form: a double tap or an automatic retry is the same submission to the server.
  const [submissionId] = useState(() => randomUUID());
  const [form, setForm] = useState<FuelForm>({ fuelType: null, amount: '', litres: '', fuelStation: '', date: todayIso() });
  const [receipt, setReceipt] = useState<LocalReceipt | null>(null);
  const [errors, setErrors] = useState<FieldErrors<keyof FuelForm>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [stations, setStations] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;
    fuelApi.stations(token).then(setStations).catch(() => setStations([]));
  }, [token]);

  const set = <K extends keyof FuelForm>(key: K, value: FuelForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = async () => {
    const found = validateFuel(form);
    setErrors(found);
    if (hasErrors(found) || busy) return;

    setBusy(true);
    try {
      const result = await submitFuel(
        {
          fuelType: form.fuelType!,
          amount: parseAmount(form.amount),
          litres: parseAmount(form.litres),
          fuelStation: form.fuelStation.trim(),
          transactionDate: form.date,
          clientSubmissionId: submissionId,
        },
        receipt,
      );
      setOutcome(result);
    } finally {
      setBusy(false);
    }
  };

  if (outcome && outcome !== 'rejected') {
    return (
      <SavedView
        pending={outcome === 'pending'}
        onDone={() => router.back()}
        onHistory={() => router.replace('/fuel/history')}
      />
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <AppText tone="inverse">‹ {t('common.back')}</AppText>
        </Pressable>
        <AppText variant="h1" tone="inverse">
          {t('daily.fuelTitle')}
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
          <View style={styles.rejected} accessibilityLiveRegion="assertive">
            <AppText tone="danger">{t('daily.rejected')}</AppText>
          </View>
        ) : null}

        <Field label={t('daily.fuelType')} error={errors.fuelType}>
          <Choice
            testIDPrefix="fuel-type"
            value={form.fuelType}
            onChange={(value) => set('fuelType', value)}
            options={[
              { value: 'PETROL', label: t('daily.petrol') },
              { value: 'DIESEL', label: t('daily.diesel') },
            ]}
          />
        </Field>

        <Field label={t('daily.amount')} error={errors.amount}>
          <View style={styles.prefixed}>
            <AppText variant="h2" style={styles.prefix}>
              ₹
            </AppText>
            <TextField
              testID="fuel-amount"
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

        <Field label={t('daily.litres')} error={errors.litres}>
          <TextField
            testID="fuel-litres"
            value={form.litres}
            onChangeText={(value) => set('litres', value)}
            keyboardType="decimal-pad"
            inputMode="decimal"
            invalid={Boolean(errors.litres)}
            accessibilityLabel={t('daily.litres')}
          />
        </Field>

        <Field label={t('daily.station')} error={errors.fuelStation}>
          <TextField
            testID="fuel-station"
            value={form.fuelStation}
            onChangeText={(value) => set('fuelStation', value)}
            placeholder={t('daily.stationHint')}
            autoCapitalize="words"
            invalid={Boolean(errors.fuelStation)}
            accessibilityLabel={t('daily.station')}
          />
          {stations.length > 0 ? (
            <View style={styles.chips}>
              {stations.map((station) => (
                <Pressable
                  key={station}
                  accessibilityRole="button"
                  onPress={() => set('fuelStation', station)}
                  style={({ pressed }) => [styles.chip, pressed && { opacity: 0.8 }]}
                >
                  <AppText variant="label" numberOfLines={1}>
                    {station}
                  </AppText>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Field>

        <Field label={t('daily.date')} error={errors.date}>
          <DateField testID="fuel-date" value={form.date} onChange={(value) => set('date', value)} />
        </Field>

        <Field label={t('daily.receipt')} optional>
          <ReceiptField purpose="fuel" receipt={receipt} onChange={setReceipt} />
        </Field>

        <PrimaryButton label={busy ? t('daily.saving') : t('daily.saveFuel')} onPress={() => void save()} busy={busy} testID="fuel-save" />
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.muted,
    maxWidth: 200,
  },
  rejected: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md },
});
