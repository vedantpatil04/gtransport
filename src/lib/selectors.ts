import { localDateOf, monthKey } from './dates';
import { sum } from './utils';
import type { Expense, FuelEntry, Payment } from '@/types';

/** The date a payment counts for: when money moved if paid, otherwise when it was created. */
export const paymentDate = (p: Payment) => localDateOf(p.paidAt ?? p.createdAt);

export function driverDayTotals(driverId: string, day: string, fuel: FuelEntry[], expenses: Expense[], payments: Payment[]) {
  const f = fuel.filter((x) => x.driverId === driverId && x.date === day);
  const e = expenses.filter((x) => x.driverId === driverId && x.date === day && x.status !== 'rejected');
  const received = payments.filter((x) => x.driverId === driverId && x.status === 'paid' && x.paidAt && localDateOf(x.paidAt) === day);
  return { fuel: sum(f, (x) => x.amount), fuelCount: f.length, other: sum(e, (x) => x.amount), received: sum(received, (x) => x.amount) };
}

export function driverMonthTotals(driverId: string, month: string, fuel: FuelEntry[], expenses: Expense[], payments: Payment[]) {
  const f = fuel.filter((x) => x.driverId === driverId && monthKey(x.date) === month);
  const e = expenses.filter((x) => x.driverId === driverId && monthKey(x.date) === month && x.status !== 'rejected');
  const paid = payments.filter((x) => x.driverId === driverId && x.status === 'paid' && monthKey(paymentDate(x)) === month);
  return {
    fuel: sum(f, (x) => x.amount), litres: sum(f, (x) => x.litres), fuelCount: f.length,
    other: sum(e, (x) => x.amount), paid: sum(paid, (x) => x.amount),
  };
}

export function vehicleMonthTotals(vehicleId: string, month: string, fuel: FuelEntry[], expenses: Expense[]) {
  const f = fuel.filter((x) => x.vehicleId === vehicleId && monthKey(x.date) === month);
  const e = expenses.filter((x) => x.vehicleId === vehicleId && monthKey(x.date) === month && x.status !== 'rejected');
  return { fuel: sum(f, (x) => x.amount), litres: sum(f, (x) => x.litres), fuelCount: f.length, other: sum(e, (x) => x.amount) };
}

/** Admin only sees what has reached the server; entries still queued on a driver's phone stay hidden. */
export const synced = <T extends { sync: 'synced' | 'pending' }>(items: T[]) => items.filter((x) => x.sync === 'synced');
