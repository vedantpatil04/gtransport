import { PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { canViewReport, REPORT_TYPES, reportsFor, reportVisibility } from './report-access';
import { documentHealth, expiryBand, fillTrend, paymentStatusTotals, percentChange, share, sortRows, weightedRate } from './report-maths';
import { resolveSort } from './report-context';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const dec = (v: string) => new Prisma.Decimal(v);

describe('weighted fuel rate', () => {
  it('is total amount ÷ total litres, not the average of per-entry rates', () => {
    // 80 L at ₹100 and 5 L at ₹120: per-entry average would be ₹110; the true rate is ₹101.18.
    expect(weightedRate('8600.00', '85.000')).toBe('101.18');
    expect(weightedRate(dec('8000'), dec('80'))).toBe('100.00');
  });

  it('is null when nothing was bought, never zero or infinity', () => {
    expect(weightedRate('0', '0')).toBeNull();
    expect(weightedRate(null, null)).toBeNull();
  });
});

describe('percentages', () => {
  it('reports change against the previous figure', () => {
    expect(percentChange('1500', '1000')).toBe('50.0');
    expect(percentChange('750', '1000')).toBe('-25.0');
  });

  it('has no percentage when there is nothing to compare against', () => {
    expect(percentChange('500', '0')).toBeNull();
    expect(share('10', '0')).toBeNull();
    expect(share('25', '100')).toBe('25.0');
  });
});

describe('trend buckets', () => {
  it('sums rows into their bucket and returns every bucket, empty ones as real zeros', () => {
    const trend = fillTrend(
      { from: d('2026-10-01'), to: d('2026-10-03'), granularity: 'day' },
      [
        { date: d('2026-10-01'), amount: dec('100.50') },
        { date: d('2026-10-01'), amount: dec('49.50') },
        { date: d('2026-10-03'), amount: '10' },
        { date: d('2026-11-01'), amount: '999' }, // outside the range: ignored
      ],
      ['amount'] as const,
    );
    expect(trend.map((b) => [b.bucket, b.amount])).toEqual([
      ['2026-10-01', '150.00'],
      ['2026-10-02', '0.00'],
      ['2026-10-03', '10.00'],
    ]);
  });

  it('groups by month for long ranges', () => {
    const trend = fillTrend({ from: d('2026-04-01'), to: d('2026-06-30'), granularity: 'month' }, [{ date: d('2026-05-31'), n: 2 }, { date: d('2026-05-01'), n: 3 }], ['n'] as const, (v) => v.toNumber());
    expect(trend.map((b) => [b.bucket, b.n])).toEqual([['2026-04', 0], ['2026-05', 5], ['2026-06', 0]]);
  });
});

describe('payment status totals', () => {
  const totals = paymentStatusTotals([
    { status: PaymentStatus.PAID, count: 2, amount: dec('5000') },
    { status: PaymentStatus.REVERSED, count: 1, amount: dec('1000') },
    { status: PaymentStatus.STATUS_REVIEW_REQUIRED, count: 1, amount: dec('700') },
    { status: PaymentStatus.PENDING_APPROVAL, count: 3, amount: dec('300') },
    { status: PaymentStatus.FAILED, count: 1, amount: dec('50') },
  ]);

  it('counts only PAID as paid — never reversed or unconfirmed payments', () => {
    expect(totals.byGroup.paid).toEqual({ count: 2, amount: '5000.00' });
    expect(totals.byGroup.reversed).toEqual({ count: 1, amount: '1000.00' });
  });

  it('keeps a payment awaiting a status check under processing, not paid or failed', () => {
    expect(totals.byGroup.processing).toEqual({ count: 1, amount: '700.00' });
    expect(totals.byGroup.failed).toEqual({ count: 1, amount: '50.00' });
  });

  it('reports every individual status, including those with nothing', () => {
    expect(totals.byStatus.PENDING_APPROVAL).toEqual({ count: 3, amount: '300.00' });
    expect(totals.byStatus.CANCELLED).toEqual({ count: 0, amount: '0.00' });
  });
});

describe('document health', () => {
  const today = d('2026-10-05');

  it('is valid through the expiry date and expired from the next day', () => {
    expect(documentHealth(d('2026-10-05'), today).health).toBe('EXPIRING');
    expect(documentHealth(d('2026-10-04'), today)).toEqual({ health: 'EXPIRED', daysRemaining: -1 });
  });

  it('uses the chosen expiry window', () => {
    expect(documentHealth(d('2026-11-20'), today, 30).health).toBe('VALID');
    expect(documentHealth(d('2026-11-20'), today, 60).health).toBe('EXPIRING');
    expect(documentHealth(d('2026-10-12'), today, 7).health).toBe('EXPIRING');
  });

  it('treats a document with no expiry (an RC) as valid', () => {
    expect(documentHealth(null, today)).toEqual({ health: 'VALID', daysRemaining: null });
  });

  it('places expiries in the standard bands', () => {
    expect(expiryBand(d('2026-10-01'), today)).toBe('expired');
    expect(expiryBand(d('2026-10-12'), today)).toBe('d7');
    expect(expiryBand(d('2026-11-04'), today)).toBe('d30');
    expect(expiryBand(d('2026-12-04'), today)).toBe('d60');
    expect(expiryBand(d('2027-01-03'), today)).toBe('d90');
    expect(expiryBand(d('2027-06-01'), today)).toBe('later');
    expect(expiryBand(null, today)).toBe('none');
  });
});

describe('sorting', () => {
  it('only accepts whitelisted sort keys', () => {
    expect(resolveSort(undefined, undefined, ['date', 'amount'] as const, { field: 'date', dir: 'desc' })).toEqual({ field: 'date', dir: 'desc' });
    expect(resolveSort('amount', 'asc', ['date', 'amount'] as const, { field: 'date', dir: 'desc' })).toEqual({ field: 'amount', dir: 'asc' });
    expect(() => resolveSort('passwordHash', 'asc', ['date', 'amount'] as const, { field: 'date', dir: 'desc' })).toThrow(/Cannot sort by/);
  });

  it('sorts numbers numerically, puts blanks last and breaks ties stably', () => {
    const rows = [{ k: 'b', v: 10 }, { k: 'a', v: 10 }, { k: 'c', v: null }, { k: 'd', v: 2 }];
    expect(sortRows(rows, (r) => r.v, 'desc', (r) => r.k).map((r) => r.k)).toEqual(['a', 'b', 'd', 'c']);
    expect(sortRows(rows, (r) => r.v, 'asc', (r) => r.k).map((r) => r.k)).toEqual(['d', 'a', 'b', 'c']);
  });
});

describe('report access policy', () => {
  it('gives SUPER_ADMIN and ADMIN every report', () => {
    expect(reportsFor(UserRole.SUPER_ADMIN)).toEqual([...REPORT_TYPES]);
    expect(reportsFor(UserRole.ADMIN)).toEqual([...REPORT_TYPES]);
  });

  it('keeps finance away from managers, and fleet/compliance away from accounting', () => {
    expect(canViewReport(UserRole.MANAGER, 'finance')).toBe(false);
    expect(canViewReport(UserRole.MANAGER, 'location')).toBe(true);
    expect(canViewReport(UserRole.ACCOUNTING, 'finance')).toBe(true);
    expect(canViewReport(UserRole.ACCOUNTING, 'location')).toBe(false);
    expect(canViewReport(UserRole.ACCOUNTING, 'compliance')).toBe(false);
    expect(canViewReport(UserRole.ACCOUNTING, 'expenses')).toBe(true);
  });

  it('gives drivers no admin reporting at all', () => {
    expect(reportsFor(UserRole.DRIVER)).toEqual([]);
  });

  it('hides payroll detail inside shared reports from managers', () => {
    expect(reportVisibility(UserRole.MANAGER)).toEqual({ payments: false, compliance: true, location: true });
    expect(reportVisibility(UserRole.ACCOUNTING)).toEqual({ payments: true, compliance: false, location: false });
  });
});
