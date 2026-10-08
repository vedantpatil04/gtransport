import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Files, Fuel, Hourglass, Landmark, ReceiptIndianRupee, Wallet, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input, NativeSelect } from '@/components/ui/input';
import { dashboardApi, documentsApi, paymentsApi, type ApiPaymentGroup, type DashboardPeriod } from '@/features/api/resources';
import { canManageFinance, useSession } from '@/features/api/session';
import type { ApiComplianceSummaryRow } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { docTypeLabelKey } from '@/features/documents/compliance';
import { money } from '@/features/finance/shared';
import { fmtDate, num } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader, Panel, StatCard } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';

/** Figures still loading or unavailable show a dash, never a made-up number. */
const dash = '—';

const PRESETS: DashboardPeriod['preset'][] = ['today', 'yesterday', 'this_week', 'this_month', 'this_fy', 'custom'];

/** A custom range is asked for only once both days are chosen and in order. */
const ready = (p: DashboardPeriod) => p.preset !== 'custom' || Boolean(p.from && p.to && p.from <= p.to);
const periodKey = (p: DashboardPeriod) => (p.preset === 'custom' ? `custom:${p.from}:${p.to}` : p.preset);

/** The detail screens take the same period, so "view" opens what the card summarised. */
const rangeParams = (p: DashboardPeriod, from?: string, to?: string) => (from && to ? `from=${from}&to=${to}` : p.preset === 'custom' ? '' : `preset=${p.preset}`);

/**
 * Real-mode dashboard. Every figure is computed by the API for the period its card shows; each
 * card has its own period, loads on its own (one slow source never blanks the page) and links to
 * the screen behind it. Cards a role may not see (payroll, payments) are never requested.
 */
export function DashboardConnected() {
  const { t, i18n } = useTranslation();
  const user = useSession((s) => s.user);
  const payroll = canManageFinance(user?.role);

  const [fuelPeriod, setFuelPeriod] = useState<DashboardPeriod>({ preset: 'today' });
  const [otherPeriod, setOtherPeriod] = useState<DashboardPeriod>({ preset: 'today' });
  const [totalPeriod, setTotalPeriod] = useState<DashboardPeriod>({ preset: 'this_fy' });
  const [paymentsPeriod, setPaymentsPeriod] = useState<DashboardPeriod>({ preset: 'this_month' });
  const [paymentGroup, setPaymentGroup] = useState<ApiPaymentGroup | 'all'>('all');
  const [docFilter, setDocFilter] = useState<DocFilter>('attention');

  const fuel = useApiResource(() => dashboardApi.spend(fuelPeriod), [periodKey(fuelPeriod)], ready(fuelPeriod));
  const other = useApiResource(() => dashboardApi.spend(otherPeriod), [periodKey(otherPeriod)], ready(otherPeriod));
  const total = useApiResource(() => dashboardApi.spend(totalPeriod), [periodKey(totalPeriod)], ready(totalPeriod));
  const periodPayments = useApiResource(() => dashboardApi.payments(paymentsPeriod), [periodKey(paymentsPeriod)], payroll && ready(paymentsPeriod));
  const compliance = useApiResource(() => documentsApi.summary(), []);
  const payments = useApiResource(() => paymentsApi.summary(), [], payroll);

  const rows = compliance.data ?? [];
  const docs = {
    expired: rows.reduce((n, r) => n + r.expired, 0),
    soon: rows.reduce((n, r) => n + r.expiringSoon, 0),
    pending: rows.reduce((n, r) => n + r.pendingVerification, 0),
    missing: rows.reduce((n, r) => n + (r.notUploaded ?? 0), 0),
  };
  const docValue = { attention: docs.expired + docs.soon, missing: docs.missing, soon: docs.soon, expired: docs.expired, pending: docs.pending }[docFilter];
  const docLink = { attention: '/admin/documents', missing: '/admin/documents', soon: '/admin/documents?status=EXPIRING_SOON', expired: '/admin/documents?status=EXPIRED', pending: '/admin/documents?verification=PENDING' }[docFilter];

  const by = payments.data?.byStatus ?? {};
  const awaitingApproval = by.PENDING_APPROVAL?.count ?? 0;
  const needsAttention = (by.STATUS_REVIEW_REQUIRED?.count ?? 0) + (by.FAILED?.count ?? 0);

  const groupFigure = (() => {
    const data = periodPayments.data;
    if (!data) return null;
    if (paymentGroup === 'all') {
      const all = Object.values(data.created);
      return { count: all.reduce((n, g) => n + g.count, 0), amount: all.reduce((n, g) => n + Number(g.amount), 0).toFixed(2) };
    }
    // "Paid" means paid within the period, whenever the payment was created.
    return paymentGroup === 'paid' ? data.paidInPeriod : data.created[paymentGroup];
  })();
  const paymentStatusParam = { all: '', pending: 'PENDING_APPROVAL', processing: 'PROCESSING', paid: 'PAID', failed: 'FAILED', cancelled: 'CANCELLED', reversed: 'REVERSED' }[paymentGroup];

  const totalValue = total.data ? (payroll ? total.data.ledgerExpenses : total.data.operationalTotal) : undefined;
  const failed = [fuel, other, total, compliance, ...(payroll ? [payments, periodPayments] : [])].some((r) => r.error);

  return (
    <div data-testid="dashboard-live">
      <PageHeader
        title={t('admin.dashboard.title')}
        description={`${fmtDate(new Date(), i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${user ? ` · ${user.displayName}` : ''}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PeriodCard
          hero
          label={t('admin.financeApi.fuel')}
          icon={Fuel}
          period={fuelPeriod}
          onPeriod={setFuelPeriod}
          loading={fuel.loading}
          value={fuel.data ? money(fuel.data.fuel.amount) : dash}
          sub={fuel.data ? t('admin.real.fuelSub', { litres: num(Number(fuel.data.fuel.litres)), count: fuel.data.fuel.entries }) : undefined}
          to={`/admin/fuel?${rangeParams(fuelPeriod, fuel.data?.range.from, fuel.data?.range.to)}`}
          testId="stat-fuel"
        />
        <PeriodCard
          label={t('admin.dashboard.otherToday')}
          icon={ReceiptIndianRupee}
          period={otherPeriod}
          onPeriod={setOtherPeriod}
          loading={other.loading}
          value={other.data ? money(other.data.otherExpenses.amount) : dash}
          sub={other.data ? t('admin.dashboard.entries', { count: other.data.otherExpenses.records }) : undefined}
          to={`/admin/finance/expenses?${rangeParams(otherPeriod, other.data?.range.from, other.data?.range.to)}`}
          testId="stat-other"
        />
        <PeriodCard
          label={payroll ? t('admin.financeApi.totalExpenses') : t('admin.dashboardLive.operationalSpend')}
          icon={Landmark}
          period={totalPeriod}
          onPeriod={setTotalPeriod}
          loading={total.loading}
          value={totalValue !== undefined ? money(totalValue) : dash}
          sub={total.data ? (payroll ? t('admin.dashboardLive.ledgerSub') : t('admin.dashboardLive.operationalSub')) : undefined}
          to={payroll ? `/admin/finance/ledger?${rangeParams(totalPeriod, total.data?.range.from, total.data?.range.to)}` : '/admin/reports'}
          testId="stat-total"
        />
        <div className="flex flex-col rounded-lg border bg-card p-4" data-testid="card-documents">
          <CardHead label={t('admin.real.documentsAttention')} icon={AlertTriangle} tone={docs.expired ? 'danger' : docs.soon ? 'warning' : 'neutral'}>
            <NativeSelect value={docFilter} onChange={(e) => setDocFilter(e.target.value as DocFilter)} className="h-8 w-auto py-0 text-xs" aria-label={t('admin.dashboardLive.show')}>
              {(['attention', 'missing', 'soon', 'expired', 'pending'] as const).map((k) => (
                <option key={k} value={k}>{t(`admin.dashboardLive.docs.${k}`)}</option>
              ))}
            </NativeSelect>
          </CardHead>
          <p className="figure mt-2 text-[26px] font-bold leading-none tracking-tight" data-testid="stat-documents">{compliance.data ? docValue : dash}</p>
          {compliance.data && <p className="mt-2 text-sm text-muted-foreground">{t('admin.real.documentsSub', { expired: docs.expired, soon: docs.soon, pending: docs.pending })}</p>}
          <ViewLink to={docLink} />
        </div>
      </div>

      {payroll && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PeriodCard
            label={t('admin.payments.title')}
            icon={Wallet}
            period={paymentsPeriod}
            onPeriod={setPaymentsPeriod}
            loading={periodPayments.loading}
            extra={
              <NativeSelect value={paymentGroup} onChange={(e) => setPaymentGroup(e.target.value as ApiPaymentGroup | 'all')} className="h-8 w-auto py-0 text-xs" aria-label={t('admin.common.status')}>
                {(['all', 'pending', 'processing', 'paid', 'failed', 'cancelled'] as const).map((g) => (
                  <option key={g} value={g}>{t(`admin.dashboardLive.paymentGroup.${g}`)}</option>
                ))}
              </NativeSelect>
            }
            value={groupFigure ? money(groupFigure.amount) : dash}
            sub={groupFigure ? t('admin.common.records', { count: groupFigure.count }) : undefined}
            to={`/admin/finance/payments?${[paymentStatusParam && `status=${paymentStatusParam}`, rangeParams(paymentsPeriod, periodPayments.data?.range.from, periodPayments.data?.range.to)].filter(Boolean).join('&')}`}
            testId="stat-payments"
          />
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

      {failed && (
        <p className="mt-4 text-sm text-danger" role="status">
          {t('admin.real.someFiguresFailed')}
        </p>
      )}
    </div>
  );
}

type DocFilter = 'attention' | 'missing' | 'soon' | 'expired' | 'pending';

function CardHead({ label, icon: Icon, tone = 'neutral', hero, children }: { label: string; icon: LucideIcon; tone?: 'neutral' | 'warning' | 'danger'; hero?: boolean; children?: React.ReactNode }) {
  const toneCls = { neutral: 'bg-muted text-foreground/70', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger' }[tone];
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 space-y-1.5">
        <p className={cn('text-sm font-medium', hero ? 'text-white/70' : 'text-muted-foreground')}>{label}</p>
        {children}
      </div>
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', hero ? 'bg-plate text-[#1a1a1a]' : toneCls)}>
        <Icon className="size-[18px]" />
      </span>
    </div>
  );
}

function ViewLink({ to, hero }: { to: string; hero?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link to={to} className={cn('mt-auto inline-flex items-center gap-1 pt-3 text-sm font-medium hover:underline', hero ? 'text-white' : 'text-primary')}>
      {t('admin.dashboardLive.viewDetails')}
      <ArrowRight className="size-3.5" />
    </Link>
  );
}

/** A summary card with its own period: preset dropdown, or two dates for a custom range. */
function PeriodCard({
  label, icon, period, onPeriod, value, sub, to, hero, loading, extra, testId,
}: {
  label: string;
  icon: LucideIcon;
  period: DashboardPeriod;
  onPeriod: (period: DashboardPeriod) => void;
  value: React.ReactNode;
  sub?: React.ReactNode;
  to: string;
  hero?: boolean;
  loading?: boolean;
  extra?: React.ReactNode;
  testId?: string;
}) {
  const { t } = useTranslation();
  const selectCls = cn('h-8 w-auto py-0 text-xs', hero && 'border-white/20 bg-white/10 text-white [&>option]:text-foreground');
  return (
    <div className={cn('flex flex-col rounded-lg border p-4', hero ? 'border-transparent bg-primary text-white dark:bg-[#1f3354]' : 'bg-card')} data-testid={testId ? `card-${testId.replace('stat-', '')}` : undefined}>
      <CardHead label={label} icon={icon} hero={hero}>
        <div className="flex flex-wrap gap-1.5">
          <NativeSelect
            value={period.preset}
            onChange={(e) => {
              const preset = e.target.value as DashboardPeriod['preset'];
              onPeriod(preset === 'custom' ? { preset, from: period.from, to: period.to } : { preset });
            }}
            className={selectCls}
            aria-label={t('admin.reportsApi.period.label')}
          >
            {PRESETS.map((p) => (
              <option key={p} value={p}>{t(`admin.reportsApi.period.${p}`)}</option>
            ))}
          </NativeSelect>
          {extra}
        </div>
      </CardHead>
      {period.preset === 'custom' && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Input type="date" value={period.from ?? ''} max={period.to} onChange={(e) => onPeriod({ ...period, from: e.target.value })} className={cn('h-8 text-xs', hero && 'text-foreground')} aria-label={t('admin.reportsApi.period.from')} />
          <Input type="date" value={period.to ?? ''} min={period.from} onChange={(e) => onPeriod({ ...period, to: e.target.value })} className={cn('h-8 text-xs', hero && 'text-foreground')} aria-label={t('admin.reportsApi.period.to')} />
        </div>
      )}
      <p className={cn('figure mt-2 font-bold leading-none tracking-tight', hero ? 'text-4xl' : 'text-[26px]', loading && 'opacity-50')} data-testid={testId}>
        {period.preset === 'custom' && !ready(period) ? dash : value}
      </p>
      {period.preset === 'custom' && !ready(period) ? (
        <p className={cn('mt-2 text-sm', hero ? 'text-white/70' : 'text-muted-foreground')}>{t('admin.reportsApi.period.chooseDates')}</p>
      ) : (
        sub && <div className={cn('mt-2 text-sm', hero ? 'text-white/70' : 'text-muted-foreground')}>{sub}</div>
      )}
      <ViewLink to={to} hero={hero} />
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
