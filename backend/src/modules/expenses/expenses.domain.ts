/** Expense categories, matching the existing driver "updates" screen. */
export const ExpenseCategory = {
  TOLL: 'TOLL',
  PARKING: 'PARKING',
  REPAIR: 'REPAIR',
  FOOD: 'FOOD',
  MAINTENANCE: 'MAINTENANCE',
  TRIP: 'TRIP',
  OTHER: 'OTHER',
} as const;
export type ExpenseCategory = (typeof ExpenseCategory)[keyof typeof ExpenseCategory];

export const ExpenseApprovalStatus = { SUBMITTED: 'SUBMITTED', APPROVED: 'APPROVED', REJECTED: 'REJECTED' } as const;
export type ExpenseApprovalStatus = (typeof ExpenseApprovalStatus)[keyof typeof ExpenseApprovalStatus];

export interface ExpenseDraft {
  clientEntryId: string;
  driverId: string;
  vehicleId: string;
  category: ExpenseCategory;
  amount: string;
  note?: string;
  spentOn: Date;
  receiptFileId?: string | null;
}
