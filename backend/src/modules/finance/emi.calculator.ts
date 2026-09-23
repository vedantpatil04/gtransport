/**
 * EMI maths for financed vehicles. Pure functions: no database, no Prisma, no I/O, so the
 * finance ledger phase can reuse them unchanged.
 *
 * Amounts are rupees rounded to paise at the boundary. Money is stored as Decimal in the
 * database; these helpers take and return plain numbers and round every result, so no
 * floating-point remainder ever reaches a stored column.
 */

export interface EmiInput {
  /** Amount actually borrowed (loan amount, i.e. price minus down payment). */
  principal: number;
  /** Nominal annual interest rate as a percentage, e.g. 9.5. */
  annualRatePct: number;
  /** Number of monthly instalments. */
  tenureMonths: number;
}

export interface EmiSchedule {
  emiAmount: number;
  totalPayable: number;
  totalInterest: number;
}

export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Standard reducing-balance EMI:
 *
 *   EMI = P · r · (1 + r)^n / ((1 + r)^n − 1),  r = annual rate / 12 / 100
 *
 * A zero rate degenerates to principal / tenure.
 */
export function calculateEmi({ principal, annualRatePct, tenureMonths }: EmiInput): EmiSchedule {
  if (!Number.isFinite(principal) || principal < 0) throw new RangeError('principal must be a non-negative number');
  if (!Number.isFinite(annualRatePct) || annualRatePct < 0) throw new RangeError('annualRatePct must be a non-negative number');
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) throw new RangeError('tenureMonths must be a positive whole number');

  const monthlyRate = annualRatePct / 12 / 100;
  const emiAmount =
    monthlyRate === 0
      ? principal / tenureMonths
      : (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) / (Math.pow(1 + monthlyRate, tenureMonths) - 1);

  // The lender bills the rounded instalment every month, so the total follows the rounded
  // figure rather than the exact one; otherwise the numbers shown would never quite add up.
  const rounded = round2(emiAmount);
  const totalPayable = round2(rounded * tenureMonths);
  return {
    emiAmount: rounded,
    totalPayable,
    totalInterest: round2(totalPayable - principal),
  };
}

/**
 * Outstanding principal after `paidInstallments` payments, on a reducing balance:
 *
 *   B(k) = P · ((1 + r)^n − (1 + r)^k) / ((1 + r)^n − 1)
 *
 * This is an estimate from the loan terms, not a reconciled ledger balance: prepayments,
 * missed payments and penalties are not modelled and arrive with the finance phase.
 */
export function outstandingPrincipal(input: EmiInput, paidInstallments: number): number {
  const { principal, annualRatePct, tenureMonths } = input;
  if (!Number.isInteger(paidInstallments) || paidInstallments < 0) throw new RangeError('paidInstallments must be a non-negative whole number');
  const paid = Math.min(paidInstallments, tenureMonths);

  const monthlyRate = annualRatePct / 12 / 100;
  if (monthlyRate === 0) return round2(principal * (1 - paid / tenureMonths));

  const growthFull = Math.pow(1 + monthlyRate, tenureMonths);
  const growthPaid = Math.pow(1 + monthlyRate, paid);
  return round2((principal * (growthFull - growthPaid)) / (growthFull - 1));
}
