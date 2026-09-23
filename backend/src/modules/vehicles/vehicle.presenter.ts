import { VehicleOwnership } from '@prisma/client';
import { calculateEmi, outstandingPrincipal, round2 } from '../finance/emi.calculator';
import type { VehicleRow } from './vehicles.service';

export interface FinancingView {
  status: string;
  lenderName: string | null;
  loanAccountNumber: string | null;
  loanAmount: string | null;
  downPayment: string | null;
  financeStartDate: string | null;
  tenureMonths: number | null;
  interestRatePct: string | null;
  emiAmount: string | null;
  totalInstallments: number | null;
  paidInstallments: number | null;
  remainingInstallments: number | null;
  outstandingAmount: string | null;
  nextDueDate: string | null;
  /** Derived from the loan terms; absent when the terms are incomplete. */
  calculated: { emiAmount: number; totalPayable: number; totalInterest: number; outstandingPrincipal: number } | null;
}

export interface VehicleView {
  id: string;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  kind: string;
  fuelType: string;
  capacityTonnes: string | null;
  manufactureYear: number | null;
  mileageKmpl: string | null;
  status: string;
  ownership: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  currentAssignment: {
    id: string;
    startedAt: string;
    driver: { id: string; driverCode: string; status: string; fullName: string; phone: string | null };
  } | null;
  /** Null for OWNED vehicles: a fully owned vehicle has no EMI to show. */
  financing: FinancingView | null;
}

const isoDate = (value: Date | null): string | null => (value ? value.toISOString().slice(0, 10) : null);

export function presentVehicle(vehicle: VehicleRow): VehicleView {
  return {
    id: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    make: vehicle.make,
    model: vehicle.model,
    variant: vehicle.variant,
    kind: vehicle.kind,
    fuelType: vehicle.fuelType,
    capacityTonnes: vehicle.capacityTonnes?.toFixed(2) ?? null,
    manufactureYear: vehicle.manufactureYear,
    mileageKmpl: vehicle.mileageKmpl?.toFixed(2) ?? null,
    status: vehicle.status,
    ownership: vehicle.ownership,
    notes: vehicle.notes,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
    currentAssignment: vehicle.currentAssignment
      ? {
          id: vehicle.currentAssignment.id,
          startedAt: vehicle.currentAssignment.startedAt.toISOString(),
          driver: {
            id: vehicle.currentAssignment.driver.id,
            driverCode: vehicle.currentAssignment.driver.driverCode,
            status: vehicle.currentAssignment.driver.status,
            fullName: vehicle.currentAssignment.driver.employee.fullName,
            phone: vehicle.currentAssignment.driver.employee.phone,
          },
        }
      : null,
    financing: presentFinancing(vehicle),
  };
}

/**
 * Financing is reported only for FINANCED vehicles. An owned vehicle returns null even if a
 * historical financing row still exists, so no EMI card can appear for a fully owned vehicle.
 */
function presentFinancing(vehicle: VehicleRow): FinancingView | null {
  if (vehicle.ownership !== VehicleOwnership.FINANCED || !vehicle.financing) return null;
  const f = vehicle.financing;

  const principal = f.loanAmount ? Number(f.loanAmount) : null;
  const rate = f.interestRatePct !== null ? Number(f.interestRatePct) : null;
  const tenure = f.tenureMonths;
  const paid = f.paidInstallments ?? 0;

  const calculated =
    principal !== null && rate !== null && tenure !== null && tenure > 0
      ? {
          ...calculateEmi({ principal, annualRatePct: rate, tenureMonths: tenure }),
          outstandingPrincipal: outstandingPrincipal({ principal, annualRatePct: rate, tenureMonths: tenure }, paid),
        }
      : null;

  const totalInstallments = f.totalInstallments ?? tenure;

  return {
    status: f.status,
    lenderName: f.lenderName,
    loanAccountNumber: f.loanAccountNumber,
    loanAmount: f.loanAmount?.toFixed(2) ?? null,
    downPayment: f.downPayment?.toFixed(2) ?? null,
    financeStartDate: isoDate(f.financeStartDate),
    tenureMonths: tenure,
    interestRatePct: f.interestRatePct?.toFixed(2) ?? null,
    // Falls back to the derived EMI when no figure was recorded from the loan agreement.
    emiAmount: f.emiAmount?.toFixed(2) ?? (calculated ? round2(calculated.emiAmount).toFixed(2) : null),
    totalInstallments,
    paidInstallments: f.paidInstallments,
    remainingInstallments: totalInstallments !== null ? Math.max(0, totalInstallments - paid) : null,
    outstandingAmount: f.outstandingAmount?.toFixed(2) ?? (calculated ? calculated.outstandingPrincipal.toFixed(2) : null),
    nextDueDate: isoDate(f.nextDueDate),
    calculated,
  };
}
