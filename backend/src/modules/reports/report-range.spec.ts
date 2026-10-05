import { toIsoDate } from '../../common/dates/financial-year';
import {
  bucketsFor, financialYearOverYear, instantWindow, istDay, monthOverMonth, quarterStart, resolveReportRange, ReportRangeError, weekStart,
} from './report-range';

/** A moment in India: "2026-10-05 10:00 IST" → the UTC instant. */
const ist = (isoLocal: string) => new Date(new Date(`${isoLocal}Z`).getTime() - 330 * 60_000);
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const span = (input: Parameters<typeof resolveReportRange>[0], now: Date) => {
  const r = resolveReportRange(input, now);
  return [toIsoDate(r.from), toIsoDate(r.to)];
};

describe('report range — financial year', () => {
  const now = ist('2026-10-05T10:00:00');

  it('defaults to the current financial year to date (1 April → today)', () => {
    const r = resolveReportRange({}, now);
    expect(r.preset).toBe('this_fy');
    expect([toIsoDate(r.from), toIsoDate(r.to)]).toEqual(['2026-04-01', '2026-10-05']);
    expect(r.financialYears.map((fy) => fy.label)).toEqual(['FY 2026–27']);
  });

  it('never uses January–December as the financial year', () => {
    expect(span({ preset: 'this_fy' }, ist('2027-02-10T09:00:00'))).toEqual(['2026-04-01', '2027-02-10']);
    expect(span({ preset: 'previous_fy' }, ist('2027-02-10T09:00:00'))).toEqual(['2025-04-01', '2026-03-31']);
  });

  it('resolves a past financial year in full, 1 April to 31 March', () => {
    expect(span({ fy: '2025-26' }, now)).toEqual(['2025-04-01', '2026-03-31']);
    expect(span({ preset: 'fy', fy: '2025-26' }, now)).toEqual(['2025-04-01', '2026-03-31']);
  });

  it('ends the current financial year today rather than charting future months', () => {
    expect(span({ fy: '2026-27' }, now)).toEqual(['2026-04-01', '2026-10-05']);
  });

  it('switches financial year exactly at midnight IST on 1 April', () => {
    // 23:59 IST on 31 March is still the old year; 00:00 IST on 1 April is the new one.
    expect(span({ preset: 'this_fy' }, ist('2027-03-31T23:59:00'))).toEqual(['2026-04-01', '2027-03-31']);
    expect(span({ preset: 'this_fy' }, ist('2027-04-01T00:00:00'))).toEqual(['2027-04-01', '2027-04-01']);
  });

  it('refuses a financial year that has not started, or a mismatched code', () => {
    expect(() => resolveReportRange({ fy: '2027-28' }, now)).toThrow(/has not started/);
    expect(() => resolveReportRange({ fy: '2026-28' }, now)).toThrow(ReportRangeError);
    expect(() => resolveReportRange({ fy: '1990-91' }, now)).toThrow(/earlier than any business record/);
  });

  it('lists every financial year a custom range touches', () => {
    const r = resolveReportRange({ from: '2026-02-01', to: '2026-05-31' }, now);
    expect(r.financialYears.map((fy) => fy.code)).toEqual(['2025-26', '2026-27']);
  });
});

describe('report range — presets', () => {
  // Monday 5 October 2026, mid-morning in India.
  const now = ist('2026-10-05T10:00:00');

  it.each([
    ['today', ['2026-10-05', '2026-10-05']],
    ['yesterday', ['2026-10-04', '2026-10-04']],
    ['this_week', ['2026-10-05', '2026-10-05']],
    ['this_month', ['2026-10-01', '2026-10-05']],
    ['previous_month', ['2026-09-01', '2026-09-30']],
    ['this_quarter', ['2026-10-01', '2026-10-05']],
  ])('%s', (preset, expected) => {
    expect(span({ preset }, now)).toEqual(expected);
  });

  it('starts the week on Monday', () => {
    expect(toIsoDate(weekStart(d('2026-10-11')))).toBe('2026-10-05'); // Sunday → Monday before
    expect(toIsoDate(weekStart(d('2026-10-07')))).toBe('2026-10-05');
  });

  it('uses financial quarters (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar)', () => {
    expect(toIsoDate(quarterStart(d('2026-05-20')))).toBe('2026-04-01');
    expect(toIsoDate(quarterStart(d('2027-02-28')))).toBe('2027-01-01');
  });

  it('handles the previous month across a year boundary and in a leap year', () => {
    expect(span({ preset: 'previous_month' }, ist('2027-01-15T12:00:00'))).toEqual(['2026-12-01', '2026-12-31']);
    expect(span({ preset: 'previous_month' }, ist('2028-03-10T12:00:00'))).toEqual(['2028-02-01', '2028-02-29']);
  });

  it('uses India’s date, not the server’s, around midnight', () => {
    // 20:00 UTC on 4 Oct is already 01:30 on 5 Oct in India.
    expect(span({ preset: 'today' }, new Date('2026-10-04T20:00:00.000Z'))).toEqual(['2026-10-05', '2026-10-05']);
    expect(span({ preset: 'today' }, new Date('2026-10-04T18:00:00.000Z'))).toEqual(['2026-10-04', '2026-10-04']);
  });
});

describe('report range — validation', () => {
  const now = ist('2026-10-05T10:00:00');

  it('accepts a custom range and keeps both ends inclusive', () => {
    const r = resolveReportRange({ from: '2026-09-01', to: '2026-09-30' }, now);
    expect(r.preset).toBe('custom');
    expect(r.days).toBe(30);
    expect(r.granularity).toBe('day');
  });

  it('switches to monthly buckets beyond about two months', () => {
    expect(resolveReportRange({ from: '2026-01-01', to: '2026-06-30' }, now).granularity).toBe('month');
  });

  it.each([
    [{ from: '2026-09-30', to: '2026-09-01' }, /on or before/],
    [{ from: '2026-02-30', to: '2026-03-01' }, /not a valid date/],
    [{ preset: 'custom', from: '2026-01-01' }, /both "from" and "to"/],
    [{ from: '2020-01-01', to: '2026-01-01' }, /three years or less/],
    [{ from: '1999-01-01', to: '1999-02-01' }, /not supported/],
    [{ preset: 'this_month', from: '2026-01-01', to: '2026-01-31' }, /only to a custom range/],
    [{ preset: 'this_month', fy: '2025-26' }, /only to a financial-year period/],
    [{ preset: 'fortnight' }, /Unknown period/],
    [{ preset: 'fy' }, /Choose a financial year/],
  ])('rejects %p', (input, message) => {
    expect(() => resolveReportRange(input, now)).toThrow(message);
  });
});

describe('time-zone windows and buckets', () => {
  it('turns IST days into the UTC instants they cover', () => {
    const w = instantWindow({ from: d('2026-10-01'), to: d('2026-10-01') });
    expect(w.gte.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(w.lt.toISOString()).toBe('2026-10-01T18:30:00.000Z');
  });

  it('places an instant on its India calendar day', () => {
    expect(toIsoDate(istDay(new Date('2026-09-30T18:29:59.000Z')))).toBe('2026-09-30');
    expect(toIsoDate(istDay(new Date('2026-09-30T18:30:00.000Z')))).toBe('2026-10-01');
  });

  it('clips partial months to the range and includes empty buckets', () => {
    const buckets = bucketsFor({ from: d('2026-03-15'), to: d('2026-05-10'), granularity: 'month' });
    expect(buckets.map((b) => [b.key, toIsoDate(b.from), toIsoDate(b.to)])).toEqual([
      ['2026-03', '2026-03-15', '2026-03-31'],
      ['2026-04', '2026-04-01', '2026-04-30'],
      ['2026-05', '2026-05-01', '2026-05-10'],
    ]);
    expect(bucketsFor({ from: d('2026-10-01'), to: d('2026-10-05'), granularity: 'day' })).toHaveLength(5);
  });
});

describe('comparisons', () => {
  it('compares month to date with the same days of the previous month', () => {
    const c = monthOverMonth(ist('2026-10-05T10:00:00'));
    expect([toIsoDate(c.current.from), toIsoDate(c.current.to)]).toEqual(['2026-10-01', '2026-10-05']);
    expect([toIsoDate(c.previous.from), toIsoDate(c.previous.to)]).toEqual(['2026-09-01', '2026-09-05']);
  });

  it('clips the previous month when it is shorter (31 March vs February)', () => {
    const c = monthOverMonth(ist('2027-03-31T10:00:00'));
    expect(toIsoDate(c.previous.to)).toBe('2027-02-28');
  });

  it('compares financial year to date with the same span of the previous year', () => {
    const c = financialYearOverYear(ist('2026-10-05T10:00:00'));
    expect([toIsoDate(c.current.from), toIsoDate(c.current.to)]).toEqual(['2026-04-01', '2026-10-05']);
    expect([toIsoDate(c.previous.from), toIsoDate(c.previous.to)]).toEqual(['2025-04-01', '2025-10-05']);
  });

  it('maps 29 February to 28 February in a non-leap previous year', () => {
    const c = financialYearOverYear(ist('2028-02-29T10:00:00'));
    expect(toIsoDate(c.previous.to)).toBe('2027-02-28');
  });
});
