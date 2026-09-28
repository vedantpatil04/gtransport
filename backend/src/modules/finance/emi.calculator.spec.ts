import { calculateEmi, instalmentDueDates, outstandingPrincipal } from './emi.calculator';

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('EMI calculator (Decimal)', () => {
  it('matches the standard reducing-balance EMI', () => {
    // ₹5,20,000 at 11.25% over 48 months.
    const { emiAmount, totalPayable, totalInterest } = calculateEmi({ principal: '520000', annualRatePct: '11.25', tenureMonths: 48 });
    expect(emiAmount.toFixed(2)).toBe('13502.89');
    expect(totalPayable.toFixed(2)).toBe('648138.72');
    expect(totalInterest.toFixed(2)).toBe('128138.72');
  });

  it('makes the figures add up exactly: total = EMI × months, interest = total − principal', () => {
    const r = calculateEmi({ principal: '1450000', annualRatePct: '9.75', tenureMonths: 60 });
    expect(r.totalPayable.equals(r.emiAmount.mul(60))).toBe(true);
    expect(r.totalInterest.equals(r.totalPayable.minus(1450000))).toBe(true);
  });

  it('handles a zero interest rate', () => {
    const r = calculateEmi({ principal: 120000, annualRatePct: 0, tenureMonths: 12 });
    expect(r.emiAmount.toFixed(2)).toBe('10000.00');
    expect(r.totalInterest.toFixed(2)).toBe('0.00');
  });

  it('is exact where floating point is not', () => {
    // 0.1 + 0.2 style error must not appear in money.
    const r = calculateEmi({ principal: '0.30', annualRatePct: 0, tenureMonths: 3 });
    expect(r.emiAmount.toFixed(2)).toBe('0.10');
  });

  it('copes with very large values without losing precision', () => {
    const r = calculateEmi({ principal: '999999999999.99', annualRatePct: '24', tenureMonths: 600 });
    expect(r.emiAmount.isFinite()).toBe(true);
    expect(r.emiAmount.greaterThan(0)).toBe(true);
  });

  it.each([
    [{ principal: -1, annualRatePct: 10, tenureMonths: 12 }, /loan amount/],
    [{ principal: '1e13', annualRatePct: 10, tenureMonths: 12 }, /too large/],
    [{ principal: 100, annualRatePct: -1, tenureMonths: 12 }, /interest rate/],
    [{ principal: 100, annualRatePct: 101, tenureMonths: 12 }, /interest rate/],
    [{ principal: 100, annualRatePct: 10, tenureMonths: 0 }, /tenure/],
    [{ principal: 100, annualRatePct: 10, tenureMonths: 12.5 }, /tenure/],
    [{ principal: 'abc', annualRatePct: 10, tenureMonths: 12 }, /./],
  ])('rejects invalid input %#', (input, message) => {
    expect(() => calculateEmi(input as never)).toThrow(message);
  });

  it('reduces the outstanding principal to zero by the last instalment', () => {
    const loan = { principal: '520000', annualRatePct: '11.25', tenureMonths: 48 };
    expect(outstandingPrincipal(loan, 0).toFixed(2)).toBe('520000.00');
    expect(outstandingPrincipal(loan, 48).toFixed(2)).toBe('0.00');
    expect(outstandingPrincipal(loan, 18).lessThan(outstandingPrincipal(loan, 17))).toBe(true);
  });

  it('schedules monthly due dates, clamping to month end', () => {
    expect(instalmentDueDates(new Date('2026-01-31T00:00:00Z'), 3).map(iso)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(instalmentDueDates(new Date('2027-12-05T00:00:00Z'), 2).map(iso)).toEqual(['2027-12-05', '2028-01-05']);
  });
});
