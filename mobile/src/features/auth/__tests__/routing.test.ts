import { homeFor, routeFor } from '../routing';
import type { UserRole } from '../../../types/domain';

const signedIn = (role: UserRole | null, mustChangePassword = false) => ({ status: 'signedIn' as const, role, mustChangePassword });

describe('role-aware routing', () => {
  it('waits while the session is still loading', () => {
    expect(routeFor({ status: 'loading', role: null, mustChangePassword: false }, [])).toBeNull();
  });

  it('sends a signed-out person to login from anywhere, including the office app', () => {
    const out = { status: 'signedOut' as const, role: null, mustChangePassword: false };
    expect(routeFor(out, ['(tabs)'])).toBe('/(auth)/login');
    expect(routeFor(out, ['office', 'finance'])).toBe('/(auth)/login');
    expect(routeFor(out, ['(auth)', 'change-password'])).toBe('/(auth)/login');
    expect(routeFor(out, ['(auth)', 'login'])).toBeNull();
  });

  it('opens the driver app for a driver, exactly as before', () => {
    expect(homeFor('DRIVER')).toBe('/(tabs)');
    expect(routeFor(signedIn('DRIVER'), ['(auth)', 'login'])).toBe('/(tabs)');
    expect(routeFor(signedIn('DRIVER'), ['(tabs)'])).toBeNull();
    expect(routeFor(signedIn('DRIVER'), ['fuel', 'new'])).toBeNull();
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTING'] as const)('opens the office console (the Vercel site) for %s after login', (role) => {
    expect(homeFor(role)).toBe('/console');
    expect(routeFor(signedIn(role), ['(auth)', 'login'])).toBe('/console');
    expect(routeFor(signedIn(role), ['console'])).toBeNull();
  });

  it('never opens the office console for a driver', () => {
    for (const group of ['console', 'office', 'admin', 'unsupported-role']) {
      expect(routeFor(signedIn('DRIVER'), [group])).toBe('/(tabs)');
    }
    expect(routeFor(signedIn('DRIVER'), ['office', 'finance'])).toBe('/(tabs)');
  });

  it('keeps office staff in the console: no driver screens, no older native office screens', () => {
    for (const group of ['(tabs)', 'fuel', 'operation', 'document', 'office', 'admin', 'unsupported-role']) {
      expect(routeFor(signedIn('ACCOUNTING'), [group])).toBe('/console');
    }
    expect(routeFor(signedIn('MANAGER'), [])).toBe('/console');
  });

  it('guesses nothing for a role the app does not know', () => {
    const unknown = signedIn('AUDITOR' as UserRole);
    expect(homeFor('AUDITOR' as UserRole)).toBe('/unsupported-role');
    expect(routeFor(unknown, ['(auth)', 'login'])).toBe('/unsupported-role');
    for (const group of ['(tabs)', 'console', 'office', 'fuel']) expect(routeFor(unknown, [group])).toBe('/unsupported-role');
    expect(routeFor(unknown, ['unsupported-role'])).toBeNull();
  });

  it('sends anyone on a temporary password to change it before anything else', () => {
    expect(routeFor(signedIn('DRIVER', true), ['(tabs)'])).toBe('/(auth)/change-password');
    expect(routeFor(signedIn('ADMIN', true), ['console'])).toBe('/(auth)/change-password');
    expect(routeFor(signedIn('ADMIN', true), ['(auth)', 'login'])).toBe('/(auth)/change-password');
    expect(routeFor(signedIn('ADMIN', true), ['(auth)', 'change-password'])).toBeNull();
  });

  it('opens the driver app when the role is not yet known offline, never the office console', () => {
    expect(routeFor(signedIn(null), ['(auth)', 'login'])).toBe('/(tabs)');
    expect(routeFor(signedIn(null), ['console'])).toBe('/(tabs)');
  });
});
