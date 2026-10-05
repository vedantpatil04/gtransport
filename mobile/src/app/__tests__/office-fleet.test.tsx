import * as MapLibre from '@maplibre/maplibre-react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { initI18n } from '../../i18n';
import { ApiError } from '../../lib/api/client';
import { officeApi, type OfficeFleetLocation, type OfficeFleetResponse } from '../../lib/api/office';
import { useSession } from '../../lib/auth/session-store';
import type { SessionUser, UserRole } from '../../types/domain';
import OfficeFleet from '../office/fleet';

jest.mock('../../lib/api/office', () => ({
  officeApi: {
    fleet: jest.fn(),
    driverHistory: jest.fn(),
    acknowledgeAlert: jest.fn(),
  },
}));

const api = jest.mocked(officeApi);
const camera = (MapLibre as unknown as { __camera: Record<'fitBounds' | 'easeTo', jest.Mock> }).__camera;

const STYLE_URL = 'https://tiles.example.test/styles/fleet.json';

/** Rows shaped exactly as GET /locations/fleet returns them. Fixture values only — the screen has none of its own. */
function fleetRow(overrides: Partial<OfficeFleetLocation> & Pick<OfficeFleetLocation, 'driverId'>): OfficeFleetLocation {
  return {
    driverCode: `DRV-${overrides.driverId}`,
    employee: { fullName: `Driver ${overrides.driverId}`, employeeCode: `EMP-${overrides.driverId}`, phone: null },
    vehicle: null,
    status: 'ACTIVE',
    trackingState: 'TRACKING_ACTIVE',
    position: null,
    capturedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    stale: false,
    alert: null,
    ...overrides,
  };
}

const moving = fleetRow({
  driverId: 'd1',
  driverCode: 'DRV-001',
  employee: { fullName: 'Anil Jadhav', employeeCode: 'EMP-001', phone: '+919800000001' },
  vehicle: { registrationNumber: 'MH-09-XY-4821', make: 'Tata', model: 'Prima' },
  position: { latitude: 16.69812, longitude: 74.24391, accuracyMeters: 6, speedKmh: 52, headingDeg: 180 },
});

const staleAlerting = fleetRow({
  driverId: 'd2',
  driverCode: 'DRV-002',
  employee: { fullName: 'Suresh Patil', employeeCode: 'EMP-002', phone: '+919800000002' },
  vehicle: { registrationNumber: 'KA-25-MN-0917', make: 'Ashok Leyland', model: 'Boss' },
  status: 'STALE',
  stale: true,
  position: { latitude: 15.36478, longitude: 75.12398, accuracyMeters: 12, speedKmh: 0, headingDeg: null },
  capturedAt: new Date(Date.now() - 3_600_000).toISOString(),
  lastSeenAt: new Date(Date.now() - 600_000).toISOString(),
  alert: {
    id: 'alert-7',
    type: 'STATIONARY_OVERDUE',
    status: 'ACTIVE',
    triggeredAt: new Date().toISOString(),
    stationarySince: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    durationMinutes: 305,
  },
});

/** Has reported in, but never a fix: listed, never drawn. */
const neverLocated = fleetRow({ driverId: 'd3', status: 'OFFLINE', position: null, capturedAt: null });

function response(rows: OfficeFleetLocation[], summary?: OfficeFleetResponse['summary']): OfficeFleetResponse {
  return {
    data: rows,
    summary: summary ?? { total: rows.length, active: 0, stale: 0, offline: 0, unavailable: 0, alerting: 0 },
    refreshSeconds: 30,
  };
}

const user = (role: UserRole): SessionUser => ({
  id: 'u1', role, companyId: 'c1', employeeId: 'e1', driverId: null, status: 'ACTIVE', mustChangePassword: false,
  displayName: 'Office User', email: 'office@example.test', phone: '+919800000099',
});

const signInAs = (role: UserRole) =>
  useSession.setState({ status: 'signedIn', token: 'mock-token', user: user(role), role, driver: null, expiredMessage: false });

const markerCoords = (driverId: string) => screen.getByTestId(`maplibre-marker-driver-${driverId}`).props.lngLat;

async function renderFleet() {
  signInAs('ADMIN');
  await render(<OfficeFleet />);
  await screen.findByTestId('fleet-map');
}

describe('Office Live Fleet', () => {
  let openUrl: jest.SpyInstance;

  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_MAP_STYLE_URL = STYLE_URL;
    api.fleet.mockResolvedValue(response([moving, staleAlerting, neverLocated]));
    api.driverHistory.mockResolvedValue({
      data: [{ id: 'p1', latitude: 15.36478, longitude: 75.12398, capturedAt: new Date().toISOString(), speedKmh: 0, accuracyMeters: 12 }],
      page: { limit: 5, nextCursor: null },
    });
    api.acknowledgeAlert.mockResolvedValue(undefined);
    openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    openUrl.mockRestore();
    delete process.env.EXPO_PUBLIC_MAP_STYLE_URL;
    jest.useRealTimers();
  });

  it('opens the route and loads the authenticated fleet into a native MapLibre map with the configured style', async () => {
    await renderFleet();

    expect(api.fleet).toHaveBeenCalledWith('mock-token', { q: undefined });
    expect(screen.getByTestId('office-fleet')).toBeTruthy();
    expect(screen.getByTestId('fleet-map-view').props.mapStyle).toBe(STYLE_URL);
    expect(screen.getByTestId('fleet-driver-d1')).toBeTruthy();
    expect(screen.getByTestId('fleet-driver-d2')).toBeTruthy();
    expect(screen.getByTestId('fleet-driver-d3')).toBeTruthy();
  });

  it('places each marker at exactly the latitude and longitude the API returned', async () => {
    await renderFleet();

    expect(markerCoords('d1')).toEqual([74.24391, 16.69812]);
    expect(markerCoords('d2')).toEqual([75.12398, 15.36478]);
  });

  it('draws no marker for a driver without coordinates and says the location is unavailable', async () => {
    await renderFleet();

    expect(screen.queryByTestId('maplibre-marker-driver-d3')).toBeNull();
    expect(screen.getByTestId('fleet-driver-no-location-d3')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('fleet-driver-d3'));
    expect(await screen.findByTestId('fleet-detail-location-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('fleet-open-google-maps')).toBeNull();
  });

  it('rejects unusable coordinates rather than drawing them', async () => {
    api.fleet.mockResolvedValue(
      response([
        fleetRow({ driverId: 'zero', position: { latitude: 0, longitude: 0, accuracyMeters: null, speedKmh: null, headingDeg: null } }),
        fleetRow({ driverId: 'range', position: { latitude: 123, longitude: 74, accuracyMeters: null, speedKmh: null, headingDeg: null } }),
        fleetRow({ driverId: 'nan', position: { latitude: Number.NaN, longitude: 74, accuracyMeters: null, speedKmh: null, headingDeg: null } }),
      ]),
    );
    await renderFleet();

    expect(screen.queryAllByTestId(/^maplibre-marker-/)).toHaveLength(0);
    expect(screen.getByTestId('fleet-driver-no-location-zero')).toBeTruthy();
    expect(screen.getByTestId('fleet-driver-no-location-range')).toBeTruthy();
    expect(screen.getByTestId('fleet-driver-no-location-nan')).toBeTruthy();
  });

  it('frames the camera on the real positions when Fleet opens', async () => {
    await renderFleet();

    expect(screen.getByTestId('maplibre-camera').props.initialViewState).toEqual({
      bounds: [74.24391, 15.36478, 75.12398, 16.69812],
      padding: expect.any(Object),
    });
  });

  it('centres on the only driver with a position', async () => {
    api.fleet.mockResolvedValue(response([moving, neverLocated]));
    await renderFleet();

    expect(screen.getByTestId('maplibre-camera').props.initialViewState).toEqual({ center: [74.24391, 16.69812], zoom: expect.any(Number) });
  });

  it('shows the real empty state with no markers, no camera target and no sample data when nobody is reporting', async () => {
    api.fleet.mockResolvedValue(response([]));
    await renderFleet();

    expect(screen.getByText('No drivers reporting')).toBeTruthy();
    expect(screen.queryAllByTestId(/^maplibre-marker-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^fleet-driver-/)).toHaveLength(0);
    expect(screen.getByTestId('maplibre-camera').props.initialViewState).toBeUndefined();
    for (const place of ['Pune', 'Satara', 'Kolhapur', 'Belagavi', 'Hubballi', 'Bengaluru']) {
      expect(screen.queryByText(new RegExp(place))).toBeNull();
    }

    await fireEvent(screen.getByTestId('fleet-map-view'), 'didFinishLoadingStyle');
    expect(within(screen.getByTestId('fleet-map-no-positions')).getByText('No drivers in this view')).toBeTruthy();
  });

  it('says "Location unavailable" on the map when drivers exist but none has a position', async () => {
    api.fleet.mockResolvedValue(response([neverLocated]));
    await renderFleet();
    await fireEvent(screen.getByTestId('fleet-map-view'), 'didFinishLoadingStyle');

    expect(within(screen.getByTestId('fleet-map-no-positions')).getByText('Location unavailable')).toBeTruthy();
    expect(screen.queryAllByTestId(/^maplibre-marker-/)).toHaveLength(0);
  });

  it('shows a loading state, and no map, until the first response arrives', async () => {
    api.fleet.mockReturnValue(new Promise(() => undefined));
    signInAs('ADMIN');
    await render(<OfficeFleet />);

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByTestId('fleet-map')).toBeNull();
    expect(screen.queryAllByTestId(/^maplibre-marker-/)).toHaveLength(0);
  });

  it('shows the API failure with a retry, and no invented drivers in their place', async () => {
    api.fleet.mockRejectedValueOnce(new ApiError('network', 0, 'Network request failed'));
    signInAs('ADMIN');
    await render(<OfficeFleet />);

    expect(await screen.findByTestId('retry')).toBeTruthy();
    expect(screen.queryByTestId('fleet-map')).toBeNull();
    expect(screen.queryAllByTestId(/^fleet-driver-/)).toHaveLength(0);

    await fireEvent.press(screen.getByTestId('retry'));
    expect(await screen.findByTestId('fleet-driver-d1')).toBeTruthy();
    expect(api.fleet).toHaveBeenCalledTimes(2);
  });

  it('searches the server by driver, vehicle or code and re-frames on the results', async () => {
    await renderFleet();
    api.fleet.mockResolvedValue(response([staleAlerting]));

    await fireEvent.changeText(screen.getByTestId('fleet-search-input'), 'KA-25');

    await waitFor(() => expect(api.fleet).toHaveBeenLastCalledWith('mock-token', { q: 'KA-25' }));
    await waitFor(() => expect(screen.queryByTestId('fleet-driver-d1')).toBeNull());
    expect(screen.getByTestId('fleet-driver-d2')).toBeTruthy();
    expect(screen.queryByTestId('maplibre-marker-driver-d1')).toBeNull();
    expect(camera.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [75.12398, 15.36478] }));
  });

  it('counts each filter from the returned rows, and filters the list and the markers alike', async () => {
    // The summary is deliberately wrong: the chips must count the rows actually returned.
    api.fleet.mockResolvedValue(
      response([moving, staleAlerting, neverLocated], { total: 9, active: 9, stale: 9, offline: 9, unavailable: 9, alerting: 9 }),
    );
    await renderFleet();

    // The same words as the office web console's Live Fleet filters.
    expect(screen.getByText('All (3)')).toBeTruthy();
    expect(screen.getByText('Reporting (1)')).toBeTruthy();
    expect(screen.getByText('Falling behind (1)')).toBeTruthy();
    expect(screen.getByText('Not reporting (1)')).toBeTruthy();
    expect(screen.getByText('Stopped too long (1)')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('fleet-filter-stale'));
    expect(screen.queryByTestId('fleet-driver-d1')).toBeNull();
    expect(screen.getByTestId('fleet-driver-d2')).toBeTruthy();
    expect(screen.queryByTestId('maplibre-marker-driver-d1')).toBeNull();
    expect(markerCoords('d2')).toEqual([75.12398, 15.36478]);

    await fireEvent.press(screen.getByTestId('fleet-filter-active'));
    expect(screen.getByTestId('fleet-driver-d1')).toBeTruthy();
    expect(screen.queryByTestId('fleet-driver-d2')).toBeNull();

    await fireEvent.press(screen.getByTestId('fleet-filter-offline'));
    expect(screen.getByTestId('fleet-driver-d3')).toBeTruthy();
    expect(screen.queryAllByTestId(/^maplibre-marker-/)).toHaveLength(0);
  });

  it('shows the same status on the marker, the list row and the detail sheet', async () => {
    await renderFleet();

    expect(screen.getByTestId('fleet-marker-d1').props.accessibilityLabel).toBe('Anil Jadhav, MH-09-XY-4821, Moving');
    expect(screen.getByTestId('fleet-driver-status-d1')).toHaveTextContent(/^Moving · DRV-001 · 52 km\/h$/);
    expect(screen.getByTestId('fleet-marker-d2').props.accessibilityLabel).toBe('Suresh Patil, KA-25-MN-0917, Stopped too long');
    expect(screen.getByTestId('fleet-driver-status-d2')).toHaveTextContent(/^Stopped too long · DRV-002$/);

    await fireEvent.press(screen.getByTestId('maplibre-marker-driver-d2'));
    const detail = await screen.findByTestId('fleet-driver-detail');
    expect(within(detail).getByText('Stopped too long')).toBeTruthy();
  });

  it('opens the driver detail from a marker with real name, vehicle, time and coordinates', async () => {
    await renderFleet();

    await fireEvent.press(screen.getByTestId('maplibre-marker-driver-d1'));
    const detail = await screen.findByTestId('fleet-driver-detail');

    expect(within(detail).getByText('Anil Jadhav')).toBeTruthy();
    expect(within(detail).getByText('MH-09-XY-4821')).toBeTruthy();
    expect(within(detail).getByTestId('fleet-detail-coordinates')).toHaveTextContent('16.69812, 74.24391');
    // A relative time from the fix itself (captured moments ago in this fixture), in the reader's language.
    expect(within(detail).getByTestId('fleet-detail-last-updated')).toHaveTextContent(/^(Just now|\d+ (min|hours?|days?) ago)$/);
    expect(within(detail).getByText('52 km/h')).toBeTruthy();
    await waitFor(() => expect(api.driverHistory).toHaveBeenCalledWith('mock-token', 'd1', { limit: 5 }));
  });

  it('opens Google Maps at the coordinates the API returned', async () => {
    await renderFleet();

    await fireEvent.press(screen.getByTestId('fleet-driver-d2'));
    await fireEvent.press(await screen.findByTestId('fleet-open-google-maps'));

    expect(openUrl).toHaveBeenCalledWith('https://www.google.com/maps/search/?api=1&query=15.36478,75.12398');
  });

  it('calls the driver from the detail sheet', async () => {
    await renderFleet();

    await fireEvent.press(screen.getByTestId('fleet-driver-d1'));
    await fireEvent.press(await screen.findByTestId('fleet-call-driver'));

    expect(openUrl).toHaveBeenCalledWith('tel:+919800000001');
  });

  it('acknowledges the real stationary alert and reloads the fleet', async () => {
    await renderFleet();

    await fireEvent.press(screen.getByTestId('fleet-driver-d2'));
    expect(await screen.findByTestId('fleet-detail-alert')).toHaveTextContent(/5 h 5 min/);
    await fireEvent.press(screen.getByTestId('fleet-acknowledge'));

    expect(api.acknowledgeAlert).toHaveBeenCalledWith('mock-token', 'alert-7', expect.any(String));
    await waitFor(() => expect(api.fleet).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('fleet-driver-detail')).toBeNull();
  });

  it('keeps the sheet open and says so when acknowledging fails', async () => {
    api.acknowledgeAlert.mockRejectedValueOnce(new ApiError('server', 500, 'Server error'));
    await renderFleet();

    await fireEvent.press(screen.getByTestId('fleet-driver-d2'));
    await fireEvent.press(await screen.findByTestId('fleet-acknowledge'));

    expect(await screen.findByTestId('fleet-acknowledge-error')).toBeTruthy();
    expect(screen.getByTestId('fleet-driver-detail')).toBeTruthy();
  });

  it('moves markers, adds and removes drivers on each poll without moving the camera', async () => {
    jest.useFakeTimers();
    await renderFleet();
    await fireEvent(screen.getByTestId('fleet-map-view'), 'didFinishLoadingStyle');
    await fireEvent.press(screen.getByTestId('fleet-driver-d1'));
    camera.fitBounds.mockClear();
    camera.easeTo.mockClear();

    const movedOn = {
      ...moving,
      position: { ...moving.position!, latitude: 16.71234, longitude: 74.25678 },
      capturedAt: new Date(Date.now() + 30_000).toISOString(),
    };
    const newcomer = fleetRow({
      driverId: 'd4',
      vehicle: { registrationNumber: 'MH-10-AB-7788', make: null, model: null },
      position: { latitude: 17.68, longitude: 74.01, accuracyMeters: 9, speedKmh: 0, headingDeg: null },
    });
    api.fleet.mockResolvedValue(response([movedOn, newcomer]));

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    await waitFor(() => expect(markerCoords('d1')).toEqual([74.25678, 16.71234]));
    expect(markerCoords('d4')).toEqual([74.01, 17.68]);
    expect(screen.queryByTestId('maplibre-marker-driver-d2')).toBeNull();
    expect(within(screen.getByTestId('fleet-driver-detail')).getByTestId('fleet-detail-coordinates')).toHaveTextContent('16.71234, 74.25678');
    expect(camera.fitBounds).not.toHaveBeenCalled();
    expect(camera.easeTo).not.toHaveBeenCalled();
  });

  it('re-frames on the visible vehicles from the fit button', async () => {
    await renderFleet();
    await fireEvent.press(screen.getByTestId('fleet-map-fit'));

    expect(camera.fitBounds).toHaveBeenCalledWith([74.24391, 15.36478, 75.12398, 16.69812], expect.objectContaining({ padding: expect.any(Object) }));
  });

  it('says the map is not configured — and keeps the list working — when no style URL is set', async () => {
    delete process.env.EXPO_PUBLIC_MAP_STYLE_URL;
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    signInAs('ADMIN');
    await render(<OfficeFleet />);

    expect(await screen.findByTestId('fleet-map-config-error')).toBeTruthy();
    expect(screen.queryByTestId('fleet-map-view')).toBeNull();
    expect(screen.getByTestId('fleet-driver-d1')).toBeTruthy();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('EXPO_PUBLIC_MAP_STYLE_URL'));
    errorLog.mockRestore();
  });

  it('reports a style that fails to load and retries with a fresh native map', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await renderFleet();
    expect(screen.getByTestId('fleet-map-loading')).toBeTruthy();

    await fireEvent(screen.getByTestId('fleet-map-view'), 'didFailLoadingMap');
    expect(screen.getByTestId('fleet-map-error')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('fleet-map-retry'));
    expect(screen.queryByTestId('fleet-map-error')).toBeNull();
    expect(screen.getByTestId('fleet-map-loading')).toBeTruthy();

    await fireEvent(screen.getByTestId('fleet-map-view'), 'didFinishLoadingStyle');
    expect(screen.queryByTestId('fleet-map-loading')).toBeNull();
    warn.mockRestore();
  });
});
