import type { LedgerRow } from './ledger.service';
import type { AdvanceRow, SalaryRow } from './payroll.service';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Money leaves the API as fixed two-decimal strings, never as floats. */
export function presentSalary(s: SalaryRow) {
  const payment = s.payments.find((p) => p.status !== 'CANCELLED') ?? s.payments[0] ?? null;
  return {
    id: s.id,
    employee: s.employee,
    payPeriod: day(s.payPeriod)!.slice(0, 7),
    baseSalary: s.baseSalary.toFixed(2),
    allowances: s.allowances.toFixed(2),
    advanceRecovery: s.advanceRecovery.toFixed(2),
    deductions: s.deductions.toFixed(2),
    netPayable: s.netPayable.toFixed(2),
    status: s.status,
    paidAt: iso(s.paidAt),
    notes: s.notes,
    cancelledAt: iso(s.cancelledAt),
    cancelReason: s.cancelReason,
    recoveredAdvances: s.recoveredAdvances.map((a) => ({ id: a.id, type: a.type, amount: a.amount.toFixed(2), advanceDate: day(a.advanceDate) })),
    payment,
    createdAt: iso(s.createdAt),
  };
}

export function presentAdvance(a: AdvanceRow) {
  return {
    id: a.id,
    employee: a.employee,
    type: a.type,
    amount: a.amount.toFixed(2),
    advanceDate: day(a.advanceDate),
    reason: a.reason,
    status: a.status,
    recovered: a.recoveredInSalaryId !== null,
    recoveredInSalaryId: a.recoveredInSalaryId,
    notes: a.notes,
    cancelledAt: iso(a.cancelledAt),
    cancelReason: a.cancelReason,
    payment: a.payments.find((p) => p.status !== 'CANCELLED') ?? a.payments[0] ?? null,
    createdAt: iso(a.createdAt),
  };
}

export interface LedgerParties {
  employees: Map<string, { id: string; fullName: string; employeeCode: string }>;
  vehicles: Map<string, { id: string; registrationNumber: string }>;
}

export function presentLedgerEntry(l: LedgerRow, parties: LedgerParties) {
  return {
    id: l.id,
    date: day(l.transactionDate),
    type: l.type,
    direction: l.direction,
    amount: l.amount.toFixed(2),
    description: l.description,
    sourceType: l.sourceType,
    sourceId: l.sourceId,
    /** A correcting line (negative) that cancels an earlier one. */
    isReversal: l.reversalOfId !== null,
    /** An original line that a later correction cancelled. */
    reversed: l.reversedBy !== null,
    payment: l.paymentRecord,
    employee: l.employeeId ? parties.employees.get(l.employeeId) ?? null : null,
    vehicle: l.vehicleId ? parties.vehicles.get(l.vehicleId) ?? null : null,
  };
}
