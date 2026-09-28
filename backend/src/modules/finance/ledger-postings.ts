import { LedgerDirection, LedgerEntryType, OperationCategory, RecordStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { DesiredPosting } from './ledger.service';

/**
 * How each source record appears in the ledger — or, by returning null, that it should not
 * (archived, cancelled, zero). One mapping per source keeps the ledger a faithful reference
 * rather than a second copy of the data.
 */

export function fuelPosting(entry: {
  status: RecordStatus;
  amount: Prisma.Decimal;
  transactionDate: Date;
  fuelStation: string;
  driver: { id: string };
  vehicle: { id: string };
}): DesiredPosting | null {
  if (entry.status !== RecordStatus.ACTIVE) return null;
  return {
    transactionDate: entry.transactionDate,
    type: LedgerEntryType.FUEL,
    direction: LedgerDirection.EXPENSE,
    amount: entry.amount,
    description: entry.fuelStation,
    driverId: entry.driver.id,
    vehicleId: entry.vehicle.id,
  };
}

const CATEGORY_TYPE: Record<OperationCategory, LedgerEntryType> = {
  RTO: LedgerEntryType.RTO,
  TYRE: LedgerEntryType.TYRE,
  MAINTENANCE: LedgerEntryType.MAINTENANCE,
};

export function expensePosting(record: {
  status: RecordStatus;
  category: OperationCategory;
  amount: Prisma.Decimal;
  expenseDate: Date;
  vendorName: string | null;
  description: string | null;
  vehicle: { id: string };
  driver: { id: string } | null;
}): DesiredPosting | null {
  if (record.status !== RecordStatus.ACTIVE) return null;
  return {
    transactionDate: record.expenseDate,
    type: CATEGORY_TYPE[record.category],
    direction: LedgerDirection.EXPENSE,
    amount: record.amount,
    description: record.vendorName ?? record.description,
    driverId: record.driver?.id ?? null,
    vehicleId: record.vehicle.id,
  };
}

/** A tyre-insurance premium is an expense; the policy document itself is the source. */
export function premiumPosting(document: {
  amount: Prisma.Decimal | null;
  issueDate: Date | null;
  createdAt: Date;
  issuer: string | null;
  vehicleId: string | null;
  archived: boolean;
}): DesiredPosting | null {
  if (document.archived || !document.amount || document.amount.lte(0)) return null;
  return {
    transactionDate: document.issueDate ?? new Date(document.createdAt.toISOString().slice(0, 10) + 'T00:00:00.000Z'),
    type: LedgerEntryType.TYRE_INSURANCE,
    direction: LedgerDirection.EXPENSE,
    amount: document.amount,
    description: document.issuer,
    vehicleId: document.vehicleId,
  };
}
