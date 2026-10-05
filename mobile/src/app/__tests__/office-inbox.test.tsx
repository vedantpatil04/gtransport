import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { initI18n } from '../../i18n';
import { officeApi, type OfficeInboxDetail, type OfficeInboxMessage } from '../../lib/api/office';
import { useSession } from '../../lib/auth/session-store';
import type { SessionUser, UserRole } from '../../types/domain';
import OfficeInbox from '../office/inbox';

jest.mock('../../lib/api/office', () => ({
  officeApi: {
    inboxStatus: jest.fn(),
    inboxMessages: jest.fn(),
    inboxMessage: jest.fn(),
    inboxSync: jest.fn(),
    inboxSetStatus: jest.fn(),
  },
}));

const api = jest.mocked(officeApi);

const mockMessages: OfficeInboxMessage[] = [
  {
    id: 'msg-1',
    subject: 'Monthly Service Bill Tata Prima',
    from: { name: 'Tata Motors Belagavi', address: 'service@tatamotors.com' },
    receivedAt: new Date().toISOString(),
    status: 'UNREAD',
    classification: 'MAINTENANCE',
    classificationConfirmed: true,
    aiStatus: 'COMPLETED',
    attachmentCount: 1,
    hasHtml: false,
    provider: 'GMAIL',
    aiSummary: 'Invoice for routine brake pad replacement: ₹8,500',
    aiConfidence: 0.94,
  },
  {
    id: 'msg-2',
    subject: 'Insurance Policy Renewal Reminder',
    from: { name: 'National Insurance', address: 'noreply@nic.in' },
    receivedAt: new Date(Date.now() - 86400000).toISOString(),
    status: 'READ',
    classification: 'VEHICLE_DOCUMENT',
    classificationConfirmed: false,
    aiStatus: 'COMPLETED',
    attachmentCount: 0,
    hasHtml: false,
    provider: 'GMAIL',
    aiSummary: null,
    aiConfidence: null,
  },
];

const mockDetail: OfficeInboxDetail = {
  id: 'msg-1',
  provider: 'GMAIL',
  mailbox: 'dispatch@gangamata.in',
  threadId: 'th-1',
  from: { name: 'Tata Motors Belagavi', address: 'service@tatamotors.com' },
  to: ['dispatch@gangamata.in'],
  cc: [],
  subject: 'Monthly Service Bill Tata Prima',
  receivedAt: new Date().toISOString(),
  filedAt: new Date().toISOString(),
  bodyText: 'Dear Gangamata Transport, please find attached the invoice for vehicle KA-22-A-1234.',
  bodyTruncated: false,
  hasHtml: false,
  labels: ['INBOX'],
  status: 'UNREAD',
  classification: 'MAINTENANCE',
  classificationConfirmed: true,
  classifiedAt: new Date().toISOString(),
  ai: { status: 'COMPLETED', attempts: 1, failureCode: null, failureMessage: null, nextAttemptAt: null },
  attachments: [
    { id: 'att-1', filename: 'invoice-ka22.pdf', mimeType: 'application/pdf', sizeBytes: 102400, stored: true, skipReason: null },
    { id: 'att-2', filename: 'invoice.pdf.exe', mimeType: 'application/pdf', sizeBytes: 2048, stored: false, skipReason: 'suspicious_extension' },
  ],
  aiResults: [{ summary: 'Invoice for routine brake pad replacement: ₹8,500', confidence: 0.94 }],
};

const user = (role: UserRole): SessionUser => ({
  id: 'u1', role, companyId: 'c1', employeeId: 'e1', driverId: null, status: 'ACTIVE', mustChangePassword: false,
  displayName: 'Admin User', email: 'admin@gangamata.in', phone: '+919845012306',
});

const signInAs = (role: UserRole) =>
  useSession.setState({ status: 'signedIn', token: 'mock-token', user: user(role), role, driver: null, expiredMessage: false });

describe('OfficeInbox screen', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    api.inboxStatus.mockResolvedValue({
      configured: true,
      mailbox: 'dispatch@gangamata.in',
      lastSyncFinishedAt: new Date().toISOString(),
      lastError: null,
      consecutiveFailures: 0,
    });
    api.inboxMessages.mockResolvedValue({ data: mockMessages, page: { limit: 25, nextCursor: null } });
    api.inboxMessage.mockResolvedValue(mockDetail);
    api.inboxSync.mockResolvedValue({ ok: true, created: 1, fetched: 5 });
    api.inboxSetStatus.mockResolvedValue(undefined);
  });

  it('renders inbox messages list and mailbox status for ADMIN', async () => {
    signInAs('ADMIN');
    await render(<OfficeInbox />);

    expect(await screen.findByTestId('office-inbox')).toBeTruthy();
    expect(await screen.findByText('Monthly Service Bill Tata Prima')).toBeTruthy();
    expect(await screen.findByTestId('inbox-message-msg-1')).toBeTruthy();
    expect(await screen.findByTestId('inbox-message-msg-2')).toBeTruthy();
    expect(api.inboxMessages).toHaveBeenCalledWith('mock-token', expect.any(Object));
  });

  it('opens message detail modal when tapping on a message card', async () => {
    signInAs('ADMIN');
    await render(<OfficeInbox />);

    const card = await screen.findByTestId('inbox-message-msg-1');
    fireEvent.press(card);

    expect(await screen.findByTestId('inbox-message-detail')).toBeTruthy();
    expect(await screen.findByTestId('inbox-ai-summary')).toBeTruthy();
    expect(screen.getByText('📎 invoice-ka22.pdf')).toBeTruthy();
  });

  it('triggers inbox sync when tapping Check Now button', async () => {
    signInAs('ADMIN');
    await render(<OfficeInbox />);

    const syncBtn = await screen.findByTestId('inbox-check-now');
    fireEvent.press(syncBtn);

    expect(api.inboxSync).toHaveBeenCalledWith('mock-token');
  });

  it('shows the office categories by name', async () => {
    signInAs('ADMIN');
    await render(<OfficeInbox />);
    // The same names as the office web console's mailbox.
    expect(await screen.findByText('Maintenance / service')).toBeTruthy();
    expect(await screen.findByText('Vehicle papers')).toBeTruthy();
  });

  it('says why an attachment was not kept', async () => {
    signInAs('ADMIN');
    await render(<OfficeInbox />);
    fireEvent.press(await screen.findByTestId('inbox-message-msg-1'));
    expect(await screen.findByText('Refused: this kind of file is not accepted')).toBeTruthy();
  });

  it('reports a failed check as a failure, never as done', async () => {
    signInAs('ADMIN');
    api.inboxSync.mockResolvedValue({ ok: false, reason: 'Google refused the stored authorisation. Connect the mailbox again.', created: 0, fetched: 0 });
    await render(<OfficeInbox />);
    fireEvent.press(await screen.findByTestId('inbox-check-now'));
    expect(await screen.findByText(/Connect the mailbox again/)).toBeTruthy();
  });

  it('tells the office what a successful check filed', async () => {
    signInAs('MANAGER');
    await render(<OfficeInbox />);
    fireEvent.press(await screen.findByTestId('inbox-check-now'));
    expect(await screen.findByText('Filed 1 new message.')).toBeTruthy();
  });

  it('does not offer accounting a mailbox check the API would refuse', async () => {
    signInAs('ACCOUNTING');
    await render(<OfficeInbox />);
    expect(await screen.findByTestId('inbox-message-msg-1')).toBeTruthy();
    expect(screen.queryByTestId('inbox-check-now')).toBeNull();
  });

  it('says why nothing is being read when no mailbox is connected', async () => {
    signInAs('ADMIN');
    api.inboxStatus.mockResolvedValue({
      configured: false,
      mailbox: null,
      unavailableReason: 'The company mailbox has not been connected yet. An administrator can connect it from the Inbox.',
      lastSyncFinishedAt: null,
      lastError: null,
      consecutiveFailures: 0,
    });
    await render(<OfficeInbox />);
    expect(await screen.findByText(/has not been connected yet/)).toBeTruthy();
  });

  it('filters messages by status filter tabs', async () => {
    signInAs('ADMIN');
    await render(<OfficeInbox />);

    const unreadTab = await screen.findByTestId('inbox-filter-UNREAD');
    fireEvent.press(unreadTab);

    await waitFor(() => {
      expect(api.inboxMessages).toHaveBeenCalledWith('mock-token', expect.objectContaining({ status: 'UNREAD' }));
    });
  });
});
