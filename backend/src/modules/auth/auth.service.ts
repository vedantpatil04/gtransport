import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { AppConfigService } from '../../config/app-config.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApiErrorCode } from '../../common/http/api-error';
import { passwordProblem } from '../users/credentials';
import { UsersService, type AccountProfile, type UserWithProfile } from '../users/users.service';
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
  /** Relative duration for clients that parse expiresIn */
  expiresIn?: string;
  /** One session, whatever the role: the role decides which app the client shows. */
  user: AccountProfile;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async login(identifier: string, password: string, context: RequestContext): Promise<LoginResult> {
    const user = await this.users.findLoginCandidate(identifier);
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

    // Only after the right password: the owner may learn why they cannot get in.
    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.DISABLED) {
      await this.audit.record({
        action: 'auth.login_blocked',
        entityType: 'User',
        entityId: user.id,
        companyId: user.companyId,
        metadata: { status: user.status },
        ...context,
      });
      const suspended = user.status === UserStatus.SUSPENDED;
      throw new ForbiddenException({
        message: suspended ? 'This account is suspended. Please contact your office.' : 'This account no longer has sign-in access. Please contact your office.',
        code: suspended ? ApiErrorCode.ACCOUNT_SUSPENDED : ApiErrorCode.ACCOUNT_DISABLED,
      });
    }

    const result = await this.issue(user);
    await this.users.markLoggedIn(user.id, new Date());
    await this.audit.record({
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      metadata: user.mustChangePassword ? { temporaryPassword: true } : undefined,
      ...context,
    });
    return result;
  }

  /** Who is signed in, read fresh — the source of truth for the role after a restart. */
  async me(user: AuthenticatedUser): Promise<AccountProfile> {
    const row = await this.users.findWithProfile(user.id);
    if (!row) throw new UnauthorizedException('The account is no longer active.');
    return UsersService.profile(row);
  }

  /**
   * Replaces the password. Clears a temporary password (INVITED → ACTIVE) and ends every other
   * session, so the caller gets a fresh token back.
   */
  async changePassword(actor: AuthenticatedUser, currentPassword: string, newPassword: string, context: RequestContext): Promise<LoginResult> {
    const user = await this.users.findWithProfile(actor.id);
    if (!user) throw new UnauthorizedException('The account is no longer active.');
    if (!(await this.hasher.verify(currentPassword, user.passwordHash))) {
      throw new BadRequestException({
        message: 'The current password is not correct.',
        details: [{ field: 'currentPassword', messages: ['The current password is not correct.'] }],
      });
    }
    const problem = passwordProblem(newPassword, { current: currentPassword, identifiers: [user.email, user.phone] });
    if (problem) throw new BadRequestException({ message: problem, details: [{ field: 'newPassword', messages: [problem] }] });

    const wasTemporary = user.mustChangePassword;
    const updated = await this.users.update(user.id, {
      passwordHash: await this.hasher.hash(newPassword),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      sessionVersion: { increment: 1 },
      ...(user.status === UserStatus.INVITED ? { status: UserStatus.ACTIVE } : {}),
    });
    await this.audit.record({
      action: 'account.password_changed',
      entityType: 'User',
      entityId: user.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { replacedTemporary: wasTemporary, ...(user.status === UserStatus.INVITED ? { status: { from: 'INVITED', to: 'ACTIVE' } } : {}) },
      ...context,
    });
    return this.issue(updated);
  }

  private async issue(user: UserWithProfile): Promise<LoginResult> {
    const payload: JwtPayload = { sub: user.id, cid: user.companyId, role: user.role, sv: user.sessionVersion };
    const accessToken = await this.jwt.signAsync(payload);
    const exp = this.jwt.decode<{ exp?: number } | null>(accessToken)?.exp;
    return {
      accessToken,
      expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
      // Taken from configuration so it can never disagree with the token's real lifetime.
      expiresIn: this.config.jwt.expiresIn,
      user: UsersService.profile(user),
    };
  }
}
