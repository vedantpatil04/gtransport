import * as Location from 'expo-location';
import {
  readPermission, requestPermission, toApiPermission, toDisplayStatus,
  type LocationPermissionSnapshot,
} from '../location/permission';

const mocked = Location as jest.Mocked<typeof Location> & {
  hasServicesEnabledAsync: jest.Mock;
  getForegroundPermissionsAsync: jest.Mock;
  getBackgroundPermissionsAsync: jest.Mock;
  requestForegroundPermissionsAsync: jest.Mock;
  requestBackgroundPermissionsAsync: jest.Mock;
};

const permission = (status: string, canAskAgain = true) => ({ status, canAskAgain });

const setDevice = (options: { services?: boolean; foreground?: string; background?: string; canAskAgain?: boolean }) => {
  mocked.hasServicesEnabledAsync.mockResolvedValue(options.services ?? true);
  mocked.getForegroundPermissionsAsync.mockResolvedValue(permission(options.foreground ?? 'granted', options.canAskAgain ?? true));
  mocked.getBackgroundPermissionsAsync.mockResolvedValue(permission(options.background ?? 'granted'));
};

describe('reading the device permission state', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports full permission when the driver has allowed everything', async () => {
    setDevice({ foreground: 'granted', background: 'granted' });
    await expect(readPermission()).resolves.toMatchObject({ stage: 'GRANTED', foreground: 'GRANTED', background: 'GRANTED', servicesEnabled: true });
  });

  it('reports location services being off, even when permission was granted', async () => {
    setDevice({ services: false, foreground: 'granted' });
    const snapshot = await readPermission();

    expect(snapshot.stage).toBe('LOCATION_SERVICES_OFF');
    expect(toDisplayStatus(snapshot)).toBe('LOCATION_DISABLED');
  });

  it('distinguishes a denial that can be asked again from one that cannot', async () => {
    setDevice({ foreground: 'denied', canAskAgain: true });
    await expect(readPermission()).resolves.toMatchObject({ foreground: 'DENIED', canAskAgain: true });

    setDevice({ foreground: 'denied', canAskAgain: false });
    await expect(readPermission()).resolves.toMatchObject({ foreground: 'RESTRICTED', canAskAgain: false });
  });

  it('reports an untouched permission as unknown rather than denied', async () => {
    setDevice({ foreground: 'undetermined' });
    await expect(readPermission()).resolves.toMatchObject({ foreground: 'UNKNOWN' });
  });
});

describe('requesting permission', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks for foreground first, then background, which is the order Android requires', async () => {
    setDevice({ foreground: 'granted', background: 'granted' });
    mocked.requestForegroundPermissionsAsync.mockResolvedValue(permission('granted'));
    mocked.requestBackgroundPermissionsAsync.mockResolvedValue(permission('granted'));

    await requestPermission({ includeBackground: true });

    expect(mocked.requestForegroundPermissionsAsync).toHaveBeenCalled();
    expect(mocked.requestBackgroundPermissionsAsync).toHaveBeenCalled();
    expect(mocked.requestForegroundPermissionsAsync.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.requestBackgroundPermissionsAsync.mock.invocationCallOrder[0] as number,
    );
  });

  it('does not ask for background when foreground was refused', async () => {
    setDevice({ foreground: 'denied' });
    mocked.requestForegroundPermissionsAsync.mockResolvedValue(permission('denied'));

    await requestPermission({ includeBackground: true });
    expect(mocked.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('what gets reported to the office', () => {
  const snapshot = (over: Partial<LocationPermissionSnapshot>): LocationPermissionSnapshot => ({
    stage: 'GRANTED',
    foreground: 'GRANTED',
    background: 'GRANTED',
    servicesEnabled: true,
    canAskAgain: true,
    canAskBackgroundAgain: true,
    ...over,
  });

  it('maps the device state onto the backend vocabulary', () => {
    expect(toApiPermission(snapshot({}))).toBe('GRANTED_ALWAYS');
    expect(toApiPermission(snapshot({ background: 'DENIED' }))).toBe('GRANTED_FOREGROUND');
    expect(toApiPermission(snapshot({ foreground: 'DENIED' }))).toBe('DENIED');
    expect(toApiPermission(snapshot({ foreground: 'UNKNOWN' }))).toBe('UNKNOWN');
  });

  it('never claims tracking is active, because Phase 2 tracks nothing', () => {
    // Even with every permission granted, the honest status is "not being tracked yet".
    expect(toDisplayStatus(snapshot({}))).toBe('OFFLINE');
    expect(toDisplayStatus(snapshot({ foreground: 'DENIED' }))).toBe('PERMISSION_DENIED');
    expect(toDisplayStatus(snapshot({ servicesEnabled: false }))).toBe('LOCATION_DISABLED');
  });
});
