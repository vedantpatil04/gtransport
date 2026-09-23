import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

/** Enforces @Roles(). Runs after JwtAuthGuard, so request.user is present. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user) return false;
    if (user.role === UserRole.SUPER_ADMIN) return true;
    if (required.includes(user.role)) return true;

    throw new ForbiddenException('Your role does not permit this action.');
  }
}
