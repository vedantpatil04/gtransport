import { ForbiddenException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';

/**
 * Who may administer whose login. One place, so the API, the employee workflows and the tests
 * all agree. Backend-only: clients use the same rules to hide buttons, never to grant access.
 *
 *   SUPER_ADMIN  every account, every role
 *   ADMIN        MANAGER, ACCOUNTING and DRIVER accounts — never ADMIN or SUPER_ADMIN
 *   MANAGER      no account administration
 *   ACCOUNTING   no account administration
 *   DRIVER       no account administration
 *
 * Nobody changes their own role or status: that is how an administrator locks themselves out
 * or quietly promotes themselves. Their own password goes through /auth/change-password.
 */

export const ACCOUNT_ADMIN_ROLES: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

const MANAGEABLE: Record<UserRole, UserRole[]> = {
  [UserRole.SUPER_ADMIN]: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTING, UserRole.DRIVER],
  [UserRole.ADMIN]: [UserRole.MANAGER, UserRole.ACCOUNTING, UserRole.DRIVER],
  [UserRole.MANAGER]: [],
  [UserRole.ACCOUNTING]: [],
  [UserRole.DRIVER]: [],
};

/**
 * Whose login an actor may stand down by changing employment status (exit, suspend). Managers
 * run the drivers day to day, so they may stand down a driver — and nobody above that.
 */
const STAND_DOWN: Record<UserRole, UserRole[]> = {
  ...MANAGEABLE,
  [UserRole.MANAGER]: [UserRole.DRIVER],
};

export function canAdministerAccounts(role: UserRole): boolean {
  return ACCOUNT_ADMIN_ROLES.includes(role);
}

/** Roles this actor may assign, and whose accounts they may manage. */
export function manageableRoles(role: UserRole): UserRole[] {
  return MANAGEABLE[role];
}

interface Actor {
  id: string;
  role: UserRole;
}

/**
 * Throws unless `actor` may act on `target` (an existing account, or null when creating one),
 * optionally moving it to `nextRole`.
 */
export function assertCanManageAccount(actor: Actor, target: { id: string; role: UserRole } | null, nextRole?: UserRole): void {
  if (!canAdministerAccounts(actor.role)) {
    throw new ForbiddenException('Only administrators can manage sign-in accounts.');
  }
  if (target && target.id === actor.id) {
    throw new ForbiddenException('You cannot change your own account. Ask another administrator.');
  }
  const allowed = manageableRoles(actor.role);
  if (target && !allowed.includes(target.role)) {
    throw new ForbiddenException(`Only a super admin can manage a ${label(target.role)} account.`);
  }
  if (nextRole && !allowed.includes(nextRole)) {
    throw new ForbiddenException(`Only a super admin can give someone the ${label(nextRole)} role.`);
  }
}

/** Whether changing an employee's employment status may also stand down their login. */
export function canStandDownLogin(actorRole: UserRole, targetRole: UserRole): boolean {
  return STAND_DOWN[actorRole].includes(targetRole);
}

/** Account states that may sign in (INVITED only to set a new password). */
export const SIGN_IN_STATUSES: UserStatus[] = [UserStatus.ACTIVE, UserStatus.INVITED];

/** Allowed account-status moves by an administrator. Password changes move INVITED → ACTIVE. */
export const STATUS_ACTIONS = {
  suspend: { from: [UserStatus.INVITED, UserStatus.ACTIVE], to: UserStatus.SUSPENDED },
  disable: { from: [UserStatus.INVITED, UserStatus.ACTIVE, UserStatus.SUSPENDED], to: UserStatus.DISABLED },
  activate: { from: [UserStatus.SUSPENDED, UserStatus.DISABLED] },
} as const;

const label = (role: UserRole) => role.toLowerCase().replace('_', ' ');
