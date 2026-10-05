import { UserRole } from '@prisma/client';
import { canSeePayroll } from '../auth/roles';

/**
 * Who may see which report — the one table the controller, the exports and the overview all
 * consult, so a figure can never be withheld on screen and leak through a download.
 *
 * It follows the existing permission architecture rather than inventing a new one:
 *  - payroll, payments and the finance ledger stay with PAYROLL roles (admin, accounting), as on
 *    the Finance screens; managers run operations and do not see pay;
 *  - fleet location and document compliance are operational, for the roles that run the fleet;
 *  - fuel, vehicle running costs, expenses, maintenance and tyres are both operational and
 *    accounting concerns, so every office role sees them — as they already do on those screens.
 *
 * SUPER_ADMIN passes everything (as RolesGuard does). DRIVER is in no list: drivers have no
 * admin reporting at all.
 */
export const REPORT_TYPES = [
  'overview',
  'fuel',
  'vehicles',
  'drivers',
  'finance',
  'expenses',
  'maintenance',
  'tyres',
  'compliance',
  'location',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const { ADMIN, MANAGER, ACCOUNTING } = UserRole;
const EVERY_OFFICE_ROLE: UserRole[] = [ADMIN, MANAGER, ACCOUNTING];
const OPERATIONS: UserRole[] = [ADMIN, MANAGER];
const PAYROLL: UserRole[] = [ADMIN, ACCOUNTING];

export const REPORT_ROLES: Record<ReportType, UserRole[]> = {
  overview: EVERY_OFFICE_ROLE,
  fuel: EVERY_OFFICE_ROLE,
  vehicles: EVERY_OFFICE_ROLE,
  drivers: EVERY_OFFICE_ROLE,
  finance: PAYROLL,
  expenses: EVERY_OFFICE_ROLE,
  maintenance: EVERY_OFFICE_ROLE,
  tyres: EVERY_OFFICE_ROLE,
  compliance: OPERATIONS,
  location: OPERATIONS,
};

export function canViewReport(role: UserRole, type: ReportType): boolean {
  return role === UserRole.SUPER_ADMIN || REPORT_ROLES[type].includes(role);
}

export function reportsFor(role: UserRole): ReportType[] {
  return REPORT_TYPES.filter((type) => canViewReport(role, type));
}

/**
 * Field-level rules inside reports that several roles share. A section the role may not see is
 * left out of the response entirely — not sent as zero — so the screen hides it instead of
 * showing a figure that looks like "nothing".
 */
export const reportVisibility = (role: UserRole) => ({
  /** Salary, advances and payment status: payroll roles only. */
  payments: canSeePayroll(role),
  /** Document expiry and missing documents. */
  compliance: canViewReport(role, 'compliance'),
  /** Tracking status, last location and stationary alerts. */
  location: canViewReport(role, 'location'),
});
