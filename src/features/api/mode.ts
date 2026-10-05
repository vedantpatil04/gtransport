import { API_BASE_URL } from '@/lib/api/client';

/**
 * The web app runs in exactly one of two modes, fixed at build time.
 *
 * - real (VITE_API_URL set): real sign-in, real API, real roles. Screens show live data, or
 *   loading/empty/error states — and a screen whose module is not connected yet says so
 *   instead of showing sample data. Every production build is real: .env.production sets the
 *   Render API, so the deployed console (Vercel) can never fall back to sample data.
 * - demo (VITE_API_URL unset): the approved prototype on its local seeded store, exactly as
 *   before. Only the self-contained demo build (`npm run build:demo`) and a dev server started
 *   without an API run this way; it needs no backend.
 */
export const isApiConfigured = (): boolean => API_BASE_URL.length > 0;

/**
 * True whenever an API is configured. Real mode never falls back to demo records: the admin
 * layout only renders screens once a real session exists, and a failed request shows an error
 * state rather than sample data. Without an API the approved prototype runs on demo data.
 */
export function useConnected(): boolean {
  return isApiConfigured();
}
