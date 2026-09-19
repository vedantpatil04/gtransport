import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CircleCheckBig, CircleX, FileSpreadsheet, Hourglass, Plus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { PaymentStatusChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { PAYMENT_TYPES } from '@/data/constants';
import { CreatePaymentDialog } from '@/features/payments/CreatePaymentDialog';
import { PaymentActionsMenu } from '@/features/payments/PaymentActions';
import { PaymentSheet } from '@/features/payments/PaymentSheet';
import { monthKey, todayISO } from '@/lib/dates';
import { exportXlsx } from '@/lib/exporters';
import { fmtDate, inr } from '@/lib/format';
import { paymentDate } from '@/lib/selectors';
import { cn, normalize, sum } from '@/lib/utils';
import { useApp } from '@/store';
import type { PaymentStatus } from '@/types';
import { DriverCell, FilterBar, PageHeader, Pagination, Panel, SearchInput, StatCard, Table, TD, TH, TR, usePaged } from '../components/ui';
import { useSyncedData } from '../useAdminData';

const TABS: (PaymentStatus | 'all')[] = ['all', 'pending', 'processing', 'paid', 'failed', 'cancelled'];

export function PaymentsPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const drivers = useApp((s) => s.drivers);
  const { payments } = useSyncedData();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [type, setType] = useState('');
  const [create, setCreate] = useState(false);
  const status = (params.get('status') as PaymentStatus | null) ?? 'all';
  const driverId = params.get('driver') ?? '';
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== 'all') next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const month = monthKey(todayISO());
  const stats = useMemo(() => {
    const by = (s: PaymentStatus) => payments.filter((p) => p.status === s);
    return {
      paidMonth: sum(payments.filter((p) => p.status === 'paid' && monthKey(paymentDate(p)) === month), (p) => p.amount),
      pending: sum(by('pending'), (p) => p.amount),
      pendingCount: by('pending').length,
      processing: sum(by('processing'), (p) => p.amount),
      processingCount: by('processing').length,
      failed: sum(by('failed'), (p) => p.amount),
      failedCount: by('failed').length,
      counts: Object.fromEntries(TABS.map((tb) => [tb, tb === 'all' ? payments.length : by(tb as PaymentStatus).length])) as Record<string, number>,
    };
  }, [payments, month]);

  const rows = useMemo(() => {
    const nq = normalize(q);
    const name = (id: string) => drivers.find((d) => d.id === id)?.name ?? '';
    return payments
      .filter((p) => status === 'all' || p.status === status)
      .filter((p) => !driverId || p.driverId === driverId)
      .filter((p) => !type || p.type === type)
      .filter((p) => !nq || normalize(`${name(p.driverId)} ${p.reference ?? ''} ${p.note}`).includes(nq))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [payments, status, driverId, type, q, drivers]);
  const paged = usePaged(rows, 20, `${status}${driverId}${type}${q}`);

  const exportRows = async () => {
    const name = (id: string) => drivers.find((d) => d.id === id)?.name ?? '';
    const res = await exportXlsx(`payments-${todayISO()}.xlsx`, [
      {
        name: t('admin.nav.payments'),
        header: [t('admin.common.date'), t('admin.common.driver'), t('admin.common.type'), `${t('admin.common.amount')} (₹)`, t('admin.payments.method'), t('admin.common.status'), t('admin.payments.reference')],
        widths: [12, 22, 18, 14, 12, 14, 18],
        rows: rows.map((p) => [paymentDate(p), name(p.driverId), t(`enum.paymentType.${p.type}`), p.amount, t(`enum.method.${p.method}`), t(`enum.paymentStatus.${p.status}`), p.reference ?? '']),
      },
    ]);
    if (res === 'saved') toast.success(t('admin.common.exported'));
  };

  return (
    <div>
      <PageHeader
        title={t('admin.payments.title')}
        description={t('admin.payments.subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={exportRows}>
              <FileSpreadsheet />
              {t('admin.common.exportExcel')}
            </Button>
            <Button onClick={() => setCreate(true)} data-testid="create-payment">
              <Plus />
              {t('admin.payments.create')}
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('admin.payments.paidMonth')} value={inr(stats.paidMonth)} icon={CircleCheckBig} tone="success" />
        <StatCard label={t('enum.paymentStatus.pending')} value={inr(stats.pending)} icon={Wallet} tone="warning" sub={t('admin.payments.count', { count: stats.pendingCount })} />
        <StatCard label={t('enum.paymentStatus.processing')} value={inr(stats.processing)} icon={Hourglass} sub={t('admin.payments.count', { count: stats.processingCount })} />
        <StatCard label={t('enum.paymentStatus.failed')} value={inr(stats.failed)} icon={CircleX} tone="danger" sub={t('admin.payments.count', { count: stats.failedCount })} />
      </div>

      <Panel className="mt-6">
        <div className="scroll-thin flex gap-1 overflow-x-auto border-b px-2 pt-2" role="tablist">
          {TABS.map((tb) => (
            <button
              key={tb}
              role="tab"
              aria-selected={status === tb}
              onClick={() => setParam('status', tb)}
              className={cn('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1.5 text-sm font-medium transition-colors', status === tb ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
              data-testid={`payments-tab-${tb}`}
            >
              {tb === 'all' ? t('common.all') : t(`enum.paymentStatus.${tb}`)}
              <span className="figure rounded-full bg-muted px-1.5 text-xs">{stats.counts[tb]}</span>
            </button>
          ))}
        </div>
        <FilterBar
          active={Boolean(q || driverId || type)}
          onClear={() => {
            setQ('');
            setType('');
            setParam('driver', '');
          }}
        >
          <SearchInput value={q} onChange={setQ} placeholder={t('admin.payments.search')} className="w-full sm:w-72" />
          <NativeSelect value={driverId} onChange={(e) => setParam('driver', e.target.value)} className="w-auto min-w-[150px]" aria-label={t('admin.common.driver')}>
            <option value="">{t('admin.common.allDrivers')}</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={type} onChange={(e) => setType(e.target.value)} className="w-auto min-w-[150px]" aria-label={t('admin.common.type')}>
            <option value="">{t('admin.payments.allTypes')}</option>
            {PAYMENT_TYPES.map((pt) => (
              <option key={pt} value={pt}>
                {t(`enum.paymentType.${pt}`)}
              </option>
            ))}
          </NativeSelect>
        </FilterBar>
        <Table>
          <thead>
            <tr>
              <TH>{t('admin.common.driver')}</TH>
              <TH>{t('admin.common.type')}</TH>
              <TH className="text-right">{t('admin.common.amount')}</TH>
              <TH>{t('admin.payments.method')}</TH>
              <TH>{t('admin.common.status')}</TH>
              <TH>{t('admin.common.date')}</TH>
              <TH>{t('admin.payments.reference')}</TH>
              <TH className="w-12" />
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((p) => (
              <TR key={p.id} onClick={() => setParam('payment', p.id)} data-testid="payment-row">
                <TD className="min-w-[180px]">
                  <DriverCell driver={drivers.find((d) => d.id === p.driverId)} />
                </TD>
                <TD className="whitespace-nowrap">{t(`enum.paymentType.${p.type}`)}</TD>
                <TD className="figure text-right font-semibold">{inr(p.amount)}</TD>
                <TD>{t(`enum.method.${p.method}`)}</TD>
                <TD>
                  <PaymentStatusChip status={p.status} />
                </TD>
                <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(paymentDate(p), i18n.language)}</TD>
                <TD className="font-mono text-xs text-muted-foreground">{p.reference ?? '—'}</TD>
                <TD>
                  <PaymentActionsMenu payment={p} onView={() => setParam('payment', p.id)} />
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t('admin.common.noResults')}</p>}
        <Pagination page={paged.page} pageCount={paged.pageCount} total={paged.total} onPage={paged.setPage} />
      </Panel>
      <CreatePaymentDialog open={create} onOpenChange={setCreate} driverId={driverId || undefined} onCreated={(p) => setParam('payment', p.id)} />
      <PaymentSheet paymentId={params.get('payment')} onClose={() => setParam('payment', '')} />
    </div>
  );
}
