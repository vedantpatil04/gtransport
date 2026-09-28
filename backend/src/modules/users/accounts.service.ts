import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EmploymentStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { PasswordHasher } from '../auth/password-hasher';
import { assertCanManageAccount, canAdministerAccounts, canStandDownLogin, manageableRoles, STATUS_ACTIONS } from './account-policy';
import { generateTemporaryPassword, normaliseEmail, normaliseMobile } from './credentials';

/**
 * Sign-in accounts for employees. The employee is the person; the account is how they sign in;
 * the role is what they may do. An employee has at most one account (users.employee_id is
 * unique), and an account never outlives its history: it is disabled, not deleted.
 */

export const ACCOUNT_SELECT = {
  id: true,
  role: true,
  status: true,
  email: true,
  phone: true,
  mustChangePassword: true,
  lastLoginAt: true,
  passwordChangedAt: true,
  createdAt: true,
  employeeId: true,
} as const satisfies Prisma.UserSelect;

export type AccountRow = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

export interface AccountView {
  id: string;
  role: UserRole;
  status: UserStatus;
  /** What they type to sign in. */
  signInId: string;
  email: string | null;
  phone: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  createdAt: string;
}

/** The account plus what the viewer may do with it, so clients never re-derive the policy. */
export interface AccountAccess {
  account: AccountView | null;
  canManage: boolean;
  assignableRoles: UserRole[];
}

export interface CreateAccountInput {
  role: UserRole;
  phone?: string;
  email?: string;
}

export interface PreparedAccount {
  role: UserRole;
  phone: string | null;
  email: string | null;
  passwordHash: string;
  temporaryPassword: string;
}

/**
 * Who the account is for: an existing employee (optionally gaining a driver profile in the same
 * transaction), or one being created in the same transaction.
 */
export type AccountSubject =
  | { employeeId: string; gainsDriverProfile?: boolean }
  | { newEmployee: { status: EmploymentStatus } };

/** Employment statuses in which someone may hold a working login. */
const WORKING: EmploymentStatus[] = [EmploymentStatus.ACTIVE, EmploymentStatus.ON_LEAVE];

export function presentAccount(row: AccountRow): AccountView {
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    signInId: row.phone ?? row.email ?? '',
    email: row.email,
    phone: row.phone,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    passwordChangedAt: row.passwordChangedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly hasher: PasswordHasher,
  ) {}

  async access(actor: AuthenticatedUser, employeeId: string): Promise<AccountAccess> {
    this.assertAdministrator(actor);
    const employee = await this.employee(actor.companyId, employeeId);
    const account = await this.prisma.user.findFirst({ where: { employeeId: employee.id, deletedAt: null }, select: ACCOUNT_SELECT });
    const assignable = manageableRoles(actor.role).filter((role) => role !== UserRole.DRIVER || Boolean(employee.driver));
    return {
      account: account ? presentAccount(account) : null,
      canManage: account ? account.id !== actor.id && manageableRoles(actor.role).includes(account.role) : assignable.length > 0,
      assignableRoles: assignable,
    };
  }

  // ───────────────────────────── Create ─────────────────────────────

  /** Checks and hashes outside any transaction; the insert itself can then join one. */
  async prepare(actor: AuthenticatedUser, input: CreateAccountInput, subject: AccountSubject): Promise<PreparedAccount> {
    assertCanManageAccount(actor, null, input.role);

    let status: EmploymentStatus;
    let hasDriverProfile: boolean;
    if ('employeeId' in subject) {
      const employee = await this.employee(actor.companyId, subject.employeeId);
      if (await this.prisma.user.findFirst({ where: { employeeId: employee.id, deletedAt: null }, select: { id: true } })) {
        throw new ConflictException('This employee already has a sign-in account.');
      }
      status = employee.status;
      hasDriverProfile = Boolean(employee.driver) || Boolean(subject.gainsDriverProfile);
    } else {
      status = subject.newEmployee.status;
      hasDriverProfile = false;
    }

    if (!WORKING.includes(status)) throw new BadRequestException('Only a working employee (active or on leave) can be given sign-in access.');
    if (input.role === UserRole.DRIVER && !hasDriverProfile) {
      throw new BadRequestException('A driver login needs a driver profile. Create the driver profile first.');
    }

    const { phone, email } = this.identifiers(input);
    await this.assertIdentifierFree(phone, email);

    const temporaryPassword = generateTemporaryPassword();
    return { role: input.role, phone, email, temporaryPassword, passwordHash: await this.hasher.hash(temporaryPassword) };
  }

  async insert(tx: Prisma.TransactionClient, actor: AuthenticatedUser, prepared: PreparedAccount, employeeId: string): Promise<AccountRow> {
    return tx.user.create({
      data: {
        companyId: actor.companyId,
        employeeId,
        role: prepared.role,
        phone: prepared.phone,
        email: prepared.email,
        passwordHash: prepared.passwordHash,
        status: UserStatus.INVITED,
        mustChangePassword: true,
        createdById: actor.id,
        updatedById: actor.id,
      },
      select: ACCOUNT_SELECT,
    });
  }

  async recordCreated(actor: AuthenticatedUser, account: AccountRow): Promise<void> {
    await this.record(actor, 'account.created', account.id, {
      employeeId: account.employeeId,
      role: account.role,
      status: account.status,
      signInWith: account.phone ? 'PHONE' : 'EMAIL',
    });
  }

  async create(actor: AuthenticatedUser, employeeId: string, input: CreateAccountInput): Promise<{ account: AccountView; temporaryPassword: string }> {
    const prepared = await this.prepare(actor, input, { employeeId });
    const account = await this.prisma.$transaction((tx) => this.insert(tx, actor, prepared, employeeId));
    await this.recordCreated(actor, account);
    return { account: presentAccount(account), temporaryPassword: prepared.temporaryPassword };
  }

  // ───────────────────────────── Change ─────────────────────────────

  async changeRole(actor: AuthenticatedUser, employeeId: string, role: UserRole): Promise<AccountView> {
    const { account, employee } = await this.target(actor, employeeId, role);
    if (account.role === role) throw new BadRequestException(`The account already has the ${role.toLowerCase()} role.`);
    if (role === UserRole.DRIVER && !employee.driver) throw new BadRequestException('A driver login needs a driver profile. Create the driver profile first.');

    const updated = await this.prisma.user.update({
      where: { id: account.id },
      data: { role, sessionVersion: { increment: 1 }, updatedById: actor.id },
      select: ACCOUNT_SELECT,
    });
    await this.record(actor, 'account.role_changed', account.id, { role: { from: account.role, to: role } });
    return presentAccount(updated);
  }

  async suspend(actor: AuthenticatedUser, employeeId: string, reason: string): Promise<AccountView> {
    return this.moveStatus(actor, employeeId, 'suspend', reason);
  }

  async disable(actor: AuthenticatedUser, employeeId: string, reason: string): Promise<AccountView> {
    return this.moveStatus(actor, employeeId, 'disable', reason);
  }

  /** Reinstates a suspended or disabled login. Someone who never set a password stays INVITED. */
  async activate(actor: AuthenticatedUser, employeeId: string): Promise<AccountView> {
    const { account, employee } = await this.target(actor, employeeId);
    if (!(STATUS_ACTIONS.activate.from as readonly UserStatus[]).includes(account.status)) {
      throw new BadRequestException(`A ${account.status.toLowerCase()} account cannot be activated.`);
    }
    if (!WORKING.includes(employee.status)) throw new BadRequestException('Reactivate the employee before their sign-in access.');
    const next = account.mustChangePassword ? UserStatus.INVITED : UserStatus.ACTIVE;
    const updated = await this.prisma.user.update({ where: { id: account.id }, data: { status: next, updatedById: actor.id }, select: ACCOUNT_SELECT });
    await this.record(actor, 'account.activated', account.id, { status: { from: account.status, to: next } });
    return presentAccount(updated);
  }

  /** New temporary password; signs them out everywhere and asks for a new password at next sign-in. */
  async resetPassword(actor: AuthenticatedUser, employeeId: string): Promise<{ account: AccountView; temporaryPassword: string }> {
    const { account } = await this.target(actor, employeeId);
    const temporaryPassword = generateTemporaryPassword();
    const updated = await this.prisma.user.update({
      where: { id: account.id },
      data: {
        passwordHash: await this.hasher.hash(temporaryPassword),
        mustChangePassword: true,
        sessionVersion: { increment: 1 },
        updatedById: actor.id,
      },
      select: ACCOUNT_SELECT,
    });
    await this.record(actor, 'account.password_reset', account.id, { mustChangePassword: true });
    return { account: presentAccount(updated), temporaryPassword };
  }

  // ───────────────────────────── Employment ─────────────────────────────

  /**
   * Called before an employee's employment status changes. Refuses when the change would stand
   * down a login the actor may not manage (a manager suspending an admin, say), or their own.
   */
  async assertMayChangeEmployment(actor: AuthenticatedUser, employeeId: string, next: EmploymentStatus): Promise<void> {
    if (WORKING.includes(next)) return;
    const account = await this.prisma.user.findFirst({ where: { employeeId, deletedAt: null }, select: { id: true, role: true } });
    if (!account) return;
    if (account.id === actor.id) throw new ForbiddenException('You cannot stand yourself down. Ask another administrator.');
    if (!canStandDownLogin(actor.role, account.role)) {
      throw new ForbiddenException(`Only an administrator can change the status of someone with a ${account.role.toLowerCase().replace('_', ' ')} login.`);
    }
  }

  /**
   * Keeps the login in step with employment: exited or inactive → disabled; suspended →
   * suspended. Coming back to work does not reopen the login — an administrator does that.
   */
  async followEmployment(actor: AuthenticatedUser, employeeId: string, employment: EmploymentStatus): Promise<void> {
    const target =
      employment === EmploymentStatus.EXITED || employment === EmploymentStatus.INACTIVE
        ? UserStatus.DISABLED
        : employment === EmploymentStatus.SUSPENDED
          ? UserStatus.SUSPENDED
          : null;
    if (!target) return;
    const account = await this.prisma.user.findFirst({ where: { employeeId, deletedAt: null }, select: ACCOUNT_SELECT });
    if (!account || account.status === target || account.status === UserStatus.DISABLED) return;

    await this.prisma.user.update({ where: { id: account.id }, data: { status: target, sessionVersion: { increment: 1 }, updatedById: actor.id } });
    await this.record(actor, target === UserStatus.DISABLED ? 'account.disabled' : 'account.suspended', account.id, { status: { from: account.status, to: target } }, {
      reason: 'employment_status',
      employmentStatus: employment,
    });
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  private async moveStatus(actor: AuthenticatedUser, employeeId: string, action: 'suspend' | 'disable', reason: string): Promise<AccountView> {
    const { account } = await this.target(actor, employeeId);
    const rule = STATUS_ACTIONS[action];
    if (!(rule.from as readonly UserStatus[]).includes(account.status)) {
      throw new BadRequestException(`A ${account.status.toLowerCase()} account cannot be ${action === 'suspend' ? 'suspended' : 'disabled'}.`);
    }
    const updated = await this.prisma.user.update({
      where: { id: account.id },
      data: { status: rule.to, sessionVersion: { increment: 1 }, updatedById: actor.id },
      select: ACCOUNT_SELECT,
    });
    await this.record(actor, action === 'suspend' ? 'account.suspended' : 'account.disabled', account.id, { status: { from: account.status, to: rule.to } }, { reason: reason.trim() });
    return presentAccount(updated);
  }

  /** The employee's account, after checking the actor may manage it (and may grant nextRole). */
  private async target(actor: AuthenticatedUser, employeeId: string, nextRole?: UserRole) {
    this.assertAdministrator(actor);
    const employee = await this.employee(actor.companyId, employeeId);
    const account = await this.prisma.user.findFirst({ where: { employeeId: employee.id, deletedAt: null }, select: ACCOUNT_SELECT });
    if (!account) throw new NotFoundException('This employee has no sign-in account.');
    assertCanManageAccount(actor, account, nextRole);
    return { account, employee };
  }

  private async employee(companyId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, status: true, driver: { select: { id: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    return employee;
  }

  private assertAdministrator(actor: AuthenticatedUser) {
    if (!canAdministerAccounts(actor.role)) throw new ForbiddenException('Only administrators can manage sign-in accounts.');
  }

  private identifiers(input: CreateAccountInput): { phone: string | null; email: string | null } {
    const hasPhone = Boolean(input.phone?.trim());
    const hasEmail = Boolean(input.email?.trim());
    if (hasPhone === hasEmail) {
      throw new BadRequestException({
        message: 'Give either a mobile number or an email address to sign in with.',
        details: [{ field: hasPhone ? 'email' : 'phone', messages: ['Use a mobile number or an email address, not both.'] }],
      });
    }
    if (hasPhone) {
      const phone = normaliseMobile(input.phone!);
      if (!phone) throw new BadRequestException({ message: 'Enter a 10-digit Indian mobile number.', details: [{ field: 'phone', messages: ['Enter a 10-digit Indian mobile number.'] }] });
      return { phone, email: null };
    }
    const email = normaliseEmail(input.email!);
    if (!email) throw new BadRequestException({ message: 'Enter a valid email address.', details: [{ field: 'email', messages: ['Enter a valid email address.'] }] });
    return { phone: null, email };
  }

  /**
   * Sign-in has no company picker, so an identifier must be unique across every company —
   * otherwise neither person could sign in. The database enforces uniqueness per company.
   */
  private async assertIdentifierFree(phone: string | null, email: string | null): Promise<void> {
    const clash = await this.prisma.user.findFirst({
      where: { deletedAt: null, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] },
      select: { id: true },
    });
    if (clash) {
      const field = phone ? 'phone' : 'email';
      const message = phone ? 'This mobile number is already used to sign in.' : 'This email address is already used to sign in.';
      throw new ConflictException({ message, details: [{ field, messages: [message] }] });
    }
  }

  private async record(actor: AuthenticatedUser, action: string, userId: string, changes: Record<string, unknown>, metadata?: Record<string, unknown>) {
    await this.audit.record({
      action,
      entityType: 'User',
      entityId: userId,
      companyId: actor.companyId,
      actorUserId: actor.id,
      actorRole: actor.role,
      changes: changes as Prisma.InputJsonValue,
      ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
    });
  }
}
