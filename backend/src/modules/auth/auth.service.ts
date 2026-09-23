import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../../common/audit/audit.service';
import { UsersService, type UserWithProfile } from '../users/users.service';
import type { AuthenticatedUser, JwtPayload } from './authenticated-user';
import { PasswordHasher } from './password-hasher';

/** A real hash to compare against when no user matches, so failures take similar time. */
const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface LoginResult {
  accessToken: string;
  /** Absolute expiry (ISO 8601), so clients need not parse the token. */
  expiresAt: string | null;
  user: { id: string; role: string; companyId: string; employeeId: string | null; driverId: string | null };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(identifier: string, password: string, context: RequestContext): Promise<LoginResult> {
    const user = await this.users.findActiveByIdentifier(identifier);
    const passwordMatches = await this.hasher.verify(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !passwordMatches) {
      await this.audit.record({
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user?.id ?? null,
        companyId: user?.companyId ?? null,
        metadata: { identifier },
        ...context,
      });
      // Deliberately identical for unknown accounts and wrong passwords.
      throw new UnauthorizedException('Invalid credentials.');
    }

    const payload: JwtPayload = { sub: user.id, cid: user.companyId, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);

    await this.users.markLoggedIn(user.id, new Date());
    await this.audit.record({
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      ...context,
    });

    const exp = this.jwt.decode<{ exp?: number } | null>(accessToken)?.exp;
    return {
      accessToken,
      expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
      user: this.toProfile(user),
    };
  }

  private toProfile(user: UserWithProfile): LoginResult['user'] {
    return {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      employeeId: user.employee?.id ?? null,
      driverId: user.employee?.driver?.id ?? null,
    };
  }

  describe(user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
