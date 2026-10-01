import type { ApiFleetLocation, ApiFleetResponse, ApiLocationPing, ApiPingPage } from '@/features/api/types';

/** One driver as GET /locations/fleet returns them: active, moving, with a good fix. */
export function fleetRow(overrides: Partial<ApiFleetLocation> = {}): ApiFleetLocation {
  const now = new Date().toISOString();
  return {
    driverId: 'drv-1',
    driverCode: 'GR-D-101',
    driverStatus: 'ACTIVE',
    employee: { id: 'emp-1', employeeCode: 'GR-E-001', fullName: 'Ramesh Kumar', phone: '+919845012301' },
    vehicle: { id: 'veh-1', registrationNumber: 'KA 22 AB 1234', kind: 'TRUCK' },
    position: { latitude: 15.85, longitude: 74.498, accuracyMeters: 8, speedKmh: 54, headingDeg: 344, altitudeMeters: null },
    status: 'ACTIVE',
    trackingState: 'TRACKING_ACTIVE',
    permission: 'GRANTED_ALWAYS',
    locationServicesEnabled: true,
    pendingUploads: 0,
    batteryPct: 80,
    capturedAt: now,
    receivedAt: now,
    lastSeenAt: now,
    stale: false,
    stationarySince: null,
    stationaryMinutes: null,
    alert: null,
    ...overrides,
  };
}

/** Three drivers a few hours' drive apart: Belagavi, Kolhapur and Nipani. */
export const RAMESH = fleetRow();
export const AMIT = fleetRow({
  driverId: 'drv-4',
  driverCode: 'GR-D-104',
  employee: { id: 'emp-4', employeeCode: 'GR-E-004', fullName: 'Amit Pawar', phone: '+919845012304' },
  vehicle: { id: 'veh-4', registrationNumber: 'KA 22 GH 3456', kind: 'TRUCK' },
  position: { latitude: 16.705, longitude: 74.243, accuracyMeters: 8, speedKmh: 47, headingDeg: 164, altitudeMeters: null },
});
export const SURESH = fleetRow({
  driverId: 'drv-2',
  driverCode: 'GR-D-102',
  employee: { id: 'emp-2', employeeCode: 'GR-E-002', fullName: 'Suresh Patil', phone: null },
  vehicle: { id: 'veh-2', registrationNumber: 'KA 22 CD 5678', kind: 'TRUCK' },
  position: { latitude: 16.399, longitude: 74.382, accuracyMeters: 240, speedKmh: 0, headingDeg: null, altitudeMeters: null },
});

/** A driver the API knows but who has never reported a position. */
export const GANESH = fleetRow({
  driverId: 'drv-5',
  driverCode: 'GR-D-105',
  employee: { id: 'emp-5', employeeCode: 'GR-E-005', fullName: 'Ganesh Jadhav', phone: null },
  vehicle: null,
  position: null,
  status: 'OFFLINE',
  trackingState: 'TRACKING_UNAVAILABLE',
  capturedAt: null,
  receivedAt: null,
  lastSeenAt: null,
});

export function fleetResponse(rows: ApiFleetLocation[], refreshSeconds = 5): ApiFleetResponse {
  return {
    data: rows,
    summary: {
      total: rows.length,
      active: rows.filter((row) => row.status === 'ACTIVE').length,
      stale: rows.filter((row) => row.status === 'STALE').length,
      offline: rows.filter((row) => row.status === 'OFFLINE').length,
      unavailable: rows.filter((row) => row.status === 'PERMISSION_DENIED' || row.status === 'LOCATION_DISABLED').length,
      alerting: rows.filter((row) => row.alert?.status === 'ACTIVE').length,
    },
    refreshSeconds,
    serverTime: new Date().toISOString(),
  };
}

/** One stored fix, as GET /locations/drivers/:id/history returns it. */
export function pingRow(overrides: Partial<ApiLocationPing> = {}): ApiLocationPing {
  const now = new Date().toISOString();
  return {
    id: '1',
    latitude: 15.85,
    longitude: 74.498,
    accuracyMeters: 8,
    speedKmh: 54,
    headingDeg: 344,
    altitudeMeters: null,
    batteryPct: 80,
    provider: 'gps',
    capturedAt: now,
    receivedAt: now,
    vehicleId: 'veh-1',
    ...overrides,
  };
}

/** History as the endpoint serves it: the rows are already in the order the screen should show them. */
export function pingPage(rows: ApiLocationPing[]): ApiPingPage {
  return { data: rows, page: { limit: 5, nextCursor: null } };
}
