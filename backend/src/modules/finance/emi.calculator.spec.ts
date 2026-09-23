import { calculateEmi, outstandingPrincipal, round2 } from './emi.calculator';

describe('calculateEmi', () => {
  it('matches the standard reducing-balance EMI for a typical commercial vehicle loan', () => {
    // ₹5,20,000 at 11.25% over 48 months. Cross-checked against the closed-form formula.
    const { emiAmount, totalPayable, totalInterest } = calculateEmi({ principal: 520_000, annualRatePct: 11.25, tenureMonths: 48 });

    expect(emiAmount).toBeCloseTo(13502.89, 1);
    expect(totalPayable).toBeCloseTo(emiAmount * 48, 1);
    expect(totalInterest).toBeCloseTo(totalPayable - 520_000, 1);
  });

  it('spreads the principal evenly when the rate is zero', () => {
    expect(calculateEmi({ principal: 120_000, annualRatePct: 0, tenureMonths: 12 })).toEqual({
      emiAmount: 10_000,
      totalPayable: 120_000,
      totalInterest: 0,
    });
  });

  it('always costs more than the principal when interest is charged', () => {
    const { totalInterest } = calculateEmi({ principal: 1_450_000, annualRatePct: 9.75, tenureMonths: 60 });
    expect(totalInterest).toBeGreaterThan(0);
  });

  it('rounds every figure to paise so nothing fractional reaches a stored column', () => {
    const result = calculateEmi({ principal: 333_333, annualRatePct: 7.77, tenureMonths: 17 });
    for (const value of Object.values(result)) {
      expect(value).toBe(round2(value));
    }
  });

  it('rejects inputs that cannot describe a loan', () => {
    expect(() => calculateEmi({ principal: -1, annualRatePct: 10, tenureMonths: 12 })).toThrow(RangeError);
    expect(() => calculateEmi({ principal: 100, annualRatePct: -0.5, tenureMonths: 12 })).toThrow(RangeError);
    expect(() => calculateEmi({ principal: 100, annualRatePct: 10, tenureMonths: 0 })).toThrow(RangeError);
    expect(() => calculateEmi({ principal: 100, annualRatePct: 10, tenureMonths: 12.5 })).toThrow(RangeError);
  });
});

describe('outstandingPrincipal', () => {
  const loan = { principal: 520_000, annualRatePct: 11.25, tenureMonths: 48 };

  it('is the full principal before any instalment is paid', () => {
    expect(outstandingPrincipal(loan, 0)).toBeCloseTo(520_000, 0);
  });

  it('is zero once every instalment is paid', () => {
    expect(outstandingPrincipal(loan, 48)).toBeCloseTo(0, 2);
  });

  it('never goes negative when more instalments are recorded than the tenure', () => {
    expect(outstandingPrincipal(loan, 60)).toBeCloseTo(0, 2);
  });

  it('falls monotonically as instalments are paid', () => {
    const balances = [0, 6, 12, 24, 36, 47].map((paid) => outstandingPrincipal(loan, paid));
    for (let i = 1; i < balances.length; i += 1) {
      expect(balances[i]).toBeLessThan(balances[i - 1] as number);
    }
  });

  it('repays a zero-rate loan in equal steps', () => {
    expect(outstandingPrincipal({ principal: 120_000, annualRatePct: 0, tenureMonths: 12 }, 3)).toBe(90_000);
  });

  it('rejects a negative instalment count', () => {
    expect(() => outstandingPrincipal(loan, -1)).toThrow(RangeError);
  });
});
