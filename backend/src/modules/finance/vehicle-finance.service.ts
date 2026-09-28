import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FinanceStatus, InstallmentStatus, LedgerSourceType, VehicleOwnership } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { toIsoDate } from '../../common/dates/financial-year';
import { pastOrTodayDate } from '../../common/dates/request-dates';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { calculateEmi, instalmentDueDates, outstandingPrincipal } from './emi.calculator';
import { LedgerService } from './ledger.service';

const INSTALMENT_VIEW = { id: true, installmentNumber: true, dueDate: true, amount: true, status: true, paidAt: true, paymentReference: true } as const;

/**
 * EMI instalments for financed vehicles. The schedule comes from the loan terms; paying an
 * instalment posts an EMI line to the ledger and updates what is still owed. Instalments are
 * kept when the loan closes, so the history of a paid-off vehicle is never lost.
 */
@Injectable()
export class VehicleFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  async list(companyId: string, vehicleId: string) {
    const financing = await this.financing(companyId, vehicleId, false);
    const rows = await this.prisma.vehicleFinanceInstallment.findMany({ where: { financingId: financing.id }, select: INSTALMENT_VIEW, orderBy: { installmentNumber: 'asc' } });
    return rows.map((r) => ({ ...r, dueDate: toIsoDate(r.dueDate), paidAt: r.paidAt ? toIsoDate(r.paidAt) : null, amount: r.amount.toFixed(2) }));
  }

  /** Creates the schedule once, from the loan terms. Refuses owned vehicles and missing terms. */
  async generate(user: AuthenticatedUser, vehicleId: string) {
    const financing = await this.financing(user.companyId, vehicleId, true);
    if (await this.prisma.vehicleFinanceInstallment.count({ where: { financingId: financing.id } })) {
      throw new ConflictException('The instalment schedule already exists.');
    }
    const first = financing.nextDueDate ?? financing.financeStartDate;
    if (!financing.loanAmount || financing.interestRatePct === null || !financing.tenureMonths || !first) {
      throw new BadRequestException('Add the loan amount, interest rate, tenure and first due date before creating the schedule.');
    }
    const terms = { principal: financing.loanAmount, annualRatePct: financing.interestRatePct, tenureMonths: financing.tenureMonths };
    const emi = financing.emiAmount ?? calculateEmi(terms).emiAmount;
    const dates = instalmentDueDates(first, financing.tenureMonths);

    await this.prisma.vehicleFinanceInstallment.createMany({
      data: dates.map((dueDate, i) => ({ financingId: financing.id, installmentNumber: i + 1, dueDate, amount: emi, createdById: user.id, updatedById: user.id })),
    });
    await this.audit.record({ action: 'finance.schedule_generated', entityType: 'VehicleFinancing', entityId: financing.id, companyId: user.companyId, actorUserId: user.id, actorRole: user.role, changes: { instalments: dates.length, emi: emi.toFixed(2) } });
    return this.list(user.companyId, vehicleId);
  }

  async markPaid(user: AuthenticatedUser, vehicleId: string, installmentNumber: number, input: { paidOn: string; reference?: string }) {
    const financing = await this.financing(user.companyId, vehicleId, true);
    const paidOn = pastOrTodayDate(input.paidOn);
    const vehicle = await this.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, select: { registrationNumber: true } });

    const result = await this.prisma.$transaction(async (tx) => {
      // Conditional: paying the same instalment twice (double click, two tabs) records it once.
      const updated = await tx.vehicleFinanceInstallment.updateMany({
        where: { financingId: financing.id, installmentNumber, status: InstallmentStatus.PENDING },
        data: { status: InstallmentStatus.PAID, paidAt: paidOn, paymentReference: input.reference?.trim() || null, updatedById: user.id },
      });
      if (updated.count === 0) throw new ConflictException('That instalment does not exist or is already paid.');
      const instalment = await tx.vehicleFinanceInstallment.findUniqueOrThrow({ where: { financingId_installmentNumber: { financingId: financing.id, installmentNumber } } });

      await this.ledger.syncSource(
        tx,
        { companyId: user.companyId, sourceType: LedgerSourceType.FINANCE_INSTALLMENT, sourceId: instalment.id, actorId: user.id },
        { transactionDate: paidOn, type: 'EMI', direction: 'EXPENSE', amount: instalment.amount, description: `EMI ${installmentNumber} · ${financing.lenderName ?? ''}`.trim(), vehicleId },
      );

      const paidCount = await tx.vehicleFinanceInstallment.count({ where: { financingId: financing.id, status: InstallmentStatus.PAID } });
      const next = await tx.vehicleFinanceInstallment.findFirst({ where: { financingId: financing.id, status: InstallmentStatus.PENDING }, orderBy: { installmentNumber: 'asc' } });
      const outstanding =
        financing.loanAmount && financing.interestRatePct !== null && financing.tenureMonths
          ? outstandingPrincipal({ principal: financing.loanAmount, annualRatePct: financing.interestRatePct, tenureMonths: financing.tenureMonths }, paidCount)
          : null;
      await tx.vehicleFinancing.update({
        where: { id: financing.id },
        data: {
          paidInstallments: paidCount,
          nextDueDate: next?.dueDate ?? null,
          ...(outstanding ? { outstandingAmount: outstanding } : {}),
          ...(next ? {} : { status: FinanceStatus.COMPLETED }),
          updatedById: user.id,
        },
      });
      return { instalment, paidCount, completed: !next };
    });

    await this.audit.record({
      action: 'finance.instalment_paid',
      entityType: 'VehicleFinancing',
      entityId: financing.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { vehicle: vehicle.registrationNumber, installmentNumber, amount: result.instalment.amount.toFixed(2), paidOn: toIsoDate(paidOn), loanCompleted: result.completed },
    });
    return { installmentNumber, paidInstallments: result.paidCount, loanCompleted: result.completed };
  }

  private async financing(companyId: string, vehicleId: string, forChange: boolean) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, companyId, deletedAt: null }, select: { ownership: true, financing: true } });
    if (!vehicle) throw new NotFoundException('Vehicle not found.');
    if (!vehicle.financing) throw new BadRequestException('This vehicle has no financing record.');
    // A fully owned vehicle has no EMI to manage; its closed loan stays readable as history.
    if (forChange && vehicle.ownership !== VehicleOwnership.FINANCED) throw new BadRequestException('This vehicle is fully owned; there is no EMI to manage.');
    return vehicle.financing;
  }
}

