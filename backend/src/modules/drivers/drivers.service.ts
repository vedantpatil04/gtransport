import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentType, DriverStatus, EmployeeRole, EmploymentStatus, LocationPermission, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { keysetArgs, toPage, type Page } from '../../common/pagination/pagination';
import { AssignmentsService, END_REASON } from '../assignments/assignments.service';
import { deriveLocationStatus } from '../locations/location-status.policy';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { CreateDriverDto, ListDriversQuery, SetDriverStatusDto, UpdateDriverDto } from './dto/driver.dto';

/** Shared selection for driver rows: the person's details always come from the employee record. */
const DRIVER_VIEW = {
  id: true,
  driverCode: true,
  status: true,
  licenceNumber: true,
  licenceExpiryDate: true,
  homeTown: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  locationSharingEnabled: true,
  createdAt: true,
  updatedAt: true,
  employee: {
    select: {
      id: true, employeeCode: true, fullName: true, phone: true, email: true, role: true,
      designation: true, department: true, preferredLanguage: true, status: true, joiningDate: true,
      pfApplicable: true, uan: true, pfMemberId: true, baseSalary: true,
    },
  },
  currentAssignment: {
    select: {
      id: true,
      startedAt: true,
      vehicle: { select: { id: true, registrationNumber: true, kind: true, fuelType: true, status: true, ownership: true } },
    },
  },
  locationState: { select: { status: true, permission: true, lastHeartbeatAt: true } },
} as const;

export type DriverRow = Prisma.DriverGetPayload<{ select: typeof DRIVER_VIEW }>;

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assignments: AssignmentsService,
  ) {}

  async list(companyId: string, query: ListDriversQuery): Promise<Page<DriverRow>> {
    const q = query.q?.trim();
    const where: Prisma.DriverWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.vehicleId ? { currentAssignment: { vehicleId: query.vehicleId } } : {}),
      ...(query.assigned === undefined
        ? {}
        : query.assigned === 1
          ? { NOT: { currentAssignmentId: null } }
          : { currentAssignmentId: null }),
      ...(q
        ? {
            OR: [
              { driverCode: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { employee: { fullName: { contains: q, mode: Prisma.QueryMode.insensitive } } },
              { employee: { phone: { contains: q, mode: Prisma.QueryMode.insensitive } } },
              { currentAssignment: { vehicle: { registrationNumber: { contains: q, mode: Prisma.QueryMode.insensitive } } } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.driver.findMany({ where, select: DRIVER_VIEW, ...keysetArgs(query) });
    return toPage(rows, query.limit);
  }

  async findById(companyId: string, id: string): Promise<DriverRow> {
    const driver = await this.prisma.driver.findFirst({ where: { id, companyId, deletedAt: null }, select: DRIVER_VIEW });
    if (!driver) throw new NotFoundException('Driver not found.');
    return driver;
  }

  async findByEmployeeId(companyId: string, employeeId: string): Promise<DriverRow | null> {
    return this.prisma.driver.findFirst({ where: { employeeId, companyId, deletedAt: null }, select: DRIVER_VIEW });
  }

  /**
   * Attaches a driver profile to an existing employee. The employee is the person; this record
   * only holds driving-specific data, so no second person record is ever created.
   */
  async create(user: AuthenticatedUser, dto: CreateDriverDto): Promise<DriverRow> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, companyId: user.companyId, deletedAt: null },
      select: { id: true, fullName: true, role: true, status: true, driver: { select: { id: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    if (employee.driver) throw new ConflictException(`${employee.fullName} already has a driver profile.`);

    const driverCode = dto.driverCode?.trim() || (await this.nextDriverCode(user.companyId));
    const clash = await this.prisma.driver.findFirst({ where: { companyId: user.companyId, driverCode }, select: { id: true } });
    if (clash) throw new ConflictException(`Driver code "${driverCode}" is already in use.`);

    const driver = await this.prisma.$transaction(async (tx) => {
      const created = await tx.driver.create({
        data: {
          companyId: user.companyId,
          employeeId: employee.id,
          driverCode,
          status: dto.status ?? DriverStatus.ACTIVE,
          licenceNumber: dto.licenceNumber?.trim() || null,
          licenceExpiryDate: dto.licenceExpiryDate ? new Date(`${dto.licenceExpiryDate}T00:00:00.000Z`) : null,
          homeTown: dto.homeTown?.trim() || null,
          emergencyContactName: dto.emergencyContactName?.trim() || null,
          emergencyContactPhone: dto.emergencyContactPhone?.trim() || null,
          locationSharingEnabled: dto.locationSharingEnabled ?? false,
          createdById: user.id,
          updatedById: user.id,
        },
        select: { id: true },
      });

      // Keep the employee's business role consistent with the profile that now exists.
      if (employee.role !== EmployeeRole.DRIVER) {
        await tx.employee.update({ where: { id: employee.id }, data: { role: EmployeeRole.DRIVER, updatedById: user.id } });
      }
      return created;
    });

    await this.audit.record({
      action: 'driver.created',
      entityType: 'Driver',
      entityId: driver.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { employeeId: employee.id, driverCode },
    });
    return this.findById(user.companyId, driver.id);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateDriverDto): Promise<DriverRow> {
    const existing = await this.findById(user.companyId, id);

    await this.prisma.driver.update({
      where: { id: existing.id },
      data: {
        ...(dto.licenceNumber !== undefined ? { licenceNumber: dto.licenceNumber.trim() || null } : {}),
        ...(dto.licenceExpiryDate !== undefined
          ? { licenceExpiryDate: dto.licenceExpiryDate ? new Date(`${dto.licenceExpiryDate}T00:00:00.000Z`) : null }
          : {}),
        ...(dto.homeTown !== undefined ? { homeTown: dto.homeTown.trim() || null } : {}),
        ...(dto.emergencyContactName !== undefined ? { emergencyContactName: dto.emergencyContactName.trim() || null } : {}),
        ...(dto.emergencyContactPhone !== undefined ? { emergencyContactPhone: dto.emergencyContactPhone.trim() || null } : {}),
        ...(dto.locationSharingEnabled !== undefined ? { locationSharingEnabled: dto.locationSharingEnabled } : {}),
        updatedById: user.id,
      },
    });

    await this.audit.record({
      action: 'driver.updated',
      entityType: 'Driver',
      entityId: existing.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { fields: Object.keys(dto) },
    });
    return this.findById(user.companyId, id);
  }

  /**
   * Drivers are stood down, never deleted. A driver who stops being ACTIVE also gives up their
   * vehicle, so the fleet never shows a suspended driver still holding a truck.
   */
  async setStatus(user: AuthenticatedUser, id: string, dto: SetDriverStatusDto): Promise<DriverRow> {
    const existing = await this.findById(user.companyId, id);

    if (dto.status === DriverStatus.ACTIVE && existing.employee.status !== EmploymentStatus.ACTIVE) {
      throw new BadRequestException(
        `${existing.employee.fullName} is not an active employee (${existing.employee.status.toLowerCase()}), so the driver profile cannot be activated.`,
      );
    }

    const endedAssignmentId = await this.prisma.$transaction(async (tx) => {
      const ended =
        dto.status === DriverStatus.ACTIVE
          ? null
          : await this.assignments.endCurrentForDriver(tx, existing.id, END_REASON.driverStoodDown, user.id);
      await tx.driver.update({ where: { id: existing.id }, data: { status: dto.status, updatedById: user.id } });
      return ended;
    });

    await this.audit.record({
      action: 'driver.status_changed',
      entityType: 'Driver',
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
   * Counts of the driver's own documents for the profile screen. Full document management
   * arrives in a later phase; this is a count, not a workflow.
   */
  async documentSummary(
    companyId: string,
    driverId: string,
  ): Promise<{ total: number; expiringSoon: number; expired: number; licenceOnFile: boolean }> {
    const driver = await this.findById(companyId, driverId);
    const today = new Date();
    const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const employeeId = driver.employee.id;

    const [total, expiringSoon, expired, licence] = await Promise.all([
      this.prisma.document.count({ where: { companyId, employeeId, deletedAt: null } }),
      this.prisma.document.count({ where: { companyId, employeeId, deletedAt: null, expiryDate: { gte: today, lte: in30Days } } }),
      this.prisma.document.count({ where: { companyId, employeeId, deletedAt: null, expiryDate: { lt: today } } }),
      this.prisma.document.count({ where: { companyId, employeeId, deletedAt: null, type: DocumentType.DRIVING_LICENCE } }),
    ]);
    return { total, expiringSoon, expired, licenceOnFile: licence > 0 };
  }

  /**
   * Records what the driver's phone reports about location permissions. The status is derived
   * by the shared policy rather than taken from the app, so the app cannot claim tracking is
   * active when the operating system has denied permission.
   */
  async reportLocationState(
    user: AuthenticatedUser,
    driverId: string,
    input: { permission: LocationPermission; locationServicesEnabled: boolean },
  ): Promise<{ status: string; permission: LocationPermission }> {
    const existing = await this.prisma.driverLocationState.findUnique({
      where: { driverId },
      select: { lastHeartbeatAt: true, recordedAt: true },
    });

    const status = deriveLocationStatus(
      {
        permission: input.permission,
        locationServicesEnabled: input.locationServicesEnabled,
        lastHeartbeatAt: existing?.lastHeartbeatAt ?? null,
        recordedAt: existing?.recordedAt ?? null,
      },
      new Date(),
    );

    const saved = await this.prisma.driverLocationState.upsert({
      where: { driverId },
      create: { driverId, companyId: user.companyId, permission: input.permission, status },
      update: { permission: input.permission, status },
      select: { status: true, permission: true },
    });

    await this.audit.record({
      action: 'driver.location_permission_reported',
      entityType: 'DriverLocationState',
      entityId: driverId,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { permission: input.permission, locationServicesEnabled: input.locationServicesEnabled, status: saved.status },
    });

    return saved;
  }

  private async nextDriverCode(companyId: string): Promise<string> {
    const count = await this.prisma.driver.count({ where: { companyId } });
    for (let candidate = count + 101; candidate < count + 1100; candidate += 1) {
      const code = `GR-D-${candidate}`;
      const clash = await this.prisma.driver.findFirst({ where: { companyId, driverCode: code }, select: { id: true } });
      if (!clash) return code;
    }
    throw new ConflictException('Could not allocate a driver code; supply one explicitly.');
  }
}
