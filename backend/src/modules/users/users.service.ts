import { Injectable } from '@nestjs/common';
import type { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { SIGN_IN_STATUSES } from './account-policy';
import { normaliseMobile } from './credentials';

export type UserWithProfile = User & {
  employee: { id: string; fullName: string; driver: { id: string } | null } | null;
};

/** What the guard needs each request: identity, plus what decides whether the token still counts. */
export interface SessionUser {
  user: AuthenticatedUser;
  sessionVersion: number;
  mustChangePassword: boolean;
}

/** The signed-in person as clients see them: enough to pick the right app and greet them. */
export interface AccountProfile {
  id: string;
  role: UserRole;
  companyId: string;
  employeeId: string | null;
  driverId: string | null;
  status: UserStatus;
  mustChangePassword: boolean;
  /** Employee name, or the sign-in ID for an account with no employee record. */
  displayName: string;
  email: string | null;
  phone: string | null;
}

const PROFILE_INCLUDE = { employee: { select: { id: true, fullName: true, driver: { select: { id: true } } } } } as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Identity for the guard: cheap, and reflects status, role and session-version changes on the
   * very next request. SUSPENDED and DISABLED accounts are simply not found.
   */
  async findSessionUser(id: string): Promise<SessionUser | null> {
    const row = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, status: { in: SIGN_IN_STATUSES } },
      select: {
        id: true,
        companyId: true,
        role: true,
        sessionVersion: true,
        mustChangePassword: true,
        employee: { select: { id: true, driver: { select: { id: true } } } },
      },
    });
    if (!row) return null;
    return {
      user: { id: row.id, companyId: row.companyId, role: row.role, employeeId: row.employee?.id ?? null, driverId: row.employee?.driver?.id ?? null },
      sessionVersion: row.sessionVersion,
      mustChangePassword: row.mustChangePassword,
    };
  }

  /**
   * Looks up a login by email or phone, whatever its status, so sign-in can tell a suspended
   * account (after the right password) from a wrong password. Returns null when the identifier
   * matches more than one account, so an ambiguous login never resolves to the wrong company.
   */
  async findLoginCandidate(identifier: string): Promise<UserWithProfile | null> {
    const normalised = identifier.trim();
    // "98450 12345", "+91 98450-12345" and "+919845012345" are the same phone login.
    const phone = normaliseMobile(normalised) ?? normalised;
    const matches = await this.prisma.user.findMany({
      where: { deletedAt: null, OR: [{ email: normalised.toLowerCase() }, { phone }] },
      include: PROFILE_INCLUDE,
      take: 2,
    });
    return matches.length === 1 ? matches[0] : null;
  }

  async findWithProfile(id: string): Promise<UserWithProfile | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null }, include: PROFILE_INCLUDE });
  }

  async markLoggedIn(id: string, at: Date): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: at } });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<UserWithProfile> {
    return this.prisma.user.update({ where: { id }, data, include: PROFILE_INCLUDE });
  }

  static profile(user: UserWithProfile): AccountProfile {
    return {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      employeeId: user.employee?.id ?? null,
      driverId: user.employee?.driver?.id ?? null,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      displayName: user.employee?.fullName ?? user.email ?? user.phone ?? '',
      email: user.email,
      phone: user.phone,
    };
  }
}
