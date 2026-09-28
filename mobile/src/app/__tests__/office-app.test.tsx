import { render, screen } from '@testing-library/react-native';
import { initI18n } from '../../i18n';
import { officeApi } from '../../lib/api/office';
import { useSession } from '../../lib/auth/session-store';
import type { SessionUser, UserRole } from '../../types/domain';
import OfficeDashboard from '../office';
import OfficeFinance from '../office/finance';

jest.mock('../../lib/api/office', () => ({
  officeApi: {
    employees: jest.fn(),
    vehicles: jest.fn(),
    fuelSummary: jest.fn(),
    fuel: jest.fn(),
    compliance: jest.fn(),
    financeSummary: jest.fn(),
    paymentsSummary: jest.fn(),
    payments: jest.fn(),
  },
}));

const api = jest.mocked(officeApi);
const totals = { entries: 3, amount: '4500.00', litres: '46.00' };

const user = (role: UserRole): SessionUser => ({
  id: 'u1', role, companyId: 'c1', employeeId: 'e1', driverId: null, status: 'ACTIVE', mustChangePassword: false,
  displayName: 'Shobha Rao', email: null, phone: '+919845012306',
});

const signInAs = (role: UserRole) =>
  useSession.setState({ status: 'signedIn', token: 'token', user: user(role), role, driver: null, expiredMessage: false });

describe('office app', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    api.fuelSummary.mockResolvedValue({ today: totals, month: totals, financialYear: { ...totals, label: 'FY 2026-27' } });
    api.compliance.mockResolvedValue([{ type: 'INSURANCE', expired: 1, within7Days: 2, expiringSoon: 2, valid: 5, pendingVerification: 0, notUploaded: 0 }]);
    api.paymentsSummary.mockResolvedValue({ byStatus: { PENDING_APPROVAL: { count: 2, amount: '9000.00' } }, paidThisMonth: { count: 0, amount: '0' } });
    api.financeSummary.mockResolvedValue({
      financialYear: 'FY 2026-27', totalIncome: '0', totalExpenses: '12000.00', salaries: '0', advances: '0', fuel: '4500.00', pendingPayments: { count: 2, amount: '9000.00' },
    });
    api.payments.mockResolvedValue({ data: [], page: { nextCursor: null } } as never);
  });

  it('shows accounting the payroll figures, read live from the API', async () => {
    signInAs('ACCOUNTING');
    await render(<OfficeDashboard />);

    expect(await screen.findByTestId('office-payroll')).toBeTruthy();
    expect(await screen.findByText('Shobha Rao · Accounting')).toBeTruthy();
    expect(api.paymentsSummary).toHaveBeenCalledWith('token');
    expect(api.financeSummary).toHaveBeenCalledWith('token');
  });

  it('shows a manager operations only, and never asks the API for payroll', async () => {
    signInAs('MANAGER');
    await render(<OfficeDashboard />);

    expect(await screen.findByTestId('office-fuel-today')).toBeTruthy();
    expect(screen.queryByTestId('office-payroll')).toBeNull();
    expect(api.paymentsSummary).not.toHaveBeenCalled();
    expect(api.financeSummary).not.toHaveBeenCalled();
  });

  it('shows a dash, never a sample figure, while the dashboard loads', async () => {
    signInAs('ADMIN');
    api.fuelSummary.mockReturnValue(new Promise(() => undefined));
    await render(<OfficeDashboard />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the load error instead of stale or fake numbers when the API fails', async () => {
    const { ApiError } = jest.requireActual('../../lib/api/client') as typeof import('../../lib/api/client');
    signInAs('ADMIN');
    api.fuelSummary.mockRejectedValue(new ApiError('server', 500, 'boom'));
    await render(<OfficeDashboard />);

    expect(await screen.findByTestId('retry')).toBeTruthy();
  });

  it('refuses finance to a manager who deep-links there, without calling its endpoints', async () => {
    signInAs('MANAGER');
    await render(<OfficeFinance />);

    expect(await screen.findByText('Not available for your role')).toBeTruthy();
    expect(api.financeSummary).not.toHaveBeenCalled();
    expect(api.payments).not.toHaveBeenCalled();
  });

  it('opens finance for accounting', async () => {
    signInAs('ACCOUNTING');
    await render(<OfficeFinance />);

    expect(await screen.findByTestId('office-finance')).toBeTruthy();
    expect(api.financeSummary).toHaveBeenCalledWith('token');
  });
});
