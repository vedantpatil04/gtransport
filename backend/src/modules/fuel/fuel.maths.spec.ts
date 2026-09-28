import { fuelTotals, ratePerLitre } from './fuel.maths';

describe('fuel rate', () => {
  it('derives the rate from amount and litres', () => {
    expect(ratePerLitre(2450, 25)?.toString()).toBe('98');
  });

  it('rounds to paise', () => {
    expect(ratePerLitre(1000, 3)?.toFixed(2)).toBe('333.33');
  });

  it('refuses to divide by zero or negative litres', () => {
    expect(ratePerLitre(1000, 0)).toBeNull();
    expect(ratePerLitre(1000, -5)).toBeNull();
  });

  it('keeps decimal precision that floating point would lose', () => {
    // 0.1 + 0.2 style errors must not reach money.
    const totals = fuelTotals([
      { amount: '0.10', litres: '0.001' },
      { amount: '0.20', litres: '0.002' },
    ]);
    expect(totals.amount.toString()).toBe('0.3');
  });
});

describe('fuel totals', () => {
  it('uses the weighted average (total amount ÷ total litres), not the mean of daily rates', () => {
    // A small top-up at a high rate and a large fill at a low rate.
    const rows = [
      { amount: 1100, litres: 10 }, // ₹110/L
      { amount: 8000, litres: 100 }, // ₹80/L
    ];
    const totals = fuelTotals(rows);

    expect(totals.amount.toString()).toBe('9100');
    expect(totals.litres.toString()).toBe('110');
    // Correct: 9100 / 110 = 82.73
    expect(totals.averageRate?.toFixed(2)).toBe('82.73');
    // The naive mean of the two rates would be 95.00 — badly wrong.
    expect(totals.averageRate?.toFixed(2)).not.toBe('95.00');
  });

  it('matches the example from the brief', () => {
    expect(fuelTotals([{ amount: 2450, litres: 25 }]).averageRate?.toString()).toBe('98');
  });

  it('has no average when nothing was bought', () => {
    expect(fuelTotals([])).toMatchObject({ entries: 0, averageRate: null });
  });
});
