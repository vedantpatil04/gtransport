import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banknote, FileSpreadsheet, HandCoins, MoreHorizontal, Plus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, NativeSelect } from '@/components/ui/input';
import { financeApi, paymentsApi } from '@/features/api/resources';
import type { ApiAdvance, ApiAdvanceType, ApiPaymentRef, ApiSalary } from '@/features/api/types';
import { useApiResource, useDebounced } from '@/features/api/useApiResource';
import { AdvanceDialog, CreatePaymentDialog, ReasonDialog, SalaryDialog, type PaymentPreset } from '@/features/finance/FinanceDialogs';
import { PaymentDrawer } from '@/features/finance/PaymentDrawer';
import { currentPeriod, CursorPager, money, PaymentStatusBadge, useCursorPages } from '@/features/finance/shared';
import { todayISO } from '@/lib/dates';
import { exportXlsx } from '@/lib/exporters';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FilterBar, PageHeader, Panel, SearchInput, StatCard, Table, TD, TH, TR } from '../components/ui';
import { ErrorState, TableLoading } from '../components/states';

type Tab = 'salaries' | 'advances';
const ADVANCE_TYPES: ApiAdvanceType[] = ['SALARY_ADVANCE', 'FUEL_ADVANCE', 'TRIP_ADVANCE', 'OTHER_ADVANCE'];
const PAGE_SIZE = 50;

/** The payment that currently counts for a record: anything not cancelled or reversed. */
const activePayment = (p: ApiPaymentRef | null) => (p && p.status !== 'CANCELLED' && p.status !== 'REVERSED' ? p : null);

function RecordStatus({ status, payment, recovered }: { status: 'PENDING' | 'PAID' | 'CANCELLED'; payment: ApiPaymentRef | null; recovered?: boolean }) {
  const { t } = useTranslation();
  const live = activePayment(payment);
  return (
    <div className="flex flex-wrap gap-1">
      {live && status === 'PENDING' ? (
        <PaymentStatusBadge status={live.status} />
      ) : (
        <Badge tone={status === 'PAID' ? 'success' : status === 'CANCELLED' ? 'neutral' : 'warning'}>{t(`admin.enum.recordStatus.${status}`)}</Badge>
      )}
      {recovered && <Badge tone="info">{t('admin.financeApi.recovered')}</Badge>}
    </div>
  );
}

export function SalariesAdvancesConnected() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('salaries');
  const [period, setPeriod] = useState(currentPeriod());
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [advanceType, setAdvanceType] = useState('');
  const [salaryDialog, setSalaryDialog] = useState(false);
  const [advanceDialog, setAdvanceDialog] = useState(false);
  const [payPreset, setPayPreset] = useState<PaymentPreset | null>(null);
  const [viewPayment, setViewPayment] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ kind: Tab; id: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const search = useDebounced(q);

  const config = useApiResource(() => paymentsApi.config(), []);
  const summary = useApiResource(() => financeApi.payrollSummary(period), [period]);

  const salaryQuery = { payPeriod: period, q: search.trim() || undefined, status: status || undefined };
  const advanceQuery = { status: status || undefined, type: advanceType || undefined };
  const filterKey = JSON.stringify(tab === 'salaries' ? salaryQuery : advanceQuery) + tab;
  const pages = useCursorPages(filterKey);

  const salaries = useApiResource(() => financeApi.salaries({ ...salaryQuery, limit: PAGE_SIZE, cursor: pages.cursor }), [filterKey, pages.cursor], tab === 'salaries');
  const advances = useApiResource(() => financeApi.advances({ ...advanceQuery, limit: PAGE_SIZE, cursor: pages.cursor }), [filterKey, pages.cursor], tab === 'advances');
  const list = tab === 'salaries' ? salaries : advances;
  const nextCursor = list.data?.page.nextCursor ?? null;

  const reloadAll = () => {
    summary.reload();
    salaries.reload();
    advances.reload();
  };

  const exportData = async () => {
    setExporting(true);
    try {
      if (tab === 'salaries') {
        const rows: ApiSalary[] = [];
        let cursor: string | undefined;
        do {
          const page = await financeApi.salaries({ ...salaryQuery, limit: 100, cursor });
          rows.push(...page.data);
          cursor = page.page.nextCursor ?? undefined;
        } while (cursor && rows.length < 10_000);
        const result = await exportXlsx(`salaries-${period}-${todayISO()}.xlsx`, [
          {
            name: t('admin.financeApi.tabSalaries'),
            header: [
              t('admin.financeApi.employee'), t('admin.financeApi.payPeriod'), t('admin.financeApi.base'), t('admin.financeApi.allowances'),
              t('admin.financeApi.recovery'), t('admin.financeApi.deductions'), t('admin.financeApi.net'), t('admin.common.status'),
            ],
            widths: [24, 12, 14, 14, 14, 14, 14, 14],
            rows: rows.map((s) => [
              s.employee.fullName, s.payPeriod, Number(s.baseSalary), Number(s.allowances), Number(s.advanceRecovery), Number(s.deductions), Number(s.netPayable),
              t(`admin.enum.recordStatus.${s.status}`),
            ]),
          },
        ]);
        if (result === 'saved') toast.success(t('admin.common.exported'));
      } else {
        const rows: ApiAdvance[] = [];
        let cursor: string | undefined;
        do {
          const page = await financeApi.advances({ ...advanceQuery, limit: 100, cursor });
          rows.push(...page.data);
          cursor = page.page.nextCursor ?? undefined;
        } while (cursor && rows.length < 10_000);
        const result = await exportXlsx(`advances-${todayISO()}.xlsx`, [
          {
            name: t('admin.financeApi.tabAdvances'),
            header: [t('admin.financeApi.employee'), t('admin.common.type'), t('admin.common.date'), t('admin.financeApi.reason'), `${t('admin.common.amount')} (₹)`, t('admin.common.status')],
            widths: [24, 18, 12, 28, 14, 14],
            rows: rows.map((a) => [a.employee.fullName, t(`admin.enum.advanceType.${a.type}`), a.advanceDate, a.reason ?? '', Number(a.amount), t(`admin.enum.recordStatus.${a.status}`)]),
          },
        ]);
        if (result === 'saved') toast.success(t('admin.common.exported'));
      }
    } catch {
      toast.error(t('common.somethingWrong'));
    } finally {
      setExporting(false);
    }
  };

  const monthLabel = fmtDate(`${period}-01`, i18n.language, { month: 'long', year: 'numeric' });
  const rowMenu = (opts: { canPay: boolean; payment: ApiPaymentRef | null; canCancel: boolean; onPay: () => void; onCancel: () => void }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('admin.common.actions')} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {opts.canPay && <DropdownMenuItem onSelect={opts.onPay}>{t('admin.financeApi.pay')}</DropdownMenuItem>}
        {opts.payment && <DropdownMenuItem onSelect={() => setViewPayment(opts.payment!.id)}>{t('admin.financeApi.viewPayment')}</DropdownMenuItem>}
        {opts.canCancel && (
          <DropdownMenuItem className="text-danger" onSelect={opts.onCancel}>
            {t('admin.financeApi.cancel')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div>
      <PageHeader
        title={t('admin.salaries.title')}
        description={t('admin.salaries.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={exportData} disabled={exporting || (list.data?.data.length ?? 0) === 0}>
              <FileSpreadsheet />
              {t('admin.common.exportExcel')}
            </Button>
            <Button variant="outline" onClick={() => setAdvanceDialog(true)}>
              <HandCoins />
              {t('admin.salaries.recordAdvance')}
            </Button>
            <Button onClick={() => setSalaryDialog(true)}>
              <Plus />
              {t('admin.financeApi.addSalary')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t('admin.financeApi.salariesMonth', { month: monthLabel })}
          value={summary.data ? money(summary.data.salaries.amount) : '—'}
          sub={summary.data ? t('admin.common.records', { count: summary.data.salaries.count }) : undefined}
          icon={Banknote}
          tone="success"
        />
        <StatCard
          label={t('admin.financeApi.advancesMonth', { month: monthLabel })}
          value={summary.data ? money(summary.data.advances.amount) : '—'}
          sub={summary.data ? t('admin.common.records', { count: summary.data.advances.count }) : undefined}
          icon={Wallet}
          tone="neutral"
        />
        <StatCard
          label={t('admin.financeApi.unpaidAdvances')}
          value={summary.data ? money(summary.data.unpaidAdvances.amount) : '—'}
          sub={summary.data ? t('admin.common.records', { count: summary.data.unpaidAdvances.count }) : undefined}
          icon={HandCoins}
          tone="warning"
        />
      </div>

      <div className="mt-6">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex flex-wrap gap-1" role="tablist">
              {(['salaries', 'advances'] as const).map((key) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => {
                    setTab(key);
                    setStatus('');
                  }}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                    tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {key === 'salaries' ? t('admin.financeApi.tabSalaries') : t('admin.financeApi.tabAdvances')}
                </button>
              ))}
            </div>
            <Input type="month" value={period} max={currentPeriod()} onChange={(e) => e.target.value && setPeriod(e.target.value)} className="w-auto" aria-label={t('admin.financeApi.month')} />
          </div>

          <FilterBar
            active={Boolean(q || status || advanceType)}
            onClear={() => {
              setQ('');
              setStatus('');
              setAdvanceType('');
            }}
          >
            {tab === 'salaries' && <SearchInput value={q} onChange={setQ} placeholder={t('admin.salaries.search')} className="w-full sm:w-72" />}
            {tab === 'advances' && (
              <NativeSelect value={advanceType} onChange={(e) => setAdvanceType(e.target.value)} className="w-auto min-w-[160px]" aria-label={t('admin.financeApi.advanceType')}>
                <option value="">{t('admin.financeApi.allAdvanceTypes')}</option>
                {ADVANCE_TYPES.map((k) => (
                  <option key={k} value={k}>{t(`admin.enum.advanceType.${k}`)}</option>
                ))}
              </NativeSelect>
            )}
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-[140px]" aria-label={t('admin.common.status')}>
              <option value="">{t('admin.financeApi.allStatuses')}</option>
              {(['PENDING', 'PAID', 'CANCELLED'] as const).map((k) => (
                <option key={k} value={k}>{t(`admin.enum.recordStatus.${k}`)}</option>
              ))}
            </NativeSelect>
          </FilterBar>

          {list.loading ? (
            <TableLoading rows={5} columns={6} />
          ) : list.error ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : tab === 'salaries' ? (
            <>
              <Table>
                <thead>
                  <tr>
                    <TH>{t('admin.financeApi.employee')}</TH>
                    <TH className="text-right">{t('admin.financeApi.base')}</TH>
                    <TH className="text-right">{t('admin.financeApi.allowances')}</TH>
                    <TH className="text-right">{t('admin.financeApi.recovery')}</TH>
                    <TH className="text-right">{t('admin.financeApi.deductions')}</TH>
                    <TH className="text-right">{t('admin.financeApi.net')}</TH>
                    <TH>{t('admin.common.status')}</TH>
                    <TH className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {(salaries.data?.data ?? []).map((s) => {
                    const live = activePayment(s.payment);
                    return (
                      <TR key={s.id} onClick={live ? () => setViewPayment(live.id) : undefined}>
                        <TD className="min-w-[180px]">
                          <p className="font-medium">{s.employee.fullName}</p>
                          <p className="text-xs text-muted-foreground">{s.employee.employeeCode} · {s.payPeriod}</p>
                        </TD>
                        <TD className="figure text-right">{money(s.baseSalary)}</TD>
                        <TD className="figure text-right">{money(s.allowances)}</TD>
                        <TD className="figure text-right text-muted-foreground">{Number(s.advanceRecovery) > 0 ? `− ${money(s.advanceRecovery)}` : '—'}</TD>
                        <TD className="figure text-right text-muted-foreground">{Number(s.deductions) > 0 ? `− ${money(s.deductions)}` : '—'}</TD>
                        <TD className="figure text-right font-semibold">{money(s.netPayable)}</TD>
                        <TD><RecordStatus status={s.status} payment={s.payment} /></TD>
                        <TD>
                          {rowMenu({
                            canPay: s.status === 'PENDING' && !live,
                            payment: live,
                            canCancel: s.status === 'PENDING' && !live,
                            onPay: () => setPayPreset({ employeeId: s.employee.id, type: 'SALARY', salaryId: s.id }),
                            onCancel: () => setCancelTarget({ kind: 'salaries', id: s.id }),
                          })}
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
              {(salaries.data?.data.length ?? 0) === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.financeApi.salariesEmpty')}</p>}
            </>
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <TH>{t('admin.financeApi.employee')}</TH>
                    <TH>{t('admin.common.type')}</TH>
                    <TH>{t('admin.common.date')}</TH>
                    <TH>{t('admin.financeApi.reason')}</TH>
                    <TH className="text-right">{t('admin.common.amount')}</TH>
                    <TH>{t('admin.common.status')}</TH>
                    <TH className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {(advances.data?.data ?? []).map((a) => {
                    const live = activePayment(a.payment);
                    return (
                      <TR key={a.id} onClick={live ? () => setViewPayment(live.id) : undefined}>
                        <TD className="min-w-[180px]">
                          <p className="font-medium">{a.employee.fullName}</p>
                          <p className="text-xs text-muted-foreground">{a.employee.employeeCode}</p>
                        </TD>
                        <TD><Badge tone="info">{t(`admin.enum.advanceType.${a.type}`)}</Badge></TD>
                        <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(a.advanceDate)}</TD>
                        <TD className="max-w-[220px] truncate text-sm text-muted-foreground">{a.reason ?? '—'}</TD>
                        <TD className="figure text-right font-semibold">{money(a.amount)}</TD>
                        <TD><RecordStatus status={a.status} payment={a.payment} recovered={a.recovered} /></TD>
                        <TD>
                          {rowMenu({
                            canPay: a.status === 'PENDING' && !live,
                            payment: live,
                            canCancel: a.status === 'PENDING' && !live,
                            onPay: () => setPayPreset({ employeeId: a.employee.id, type: 'ADVANCE', advanceId: a.id }),
                            onCancel: () => setCancelTarget({ kind: 'advances', id: a.id }),
                          })}
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
              {(advances.data?.data.length ?? 0) === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.financeApi.advancesEmpty')}</p>}
            </>
          )}
          <CursorPager index={pages.index} nextCursor={nextCursor} onPrev={pages.prev} onNext={() => pages.next(nextCursor)} />
        </Panel>
      </div>

      <SalaryDialog open={salaryDialog} onOpenChange={setSalaryDialog} onSaved={() => { setSalaryDialog(false); reloadAll(); }} />
      <AdvanceDialog open={advanceDialog} onOpenChange={setAdvanceDialog} onSaved={() => { setAdvanceDialog(false); reloadAll(); }} />
      <CreatePaymentDialog
        open={Boolean(payPreset)}
        onOpenChange={(open) => !open && setPayPreset(null)}
        preset={payPreset}
        payoutsEnabled={config.data?.payoutsEnabled ?? false}
        onCreated={(payment) => {
          setPayPreset(null);
          reloadAll();
          setViewPayment(payment.id);
        }}
      />
      <PaymentDrawer paymentId={viewPayment} payoutsEnabled={config.data?.payoutsEnabled ?? false} onClose={() => setViewPayment(null)} onChanged={reloadAll} />
      <ReasonDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title={t('admin.financeApi.cancelTitle')}
        description={t('admin.financeApi.cancelHint')}
        confirmLabel={t('admin.financeApi.confirmCancel')}
        onConfirm={async (reason) => {
          if (!cancelTarget) return;
          if (cancelTarget.kind === 'salaries') await financeApi.cancelSalary(cancelTarget.id, reason);
          else await financeApi.cancelAdvance(cancelTarget.id, reason);
          toast.success(t('admin.financeApi.cancelledToast'));
          setCancelTarget(null);
          reloadAll();
        }}
      />
    </div>
  );
}
