import { Prisma } from '@prisma/client';

/**
 * Fuel arithmetic, done in Decimal so rupees and litres never pick up floating-point error.
 *
 * The rate is always derived from amount and litres — never stored — so the displayed rate
 * can never disagree with the figures it comes from.
 */

type Numeric = Prisma.Decimal | string | number;
const D = (value: Numeric): Prisma.Decimal => new Prisma.Decimal(value);

/** ₹ per litre for one fill-up, rounded to paise. Null when litres is not positive. */
export function ratePerLitre(amount: Numeric, litres: Numeric): Prisma.Decimal | null {
  const l = D(litres);
  if (l.lte(0)) return null;
  return D(amount).div(l).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export interface FuelTotals {
  entries: number;
  amount: Prisma.Decimal;
  litres: Prisma.Decimal;
  /** Weighted average: total amount ÷ total litres. Null when nothing was bought. */
  averageRate: Prisma.Decimal | null;
}

/**
 * Totals with the correct average.
 *
 * The average rate is total amount divided by total litres. Averaging each day's rate instead
 * would weight a 5-litre top-up the same as an 80-litre fill and give the wrong answer.
 */
export function fuelTotals(rows: { amount: Numeric; litres: Numeric }[]): FuelTotals {
  let amount = D(0);
  let litres = D(0);
  for (const row of rows) {
    amount = amount.plus(D(row.amount));
    litres = litres.plus(D(row.litres));
  }
  return { entries: rows.length, amount, litres, averageRate: ratePerLitre(amount, litres) };
}

/** Builds totals from database aggregates without loading every row. */
export function totalsFromAggregate(aggregate: {
  _count: number;
  _sum: { amount: Prisma.Decimal | null; litres: Prisma.Decimal | null };
}): FuelTotals {
  const amount = aggregate._sum.amount ?? D(0);
  const litres = aggregate._sum.litres ?? D(0);
  return { entries: aggregate._count, amount, litres, averageRate: ratePerLitre(amount, litres) };
}
