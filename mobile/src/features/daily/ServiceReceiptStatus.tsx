import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText, Card, Loading } from '../../components/ui';
import { useSession } from '../../lib/auth/session-store';
import { displayDate } from '../../lib/dates';
import { rupees } from '../../lib/format';
import { serviceReceiptsApi, type DriverReceiptState, type DriverServiceReceipt } from '../../lib/api/receipts';
import { colors, radius, spacing } from '../../theme/tokens';

/**
 * What became of the service bills this driver photographed.
 *
 * The point of the screen is reassurance, and the honest kind. A driver who uploads a bill at a
 * garage has no way of knowing whether it arrived, so each one says where it has got to in plain
 * words — and nothing more. There is no confidence figure, no model name, no mention of a queue:
 * those belong to whoever is checking the bill, and a driver could not act on them anyway.
 *
 * "Needs checking" is the office's job, not the driver's, and says so. "Could not be read" is
 * about the photograph, not about the money — the expense is recorded either way — so the text is
 * careful never to suggest a claim was refused.
 */

const TONE: Record<DriverReceiptState, { dot: string; tone: 'success' | 'warning' | 'danger' | 'muted' }> = {
  uploaded: { dot: colors.mutedForeground, tone: 'muted' },
  processing: { dot: colors.warning, tone: 'warning' },
  needsReview: { dot: colors.warning, tone: 'warning' },
  verified: { dot: colors.success, tone: 'success' },
  failed: { dot: colors.danger, tone: 'danger' },
};

export function ServiceReceiptStatus() {
  const { t, i18n } = useTranslation();
  const token = useSession((s) => s.token);
  const [receipts, setReceipts] = useState<DriverServiceReceipt[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const page = await serviceReceiptsApi.mine(token, 10);
      setReceipts(page.data);
      setFailed(false);
    } catch {
      // A list that will not load is not worth an alarm on this screen: the entries themselves are
      // safely on the server, and the driver has nothing to do about a failed fetch.
      setFailed(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed || (receipts !== null && receipts.length === 0)) return null;
  if (receipts === null) return <Loading label={t('receipts.loading')} />;

  return (
    <View style={styles.section} testID="service-receipts">
      <AppText variant="h2">{t('receipts.title')}</AppText>
      {receipts.map((receipt) => {
        const tone = TONE[receipt.state];
        return (
          <Card key={receipt.id} style={[styles.card, { borderLeftColor: tone.dot }]} testID={`service-receipt-${receipt.id}`}>
            <View style={styles.flex}>
              <AppText variant="h2">{rupees(receipt.amount)}</AppText>
              <AppText tone="muted" numberOfLines={1}>
                {receipt.vendorName ?? receipt.vehicleRegistration}
                {receipt.serviceDate ? ` · ${displayDate(receipt.serviceDate, i18n.language)}` : ''}
              </AppText>
              {/* One line saying what, if anything, is expected of them. */}
              <AppText variant="label" tone="muted" style={styles.hint}>
                {t(`receipts.hint.${receipt.state}`)}
              </AppText>
            </View>
            <AppText variant="label" tone={tone.tone} style={styles.state}>
              {t(`receipts.state.${receipt.state}`)}
            </AppText>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  flex: { flex: 1 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, borderLeftWidth: 4, borderRadius: radius.md },
  state: { textAlign: 'right', maxWidth: 110 },
  hint: { marginTop: spacing.xs },
});
