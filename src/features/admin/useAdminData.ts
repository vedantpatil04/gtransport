import { useMemo } from 'react';
import { docStatus } from '@/features/documents/expiry';
import { localDateOf, monthKey, todayISO } from '@/lib/dates';
import { paymentDate, synced } from '@/lib/selectors';
import { sum } from '@/lib/utils';
import { useApp } from '@/store';

/** Admin only sees records that have reached the office (not ones queued on a phone). */
export function useSyncedData() {
  const fuel = useApp((s) => s.fuel);
  const expenses = useApp((s) => s.expenses);
  const payments = useApp((s) => s.payments);
  return useMemo(() => ({ fuel: synced(fuel), expenses: synced(expenses), payments: synced(payments) }), [fuel, expenses, payments]);
}

export function useTodayOverview() {
  const { fuel, expenses, payments } = useSyncedData();
  return useMemo(() => {
    const today = todayISO();
    const month = monthKey(today);
    const fuelToday = fuel.filter((f) => f.date === today);
    const expToday = expenses.filter((e) => e.date === today && e.status !== 'rejected');
    const paidToday = payments.filter((p) => p.status === 'paid' && p.paidAt && localDateOf(p.paidAt) === today);
    const pending = payments.filter((p) => p.status === 'pending');
    const processing = payments.filter((p) => p.status === 'processing');
    return {
      fuel: sum(fuelToday, (f) => f.amount),
      fuelCount: fuelToday.length,
      fuelLitres: sum(fuelToday, (f) => f.litres),
      other: sum(expToday, (e) => e.amount),
      otherCount: expToday.length,
      paid: sum(paidToday, (p) => p.amount),
      paidCount: paidToday.length,
      pending: sum(pending, (p) => p.amount),
      pendingCount: pending.length,
      processing: sum(processing, (p) => p.amount),
      processingCount: processing.length,
      monthFuel: sum(fuel.filter((f) => monthKey(f.date) === month), (f) => f.amount),
      monthPaid: sum(payments.filter((p) => p.status === 'paid' && monthKey(paymentDate(p)) === month), (p) => p.amount),
    };
  }, [fuel, expenses, payments]);
}

export function useComplianceCounts() {
  const documents = useApp((s) => s.documents);
  return useMemo(() => {
    const c = { expired: 0, within7: 0, within30: 0, valid: 0 };
    for (const d of documents) {
      const s = docStatus(d);
      if (s.state === 'expired') c.expired += 1;
      else if (s.state === 'expiring' && (s.days ?? 99) <= 7) c.within7 += 1;
      else if (s.state === 'expiring') c.within30 += 1;
      else c.valid += 1;
    }
    return c;
  }, [documents]);
}
