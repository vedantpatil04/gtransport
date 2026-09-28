import { DriverTrackingState, LocationPermission, LocationStatus } from '@prisma/client';
import { deriveLocationStatus, DEFAULT_STALENESS, isStale, reconcileTrackingState } from './location-status.policy';

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

  it('reports OFFLINE, not STALE, for a phone that checks in but has never sent a position', () => {
    // "Stale" promises a position that has gone out of date. A driver whose whereabouts have never
    // been known has no position to be out of date, and saying otherwise would mislead the office.
    expect(deriveLocationStatus(signals({ recordedAt: null }), NOW)).toBe(LocationStatus.OFFLINE);
  });

  it('does not mark a driver offline over a single missed fix', () => {
    // One interval missed: the fix is a little old, but contact is current. The offline window is
    // deliberately longer than the stale one so a momentary gap is not reported as a lost driver.
    expect(deriveLocationStatus(signals({ recordedAt: minutesAgo(16), lastHeartbeatAt: minutesAgo(1) }), NOW)).toBe(LocationStatus.STALE);
  });

  it('honours custom thresholds', () => {
    const tight = { staleAfterMs: 60_000, offlineAfterMs: DEFAULT_STALENESS.offlineAfterMs };
    expect(deriveLocationStatus(signals({ recordedAt: minutesAgo(2) }), NOW, tight)).toBe(LocationStatus.STALE);
  });
});

describe('deriveLocationStatus — device tracking state', () => {
  it('trusts a recent fix from a device reporting active tracking', () => {
    expect(deriveLocationStatus(signals({ trackingState: DriverTrackingState.TRACKING_ACTIVE }), NOW)).toBe(LocationStatus.ACTIVE);
  });

  it('is unaffected by a report that names no tracking state', () => {
    expect(deriveLocationStatus(signals({ trackingState: null }), NOW)).toBe(LocationStatus.ACTIVE);
    expect(deriveLocationStatus(signals({ trackingState: undefined }), NOW)).toBe(LocationStatus.ACTIVE);
  });

  it('shows a paused app as OFFLINE however recently it checked in', () => {
    // Otherwise an app that keeps reporting while deliberately not tracking would appear on the
    // map as a live vehicle.
    expect(deriveLocationStatus(signals({ trackingState: DriverTrackingState.TRACKING_PAUSED }), NOW)).toBe(LocationStatus.OFFLINE);
  });

  it('shows a device that cannot track as OFFLINE', () => {
    expect(deriveLocationStatus(signals({ trackingState: DriverTrackingState.TRACKING_UNAVAILABLE }), NOW)).toBe(LocationStatus.OFFLINE);
  });

  it('keeps a device reporting a stale last fix as STALE', () => {
    expect(deriveLocationStatus(signals({ trackingState: DriverTrackingState.LAST_LOCATION_STALE }), NOW)).toBe(LocationStatus.STALE);
  });

  it('still shows a live position for a device limited to foreground permission', () => {
    // The limitation matters and is reported separately; it does not erase a position we hold.
    expect(deriveLocationStatus(signals({ trackingState: DriverTrackingState.BACKGROUND_PERMISSION_MISSING }), NOW)).toBe(LocationStatus.ACTIVE);
  });

  it('keeps a device with a sync backlog visible, because its last fix did arrive', () => {
    expect(deriveLocationStatus(signals({ trackingState: DriverTrackingState.SYNC_PENDING }), NOW)).toBe(LocationStatus.ACTIVE);
  });

  it('lets the device-reported denial speak even if the permission field lags behind', () => {
    expect(
      deriveLocationStatus(signals({ trackingState: DriverTrackingState.LOCATION_PERMISSION_DENIED }), NOW),
    ).toBe(LocationStatus.PERMISSION_DENIED);
  });
});

describe('reconcileTrackingState', () => {
  it('keeps an honest report unchanged', () => {
    expect(reconcileTrackingState(DriverTrackingState.TRACKING_ACTIVE, LocationPermission.GRANTED_ALWAYS, true)).toBe(
      DriverTrackingState.TRACKING_ACTIVE,
    );
  });

  it('refuses to believe an app that claims to track with location services off', () => {
    expect(reconcileTrackingState(DriverTrackingState.TRACKING_ACTIVE, LocationPermission.GRANTED_ALWAYS, false)).toBe(
      DriverTrackingState.LOCATION_SERVICES_DISABLED,
    );
  });

  it('refuses to believe an app that claims to track on a denied permission', () => {
    expect(reconcileTrackingState(DriverTrackingState.TRACKING_ACTIVE, LocationPermission.DENIED, true)).toBe(
      DriverTrackingState.LOCATION_PERMISSION_DENIED,
    );
  });

  it('downgrades an active claim to the foreground-only truth', () => {
    // Foreground permission cannot sustain background tracking, whatever the app believes.
    expect(reconcileTrackingState(DriverTrackingState.TRACKING_ACTIVE, LocationPermission.GRANTED_FOREGROUND, true)).toBe(
      DriverTrackingState.BACKGROUND_PERMISSION_MISSING,
    );
  });

  it('cannot be tracking on a permission never granted', () => {
    expect(reconcileTrackingState(DriverTrackingState.TRACKING_ACTIVE, LocationPermission.UNKNOWN, true)).toBe(
      DriverTrackingState.TRACKING_UNAVAILABLE,
    );
  });

  it('keeps a sync backlog reported under full permission', () => {
    expect(reconcileTrackingState(DriverTrackingState.SYNC_PENDING, LocationPermission.GRANTED_ALWAYS, true)).toBe(
      DriverTrackingState.SYNC_PENDING,
    );
  });

  it('keeps a paused report, which is a legitimate thing for the app to say', () => {
    expect(reconcileTrackingState(DriverTrackingState.TRACKING_PAUSED, LocationPermission.GRANTED_ALWAYS, true)).toBe(
      DriverTrackingState.TRACKING_PAUSED,
    );
  });
});

describe('isStale', () => {
  it('treats a driver with no fix at all as stale', () => {
    expect(isStale(null, NOW)).toBe(true);
  });

  it('treats a fresh fix as current', () => {
    expect(isStale(minutesAgo(2), NOW)).toBe(false);
  });

  it('treats a fix past the freshness window as stale', () => {
    expect(isStale(minutesAgo(16), NOW)).toBe(true);
  });

  it('honours a custom window', () => {
    expect(isStale(minutesAgo(2), NOW, { staleAfterMs: 60_000, offlineAfterMs: DEFAULT_STALENESS.offlineAfterMs })).toBe(true);
  });
});
