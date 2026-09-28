import {
  financialYear, financialYearOf, monthStart, parseBusinessDate, parseFinancialYear, todayInIndia, toIsoDate,
} from './financial-year';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('financial year', () => {
  it('runs from 1 April to 31 March', () => {
    const fy = financialYear(2026);
    expect(toIsoDate(fy.start)).toBe('2026-04-01');
    expect(toIsoDate(fy.end)).toBe('2027-03-31');
    expect(fy.label).toBe('FY 2026–27');
    expect(fy.code).toBe('2026-27');
  });

  it('places the boundary days in the right year', () => {
    expect(financialYearOf(d('2026-03-31')).code).toBe('2025-26');
    expect(financialYearOf(d('2026-04-01')).code).toBe('2026-27');
    expect(financialYearOf(d('2027-03-31')).code).toBe('2026-27');
    expect(financialYearOf(d('2027-04-01')).code).toBe('2027-28');
  });

  it('treats January to March as the tail of the previous financial year', () => {
    expect(financialYearOf(d('2027-01-15')).code).toBe('2026-27');
    expect(financialYearOf(d('2027-02-28')).code).toBe('2026-27');
  });

  it('handles the century rollover in the label', () => {
    expect(financialYear(2099).label).toBe('FY 2099–00');
  });

  it('parses year codes and rejects mismatched pairs', () => {
    expect(parseFinancialYear('2026-27').startYear).toBe(2026);
    expect(parseFinancialYear('2027').startYear).toBe(2027);
    expect(() => parseFinancialYear('2026-29')).toThrow(/2026-27/);
    expect(() => parseFinancialYear('last year')).toThrow(RangeError);
  });

  it('includes a leap day in the right year', () => {
    // 29 Feb 2028 belongs to FY 2027–28.
    expect(financialYearOf(d('2028-02-29')).code).toBe('2027-28');
  });
});

describe('business dates', () => {
  it('parses a valid calendar date', () => {
    expect(toIsoDate(parseBusinessDate('2026-09-19'))).toBe('2026-09-19');
  });

  it('rejects impossible dates rather than rolling them over', () => {
    expect(() => parseBusinessDate('2026-02-31')).toThrow(RangeError);
    expect(() => parseBusinessDate('2026-13-01')).toThrow(RangeError);
    expect(() => parseBusinessDate('19 September 2026')).toThrow(RangeError);
  });

  it("uses India's date, not the server's", () => {
    // 20:00 UTC on 31 March is already 1 April in India.
    expect(toIsoDate(todayInIndia(new Date('2026-03-31T20:00:00.000Z')))).toBe('2026-04-01');
    expect(toIsoDate(todayInIndia(new Date('2026-03-31T10:00:00.000Z')))).toBe('2026-03-31');
  });

  it('finds the start of the month', () => {
    expect(toIsoDate(monthStart(d('2026-09-19')))).toBe('2026-09-01');
  });
});
