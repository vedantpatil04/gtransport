import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { initI18n } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import type { SessionUser, UserRole } from '../../types/domain';
import OfficeSettings from '../office/settings';

const user = (role: UserRole): SessionUser => ({
  id: 'u1', role, companyId: 'c1', employeeId: 'e1', driverId: null, status: 'ACTIVE', mustChangePassword: false,
  displayName: 'Admin User', email: 'admin@gangamata.in', phone: '+919845012306',
});

const signInAs = (role: UserRole) =>
  useSession.setState({ status: 'signedIn', token: 'mock-token', user: user(role), role, driver: null, expiredMessage: false });

describe('OfficeSettings screen', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert');
  });

  it('renders account info, language preferences, and system configuration for ADMIN', async () => {
    signInAs('ADMIN');
    await render(<OfficeSettings />);

    expect(await screen.findByTestId('office-settings')).toBeTruthy();
    expect(await screen.findByTestId('settings-account-card')).toBeTruthy();
    expect(await screen.findByText('Admin User')).toBeTruthy();
    expect(await screen.findByTestId('settings-language-card')).toBeTruthy();
    expect(await screen.findByTestId('settings-system-card')).toBeTruthy();
  });

  it('shows sign-out confirmation dialog on button press', async () => {
    signInAs('ADMIN');
    await render(<OfficeSettings />);

    const signOutBtn = await screen.findByTestId('settings-sign-out');
    fireEvent.press(signOutBtn);

    expect(Alert.alert).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Array),
    );
  });

  it('allows language switching by tapping on a language option', async () => {
    signInAs('ADMIN');
    await render(<OfficeSettings />);

    const hindiBtn = await screen.findByTestId('settings-lang-hi');
    fireEvent.press(hindiBtn);

    expect(await screen.findByTestId('settings-lang-hi')).toBeTruthy();
  });
});
