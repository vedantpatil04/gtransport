import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '@/features/api/session';
import { SettingsPage } from './SettingsPage';

vi.mock('@/features/api/mode', () => ({ isApiConfigured: () => true, useConnected: () => true }));

beforeEach(() => {
  useSession.setState({
    token: 'test-token',
    expiresAt: null,
    user: { id: 'u1', role: 'ADMIN', companyId: 'c1', employeeId: 'e1', driverId: null, status: 'ACTIVE', mustChangePassword: false, displayName: 'Priya Office', email: 'priya@example.test', phone: null },
  });
});

const renderSettings = () =>
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );

describe('Settings with the live API', () => {
  it('is a working hub, not a "not connected yet" placeholder', () => {
    renderSettings();
    expect(screen.getByTestId('settings-live')).toBeTruthy();
    expect(screen.queryByTestId('not-live')).toBeNull();
    // The real signed-in account, its role in words, and its sign-in ID.
    expect(screen.getByText('Priya Office')).toBeTruthy();
    expect(screen.getByText('priya@example.test')).toBeTruthy();
  });

  it('points to where logins and the mailbox are actually managed', () => {
    renderSettings();
    expect(screen.getByRole('link', { name: /Logins & roles/ }).getAttribute('href')).toBe('/admin/employees');
    expect(screen.getByRole('link', { name: /Company mailbox/ }).getAttribute('href')).toBe('/admin/inbox');
  });

  it('opens the password change for the signed-in account', () => {
    renderSettings();
    fireEvent.click(screen.getByTestId('settings-change-password'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Current password')).toBeTruthy();
  });

  it('says plainly what is not stored on the server yet instead of offering controls that save nothing', () => {
    renderSettings();
    expect(screen.getByTestId('settings-company-later').textContent).toMatch(/not stored on the server yet/);
    expect(screen.queryByLabelText('Company name')).toBeNull();
  });
});
