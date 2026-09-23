import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedUser } from './authenticated-user';

function contextFor(user?: AuthenticatedUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardWith(metadata: Record<string, unknown>): RolesGuard {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => metadata[key as string]);
  return new RolesGuard(reflector);
}

const user = (role: UserRole): AuthenticatedUser => ({ id: 'u1', companyId: 'c1', role, employeeId: null, driverId: null });

describe('RolesGuard', () => {
  it('allows public routes without a user', () => {
    expect(guardWith({ [IS_PUBLIC_KEY]: true }).canActivate(contextFor())).toBe(true);
  });

  it('allows any authenticated user when no roles are required', () => {
    expect(guardWith({}).canActivate(contextFor(user(UserRole.DRIVER)))).toBe(true);
  });

  it('allows a listed role and rejects an unlisted one', () => {
    const guard = guardWith({ [ROLES_KEY]: [UserRole.ADMIN, UserRole.ACCOUNTING] });
    expect(guard.canActivate(contextFor(user(UserRole.ADMIN)))).toBe(true);
    expect(() => guard.canActivate(contextFor(user(UserRole.DRIVER)))).toThrow(ForbiddenException);
  });

  it('always allows SUPER_ADMIN', () => {
    expect(guardWith({ [ROLES_KEY]: [UserRole.DRIVER] }).canActivate(contextFor(user(UserRole.SUPER_ADMIN)))).toBe(true);
  });

  it('denies when the request has no user at all', () => {
    expect(guardWith({ [ROLES_KEY]: [UserRole.ADMIN] }).canActivate(contextFor())).toBe(false);
  });
});
