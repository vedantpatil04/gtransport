import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';

const ACTIVE: Prisma.UserWhereInput = { status: UserStatus.ACTIVE, deletedAt: null };

export type UserWithProfile = User & { employee: { id: string; driver: { id: string } | null } | null };

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Identity for the guard: cheap, and reflects status/role changes immediately. */
  async findActiveById(id: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id, ...ACTIVE },
      select: { id: true, companyId: true, role: true, employee: { select: { id: true, driver: { select: { id: true } } } } },
    });
    if (!user) return null;

    return {
      id: user.id,
      companyId: user.companyId,
      role: user.role,
      employeeId: user.employee?.id ?? null,
      driverId: user.employee?.driver?.id ?? null,
    };
  }

  /**
   * Looks up a login identity by email or phone. Returns null when the identifier matches
   * more than one company so that an ambiguous login can never resolve to the wrong tenant.
   */
  async findActiveByIdentifier(identifier: string): Promise<UserWithProfile | null> {
    const normalised = identifier.trim();
    const matches = await this.prisma.user.findMany({
      where: { ...ACTIVE, OR: [{ email: normalised.toLowerCase() }, { phone: normalised }] },
      include: { employee: { select: { id: true, driver: { select: { id: true } } } } },
      take: 2,
    });
    return matches.length === 1 ? matches[0] : null;
  }

  async markLoggedIn(id: string, at: Date): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: at } });
  }
}
