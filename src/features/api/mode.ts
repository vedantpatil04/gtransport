import { API_BASE_URL } from '@/lib/api/client';
import { useSession } from './session';

/**
 * The prototype runs in two modes.
 *
 * - demo (default): everything comes from the local seeded store, exactly as before. This is
 *   what the Vercel deployment serves, and it needs no backend.
 * - connected: VITE_API_URL points at the Phase 1 API, and the Employees, Drivers and Vehicles
 *   screens read and write real data.
 *
 * Screens for later phases (fuel, payments, documents, reports) stay on demo data in both
 * modes until their own phase connects them.
 */
export const isApiConfigured = (): boolean => API_BASE_URL.length > 0;

/**
 * True when the app should show live data: an API is configured and an office user is
 * signed in. Screens fall back to the prototype's demo behaviour otherwise, so the
 * approved prototype keeps working exactly as before with no backend present.
 */
export function useConnected(): boolean {
  const token = useSession((s) => s.token);
  return isApiConfigured() && Boolean(token);
}
