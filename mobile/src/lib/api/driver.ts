import type { DriverProfile, LocationPermissionState, LocationStatus, LoginResponse } from '../../types/domain';
import { apiRequest } from './client';

/**
 * Driver-facing endpoints. Every one of these is scoped to the signed-in driver by the
 * server: there is no driver id in any path, so the app cannot ask for someone else's data.
 */
export const driverApi = {
  login: (identifier: string, password: string) =>
    apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: { identifier, password } }),

  me: (token: string) => apiRequest<DriverProfile>('/drivers/me', { token }),

  /**
   * Reports the phone's permission state so the office knows whether tracking can work.
   * Carries no coordinates: real position reporting belongs to the tracking phase.
   */
  reportLocationState: (token: string, body: { permission: LocationPermissionState; status: LocationStatus; locationServicesEnabled: boolean }) =>
    apiRequest<{ status: LocationStatus; permission: LocationPermissionState }>('/drivers/me/location-state', {
      method: 'PATCH',
      token,
      body,
    }),
};
