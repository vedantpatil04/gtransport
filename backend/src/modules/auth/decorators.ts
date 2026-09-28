import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from './authenticated-user';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const PASSWORD_CHANGE_KEY = 'auth:allowPendingPasswordChange';

/** Marks a route as reachable without authentication (health checks, login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Reachable while the account still has a temporary password (reading who you are, setting a
 * new password). Every other route answers 403 PASSWORD_CHANGE_REQUIRED until then.
 */
export const AllowPendingPasswordChange = () => SetMetadata(PASSWORD_CHANGE_KEY, true);

/** Restricts a route to the listed roles. SUPER_ADMIN always passes. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (!request.user) throw new Error('CurrentUser used on a route without authentication');
  return request.user;
});
