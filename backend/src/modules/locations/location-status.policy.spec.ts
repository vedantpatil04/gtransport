import { LocationPermission, LocationStatus } from '@prisma/client';
import { deriveLocationStatus, DEFAULT_STALENESS } from './location-status.policy';

const NOW = new Date('2026-03-04T10:00:00Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

const signals = (overrides: Partial<Parameters<typeof deriveLocationStatus>[0]> = {}) => ({
  permission: LocationPermission.GRANTED_ALWAYS,
  locationServicesEnabled: true,
  lastHeartbeatAt: minutesAgo(1),
  recordedAt: minutesAgo(1),
  ...overrides,
});

describe('deriveLocationStatus', () => {
  it('reports ACTIVE for a recent fix', () => {
    expect(deriveLocationStatus(signals(), NOW)).toBe(LocationStatus.ACTIVE);
  });

  it('reports PERMISSION_DENIED even when fixes are recent', () => {
    expect(deriveLocationStatus(signals({ permission: LocationPermission.DENIED }), NOW)).toBe(LocationStatus.PERMISSION_DENIED);
  });

  it('reports LOCATION_DISABLED when device location services are off', () => {
    expect(deriveLocationStatus(signals({ locationServicesEnabled: false }), NOW)).toBe(LocationStatus.LOCATION_DISABLED);
  });

  it('reports OFFLINE when the heartbeat stops', () => {
    expect(deriveLocationStatus(signals({ lastHeartbeatAt: minutesAgo(31), recordedAt: minutesAgo(31) }), NOW)).toBe(LocationStatus.OFFLINE);
  });

  it('reports STALE when heartbeats continue but fixes do not', () => {
    expect(deriveLocationStatus(signals({ recordedAt: minutesAgo(16) }), NOW)).toBe(LocationStatus.STALE);
  });

  it('treats a never-seen device as OFFLINE', () => {
    expect(deriveLocationStatus(signals({ lastHeartbeatAt: null, recordedAt: null }), NOW)).toBe(LocationStatus.OFFLINE);
  });

  it('honours custom thresholds', () => {
    const tight = { staleAfterMs: 60_000, offlineAfterMs: DEFAULT_STALENESS.offlineAfterMs };
    expect(deriveLocationStatus(signals({ recordedAt: minutesAgo(2) }), NOW, tight)).toBe(LocationStatus.STALE);
  });
});
