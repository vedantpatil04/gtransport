/**
 * Finance vocabulary for the ledger phase.
 *
 * Salary and Advance are distinct transaction types and must stay distinct: an advance is
 * money handed over before it is earned and is later recovered, whereas salary is an earned
 * obligation. Recording an advance as salary would silently overstate payroll cost.
 */
export const FinancialTransactionType = {
  SALARY: 'SALARY',
  ADVANCE: 'ADVANCE',
  ADVANCE_RECOVERY: 'ADVANCE_RECOVERY',
  REIMBURSEMENT: 'REIMBURSEMENT',
  EXPENSE: 'EXPENSE',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;
export type FinancialTransactionType = (typeof FinancialTransactionType)[keyof typeof FinancialTransactionType];

/** Why an advance was given. Maps to the prototype's fuel_advance / trip_allowance / other_advance. */
export const AdvancePurpose = {
  FUEL: 'FUEL',
  TRIP_ALLOWANCE: 'TRIP_ALLOWANCE',
  OTHER: 'OTHER',
} as const;
export type AdvancePurpose = (typeof AdvancePurpose)[keyof typeof AdvancePurpose];

export const LedgerDirection = { DEBIT: 'DEBIT', CREDIT: 'CREDIT' } as const;
export type LedgerDirection = (typeof LedgerDirection)[keyof typeof LedgerDirection];

/**
 * A single ledger movement. Amounts are minor-unit-safe decimal strings, never floats.
 * The ledger is append-only: corrections are ADJUSTMENT entries, not edits.
 */
export interface LedgerEntryDraft {
  companyId: string;
  employeeId: string;
  type: FinancialTransactionType;
  purpose?: AdvancePurpose;
  direction: LedgerDirection;
  amount: string;
  occurredOn: Date;
  reference?: string;
  note?: string;
}
