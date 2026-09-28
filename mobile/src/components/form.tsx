import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { displayDate, fromIsoDate, isoDate } from '../lib/dates';
import { chooseFromGallery, takePhoto, type ReceiptPurpose } from '../lib/receipts/capture';
import { discardReceipt, type LocalReceipt } from '../lib/receipts/storage';
import { colors, radius, spacing, TOUCH_TARGET, typography } from '../theme/tokens';
import { AppText } from './ui';

/**
 * Form pieces for the driver's daily updates. Large targets, one field per row, errors in the
 * driver's language right under the field they belong to.
 */

export function Field({ label, error, optional, children }: { label: string; error?: string; optional?: boolean; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <View style={styles.field}>
      <AppText variant="label" tone="muted">
        {label}
        {optional ? ` (${t('daily.optional')})` : ''}
      </AppText>
      {children}
      {error ? (
        <AppText variant="label" tone="danger" testID={`error-${label}`}>
          {t(error)}
        </AppText>
      ) : null}
    </View>
  );
}

export function TextField({ invalid, style, ...props }: TextInputProps & { invalid?: boolean }) {
  return (
    <TextInput
      placeholderTextColor={colors.mutedForeground}
      maxFontSizeMultiplier={typography.maxFontSizeMultiplier}
      style={[styles.input, invalid && styles.inputInvalid, style]}
      {...props}
    />
  );
}

/** Two-way choice (petrol / diesel) as large buttons rather than a dropdown. */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  testIDPrefix?: string;
}) {
  return (
    <View style={styles.choiceRow}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            testID={testIDPrefix ? `${testIDPrefix}-${option.value}` : undefined}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && { opacity: 0.85 }]}
          >
            <AppText variant="h2" tone={selected ? 'inverse' : 'default'}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A date that defaults to today and opens the phone's own date picker on tap. The value is a
 * YYYY-MM-DD string; what the driver sees is "19 September 2026" in their language.
 */
export function DateField({
  value,
  onChange,
  maximumToday = true,
  testID,
}: {
  value: string | null;
  onChange: (value: string) => void;
  maximumToday?: boolean;
  testID?: string;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  const onPicked = (event: DateTimePickerEvent, date?: Date) => {
    setOpen(false);
    if (event.type === 'set' && date) onChange(isoDate(date));
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={value ? displayDate(value, i18n.language) : t('daily.chooseDate')}
        testID={testID}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.input, styles.dateRow, pressed && { opacity: 0.85 }]}
      >
        <AppText>{value ? displayDate(value, i18n.language) : t('daily.chooseDate')}</AppText>
        <AppText variant="label" tone="success">
          {t('daily.change')}
        </AppText>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={value ? fromIsoDate(value) : new Date()}
          mode="date"
          display="default"
          maximumDate={maximumToday ? new Date() : undefined}
          onChange={onPicked}
        />
      ) : null}
    </View>
  );
}

/**
 * Receipt capture: take a photo or choose one, then preview, replace or remove it before
 * saving. The driver never chooses a size or a format — that is handled for them.
 */
export function ReceiptField({
  purpose,
  receipt,
  onChange,
}: {
  purpose: ReceiptPurpose;
  receipt: LocalReceipt | null;
  onChange: (receipt: LocalReceipt | null) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const capture = async (source: 'camera' | 'gallery') => {
    setBusy(true);
    try {
      const result = source === 'camera' ? await takePhoto(purpose) : await chooseFromGallery(purpose);
      if (result.status === 'denied') Alert.alert(t('daily.receipt'), t('daily.cameraDenied'));
      if (result.status === 'ok') {
        // Replacing a photo removes the one it replaces from the phone.
        discardReceipt(receipt?.uri);
        onChange(result.receipt);
      }
    } finally {
      setBusy(false);
    }
  };

  if (receipt) {
    return (
      <View style={styles.preview}>
        <Image source={{ uri: receipt.uri }} style={styles.previewImage} resizeMode="cover" accessibilityLabel={t('daily.receipt')} />
        <View style={styles.previewActions}>
          <Pressable accessibilityRole="button" onPress={() => void capture('camera')} style={styles.smallButton} disabled={busy}>
            <AppText tone="success">{t('daily.replace')}</AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            testID="receipt-remove"
            onPress={() => {
              discardReceipt(receipt.uri);
              onChange(null);
            }}
            style={styles.smallButton}
          >
            <AppText tone="danger">{t('daily.remove')}</AppText>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.receiptButtons}>
      <Pressable accessibilityRole="button" testID="receipt-camera" onPress={() => void capture('camera')} disabled={busy} style={({ pressed }) => [styles.receiptButton, pressed && { opacity: 0.85 }]}>
        <AppText variant="h2">📷</AppText>
        <AppText numberOfLines={2} style={styles.receiptLabel}>
          {t('daily.takePhoto')}
        </AppText>
      </Pressable>
      <Pressable accessibilityRole="button" testID="receipt-gallery" onPress={() => void capture('gallery')} disabled={busy} style={({ pressed }) => [styles.receiptButton, pressed && { opacity: 0.85 }]}>
        <AppText variant="h2">🖼️</AppText>
        <AppText numberOfLines={2} style={styles.receiptLabel}>
          {t('daily.chooseGallery')}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  input: {
    minHeight: TOUCH_TARGET + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    fontSize: 18,
    color: colors.foreground,
  },
  inputInvalid: { borderColor: colors.danger },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  choiceRow: { flexDirection: 'row', gap: spacing.md },
  choice: {
    flex: 1,
    minHeight: TOUCH_TARGET + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.sm,
  },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  receiptButtons: { flexDirection: 'row', gap: spacing.md },
  receiptButton: {
    flex: 1,
    minHeight: TOUCH_TARGET * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing.sm,
  },
  receiptLabel: { textAlign: 'center' },
  preview: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  previewImage: { width: '100%', height: 200, backgroundColor: colors.muted },
  previewActions: { flexDirection: 'row', justifyContent: 'space-around' },
  smallButton: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.lg },
});
