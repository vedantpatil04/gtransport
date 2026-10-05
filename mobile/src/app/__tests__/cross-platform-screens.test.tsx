import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { initI18n } from '../../i18n';
import { fuelApi, operationsApi } from '../../lib/api/operations';
import { paymentsApi, type DriverPayment } from '../../lib/api/payments';
import { useSession } from '../../lib/auth/session-store';
import { todayIso } from '../../lib/dates';
import type { DriverProfile, SessionUser, UserRole } from '../../types/domain';
import HomeScreen from '../(tabs)/index';
import ProfileScreen from '../(tabs)/profile';
import OfficeSettings from '../office/settings';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  // Runs like a screen coming into view.
  useFocusEffect: (effect: () => void) => {
    const { useEffect: useMountEffect } = jest.requireActual('react');
    useMountEffect(effect, [effect]);
  },
  useSegments: jest.fn(() => []),
}));

jest.mock('../../lib/api/operations', () => ({
  fuelApi: { list: jest.fn() },
  operationsApi: { list: jest.fn() },
  receiptSource: jest.fn(),
}));

jest.mock('../../lib/api/payments', () => ({
  ...jest.requireActual('../../lib/api/payments'),
  paymentsApi: { mine: jest.fn() },
}));

const fuel = jest.mocked(fuelApi);
const operations = jest.mocked(operationsApi);
const payments = jest.mocked(paymentsApi);

const driver: DriverProfile = {
  id: 'driver-1',
  driverCode: 'DRV-001',
  status: 'ACTIVE',
  licenceNumber: 'MH12-2020-0012345',
  licenceExpiryDate: '2028-12-31',
  homeTown: 'Pune',
  locationSharingEnabled: true,
  location: null,
  emergencyContact: { name: 'Support', phone: '9876543210' },
  employee: {
    id: 'emp-1', employeeCode: 'EMP-001', fullName: 'Ramesh Pawar', phone: '9876543210', email: null, designation: 'Driver',
    department: 'Operations', preferredLanguage: 'EN', status: 'ACTIVE', joiningDate: '2023-01-15',
  },
  currentAssignment: {
    id: 'assign-1',
    startedAt: new Date().toISOString(),
    vehicle: { id: 'veh-1', registrationNumber: 'MH 12 AB 1234', kind: 'TRUCK', fuelType: 'DIESEL', status: 'ACTIVE', ownership: 'OWNED' },
  },
};

const payment = (overrides: Partial<DriverPayment>): DriverPayment => ({
  id: 'p', type: 'ADVANCE', amount: '0.00', status: 'PAID', method: 'UPI', description: null, payPeriod: null, utr: null,
  recipientSummary: null, createdAt: new Date().toISOString(), paidAt: new Date().toISOString(), ...overrides,
});

const officeUser = (role: UserRole): SessionUser => ({
  id: 'u1', role, companyId: 'c1', employeeId: 'e1', driverId: null, status: 'ACTIVE', mustChangePassword: false,
  displayName: 'Priya Office', email: 'priya@gangamata.in', phone: null,
});

beforeAll(async () => {
  await initI18n();
});

describe('driver Home', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSession.setState({ status: 'signedIn', token: 'token', role: 'DRIVER', driver, expiredMessage: false });
    fuel.list.mockResolvedValue({ data: [], page: { limit: 1, nextCursor: null }, totals: { entries: 1, amount: '2450.00', litres: '25.300', averageRate: '96.84' } } as never);
    operations.list.mockResolvedValue({ data: [], page: { limit: 50, nextCursor: null }, total: '450.00', count: 1 } as never);
  });

  it("shows today's money received from the driver's real payments", async () => {
    const yesterday = new Date(Date.now() - 36 * 3_600_000).toISOString();
    payments.mine.mockResolvedValue({
      data: [
        payment({ id: 'a', amount: '3000.00', status: 'PAID' }),
        payment({ id: 'b', amount: '1500.50', status: 'PAID' }),
        payment({ id: 'c', amount: '9999.00', status: 'PROCESSING', paidAt: null }),
        payment({ id: 'd', amount: '700.00', status: 'PAID', paidAt: yesterday }),
      ],
      page: { limit: 30, nextCursor: null },
    });
    await render(<HomeScreen />);

    await waitFor(() => expect(screen.getByTestId('summary-received')).toHaveTextContent(/₹4,500\.50/));
    expect(screen.getByTestId('summary-fuel')).toHaveTextContent(/₹2,450/);
    expect(screen.getByTestId('summary-other')).toHaveTextContent(/₹450/);
    expect(payments.mine).toHaveBeenCalledWith('token', { limit: 30 });
    expect(fuel.list).toHaveBeenCalledWith('token', expect.objectContaining({ from: todayIso(), to: todayIso() }));
  });

  it('keeps the other figures when payments cannot be loaded, and never says "Coming soon"', async () => {
    payments.mine.mockRejectedValue(new Error('offline'));
    await render(<HomeScreen />);

    await waitFor(() => expect(screen.getByTestId('summary-fuel')).toHaveTextContent(/₹2,450/));
    expect(screen.getByTestId('summary-received')).toHaveTextContent(/—/);
    expect(screen.queryByText('Coming soon')).toBeNull();
    expect(screen.getByText('Salary, advances and allowances')).toBeTruthy();
    expect(screen.getByText('Licence, RC, insurance and PUC')).toBeTruthy();
  });
});

describe('driver Profile password change', () => {
  const changePassword = jest.fn();

  beforeEach(() => {
    changePassword.mockReset();
    useSession.setState({ status: 'signedIn', token: 'token', role: 'DRIVER', driver, expiredMessage: false, changePassword });
  });

  it('lets a driver change their own password, as office staff can', async () => {
    changePassword.mockResolvedValue(undefined);
    await render(<ProfileScreen />);

    await fireEvent.press(await screen.findByTestId('profile-change-password'));
    await fireEvent.changeText(screen.getByTestId('profile-password-current'), 'old-secret');
    await fireEvent.changeText(screen.getByTestId('profile-password-new'), 'new-secret-123');
    await fireEvent.changeText(screen.getByTestId('profile-password-repeat'), 'new-secret-123');
    await fireEvent.press(screen.getByTestId('profile-password-save'));

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('old-secret', 'new-secret-123'));
    expect(await screen.findByText('Password changed.')).toBeTruthy();
  });

  it('checks the repeat before calling the API', async () => {
    await render(<ProfileScreen />);

    await fireEvent.press(await screen.findByTestId('profile-change-password'));
    await fireEvent.changeText(screen.getByTestId('profile-password-current'), 'old-secret');
    await fireEvent.changeText(screen.getByTestId('profile-password-new'), 'new-secret-123');
    await fireEvent.changeText(screen.getByTestId('profile-password-repeat'), 'something-else');
    await fireEvent.press(screen.getByTestId('profile-password-save'));

    expect(await screen.findByText('The new passwords do not match.')).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });
});

describe('office Settings', () => {
  beforeEach(() => {
    useSession.setState({ status: 'signedIn', token: 'token', user: officeUser('ADMIN'), role: 'ADMIN', driver: null, expiredMessage: false });
  });

  it('shows the real build and server, in words, with no developer placeholders', async () => {
    const expoConfig = Constants.expoConfig as { version?: string } | null;
    if (expoConfig) expoConfig.version = '1.4.2';
    await render(<OfficeSettings />);

    expect(await screen.findByText('1.4.2')).toBeTruthy();
    // The host of the API this build talks to (the test build's configured URL).
    expect(screen.getByText('api.test.gangamata')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.getByText('Development')).toBeTruthy();
    expect(screen.queryByText(/Localhost/i)).toBeNull();
    expect(screen.queryByText(/Build 57/)).toBeNull();
    expect(screen.queryByText('ADMIN')).toBeNull();
    if (expoConfig) delete expoConfig.version;
  });

  it('speaks the selected language', async () => {
    await render(<OfficeSettings />);
    await fireEvent.press(await screen.findByTestId('settings-lang-hi'));
    expect(await screen.findByText('यह ऐप')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('settings-lang-en'));
  });
});

