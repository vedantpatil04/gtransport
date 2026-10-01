import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetApi } from '@/features/api/resources';
import { useSession } from '@/features/api/session';
import { ApiError } from '@/lib/api/client';
import { FakeMap, FakeMarker, currentMap, markerFor } from '@/test/fakeMaplibre';
import { AMIT, GANESH, RAMESH, SURESH, fleetResponse, fleetRow } from '@/test/fleetFixtures';
import { setViewportWidth } from '@/test/viewport';
import { Fleet } from './Fleet';

vi.mock('@/features/api/mode', () => ({ isApiConfigured: () => true, useConnected: () => true }));
vi.mock('@/features/api/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/api/resources')>()),
  fleetApi: { locations: vi.fn(), driverHistory: vi.fn(), acknowledgeAlert: vi.fn() },
}));

const STYLE = 'https://tiles.example.com/styles/basic/style.json';
const locations = vi.mocked(fleetApi.locations);
const driverHistory = vi.mocked(fleetApi.driverHistory);

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function renderFleet(path = '/admin/fleet') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/fleet" element={<Fleet />} />
        <Route path="/admin/drivers/:id" element={<div>driver page</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const search = () => screen.getByTestId('location').textContent;
const ready = () =>
  act(() => {
    currentMap().fire('style.load');
    currentMap().fire('load');
  });
const flush = () => act(async () => vi.advanceTimersByTimeAsync(0));
/** Rows are on screen and React has flushed the effects that put the pins on the map. */
const loaded = async () => {
  await screen.findAllByTestId('fleet-row');
  await act(async () => {});
};
const rowFor = (name: string) => screen.getByText(name).closest('[data-testid="fleet-row"]') as HTMLElement;
const chip = (label: RegExp) => screen.getByRole('button', { name: label });
const dot = (id: string) => markerFor(id).element.children[1] as HTMLElement;

beforeEach(() => {
  vi.stubEnv('VITE_MAP_STYLE_URL', STYLE);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  locations.mockReset().mockResolvedValue(fleetResponse([RAMESH, AMIT, SURESH, GANESH]));
  driverHistory.mockReset().mockResolvedValue({ data: [], page: { limit: 5, nextCursor: null } });
  useSession.setState({
    token: 'test-token',
    expiresAt: null,
    user: { id: 'u1', role: 'SUPER_ADMIN', companyId: 'c1', employeeId: null, driverId: null, status: 'ACTIVE', mustChangePassword: false, displayName: 'Admin', email: 'admin@example.test', phone: null },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Live Fleet on real data', () => {
  it('renders the route: a header, the driver list and a map on the configured style', async () => {
    renderFleet();

    expect(await screen.findByRole('heading', { name: 'Live Fleet' })).toBeTruthy();
    expect((await screen.findAllByTestId('fleet-row')).length).toBe(4);
    expect(FakeMap.instances).toHaveLength(1);
    expect(currentMap().options.style).toBe(STYLE);
  });

  it('says it is the real thing: the legend does not call the positions simulated', async () => {
    renderFleet();
    await loaded();
    expect(screen.getByTestId('fleet-map-legend').textContent).not.toContain('Simulated');
  });

  it('plots every driver who has a position at exactly the coordinates the API gave', async () => {
    renderFleet();
    await loaded();

    expect(markerFor('drv-1').lngLat).toEqual([74.498, 15.85]);
    expect(markerFor('drv-4').lngLat).toEqual([74.243, 16.705]);
    expect(markerFor('drv-2').lngLat).toEqual([74.382, 16.399]);
    expect(FakeMarker.instances).toHaveLength(3);
  });

  it('keeps a driver with no position in the list, with the reason, rather than dropping them', async () => {
    renderFleet();
    const row = await waitForRow('Ganesh Jadhav');
    expect(within(row).getByText('No position reported yet')).toBeTruthy();
    expect(FakeMarker.instances.some((pin) => pin.element.getAttribute('data-testid') === 'fleet-marker-drv-5')).toBe(false);
  });

  it('colours and labels pins from the server’s own judgement, without recomputing it', async () => {
    locations.mockResolvedValue(
      fleetResponse([
        RAMESH,
        fleetRow({ ...AMIT, status: 'STALE', stale: true }),
        fleetRow({ ...SURESH, status: 'OFFLINE' }),
      ]),
    );
    renderFleet();
    await loaded();

    // moving, falling behind (shown amber), not reporting (red)
    expect(dot('drv-1').style.backgroundColor).toBe('rgb(22, 128, 74)');
    expect(dot('drv-4').style.backgroundColor).toBe('rgb(184, 116, 0)');
    expect(dot('drv-2').style.backgroundColor).toBe('rgb(192, 57, 43)');
    expect(markerFor('drv-1').element.getAttribute('aria-label')).toBe('KA 22 AB 1234 · Moving');
  });

  it('rings a vehicle that has stopped too long', async () => {
    locations.mockResolvedValue(
      fleetResponse([
        fleetRow({
          ...SURESH,
          stationarySince: new Date().toISOString(),
          stationaryMinutes: 250,
          alert: { id: 'al1', status: 'ACTIVE', triggeredAt: new Date().toISOString(), stationarySince: new Date().toISOString(), durationMinutes: 250 },
        }),
      ]),
    );
    renderFleet();
    await loaded();

    const ring = markerFor('drv-2').element.children[0] as HTMLElement;
    expect(ring.style.display).toBe('');
    expect(screen.getByTestId('fleet-alert-banner')).toBeTruthy();
  });
});

describe('selecting a driver', () => {
  it('opens their details, with the real coordinates and the accuracy the device reported', async () => {
    renderFleet();
    fireEvent.click(await waitForRow('Suresh Patil'));

    const panel = await screen.findByTestId('fleet-detail');
    expect(within(panel).getByText('Suresh Patil')).toBeTruthy();
    expect(within(panel).getByText(/16\.39900, 74\.38200/)).toBeTruthy();
    expect(within(panel).getByText(/to within 240 m/)).toBeTruthy();
    expect(search()).toBe('?driver=drv-2');
  });

  it('does not dress poor accuracy up as good', async () => {
    renderFleet();
    fireEvent.click(await waitForRow('Suresh Patil'));
    const panel = await screen.findByTestId('fleet-detail');
    expect(panel.textContent?.toLowerCase()).not.toMatch(/accurate|precise/);
  });

  it('highlights the pin on the map', async () => {
    renderFleet();
    fireEvent.click(await waitForRow('Ramesh Kumar'));
    await screen.findByTestId('fleet-detail');
    expect(dot('drv-1').style.transform).toBe('scale(1.2)');
    expect(dot('drv-4').style.transform).toBe('');
  });

  it('works from the map as well: clicking a pin selects that driver', async () => {
    renderFleet();
    await loaded();

    fireEvent.click(markerFor('drv-4').element);

    expect(await screen.findByTestId('fleet-detail')).toBeTruthy();
    expect(search()).toBe('?driver=drv-4');
  });

  it('keeps the chosen filter when a pin is clicked afterwards', async () => {
    // Regression: the old pin handler used the URL parameters from when the pin was created, so
    // selecting after changing a filter quietly dropped the filter.
    renderFleet();
    await loaded();
    fireEvent.click(chip(/^Reporting/));
    expect(search()).toBe('?status=active');

    fireEvent.click(markerFor('drv-1').element);

    expect(new URLSearchParams(search()!).get('status')).toBe('active');
    expect(new URLSearchParams(search()!).get('driver')).toBe('drv-1');
  });

  it('closes cleanly, clearing the selection but leaving the map where it was', async () => {
    renderFleet();
    fireEvent.click(await waitForRow('Ramesh Kumar'));
    const panel = await screen.findByTestId('fleet-detail');

    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));

    expect(screen.queryByTestId('fleet-detail')).toBeNull();
    expect(search()).toBe('');
    expect(FakeMap.instances).toHaveLength(1);
  });
});

describe('Open in Google Maps', () => {
  it.each([
    ['Ramesh Kumar', '15.85,74.498'],
    ['Amit Pawar', '16.705,74.243'],
    ['Suresh Patil', '16.399,74.382'],
  ])('opens %s at their actual coordinates', async (name, coordinates) => {
    renderFleet();
    fireEvent.click(await waitForRow(name));

    const link = (await screen.findByTestId('fleet-open-google-maps')) as HTMLAnchorElement;
    expect(link.href).toBe(`https://www.google.com/maps/search/?api=1&query=${coordinates}`);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('uses the same coordinates as the pin on the map', async () => {
    renderFleet();
    fireEvent.click(await waitForRow('Amit Pawar'));
    const link = (await screen.findByTestId('fleet-open-google-maps')) as HTMLAnchorElement;
    const [lat, lng] = new URL(link.href).searchParams.get('query')!.split(',').map(Number);
    expect(markerFor('drv-4').lngLat).toEqual([lng, lat]);
  });

  it('is not offered for a driver with no position, and the panel says why', async () => {
    renderFleet();
    fireEvent.click(await waitForRow('Ganesh Jadhav'));
    const panel = await screen.findByTestId('fleet-detail');
    expect(screen.queryByTestId('fleet-open-google-maps')).toBeNull();
    expect(within(panel).getAllByText('No position reported yet').length).toBeGreaterThan(0);
  });
});

describe('filters', () => {
  it('still narrow the list, and leave the map and its pins alone', async () => {
    renderFleet();
    await loaded();

    fireEvent.click(chip(/^Not reporting/));
    expect(screen.getAllByTestId('fleet-row')).toHaveLength(1);
    expect(screen.getByText('Ganesh Jadhav')).toBeTruthy();
    expect(search()).toBe('?status=offline');

    fireEvent.click(chip(/^Reporting/));
    expect(screen.getAllByTestId('fleet-row')).toHaveLength(3);

    fireEvent.click(chip(/^All/));
    expect(screen.getAllByTestId('fleet-row')).toHaveLength(4);
    expect(search()).toBe('');

    expect(FakeMap.instances).toHaveLength(1);
    expect(FakeMarker.instances.filter((pin) => !pin.removed)).toHaveLength(3);
  });

  it('say so when nothing matches', async () => {
    renderFleet();
    await loaded();
    fireEvent.click(chip(/^Blocked/));
    expect(await screen.findByTestId('fleet-empty-state')).toBeTruthy();
  });
});

describe('live updates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('moves a pin in place when the next poll reports a new position, without recreating anything', async () => {
    const moved = fleetRow({ ...RAMESH, position: { ...RAMESH.position!, latitude: 16.021, longitude: 74.447 } });
    locations.mockResolvedValueOnce(fleetResponse([RAMESH, AMIT])).mockResolvedValue(fleetResponse([moved, AMIT]));
    renderFleet();
    await flush();
    ready();
    const map = currentMap();
    const element = markerFor('drv-1').element;
    expect(markerFor('drv-1').lngLat).toEqual([74.498, 15.85]);

    await act(async () => vi.advanceTimersByTimeAsync(5_000));

    expect(locations).toHaveBeenCalledTimes(2);
    expect(markerFor('drv-1').lngLat).toEqual([74.447, 16.021]);
    expect(markerFor('drv-1').element).toBe(element);
    expect(FakeMap.instances).toHaveLength(1);
    expect(currentMap()).toBe(map);
    expect(map.removed).toBe(false);
  });

  it('does not reframe or re-centre the map on a poll, so the office keeps their view', async () => {
    const moved = fleetRow({ ...RAMESH, position: { ...RAMESH.position!, latitude: 16.021, longitude: 74.447 } });
    locations.mockResolvedValueOnce(fleetResponse([RAMESH, AMIT])).mockResolvedValue(fleetResponse([moved, AMIT]));
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();
    ready();
    currentMap().projectImpl = () => ({ x: 600, y: 300 });
    const callsBefore = currentMap().calls.length;

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));

    expect(locations.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(currentMap().calls).toHaveLength(callsBefore);
  });

  it('polls at the interval the server asks for, not a hard-coded one', async () => {
    locations.mockResolvedValue(fleetResponse([RAMESH], 12));
    renderFleet();
    await flush();
    expect(locations).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(11_000));
    expect(locations).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(locations).toHaveBeenCalledTimes(2);
  });

  it('adds a pin for a driver who starts reporting, and drops one who disappears', async () => {
    locations.mockResolvedValueOnce(fleetResponse([RAMESH, GANESH])).mockResolvedValue(
      fleetResponse([RAMESH, fleetRow({ ...GANESH, position: { latitude: 15.364, longitude: 75.124, accuracyMeters: 10, speedKmh: 30, headingDeg: 90, altitudeMeters: null }, status: 'ACTIVE' })]),
    );
    renderFleet();
    await flush();
    expect(FakeMarker.instances.filter((pin) => !pin.removed)).toHaveLength(1);

    await act(async () => vi.advanceTimersByTimeAsync(5_000));

    expect(markerFor('drv-5').lngLat).toEqual([75.124, 15.364]);
    expect(FakeMap.instances).toHaveLength(1);
  });
});

describe('when nobody is reporting', () => {
  it('says so on the map once the data is in, and the list agrees', async () => {
    locations.mockResolvedValue(fleetResponse([]));
    renderFleet();
    await screen.findByTestId('fleet-empty-state');
    ready();

    expect(screen.getByText('No drivers are currently reporting location.')).toBeTruthy();
    expect(screen.getByText('No live location reported yet.')).toBeTruthy();
  });

  it('says so when drivers exist but none has a position', async () => {
    locations.mockResolvedValue(fleetResponse([GANESH]));
    renderFleet();
    await loaded();
    ready();
    expect(screen.getByText('No drivers are currently reporting location.')).toBeTruthy();
  });

  it('does not say so while the first response is still on its way', async () => {
    let respond!: (value: ReturnType<typeof fleetResponse>) => void;
    locations.mockReturnValue(new Promise((resolve) => (respond = resolve)));
    renderFleet();
    ready();

    expect(screen.queryByText('No drivers are currently reporting location.')).toBeNull();

    await act(async () => respond(fleetResponse([])));
    expect(screen.getByText('No drivers are currently reporting location.')).toBeTruthy();
  });
});

describe('when the map cannot load', () => {
  const breakMap = () => act(() => currentMap().fire('error', { error: { message: 'Not Found (404)', status: 404, url: STYLE } }));

  it('says so, and the list and every driver’s details still work', async () => {
    renderFleet();
    await loaded();
    breakMap();

    expect(screen.getByText('Map could not be loaded.')).toBeTruthy();
    expect(screen.getAllByTestId('fleet-row')).toHaveLength(4);

    fireEvent.click(rowFor('Suresh Patil'));
    const panel = await screen.findByTestId('fleet-detail');
    expect(within(panel).getByText(/16\.39900, 74\.38200/)).toBeTruthy();
    const link = within(panel).getByTestId('fleet-open-google-maps') as HTMLAnchorElement;
    expect(link.href).toContain('query=16.399,74.382');
  });

  it('offers a retry that brings the map back', async () => {
    renderFleet();
    await loaded();
    breakMap();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    ready();

    expect(screen.queryByText('Map could not be loaded.')).toBeNull();
    expect(FakeMap.instances).toHaveLength(2);
    expect(markerFor('drv-1').map).toBe(currentMap());
  });

  it('is not caused by, and does not hide, a failure to reach the API: that keeps its own message', async () => {
    locations.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.'));
    renderFleet();

    expect(await screen.findByText(/Could not reach the server/)).toBeTruthy();
    // The error replaces the screen: no map is left on it, and the one that was mounted meanwhile is torn down.
    expect(screen.queryByTestId('fleet-map')).toBeNull();
    expect(FakeMap.instances.every((map) => map.removed)).toBe(true);

    locations.mockResolvedValue(fleetResponse([RAMESH]));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByTestId('fleet-row')).length).toBe(1);
    expect(screen.getByTestId('fleet-map')).toBeTruthy();
    expect(FakeMap.instances.filter((map) => !map.removed)).toHaveLength(1);
  });
});

describe('when the map style is not configured', () => {
  it('says so instead of drawing a map, and the list and details carry on', async () => {
    vi.stubEnv('VITE_MAP_STYLE_URL', '');
    renderFleet();

    expect(await screen.findByText('Map configuration is unavailable.')).toBeTruthy();
    expect(FakeMap.instances).toHaveLength(0);

    fireEvent.click(await waitForRow('Amit Pawar'));
    const link = (await screen.findByTestId('fleet-open-google-maps')) as HTMLAnchorElement;
    expect(link.href).toContain('query=16.705,74.243');
  });
});

describe('desktop and mobile', () => {
  it('on a desktop, details sit over the map and the map keeps vehicles clear of them', async () => {
    renderFleet('/admin/fleet?driver=drv-1');
    await screen.findByTestId('fleet-detail');
    ready();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('fleet-map').contains(screen.getByTestId('fleet-detail'))).toBe(false);
    // 12 px offset + 340 px panel + 60 px of ordinary padding.
    expect(currentMap().callsTo('fitBounds')[0]!.args[1]).toMatchObject({ padding: { left: 412 } });
  });

  it('on a phone, details open as a bottom sheet instead, and the map is not padded for a panel', async () => {
    setViewportWidth(375);
    renderFleet('/admin/fleet?driver=drv-1');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('fleet-detail')).toBeTruthy();
    expect(within(dialog).getAllByText('Ramesh Kumar').length).toBeGreaterThan(0);
    ready();
    expect(currentMap().callsTo('fitBounds')[0]!.args[1]).toMatchObject({ padding: { left: 60 } });
  });

  it('on a phone, selecting from the list opens the sheet, and the sheet closes again', async () => {
    setViewportWidth(375);
    renderFleet();
    fireEvent.click(await waitForRow('Amit Pawar'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('fleet-open-google-maps')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(search()).toBe('');
  });

  it('on a tablet, still lays out the same map', async () => {
    setViewportWidth(768);
    renderFleet();
    await loaded();
    expect(FakeMap.instances).toHaveLength(1);
    expect(FakeMarker.instances.filter((pin) => !pin.removed)).toHaveLength(3);
  });
});

async function waitForRow(name: string): Promise<HTMLElement> {
  await loaded();
  return rowFor(name);
}
