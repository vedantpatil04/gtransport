import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { colors, radius, shadow, spacing, TOUCH_TARGET, typography } from '../theme/tokens';

/**
 * Small building blocks shared by the driver screens, in the approved visual language:
 * white cards on a light background, navy headers, large touch targets.
 *
 * Every Text caps font scaling so a driver with large system fonts and a long translation
 * still gets a usable layout.
 */

type TextVariant = 'h1' | 'h2' | 'body' | 'label' | 'figure';

export function AppText({
  children,
  style,
  variant = 'body',
  tone = 'default',
  numberOfLines,
  testID,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  variant?: TextVariant;
  tone?: 'default' | 'muted' | 'inverse' | 'success' | 'danger' | 'warning';
  numberOfLines?: number;
  testID?: string;
}) {
  const toneColor = {
    default: colors.foreground,
    muted: colors.mutedForeground,
    inverse: colors.primaryForeground,
    success: colors.success,
    danger: colors.danger,
    warning: colors.warning,
  }[tone];

  const preset = typography[variant];

  return (
    <Text
      maxFontSizeMultiplier={typography.maxFontSizeMultiplier}
      numberOfLines={numberOfLines}
      testID={testID}
      style={[{ fontSize: preset.fontSize, fontWeight: preset.fontWeight as TextStyle['fontWeight'], color: toneColor }, style]}
    >
      {children}
    </Text>
  );
}

export function Card({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy) }}
      testID={testID}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.primaryButton, (disabled || busy) && styles.buttonDisabled, pressed && styles.buttonPressed]}
    >
      {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <AppText variant="h2" tone="inverse">{label}</AppText>}
    </Pressable>
  );
}

/** A full-width row used for settings and list entries; meets the minimum touch target. */
export function Row({
  label,
  value,
  onPress,
  right,
  testID,
}: {
  label: string;
  value?: React.ReactNode;
  onPress?: () => void;
  right?: React.ReactNode;
  testID?: string;
}) {
  const content = (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        <AppText variant="label" tone="muted">{label}</AppText>
        {typeof value === 'string' ? <AppText style={{ marginTop: 2 }}>{value}</AppText> : value}
      </View>
      {right}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" testID={testID} onPress={onPress} style={({ pressed }) => [pressed && { backgroundColor: colors.muted }]}>
      {content}
    </Pressable>
  );
}

/** Number plate, matching the web app's plate treatment. */
export function Plate({ reg, size = 'md' }: { reg: string; size?: 'sm' | 'md' | 'lg' }) {
  const fontSize = { sm: 13, md: 16, lg: 20 }[size];
  return (
    <View style={styles.plate}>
      <Text maxFontSizeMultiplier={1.2} style={[styles.plateText, { fontSize }]}>
        {reg}
      </Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.centered} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.primary} size="large" />
      <AppText tone="muted" style={{ marginTop: spacing.md }}>{label ?? t('common.loading')}</AppText>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.centered}>
      <AppText variant="h2">{t('states.errorTitle')}</AppText>
      <AppText tone="muted" style={{ marginTop: spacing.sm, textAlign: 'center' }}>{message ?? t('states.errorBody')}</AppText>
      {onRetry && (
        <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>
          <PrimaryButton label={t('common.retry')} onPress={onRetry} testID="retry" />
        </View>
      )}
    </View>
  );
}

export function EmptyView({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.centered}>
      <AppText variant="h2" tone="muted">{title}</AppText>
      {hint ? <AppText tone="muted" style={{ marginTop: spacing.sm, textAlign: 'center' }}>{hint}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  primaryButton: {
    minHeight: TOUCH_TARGET + 4,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  row: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  rowLabel: { flex: 1 },
  plate: {
    backgroundColor: colors.plate,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#1A1A1A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  plateText: { fontWeight: '800', color: '#111111', letterSpacing: 0.5 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
});
