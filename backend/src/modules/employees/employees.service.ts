import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeRole, EmploymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { keysetArgs, toPage, type Page } from '../../common/pagination/pagination';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { AccountsService, type AccountRow } from '../users/accounts.service';
import type { CreateEmployeeDto, ListEmployeesQuery, SetEmployeeStatusDto, UpdateEmployeeDto } from './dto/employee.dto';
import type { EmployeeWithDriver } from './employee.presenter';

const DRIVER_SUMMARY = { select: { id: true, driverCode: true, status: true } } as const;
const EMPLOYEE_INCLUDE = {
  driver: DRIVER_SUMMARY,
  user: { select: { id: true, role: true, status: true, deletedAt: true } },
} as const;

/** Statuses that mean the person is no longer working day to day. */
export const INACTIVE_EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  EmploymentStatus.SUSPENDED,
  EmploymentStatus.INACTIVE,
  EmploymentStatus.EXITED,
];

const toDate = (value?: string | null): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00.000Z`);

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounts: AccountsService,
  ) {}

  async list(companyId: string, query: ListEmployeesQuery): Promise<Page<EmployeeWithDriver>> {
    const rows = await this.prisma.employee.findMany({
      where: this.buildWhere(companyId, query),
      include: EMPLOYEE_INCLUDE,
      ...keysetArgs(query),
    });
    return toPage(rows, query.limit);
  }

  private buildWhere(companyId: string, query: ListEmployeesQuery): Prisma.EmployeeWhereInput {
    const q = query.q?.trim();
    return {
      companyId,
      deletedAt: null,
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.pfApplicable === undefined ? {} : { pfApplicable: query.pfApplicable === 1 }),
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { employeeCode: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { phone: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { email: { contains: q, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };
  }

  async findById(companyId: string, id: string): Promise<EmployeeWithDriver> {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId, deletedAt: null },
      include: EMPLOYEE_INCLUDE,
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    return employee;
  }

  async create(user: AuthenticatedUser, dto: CreateEmployeeDto): Promise<EmployeeWithDriver & { temporaryPassword?: string }> {
    const employeeCode = dto.employeeCode?.trim() || (await this.nextEmployeeCode(user.companyId));
    await this.assertCodeAvailable(user.companyId, employeeCode);
    // Login access is checked (permission, identifier) before anything is written.
    const account = dto.account
      ? await this.accounts.prepare(user, dto.account, { newEmployee: { status: dto.status ?? EmploymentStatus.ACTIVE } })
      : null;

    const { employee, login } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({
      data: {
        companyId: user.companyId,
        employeeCode,
        fullName: dto.fullName.trim(),
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim().toLowerCase() || null,
        role: dto.role,
        designation: dto.designation?.trim() || null,
        department: dto.department?.trim() || null,
        dateOfBirth: toDate(dto.dateOfBirth) ?? null,
        joiningDate: toDate(dto.joiningDate) ?? null,
        preferredLanguage: dto.preferredLanguage,
        status: dto.status ?? EmploymentStatus.ACTIVE,
        baseSalary: dto.baseSalary ?? null,
        pfApplicable: dto.pfApplicable ?? false,
        uan: dto.uan?.trim() || null,
        pfMemberId: dto.pfMemberId?.trim() || null,
        notes: dto.notes?.trim() || null,
        createdById: user.id,
        updatedById: user.id,
      },
      include: EMPLOYEE_INCLUDE,
      });
      const login: AccountRow | null = account ? await this.accounts.insert(tx, user, account, created.id) : null;
      return { employee: created, login };
    });

    await this.audit.record({
      action: 'employee.created',
      entityType: 'Employee',
      entityId: employee.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { employeeCode: employee.employeeCode, fullName: employee.fullName, role: employee.role, loginAccess: Boolean(login) },
    });
    if (!login) return employee;
    await this.accounts.recordCreated(user, login);
    return {
      ...employee,
      user: { id: login.id, role: login.role, status: login.status, deletedAt: null },
      temporaryPassword: account!.temporaryPassword,
    };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateEmployeeDto): Promise<EmployeeWithDriver> {
    const existing = await this.findById(user.companyId, id);

    if (dto.role && dto.role !== EmployeeRole.DRIVER && existing.driver) {
      throw new BadRequestException('This employee has a driver profile; remove it before changing the role away from DRIVER.');
    }

    const employee = await this.prisma.employee.update({
      where: { id: existing.id },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() || null } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.designation !== undefined ? { designation: dto.designation.trim() || null } : {}),
        ...(dto.department !== undefined ? { department: dto.department.trim() || null } : {}),
        ...(dto.dateOfBirth !== undefined ? { dateOfBirth: toDate(dto.dateOfBirth) } : {}),
        ...(dto.joiningDate !== undefined ? { joiningDate: toDate(dto.joiningDate) } : {}),
        ...(dto.exitDate !== undefined ? { exitDate: toDate(dto.exitDate) } : {}),
        ...(dto.preferredLanguage !== undefined ? { preferredLanguage: dto.preferredLanguage } : {}),
        ...(dto.baseSalary !== undefined ? { baseSalary: dto.baseSalary } : {}),
        ...(dto.pfApplicable !== undefined ? { pfApplicable: dto.pfApplicable } : {}),
        ...(dto.uan !== undefined ? { uan: dto.uan.trim() || null } : {}),
        ...(dto.pfMemberId !== undefined ? { pfMemberId: dto.pfMemberId.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
        updatedById: user.id,
      },
      include: EMPLOYEE_INCLUDE,
    });

    await this.audit.record({
      action: 'employee.updated',
      entityType: 'Employee',
      entityId: employee.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { fields: Object.keys(dto) },
    });
    return employee;
  }

  /**
   * Employees are never deleted: they are moved to a non-working status and keep their history.
   * Suspending or ending employment also stands the driver profile down, because an employee who
   * is not working must not remain an active driver.
   */
  async setStatus(user: AuthenticatedUser, id: string, dto: SetEmployeeStatusDto): Promise<EmployeeWithDriver> {
    const existing = await this.findById(user.companyId, id);
    // Standing someone down also stands down their login, so the actor must be allowed that too.
    await this.accounts.assertMayChangeEmployment(user, existing.id, dto.status);
    const standDown = INACTIVE_EMPLOYMENT_STATUSES.includes(dto.status);

    const employee = await this.prisma.employee.update({
      where: { id: existing.id },
      data: {
        status: dto.status,
        updatedById: user.id,
        ...(standDown && existing.driver
          ? { driver: { update: { status: 'INACTIVE', updatedById: user.id } } }
          : {}),
      },
      include: EMPLOYEE_INCLUDE,
    });

    await this.audit.record({
      action: 'employee.status_changed',
      entityType: 'Employee',
      entityId: employee.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { from: existing.status, to: dto.status, driverStoodDown: standDown && Boolean(existing.driver) },
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });
    await this.accounts.followEmployment(user, employee.id, dto.status);
    return dto.status === existing.status ? employee : this.findById(user.companyId, employee.id);
  }

  private async assertCodeAvailable(companyId: string, employeeCode: string): Promise<void> {
    const clash = await this.prisma.employee.findFirst({ where: { companyId, employeeCode }, select: { id: true } });
    if (clash) throw new ConflictException(`Employee code "${employeeCode}" is already in use.`);
  }

  /** Sequential per company: GR-E-001, GR-E-002, … */
  private async nextEmployeeCode(companyId: string): Promise<string> {
    const count = await this.prisma.employee.count({ where: { companyId } });
    for (let candidate = count + 1; candidate < count + 1000; candidate += 1) {
      const code = `GR-E-${String(candidate).padStart(3, '0')}`;
      const clash = await this.prisma.employee.findFirst({ where: { companyId, employeeCode: code }, select: { id: true } });
      if (!clash) return code;
    }
    throw new ConflictException('Could not allocate an employee code; supply one explicitly.');
  }
}
