import type { UserRole } from '../../types/domain';
import type { SessionStatus } from '../../lib/auth/session-store';

/**
 * Which app a signed-in person sees. Screens never decide this themselves.
 *
 *   DRIVER                          → the driver app, (tabs) and its driver-only screens
 *   SUPER_ADMIN, ADMIN, MANAGER,
 *   ACCOUNTING                      → the office app under /office, with role-specific modules
 *   temporary password              → the change-password screen, before anything else
 *
 * Purely navigation: the API refuses anything a role may not do, whatever screen is open.
 */

/** Top-level route groups only a driver uses. */
const DRIVER_SEGMENTS = new Set(['(tabs)', 'fuel', 'operation', 'document']);
const CHANGE_PASSWORD = 'change-password';

/** The office app is a real path, not a group: its screens would otherwise clash with the driver's (/, /documents, /profile). */
const OFFICE = 'office';

export const homeFor = (role: UserRole | null): '/(tabs)' | '/office' => (role === 'DRIVER' || role === null ? '/(tabs)' : '/office');

export function routeFor(
  state: { status: SessionStatus; role: UserRole | null; mustChangePassword: boolean },
  segments: string[],
): string | null {
  if (state.status === 'loading') return null;
  const [group, screen] = segments;
  const inAuth = group === '(auth)';

  if (state.status === 'signedOut') return inAuth && screen !== CHANGE_PASSWORD ? null : '/(auth)/login';

  if (state.mustChangePassword) return inAuth && screen === CHANGE_PASSWORD ? null : '/(auth)/change-password';
  if (inAuth) return homeFor(state.role);

  const isDriver = state.role === 'DRIVER' || state.role === null;
  if (isDriver && (group === OFFICE || group === 'admin')) return '/(tabs)';
  if (!isDriver && (group === undefined || DRIVER_SEGMENTS.has(group))) return '/office';
  return null;
}
