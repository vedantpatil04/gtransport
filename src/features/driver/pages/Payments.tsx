import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight, Phone, Wallet } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { PAYMENT_TONE, PaymentStatusChip } from '@/components/status';
import { monthKey, todayISO } from '@/lib/dates';
import { fmtDate, fmtDateTime, fmtDayMonth, fmtMonth, inr } from '@/lib/format';
import { paymentDate } from '@/lib/selectors';
import { cn, sum } from '@/lib/utils';
import { useApp, useCurrentDriver } from '@/store';
import type { Payment, PaymentStatus } from '@/types';
import { DriverHeader } from '../components/DriverHeader';

export function DriverPayments() {
  const { t, i18n } = useTranslation();
  const driver = useCurrentDriver();
  const all = useApp((s) => s.payments);
  const mine = useMemo(() => all.filter((p) => p.driverId === driver.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [all, driver.id]);
  const thisMonth = monthKey(todayISO());
  const received = sum(mine.filter((p) => p.status === 'paid' && monthKey(paymentDate(p)) === thisMonth), (p) => p.amount);
  const groups = useMemo(() => {
    const m = new Map<string, Payment[]>();
    for (const p of mine) m.set(monthKey(p.createdAt.slice(0, 10)), [...(m.get(monthKey(p.createdAt.slice(0, 10))) ?? []), p]);
    return [...m.entries()];
  }, [mine]);

  return (
    <div>
      <DriverHeader title={t('driver.payments.title')} />
      <div className="space-y-5 px-4 py-5">
        <div className="rounded-xl bg-success-soft p-4">
          <p className="text-sm font-medium text-success">{t('driver.payments.receivedThisMonth')}</p>
          <p className="figure mt-1 text-3xl font-extrabold text-success">{inr(received)}</p>
          <p className="mt-0.5 text-sm text-success/80">{fmtMonth(thisMonth, i18n.language)}</p>
        </div>
        {groups.length === 0 && (
          <div className="panel">
            <EmptyState icon={Wallet} title={t('driver.payments.empty')} />
          </div>
        )}
        {groups.map(([month, items]) => (
          <section key={month}>
            <h2 className="mb-2 px-1 text-[15px] font-bold">{fmtMonth(month, i18n.language)}</h2>
            <ul className="panel divide-y overflow-hidden">
              {items.map((p) => {
                const tone = PAYMENT_TONE[p.status];
                const Icon = tone.icon;
                return (
                  <li key={p.id}>
                    <Link to={`/driver/payments/${p.id}`} className="flex min-h-[72px] items-center gap-3 px-3 py-3 hover:bg-accent/60" data-testid="driver-payment-row">
                      <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-full', tone.bg, tone.text)}>
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="figure block text-lg font-bold leading-tight">{inr(p.amount)}</span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {t(`enum.paymentType.${p.type}`)} · {fmtDayMonth(p.paidAt ?? p.createdAt, i18n.language)}
                        </span>
                      </span>
                      <PaymentStatusChip status={p.status} driver />
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

const HINT: Record<PaymentStatus, string> = {
  pending: 'driver.payments.hintPending',
  processing: 'driver.payments.hintProcessing',
  paid: 'driver.payments.hintPaid',
  failed: 'driver.payments.hintFailed',
  cancelled: 'driver.payments.hintCancelled',
};

export function DriverPaymentDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const payment = useApp((s) => s.payments.find((p) => p.id === id));
  const company = useApp((s) => s.company);
  if (!payment)
    return (
      <div>
        <DriverHeader title={t('driver.payments.detail')} back="/driver/payments" />
        <EmptyState icon={Wallet} title={t('driver.payments.notFound')} />
      </div>
    );
  const tone = PAYMENT_TONE[payment.status];
  const Icon = tone.icon;
  const hint = payment.status === 'paid' && payment.method === 'cash' ? 'driver.payments.hintPaidCash' : HINT[payment.status];
  const rows: [string, React.ReactNode][] = [
    [t('driver.payments.amount'), <span className="figure">{inr(payment.amount)}</span>],
    [t('driver.payments.type'), t(`enum.paymentType.${payment.type}`)],
    [t('driver.payments.status'), <PaymentStatusChip status={payment.status} driver />],
    [t('driver.payments.date'), fmtDate(payment.paidAt ?? payment.createdAt, i18n.language)],
    [t('driver.payments.method'), t(`enum.method.${payment.method}`)],
    [t('driver.payments.reference'), payment.reference ? <span className="font-mono text-[14px]">{payment.reference}</span> : <span className="font-normal text-muted-foreground">{t('driver.payments.notYet')}</span>],
  ];
  if (payment.note) rows.push([t('driver.payments.note'), payment.note]);

  // Show the steps a payment moves through, ticking the ones already reached.
  const steps = payment.reportedByDriver ? [] : (['created', 'approved', 'processing', payment.status === 'failed' ? 'failed' : payment.status === 'cancelled' ? 'cancelled' : 'paid'] as const);

  return (
    <div data-testid="driver-payment-detail">
      <DriverHeader title={t('driver.payments.detail')} back="/driver/payments" />
      <div className="space-y-5 px-4 py-5">
        <div className={cn('rounded-2xl p-5 text-center', tone.bg)}>
          <span className={cn('mx-auto flex size-14 items-center justify-center rounded-full bg-card', tone.text)}>
            <Icon className="size-7" />
          </span>
          <p className="figure mt-3 text-4xl font-extrabold">{inr(payment.amount)}</p>
          <p className="mt-1 font-semibold">{t(`enum.paymentType.${payment.type}`)}</p>
          <div className="mt-3 flex justify-center">
            <PaymentStatusChip status={payment.status} driver size="lg" />
          </div>
          <p className={cn('mt-3 text-sm font-medium', tone.text)}>{payment.reportedByDriver ? t('driver.payments.recordedByYou') : t(hint)}</p>
        </div>
        <dl className="panel divide-y text-[15px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        {steps.length > 0 && (
          <section className="panel p-4">
            <h2 className="mb-3 text-[15px] font-bold">{t('driver.payments.progress')}</h2>
            <ol className="space-y-0">
              {steps.map((s, i) => {
                const ev = [...payment.history].reverse().find((h) => h.status === s);
                const done = Boolean(ev);
                const bad = s === 'failed' || s === 'cancelled';
                return (
                  <li key={s} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < steps.length - 1 && <span aria-hidden className={cn('absolute left-[11px] top-6 h-[calc(100%-18px)] w-0.5', done ? 'bg-success/50' : 'bg-border')} />}
                    <span className={cn('relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2', done ? (bad ? 'border-danger bg-danger text-white' : 'border-success bg-success text-white') : 'border-input bg-card')}>
                      {done && <Check className="size-3.5" strokeWidth={3.5} />}
                    </span>
                    <div className="-mt-0.5">
                      <p className={cn('font-semibold', !done && 'text-muted-foreground')}>{t(`enum.paymentEvent.${s}`)}</p>
                      {ev && <p className="text-sm text-muted-foreground">{fmtDateTime(ev.at, i18n.language)}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
        <div className="panel flex items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">{t('driver.payments.askOffice')}</p>
          <Button asChild variant="outline" size="lg">
            <a href="tel:+918312400000">
              <Phone />
              {t('driver.payments.callOffice')}
            </a>
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">{company.phone}</p>
      </div>
    </div>
  );
}
