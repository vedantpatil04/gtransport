import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FinanceStatus, Prisma, VehicleOwnership, VehicleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { keysetArgs, toPage, type Page } from '../../common/pagination/pagination';
import { AssignmentsService, END_REASON } from '../assignments/assignments.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { CreateVehicleDto, ListVehiclesQuery, SetVehicleStatusDto, UpdateVehicleDto, UpsertFinancingDto } from './dto/vehicle.dto';

const VEHICLE_VIEW = {
  id: true,
  registrationNumber: true,
  make: true,
  model: true,
  variant: true,
  kind: true,
  fuelType: true,
  capacityTonnes: true,
  manufactureYear: true,
  mileageKmpl: true,
  status: true,
  ownership: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  currentAssignment: {
    select: {
      id: true,
      startedAt: true,
      driver: { select: { id: true, driverCode: true, status: true, employee: { select: { fullName: true, phone: true } } } },
    },
  },
  financing: true,
} as const;

export type VehicleRow = Prisma.VehicleGetPayload<{ select: typeof VEHICLE_VIEW }>;

const toDate = (value?: string | null): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00.000Z`);

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assignments: AssignmentsService,
  ) {}

  async list(companyId: string, query: ListVehiclesQuery): Promise<Page<VehicleRow>> {
    const q = query.q?.trim();
    const where: Prisma.VehicleWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.fuelType ? { fuelType: query.fuelType } : {}),
      ...(query.ownership ? { ownership: query.ownership } : {}),
      ...(query.financeStatus ? { financing: { status: query.financeStatus } } : {}),
      ...(query.driverId ? { currentAssignment: { driverId: query.driverId } } : {}),
      ...(query.assigned === undefined
        ? {}
        : query.assigned === 1
          ? { NOT: { currentAssignmentId: null } }
          : { currentAssignmentId: null }),
      ...(q
        ? {
            OR: [
              { registrationNumber: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { make: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { model: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { currentAssignment: { driver: { employee: { fullName: { contains: q, mode: Prisma.QueryMode.insensitive } } } } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.vehicle.findMany({ where, select: VEHICLE_VIEW, ...keysetArgs(query) });
    return toPage(rows, query.limit);
  }

  async findById(companyId: string, id: string): Promise<VehicleRow> {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id, companyId, deletedAt: null }, select: VEHICLE_VIEW });
    if (!vehicle) throw new NotFoundException('Vehicle not found.');
    return vehicle;
  }

  async create(user: AuthenticatedUser, dto: CreateVehicleDto): Promise<VehicleRow> {
    const registrationNumber = VehiclesService.normaliseRegistration(dto.registrationNumber);
    await this.assertRegistrationAvailable(user.companyId, registrationNumber);

    const vehicle = await this.prisma.vehicle.create({
      data: {
        companyId: user.companyId,
        registrationNumber,
        kind: dto.kind,
        fuelType: dto.fuelType,
        make: dto.make?.trim() || null,
        model: dto.model?.trim() || null,
        variant: dto.variant?.trim() || null,
        manufactureYear: dto.manufactureYear ?? null,
        capacityTonnes: dto.capacityTonnes ?? null,
        mileageKmpl: dto.mileageKmpl ?? null,
        status: dto.status ?? VehicleStatus.ACTIVE,
        ownership: dto.ownership ?? VehicleOwnership.OWNED,
        notes: dto.notes?.trim() || null,
        createdById: user.id,
        updatedById: user.id,
      },
      select: { id: true },
    });

    await this.audit.record({
      action: 'vehicle.created',
      entityType: 'Vehicle',
      entityId: vehicle.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { registrationNumber, kind: dto.kind, ownership: dto.ownership ?? VehicleOwnership.OWNED },
    });
    return this.findById(user.companyId, vehicle.id);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateVehicleDto): Promise<VehicleRow> {
    const existing = await this.findById(user.companyId, id);
    const registrationNumber = dto.registrationNumber ? VehiclesService.normaliseRegistration(dto.registrationNumber) : undefined;
    if (registrationNumber && registrationNumber !== existing.registrationNumber) {
      await this.assertRegistrationAvailable(user.companyId, registrationNumber);
    }

    // Going back to OWNED must not leave live loan terms hanging off the vehicle.
    if (dto.ownership === VehicleOwnership.OWNED && existing.financing && existing.financing.status === FinanceStatus.ACTIVE) {
      throw new BadRequestException(
        'This vehicle still has an active loan. Close the financing (COMPLETED, CLOSED or DEFAULTED) before marking it fully owned.',
      );
    }

    await this.prisma.vehicle.update({
      where: { id: existing.id },
      data: {
        ...(registrationNumber ? { registrationNumber } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.fuelType !== undefined ? { fuelType: dto.fuelType } : {}),
        ...(dto.make !== undefined ? { make: dto.make.trim() || null } : {}),
        ...(dto.model !== undefined ? { model: dto.model.trim() || null } : {}),
        ...(dto.variant !== undefined ? { variant: dto.variant.trim() || null } : {}),
        ...(dto.manufactureYear !== undefined ? { manufactureYear: dto.manufactureYear } : {}),
        ...(dto.capacityTonnes !== undefined ? { capacityTonnes: dto.capacityTonnes } : {}),
        ...(dto.mileageKmpl !== undefined ? { mileageKmpl: dto.mileageKmpl } : {}),
        ...(dto.ownership !== undefined ? { ownership: dto.ownership } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
        updatedById: user.id,
      },
    });

    if (dto.ownership && dto.ownership !== existing.ownership) {
      await this.audit.record({
        action: 'vehicle.ownership_changed',
        entityType: 'Vehicle',
        entityId: existing.id,
        companyId: user.companyId,
        actorUserId: user.id,
        actorRole: user.role,
        changes: { from: existing.ownership, to: dto.ownership },
      });
    }
    await this.audit.record({
      action: 'vehicle.updated',
      entityType: 'Vehicle',
      entityId: existing.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { fields: Object.keys(dto) },
    });
    return this.findById(user.companyId, id);
  }

  /** Vehicles are retired or parked, never deleted. Retiring one also ends its assignment. */
  async setStatus(user: AuthenticatedUser, id: string, dto: SetVehicleStatusDto): Promise<VehicleRow> {
    const existing = await this.findById(user.companyId, id);

    const endedAssignmentId = await this.prisma.$transaction(async (tx) => {
      const ended =
        dto.status === VehicleStatus.RETIRED
          ? await this.assignments.endCurrentForVehicle(tx, existing.id, END_REASON.vehicleRetired, user.id)
          : null;
      await tx.vehicle.update({ where: { id: existing.id }, data: { status: dto.status, updatedById: user.id } });
      return ended;
    });

    await this.audit.record({
      action: 'vehicle.status_changed',
      entityType: 'Vehicle',
      entityId: existing.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { from: existing.status, to: dto.status, endedAssignmentId },
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });
    return this.findById(user.companyId, id);
  }

  /**
   * Records loan terms. Only financed vehicles may carry financing, which is what keeps EMI
   * information off fully owned vehicles rather than relying on the UI to hide it.
   */
  async upsertFinancing(user: AuthenticatedUser, id: string, dto: UpsertFinancingDto): Promise<VehicleRow> {
    const existing = await this.findById(user.companyId, id);
    if (existing.ownership !== VehicleOwnership.FINANCED) {
      throw new BadRequestException('Set the vehicle ownership to FINANCED before recording loan details.');
    }

    const tenureMonths = dto.tenureMonths ?? existing.financing?.tenureMonths ?? null;
    const totalInstallments = dto.totalInstallments ?? existing.financing?.totalInstallments ?? tenureMonths;
    const paidInstallments = dto.paidInstallments ?? existing.financing?.paidInstallments ?? 0;

    if (totalInstallments !== null && paidInstallments > totalInstallments) {
      throw new BadRequestException('Paid instalments cannot exceed the total number of instalments.');
    }

    const data = {
      status: dto.status ?? existing.financing?.status ?? FinanceStatus.ACTIVE,
      lenderName: dto.lenderName?.trim() ?? existing.financing?.lenderName ?? null,
      loanAccountNumber: dto.loanAccountNumber?.trim() ?? existing.financing?.loanAccountNumber ?? null,
      loanAmount: dto.loanAmount ?? existing.financing?.loanAmount ?? null,
      downPayment: dto.downPayment ?? existing.financing?.downPayment ?? null,
      financeStartDate: toDate(dto.financeStartDate) ?? existing.financing?.financeStartDate ?? null,
      tenureMonths,
      totalInstallments,
      paidInstallments,
      interestRatePct: dto.interestRatePct ?? existing.financing?.interestRatePct ?? null,
      emiAmount: dto.emiAmount ?? existing.financing?.emiAmount ?? null,
      outstandingAmount: dto.outstandingAmount ?? existing.financing?.outstandingAmount ?? null,
      nextDueDate: toDate(dto.nextDueDate) ?? existing.financing?.nextDueDate ?? null,
      updatedById: user.id,
    };

    await this.prisma.vehicleFinancing.upsert({
      where: { vehicleId: existing.id },
      create: { vehicleId: existing.id, ...data, createdById: user.id },
      update: data,
    });

    await this.audit.record({
      action: 'vehicle.financing_updated',
      entityType: 'VehicleFinancing',
      entityId: existing.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      // Loan account numbers are not echoed into the audit trail.
      changes: { fields: Object.keys(dto).filter((key) => key !== 'loanAccountNumber'), status: data.status },
    });
    return this.findById(user.companyId, id);
  }

  private async assertRegistrationAvailable(companyId: string, registrationNumber: string): Promise<void> {
    const clash = await this.prisma.vehicle.findFirst({ where: { companyId, registrationNumber }, select: { id: true } });
    if (clash) throw new ConflictException(`Vehicle ${registrationNumber} already exists.`);
  }

  /** Registration numbers are stored upper-case with single spaces so lookups are predictable. */
  static normaliseRegistration(value: string): string {
    return value.trim().toUpperCase().replace(/\s+/g, ' ');
  }
}
