export type ExpiryState = 'valid' | 'expiring' | 'expired' | 'none';

/** 0 = fine, 1 = within 30 days, 2 = within 15, 3 = within 7, 4 = within 3, 5 = expired. */
export type ExpiryLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface ExpiryStatus {
  state: ExpiryState;
  level: ExpiryLevel;
  days: number | null;
}

export const REMINDER_BUCKETS = [3, 7, 15, 30] as const;

const startOfUtcDay = (value: Date): number => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

/** Whole days between two dates, ignoring time of day. */
export function daysUntil(expiryDate: Date, today: Date): number {
  return Math.round((startOfUtcDay(expiryDate) - startOfUtcDay(today)) / 86_400_000);
}

/**
 * Mirrors the thresholds the existing admin UI already uses (30/15/7/3 days), so the
 * backend and the prototype never disagree about whether a document is "expiring".
 */
export function documentExpiryStatus(expiryDate: Date | null, today: Date = new Date()): ExpiryStatus {
  if (!expiryDate) return { state: 'none', level: 0, days: null };

  const days = daysUntil(expiryDate, today);
  if (days < 0) return { state: 'expired', level: 5, days };
  if (days <= 3) return { state: 'expiring', level: 4, days };
  if (days <= 7) return { state: 'expiring', level: 3, days };
  if (days <= 15) return { state: 'expiring', level: 2, days };
  if (days <= 30) return { state: 'expiring', level: 1, days };
  return { state: 'valid', level: 0, days };
}
