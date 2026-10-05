import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FileDown, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EXPENSE_CATEGORIES, PAYMENT_TYPES } from '@/data/constants';
import i18n from '@/i18n';
import { addDays, monthKey, todayISO } from '@/lib/dates';
import { exportPdf, exportXlsx, rs } from '@/lib/exporters';
import { fmtDate, fmtDayMonth, fmtMonth, inr, inrCompact, num } from '@/lib/format';
import { paymentDate } from '@/lib/selectors';
import { sum } from '@/lib/utils';
import { useApp } from '@/store';
import type { PaymentStatus } from '@/types';
import { PageHeader } from '../components/ui';
import { useSyncedData } from '../useAdminData';
import { isApiConfigured } from '@/features/api/mode';
import { C, ChartPanel, Donut, HBar, axis, tooltipStyle } from '@/features/reports/charts';
import { PageFallback } from '@/pages/PageFallback';

// Loaded on first visit: the live reports are not part of the console's first download.
const ReportsConnected = lazy(() => import('@/features/reports/ReportsConnected').then((m) => ({ default: m.ReportsConnected })));

const SERIES = ['fuel', 'salaries', 'maintenance', 'tolls', 'other'] as const;
type SeriesKey = (typeof SERIES)[number];
const SERIES_COLOR: Record<SeriesKey, string> = { fuel: C(1), salaries: C(2), maintenance: C(3), tolls: C(4), other: C(6) };
const STATUS_COLOR: Record<PaymentStatus, string> = { paid: C(2), processing: C(4), pending: C(3), failed: C(5), cancelled: 'hsl(var(--muted-foreground))' };


function ReportsDemo() {
  const { t, i18n: inst } = useTranslation();
  const lang = inst.language;
  const drivers = useApp((s) => s.drivers);
  const vehicles = useApp((s) => s.vehicles);
  const history = useApp((s) => s.history);
  const company = useApp((s) => s.company);
  const { fuel, expenses, payments } = useSyncedData();
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);

  const today = todayISO();
  const month = monthKey(today);
  const data = useMemo(() => {
    const mf = fuel.filter((f) => monthKey(f.date) === month);
    const me = expenses.filter((e) => monthKey(e.date) === month && e.status !== 'rejected');
    const mp = payments.filter((p) => monthKey(paymentDate(p)) === month);
    const byCat = (cats: string[]) => sum(me.filter((e) => cats.includes(e.category)), (e) => e.amount);
    const current = {
      month,
      fuel: sum(mf, (f) => f.amount),
      salaries: sum(mp.filter((p) => p.type === 'salary' && p.status === 'paid'), (p) => p.amount),
      maintenance: byCat(['maintenance', 'tyre', 'tyre_insurance']),
      tolls: byCat(['toll']),
      other: byCat(['rto', 'trip', 'other']),
    };
    const total = current.fuel + current.salaries + current.maintenance + current.tolls + current.other;
    const trend = [...history, current].map((m) => ({ ...m, label: fmtDate(`${m.month}-01`, lang, { month: 'short' }), total: m.fuel + m.salaries + m.maintenance + m.tolls + m.other }));

    const days = Number(today.slice(8, 10));
    const daily = Array.from({ length: days }, (_, i) => {
      const d = addDays(`${month}-01`, i);
      return { d, label: fmtDayMonth(d, lang), fuel: sum(mf.filter((f) => f.date === d), (f) => f.amount), other: sum(me.filter((e) => e.date === d), (e) => e.amount) };
    });

    const byVehicle = vehicles
      .map((v) => ({ name: v.reg, value: sum(mf.filter((f) => f.vehicleId === v.id), (f) => f.amount), litres: sum(mf.filter((f) => f.vehicleId === v.id), (f) => f.litres) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
    const byDriver = drivers
      .map((d) => ({ name: d.name, value: sum(mf.filter((f) => f.driverId === d.id), (f) => f.amount), count: mf.filter((f) => f.driverId === d.id).length }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
    const fuelTypes = (['petrol', 'diesel'] as const).map((ft) => ({ key: ft, name: t(`enum.fuelType.${ft}`), value: sum(mf.filter((f) => f.fuelType === ft), (f) => f.amount), litres: sum(mf.filter((f) => f.fuelType === ft), (f) => f.litres) }));
    const statuses = (['paid', 'processing', 'pending', 'failed', 'cancelled'] as PaymentStatus[]).map((s) => ({ key: s, name: t(`enum.paymentStatus.${s}`), value: sum(mp.filter((p) => p.status === s), (p) => p.amount), count: mp.filter((p) => p.status === s).length })).filter((x) => x.count > 0);
    const categories = EXPENSE_CATEGORIES.map((c) => ({ key: c, name: t(`enum.category.${c}`), value: byCat([c]), count: me.filter((e) => e.category === c).length })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    const paymentTypes = PAYMENT_TYPES.map((pt) => ({ key: pt, value: sum(mp.filter((p) => p.type === pt && p.status === 'paid'), (p) => p.amount) }));
    return { mf, me, mp, current, total, trend, daily, byVehicle, byDriver, fuelTypes, statuses, categories, paymentTypes, litres: sum(mf, (f) => f.litres) };
  }, [fuel, expenses, payments, history, drivers, vehicles, month, today, lang, t]);

  const monthLabel = fmtMonth(month, lang);

  const doPdf = async () => {
    setBusy('pdf');
    const en = i18n.getFixedT('en');
    const cards = SERIES.map((k) => [en(`admin.reports.${k}`), rs(data.current[k])]);
    try {
      const res = await exportPdf(`gangamata-report-${month}.pdf`, {
        company: company.name.toUpperCase(),
        subtitle: `${en('admin.reports.pdfSubtitle', { month: fmtMonth(month, 'en') })} · ${company.office}`,
        generated: en('admin.reports.generated', { date: fmtDate(new Date(), 'en') }),
        title: en('admin.reports.pdfTitle', { month: fmtMonth(month, 'en') }),
        footer: en('admin.reports.pdfFooter'),
        sections: [
          { heading: en('admin.reports.summary'), head: [en('admin.reports.head'), en('admin.common.amount')], body: cards, foot: [en('admin.reports.total'), rs(data.total)], numeric: [1] },
          {
            heading: en('admin.reports.monthly'),
            head: [en('admin.reports.month'), ...SERIES.map((k) => en(`admin.reports.${k}`)), en('admin.reports.total')],
            body: data.trend.map((m) => [fmtMonth(m.month, 'en'), ...SERIES.map((k) => rs(m[k])), rs(m.total)]),
            numeric: [1, 2, 3, 4, 5, 6],
          },
          { heading: en('admin.reports.fuelByVehicle'), head: [en('admin.common.vehicle'), en('admin.fuel.litres'), en('admin.common.amount')], body: data.byVehicle.map((v) => [v.name, num(v.litres, 0), rs(v.value)]), numeric: [1, 2] },
          { heading: en('admin.reports.fuelByDriver'), head: [en('admin.common.driver'), en('admin.reports.entries'), en('admin.common.amount')], body: data.byDriver.map((d) => [d.name, d.count, rs(d.value)]), numeric: [1, 2] },
          { heading: en('admin.reports.categories'), head: [en('admin.expenses.category'), en('admin.reports.entries'), en('admin.common.amount')], body: data.categories.map((c) => [en(`enum.category.${c.key}`), c.count, rs(c.value)]), numeric: [1, 2] },
          { heading: en('admin.reports.paymentStatus'), head: [en('admin.common.status'), en('admin.reports.count'), en('admin.common.amount')], body: data.statuses.map((s) => [en(`enum.paymentStatus.${s.key}`), s.count, rs(s.value)]), numeric: [1, 2] },
        ],
      });
      if (res === 'saved') toast.success(t('admin.reports.pdfReady'));
      else if (res === 'failed') toast.error(t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };

  const doXlsx = async () => {
    setBusy('xlsx');
    const dName = (id: string) => drivers.find((d) => d.id === id)?.name ?? '';
    const reg = (id: string) => vehicles.find((v) => v.id === id)?.reg ?? '';
    try {
      const res = await exportXlsx(`gangamata-report-${month}.xlsx`, [
        {
          name: t('admin.reports.summary'),
          header: [t('admin.reports.head'), `${t('admin.common.amount')} (₹)`],
          widths: [26, 18],
          rows: [...SERIES.map((k) => [t(`admin.reports.${k}`), data.current[k]]), [t('admin.reports.total'), data.total]],
        },
        {
          name: t('admin.reports.monthly'),
          header: [t('admin.reports.month'), ...SERIES.map((k) => t(`admin.reports.${k}`)), t('admin.reports.total')],
          widths: [18, 14, 14, 14, 14, 14, 16],
          rows: data.trend.map((m) => [fmtMonth(m.month, lang), ...SERIES.map((k) => m[k]), m.total]),
        },
        {
          name: t('admin.nav.fuel'),
          header: [t('admin.common.date'), t('admin.common.driver'), t('admin.common.vehicle'), t('admin.fuel.type'), `${t('admin.common.amount')} (₹)`, t('admin.fuel.litres'), t('admin.fuel.station')],
          widths: [12, 22, 16, 10, 14, 10, 34],
          rows: data.mf.map((f) => [f.date, dName(f.driverId), reg(f.vehicleId), t(`enum.fuelType.${f.fuelType}`), f.amount, f.litres, f.station]),
        },
        {
          name: t('admin.nav.expenses'),
          header: [t('admin.common.date'), t('admin.expenses.category'), t('admin.common.driver'), t('admin.common.vehicle'), `${t('admin.common.amount')} (₹)`, t('common.note')],
          widths: [12, 16, 22, 16, 14, 34],
          rows: data.me.map((e) => [e.date, t(`enum.category.${e.category}`), dName(e.driverId), reg(e.vehicleId), e.amount, e.note]),
        },
        {
          name: t('admin.nav.payments'),
          header: [t('admin.common.date'), t('admin.common.driver'), t('admin.common.type'), `${t('admin.common.amount')} (₹)`, t('admin.common.status'), t('admin.payments.reference')],
          widths: [12, 22, 18, 14, 14, 18],
          rows: data.mp.map((p) => [paymentDate(p), dName(p.driverId), t(`enum.paymentType.${p.type}`), p.amount, t(`enum.paymentStatus.${p.status}`), p.reference ?? '']),
        },
      ]);
      if (res === 'saved') toast.success(t('admin.reports.xlsxReady'));
      else if (res === 'failed') toast.error(t('common.somethingWrong'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('admin.reports.title')}
        description={t('admin.reports.subtitle', { month: monthLabel })}
        actions={
          <>
            <Button variant="outline" onClick={doXlsx} disabled={!!busy} data-testid="export-xlsx">
              {busy === 'xlsx' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
              {t('admin.reports.exportExcel')}
            </Button>
            <Button onClick={doPdf} disabled={!!busy} data-testid="export-pdf">
              {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <FileDown />}
              {t('admin.reports.exportPdf')}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {SERIES.map((k) => (
          <div key={k} className="panel p-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="size-2.5 rounded-sm" style={{ background: SERIES_COLOR[k] }} />
              {t(`admin.reports.${k}`)}
            </p>
            <p className="figure mt-1.5 text-xl font-bold" data-testid={`report-${k}`}>
              {inr(data.current[k])}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{data.total ? `${num((data.current[k] / data.total) * 100, 1)}%` : '—'}</p>
          </div>
        ))}
        <div className="rounded-lg bg-primary p-4 text-white dark:bg-[#1f3354]">
          <p className="text-sm text-white/70">{t('admin.reports.total')}</p>
          <p className="figure mt-1.5 text-xl font-bold" data-testid="report-total">
            {inr(data.total)}
          </p>
          <p className="mt-0.5 text-xs text-white/60">{monthLabel}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <ChartPanel title={t('admin.reports.monthly')} sub={t('admin.reports.monthlySub')} height="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="label" {...axis} />
              <YAxis tickFormatter={inrCompact} {...axis} width={56} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number, k: string) => [inr(v), t(`admin.reports.${k}`)]} />
              <Legend formatter={(k: string) => <span className="text-xs text-foreground">{t(`admin.reports.${k}`)}</span>} iconSize={10} />
              {SERIES.map((k, i) => (
                <Bar key={k} dataKey={k} stackId="a" fill={SERIES_COLOR[k]} radius={i === SERIES.length - 1 ? [3, 3, 0, 0] : 0} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title={t('admin.reports.categories')} sub={monthLabel} height="h-80">
          <Donut data={data.categories.map((c, i) => ({ ...c, color: C((i % 6) + 1) }))} center={inr(sum(data.categories, (c) => c.value))} centerLabel={t('admin.reports.expenses')} />
        </ChartPanel>
      </div>

      <ChartPanel className="mt-4" title={t('admin.reports.daily')} sub={t('admin.reports.dailySub', { month: monthLabel })} height="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gFuel" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C(1)} stopOpacity={0.3} />
                <stop offset="100%" stopColor={C(1)} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gOther" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C(3)} stopOpacity={0.3} />
                <stop offset="100%" stopColor={C(3)} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tickFormatter={inrCompact} {...axis} width={56} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number, k: string) => [inr(v), k === 'fuel' ? t('admin.reports.fuel') : t('admin.reports.otherExpenses')]} />
            <Legend formatter={(k: string) => <span className="text-xs text-foreground">{k === 'fuel' ? t('admin.reports.fuel') : t('admin.reports.otherExpenses')}</span>} iconSize={10} />
            <Area type="monotone" dataKey="fuel" stroke={C(1)} strokeWidth={2} fill="url(#gFuel)" />
            <Area type="monotone" dataKey="other" stroke={C(3)} strokeWidth={2} fill="url(#gOther)" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartPanel>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartPanel title={t('admin.reports.fuelByVehicle')} sub={t('admin.reports.top', { count: 10 })} height="h-80">
          <HBar data={data.byVehicle.slice(0, 10)} color={C(1)} />
        </ChartPanel>
        <ChartPanel title={t('admin.reports.fuelByDriver')} sub={t('admin.reports.top', { count: 10 })} height="h-80">
          <HBar data={data.byDriver.slice(0, 10)} color={C(4)} />
        </ChartPanel>
        <ChartPanel title={t('admin.reports.petrolDiesel')} sub={t('units.litres', { value: num(data.litres, 0) })}>
          <Donut
            data={data.fuelTypes.map((f) => ({ ...f, color: f.key === 'petrol' ? C(2) : C(1), extra: t('units.litresShort', { value: num(f.litres, 0) }) }))}
            center={inr(data.current.fuel)}
            centerLabel={t('admin.reports.fuel')}
          />
        </ChartPanel>
        <ChartPanel title={t('admin.reports.paymentStatus')} sub={monthLabel}>
          <Donut data={data.statuses.map((s) => ({ ...s, color: STATUS_COLOR[s.key], extra: t('admin.payments.count', { count: s.count }) }))} center={String(sum(data.statuses, (s) => s.count))} centerLabel={t('admin.reports.payments')} />
        </ChartPanel>
      </div>
    </div>
  );
}

/** Demo mode keeps the approved prototype; real mode reports from the live API, never sample data. */
export function ReportsPage() {
  return isApiConfigured() ? (
    <Suspense fallback={<PageFallback />}>
      <ReportsConnected />
    </Suspense>
  ) : (
    <ReportsDemo />
  );
}
