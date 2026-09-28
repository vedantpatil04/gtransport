import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CircleCheckBig, FileSpreadsheet, Hourglass, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { paymentsApi } from '@/features/api/resources';
import type { ApiPayment, ApiPaymentStatus } from '@/features/api/types';
import { useApiResource } from '@/features/api/useApiResource';
import { CreatePaymentDialog } from '@/features/finance/FinanceDialogs';
import { PaymentDrawer } from '@/features/finance/PaymentDrawer';
import { CursorPager, money, PaymentStatusBadge, paiseToRupees, toPaise, useCursorPages } from '@/features/finance/shared';
import { todayISO } from '@/lib/dates';
import { exportXlsx } from '@/lib/exporters';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FilterBar, PageHeader, Panel, StatCard, Table, TD, TH, TR } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';

const TABS: (ApiPaymentStatus | 'all')[] = ['all', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'STATUS_REVIEW_REQUIRED', 'PAID', 'FAILED', 'CANCELLED', 'REVERSED'];
const PAGE_SIZE = 50;

export function PaymentsConnected() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [type, setType] = useState('');
  const [create, setCreate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const status = (params.get('status') as ApiPaymentStatus | null) ?? 'all';
  const openId = params.get('id');

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const config = useApiResource(() => paymentsApi.config(), []);
  const summary = useApiResource(() => paymentsApi.summary(), []);
  const query = { status: status === 'all' ? undefined : status, type: type || undefined };
  const filterKey = JSON.stringify(query);
  const pages = useCursorPages(filterKey);
  const list = useApiResource(() => paymentsApi.list({ ...query, limit: PAGE_SIZE, cursor: pages.cursor }), [filterKey, pages.cursor]);
  const nextCursor = list.data?.page.nextCursor ?? null;
  const payoutsEnabled = config.data?.payoutsEnabled ?? false;

  const by = summary.data?.byStatus ?? {};
  const sum = (...keys: ApiPaymentStatus[]) => ({
    count: keys.reduce((n, k) => n + (by[k]?.count ?? 0), 0),
    amount: paiseToRupees(keys.reduce((n, k) => n + (toPaise(by[k]?.amount ?? '0') ?? 0), 0)),
  });
  const inProgress = sum('APPROVED', 'PROCESSING');
  const attention = sum('STATUS_REVIEW_REQUIRED', 'FAILED');
  const tabCount = (tab: ApiPaymentStatus | 'all') =>
    tab === 'all' ? Object.values(by).reduce((n, v) => n + (v?.count ?? 0), 0) : (by[tab]?.count ?? 0);

  const reload = () => {
    summary.reload();
    list.reload();
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const rows: ApiPayment[] = [];
      let cursor: string | undefined;
      do {
        const page = await paymentsApi.list({ ...query, limit: 100, cursor });
        rows.push(...page.data);
        cursor = page.page.nextCursor ?? undefined;
      } while (cursor && rows.length < 10_000);
      const result = await exportXlsx(`payments-${todayISO()}.xlsx`, [
        {
          name: t('admin.payments.title'),
          header: [
            t('admin.common.date'), t('admin.financeApi.employee'), t('admin.common.type'), `${t('admin.common.amount')} (₹)`,
            t('admin.payments.method'), t('admin.common.status'), t('admin.paymentsApi.utr'), t('admin.paymentsApi.description'),
          ],
          widths: [12, 24, 14, 14, 18, 18, 22, 28],
          rows: rows.map((p) => [
            p.createdAt.slice(0, 10), p.employee.fullName, t(`admin.enum.paymentType.${p.type}`), Number(p.amount),
            `${t(`admin.enum.paymentMethod.${p.method}`)} · ${t(`admin.enum.paymentProvider.${p.provider}`)}`,
            t(`admin.enum.paymentStatus.${p.status}`), p.paymentReference ?? '', p.description ?? '',
          ]),
        },
      ]);
      if (result === 'saved') toast.success(t('admin.common.exported'));
    } catch {
      toast.error(t('common.somethingWrong'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('admin.payments.title')}
        description={t('admin.payments.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportData} disabled={exporting || (list.data?.data.length ?? 0) === 0}>
              <FileSpreadsheet />
              {t('admin.common.exportExcel')}
            </Button>
            <Button onClick={() => setCreate(true)}>
              <Plus />
              {t('admin.paymentsApi.new')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('admin.payments.paidMonth')}
          value={summary.data ? money(summary.data.paidThisMonth.amount) : '—'}
          sub={summary.data ? t('admin.common.records', { count: summary.data.paidThisMonth.count }) : undefined}
          icon={CircleCheckBig}
          tone="success"
        />
        <StatCard
          label={t('admin.paymentsApi.awaitingApproval')}
          value={money(sum('PENDING_APPROVAL').amount)}
          sub={t('admin.common.records', { count: sum('PENDING_APPROVAL').count })}
          icon={Hourglass}
          tone="warning"
        />
        <StatCard label={t('admin.paymentsApi.inProgress')} value={money(inProgress.amount)} sub={t('admin.common.records', { count: inProgress.count })} icon={Hourglass} tone="neutral" />
        <StatCard
          label={t('admin.paymentsApi.needsAttention')}
          value={money(attention.amount)}
          sub={t('admin.common.records', { count: attention.count })}
          icon={AlertTriangle}
          tone="danger"
        />
      </div>

      <div className="mt-6">
        <Panel>
          <div className="flex flex-wrap gap-1 border-b px-4 py-3" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={status === tab}
                onClick={() => setParam('status', tab)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                  status === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {tab === 'all' ? t('admin.paymentsApi.all') : t(`admin.enum.paymentStatus.${tab}`)}
                <span className="figure ml-1.5 opacity-80">({tabCount(tab)})</span>
              </button>
            ))}
          </div>

          <FilterBar active={Boolean(type)} onClear={() => setType('')}>
            <NativeSelect value={type} onChange={(e) => setType(e.target.value)} className="w-auto min-w-[150px]" aria-label={t('admin.common.type')}>
              <option value="">{t('admin.payments.allTypes')}</option>
              {(['SALARY', 'ADVANCE', 'ALLOWANCE', 'OTHER'] as const).map((k) => (
                <option key={k} value={k}>{t(`admin.enum.paymentType.${k}`)}</option>
              ))}
            </NativeSelect>
          </FilterBar>

          {list.loading ? (
            <TableLoading rows={5} columns={6} />
          ) : list.error ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <TH>{t('admin.financeApi.employee')}</TH>
                    <TH>{t('admin.common.type')}</TH>
                    <TH>{t('admin.payments.method')}</TH>
                    <TH>{t('admin.common.date')}</TH>
                    <TH className="text-right">{t('admin.common.amount')}</TH>
                    <TH>{t('admin.common.status')}</TH>
                  </tr>
                </thead>
                <tbody>
                  {(list.data?.data ?? []).map((p) => (
                    <TR key={p.id} onClick={() => setParam('id', p.id)}>
                      <TD className="min-w-[180px]">
                        <p className="font-medium">{p.employee.fullName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {p.salary ? p.salary.payPeriod : p.advance ? t(`admin.enum.advanceType.${p.advance.type}`) : p.description ?? p.employee.employeeCode}
                        </p>
                      </TD>
                      <TD className="whitespace-nowrap">{t(`admin.enum.paymentType.${p.type}`)}</TD>
                      <TD className="whitespace-nowrap text-muted-foreground">
                        {t(`admin.enum.paymentMethod.${p.method}`)}
                        <span className="block text-xs">{t(`admin.enum.paymentProvider.${p.provider}`)}</span>
                      </TD>
                      <TD className="whitespace-nowrap text-muted-foreground">{fmtDate((p.paidAt ?? p.createdAt).slice(0, 10))}</TD>
                      <TD className="figure text-right font-semibold">{money(p.amount)}</TD>
                      <TD><PaymentStatusBadge status={p.status} /></TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
              {(list.data?.data.length ?? 0) === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.paymentsApi.empty')}</p>}
              <CursorPager index={pages.index} nextCursor={nextCursor} onPrev={pages.prev} onNext={() => pages.next(nextCursor)} />
            </>
          )}
        </Panel>
      </div>

      <CreatePaymentDialog
        open={create}
        onOpenChange={setCreate}
        payoutsEnabled={payoutsEnabled}
        onCreated={(payment) => {
          setCreate(false);
          reload();
          setParam('id', payment.id);
        }}
      />
      <PaymentDrawer paymentId={openId} payoutsEnabled={payoutsEnabled} onClose={() => setParam('id', null)} onChanged={reload} />
    </div>
  );
}
