import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { initI18n } from '../../i18n';
import { officeApi } from '../../lib/api/office';
import { useSession } from '../../lib/auth/session-store';
import type { SessionUser, UserRole } from '../../types/domain';
import OfficeReports from '../office/reports';

jest.mock('../../lib/api/office', () => ({
  officeApi: {
    fuelSummary: jest.fn(),
    financeSummary: jest.fn(),
    compliance: jest.fn(),
  },
}));

const api = jest.mocked(officeApi);
const totals = { entries: 5, amount: '15000.00', litres: '150.00' };

const user = (role: UserRole): SessionUser => ({
  id: 'u1', role, companyId: 'c1', employeeId: 'e1', driverId: null, status: 'ACTIVE', mustChangePassword: false,
  displayName: 'Admin User', email: 'admin@gangamata.in', phone: '+919845012306',
});

const signInAs = (role: UserRole) =>
  useSession.setState({ status: 'signedIn', token: 'mock-token', user: user(role), role, driver: null, expiredMessage: false });

describe('OfficeReports screen', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert');
    api.fuelSummary.mockResolvedValue({
      today: totals,
      month: totals,
      financialYear: { ...totals, label: 'FY 2026-27' },
    });
    api.financeSummary.mockResolvedValue({
      financialYear: 'FY 2026-27',
      totalIncome: '50000.00',
      totalExpenses: '32000.00',
      salaries: '12000.00',
      advances: '3000.00',
      fuel: '15000.00',
      pendingPayments: { count: 3, amount: '9500.00' },
    });
    api.compliance.mockResolvedValue([
      { type: 'INSURANCE', expired: 1, within7Days: 2, expiringSoon: 2, valid: 10, pendingVerification: 0, notUploaded: 0 },
      { type: 'FITNESS', expired: 0, within7Days: 1, expiringSoon: 1, valid: 12, pendingVerification: 0, notUploaded: 0 },
    ]);
  });

  it('renders fuel, finance and compliance summaries for ADMIN', async () => {
    signInAs('ADMIN');
    await render(<OfficeReports />);

    expect(await screen.findByTestId('office-reports')).toBeTruthy();
    expect(await screen.findByTestId('reports-fuel-year')).toBeTruthy();
    expect(await screen.findByTestId('reports-finance-summary')).toBeTruthy();
    expect(await screen.findByTestId('reports-compliance-summary')).toBeTruthy();
    expect(api.fuelSummary).toHaveBeenCalledWith('mock-token');
    expect(api.financeSummary).toHaveBeenCalledWith('mock-token');
    expect(api.compliance).toHaveBeenCalledWith('mock-token');
  });

  it('triggers export alert when export PDF is clicked', async () => {
    jest.useFakeTimers();
    signInAs('ADMIN');
    await render(<OfficeReports />);

    const pdfBtn = await screen.findByTestId('reports-export-pdf');
    fireEvent.press(pdfBtn);

    jest.advanceTimersByTime(700);
    expect(Alert.alert).toHaveBeenCalledWith(
      'PDF Report',
      expect.stringContaining('PDF'),
    );
    jest.useRealTimers();
  });
});
