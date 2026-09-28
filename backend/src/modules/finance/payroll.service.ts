import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AdvanceStatus, AdvanceType, LedgerSourceType, PaymentStatus, Prisma, SalaryStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { toPage, type Page } from '../../common/pagination/pagination';
import { todayInIndia, toIsoDate } from '../../common/dates/financial-year';
import { pastOrTodayDate } from '../../common/dates/request-dates';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { LedgerService } from './ledger.service';

/** Money from a validated request number, via its string form so binary float error never enters. */
export const money = (value: number | undefined): Prisma.Decimal => new Prisma.Decimal(value === undefined ? 0 : String(value));

/**
 * Net payable for a salary. Advances paid earlier are RECOVERED (deducted); they are never
 * merged into the salary. The database enforces the same formula with a CHECK constraint.
 */
export function netPayable(parts: { baseSalary: Prisma.Decimal; allowances: Prisma.Decimal; advanceRecovery: Prisma.Decimal; deductions: Prisma.Decimal }): Prisma.Decimal {
  return parts.baseSalary.plus(parts.allowances).minus(parts.advanceRecovery).minus(parts.deductions);
}

export const SALARY_VIEW = {
  id: true,
  employeeId: true,
  payPeriod: true,
  baseSalary: true,
  allowances: true,
  advanceRecovery: true,
  deductions: true,
  netPayable: true,
  status: true,
  paidAt: true,
  notes: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  employee: { select: { id: true, fullName: true, employeeCode: true } },
  recoveredAdvances: { select: { id: true, amount: true, type: true, advanceDate: true } },
  payments: { select: { id: true, status: true, method: true }, orderBy: { createdAt: 'desc' as const } },
} as const;

export const ADVANCE_VIEW = {
  id: true,
  employeeId: true,
  type: true,
  amount: true,
  advanceDate: true,
  reason: true,
  status: true,
  recoveredInSalaryId: true,
  notes: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  employee: { select: { id: true, fullName: true, employeeCode: true } },
  payments: { select: { id: true, status: true, method: true }, orderBy: { createdAt: 'desc' as const } },
} as const;

export type SalaryRow = Prisma.SalaryRecordGetPayload<{ select: typeof SALARY_VIEW }>;
export type AdvanceRow = Prisma.AdvanceGetPayload<{ select: typeof ADVANCE_VIEW }>;

const ACTIVE_PAYMENT = { notIn: [PaymentStatus.CANCELLED, PaymentStatus.REVERSED, PaymentStatus.FAILED] };

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  // ───────────────────────────── Salaries ─────────────────────────────

  async createSalary(
    user: AuthenticatedUser,
    input: { employeeId: string; payPeriod: string; baseSalary: number; allowances?: number; deductions?: number; recoverAdvanceIds?: string[]; notes?: string },
  ): Promise<SalaryRow> {
    const employee = await this.employee(user.companyId, input.employeeId);
    const payPeriod = parsePeriod(input.payPeriod);
    const recoverIds = [...new Set(input.recoverAdvanceIds ?? [])];

    try {
      const salary = await this.prisma.$transaction(async (tx) => {
        // Only advances already paid to this employee, and not yet recovered, can be recovered.
        const advances = recoverIds.length
          ? await tx.advance.findMany({ where: { id: { in: recoverIds }, companyId: user.companyId, employeeId: employee.id } })
          : [];
        if (advances.length !== recoverIds.length) throw new BadRequestException('One of the advances does not belong to this employee.');
        for (const advance of advances) {
          if (advance.status !== AdvanceStatus.PAID) throw new BadRequestException('Only advances that have been paid can be recovered.');
          if (advance.recoveredInSalaryId) throw new BadRequestException('One of the advances has already been recovered.');
        }

        const parts = {
          baseSalary: money(input.baseSalary),
          allowances: money(input.allowances),
          advanceRecovery: advances.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0)),
          deductions: money(input.deductions),
        };
        const net = netPayable(parts);
        if (net.isNegative()) throw new BadRequestException('Recoveries and deductions exceed the salary; net payable cannot be negative.');

        const created = await tx.salaryRecord.create({
          data: { companyId: user.companyId, employeeId: employee.id, payPeriod, ...parts, netPayable: net, notes: input.notes?.trim() || null, createdById: user.id, updatedById: user.id },
          select: { id: true },
        });
        if (advances.length) {
          // Conditional, so two salaries racing for the same advance cannot both recover it.
          const claimed = await tx.advance.updateMany({ where: { id: { in: recoverIds }, recoveredInSalaryId: null }, data: { recoveredInSalaryId: created.id } });
          if (claimed.count !== advances.length) throw new ConflictException('One of the advances was just recovered elsewhere.');
        }
        await this.ledger.syncSource(
          tx,
          { companyId: user.companyId, sourceType: LedgerSourceType.SALARY, sourceId: created.id, actorId: user.id },
          { transactionDate: salaryDate(payPeriod), type: 'SALARY', direction: 'EXPENSE', amount: net, description: `Salary ${input.payPeriod}`, employeeId: employee.id, driverId: employee.driver?.id ?? null },
        );
        return tx.salaryRecord.findUniqueOrThrow({ where: { id: created.id }, select: SALARY_VIEW });
      });

      await this.record(user, 'salary.created', 'SalaryRecord', salary.id, {
        employeeId: employee.id, payPeriod: input.payPeriod, baseSalary: salary.baseSalary.toFixed(2), allowances: salary.allowances.toFixed(2),
        advanceRecovery: salary.advanceRecovery.toFixed(2), deductions: salary.deductions.toFixed(2), netPayable: salary.netPayable.toFixed(2),
      });
      return salary;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A salary already exists for this employee and month.');
      throw error;
    }
  }

  /** Cancels an unpaid salary: releases its recovered advances and reverses its ledger line. */
  async cancelSalary(user: AuthenticatedUser, id: string, reason: string): Promise<SalaryRow> {
    const salary = await this.findSalary(user.companyId, id);
    if (salary.status !== SalaryStatus.PENDING) throw new BadRequestException(`A ${salary.status.toLowerCase()} salary cannot be cancelled.`);
    const active = await this.prisma.paymentRecord.count({ where: { salaryRecordId: id, status: ACTIVE_PAYMENT } });
    if (active) throw new ConflictException('Cancel the payment for this salary first.');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.advance.updateMany({ where: { recoveredInSalaryId: id }, data: { recoveredInSalaryId: null } });
      await tx.salaryRecord.update({ where: { id }, data: { status: SalaryStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason.trim(), updatedById: user.id } });
      await this.ledger.syncSource(tx, { companyId: user.companyId, sourceType: LedgerSourceType.SALARY, sourceId: id, actorId: user.id }, null);
      return tx.salaryRecord.findUniqueOrThrow({ where: { id }, select: SALARY_VIEW });
    });
    await this.record(user, 'salary.cancelled', 'SalaryRecord', id, { reason: reason.trim() });
    return updated;
  }

  async listSalaries(companyId: string, query: { payPeriod?: string; employeeId?: string; status?: SalaryStatus; q?: string; limit: number; cursor?: string }): Promise<Page<SalaryRow>> {
    const q = query.q?.trim();
    const rows = await this.prisma.salaryRecord.findMany({
      where: {
        companyId,
        ...(query.payPeriod ? { payPeriod: parsePeriod(query.payPeriod) } : {}),
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(q ? { employee: { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { employeeCode: { contains: q, mode: 'insensitive' } }] } } : {}),
      },
      select: SALARY_VIEW,
      orderBy: [{ payPeriod: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, query.limit);
  }

  async findSalary(companyId: string, id: string): Promise<SalaryRow> {
    const salary = await this.prisma.salaryRecord.findFirst({ where: { id, companyId }, select: SALARY_VIEW });
    if (!salary) throw new NotFoundException('Salary not found.');
    return salary;
  }

  // ───────────────────────────── Advances ─────────────────────────────

  async createAdvance(
    user: AuthenticatedUser,
    input: { employeeId: string; type: AdvanceType; amount: number; advanceDate: string; reason?: string; notes?: string },
  ): Promise<AdvanceRow> {
    const employee = await this.employee(user.companyId, input.employeeId);
    const advanceDate = pastOrTodayDate(input.advanceDate);
    const amount = money(input.amount);

    const advance = await this.prisma.$transaction(async (tx) => {
      const created = await tx.advance.create({
        data: { companyId: user.companyId, employeeId: employee.id, type: input.type, amount, advanceDate, reason: input.reason?.trim() || null, notes: input.notes?.trim() || null, createdById: user.id, updatedById: user.id },
        select: { id: true },
      });
      await this.ledger.syncSource(
        tx,
        { companyId: user.companyId, sourceType: LedgerSourceType.ADVANCE, sourceId: created.id, actorId: user.id },
        { transactionDate: advanceDate, type: 'ADVANCE', direction: 'EXPENSE', amount, description: input.reason?.trim() || null, employeeId: employee.id, driverId: employee.driver?.id ?? null },
      );
      return tx.advance.findUniqueOrThrow({ where: { id: created.id }, select: ADVANCE_VIEW });
    });
    await this.record(user, 'advance.created', 'Advance', advance.id, { employeeId: employee.id, type: input.type, amount: amount.toFixed(2), advanceDate: toIsoDate(advanceDate) });
    return advance;
  }

  async cancelAdvance(user: AuthenticatedUser, id: string, reason: string): Promise<AdvanceRow> {
    const advance = await this.findAdvance(user.companyId, id);
    if (advance.status !== AdvanceStatus.PENDING) throw new BadRequestException(`A ${advance.status.toLowerCase()} advance cannot be cancelled.`);
    const active = await this.prisma.paymentRecord.count({ where: { advanceId: id, status: ACTIVE_PAYMENT } });
    if (active) throw new ConflictException('Cancel the payment for this advance first.');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.advance.update({ where: { id }, data: { status: AdvanceStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason.trim(), updatedById: user.id } });
      await this.ledger.syncSource(tx, { companyId: user.companyId, sourceType: LedgerSourceType.ADVANCE, sourceId: id, actorId: user.id }, null);
      return tx.advance.findUniqueOrThrow({ where: { id }, select: ADVANCE_VIEW });
    });
    await this.record(user, 'advance.cancelled', 'Advance', id, { reason: reason.trim() });
    return updated;
  }

  async listAdvances(companyId: string, query: { employeeId?: string; status?: AdvanceStatus; type?: AdvanceType; recoverable?: boolean; limit: number; cursor?: string }): Promise<Page<AdvanceRow>> {
    const rows = await this.prisma.advance.findMany({
      where: {
        companyId,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.recoverable ? { status: AdvanceStatus.PAID, recoveredInSalaryId: null } : {}),
      },
      select: ADVANCE_VIEW,
      orderBy: [{ advanceDate: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, query.limit);
  }

  async findAdvance(companyId: string, id: string): Promise<AdvanceRow> {
    const advance = await this.prisma.advance.findFirst({ where: { id, companyId }, select: ADVANCE_VIEW });
    if (!advance) throw new NotFoundException('Advance not found.');
    return advance;
  }

  /** Salaries & Advances header figures for one month. */
  async monthSummary(companyId: string, period?: string) {
    const start = period ? parsePeriod(period) : parsePeriod(toIsoDate(todayInIndia()).slice(0, 7));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const [salaries, advances, unpaidAdvances] = await Promise.all([
      this.prisma.salaryRecord.aggregate({ where: { companyId, payPeriod: start, status: { not: SalaryStatus.CANCELLED } }, _sum: { netPayable: true }, _count: true }),
      this.prisma.advance.aggregate({ where: { companyId, advanceDate: { gte: start, lte: end }, status: { not: AdvanceStatus.CANCELLED } }, _sum: { amount: true }, _count: true }),
      this.prisma.advance.aggregate({ where: { companyId, status: AdvanceStatus.PENDING }, _sum: { amount: true }, _count: true }),
    ]);
    const z = new Prisma.Decimal(0);
    return {
      period: toIsoDate(start).slice(0, 7),
      salaries: { count: salaries._count, amount: (salaries._sum.netPayable ?? z).toFixed(2) },
      advances: { count: advances._count, amount: (advances._sum.amount ?? z).toFixed(2) },
      unpaidAdvances: { count: unpaidAdvances._count, amount: (unpaidAdvances._sum.amount ?? z).toFixed(2) },
    };
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  private async employee(companyId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id, companyId, deletedAt: null }, select: { id: true, driver: { select: { id: true } } } });
    if (!employee) throw new NotFoundException('Employee not found.');
    return employee;
  }

  private async record(user: AuthenticatedUser, action: string, entityType: string, entityId: string, changes: Record<string, unknown>) {
    await this.audit.record({ action, entityType, entityId, companyId: user.companyId, actorUserId: user.id, actorRole: user.role, changes: changes as Prisma.InputJsonValue });
  }
}

/** "2026-09" → 1 September 2026 (UTC date). */
export function parsePeriod(value: string): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) throw new BadRequestException('The pay period must look like 2026-09.');
  return new Date(Date.UTC(Number(match[1]), month - 1, 1));
}

/** A salary is dated at the end of its month — or today, for the current month. */
function salaryDate(period: Date): Date {
  const monthEnd = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0));
  const today = todayInIndia();
  return monthEnd > today ? today : monthEnd;
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return true;
  // Raised by the one-salary-per-month trigger.
  return error instanceof Error && /salary already exists/.test(error.message);
}
