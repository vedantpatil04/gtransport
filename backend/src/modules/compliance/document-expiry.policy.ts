import type { ExpiryThreshold } from '@prisma/client';

/**
 * The one place that decides whether a document is valid, expiring soon or expired.
 *
 * The database stores only the real expiry date; status is always derived from "today" (India
 * time, supplied by the caller), so a document never shows a stale state. The screens, the
 * compliance summary, the SQL filters and the notification feed all come from this module.
 */

export type ExpiryStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';

/** A required document with nothing uploaded. Deliberately distinct from EXPIRED. */
export type ComplianceStatus = ExpiryStatus | 'NOT_UPLOADED';

/** Warning thresholds in days before expiry, widest first. */
export const WARNING_THRESHOLDS = [30, 15, 7, 3, 1] as const;

/** "Expiring soon" means within the widest warning threshold. */
export const EXPIRING_SOON_DAYS = WARNING_THRESHOLDS[0];

export interface ExpiryAssessment {
  status: ExpiryStatus;
  /** Whole days until expiry: 0 on the expiry date, negative once expired, null if no expiry. */
  daysRemaining: number | null;
  /** The tightest threshold reached, e.g. DAYS_7 at 5 days left. Null while comfortably valid. */
  threshold: ExpiryThreshold | null;
}

const DAY_MS = 86_400_000;
const utcDay = (value: Date): number => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

/** Whole calendar days from `today` to `expiryDate`. */
export function daysUntil(expiryDate: Date, today: Date): number {
  return Math.round((utcDay(expiryDate) - utcDay(today)) / DAY_MS);
}

/**
 * A document is valid through the end of its expiry date and expired from the next day.
 * Thresholds: ≤30, ≤15, ≤7, ≤3 and ≤1 day(s) left; the expiry day itself counts as ≤1.
 */
export function assessExpiry(expiryDate: Date | null, today: Date): ExpiryAssessment {
  if (!expiryDate) return { status: 'VALID', daysRemaining: null, threshold: null };

  const days = daysUntil(expiryDate, today);
  if (days < 0) return { status: 'EXPIRED', daysRemaining: days, threshold: 'EXPIRED' };

  const reached = [...WARNING_THRESHOLDS].reverse().find((limit) => days <= limit);
  if (reached === undefined) return { status: 'VALID', daysRemaining: days, threshold: null };
  return { status: 'EXPIRING_SOON', daysRemaining: days, threshold: `DAYS_${reached}` as ExpiryThreshold };
}

const addDays = (date: Date, days: number): Date => new Date(utcDay(date) + days * DAY_MS);

/**
 * The expiry-date range that corresponds to a status, for database filtering. Using these
 * windows (instead of loading documents and assessing each) keeps compliance queries indexed
 * and fast however much history accumulates.
 */
export function expiryWindow(
  status: ExpiryStatus | 'WITHIN_7_DAYS',
  today: Date,
): { expiryDate: { lt?: Date; gte?: Date; lte?: Date; gt?: Date } | null } | { OR: ({ expiryDate: null } | { expiryDate: { gt: Date } })[] } {
  const start = addDays(today, 0);
  switch (status) {
    case 'EXPIRED':
      return { expiryDate: { lt: start } };
    case 'WITHIN_7_DAYS':
      return { expiryDate: { gte: start, lte: addDays(today, 7) } };
    case 'EXPIRING_SOON':
      return { expiryDate: { gte: start, lte: addDays(today, EXPIRING_SOON_DAYS) } };
    case 'VALID':
      return { OR: [{ expiryDate: null }, { expiryDate: { gt: addDays(today, EXPIRING_SOON_DAYS) } }] };
  }
}
