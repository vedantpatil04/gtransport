import { Prisma } from '@prisma/client';

/**
 * EMI maths for financed vehicles, in Decimal throughout.
 *
 * The reducing-balance formula needs (1 + r)^n. Doing that in JavaScript floating point would
 * put binary rounding error into money, so every step here uses a high-precision Decimal and
 * rounds to paise only at the end. Results are Prisma.Decimal, ready to store as-is.
 */

/** 40 significant digits: comfortably exact for (1 + r)^600 at any realistic rate. */
const D = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
type Numeric = Prisma.Decimal | string | number;

const MAX_PRINCIPAL = new D('1000000000000'); // ₹1 lakh crore: far beyond any vehicle loan
const MAX_TENURE_MONTHS = 600;

export interface EmiInput {
  /** Amount borrowed (the financed principal). */
  principal: Numeric;
  /** Nominal annual interest rate in percent, e.g. 9.5. */
  annualRatePct: Numeric;
  /** Number of monthly instalments. */
  tenureMonths: number;
}

export interface EmiSchedule {
  emiAmount: Prisma.Decimal;
  totalPayable: Prisma.Decimal;
  totalInterest: Prisma.Decimal;
}

const toPaise = (value: InstanceType<typeof D>) => new Prisma.Decimal(value.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2));

function validate({ principal, annualRatePct, tenureMonths }: EmiInput) {
  const p = new D(principal);
  const rate = new D(annualRatePct);
  if (!p.isFinite() || p.isNegative()) throw new RangeError('The loan amount must be zero or more.');
  if (p.greaterThan(MAX_PRINCIPAL)) throw new RangeError('The loan amount is too large.');
  if (!rate.isFinite() || rate.isNegative() || rate.greaterThan(100)) throw new RangeError('The interest rate must be between 0 and 100%.');
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0 || tenureMonths > MAX_TENURE_MONTHS) {
    throw new RangeError(`The tenure must be a whole number of months between 1 and ${MAX_TENURE_MONTHS}.`);
  }
  return { p, monthlyRate: rate.div(1200) };
}

/**
 * Standard reducing-balance EMI:  EMI = P · r · (1 + r)^n / ((1 + r)^n − 1),  r = annual % / 1200.
 * A zero rate degenerates to P / n. The lender bills the rounded EMI every month, so the total
 * payable is that rounded EMI × n — the figures shown always add up.
 */
export function calculateEmi(input: EmiInput): EmiSchedule {
  const { p, monthlyRate } = validate(input);
  const n = input.tenureMonths;

  const emi = monthlyRate.isZero()
    ? p.div(n)
    : p.mul(monthlyRate).mul(monthlyRate.plus(1).pow(n)).div(monthlyRate.plus(1).pow(n).minus(1));

  const emiAmount = toPaise(emi);
  const totalPayable = emiAmount.mul(n);
  return { emiAmount, totalPayable, totalInterest: totalPayable.minus(toPaise(p)) };
}

/**
 * Principal still owed after `paidInstallments` payments:  B(k) = P · ((1+r)^n − (1+r)^k) / ((1+r)^n − 1).
 * An estimate from the loan terms, not a reconciled lender balance.
 */
export function outstandingPrincipal(input: EmiInput, paidInstallments: number): Prisma.Decimal {
  const { p, monthlyRate } = validate(input);
  if (!Number.isInteger(paidInstallments) || paidInstallments < 0) throw new RangeError('Paid instalments must be zero or more.');
  const n = input.tenureMonths;
  const k = Math.min(paidInstallments, n);

  if (monthlyRate.isZero()) return toPaise(p.mul(n - k).div(n));
  const growthN = monthlyRate.plus(1).pow(n);
  return toPaise(p.mul(growthN.minus(monthlyRate.plus(1).pow(k))).div(growthN.minus(1)));
}

/** Monthly due dates from the first instalment date, clamped to month end (31 Jan → 28/29 Feb). */
export function instalmentDueDates(firstDueDate: Date, count: number): Date[] {
  const day = firstDueDate.getUTCDate();
  return Array.from({ length: count }, (_, i) => {
    const year = firstDueDate.getUTCFullYear();
    const month = firstDueDate.getUTCMonth() + i;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
  });
}
