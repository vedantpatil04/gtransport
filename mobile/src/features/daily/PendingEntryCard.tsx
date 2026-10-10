import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Card } from '../../components/ui';
import { displayDate } from '../../lib/dates';
import { rupees } from '../../lib/format';
import { colors, spacing, TOUCH_TARGET } from '../../theme/tokens';
import { discardEntry, retryEntry, sendWithoutPhoto, type PendingEntry } from './submissions';

/**
 * One entry still on the phone. Three states, never blurred together:
 *   Syncing         being sent right now
 *   Waiting to sync it will retry by itself (with the reason it last could not), or retry now
 *   Failed          it needs the driver: retry, or discard
 * Synced entries are gone from here — they appear in the history, from the server.
 */
export function PendingEntryCard({ entry }: { entry: PendingEntry }) {
  const { t, i18n } = useTranslation();
  const failed = entry.state === 'REJECTED';
  const syncing = entry.state === 'SYNCING';

  const label = failed ? t('daily.failed') : syncing ? t('daily.sendingNow') : t('daily.pendingSync');
  const tone = failed ? 'danger' : syncing ? 'success' : 'warning';
  const detail = failed
    ? entry.reason
    : entry.attempts > 0 && !syncing
      ? [t('daily.willRetry'), entry.reason].filter(Boolean).join(' · ')
      : undefined;

  return (
    <Card style={[styles.card, failed ? styles.failed : syncing ? styles.syncing : styles.pending]} testID={`pending-entry-${entry.id}`}>
      <View style={styles.row}>
        <View style={styles.text}>
          <AppText variant="h2">{rupees(entry.amount)}</AppText>
          <AppText tone="muted" numberOfLines={1}>
            {entry.label} · {displayDate(entry.date, i18n.language)}
          </AppText>
        </View>
        <AppText variant="label" tone={tone} testID={`pending-state-${entry.id}`}>
          {label}
        </AppText>
      </View>

      {detail ? (
        <AppText variant="label" tone={failed ? 'danger' : 'muted'} testID={`pending-reason-${entry.id}`}>
          {detail}
        </AppText>
      ) : null}
      {entry.reference && (failed || entry.attempts > 0) ? (
        <AppText variant="label" tone="muted">
          {t('daily.reference', { id: entry.reference })}
        </AppText>
      ) : null}

      {!syncing && (failed || entry.attempts > 0) ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            testID={`pending-retry-${entry.id}`}
            onPress={() => void retryEntry(entry.id)}
            style={styles.action}
          >
            <AppText tone="success">{t('daily.retryNow')}</AppText>
          </Pressable>
          {entry.canSendWithoutPhoto ? (
            <Pressable
              accessibilityRole="button"
              testID={`pending-send-without-photo-${entry.id}`}
              onPress={() => void sendWithoutPhoto(entry.id)}
              style={styles.action}
            >
              <AppText tone="success">{t('daily.sendWithoutPhoto')}</AppText>
            </Pressable>
          ) : null}
          {failed ? (
            <Pressable
              accessibilityRole="button"
              testID={`pending-discard-${entry.id}`}
              onPress={() => void discardEntry(entry.id)}
              style={styles.action}
            >
              <AppText tone="danger">{t('daily.discard')}</AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, borderLeftWidth: 4 },
  pending: { borderLeftColor: colors.warning },
  syncing: { borderLeftColor: colors.success },
  failed: { borderLeftColor: colors.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.xl },
  action: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
});
