import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '@/store';
import { AppRoutes } from './routes';

// The demo store gives the console data without an API; the routing rules are the same in both modes.
vi.mock('@/features/api/mode', () => ({ isApiConfigured: () => false, useConnected: () => false }));

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <Where />
    </MemoryRouter>,
  );
  return screen.getByTestId('where').textContent;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useApp.getState().login('admin');
});

describe('one address per screen', () => {
  it.each([
    ['/admin/payments?status=pending', '/admin/finance/payments?status=pending'],
    ['/admin/payments?payment=p1', '/admin/finance/payments?payment=p1'],
    ['/admin/expenses?category=tyre', '/admin/finance/expenses?category=tyre'],
    ['/admin/employees/drivers?q=ramesh', '/admin/drivers?q=ramesh'],
    ['/admin/employees/drivers/drv_01', '/admin/drivers/drv_01'],
  ])('moves %s to %s, keeping the query', (from, to) => {
    expect(renderAt(from)).toBe(to);
  });

  it('highlights the right sidebar entry after following a legacy link', () => {
    // Desktop width (the test default): the full sidebar with Finance expanded.
    renderAt('/admin/payments');
    expect(screen.getByTestId('admin-nav-payments').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('admin-nav-expenses').getAttribute('aria-current')).toBeNull();
  });
});
