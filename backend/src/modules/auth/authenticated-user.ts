import type { UserRole } from '@prisma/client';

/** The request-scoped identity attached by JwtAuthGuard after the token is verified. */
export interface AuthenticatedUser {
  id: string;
  companyId: string;
  role: UserRole;
  employeeId: string | null;
  driverId: string | null;
}

export interface JwtPayload {
  /** User id. */
  sub: string;
  /** Company id — every query is scoped by this. */
  cid: string;
  role: UserRole;
  /**
   * Session version at issue. When an administrator changes the role, suspends, disables or
   * resets the password, the account's version moves on and older tokens stop working.
   * Absent on tokens issued before this existed, which count as version 0.
   */
  sv?: number;
}
