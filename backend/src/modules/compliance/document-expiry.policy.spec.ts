import { assessExpiry, daysUntil, expiryWindow } from './document-expiry.policy';

const today = new Date('2026-09-19T00:00:00.000Z');
const inDays = (n: number) => new Date(today.getTime() + n * 86_400_000);

describe('document expiry', () => {
  it.each([
    [45, 'VALID', null],
    [31, 'VALID', null],
    [30, 'EXPIRING_SOON', 'DAYS_30'],
    [16, 'EXPIRING_SOON', 'DAYS_30'],
    [15, 'EXPIRING_SOON', 'DAYS_15'],
    [8, 'EXPIRING_SOON', 'DAYS_15'],
    [7, 'EXPIRING_SOON', 'DAYS_7'],
    [4, 'EXPIRING_SOON', 'DAYS_7'],
    [3, 'EXPIRING_SOON', 'DAYS_3'],
    [2, 'EXPIRING_SOON', 'DAYS_3'],
    [1, 'EXPIRING_SOON', 'DAYS_1'],
    // Valid through the expiry date itself…
    [0, 'EXPIRING_SOON', 'DAYS_1'],
    // …and expired from the day after.
    [-1, 'EXPIRED', 'EXPIRED'],
    [-400, 'EXPIRED', 'EXPIRED'],
  ])('%i days left → %s (%s)', (days, status, threshold) => {
    expect(assessExpiry(inDays(days), today)).toEqual({ status, daysRemaining: days, threshold });
  });

  it('treats a document without an expiry date as valid, not expired', () => {
    expect(assessExpiry(null, today)).toEqual({ status: 'VALID', daysRemaining: null, threshold: null });
  });

  it('counts calendar days, ignoring the time of day', () => {
    expect(daysUntil(new Date('2026-09-20T23:59:00.000Z'), new Date('2026-09-19T00:01:00.000Z'))).toBe(1);
  });

  it('gives database windows that agree with the assessment at every boundary', () => {
    const inWindow = (status: 'EXPIRED' | 'EXPIRING_SOON' | 'VALID', date: Date) => {
      const window = expiryWindow(status, today) as { expiryDate?: { lt?: Date; gte?: Date; lte?: Date }; OR?: unknown[] };
      if (window.OR) return date.getTime() > inDays(30).getTime();
      const range = window.expiryDate!;
      return (!range.lt || date < range.lt) && (!range.gte || date >= range.gte) && (!range.lte || date <= range.lte);
    };
    for (const days of [-1, 0, 1, 3, 7, 15, 30, 31]) {
      const date = inDays(days);
      const status = assessExpiry(date, today).status;
      expect(inWindow(status, date)).toBe(true);
    }
  });
});
