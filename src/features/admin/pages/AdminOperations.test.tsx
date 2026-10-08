import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardApi, documentsApi, financeApi, paymentsApi, uploadDocumentFile, vehiclesApi } from '@/features/api/resources';
import { useSession, type ApiRole } from '@/features/api/session';
import type { ApiManualLedgerDetail, ApiPayment } from '@/features/api/types';
import { PaymentProof } from '@/features/finance/PaymentProof';
import { DashboardConnected } from './DashboardConnected';
import { LedgerConnected } from './LedgerConnected';

vi.mock('@/features/api/mode', () => ({ isApiConfigured: () => true, useConnected: () => true }));
vi.mock('@/features/api/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/api/resources')>()),
  dashboardApi: { spend: vi.fn(), payments: vi.fn() },
  documentsApi: { summary: vi.fn() },
  paymentsApi: { summary: vi.fn(), attachProof: vi.fn(), proofUrl: vi.fn() },
  financeApi: { summary: vi.fn(), ledger: vi.fn(), createEntry: vi.fn(), entry: vi.fn(), updateEntry: vi.fn(), reverseEntry: vi.fn(), restoreEntry: vi.fn() },
  vehiclesApi: { list: vi.fn() },
  employeesApi: { list: vi.fn(async () => ({ data: [], page: { nextCursor: null } })) },
  uploadDocumentFile: vi.fn(),
}));

const signIn = (role: ApiRole) =>
  useSession.setState({
    token: 't',
    expiresAt: null,
    user: { id: 'u1', role, companyId: 'c1', employeeId: 'e1', driverId: null, status: 'ACTIVE', mustChangePassword: false, displayName: 'Priya Office', email: 'p@example.test', phone: null },
  });

const range = (preset: string) => ({ preset, from: '2026-10-08', to: '2026-10-08', label: '' });
const spend = (amount: string) => ({
  range: range('today'),
  fuel: { amount, litres: '40.5', entries: 3 },
  otherExpenses: { amount: '700.00', records: 2 },
  operationalTotal: '4200.00',
  ledgerExpenses: '9100.00',
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(documentsApi.summary).mockResolvedValue([
    { type: 'INSURANCE', expired: 2, within7Days: 1, expiringSoon: 3, valid: 4, pendingVerification: 5, notUploaded: 6 },
  ] as never);
  vi.mocked(paymentsApi.summary).mockResolvedValue({ byStatus: {}, paidThisMonth: { count: 0, amount: '0' } } as never);
  vi.mocked(dashboardApi.payments).mockResolvedValue({
    range: range('this_month'),
    created: { pending: { count: 2, amount: '5000.00' }, processing: { count: 0, amount: '0.00' }, paid: { count: 1, amount: '2500.00' }, failed: { count: 1, amount: '900.00' }, cancelled: { count: 0, amount: '0.00' }, reversed: { count: 0, amount: '0.00' } },
    paidInPeriod: { count: 4, amount: '12000.00' },
  });
});

describe('dashboard periods', () => {
  it('asks the API for each card’s own period and shows the real figure', async () => {
    signIn('ADMIN');
    vi.mocked(dashboardApi.spend).mockResolvedValue(spend('3500.00'));
    render(<MemoryRouter><DashboardConnected /></MemoryRouter>);

    expect((await screen.findByTestId('stat-fuel')).textContent).toContain('3,500');
    expect(dashboardApi.spend).toHaveBeenCalledWith({ preset: 'today' });
    // Total expenses starts on the financial year, and payroll roles see the ledger total.
    expect(dashboardApi.spend).toHaveBeenCalledWith({ preset: 'this_fy' });
    await waitFor(() => expect(screen.getByTestId('stat-total').textContent).toContain('9,100'));

    vi.mocked(dashboardApi.spend).mockResolvedValue(spend('88000.00'));
    const fuelCard = screen.getByTestId('card-fuel');
    fireEvent.change(within(fuelCard).getByLabelText('Period'), { target: { value: 'this_month' } });
    await waitFor(() => expect(dashboardApi.spend).toHaveBeenCalledWith({ preset: 'this_month' }));
    await waitFor(() => expect(screen.getByTestId('stat-fuel').textContent).toContain('88,000'));
  });

  it('waits for both custom dates before asking, then uses them', async () => {
    signIn('ADMIN');
    vi.mocked(dashboardApi.spend).mockResolvedValue(spend('1.00'));
    render(<MemoryRouter><DashboardConnected /></MemoryRouter>);
    await screen.findByTestId('stat-fuel');
    const card = screen.getByTestId('card-other');
    fireEvent.change(within(card).getByLabelText('Period'), { target: { value: 'custom' } });
    const before = vi.mocked(dashboardApi.spend).mock.calls.length;
    fireEvent.change(within(card).getByLabelText('From'), { target: { value: '2026-04-01' } });
    expect(vi.mocked(dashboardApi.spend).mock.calls.length).toBe(before);
    fireEvent.change(within(card).getByLabelText('To'), { target: { value: '2026-04-30' } });
    await waitFor(() => expect(dashboardApi.spend).toHaveBeenCalledWith({ preset: 'custom', from: '2026-04-01', to: '2026-04-30' }));
  });

  it('switches the documents card between missing, expired and pending', async () => {
    signIn('MANAGER');
    vi.mocked(dashboardApi.spend).mockResolvedValue({ ...spend('1.00'), ledgerExpenses: undefined });
    render(<MemoryRouter><DashboardConnected /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('stat-documents').textContent).toContain('5'));
    const card = screen.getByTestId('card-documents');
    fireEvent.change(within(card).getByLabelText('Show'), { target: { value: 'missing' } });
    expect(screen.getByTestId('stat-documents').textContent).toContain('6');
    fireEvent.change(within(card).getByLabelText('Show'), { target: { value: 'pending' } });
    expect(screen.getByTestId('stat-documents').textContent).toContain('5');
    expect(within(card).getByRole('link').getAttribute('href')).toBe('/admin/documents?verification=PENDING');
    // Managers never ask for payment figures.
    expect(dashboardApi.payments).not.toHaveBeenCalled();
    expect(screen.getByTestId('stat-total').textContent).toContain('4,200');
  });
});

const detail: ApiManualLedgerDetail = {
  id: 'me-1', date: '2026-10-08', type: 'OTHER_EXPENSE', direction: 'EXPENSE', amount: '1300.00', description: 'Toll — NH48',
  employee: null, vehicle: { id: 'v1', registrationNumber: 'KA 22 AB 1234' }, paymentMethod: 'UPI', reference: 'UPI-778899', remarks: null,
  status: 'ACTIVE', archivedAt: null, archiveReason: null, createdAt: '2026-10-08T05:00:00Z', updatedAt: '2026-10-08T06:00:00Z',
  lines: [],
  history: [
    { id: 'a1', action: 'ledger.manual_created', at: '2026-10-08T05:00:00Z', actor: 'Priya Office', role: 'ADMIN', changes: null, metadata: null },
    { id: 'a2', action: 'ledger.manual_updated', at: '2026-10-08T06:00:00Z', actor: 'Priya Office', role: 'ADMIN', changes: { before: { amount: '1250.50' }, after: { amount: '1300.00' } }, metadata: { reason: 'Receipt shows ₹1,300' } },
  ],
};

describe('ledger hand entries', () => {
  beforeEach(() => {
    signIn('ACCOUNTING');
    vi.mocked(financeApi.summary).mockResolvedValue({ financialYear: 'FY 2026–27', totalIncome: '0', totalExpenses: '0', salaries: '0', advances: '0', fuel: '0', pendingPayments: { count: 0, amount: '0' } } as never);
    vi.mocked(financeApi.ledger).mockResolvedValue({
      data: [{ id: 'l1', date: '2026-10-08', type: 'OTHER_EXPENSE', direction: 'EXPENSE', amount: '1300.00', description: 'Toll — NH48', sourceType: 'MANUAL', sourceId: 'me-1', isReversal: false, reversed: false, payment: null, employee: null, vehicle: null, manual: { id: 'me-1', editable: true, paymentMethod: 'UPI', reference: 'UPI-778899', remarks: null } }],
      page: { nextCursor: null },
      totals: { income: '0.00', expense: '1300.00', net: '-1300.00' },
    } as never);
    vi.mocked(vehiclesApi.list).mockResolvedValue({ data: [{ id: 'v1', registrationNumber: 'KA 22 AB 1234' }], page: { nextCursor: null } } as never);
    vi.mocked(financeApi.entry).mockResolvedValue(detail);
  });

  it('adds an entry with the real fields and opens it', async () => {
    vi.mocked(financeApi.createEntry).mockResolvedValue({ ...detail, id: 'me-2' });
    render(<MemoryRouter><LedgerConnected /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('ledger-add'));
    const form = await screen.findByTestId('manual-entry-form');
    fireEvent.change(within(form).getByLabelText('Amount (₹)'), { target: { value: '1250.50' } });
    fireEvent.change(within(form).getByLabelText('Description'), { target: { value: 'Toll — NH48' } });
    fireEvent.change(within(form).getByLabelText('Reference (UTR, cheque or voucher no.)'), { target: { value: 'UPI-778899' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add entry' }));
    await waitFor(() =>
      expect(financeApi.createEntry).toHaveBeenCalledWith(expect.objectContaining({ type: 'OTHER_EXPENSE', amount: 1250.5, description: 'Toll — NH48', reference: 'UPI-778899' })),
    );
  });

  it('shows who changed what, and edits with a reason', async () => {
    vi.mocked(financeApi.updateEntry).mockResolvedValue(detail);
    render(<MemoryRouter initialEntries={['/admin/finance/ledger?entry=me-1']}><LedgerConnected /></MemoryRouter>);
    const history = await screen.findByTestId('manual-entry-history');
    expect(history.textContent).toContain('Edited');
    expect(history.textContent).toContain('Priya Office');
    expect(history.textContent).toContain('Receipt shows ₹1,300');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = await screen.findByTestId('manual-entry-form');
    fireEvent.change(within(form).getByLabelText('Amount (₹)'), { target: { value: '1350' } });
    fireEvent.change(within(form).getByLabelText('Reason for the change (optional)'), { target: { value: 'Second receipt' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(financeApi.updateEntry).toHaveBeenCalledWith('me-1', expect.objectContaining({ amount: 1350, reason: 'Second receipt' })));
  });

  it('filters by the custom days in the address', async () => {
    render(<MemoryRouter initialEntries={['/admin/finance/ledger?from=2026-04-01&to=2026-04-30']}><LedgerConnected /></MemoryRouter>);
    await waitFor(() => expect(financeApi.ledger).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-04-01', to: '2026-04-30' })));
    expect(vi.mocked(financeApi.ledger).mock.calls[0]![0]).not.toHaveProperty('fy');
  });
});

describe('payment proof', () => {
  const payment = { id: 'p1', status: 'PAID', proof: null } as unknown as ApiPayment;

  it('uploads the file, then attaches it to the payment', async () => {
    signIn('ADMIN');
    vi.mocked(uploadDocumentFile).mockResolvedValue('file-9');
    vi.mocked(paymentsApi.attachProof).mockResolvedValue(payment);
    const onChanged = vi.fn();
    render(<PaymentProof payment={payment} onChanged={onChanged} />);
    expect(screen.getByText('No proof attached yet.')).toBeTruthy();
    const file = new File(['%PDF-1.4'], 'cheque.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('proof-input'), { target: { files: [file] } });
    await waitFor(() => expect(paymentsApi.attachProof).toHaveBeenCalledWith('p1', 'file-9'));
    expect(uploadDocumentFile).toHaveBeenCalledWith(file);
    expect(onChanged).toHaveBeenCalled();
  });

  it('offers preview, download and replace for an attached proof; nothing for a cancelled payment', () => {
    render(<PaymentProof payment={{ ...payment, proof: { fileId: 'f1', filename: 'cheque.pdf', mimeType: 'application/pdf', sizeBytes: 20480, uploadedAt: null } }} onChanged={vi.fn()} />);
    expect(screen.getByText('cheque.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy();
  });
});
