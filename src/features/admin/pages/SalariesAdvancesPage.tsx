import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Banknote, FileSpreadsheet, HandCoins, Plus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { PaymentStatusChip } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreatePaymentDialog } from '@/features/payments/CreatePaymentDialog';
import { PaymentActionsMenu } from '@/features/payments/PaymentActions';
import { PaymentSheet } from '@/features/payments/PaymentSheet';
import { monthKey, todayISO } from '@/lib/dates';
import { exportXlsx } from '@/lib/exporters';
import { fmtDate, inr } from '@/lib/format';
import { paymentDate } from '@/lib/selectors';
import { cn, normalize, sum } from '@/lib/utils';
import { useApp } from '@/store';
import type { PaymentType } from '@/types';
import { DriverCell, FilterBar, PageHeader, Pagination, Panel, SearchInput, StatCard, Table, TD, TH, TR, usePaged } from '../components/ui';
import { useSyncedData } from '../useAdminData';
import { useConnected } from '@/features/api/mode';
import { SalariesAdvancesConnected } from './SalariesAdvancesConnected';

const SALARY_ADVANCE_TYPES: PaymentType[] = ['salary', 'fuel_advance', 'trip_allowance', 'other_advance'];

function SalariesAdvancesDemo() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const drivers = useApp((s) => s.drivers);
  const { payments } = useSyncedData();

  const [q, setQ] = useState(params.get('q') ?? '');
  const [selectedType, setSelectedType] = useState<string>(params.get('type') ?? 'all');
  const [create, setCreate] = useState(false);
  const [detailPaymentId, setDetailPaymentId] = useState<string | null>(null);

  const month = monthKey(todayISO());

  // Filter payments to only salaries and advances
  const relevantPayments = useMemo(() => {
    return payments.filter((p) => SALARY_ADVANCE_TYPES.includes(p.type));
  }, [payments]);

  // Statistics
  const stats = useMemo(() => {
    const salariesThisMonth = sum(
      relevantPayments.filter((p) => p.type === 'salary' && p.status === 'paid' && monthKey(paymentDate(p)) === month),
      (p) => p.amount,
    );
    const advancesPending = sum(
      relevantPayments.filter((p) => p.type !== 'salary' && (p.status === 'pending' || p.status === 'processing')),
      (p) => p.amount,
    );
    const pendingCount = relevantPayments.filter((p) => p.type !== 'salary' && (p.status === 'pending' || p.status === 'processing')).length;
    const advancesThisMonth = sum(
      relevantPayments.filter((p) => p.type !== 'salary' && p.status === 'paid' && monthKey(paymentDate(p)) === month),
      (p) => p.amount,
    );

    return {
      salariesThisMonth,
      advancesPending,
      pendingCount,
      advancesThisMonth,
    };
  }, [relevantPayments, month]);

  // Rows matching filters
  const rows = useMemo(() => {
    const nq = normalize(q);
    const name = (id: string) => drivers.find((d) => d.id === id)?.name ?? '';

    return relevantPayments
      .filter((p) => selectedType === 'all' || p.type === selectedType)
      .filter((p) => {
        if (!nq) return true;
        return normalize(`${name(p.driverId)} ${p.reference || ''} ${p.note || ''} ${p.amount}`).includes(nq);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [relevantPayments, selectedType, q, drivers]);

  const paged = usePaged(rows, 20);

  const exportData = async () => {
    const dName = (id: string) => drivers.find((d) => d.id === id)?.name ?? '—';
    const res = await exportXlsx(`salaries-advances-${todayISO()}.xlsx`, [
      {
        name: t('admin.salaries.title'),
        header: [
          t('admin.common.date'),
          t('admin.common.driver'),
          t('admin.common.type'),
          `${t('admin.common.amount')} (₹)`,
          t('admin.payments.method'),
          t('admin.common.status'),
          t('admin.payments.reference'),
          t('common.note'),
        ],
        widths: [14, 22, 18, 14, 14, 14, 18, 24],
        rows: rows.map((p) => [
          paymentDate(p),
          dName(p.driverId),
          t(`enum.paymentType.${p.type}`),
          p.amount,
          t(`enum.paymentMethod.${p.method}`),
          p.status,
          p.reference ?? '',
          p.note ?? '',
        ]),
      },
    ]);
    if (res === 'saved') toast.success(t('admin.common.exported'));
  };

  return (
    <div>
      <PageHeader
        title={t('admin.salaries.title')}
        description={t('admin.salaries.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportData} disabled={rows.length === 0}>
              <FileSpreadsheet />
              {t('admin.common.exportExcel')}
            </Button>
            <Button onClick={() => setCreate(true)}>
              <Plus />
              {t('admin.salaries.recordAdvance')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t('admin.salaries.monthlySalaries')} value={inr(stats.salariesThisMonth)} icon={Banknote} tone="success" />
        <StatCard label={t('admin.salaries.pendingAdvances')} value={inr(stats.advancesPending)} sub={`${stats.pendingCount} pending`} icon={HandCoins} tone="warning" />
        <StatCard label={t('admin.salaries.totalAdvancesMonth')} value={inr(stats.advancesThisMonth)} icon={Wallet} tone="neutral" />
      </div>

      <div className="mt-6">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex flex-wrap gap-1">
              {(['all', 'salary', 'fuel_advance', 'trip_allowance', 'other_advance'] as const).map((tabKey) => {
                const active = selectedType === tabKey;
                const count = tabKey === 'all' ? relevantPayments.length : relevantPayments.filter((p) => p.type === tabKey).length;
                return (
                  <button
                    key={tabKey}
                    onClick={() => setSelectedType(tabKey)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {t(`admin.salaries.tab.${tabKey}`)}
                    <span className="figure ml-1.5 opacity-80">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          <FilterBar active={Boolean(q)} onClear={() => setQ('')}>
            <SearchInput value={q} onChange={setQ} placeholder={t('admin.salaries.search')} className="w-full sm:w-80" />
          </FilterBar>

          <Table>
            <thead>
              <tr>
                <TH>{t('admin.common.driver')}</TH>
                <TH>{t('admin.common.type')}</TH>
                <TH>{t('admin.payments.method')}</TH>
                <TH>{t('admin.common.date')}</TH>
                <TH className="text-right">{t('admin.common.amount')}</TH>
                <TH>{t('admin.common.status')}</TH>
                <TH className="w-12" />
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((p) => {
                const driver = drivers.find((d) => d.id === p.driverId);
                return (
                  <TR key={p.id} onClick={() => setDetailPaymentId(p.id)}>
                    <TD className="min-w-[200px]">
                      {driver ? <DriverCell driver={driver} sub={p.reference || p.note || '—'} link={false} /> : <span className="font-medium">—</span>}
                    </TD>
                    <TD>
                      <Badge tone={p.type === 'salary' ? 'success' : 'info'}>
                        {t(`enum.paymentType.${p.type}`)}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{t(`enum.paymentMethod.${p.method}`)}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(paymentDate(p))}</TD>
                    <TD className="figure text-right font-semibold">{inr(p.amount)}</TD>
                    <TD>
                      <PaymentStatusChip status={p.status} />
                    </TD>
                    <TD>
                      <PaymentActionsMenu payment={p} onView={() => setDetailPaymentId(p.id)} />
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>

          {rows.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.salaries.empty')}</p>}

          <Pagination page={paged.page} pageCount={paged.pageCount} total={paged.total} onPage={paged.setPage} />
        </Panel>
      </div>

      <CreatePaymentDialog open={create} onOpenChange={setCreate} />
      <PaymentSheet paymentId={detailPaymentId} onClose={() => setDetailPaymentId(null)} />
    </div>
  );
}

/** Live data when the API is configured and an office user is signed in; the approved prototype otherwise. */
export function SalariesAdvancesPage() {
  return useConnected() ? <SalariesAdvancesConnected /> : <SalariesAdvancesDemo />;
}
