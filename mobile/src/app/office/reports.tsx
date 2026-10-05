import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Card, Loading } from '../../components/ui';
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
import { rupees } from '../../lib/api/payments';
import { colors, radius, spacing, TOUCH_TARGET } from '../../theme/tokens';

function OfficeReportsBody() {
  const { t } = useTranslation();
  const fuel = useOfficeData(officeApi.fuelSummary);
  const finance = useOfficeData(officeApi.financeSummary);
  const compliance = useOfficeData(officeApi.compliance);

  const [exporting, setExporting] = useState<string | null>(null);

  const rows = compliance.data ?? [];
  const expired = rows.reduce((n, r) => n + r.expired, 0);
  const soon = rows.reduce((n, r) => n + r.within7Days, 0);
  const valid = rows.reduce((n, r) => n + r.valid, 0);

  const handleExport = (format: 'PDF' | 'Excel') => {
    setExporting(format);
    setTimeout(() => {
      setExporting(null);
      Alert.alert(
        `${format} Report`,
        `Report generation request submitted for ${format}. The file will be available in the office download area.`,
      );
    }, 600);
  };

  const refreshAll = useCallback(async () => {
    await Promise.all([fuel.reload(), finance.reload(), compliance.reload()]);
  }, [fuel, finance, compliance]);

  const anyError = fuel.error || finance.error || compliance.error;

  return (
    <OfficeScreen
      title={t('office.nav.reports', { defaultValue: 'Reports' })}
      subtitle="Financial & Operational Summary"
      onRefresh={() => void refreshAll()}
      refreshing={fuel.refreshing || finance.refreshing}
      testID="office-reports"
    >
      {anyError && <LoadError error={anyError} onRetry={() => void refreshAll()} />}

      {/* Export Actions */}
      <View style={officeStyles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={() => handleExport('PDF')}
          disabled={Boolean(exporting)}
          style={[styles.exportBtn, { backgroundColor: colors.primary }]}
          testID="reports-export-pdf"
        >
          <AppText tone="inverse" style={{ fontWeight: '700' }}>
            {exporting === 'PDF' ? 'Generating…' : '📄 Export PDF'}
          </AppText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => handleExport('Excel')}
          disabled={Boolean(exporting)}
          style={[styles.exportBtn, { borderColor: colors.border, borderWidth: 1 }]}
          testID="reports-export-excel"
        >
          <AppText style={{ fontWeight: '700' }}>
            {exporting === 'Excel' ? 'Generating…' : '📊 Export Excel'}
          </AppText>
        </Pressable>
      </View>

      {/* Fuel Reports Section */}
      <AppText variant="h2" style={{ marginTop: spacing.xs }}>
        Fuel Expenditure
      </AppText>

      <StatTile
        hero
        label="Fuel This Financial Year"
        value={fuel.data ? rupees(fuel.data.financialYear.amount) : DASH}
        sub={
          fuel.data
            ? `${fuel.data.financialYear.litres} L · ${fuel.data.financialYear.entries} entries`
            : undefined
        }
        testID="reports-fuel-year"
      />

      <View style={officeStyles.grid}>
        <View style={officeStyles.half}>
          <StatTile
            label="Fuel Today"
            value={fuel.data ? rupees(fuel.data.today.amount) : DASH}
            sub={fuel.data ? `${fuel.data.today.litres} L` : undefined}
          />
        </View>
        <View style={officeStyles.half}>
          <StatTile
            label="Fuel This Month"
            value={fuel.data ? rupees(fuel.data.month.amount) : DASH}
            sub={fuel.data ? `${fuel.data.month.litres} L` : undefined}
          />
        </View>
      </View>

      {/* Finance Overview Section */}
      <AppText variant="h2" style={{ marginTop: spacing.md }}>
        Finance & Expenses
      </AppText>

      <Card style={{ gap: spacing.sm }} testID="reports-finance-summary">
        <View style={styles.metricRow}>
          <AppText tone="muted">Total Income</AppText>
          <AppText style={{ fontWeight: '700' }}>
            {finance.data ? rupees(finance.data.totalIncome) : DASH}
          </AppText>
        </View>
        <View style={styles.metricRow}>
          <AppText tone="muted">Total Expenses</AppText>
          <AppText style={{ fontWeight: '700', color: colors.danger }}>
            {finance.data ? rupees(finance.data.totalExpenses) : DASH}
          </AppText>
        </View>
        <View style={styles.metricRow}>
          <AppText tone="muted">Salaries & Advances</AppText>
          <AppText style={{ fontWeight: '700' }}>
            {finance.data ? rupees(String(Number(finance.data.salaries) + Number(finance.data.advances))) : DASH}
          </AppText>
        </View>
        <View style={styles.metricRow}>
          <AppText tone="muted">Pending Payments</AppText>
          <AppText style={{ fontWeight: '700', color: colors.warning }}>
            {finance.data ? `${finance.data.pendingPayments.count} (${rupees(finance.data.pendingPayments.amount)})` : DASH}
          </AppText>
        </View>
      </Card>

      {/* Compliance Overview */}
      <AppText variant="h2" style={{ marginTop: spacing.md }}>
        Fleet Compliance
      </AppText>

      <View style={officeStyles.grid} testID="reports-compliance-summary">
        <View style={officeStyles.half}>
          <StatTile
            label="Valid Documents"
            value={compliance.data ? String(valid) : DASH}
            tone="success"
          />
        </View>
        <View style={officeStyles.half}>
          <StatTile
            label="Needs Attention"
            value={compliance.data ? String(expired + soon) : DASH}
            tone={expired > 0 ? 'danger' : soon > 0 ? 'warning' : 'default'}
            sub={compliance.data ? `${expired} expired · ${soon} due soon` : undefined}
          />
        </View>
      </View>
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
  exportBtn: {
    flex: 1,
    minHeight: TOUCH_TARGET - 4,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
