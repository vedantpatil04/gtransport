import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetApi } from '@/features/api/resources';
import { useSession } from '@/features/api/session';
import type { ApiFleetLocation, ApiPingPage } from '@/features/api/types';
import { ApiError } from '@/lib/api/client';
import { FakeMap, currentMap, markerFor } from '@/test/fakeMaplibre';
import { AMIT, RAMESH, fleetResponse, fleetRow, pingPage, pingRow } from '@/test/fleetFixtures';
import { setViewportWidth } from '@/test/viewport';
import { Fleet } from './Fleet';

/**
 * The driver panel is one picture of one driver: where they are, how fresh that is, what state
 * the server says they are in, and the last few positions that led there. These tests hold the
 * pieces to the same data — the live row from the fleet poll and the recent positions from the
 * history endpoint — across a refresh, a change of driver, and a failure.
 */

vi.mock('@/features/api/mode', () => ({ isApiConfigured: () => true, useConnected: () => true }));
vi.mock('@/features/api/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/api/resources')>()),
  fleetApi: { locations: vi.fn(), driverHistory: vi.fn(), acknowledgeAlert: vi.fn() },
}));

const STYLE = 'https://tiles.example.com/styles/basic/style.json';
const locations = vi.mocked(fleetApi.locations);
const driverHistory = vi.mocked(fleetApi.driverHistory);

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Ramesh as the fleet endpoint reports him: last position `fixAge` minutes old, last heard from `seenAge` minutes ago. */
const rameshAt = (fixAge: number, latitude: number, longitude: number, seenAge = fixAge, overrides: Partial<ApiFleetLocation> = {}): ApiFleetLocation =>
  fleetRow({
    ...RAMESH,
    position: { ...RAMESH.position!, latitude, longitude },
    capturedAt: minutesAgo(fixAge),
    receivedAt: minutesAgo(fixAge),
    lastSeenAt: minutesAgo(seenAge),
    ...overrides,
  });

const fix = (id: number, age: number, latitude: number, longitude: number) =>
  pingRow({ id: String(id), latitude, longitude, capturedAt: minutesAgo(age), receivedAt: minutesAgo(age) });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Changes the selected driver the way the browser's back button would: without going through the panel. */
function JumpToAmit() {
  const navigate = useNavigate();
  return <button type="button" data-testid="jump-to-amit" onClick={() => navigate('/admin/fleet?driver=drv-4', { replace: true })} />;
}

function renderFleet(path = '/admin/fleet') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/fleet" element={<Fleet />} />
      </Routes>
      <JumpToAmit />
    </MemoryRouter>,
  );
}

// ── What the panel shows, read the way the office reads it ──
const panel = () => screen.getByTestId('fleet-detail');
const lastUpdated = () => within(panel()).getByText('Last updated').nextElementSibling!.textContent;
const lastSeen = () => within(panel()).getByText(/^Last seen /).textContent;
const currentCoords = () => within(panel()).getByText(/\d+\.\d{5}, \d+\.\d{5}/).textContent!.match(/\d+\.\d{5}, \d+\.\d{5}/)![0];
const recent = () =>
  within(screen.getByTestId('fleet-history'))
    .getAllByRole('listitem')
    .map((item) => {
      const [coords, age] = Array.from(item.querySelectorAll('span')).map((span) => span.textContent);
      return { coords, age };
    });
const heading = () => within(panel()).getByText(/Ramesh Kumar|Amit Pawar/).textContent;

const flush = () => act(async () => vi.advanceTimersByTimeAsync(0));
const poll = (seconds = 5) => act(async () => vi.advanceTimersByTimeAsync(seconds * 1_000));
const ready = () =>
  act(() => {
    currentMap().fire('style.load');
    currentMap().fire('load');
  });
const rowFor = (name: string) => screen.getByText(name).closest('[data-testid="fleet-row"]') as HTMLElement;

beforeEach(() => {
  vi.stubEnv('VITE_MAP_STYLE_URL', STYLE);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  locations.mockReset();
  driverHistory.mockReset();
  useSession.setState({
    token: 'test-token',
    expiresAt: null,
    user: { id: 'u1', role: 'SUPER_ADMIN', companyId: 'c1', employeeId: null, driverId: null, status: 'ACTIVE', mustChangePassword: false, displayName: 'Admin', email: 'admin@example.test', phone: null },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recent positions and the rest of the panel describe the same driver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    locations.mockResolvedValue(fleetResponse([rameshAt(7, 15.85, 74.498, 1)]));
    driverHistory.mockResolvedValue(pingPage([fix(3, 7, 15.85, 74.498), fix(2, 20, 15.8, 74.49), fix(1, 40, 15.7, 74.48)]));
  });

  it('starts with the position the panel calls current, and lists the rest newest first', async () => {
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();

    expect(currentCoords()).toBe('15.85000, 74.49800');
    expect(recent().map((r) => r.coords)).toEqual(['15.8500, 74.4980', '15.8000, 74.4900', '15.7000, 74.4800']);
    expect(recent().map((r) => r.age)).toEqual(['7 min ago', '20 min ago', '40 min ago']);
  });

  it('shows the same age for the newest position as for Last updated', async () => {
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();

    expect(lastUpdated()).toBe('7 min ago');
    expect(recent()[0]!.age).toBe(lastUpdated());
  });

  it('keeps Last seen apart from both: it is the last contact, which can be newer than the last position', async () => {
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();

    expect(lastSeen()).toBe('Last seen 1 min ago');
    expect(lastUpdated()).toBe('7 min ago');
  });

  it('leaves the server’s status and the stationary time exactly as the server gave them', async () => {
    locations.mockResolvedValue(
      fleetResponse([rameshAt(7, 15.85, 74.498, 1, { status: 'STALE', stale: true, stationarySince: minutesAgo(35), stationaryMinutes: 35 })]),
    );
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();

    expect(within(panel()).getByText('Falling behind')).toBeTruthy();
    expect(within(panel()).getByText(/Stopped for 35 minutes/)).toBeTruthy();
  });

  it('puts the same coordinates on the map pin', async () => {
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();
    expect(markerFor('drv-1').lngLat).toEqual([74.498, 15.85]);
  });
});

describe('when the driver is heard from again', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('updates the position, the details and the list together, without recreating the map', async () => {
    locations.mockResolvedValueOnce(fleetResponse([rameshAt(1, 15.85, 74.498)])).mockResolvedValue(fleetResponse([rameshAt(0, 15.9, 74.5)]));
    driverHistory
      .mockResolvedValueOnce(pingPage([fix(2, 1, 15.85, 74.498), fix(1, 30, 15.8, 74.49)]))
      .mockResolvedValue(pingPage([fix(3, 0, 15.9, 74.5), fix(2, 1, 15.85, 74.498), fix(1, 30, 15.8, 74.49)]));
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();
    ready();
    const map = currentMap();
    expect(currentCoords()).toBe('15.85000, 74.49800');
    expect(recent()[0]!.coords).toBe('15.8500, 74.4980');

    await poll();

    // One picture: the details, the pin and the first recent position all name the new fix.
    expect(currentCoords()).toBe('15.90000, 74.50000');
    expect(recent().map((r) => r.coords)).toEqual(['15.9000, 74.5000', '15.8500, 74.4980', '15.8000, 74.4900']);
    expect(recent()[0]!.age).toBe(lastUpdated());
    expect(markerFor('drv-1').lngLat).toEqual([74.5, 15.9]);
    expect(currentMap()).toBe(map);
    expect(map.removed).toBe(false);
    expect(FakeMap.instances).toHaveLength(1);
    expect(locations).toHaveBeenCalledTimes(2);
    expect(driverHistory).toHaveBeenCalledTimes(2);
  });

  it('asks for the list again only when the driver has been heard from, not on every poll', async () => {
    const unchanged = rameshAt(7, 15.85, 74.498, 2);
    const heardFromAgain = rameshAt(0, 15.9, 74.5, 0);
    locations
      .mockResolvedValueOnce(fleetResponse([unchanged]))
      .mockResolvedValueOnce(fleetResponse([unchanged]))
      .mockResolvedValueOnce(fleetResponse([unchanged]))
      .mockResolvedValue(fleetResponse([heardFromAgain]));
    driverHistory.mockResolvedValue(pingPage([fix(1, 7, 15.85, 74.498)]));
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();
    expect(driverHistory).toHaveBeenCalledTimes(1);

    await poll();
    await poll();
    // Three polls so far, and the driver has said nothing: no further history requests.
    expect(locations).toHaveBeenCalledTimes(3);
    expect(driverHistory).toHaveBeenCalledTimes(1);

    await poll();
    expect(locations).toHaveBeenCalledTimes(4);
    expect(driverHistory).toHaveBeenCalledTimes(2);
  });

  it('also refreshes after contact that brought no newer position, such as an offline backlog being uploaded', async () => {
    const newest = minutesAgo(1);
    const before = rameshAt(1, 15.85, 74.498, 1, { capturedAt: newest, receivedAt: newest });
    // Same newest fix; the phone has been heard from since, and older fixes now sit behind it.
    const after = rameshAt(1, 15.85, 74.498, 0, { capturedAt: newest, receivedAt: newest });
    locations.mockResolvedValueOnce(fleetResponse([before])).mockResolvedValue(fleetResponse([after]));
    driverHistory
      .mockResolvedValueOnce(pingPage([fix(1, 1, 15.85, 74.498)]))
      .mockResolvedValue(pingPage([fix(1, 1, 15.85, 74.498), fix(3, 6, 15.8, 74.49), fix(2, 9, 15.7, 74.48)]));
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();
    expect(recent()).toHaveLength(1);

    await poll();

    expect(recent().map((r) => r.coords)).toEqual(['15.8500, 74.4980', '15.8000, 74.4900', '15.7000, 74.4800']);
    // The current position did not move, and the list still starts with it.
    expect(currentCoords()).toBe('15.85000, 74.49800');
  });

  it('keeps the list on screen while it refreshes, rather than flashing a loading state', async () => {
    const refresh = deferred<ApiPingPage>();
    locations.mockResolvedValueOnce(fleetResponse([rameshAt(1, 15.85, 74.498)])).mockResolvedValue(fleetResponse([rameshAt(0, 15.9, 74.5)]));
    driverHistory.mockResolvedValueOnce(pingPage([fix(1, 1, 15.85, 74.498)])).mockReturnValueOnce(refresh.promise);
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();

    await poll();

    // The new fix is known and the new list is on its way: the old list stays rather than blinking away.
    expect(currentCoords()).toBe('15.90000, 74.50000');
    expect(recent().map((r) => r.coords)).toEqual(['15.8500, 74.4980']);
    expect(within(panel()).queryByText('Loading…')).toBeNull();

    await act(async () => refresh.resolve(pingPage([fix(2, 0, 15.9, 74.5), fix(1, 1, 15.85, 74.498)])));
    expect(recent().map((r) => r.coords)).toEqual(['15.9000, 74.5000', '15.8500, 74.4980']);
  });

  it('keeps the last list and says so when a refresh fails', async () => {
    locations.mockResolvedValueOnce(fleetResponse([rameshAt(1, 15.85, 74.498)])).mockResolvedValue(fleetResponse([rameshAt(0, 15.9, 74.5)]));
    driverHistory
      .mockResolvedValueOnce(pingPage([fix(1, 1, 15.85, 74.498)]))
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.'));
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();

    await poll();

    expect(within(panel()).getByText('Recent positions could not be loaded.')).toBeTruthy();
    expect(recent().map((r) => r.coords)).toEqual(['15.8500, 74.4980']);
    // The details themselves are the live ones; only the list is behind, and it says so.
    expect(currentCoords()).toBe('15.90000, 74.50000');
  });

  it('does the same in the phone’s bottom sheet', async () => {
    setViewportWidth(375);
    locations.mockResolvedValueOnce(fleetResponse([rameshAt(1, 15.85, 74.498)])).mockResolvedValue(fleetResponse([rameshAt(0, 15.9, 74.5)]));
    driverHistory
      .mockResolvedValueOnce(pingPage([fix(1, 1, 15.85, 74.498)]))
      .mockResolvedValue(pingPage([fix(2, 0, 15.9, 74.5), fix(1, 1, 15.85, 74.498)]));
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();
    expect(within(screen.getByRole('dialog')).getByTestId('fleet-detail')).toBeTruthy();

    await poll();

    expect(currentCoords()).toBe('15.90000, 74.50000');
    expect(recent().map((r) => r.coords)).toEqual(['15.9000, 74.5000', '15.8500, 74.4980']);
  });
});

describe('switching drivers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    locations.mockResolvedValue(fleetResponse([rameshAt(1, 15.85, 74.498), fleetRow({ ...AMIT, capturedAt: minutesAgo(2), lastSeenAt: minutesAgo(2) })]));
  });

  it('never shows the previous driver’s positions under the new driver', async () => {
    const amitsList = deferred<ApiPingPage>();
    driverHistory.mockImplementation((driverId) =>
      driverId === 'drv-1' ? Promise.resolve(pingPage([fix(1, 1, 15.85, 74.498)])) : amitsList.promise,
    );
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();
    expect(heading()).toBe('Ramesh Kumar');
    expect(recent().map((r) => r.coords)).toEqual(['15.8500, 74.4980']);

    fireEvent.click(rowFor('Amit Pawar'));
    await flush();

    // Amit's list has not arrived. His panel must not borrow Ramesh's.
    expect(heading()).toBe('Amit Pawar');
    expect(within(panel()).queryByText('15.8500, 74.4980')).toBeNull();
    expect(within(panel()).getByText('Loading…')).toBeTruthy();

    await act(async () => amitsList.resolve(pingPage([fix(9, 2, 16.705, 74.243)])));
    expect(recent().map((r) => r.coords)).toEqual(['16.7050, 74.2430']);
  });

  it('ignores a slow answer for a driver who is no longer selected', async () => {
    const rameshsList = deferred<ApiPingPage>();
    driverHistory.mockImplementation((driverId) =>
      driverId === 'drv-1' ? rameshsList.promise : Promise.resolve(pingPage([fix(9, 2, 16.705, 74.243)])),
    );
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();

    fireEvent.click(rowFor('Amit Pawar'));
    await flush();
    expect(recent().map((r) => r.coords)).toEqual(['16.7050, 74.2430']);

    // Ramesh's answer finally arrives, for a panel that has moved on.
    await act(async () => rameshsList.resolve(pingPage([fix(1, 1, 15.85, 74.498)])));

    expect(heading()).toBe('Amit Pawar');
    expect(recent().map((r) => r.coords)).toEqual(['16.7050, 74.2430']);
    expect(within(panel()).queryByText('15.8500, 74.4980')).toBeNull();
  });

  it('on a phone, a change of driver while the sheet is open does not carry the old list over', async () => {
    setViewportWidth(375);
    const amitsList = deferred<ApiPingPage>();
    driverHistory.mockImplementation((driverId) =>
      driverId === 'drv-1' ? Promise.resolve(pingPage([fix(1, 1, 15.85, 74.498)])) : amitsList.promise,
    );
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();
    expect(recent().map((r) => r.coords)).toEqual(['15.8500, 74.4980']);

    fireEvent.click(screen.getByTestId('jump-to-amit'));
    await flush();

    expect(heading()).toBe('Amit Pawar');
    expect(within(panel()).queryByText('15.8500, 74.4980')).toBeNull();
    expect(within(panel()).getByText('Loading…')).toBeTruthy();

    await act(async () => amitsList.resolve(pingPage([fix(9, 2, 16.705, 74.243)])));
    expect(recent().map((r) => r.coords)).toEqual(['16.7050, 74.2430']);
  });

  it('gives each driver their own list when going back and forth', async () => {
    driverHistory.mockImplementation((driverId) =>
      Promise.resolve(driverId === 'drv-1' ? pingPage([fix(1, 1, 15.85, 74.498)]) : pingPage([fix(9, 2, 16.705, 74.243)])),
    );
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();

    for (const [name, coords] of [['Amit Pawar', '16.7050, 74.2430'], ['Ramesh Kumar', '15.8500, 74.4980'], ['Amit Pawar', '16.7050, 74.2430']] as const) {
      fireEvent.click(rowFor(name));
      await flush();
      expect(heading()).toBe(name);
      expect(recent().map((r) => r.coords)).toEqual([coords]);
    }
  });
});

describe('when there is nothing to list, or the list cannot be had', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    locations.mockResolvedValue(fleetResponse([rameshAt(1, 15.85, 74.498)]));
  });

  it('says so when the driver has no recorded positions', async () => {
    driverHistory.mockResolvedValue(pingPage([]));
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();

    expect(within(panel()).getByText('No positions recorded yet')).toBeTruthy();
    expect(within(panel()).queryByText('Recent positions could not be loaded.')).toBeNull();
  });

  it('says the list could not be loaded instead of claiming there are none, and tries again on request', async () => {
    driverHistory.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.'));
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();

    expect(within(panel()).getByText('Recent positions could not be loaded.')).toBeTruthy();
    expect(within(panel()).queryByText('No positions recorded yet')).toBeNull();
    // The rest of the panel is unaffected by the list failing.
    expect(currentCoords()).toBe('15.85000, 74.49800');

    driverHistory.mockResolvedValue(pingPage([fix(1, 1, 15.85, 74.498)]));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Try again' }));
    await flush();

    expect(within(panel()).queryByText('Recent positions could not be loaded.')).toBeNull();
    expect(recent().map((r) => r.coords)).toEqual(['15.8500, 74.4980']);
  });

  it('shows the loading state, not an empty list, while the first answer is on its way', async () => {
    driverHistory.mockReturnValue(new Promise(() => {}));
    renderFleet('/admin/fleet?driver=drv-1');
    await flush();

    expect(within(panel()).getByText('Loading…')).toBeTruthy();
    expect(within(panel()).queryByText('No positions recorded yet')).toBeNull();
  });
});
