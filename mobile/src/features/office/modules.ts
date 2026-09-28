import type { Href } from 'expo-router';
import type { OfficeRole, UserRole } from '../../types/domain';

/**
 * The office app's modules for each role, in the order that role uses them most. Mirrors the
 * API's rules (payroll is ADMIN, SUPER_ADMIN and ACCOUNTING only) so nobody is shown a screen
 * that would only answer 403 — the API stays the authority.
 */
export type OfficeModule = 'dashboard' | 'finance' | 'vehicles' | 'fuel' | 'documents' | 'employees' | 'profile';

const MODULES: Record<OfficeRole, OfficeModule[]> = {
  SUPER_ADMIN: ['dashboard', 'vehicles', 'fuel', 'finance', 'employees', 'documents', 'profile'],
  ADMIN: ['dashboard', 'vehicles', 'fuel', 'finance', 'employees', 'documents', 'profile'],
  MANAGER: ['dashboard', 'vehicles', 'fuel', 'documents', 'employees', 'profile'],
  ACCOUNTING: ['dashboard', 'finance', 'fuel', 'vehicles', 'employees', 'documents', 'profile'],
};

/** Up to four modules on the tab bar; the rest (and Profile) under More. */
const TAB_SLOTS = 4;

export const isOfficeRole = (role: UserRole | null | undefined): role is OfficeRole => Boolean(role && role !== 'DRIVER');

export function modulesFor(role: UserRole | null | undefined): OfficeModule[] {
  return isOfficeRole(role) ? MODULES[role] : [];
}

export function canOpen(role: UserRole | null | undefined, module: OfficeModule): boolean {
  return modulesFor(role).includes(module);
}

export function tabsFor(role: UserRole | null | undefined): OfficeModule[] {
  return modulesFor(role).filter((m) => m !== 'profile').slice(0, TAB_SLOTS);
}

export function moreFor(role: UserRole | null | undefined): OfficeModule[] {
  const tabs = tabsFor(role);
  return modulesFor(role).filter((m) => !tabs.includes(m));
}

/** Payroll figures (salaries, payments) — the same roles the API allows. */
export const seesPayroll = (role: UserRole | null | undefined): boolean => role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'ACCOUNTING';

/**
 * Path of a module's screen. Typed as a plain string cast: Expo Router's generated route types
 * (.expo/types, not committed) only learn new files after `expo start`, and a typecheck must not
 * depend on that having run.
 */
export function officePath(module: OfficeModule | 'more'): Href {
  return (module === 'dashboard' ? '/office' : `/office/${module}`) as Href;
}
