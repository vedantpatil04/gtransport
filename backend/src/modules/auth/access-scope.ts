import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * Drivers may only ever reach their own records. Resolving the scope here — rather than
 * trusting a driver id supplied by the client — is what keeps that guarantee in one place.
 */
export function requireDriverScope(user: AuthenticatedUser): { driverId: string; employeeId: string } {
  if (!user.driverId || !user.employeeId) {
    throw new ForbiddenException('This account has no driver profile.');
  }
  return { driverId: user.driverId, employeeId: user.employeeId };
}

export function isDriver(user: AuthenticatedUser): boolean {
  return user.role === UserRole.DRIVER;
}
