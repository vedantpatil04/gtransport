import { fireEvent, render, screen } from '@testing-library/react-native';
import { initI18n } from '../../i18n';
import { useSession } from '../../lib/auth/session-store';
import type { SessionUser, UserRole } from '../../types/domain';
import OfficeMore from '../office/more';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: jest.fn(() => ({})),
  useFocusEffect: jest.fn(),
  useSegments: jest.fn(() => []),
}));

const user = (role: UserRole): SessionUser => ({
  id: 'u1',
  role,
  companyId: 'c1',
  employeeId: 'e1',
  driverId: null,
  status: 'ACTIVE',
  mustChangePassword: false,
  displayName: 'Admin User',
  email: 'admin@gangamata.in',
  phone: '+919845012306',
});

const signInAs = (role: UserRole) =>
  useSession.setState({
    status: 'signedIn',
    token: 'token',
    user: user(role),
    role,
    driver: null,
    expiredMessage: false,
  });

describe('OfficeMore screen', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders Operations, Management, and System sections for an ADMIN', async () => {
    signInAs('ADMIN');
    await render(<OfficeMore />);

    expect(await screen.findByTestId('office-section-operations')).toBeTruthy();
    expect(screen.getByTestId('office-section-management')).toBeTruthy();
    expect(screen.getByTestId('office-section-system')).toBeTruthy();

    // Operations section items
    expect(screen.getByTestId('office-more-fleet')).toBeTruthy();
    expect(screen.getByTestId('office-more-employees')).toBeTruthy();
    expect(screen.getByTestId('office-more-documents')).toBeTruthy();

    // Management section items
    expect(screen.getByTestId('office-more-reports')).toBeTruthy();
    expect(screen.getByTestId('office-more-inbox')).toBeTruthy();

    // System section items
    expect(screen.getByTestId('office-more-settings')).toBeTruthy();
    expect(screen.getByTestId('office-more-profile')).toBeTruthy();
  });

  it('excludes Settings for a MANAGER role and preserves role access', async () => {
    signInAs('MANAGER');
    await render(<OfficeMore />);

    expect(await screen.findByTestId('office-more-fleet')).toBeTruthy();
    expect(screen.getByTestId('office-more-employees')).toBeTruthy();
    expect(screen.getByTestId('office-more-reports')).toBeTruthy();
    expect(screen.getByTestId('office-more-inbox')).toBeTruthy();
    expect(screen.getByTestId('office-more-profile')).toBeTruthy();

    // MANAGER should not have settings
    expect(screen.queryByTestId('office-more-settings')).toBeNull();
  });

  it('excludes Settings for ACCOUNTING role', async () => {
    signInAs('ACCOUNTING');
    await render(<OfficeMore />);

    expect(await screen.findByTestId('office-more-documents')).toBeTruthy();
    expect(screen.getByTestId('office-more-fleet')).toBeTruthy();
    expect(screen.getByTestId('office-more-reports')).toBeTruthy();
    expect(screen.getByTestId('office-more-inbox')).toBeTruthy();
    expect(screen.getByTestId('office-more-profile')).toBeTruthy();

    // ACCOUNTING should not have settings
    expect(screen.queryByTestId('office-more-settings')).toBeNull();
  });

  it('navigates to local /office routes using router.push', async () => {
    signInAs('ADMIN');
    await render(<OfficeMore />);

    const employees = await screen.findByTestId('office-more-employees');
    fireEvent.press(employees);
    expect(mockPush).toHaveBeenCalledWith('/office/employees');

    const documents = await screen.findByTestId('office-more-documents');
    fireEvent.press(documents);
    expect(mockPush).toHaveBeenCalledWith('/office/documents');

    const profile = await screen.findByTestId('office-more-profile');
    fireEvent.press(profile);
    expect(mockPush).toHaveBeenCalledWith('/office/profile');

    const fleet = await screen.findByTestId('office-more-fleet');
    fireEvent.press(fleet);
    expect(mockPush).toHaveBeenCalledWith('/office/fleet');

    const reports = await screen.findByTestId('office-more-reports');
    fireEvent.press(reports);
    expect(mockPush).toHaveBeenCalledWith('/office/reports');

    const inbox = await screen.findByTestId('office-more-inbox');
    fireEvent.press(inbox);
    expect(mockPush).toHaveBeenCalledWith('/office/inbox');

    const settings = await screen.findByTestId('office-more-settings');
    fireEvent.press(settings);
    expect(mockPush).toHaveBeenCalledWith('/office/settings');
  });
});
