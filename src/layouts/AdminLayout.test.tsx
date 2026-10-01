import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Fleet } from '@/features/admin/pages/Fleet';
import { useApp } from '@/store';
import { FakeMap } from '@/test/fakeMaplibre';
import { setViewportWidth } from '@/test/viewport';
import { AdminLayout } from './AdminLayout';

/**
 * Getting to Live Fleet, which is the other half of the map working: the screen has to be
 * reachable on every device the office uses. This renders the real Admin layout and navigation
 * around the real Fleet screen; only the route table is trimmed to what the test needs.
 */

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAdmin(path = '/admin') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<div>dashboard home</div>} />
          <Route path="fleet" element={<Fleet />} />
          <Route path="vehicles" element={<div>vehicles page</div>} />
        </Route>
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  vi.stubEnv('VITE_MAP_STYLE_URL', 'https://tiles.example.com/styles/basic/style.json');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The prototype's own sign-in, as the demo bar does it.
  useApp.getState().login('admin');
});

describe('mobile Admin: More → Live Fleet', () => {
  beforeEach(() => {
    setViewportWidth(375);
  });

  it('uses the bottom navigation, with More for everything that does not fit', () => {
    renderAdmin();
    const nav = screen.getByRole('navigation', { name: /navigation/i });
    for (const label of ['Dashboard', 'Vehicles', 'Fuel', 'Finance', 'More']) {
      expect(within(nav).getByText(label)).toBeTruthy();
    }
    // Live Fleet is not on the bottom bar: it lives under More.
    expect(within(nav).queryByText('Live Fleet')).toBeNull();
  });

  it('opens Live Fleet from More', () => {
    renderAdmin();
    expect(where()).toBe('/admin');

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('link', { name: 'Live Fleet' }));

    expect(where()).toBe('/admin/fleet');
    expect(screen.getByRole('heading', { name: 'Live Fleet' })).toBeTruthy();
    // The map is there, on the new screen, and the sheet has closed behind it.
    expect(screen.getByTestId('fleet-map')).toBeTruthy();
    expect(FakeMap.instances).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the fleet list under the map, not beside it, on a phone', () => {
    renderAdmin('/admin/fleet');
    expect(screen.getByTestId('fleet-map')).toBeTruthy();
    expect(screen.getAllByTestId('fleet-row').length).toBeGreaterThan(0);
    // The desktop sidebar is not rendered at this width.
    expect(screen.queryByTestId('admin-nav-fleet')).toBeNull();
  });

  it('keeps the other bottom-bar destinations working', () => {
    renderAdmin('/admin/fleet');
    fireEvent.click(within(screen.getByRole('navigation', { name: /navigation/i })).getByText('Vehicles'));
    expect(where()).toBe('/admin/vehicles');
    expect(FakeMap.instances.every((map) => map.removed)).toBe(true);
  });
});

describe('desktop Admin: Live Fleet in the sidebar', () => {
  beforeEach(() => {
    setViewportWidth(1440);
  });

  it('opens Live Fleet from the sidebar', () => {
    renderAdmin();
    fireEvent.click(screen.getByTestId('admin-nav-fleet'));

    expect(where()).toBe('/admin/fleet');
    expect(screen.getByRole('heading', { name: 'Live Fleet' })).toBeTruthy();
    expect(screen.getByTestId('fleet-map')).toBeTruthy();
  });

  it('does not show the mobile bottom navigation', () => {
    renderAdmin();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('shows the live list beside the map, with a detail card for a selected driver', () => {
    renderAdmin('/admin/fleet');
    fireEvent.click(screen.getAllByTestId('fleet-row')[0]!);
    expect(screen.getByTestId('fleet-detail')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('tablet Admin', () => {
  it('reaches Live Fleet from the icon rail', () => {
    setViewportWidth(1024);
    renderAdmin();
    fireEvent.click(screen.getByTestId('admin-nav-fleet'));
    expect(where()).toBe('/admin/fleet');
    expect(screen.getByTestId('fleet-map')).toBeTruthy();
  });
});
