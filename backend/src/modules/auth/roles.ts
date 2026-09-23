import { UserRole } from '@prisma/client';

/** SUPER_ADMIN is implicitly allowed everywhere; it never needs listing on a route. */
export const OFFICE_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTING];

/** Roles that may create or change employees, drivers, vehicles and assignments. */
export const FLEET_MANAGE_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.MANAGER];

/** Roles that may record loan terms against a vehicle. */
export const FINANCE_MANAGE_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.ACCOUNTING];

/** Roles allowed to see payroll figures (salary, PF) on employee records. */
export const PAYROLL_ROLES: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ACCOUNTING];

export function canSeePayroll(role: UserRole): boolean {
  return PAYROLL_ROLES.includes(role);
}
