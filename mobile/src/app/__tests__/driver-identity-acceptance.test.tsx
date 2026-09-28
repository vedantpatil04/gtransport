import { render, screen } from '@testing-library/react-native';
import { initI18n } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import { accountApi } from '../../lib/api/account';
import { driverApi } from '../../lib/api/driver';
import HomeScreen from '../(tabs)/index';
import type { DriverProfile, LoginResponse } from '../../types/domain';

jest.mock('../../lib/api/account', () => ({
  accountApi: { login: jest.fn(), me: jest.fn(), changePassword: jest.fn() },
}));

jest.mock('../../lib/api/driver', () => ({
  driverApi: { me: jest.fn(), reportLocationState: jest.fn() },
  documentsApi: { list: jest.fn().mockResolvedValue({ data: [], page: { limit: 10, nextCursor: null } }) },
}));

jest.mock('../../lib/api/operations', () => ({
  fuelApi: { list: jest.fn().mockResolvedValue({ data: [], totals: { amount: '1200' } }) },
  operationsApi: { list: jest.fn().mockResolvedValue({ data: [], total: '450' }) },
}));

const mockDriverApi = driverApi as jest.Mocked<typeof driverApi>;
const mockAccountApi = accountApi as jest.Mocked<typeof accountApi>;

const driverAProfile: DriverProfile = {
  id: 'drv-uuid-a',
  driverCode: 'DRV-A01',
  status: 'ACTIVE',
  licenceNumber: 'KA22-A-1234',
  licenceExpiryDate: '2028-12-31',
  homeTown: 'Belagavi',
  locationSharingEnabled: true,
  location: null,
  emergencyContact: { name: 'Emergency Contact A', phone: '+919845000001' },
  employee: {
    id: 'emp-uuid-a',
    employeeCode: 'EMP-A01',
    fullName: 'DriverA Kumar',
    phone: '+919845012301',
    email: 'drivera@gangamata.in',
    designation: 'Driver',
    department: 'Operations',
    preferredLanguage: 'EN',
    status: 'ACTIVE',
    joiningDate: '2022-01-01',
  },
  currentAssignment: {
    id: 'assign-uuid-a',
    startedAt: '2023-01-01T00:00:00.000Z',
    vehicle: {
      id: 'veh-uuid-a',
      registrationNumber: 'KA 22 AA 1111',
      kind: 'LCV',
      fuelType: 'PETROL',
      status: 'ACTIVE',
      ownership: 'OWNED',
    },
  },
};

const driverBProfile: DriverProfile = {
  id: 'drv-uuid-b',
  driverCode: 'DRV-B02',
  status: 'ACTIVE',
  licenceNumber: 'KA22-B-5678',
  licenceExpiryDate: '2027-06-30',
  homeTown: 'Hubballi',
  locationSharingEnabled: true,
  location: null,
  emergencyContact: { name: 'Emergency Contact B', phone: '+919845000002' },
  employee: {
    id: 'emp-uuid-b',
    employeeCode: 'EMP-B02',
    fullName: 'DriverB Patil',
    phone: '+919845012302',
    email: 'driverb@gangamata.in',
    designation: 'Driver',
    department: 'Operations',
    preferredLanguage: 'KN',
    status: 'ACTIVE',
    joiningDate: '2023-06-01',
  },
  currentAssignment: {
    id: 'assign-uuid-b',
    startedAt: '2023-06-01T00:00:00.000Z',
    vehicle: {
      id: 'veh-uuid-b',
      registrationNumber: 'KA 22 BB 2222',
      kind: 'TRUCK',
      fuelType: 'DIESEL',
      status: 'ACTIVE',
      ownership: 'FINANCED',
    },
  },
};

const loginResponseFor = (role: string, phone: string, userId: string): LoginResponse => ({
  accessToken: `jwt-token-for-${userId}`,
  expiresIn: '12h',
  expiresAt: new Date(Date.now() + 12 * 3600000).toISOString(),
  user: {
    id: userId,
    role: role as any,
    companyId: 'company-uuid',
    employeeId: `emp-${userId}`,
    driverId: `drv-${userId}`,
    status: 'ACTIVE',
    mustChangePassword: false,
    displayName: userId,
    email: null,
    phone,
  },
});

describe('Phase 2 Acceptance Test: Driver A vs Driver B Identity & Assigned Vehicle', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useSession.setState({ status: 'signedOut', token: null, driver: null, expiredMessage: false });
  });

  it('proves the app renders authenticated backend identity dynamically for Driver A, logs out, and displays Driver B identity', async () => {
    // ── STEP 1: Driver A signs in ──
    mockAccountApi.login.mockResolvedValueOnce(loginResponseFor('DRIVER', '+919845012301', 'user-a'));
    mockDriverApi.me.mockResolvedValueOnce(driverAProfile);

    await useSession.getState().signIn('9845012301', 'passcodeA');

    expect(mockAccountApi.login).toHaveBeenCalledWith('+919845012301', 'passcodeA');
    expect(mockDriverApi.me).toHaveBeenCalledWith('jwt-token-for-user-a');
    expect(useSession.getState().status).toBe('signedIn');

    // ── STEP 2: Render Home screen as Driver A ──
    const screenA = await render(<HomeScreen />);

    // Verify Driver A name appears
    expect(await screenA.findByText(/DriverA/)).toBeTruthy();
    // Verify Driver A vehicle appears
    expect(await screenA.findByText('KA 22 AA 1111')).toBeTruthy();
    // Verify Driver B data does NOT appear
    expect(screenA.queryByText(/DriverB/)).toBeNull();
    expect(screenA.queryByText('KA 22 BB 2222')).toBeNull();

    screenA.unmount();

    // ── STEP 3: Logout ──
    await useSession.getState().signOut();
    expect(useSession.getState().status).toBe('signedOut');
    expect(useSession.getState().token).toBeNull();
    expect(useSession.getState().driver).toBeNull();

    // ── STEP 4: Driver B signs in ──
    mockAccountApi.login.mockResolvedValueOnce(loginResponseFor('DRIVER', '+919845012302', 'user-b'));
    mockDriverApi.me.mockResolvedValueOnce(driverBProfile);

    await useSession.getState().signIn('9845012302', 'passcodeB');

    expect(mockAccountApi.login).toHaveBeenCalledWith('+919845012302', 'passcodeB');
    expect(mockDriverApi.me).toHaveBeenCalledWith('jwt-token-for-user-b');
    expect(useSession.getState().status).toBe('signedIn');

    // ── STEP 5: Render Home screen as Driver B ──
    const screenB = await render(<HomeScreen />);

    // Verify Driver B name appears
    expect(await screenB.findByText(/DriverB/)).toBeTruthy();
    // Verify Driver B vehicle appears
    expect(await screenB.findByText('KA 22 BB 2222')).toBeTruthy();
    // Verify Driver A data does NOT appear
    expect(screenB.queryByText(/DriverA/)).toBeNull();
    expect(screenB.queryByText('KA 22 AA 1111')).toBeNull();

    screenB.unmount();
  });
});
