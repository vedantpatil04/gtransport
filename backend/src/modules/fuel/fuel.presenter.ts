import { toIsoDate } from '../../common/dates/financial-year';
import { ratePerLitre, type FuelTotals } from './fuel.maths';
import type { FuelRow, PeriodSummary } from './fuel.service';

export interface FuelEntryView {
  id: string;
  fuelType: string;
  amount: string;
  litres: string;
  /** Derived from amount ÷ litres on every read; never stored. */
  ratePerLitre: string | null;
  fuelStation: string;
  transactionDate: string;
  receiptFileId: string | null;
  status: string;
  notes: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  clientSubmissionId: string | null;
  createdAt: string;
  updatedAt: string;
  driver: { id: string; driverCode: string; fullName: string };
  vehicle: { id: string; registrationNumber: string };
}

export function presentFuelEntry(entry: FuelRow): FuelEntryView {
  return {
    id: entry.id,
    fuelType: entry.fuelType,
    amount: entry.amount.toFixed(2),
    litres: entry.litres.toFixed(3),
    ratePerLitre: ratePerLitre(entry.amount, entry.litres)?.toFixed(2) ?? null,
    fuelStation: entry.fuelStation,
    transactionDate: toIsoDate(entry.transactionDate),
    receiptFileId: entry.receiptFileId,
    status: entry.status,
    notes: entry.notes,
    archivedAt: entry.archivedAt?.toISOString() ?? null,
    archiveReason: entry.archiveReason,
    clientSubmissionId: entry.clientSubmissionId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    driver: { id: entry.driver.id, driverCode: entry.driver.driverCode, fullName: entry.driver.employee.fullName },
    vehicle: { id: entry.vehicle.id, registrationNumber: entry.vehicle.registrationNumber },
  };
}

export interface TotalsView {
  entries: number;
  amount: string;
  litres: string;
  /** Weighted: total amount ÷ total litres. */
  averageRate: string | null;
}

export function presentTotals(totals: FuelTotals): TotalsView {
  return {
    entries: totals.entries,
    amount: totals.amount.toFixed(2),
    litres: totals.litres.toFixed(3),
    averageRate: totals.averageRate?.toFixed(2) ?? null,
  };
}

export function presentPeriod(period: PeriodSummary) {
  return {
    from: period.from,
    to: period.to,
    ...presentTotals(period),
    byFuelType: Object.fromEntries(
      Object.entries(period.byFuelType).map(([type, value]) => [
        type,
        { amount: value.amount.toFixed(2), litres: value.litres.toFixed(3), entries: value.entries },
      ]),
    ),
  };
}
