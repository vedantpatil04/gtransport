import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DriverStatus, Prisma, VehicleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { keysetArgs, toPage, type Page, type PaginationQuery } from '../../common/pagination/pagination';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { AssignDriverDto, UnassignDriverDto } from './dto/assignment.dto';
import type { AssignmentWithParties } from './assignment.presenter';

const ASSIGNMENT_PARTIES = {
  vehicle: { select: { id: true, registrationNumber: true, kind: true } },
  driver: { select: { id: true, driverCode: true, employee: { select: { fullName: true, phone: true } } } },
} as const;

/** Reasons an assignment closes. Recorded on the closed row and in the audit trail. */
export const END_REASON = {
  reassignedVehicle: 'vehicle_reassigned',
  reassignedDriver: 'driver_reassigned',
  unassigned: 'unassigned',
  driverStoodDown: 'driver_deactivated',
  vehicleRetired: 'vehicle_retired',
} as const;

export type EndReason = (typeof END_REASON)[keyof typeof END_REASON];

/**
 * Driver ↔ vehicle assignments.
 *
 * History is append-only: assigning a different driver closes the open row and opens a new one.
 * The single open assignment per vehicle and per driver is guaranteed by unique
 * `current_assignment_id` columns, and every mutation runs in one transaction so a failure
 * cannot leave a vehicle and a driver disagreeing about who is driving what.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async assign(user: AuthenticatedUser, vehicleId: string, dto: AssignDriverDto): Promise<AssignmentWithParties> {
    const startedAt = dto.startedAt ? new Date(dto.startedAt) : new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findFirst({
        where: { id: vehicleId, companyId: user.companyId, deletedAt: null },
        select: { id: true, registrationNumber: true, status: true, currentAssignmentId: true },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found.');

      const driver = await tx.driver.findFirst({
        where: { id: dto.driverId, companyId: user.companyId, deletedAt: null },
        select: { id: true, driverCode: true, status: true, currentAssignmentId: true, employee: { select: { fullName: true } } },
      });
      if (!driver) throw new NotFoundException('Driver not found.');

      if (driver.status !== DriverStatus.ACTIVE) {
        throw new BadRequestException(`${driver.employee.fullName} is ${driver.status.toLowerCase()} and cannot be assigned a vehicle.`);
      }
      if (vehicle.status === VehicleStatus.RETIRED) {
        throw new BadRequestException('A retired vehicle cannot be assigned a driver.');
      }

      // Already the current driver of this vehicle: nothing to change.
      if (vehicle.currentAssignmentId && vehicle.currentAssignmentId === driver.currentAssignmentId) {
        const unchanged = await tx.vehicleAssignment.findUniqueOrThrow({
          where: { id: vehicle.currentAssignmentId },
          include: ASSIGNMENT_PARTIES,
        });
        return { assignment: unchanged, closed: [] as string[], changed: false };
      }

      const closed: string[] = [];
      if (vehicle.currentAssignmentId) {
        await this.closeAssignment(tx, vehicle.currentAssignmentId, END_REASON.reassignedVehicle, startedAt, user.id);
        closed.push(vehicle.currentAssignmentId);
      }
      if (driver.currentAssignmentId) {
        await this.closeAssignment(tx, driver.currentAssignmentId, END_REASON.reassignedDriver, startedAt, user.id);
        closed.push(driver.currentAssignmentId);
      }

      const assignment = await tx.vehicleAssignment.create({
        data: {
          companyId: user.companyId,
          vehicleId: vehicle.id,
          driverId: driver.id,
          startedAt,
          notes: dto.notes?.trim() || null,
          createdById: user.id,
          updatedById: user.id,
        },
        include: ASSIGNMENT_PARTIES,
      });

      await tx.vehicle.update({ where: { id: vehicle.id }, data: { currentAssignmentId: assignment.id, updatedById: user.id } });
      await tx.driver.update({ where: { id: driver.id }, data: { currentAssignmentId: assignment.id, updatedById: user.id } });

      return { assignment, closed, changed: true };
    });

    if (result.changed) {
      await this.audit.record({
        action: 'assignment.created',
        entityType: 'VehicleAssignment',
        entityId: result.assignment.id,
        companyId: user.companyId,
        actorUserId: user.id,
        actorRole: user.role,
        changes: {
          vehicleId,
          driverId: dto.driverId,
          startedAt: startedAt.toISOString(),
          closedAssignmentIds: result.closed,
        },
      });
    }
    return result.assignment;
  }

  async unassign(user: AuthenticatedUser, vehicleId: string, dto: UnassignDriverDto): Promise<AssignmentWithParties> {
    const assignment = await this.prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findFirst({
        where: { id: vehicleId, companyId: user.companyId, deletedAt: null },
        select: { id: true, currentAssignmentId: true },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found.');
      if (!vehicle.currentAssignmentId) throw new BadRequestException('This vehicle has no driver assigned.');

      await this.closeAssignment(tx, vehicle.currentAssignmentId, dto.reason?.trim() || END_REASON.unassigned, new Date(), user.id);
      return tx.vehicleAssignment.findUniqueOrThrow({ where: { id: vehicle.currentAssignmentId }, include: ASSIGNMENT_PARTIES });
    });

    await this.audit.record({
      action: 'assignment.ended',
      entityType: 'VehicleAssignment',
      entityId: assignment.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { vehicleId, driverId: assignment.driverId, endReason: assignment.endReason },
    });
    return assignment;
  }

  /**
   * Closes an open assignment. The pointers on both sides are cleared first: the database
   * refuses to close an assignment that a vehicle or driver still calls current.
   */
  async closeAssignment(
    tx: Prisma.TransactionClient,
    assignmentId: string,
    endReason: string,
    endedAt: Date,
    actorUserId: string,
  ): Promise<void> {
    const open = await tx.vehicleAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, startedAt: true, endedAt: true },
    });
    if (!open || open.endedAt) return;

    await tx.vehicle.updateMany({ where: { currentAssignmentId: assignmentId }, data: { currentAssignmentId: null } });
    await tx.driver.updateMany({ where: { currentAssignmentId: assignmentId }, data: { currentAssignmentId: null } });

    await tx.vehicleAssignment.update({
      where: { id: assignmentId },
      data: {
        // Guards against a back-dated reassignment producing a negative-length period.
        endedAt: endedAt < open.startedAt ? open.startedAt : endedAt,
        endReason,
        updatedById: actorUserId,
      },
    });
  }

  /** Ends whatever a driver is currently driving, e.g. when they are stood down. */
  async endCurrentForDriver(
    tx: Prisma.TransactionClient,
    driverId: string,
    endReason: EndReason,
    actorUserId: string,
  ): Promise<string | null> {
    const driver = await tx.driver.findUnique({ where: { id: driverId }, select: { currentAssignmentId: true } });
    if (!driver?.currentAssignmentId) return null;
    await this.closeAssignment(tx, driver.currentAssignmentId, endReason, new Date(), actorUserId);
    return driver.currentAssignmentId;
  }

  /** Ends whatever is driving a vehicle, e.g. when it is retired. */
  async endCurrentForVehicle(
    tx: Prisma.TransactionClient,
    vehicleId: string,
    endReason: EndReason,
    actorUserId: string,
  ): Promise<string | null> {
    const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { currentAssignmentId: true } });
    if (!vehicle?.currentAssignmentId) return null;
    await this.closeAssignment(tx, vehicle.currentAssignmentId, endReason, new Date(), actorUserId);
    return vehicle.currentAssignmentId;
  }

  async historyForVehicle(companyId: string, vehicleId: string, query: PaginationQuery): Promise<Page<AssignmentWithParties>> {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, companyId, deletedAt: null }, select: { id: true } });
    if (!vehicle) throw new NotFoundException('Vehicle not found.');
    const rows = await this.prisma.vehicleAssignment.findMany({
      where: { companyId, vehicleId },
      include: ASSIGNMENT_PARTIES,
      ...keysetArgs(query),
    });
    return toPage(rows, query.limit);
  }

  async historyForDriver(companyId: string, driverId: string, query: PaginationQuery): Promise<Page<AssignmentWithParties>> {
    const driver = await this.prisma.driver.findFirst({ where: { id: driverId, companyId, deletedAt: null }, select: { id: true } });
    if (!driver) throw new NotFoundException('Driver not found.');
    const rows = await this.prisma.vehicleAssignment.findMany({
      where: { companyId, driverId },
      include: ASSIGNMENT_PARTIES,
      ...keysetArgs(query),
    });
    return toPage(rows, query.limit);
  }
}
