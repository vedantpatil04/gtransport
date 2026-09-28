import type {
  DriverTrackingState, LocationFixPayload, LocationPermissionState, Page, SubmitLocationsResponse,
  TrackingPolicy, TrackingStateResponse,
} from '../../types/domain';
import { apiRequest } from './client';

/**
 * Location endpoints.
 *
 * Every one is scoped to the signed-in driver by the server: no path or body carries a driver or
 * vehicle id, so the app has nothing to get wrong and nothing an attacker could tamper with.
 */

export interface StoredFix {
  id: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  speedKmh: number | null;
  headingDeg: number | null;
  altitudeMeters: number | null;
  batteryPct: number | null;
  provider: string | null;
  capturedAt: string;
  receivedAt: string;
  vehicleId: string | null;
}

export const locationsApi = {
  /**
   * Uploads a batch of captured fixes.
   *
   * `retries: 0` on purpose. The submission ids make a retry safe on the server, but the buffer is
   * the right place to decide when to try again — it knows what is still outstanding, and the
   * client's blind exponential retry would fight the scheduler for the radio.
   */
  submit: (
    token: string,
    body: { fixes: LocationFixPayload[]; pendingUploads?: number; trackingState?: DriverTrackingState },
  ) => apiRequest<SubmitLocationsResponse>('/locations', { method: 'POST', token, body, retries: 0 }),

  /** How often and how far apart to report. Read at sign-in, then cached. */
  trackingPolicy: (token: string) => apiRequest<TrackingPolicy>('/locations/tracking-policy', { token }),

  /** Reports what this device's tracking is doing, and returns the policy to follow. */
  reportState: (
    token: string,
    body: {
      permission: LocationPermissionState;
      locationServicesEnabled: boolean;
      trackingState?: DriverTrackingState;
      pendingUploads?: number;
      lastFixAt?: string;
    },
  ) => apiRequest<TrackingStateResponse>('/drivers/me/location-state', { method: 'PATCH', token, body }),

  /** The driver's own recent fixes — their own data, and nothing else. */
  mine: (token: string, query: { limit?: number; cursor?: string } = {}) => {
    const params = new URLSearchParams();
    if (query.limit) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    const qs = params.toString();
    return apiRequest<Page<StoredFix>>(`/locations/mine${qs ? `?${qs}` : ''}`, { token });
  },
};
