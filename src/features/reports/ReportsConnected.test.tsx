import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { driversApi, employeesApi, vehiclesApi } from '@/features/api/resources';
import { useSession, type ApiRole } from '@/features/api/session';
import { ApiError } from '@/lib/api/client';
import { downloadReport, reportsApi, type FuelRecord, type FuelReport, type ReportMeta, type ReportPage } from './api';
import { ReportsConnected } from './ReportsConnected';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  reportsApi: { meta: vi.fn(), summary: vi.fn(), records: vi.fn() },
  downloadReport: vi.fn(),
}));
vi.mock('@/features/api/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/api/resources')>()),
  vehiclesApi: { list: vi.fn() },
  driversApi: { list: vi.fn() },
  employeesApi: { list: vi.fn() },
}));

const api = vi.mocked(reportsApi);

const META: ReportMeta = {
  reports: ['overview', 'fuel', 'vehicles', 'drivers', 'finance', 'expenses', 'maintenance', 'tyres', 'compliance', 'location'],
  visibility: { payments: true, compliance: true, location: true },
  today: '2026-10-05',
  currentFinancialYear: { code: '2026-27', label: 'FY 2026–27' },
  financialYears: [
    { code: '2026-27', label: 'FY 2026–27', from: '2026-04-01', to: '2027-03-31' },
    { code: '2025-26', label: 'FY 2025–26', from: '2025-04-01', to: '2026-03-31' },
  ],
  presets: ['today', 'yesterday', 'this_week', 'this_month', 'previous_month', 'this_quarter', 'this_fy', 'previous_fy', 'fy', 'custom'],
  maxRangeDays: 1100,
  expenseCategories: ['FUEL', 'RTO', 'TYRE', 'TYRE_INSURANCE', 'MAINTENANCE'],
  expiryWindows: [7, 30, 60, 90],
  defaultExpiryWindow: 30,
};

const head = {
  report: 'fuel' as const,
  range: { preset: 'fy' as const, from: '2025-04-01', to: '2026-03-31', days: 365, granularity: 'month' as const, label: '1 Apr 2025 – 31 Mar 2026', financialYears: [{ code: '2025-26', label: 'FY 2025–26' }] },
  asOf: '2026-10-05',
  filters: {},
  generatedAt: '2026-10-05T04:00:00.000Z',
};

const FUEL: FuelReport = {
  ...head,
  totals: { entries: 4, amount: '11600.00', litres: '115.000', averageRate: '100.87' },
  byFuelType: {
    DIESEL: { entries: 3, amount: '9600.00', litres: '95.000', averageRate: '101.05', share: '82.8' },
    PETROL: { entries: 1, amount: '2000.00', litres: '20.000', averageRate: '100.00', share: '17.2' },
  },
  trend: [{ bucket: '2025-06', from: '2025-06-01', to: '2025-06-30', amount: '8600.00', litres: '85.000', entries: 2 }],
  byVehicle: [{ id: 'v1', label: 'KA 22 AB 1234', entries: 2, amount: '8600.00', litres: '85.000', averageRate: '101.18', share: '74.1' }],
  byDriver: [{ id: 'd1', label: 'Ramesh Kumar', entries: 2, amount: '8600.00', litres: '85.000', averageRate: '101.18', share: '74.1' }],
  byStation: [{ id: 'IndianOil NH4', label: 'IndianOil NH4', entries: 2, amount: '10000.00', litres: '100.000', averageRate: '100.00', share: '86.2' }],
  highestSpendVehicle: null,
};

const RECORD: FuelRecord = {
  id: 'f1', date: '2025-06-10', vehicle: { id: 'v1', registrationNumber: 'KA 22 AB 1234' }, driver: { id: 'd1', name: 'Ramesh Kumar', code: 'GR-D-101' },
  fuelType: 'DIESEL', litres: '80.000', amount: '8000.00', rate: '100.00', station: 'IndianOil NH4', receiptFileId: null,
};
const page = (data: FuelRecord[], total: number, pageNo = 1): ReportPage<FuelRecord> => ({ data, page: { page: pageNo, pageSize: 25, total, pageCount: Math.ceil(total / 25) || 1 }, sort: { field: 'date', dir: 'desc' } });

const signIn = (role: ApiRole) =>
  useSession.setState({
    token: 'test-token',
    expiresAt: null,
    user: { id: 'u1', role, companyId: 'c1', employeeId: null, driverId: null, status: 'ACTIVE', mustChangePassword: false, displayName: 'Office', email: 'o@example.test', phone: null },
  });

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Toaster />
      <Routes>
        <Route path="/admin/reports/:report?" element={<ReportsConnected />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  signIn('ADMIN');
  api.meta.mockResolvedValue(META);
  api.summary.mockResolvedValue(FUEL as never);
  api.records.mockResolvedValue(page([RECORD], 1) as never);
  vi.mocked(vehiclesApi.list).mockResolvedValue({ data: [{ id: 'v1', registrationNumber: 'KA 22 AB 1234' }], page: { limit: 100, nextCursor: null } } as never);
  vi.mocked(driversApi.list).mockResolvedValue({ data: [{ id: 'd1', employee: { fullName: 'Ramesh Kumar' } }], page: { limit: 100, nextCursor: null } } as never);
  vi.mocked(employeesApi.list).mockResolvedValue({ data: [], page: { limit: 100, nextCursor: null } } as never);
});

describe('Reports (connected)', () => {
  it('shows only the reports the server says this role may open', async () => {
    api.meta.mockResolvedValue({ ...META, reports: ['overview', 'fuel', 'vehicles', 'drivers', 'expenses', 'maintenance', 'tyres', 'compliance', 'location'], visibility: { payments: false, compliance: true, location: true } });
    renderAt('/admin/reports/fuel');
    expect(await screen.findByTestId('report-tab-fuel')).toBeTruthy();
    expect(screen.queryByTestId('report-tab-finance')).toBeNull();
  });

  it('says so — rather than showing anything — when a role opens a report it may not see', async () => {
    api.meta.mockResolvedValue({ ...META, reports: ['overview', 'fuel'] });
    renderAt('/admin/reports/finance');
    expect(await screen.findByTestId('no-access')).toBeTruthy();
    expect(api.summary).not.toHaveBeenCalled();
  });

  it('renders the server’s figures for the selected financial year', async () => {
    renderAt('/admin/reports/fuel?preset=fy&fy=2025-26');
    expect((await screen.findByTestId('kpi-fuel-amount')).textContent).toContain('₹11,600');
    expect((screen.getByTestId('kpi-fuel-rate')).textContent).toContain('₹100.87/L');
    expect(api.summary).toHaveBeenCalledWith('fuel', expect.objectContaining({ preset: 'fy', fy: '2025-26' }));
    // The records table is the server's page, with exact rupees.
    const table = await screen.findByTestId('fuel-records');
    expect(within(table).getByText('₹8,000.00')).toBeTruthy();
    expect(api.records).toHaveBeenCalledWith('fuel', expect.objectContaining({ preset: 'fy', fy: '2025-26', page: 1, pageSize: 25, sort: 'date', dir: 'desc' }));
  });

  it('sends combined filters to the server', async () => {
    renderAt('/admin/reports/fuel?preset=fy&fy=2025-26');
    await screen.findByTestId('kpi-fuel-amount');
    fireEvent.change(await screen.findByTestId('filter-vehicle'), { target: { value: 'v1' } });
    fireEvent.change(screen.getByTestId('filter-fuel-type'), { target: { value: 'DIESEL' } });
    await waitFor(() => expect(api.summary).toHaveBeenLastCalledWith('fuel', expect.objectContaining({ fy: '2025-26', vehicleId: 'v1', fuelType: 'DIESEL' })));
  });

  it('shows an error with retry — never ₹0 — when the report fails to load', async () => {
    api.summary.mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'The database is unavailable.'));
    renderAt('/admin/reports/fuel');
    expect(await screen.findByText('The database is unavailable.')).toBeTruthy();
    expect(screen.queryByTestId('kpi-fuel-amount')).toBeNull();
    expect(screen.queryByText('₹0')).toBeNull();
    api.summary.mockResolvedValueOnce(FUEL as never);
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]!);
    expect((await screen.findByTestId('kpi-fuel-amount')).textContent).toContain('₹11,600');
  });

  it('pages and sorts records on the server', async () => {
    api.records.mockResolvedValue(page(Array.from({ length: 25 }, (_, i) => ({ ...RECORD, id: `f${i}` })), 60) as never);
    renderAt('/admin/reports/fuel');
    await screen.findByTestId('fuel-records');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(api.records).toHaveBeenLastCalledWith('fuel', expect.objectContaining({ page: 2 })));
    fireEvent.click(screen.getByRole('button', { name: /^Amount/ }));
    // A new sort starts again at page 1.
    await waitFor(() => expect(api.records).toHaveBeenLastCalledWith('fuel', expect.objectContaining({ sort: 'amount', dir: 'desc', page: 1 })));
  });

  it('waits for both dates of a custom range before asking for anything', async () => {
    renderAt('/admin/reports/fuel?preset=custom&from=2025-06-01');
    expect(await screen.findByText('Choose both dates to see a custom range.')).toBeTruthy();
    expect(api.summary).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('report-to'), { target: { value: '2025-06-30' } });
    await waitFor(() => expect(api.summary).toHaveBeenCalledWith('fuel', expect.objectContaining({ preset: 'custom', from: '2025-06-01', to: '2025-06-30' })));
  });

  it('reports compliance as of today, without a period', async () => {
    api.summary.mockResolvedValue({
      ...head, report: 'compliance', range: null, windowDays: 30,
      totals: { documents: 7, valid: 4, expiring: 1, expired: 2, missing: 7, pendingVerification: 4 },
      bands: { expired: 2, d7: 1, d30: 0, d60: 0, d90: 0 }, byType: [],
    } as never);
    api.records.mockResolvedValue(page([], 0) as never);
    renderAt('/admin/reports/compliance?preset=fy&fy=2025-26');
    expect((await screen.findByTestId('kpi-missing')).textContent).toContain('7');
    expect(screen.queryByTestId('report-period')).toBeNull();
    expect(api.summary).toHaveBeenCalledWith('compliance', {});
  });

  it('announces a report as ready only once the server file has arrived', async () => {
    let finish: (value: 'saved') => void = () => {};
    vi.mocked(downloadReport).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderAt('/admin/reports/fuel?preset=fy&fy=2025-26');
    await screen.findByTestId('kpi-fuel-amount');
    fireEvent.pointerDown(screen.getByTestId('report-export'), { button: 0, pointerType: 'mouse' });
    fireEvent.click(await screen.findByTestId('report-export-xlsx'));
    expect(downloadReport).toHaveBeenCalledWith('fuel', expect.objectContaining({ preset: 'fy', fy: '2025-26' }), 'xlsx');
    expect(await screen.findAllByText('Preparing report…')).not.toHaveLength(0);
    expect(screen.queryByText('Report ready')).toBeNull();
    finish('saved');
    expect(await screen.findByText('Report ready')).toBeTruthy();
  });

  it('surfaces the server’s reason when an export is refused', async () => {
    vi.mocked(downloadReport).mockRejectedValue(new ApiError(400, 'EXPORT_TOO_LARGE', 'This export has 60,000 records. Narrow the date range or filters and try again.'));
    renderAt('/admin/reports/fuel');
    await screen.findByTestId('kpi-fuel-amount');
    fireEvent.pointerDown(screen.getByTestId('report-export'), { button: 0, pointerType: 'mouse' });
    fireEvent.click(await screen.findByTestId('report-export-csv'));
    const message = await screen.findByText(/Narrow the date range/);
    // The refusal is an error toast; nothing claims the file is ready.
    expect(message.closest('[data-sonner-toast]')?.getAttribute('data-type')).toBe('error');
  });
});
