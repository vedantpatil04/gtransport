import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AppText, Card } from '../../components/ui';
import { officePath, seesPayroll } from '../../features/office/modules';
import { DASH, LoadError, OfficeScreen, officeStyles, StatTile, useOfficeData } from '../../features/office/ui';
import { officeApi } from '../../lib/api/office';
import { quantity, rupees } from '../../lib/format';
import { useSession } from '../../lib/auth/session-store';

/**
 * Office dashboard: today's live figures for the signed-in role. Payroll figures appear only
 * for the roles the API lets see them (admin, super admin, accounting).
 */
export default function OfficeDashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const role = useSession((s) => s.role);
  const payroll = seesPayroll(role);

  const fuel = useOfficeData(officeApi.fuelSummary);
  const compliance = useOfficeData(officeApi.compliance);
  const payments = useOfficeData(officeApi.paymentsSummary, [], payroll);
  const finance = useOfficeData(officeApi.financeSummary, [], payroll);

  const rows = compliance.data ?? [];
  const expired = rows.reduce((n, r) => n + r.expired, 0);
  const soon = rows.reduce((n, r) => n + r.within7Days, 0);
  const by = payments.data?.byStatus ?? {};
  const awaiting = by.PENDING_APPROVAL?.count ?? 0;
  const attention = (by.STATUS_REVIEW_REQUIRED?.count ?? 0) + (by.FAILED?.count ?? 0);
  const failed = [fuel, compliance, ...(payroll ? [payments, finance] : [])].find((r) => r.error);

  const refresh = async () => {
    await Promise.all([fuel.reload(), compliance.reload(), ...(payroll ? [payments.reload(), finance.reload()] : [])]);
  };

  return (
    <OfficeScreen
      title={t('office.nav.dashboard')}
      subtitle={user ? `${user.displayName} · ${t(`office.role.${user.role}`)}` : role ? t(`office.role.${role}`) : undefined}
      onRefresh={() => void refresh()}
      refreshing={fuel.refreshing}
      testID="office-dashboard"
    >
      {failed?.error && <LoadError error={failed.error} onRetry={() => void refresh()} />}

      <StatTile
        hero
        label={t('office.fuelToday')}
        value={fuel.data ? rupees(fuel.data.today.amount) : DASH}
        sub={fuel.data ? t('office.litresEntries', { litres: quantity(fuel.data.today.litres, 1), count: fuel.data.today.entries }) : undefined}
        onPress={() => router.push(officePath('fuel'))}
        testID="office-fuel-today"
      />
      <View style={officeStyles.grid}>
        <View style={officeStyles.half}>
          <StatTile
            label={t('office.fuelMonth')}
            value={fuel.data ? rupees(fuel.data.month.amount) : DASH}
            sub={fuel.data ? t('office.entries', { count: fuel.data.month.entries }) : undefined}
            onPress={() => router.push(officePath('fuel'))}
          />
        </View>
        <View style={officeStyles.half}>
          <StatTile
            label={t('office.documentsAttention')}
            value={compliance.data ? String(expired + soon) : DASH}
            tone={expired ? 'danger' : soon ? 'warning' : 'default'}
            sub={compliance.data ? t('office.documentsSub', { expired, soon }) : undefined}
            onPress={() => router.push(officePath('documents'))}
            testID="office-documents-attention"
          />
        </View>
      </View>

      {payroll && (
        <>
          <AppText variant="h2" style={{ marginTop: 4 }}>{t('office.payments')}</AppText>
          <View style={officeStyles.grid} testID="office-payroll">
            <View style={officeStyles.half}>
              <StatTile
                label={t('office.awaitingApproval')}
                value={payments.data ? String(awaiting) : DASH}
                tone={awaiting ? 'warning' : 'default'}
                sub={payments.data ? rupees(by.PENDING_APPROVAL?.amount ?? '0') : undefined}
                onPress={() => router.push(officePath('finance'))}
              />
            </View>
            <View style={officeStyles.half}>
              <StatTile
                label={t('office.needsAttention')}
                value={payments.data ? String(attention) : DASH}
                tone={attention ? 'danger' : 'default'}
                sub={payments.data ? t('office.needsAttentionSub') : undefined}
                onPress={() => router.push(officePath('finance'))}
              />
            </View>
          </View>
          <StatTile
            label={t('office.expensesYear')}
            value={finance.data ? rupees(finance.data.totalExpenses) : DASH}
            sub={finance.data?.financialYear}
            onPress={() => router.push(officePath('finance'))}
          />
        </>
      )}

      <Card>
        <AppText tone="muted">{t('office.readOnlyNote')}</AppText>
      </Card>
    </OfficeScreen>
  );
}
