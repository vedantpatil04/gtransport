import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText, Card } from '../../components/ui';
import { seesPayroll } from '../../features/office/modules';
import {
  DASH,
  LoadError,
  ModuleGuard,
  OfficeScreen,
  officeStyles,
  StatTile,
  useOfficeData,
} from '../../features/office/ui';
import { officeApi } from '../../lib/api/office';
import { quantity, rupees } from '../../lib/format';
import { useSession } from '../../lib/auth/session-store';
import { colors, spacing } from '../../theme/tokens';

/**
 * A read-only management summary for office roles on the phone.
 *
 * Full reports and their PDF, Excel and CSV exports are produced by the server from the office
 * web console; the phone does not pretend to generate files it cannot deliver. Payroll figures
 * are requested only for the roles the API shows them to, so a manager never sees a refusal.
 */
function OfficeReportsBody() {
  const { t } = useTranslation();
  const role = useSession((s) => s.role);
  const payroll = seesPayroll(role);
  const fuel = useOfficeData(officeApi.fuelSummary);
  const finance = useOfficeData(officeApi.financeSummary, [], payroll);
  const compliance = useOfficeData(officeApi.compliance);

  const rows = compliance.data ?? [];
  const expired = rows.reduce((n, r) => n + r.expired, 0);
  const soon = rows.reduce((n, r) => n + r.within7Days, 0);
  const valid = rows.reduce((n, r) => n + r.valid, 0);

  const refreshAll = useCallback(async () => {
    await Promise.all([fuel.reload(), payroll ? finance.reload() : Promise.resolve(), compliance.reload()]);
  }, [fuel, finance, compliance, payroll]);

  const anyError = fuel.error || finance.error || compliance.error;

  return (
    <OfficeScreen
      title={t('office.nav.reports')}
      subtitle={t('office.reports.subtitle')}
      onRefresh={() => void refreshAll()}
      refreshing={fuel.refreshing || finance.refreshing || compliance.refreshing}
      testID="office-reports"
    >
      {anyError && <LoadError error={anyError} onRetry={() => void refreshAll()} />}

      <AppText variant="h2" style={{ marginTop: spacing.xs }}>
        {t('office.reports.fuelTitle')}
      </AppText>

      <StatTile
        hero
        label={t('office.reports.fuelYear')}
        value={fuel.data ? rupees(fuel.data.financialYear.amount) : DASH}
        sub={fuel.data ? t('office.litresEntries', { litres: quantity(fuel.data.financialYear.litres, 1), count: fuel.data.financialYear.entries }) : undefined}
        testID="reports-fuel-year"
      />

      <View style={officeStyles.grid}>
        <View style={officeStyles.half}>
          <StatTile
            label={t('office.fuelToday')}
            value={fuel.data ? rupees(fuel.data.today.amount) : DASH}
            sub={fuel.data ? t('office.litresEntries', { litres: quantity(fuel.data.today.litres, 1), count: fuel.data.today.entries }) : undefined}
          />
        </View>
        <View style={officeStyles.half}>
          <StatTile
            label={t('office.fuelMonth')}
            value={fuel.data ? rupees(fuel.data.month.amount) : DASH}
            sub={fuel.data ? t('office.litresEntries', { litres: quantity(fuel.data.month.litres, 1), count: fuel.data.month.entries }) : undefined}
          />
        </View>
      </View>

      {payroll && (
        <>
          <AppText variant="h2" style={{ marginTop: spacing.md }}>
            {t('office.reports.financeTitle')}
          </AppText>
          <Card style={{ gap: spacing.sm }} testID="reports-finance-summary">
            <View style={styles.metricRow}>
              <AppText tone="muted">{t('office.reports.income')}</AppText>
              <AppText style={{ fontWeight: '700' }}>{finance.data ? rupees(finance.data.totalIncome) : DASH}</AppText>
            </View>
            <View style={styles.metricRow}>
              <AppText tone="muted">{t('office.reports.expenses')}</AppText>
              <AppText style={{ fontWeight: '700', color: colors.danger }}>{finance.data ? rupees(finance.data.totalExpenses) : DASH}</AppText>
            </View>
            <View style={styles.metricRow}>
              <AppText tone="muted">{t('office.reports.salariesAdvances')}</AppText>
              <AppText style={{ fontWeight: '700' }}>
                {finance.data ? rupees(String(Number(finance.data.salaries) + Number(finance.data.advances))) : DASH}
              </AppText>
            </View>
            <View style={styles.metricRow}>
              <AppText tone="muted">{t('office.reports.pendingPayments')}</AppText>
              <AppText style={{ fontWeight: '700', color: colors.warning }}>
                {finance.data ? t('office.reports.pendingValue', { count: finance.data.pendingPayments.count, amount: rupees(finance.data.pendingPayments.amount) }) : DASH}
              </AppText>
            </View>
          </Card>
        </>
      )}

      <AppText variant="h2" style={{ marginTop: spacing.md }}>
        {t('office.reports.complianceTitle')}
      </AppText>

      <View style={officeStyles.grid} testID="reports-compliance-summary">
        <View style={officeStyles.half}>
          <StatTile label={t('office.reports.validDocuments')} value={compliance.data ? String(valid) : DASH} tone="success" />
        </View>
        <View style={officeStyles.half}>
          <StatTile
            label={t('office.reports.needsAttention')}
            value={compliance.data ? String(expired + soon) : DASH}
            tone={expired > 0 ? 'danger' : soon > 0 ? 'warning' : 'default'}
            sub={compliance.data ? t('office.reports.attentionSub', { expired, soon }) : undefined}
          />
        </View>
      </View>

      <Card testID="reports-export-note">
        <AppText tone="muted">{t('office.reports.exportNote')}</AppText>
      </Card>
    </OfficeScreen>
  );
}

export default function OfficeReports() {
  return (
    <ModuleGuard module="reports">
      <OfficeReportsBody />
    </ModuleGuard>
  );
}

const styles = StyleSheet.create({
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
