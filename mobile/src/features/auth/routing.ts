import type { UserRole } from '../../types/domain';
import type { SessionStatus } from '../../lib/auth/session-store';

/**
 * Which app a signed-in person sees. Screens never decide this themselves.
 *
 *   DRIVER                          → the driver app, (tabs) and its driver-only screens
 *   SUPER_ADMIN, ADMIN, MANAGER,
 *   ACCOUNTING                      → the office console (the Vercel site) under /console
 *   any other role                  → /unsupported-role: nothing is guessed, only sign-out
 *   temporary password              → the change-password screen, before anything else
 *
 * Purely navigation: the API refuses anything a role may not do, whatever screen is open.
 */

/** Top-level route groups only a driver uses. */
const DRIVER_SEGMENTS = new Set(['(tabs)', 'fuel', 'operation', 'document']);
const CHANGE_PASSWORD = 'change-password';

/** The office console: the production web console in a WebView. */
const CONSOLE = 'console';
const UNSUPPORTED = 'unsupported-role';

const OFFICE_ROLES = new Set<string>(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTING']);

export type Home = '/(tabs)' | '/console' | '/unsupported-role';

/**
 * A role not yet known (offline, before any role was ever stored) opens the driver app, as it
 * always has: those sessions belonged to drivers, and the driver app holds nothing of the office.
 */
export function homeFor(role: UserRole | null): Home {
  if (role === 'DRIVER' || role === null) return '/(tabs)';
  if (OFFICE_ROLES.has(role)) return '/console';
  return '/unsupported-role';
}

export function routeFor(
  state: { status: SessionStatus; role: UserRole | null; mustChangePassword: boolean },
  segments: string[],
): string | null {
  if (state.status === 'loading') return null;
  const [group, screen] = segments;
  const inAuth = group === '(auth)';

  if (state.status === 'signedOut') return inAuth && screen !== CHANGE_PASSWORD ? null : '/(auth)/login';

  if (state.mustChangePassword) return inAuth && screen === CHANGE_PASSWORD ? null : '/(auth)/change-password';

  const home = homeFor(state.role);
  if (inAuth) return home;

  if (home === '/(tabs)') return group === undefined || DRIVER_SEGMENTS.has(group) ? null : '/(tabs)';
  if (home === '/console') return group === CONSOLE ? null : '/console';
  return group === UNSUPPORTED ? null : '/unsupported-role';
}
