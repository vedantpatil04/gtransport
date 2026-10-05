import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { documentsApi, fleetApi, inboxApi, paymentsApi } from '@/features/api/resources';
import { useSession, type ApiRole } from '@/features/api/session';
import { ApiError } from '@/lib/api/client';
import { AttentionProvider } from '../useAdminBadges';
import { AttentionList, LiveNotificationsPopover } from './LiveNotifications';

vi.mock('@/features/api/mode', () => ({ isApiConfigured: () => true, useConnected: () => true }));
vi.mock('@/features/api/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/api/resources')>()),
  documentsApi: { summary: vi.fn() },
  paymentsApi: { summary: vi.fn() },
  fleetApi: { alertSummary: vi.fn() },
  inboxApi: { summary: vi.fn() },
}));

const docs = vi.mocked(documentsApi);
const pays = vi.mocked(paymentsApi);
const fleet = vi.mocked(fleetApi);
const inbox = vi.mocked(inboxApi);

const signIn = (role: ApiRole) =>
  useSession.setState({
    token: 'test-token',
    expiresAt: null,
    user: { id: 'u1', role, companyId: 'c1', employeeId: null, driverId: null, status: 'ACTIVE', mustChangePassword: false, displayName: 'Office', email: 'o@example.test', phone: null },
  });

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderWith(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <AttentionProvider>
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
        <Where />
      </AttentionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  docs.summary.mockResolvedValue([
    { type: 'INSURANCE', expired: 2, within7Days: 1, expiringSoon: 1, valid: 1, pendingVerification: 0, notUploaded: 0 },
  ]);
  pays.summary.mockResolvedValue({ byStatus: { PENDING_APPROVAL: { count: 3, amount: '9000.00' }, FAILED: { count: 1, amount: '500.00' } }, paidThisMonth: { count: 0, amount: '0' } });
  fleet.alertSummary.mockResolvedValue({ active: 1, acknowledged: 0, needsAttention: 1 });
  inbox.summary.mockResolvedValue({ unread: 5, total: 9, needingAttention: 2, pendingSuggestions: 0, byClassification: {} });
});

describe('live notifications', () => {
  it('lists what needs attention from the live summaries, each opening its screen', async () => {
    signIn('ADMIN');
    renderWith(<AttentionList />);

    const list = await screen.findByTestId('attention-list');
    expect(within(list).getByText('2 documents have expired')).toBeTruthy();
    expect(within(list).getByText('1 document expires within 7 days')).toBeTruthy();
    expect(within(list).getByText('3 payments are waiting for approval')).toBeTruthy();
    expect(within(list).getByText('1 payment failed or needs a status check')).toBeTruthy();
    expect(within(list).getByText('1 driver has stopped too long')).toBeTruthy();
    expect(within(list).getByText('2 emails need attention')).toBeTruthy();

    fireEvent.click(screen.getByTestId('attention-paymentsApproval'));
    expect(screen.getByTestId('where').textContent).toBe('/admin/finance/payments?status=PENDING_APPROVAL');
  });

  it('never asks for payroll figures a manager may not see', async () => {
    signIn('MANAGER');
    renderWith(<AttentionList />);

    await screen.findByTestId('attention-list');
    expect(pays.summary).not.toHaveBeenCalled();
    expect(screen.queryByTestId('attention-paymentsApproval')).toBeNull();
    expect(screen.getByTestId('attention-documentsExpired')).toBeTruthy();
  });

  it('says all is clear only when every source answered with nothing', async () => {
    signIn('ADMIN');
    docs.summary.mockResolvedValue([]);
    pays.summary.mockResolvedValue({ byStatus: {}, paidThisMonth: { count: 0, amount: '0' } });
    fleet.alertSummary.mockResolvedValue({ active: 0, acknowledged: 0, needsAttention: 0 });
    inbox.summary.mockResolvedValue({ unread: 0, total: 0, needingAttention: 0, pendingSuggestions: 0, byClassification: {} });
    renderWith(<AttentionList />);

    expect(await screen.findByTestId('attention-clear')).toBeTruthy();
  });

  it('shows a failed source as a failure with a retry, never as all clear', async () => {
    signIn('ADMIN');
    docs.summary.mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'Service unavailable'));
    fleet.alertSummary.mockResolvedValue({ active: 0, acknowledged: 0, needsAttention: 0 });
    inbox.summary.mockResolvedValue({ unread: 0, total: 0, needingAttention: 0, pendingSuggestions: 0, byClassification: {} });
    pays.summary.mockResolvedValue({ byStatus: {}, paidThisMonth: { count: 0, amount: '0' } });
    renderWith(<AttentionList />);

    expect(await screen.findByTestId('attention-failed')).toBeTruthy();
    expect(screen.queryByTestId('attention-clear')).toBeNull();

    docs.summary.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('attention-clear')).toBeTruthy();
  });

  it('puts a live count on the header bell', async () => {
    signIn('ADMIN');
    renderWith(<LiveNotificationsPopover />);

    // 2 expired + 1 due soon + 1 payment check + 3 approvals + 1 stationary + 2 emails
    await waitFor(() => expect(screen.getByTestId('admin-bell-count').textContent).toBe('10'));
  });
});
