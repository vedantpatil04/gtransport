import { isApiConfigured } from '@/features/api/mode';
import { useSession, type ApiRole } from '@/features/api/session';
import { ADMIN_NAV, MOBILE_NAV, type AdminNavItem, type AdminNavKey } from './nav';

/**
 * Which admin modules each role may open. Mirrors the API's @Roles rules so people are not
 * shown screens that would only answer 403 — the API remains the authority either way.
 *
 * Unlisted modules are open to every office role. Demo mode has no roles, so everything shows.
 */
const PAYROLL: ApiRole[] = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTING'];
const ADMINS: ApiRole[] = ['SUPER_ADMIN', 'ADMIN'];

const MODULE_ROLES: Partial<Record<AdminNavKey, ApiRole[]>> = {
  ledger: PAYROLL,
  salaries: PAYROLL,
  payments: PAYROLL,
  settings: ADMINS,
};

export function canOpenModule(role: ApiRole | undefined, key: AdminNavKey): boolean {
  const allowed = MODULE_ROLES[key];
  return !allowed || Boolean(role && allowed.includes(role));
}

/** The signed-in role in API mode; undefined in demo mode (no restrictions). */
export function useAdminRole(): ApiRole | undefined {
  const role = useSession((s) => s.user?.role);
  return isApiConfigured() ? role : undefined;
}

export function useCanOpen(key: AdminNavKey): boolean {
  const role = useAdminRole();
  return !isApiConfigured() || canOpenModule(role, key);
}

/**
 * The navigation this role may use. A group keeps only the children the role may open, and
 * points at the first of them (a manager's Finance opens on Expenses, not on the Ledger).
 */
export function navFor(role: ApiRole | undefined): AdminNavItem[] {
  if (!isApiConfigured()) return ADMIN_NAV;
  return ADMIN_NAV.flatMap((item) => {
    if (!canOpenModule(role, item.key)) return [];
    if (!item.children) return [item];
    const children = item.children.filter((child) => canOpenModule(role, child.key));
    return children.length ? [{ ...item, to: children[0]!.to, children }] : [];
  });
}

export function useAdminNav(): { items: AdminNavItem[]; mobile: AdminNavKey[] } {
  const role = useAdminRole();
  const items = navFor(role);
  return { items, mobile: MOBILE_NAV.filter((key) => items.some((item) => item.key === key)) };
}
