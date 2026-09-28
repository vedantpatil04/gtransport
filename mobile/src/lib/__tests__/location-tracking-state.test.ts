import { deriveTrackingState, isFixStale, isTrackingHealthy, toDriverFacingState, type TrackingSignals } from '../location/tracking-state';
import type { LocationPermissionSnapshot } from '../location/permission';

/**
 * What the app is allowed to claim about itself.
 *
 * The rule under test, and the one that matters most: tracking is never reported as active because
 * the app asked for permission. It is reported as active when the OS granted it, the device toggle
 * is on, and the background task is genuinely registered.
 */

const permission = (over: Partial<LocationPermissionSnapshot> = {}): LocationPermissionSnapshot => ({
  stage: 'GRANTED',
  foreground: 'GRANTED',
  background: 'GRANTED',
  servicesEnabled: true,
  canAskAgain: true,
  canAskBackgroundAgain: true,
  ...over,
});

const NOW = Date.parse('2026-03-04T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

const signals = (over: Partial<TrackingSignals> = {}): TrackingSignals => ({
  permission: permission(),
  taskRegistered: true,
  paused: false,
  pendingUploads: 0,
  lastFixAt: minutesAgo(1),
  staleAfterMinutes: 15,
  ...over,
});

describe('deriveTrackingState', () => {
  it('reports active tracking only when everything really is in place', () => {
    expect(deriveTrackingState(signals(), NOW)).toBe('TRACKING_ACTIVE');
  });

  it('never claims to be tracking merely because permission was granted', () => {
    // Permission in place, but the OS has not accepted the task: nothing is being captured, and
    // saying "active" here would be the exact lie the office cannot afford.
    expect(deriveTrackingState(signals({ taskRegistered: false }), NOW)).toBe('TRACKING_UNAVAILABLE');
  });

  it('reports the device toggle before anything else, because that is what the driver fixes first', () => {
    expect(deriveTrackingState(signals({ permission: permission({ servicesEnabled: false }) }), NOW)).toBe('LOCATION_SERVICES_DISABLED');
  });

  it('reports a refused permission', () => {
    expect(deriveTrackingState(signals({ permission: permission({ foreground: 'DENIED' }) }), NOW)).toBe('LOCATION_PERMISSION_DENIED');
  });

  it('treats a device-restricted phone as a refusal, since no prompt will help', () => {
    expect(deriveTrackingState(signals({ permission: permission({ foreground: 'RESTRICTED' }) }), NOW)).toBe('LOCATION_PERMISSION_DENIED');
  });

  it('reports a permission never asked for as unavailable rather than denied', () => {
    expect(deriveTrackingState(signals({ permission: permission({ foreground: 'UNKNOWN' }) }), NOW)).toBe('TRACKING_UNAVAILABLE');
  });

  it('reports missing background permission even while the task runs', () => {
    // It runs now, and will stop the moment the driver leaves the screen. The office needs to know.
    expect(deriveTrackingState(signals({ permission: permission({ background: 'DENIED' }) }), NOW)).toBe('BACKGROUND_PERMISSION_MISSING');
  });

  it('reports a deliberate stop as paused, not as a fault', () => {
    expect(deriveTrackingState(signals({ paused: true }), NOW)).toBe('TRACKING_PAUSED');
  });

  it('puts an OS refusal ahead of a pause, because that is the more actionable fact', () => {
    expect(deriveTrackingState(signals({ paused: true, permission: permission({ servicesEnabled: false }) }), NOW)).toBe('LOCATION_SERVICES_DISABLED');
  });

  it('reports a sync backlog when tracking works but uploads do not', () => {
    expect(deriveTrackingState(signals({ pendingUploads: 42 }), NOW)).toBe('SYNC_PENDING');
  });

  it('reports a stale last fix when tracking is registered but producing nothing', () => {
    expect(deriveTrackingState(signals({ lastFixAt: minutesAgo(40) }), NOW)).toBe('LAST_LOCATION_STALE');
  });

  it('does not call a newly started device stale for having no fix yet', () => {
    expect(deriveTrackingState(signals({ lastFixAt: null }), NOW)).toBe('TRACKING_ACTIVE');
  });

  it('puts a backlog ahead of staleness, since the backlog explains it', () => {
    expect(deriveTrackingState(signals({ pendingUploads: 3, lastFixAt: minutesAgo(40) }), NOW)).toBe('SYNC_PENDING');
  });
});

describe('isFixStale', () => {
  it('treats a recent fix as current', () => {
    expect(isFixStale(minutesAgo(3), 15, NOW)).toBe(false);
  });

  it('treats an old fix as stale', () => {
    expect(isFixStale(minutesAgo(20), 15, NOW)).toBe(true);
  });

  it('treats no fix at all as not stale — there is nothing to be out of date', () => {
    expect(isFixStale(null, 15, NOW)).toBe(false);
  });

  it('ignores an unparseable timestamp rather than reporting a false alarm', () => {
    expect(isFixStale('yesterday', 15, NOW)).toBe(false);
  });
});

describe('what the driver is shown', () => {
  it('collapses the office\'s vocabulary into the four things a driver can act on', () => {
    expect(toDriverFacingState('TRACKING_ACTIVE')).toBe('active');
    expect(toDriverFacingState('SYNC_PENDING')).toBe('syncPending');
    expect(toDriverFacingState('LOCATION_SERVICES_DISABLED')).toBe('servicesOff');
    expect(toDriverFacingState('TRACKING_PAUSED')).toBe('paused');
  });

  it('shows both permission problems as the same thing, because the fix is the same', () => {
    expect(toDriverFacingState('LOCATION_PERMISSION_DENIED')).toBe('needsPermission');
    expect(toDriverFacingState('BACKGROUND_PERMISSION_MISSING')).toBe('needsPermission');
  });

  it('shows anything the driver cannot fix as simply unavailable', () => {
    expect(toDriverFacingState('TRACKING_UNAVAILABLE')).toBe('unavailable');
    expect(toDriverFacingState('LAST_LOCATION_STALE')).toBe('unavailable');
  });

  it('counts a backlog as healthy, because positions are being captured', () => {
    expect(isTrackingHealthy('TRACKING_ACTIVE')).toBe(true);
    expect(isTrackingHealthy('SYNC_PENDING')).toBe(true);
    expect(isTrackingHealthy('BACKGROUND_PERMISSION_MISSING')).toBe(false);
    expect(isTrackingHealthy('TRACKING_UNAVAILABLE')).toBe(false);
  });
});
