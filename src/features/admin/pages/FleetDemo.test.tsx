import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFleet, type FleetItem } from '@/features/map/useFleet';
import { FakeMap, FakeMarker, currentMap, markerFor } from '@/test/fakeMaplibre';
import { setViewportWidth } from '@/test/viewport';
import { Fleet } from './Fleet';

// The prototype's fleet is simulated. It delegates to the real simulation unless a test supplies a vehicle.
vi.mock('@/features/map/useFleet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/map/useFleet')>();
  return { ...actual, useFleet: vi.fn(actual.useFleet) };
});
const realUseFleet = (await vi.importActual<typeof import('@/features/map/useFleet')>('@/features/map/useFleet')).useFleet;

const STYLE = 'https://tiles.example.com/styles/basic/style.json';

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function renderDemo(path = '/admin/fleet') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/fleet" element={<Fleet />} />
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

/** One simulated vehicle, with a heading in the simulation's own convention. */
function simulated(heading: number): ReturnType<typeof useFleet> {
  const now = Date.now();
  const item = {
    driver: { id: 'sim-1', name: 'Test Driver', sim: { route: ['pune', 'satara'] } },
    vehicle: { id: 'veh-1', reg: 'MH 12 AB 1234' },
    pos: { driverId: 'sim-1', lat: 16.5, lng: 74.5, heading, speedKmh: 40, motion: 'moving', updatedAt: new Date(now).toISOString(), near: 'kolhapur', towards: 'sangli', direction: 1, kmFromStart: 10 },
  } as unknown as FleetItem;
  return { items: [item], counts: { moving: 1, stopped: 0, offline: 0, none: 0 }, now };
}

beforeEach(() => {
  vi.stubEnv('VITE_MAP_STYLE_URL', STYLE);
  vi.mocked(useFleet).mockImplementation(realUseFleet);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Live Fleet in the prototype (no API)', () => {
  it('renders the route on the same MapLibre map, on the configured style', () => {
    renderDemo();
    expect(screen.getByRole('heading', { name: 'Live Fleet' })).toBeTruthy();
    expect(screen.getAllByTestId('fleet-row').length).toBeGreaterThan(5);
    expect(FakeMap.instances).toHaveLength(1);
    expect(currentMap().options.style).toBe(STYLE);
  });

  it('labels the positions as simulated, because they are', () => {
    renderDemo();
    expect(screen.getByTestId('fleet-map-legend').textContent).toContain('Simulated positions');
  });

  it('plots the simulated vehicles at real coordinates inside the operating region', () => {
    renderDemo();
    const pins = FakeMarker.instances.filter((pin) => !pin.removed);
    expect(pins.length).toBeGreaterThan(5);
    for (const pin of pins) {
      const [lng, lat] = pin.lngLat!;
      expect(lat).toBeGreaterThan(11);
      expect(lat).toBeLessThan(20);
      expect(lng).toBeGreaterThan(72);
      expect(lng).toBeLessThan(79);
    }
  });

  it('opens the detail card for a selected driver, with Open in Google Maps at their coordinates', () => {
    renderDemo();
    fireEvent.click(screen.getAllByTestId('fleet-row')[0]!);

    const card = screen.getByTestId('fleet-detail');
    const link = within(card).getByTestId('fleet-open-google-maps') as HTMLAnchorElement;
    const id = new URLSearchParams(search()!).get('driver')!;
    const [lng, lat] = markerFor(id).lngLat!;
    expect(link.href).toBe(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
  });

  it('still filters by motion', () => {
    renderDemo();
    const all = screen.getAllByTestId('fleet-row').length;

    fireEvent.click(screen.getByRole('button', { name: /^Stopped/ }));

    expect(search()).toBe('?status=stopped');
    expect(screen.getAllByTestId('fleet-row').length).toBeLessThan(all);
    expect(FakeMap.instances).toHaveLength(1);
  });

  it('shows the honest message, not a drawn map, when no style is configured', () => {
    vi.stubEnv('VITE_MAP_STYLE_URL', '');
    renderDemo();
    expect(screen.getByText('Map configuration is unavailable.')).toBeTruthy();
    expect(FakeMap.instances).toHaveLength(0);
    expect(screen.getAllByTestId('fleet-row').length).toBeGreaterThan(5);
  });

  it('keeps vehicles clear of the driver card on a desktop', () => {
    renderDemo('/admin/fleet?driver=drv_01');
    ready();
    const [fit] = currentMap().callsTo('fitBounds');
    // 12 px offset + 320 px card + 60 px of ordinary padding, wherever the demo's first driver stands.
    expect(fit!.args[1]).toMatchObject({ padding: { left: 392 } });
  });

  it('on a phone, opens the card as a sheet and pads the map for nothing', () => {
    setViewportWidth(375);
    renderDemo('/admin/fleet?driver=drv_01');
    ready();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(currentMap().callsTo('fitBounds')[0]!.args[1]).toMatchObject({ padding: { left: 60 } });
  });
});

describe('simulated headings', () => {
  // The simulation measures heading in screen space: 0° is east and angles run clockwise.
  // The map speaks compass degrees: 0° is north. The demo screen converts between them.
  it.each([
    ['east', 0, 90],
    ['south', 90, 180],
    ['west', 180, 270],
    ['west, as a negative angle', -180, 270],
    ['north', -90, 0],
  ])('points %s correctly: simulation %i° becomes compass %i°', (_direction, simulationAngle, compass) => {
    vi.mocked(useFleet).mockReturnValue(simulated(simulationAngle));
    renderDemo();

    const arrow = (markerFor('sim-1').element.children[1] as HTMLElement).firstElementChild as HTMLElement;
    expect(arrow.style.display).toBe('');
    expect(arrow.style.transform).toBe(`rotate(${compass}deg)`);
  });
});
