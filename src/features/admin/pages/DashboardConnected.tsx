import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, Files, Fuel, Hourglass, Landmark, ReceiptIndianRupee } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { documentsApi, financeApi, fuelApi, operationsApi, paymentsApi } from '@/features/api/resources';
import { canManageFinance, useSession } from '@/features/api/session';
import type { ApiComplianceSummaryRow } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { docTypeLabelKey } from '@/features/documents/compliance';
import { money } from '@/features/finance/shared';
import { todayISO } from '@/lib/dates';
import { fmtDate, num } from '@/lib/format';
import { PageHeader, Panel, StatCard } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';

/** Figures still loading or unavailable show a dash, never a made-up number. */
const dash = '—';

/**
 * Real-mode dashboard: today's figures from the live API, in the prototype's card layout.
 * Each card loads on its own, so one slow or failing source never blanks the page, and cards
 * a role may not see (payroll) are simply not requested.
 */
export function DashboardConnected() {
  const { t, i18n } = useTranslation();
  const user = useSession((s) => s.user);
  const payroll = canManageFinance(user?.role);
  const today = todayISO();

  const fuel = useApiResource(() => fuelApi.summary(), []);
  const operations = useApiResource(() => operationsApi.list({ from: today, to: today, limit: 1 }), [today]);
  const compliance = useApiResource(() => documentsApi.summary(), []);
  const payments = useApiResource(() => paymentsApi.summary(), [], payroll);
  const finance = useApiResource(() => financeApi.summary(), [], payroll);

  const rows = compliance.data ?? [];
  const expired = rows.reduce((n, r) => n + r.expired, 0);
  const soon = rows.reduce((n, r) => n + r.within7Days, 0);
  const pendingVerification = rows.reduce((n, r) => n + r.pendingVerification, 0);
  const by = payments.data?.byStatus ?? {};
  const awaitingApproval = by.PENDING_APPROVAL?.count ?? 0;
  const needsAttention = (by.STATUS_REVIEW_REQUIRED?.count ?? 0) + (by.FAILED?.count ?? 0);

  return (
    <div data-testid="dashboard-live">
      <PageHeader
        title={t('admin.dashboard.title')}
        description={`${fmtDate(new Date(), i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${user ? ` · ${user.displayName}` : ''}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          hero
          label={t('admin.dashboard.fuelToday')}
          value={fuel.data ? money(fuel.data.today.amount) : dash}
          sub={fuel.data ? t('admin.real.fuelSub', { litres: num(Number(fuel.data.today.litres)), count: fuel.data.today.entries }) : undefined}
          icon={Fuel}
          to="/admin/fuel"
          testId="stat-fuel-today"
        />
        <StatCard
          label={t('admin.real.fuelMonth')}
          value={fuel.data ? money(fuel.data.month.amount) : dash}
          sub={fuel.data ? t('admin.dashboard.entries', { count: fuel.data.month.entries }) : undefined}
          icon={Fuel}
          to="/admin/fuel"
        />
        <StatCard
          label={t('admin.dashboard.otherToday')}
          value={operations.data ? money(operations.data.total) : dash}
          sub={operations.data ? t('admin.dashboard.entries', { count: operations.data.count }) : undefined}
          icon={ReceiptIndianRupee}
          to="/admin/finance/expenses"
        />
        <StatCard
          label={t('admin.real.documentsAttention')}
          value={compliance.data ? expired + soon : dash}
          tone={compliance.data && expired ? 'danger' : soon ? 'warning' : 'neutral'}
          sub={compliance.data ? t('admin.real.documentsSub', { expired, soon, pending: pendingVerification }) : undefined}
          icon={AlertTriangle}
          to="/admin/documents"
          testId="stat-documents"
        />
      </div>

      {payroll && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label={t('admin.paymentsApi.awaitingApproval')}
            value={payments.data ? awaitingApproval : dash}
            sub={payments.data ? money(by.PENDING_APPROVAL?.amount ?? '0') : undefined}
            icon={Hourglass}
            tone={awaitingApproval ? 'warning' : 'neutral'}
            to="/admin/finance/payments?status=PENDING_APPROVAL"
          />
          <StatCard
            label={t('admin.paymentsApi.needsAttention')}
            value={payments.data ? needsAttention : dash}
            sub={payments.data ? t('admin.real.paymentsAttentionSub') : undefined}
            icon={AlertTriangle}
            tone={needsAttention ? 'danger' : 'neutral'}
            to="/admin/finance/payments?status=STATUS_REVIEW_REQUIRED"
          />
          <StatCard
            label={t('admin.financeApi.totalExpenses')}
            value={finance.data ? money(finance.data.totalExpenses) : dash}
            sub={finance.data?.financialYear}
            icon={Landmark}
            to="/admin/finance/ledger"
          />
        </div>
      )}

      <div className="mt-6">
        <Panel title={t('admin.real.complianceTitle')} action={<Link to="/admin/documents" className="text-sm font-medium text-primary hover:underline">{t('admin.top.viewAll')}</Link>}>
          {compliance.loading ? (
            <TableLoading rows={4} columns={4} />
          ) : compliance.error ? (
            <ErrorState error={compliance.error} onRetry={compliance.reload} />
          ) : (
            <ComplianceRows rows={rows} />
          )}
        </Panel>
      </div>

      {(fuel.error || operations.error || (payroll && (payments.error || finance.error))) && (
        <p className="mt-4 text-sm text-danger" role="status">
          {t('admin.real.someFiguresFailed')}
        </p>
      )}
    </div>
  );
}

function ComplianceRows({ rows }: { rows: ApiComplianceSummaryRow[] }) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
        <Files className="size-6" />
        {t('admin.real.complianceEmpty')}
      </div>
    );
  }
  return (
    <ul className="divide-y">
      {rows.map((row) => (
        <li key={row.type} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="font-medium">{t(docTypeLabelKey(row.type))}</span>
          <span className="flex flex-wrap gap-1.5">
            {row.expired > 0 && <Badge tone="danger">{t('admin.real.expiredCount', { count: row.expired })}</Badge>}
            {row.within7Days > 0 && <Badge tone="warning">{t('admin.real.soonCount', { count: row.within7Days })}</Badge>}
            {(row.notUploaded ?? 0) > 0 && <Badge tone="neutral">{t('admin.real.missingCount', { count: row.notUploaded ?? 0 })}</Badge>}
            <Badge tone="success">{t('admin.real.validCount', { count: row.valid })}</Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}
