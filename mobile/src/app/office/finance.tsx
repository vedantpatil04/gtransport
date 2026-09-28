import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AppText, Card, EmptyView, Loading } from '../../components/ui';
import { DASH, LoadError, ModuleGuard, OfficeScreen, officeStyles, Pill, ShowMore, StatTile, useOfficeData, usePagedList } from '../../features/office/ui';
import { officeApi, type OfficePaymentStatus } from '../../lib/api/office';
import { rupees } from '../../lib/api/payments';
import { displayDate } from '../../lib/dates';

const TONE: Record<OfficePaymentStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'warning',
  PROCESSING: 'warning',
  STATUS_REVIEW_REQUIRED: 'danger',
  PAID: 'success',
  FAILED: 'danger',
  CANCELLED: 'default',
  REVERSED: 'danger',
};

/**
 * Finance, read-only: the financial year at a glance and the latest payments. Approving and
 * sending money stays in the office console, where it has confirmations and the full history.
 */
function OfficeFinanceBody() {
  const { t, i18n } = useTranslation();
  const summary = useOfficeData(officeApi.financeSummary);
  const list = usePagedList((token, cursor) => officeApi.payments(token, { limit: 20, cursor }));
  const refresh = async () => {
    await Promise.all([summary.reload(), list.reload()]);
  };

  return (
    <OfficeScreen title={t('office.nav.finance')} subtitle={summary.data?.financialYear} onRefresh={() => void refresh()} refreshing={list.refreshing} testID="office-finance">
      {(summary.error ?? list.error) && <LoadError error={(summary.error ?? list.error)!} onRetry={() => void refresh()} />}
      <StatTile hero label={t('office.expensesYear')} value={summary.data ? rupees(summary.data.totalExpenses) : DASH} sub={summary.data ? t('office.incomeYear', { amount: rupees(summary.data.totalIncome) }) : undefined} />
      <View style={officeStyles.grid}>
        <View style={officeStyles.half}>
          <StatTile label={t('office.salaries')} value={summary.data ? rupees(summary.data.salaries) : DASH} />
        </View>
        <View style={officeStyles.half}>
          <StatTile label={t('office.advances')} value={summary.data ? rupees(summary.data.advances) : DASH} />
        </View>
      </View>
      <StatTile
        label={t('office.paymentsInProgress')}
        value={summary.data ? rupees(summary.data.pendingPayments.amount) : DASH}
        sub={summary.data ? t('office.entries', { count: summary.data.pendingPayments.count }) : undefined}
      />

      <AppText variant="h2" style={{ marginTop: 4 }}>{t('office.latestPayments')}</AppText>
      {list.loading ? (
        <Loading />
      ) : list.rows.length === 0 && !list.error ? (
        <EmptyView title={t('office.noPayments')} />
      ) : (
        list.rows.map((p) => (
          <Card key={p.id}>
            <View style={officeStyles.row}>
              <View style={officeStyles.grow}>
                <AppText numberOfLines={1}>{p.employee.fullName}</AppText>
                <AppText variant="label" tone="muted">
                  {t(`office.paymentType.${p.type}`)} · {displayDate(p.createdAt.slice(0, 10), i18n.language)}
                </AppText>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <AppText variant="h2">{rupees(p.amount)}</AppText>
                <Pill label={t(`office.paymentStatus.${p.status}`)} tone={TONE[p.status]} />
              </View>
            </View>
          </Card>
        ))
      )}
      <ShowMore list={list} />
      <Card>
        <AppText tone="muted">{t('office.financeConsoleNote')}</AppText>
      </Card>
    </OfficeScreen>
  );
}

/** The guard renders first, so a role that may not open finance never calls its endpoints. */
export default function OfficeFinance() {
  return (
    <ModuleGuard module="finance">
      <OfficeFinanceBody />
    </ModuleGuard>
  );
}
