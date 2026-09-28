import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ApiErrorCode } from '../../common/http/api-error';
import { UsersService } from '../users/users.service';
import { IS_PUBLIC_KEY, PASSWORD_CHANGE_KEY } from './decorators';
import type { JwtPayload } from './authenticated-user';

/**
 * Applied globally: every route requires a valid bearer token unless marked @Public().
 *
 * The user is re-read on each request, so a suspended or disabled account, a changed role or a
 * password reset takes effect immediately rather than when the token expires:
 *  - suspended/disabled accounts are not found → 401;
 *  - a token issued before the last role/status/password change carries an older session
 *    version → 401, and the app signs in again with the current role;
 *  - an account still on a temporary password may only reach routes marked
 *    @AllowPendingPasswordChange → otherwise 403 PASSWORD_CHANGE_REQUIRED.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Authentication is required.');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('The access token is invalid or has expired.');
    }

    const session = await this.users.findSessionUser(payload.sub);
    if (!session || session.user.companyId !== payload.cid) {
      throw new UnauthorizedException('The account is no longer active.');
    }
    if ((payload.sv ?? 0) !== session.sessionVersion) {
      throw new UnauthorizedException('Your account was changed. Please sign in again.');
    }
    if (session.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(PASSWORD_CHANGE_KEY, targets)) {
      throw new ForbiddenException({ message: 'Set a new password before continuing.', code: ApiErrorCode.PASSWORD_CHANGE_REQUIRED });
    }

    request.user = session.user;
    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.header('authorization');
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null;
  }
}
