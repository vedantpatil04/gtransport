import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { isRunningInExpoGo } from 'expo';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { initI18n } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import ProfileScreen from '../(tabs)/profile';
import type { DriverProfile } from '../../types/domain';

jest.mock('expo', () => ({
  isRunningInExpoGo: jest.fn(() => false),
}));

const mockDriver: DriverProfile = {
  id: 'driver-1',
  driverCode: 'DRV-001',
  status: 'ACTIVE',
  licenceNumber: 'MH12-2020-0012345',
  licenceExpiryDate: '2028-12-31',
  homeTown: 'Pune',
  locationSharingEnabled: true,
  location: {
    status: 'ACTIVE',
    permission: 'GRANTED_ALWAYS',
    lastHeartbeatAt: new Date().toISOString(),
  },
  emergencyContact: { name: 'Support', phone: '9876543210' },
  employee: {
    id: 'emp-1',
    employeeCode: 'EMP-001',
    fullName: 'Ramesh Pawar',
    phone: '9876543210',
    email: 'ramesh@gangamata.in',
    designation: 'Driver',
    department: 'Operations',
    preferredLanguage: 'EN',
    status: 'ACTIVE',
    joiningDate: '2023-01-15',
  },
  currentAssignment: {
    id: 'assign-1',
    startedAt: new Date().toISOString(),
    vehicle: {
      id: 'veh-1',
      registrationNumber: 'MH 12 AB 1234',
      kind: 'TRUCK',
      fuelType: 'DIESEL',
      status: 'ACTIVE',
      ownership: 'OWNED',
    },
  },
};

describe('ProfileScreen', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useSession.setState({
      status: 'signedIn',
      token: 'valid-token',
      driver: mockDriver,
      expiredMessage: false,
    });
  });

  it('renders successfully inside Expo Go without crashing and allows toggling notifications', async () => {
    Constants.executionEnvironment = ExecutionEnvironment.StoreClient;
    (isRunningInExpoGo as unknown as jest.Mock).mockReturnValue(true);

    await render(<ProfileScreen />);

    expect(await screen.findByText('Ramesh Pawar')).toBeTruthy();
    expect(screen.getAllByText('DRV-001').length).toBeGreaterThan(0);

    const toggle = screen.getByTestId('notifications-toggle');
    expect(toggle).toBeTruthy();

    await fireEvent(toggle, 'valueChange', false);
    await waitFor(() => {
      expect(toggle.props.value).toBe(false);
    });

    await fireEvent(toggle, 'valueChange', true);
    await waitFor(() => {
      expect(toggle.props.value).toBe(true);
    });
  });

  it('renders successfully inside development / production builds', async () => {
    Constants.executionEnvironment = ExecutionEnvironment.Bare;
    (isRunningInExpoGo as unknown as jest.Mock).mockReturnValue(false);

    await render(<ProfileScreen />);

    expect(await screen.findByText('Ramesh Pawar')).toBeTruthy();
    expect(screen.getByTestId('notifications-toggle')).toBeTruthy();
  });
});
