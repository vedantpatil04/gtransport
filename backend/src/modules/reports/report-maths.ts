import { PaymentStatus, Prisma } from '@prisma/client';
import { daysUntil } from '../compliance/document-expiry.policy';
import { ratePerLitre } from '../fuel/fuel.maths';
import { bucketKey, bucketsFor, type ReportRange } from './report-range';

/**
 * Reporting arithmetic. Pure functions over values the database has already aggregated, so the
 * rules that decide a figure — what "paid" includes, how an average rate is weighted, when a
 * document counts as expiring — are written once and tested directly.
 *
 * Money stays in Decimal until it leaves as a two-decimal string; it never passes through a
 * float on the way.
 */

export type Dec = Prisma.Decimal;
const D = (value: Prisma.Decimal | string | number | null | undefined): Dec => new Prisma.Decimal(value ?? 0);
export const ZERO = D(0);

export const money = (value: Prisma.Decimal | string | number | null | undefined): string => D(value).toFixed(2);
export const litres = (value: Prisma.Decimal | string | number | null | undefined): string => D(value).toFixed(3);

export function sum(values: (Prisma.Decimal | string | number | null | undefined)[]): Dec {
  return values.reduce<Dec>((acc, value) => acc.plus(D(value)), ZERO);
}

/** Weighted fuel rate: total amount ÷ total litres. Never an average of per-entry rates. */
export function weightedRate(amount: Prisma.Decimal | string | number | null, totalLitres: Prisma.Decimal | string | number | null): string | null {
  const rate = ratePerLitre(D(amount), D(totalLitres));
  return rate ? rate.toFixed(2) : null;
}

/** Percentage change from `previous` to `current`, one decimal. Null when there is no base to compare to. */
export function percentChange(current: Prisma.Decimal | string | number, previous: Prisma.Decimal | string | number): string | null {
  const base = D(previous);
  if (base.isZero()) return null;
  return D(current).minus(base).div(base.abs()).times(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toFixed(1);
}

/** Share of a total, one decimal; null when the total is zero. */
export function share(part: Prisma.Decimal | string | number, total: Prisma.Decimal | string | number): string | null {
  const whole = D(total);
  if (whole.isZero()) return null;
  return D(part).div(whole).times(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toFixed(1);
}

// ───────────────────────────── Trends ─────────────────────────────

/**
 * Spreads dated values into the range's buckets (days or months), summing each named field.
 * Every bucket is returned, so a day with no records reads as a real zero — the query that
 * covered it succeeded — and the chart has no gaps.
 */
export function fillTrend<K extends string>(
  range: Pick<ReportRange, 'from' | 'to' | 'granularity'>,
  rows: ({ date: Date } & Partial<Record<K, Prisma.Decimal | string | number | null>>)[],
  fields: readonly K[],
  format: (value: Dec, field: K) => string | number = (value) => value.toFixed(2),
): ({ bucket: string; from: string; to: string } & Record<K, string | number>)[] {
  const totals = new Map<string, Record<K, Dec>>();
  for (const bucket of bucketsFor(range)) {
    totals.set(bucket.key, Object.fromEntries(fields.map((field) => [field, ZERO])) as Record<K, Dec>);
  }
  for (const row of rows) {
    const slot = totals.get(bucketKey(row.date, range.granularity));
    if (!slot) continue; // outside the range: never counted
    for (const field of fields) slot[field] = slot[field].plus(D(row[field] ?? 0));
  }
  return bucketsFor(range).map((bucket) => {
    const slot = totals.get(bucket.key) as Record<K, Dec>;
    return {
      bucket: bucket.key,
      from: bucket.from.toISOString().slice(0, 10),
      to: bucket.to.toISOString().slice(0, 10),
      ...(Object.fromEntries(fields.map((field) => [field, format(slot[field], field)])) as Record<K, string | number>),
    };
  });
}

// ───────────────────────────── Payments ─────────────────────────────

/**
 * How payment statuses are reported. Each status is always shown on its own; the groups only
 * collect statuses that genuinely mean the same thing to management. "Paid" is PAID and nothing
 * else: a reversed payment is money that came back, and a payment awaiting a status check has
 * not been confirmed — neither is ever counted as paid.
 */
export const PAYMENT_GROUPS = {
  pending: [PaymentStatus.DRAFT, PaymentStatus.PENDING_APPROVAL, PaymentStatus.APPROVED],
  processing: [PaymentStatus.PROCESSING, PaymentStatus.STATUS_REVIEW_REQUIRED],
  paid: [PaymentStatus.PAID],
  failed: [PaymentStatus.FAILED],
  cancelled: [PaymentStatus.CANCELLED],
  reversed: [PaymentStatus.REVERSED],
} as const satisfies Record<string, readonly PaymentStatus[]>;
export type PaymentGroup = keyof typeof PAYMENT_GROUPS;

/** Payments that still need someone to act or a provider to answer. */
export const OPEN_PAYMENT_STATUSES: PaymentStatus[] = [...PAYMENT_GROUPS.pending, ...PAYMENT_GROUPS.processing];

export interface StatusTotal {
  count: number;
  amount: string;
}

export function paymentStatusTotals(rows: { status: PaymentStatus; count: number; amount: Prisma.Decimal | null }[]): {
  byStatus: Record<PaymentStatus, StatusTotal>;
  byGroup: Record<PaymentGroup, StatusTotal>;
} {
  const byStatus = Object.fromEntries(Object.values(PaymentStatus).map((status) => [status, { count: 0, amount: '0.00' }])) as Record<PaymentStatus, StatusTotal>;
  for (const row of rows) byStatus[row.status] = { count: row.count, amount: money(row.amount) };
  const byGroup = Object.fromEntries(
    (Object.keys(PAYMENT_GROUPS) as PaymentGroup[]).map((group) => {
      const statuses = PAYMENT_GROUPS[group] as readonly PaymentStatus[];
      return [group, { count: statuses.reduce((n, s) => n + byStatus[s].count, 0), amount: money(sum(statuses.map((s) => byStatus[s].amount))) }];
    }),
  ) as Record<PaymentGroup, StatusTotal>;
  return { byStatus, byGroup };
}

// ───────────────────────────── Compliance ─────────────────────────────

/** Expiry windows management can choose for "expiring soon". */
export const EXPIRY_WINDOWS = [7, 30, 60, 90] as const;
export type ExpiryWindow = (typeof EXPIRY_WINDOWS)[number];
export const DEFAULT_EXPIRY_WINDOW: ExpiryWindow = 30;

export type DocumentHealth = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'MISSING';

/**
 * A document's health for a chosen window. Valid through the end of its expiry date, expired
 * from the next day (the same rule as the compliance module). A document with no expiry date
 * (an RC, say) is valid. A required document that was never uploaded is MISSING — never EXPIRED.
 */
export function documentHealth(expiryDate: Date | null, today: Date, windowDays: number = DEFAULT_EXPIRY_WINDOW): { health: Exclude<DocumentHealth, 'MISSING'>; daysRemaining: number | null } {
  if (!expiryDate) return { health: 'VALID', daysRemaining: null };
  const days = daysUntil(expiryDate, today);
  if (days < 0) return { health: 'EXPIRED', daysRemaining: days };
  if (days <= windowDays) return { health: 'EXPIRING', daysRemaining: days };
  return { health: 'VALID', daysRemaining: days };
}

/** Which of the standard bands an expiry falls in: expired, ≤7, ≤30, ≤60, ≤90 days, or later. */
export function expiryBand(expiryDate: Date | null, today: Date): 'expired' | 'd7' | 'd30' | 'd60' | 'd90' | 'later' | 'none' {
  if (!expiryDate) return 'none';
  const days = daysUntil(expiryDate, today);
  if (days < 0) return 'expired';
  if (days <= 7) return 'd7';
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  if (days <= 90) return 'd90';
  return 'later';
}

// ───────────────────────────── Sorting ─────────────────────────────

/** Sorts rows in memory by a whitelisted numeric or text key; ties keep a stable label order. */
export function sortRows<T>(rows: T[], value: (row: T) => string | number | Dec | null, dir: 'asc' | 'desc', tiebreak: (row: T) => string): T[] {
  const factor = dir === 'asc' ? 1 : -1;
  const key = (row: T): number | string | null => {
    const v = value(row);
    if (v === null) return null;
    if (v instanceof Prisma.Decimal) return v.toNumber();
    return v;
  };
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null && kb !== null) return 1; // blanks last whichever way
    if (kb === null && ka !== null) return -1;
    if (ka !== null && kb !== null && ka !== kb) {
      return (typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb))) * factor;
    }
    return tiebreak(a).localeCompare(tiebreak(b));
  });
}
