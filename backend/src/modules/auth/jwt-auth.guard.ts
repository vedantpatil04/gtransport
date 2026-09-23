import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { UsersService } from '../users/users.service';
import { IS_PUBLIC_KEY } from './decorators';
import type { JwtPayload } from './authenticated-user';

/**
 * Applied globally: every route requires a valid bearer token unless marked @Public().
 *
 * The user is re-read on each request so that disabling an account or changing a role takes
 * effect immediately instead of waiting for the token to expire.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Authentication is required.');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('The access token is invalid or has expired.');
    }

    const user = await this.users.findActiveById(payload.sub);
    if (!user || user.companyId !== payload.cid) {
      throw new UnauthorizedException('The account is no longer active.');
    }

    request.user = user;
    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.header('authorization');
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null;
  }
}
