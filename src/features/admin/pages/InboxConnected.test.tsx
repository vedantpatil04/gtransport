import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxApi, vehiclesApi } from '@/features/api/resources';
import { useSession, type ApiRole } from '@/features/api/session';
import type { ApiInboxMessage, ApiInboxStatusInfo } from '@/features/api/types';
import { InboxConnected } from './InboxConnected';

vi.mock('@/features/api/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/api/resources')>()),
  inboxApi: {
    status: vi.fn(), summary: vi.fn(), list: vi.fn(), get: vi.fn(), sync: vi.fn(), verifyConnection: vi.fn(), setStatus: vi.fn(),
    classify: vi.fn(), retryAI: vi.fn(), authorize: vi.fn(), disconnect: vi.fn(), suggestions: vi.fn(), acceptSuggestion: vi.fn(),
    rejectSuggestion: vi.fn(),
  },
  vehiclesApi: { list: vi.fn() },
}));

const api = vi.mocked(inboxApi);

function status(connection: ApiInboxStatusInfo['connection'], configured: boolean): ApiInboxStatusInfo {
  return {
    configured,
    provider: connection.provider,
    mailbox: configured ? 'accounts@gangamata.example/INBOX' : null,
    unavailableReason: configured ? null : 'The company mailbox has not been connected yet. An administrator can connect it from the Inbox.',
    connection,
    syncEnabled: true,
    aiEnabled: true,
    lastSyncStartedAt: null,
    lastSyncFinishedAt: null,
    lastError: null,
    consecutiveFailures: 0,
    nextAttemptAt: null,
    messagesSynced: 0,
  };
}

const CONNECTED = status(
  {
    mode: 'oauth',
    provider: 'GMAIL',
    canConnect: true,
    connection: {
      status: 'CONNECTED', emailAddress: 'accounts@gangamata.example', scopes: [], connectedAt: '2026-03-01T00:00:00Z',
      connectedById: 'u1', disconnectedAt: null, lastError: null, lastErrorAt: null, authorizationPending: false,
    },
  },
  true,
);

const MESSAGE: ApiInboxMessage = {
  id: 'msg-1', provider: 'GMAIL', mailbox: 'accounts@gangamata.example/INBOX', threadId: 't1',
  from: { address: 'billing@sharmaauto.example', name: 'Sharma Auto Works' }, to: [], cc: [], subject: 'Invoice INV-2291',
  receivedAt: '2026-03-04T10:00:00Z', filedAt: '2026-03-04T10:05:00Z', bodyText: 'Invoice attached.', bodyTruncated: false,
  hasHtml: false, labels: [], sizeBytes: 100, authenticationResults: null, status: 'UNREAD', classification: 'MAINTENANCE',
  classificationConfirmed: false, classifiedAt: null,
  ai: { status: 'COMPLETED', attempts: 1, failureCode: null, failureMessage: null, nextAttemptAt: null },
  attachments: [{ id: 'att-1', filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 4096, stored: true, skipReason: null, downloadAttempts: 1 }],
  aiResults: [],
  suggestions: [
    {
      id: 'sug-1', messageId: 'msg-1', resultId: 'res-1', type: 'CREATE_SERVICE_RECORD', status: 'PENDING', reason: 'A workshop invoice.',
      details: { vehicleRegistration: 'KA22AB1234', amount: 2596, date: '2026-03-04', reference: 'INV-2291' },
      attachment: { id: 'att-1', filename: 'invoice.pdf', mimeType: 'application/pdf', stored: true },
      decidedAt: null, decidedById: null, decisionNote: null, result: null, createdAt: '2026-03-04T10:06:00Z',
    },
    {
      id: 'sug-2', messageId: 'msg-1', resultId: 'res-1', type: 'REVIEW_PAYMENT', status: 'PENDING', reason: 'Payment requested.',
      details: { vehicleRegistration: null, amount: null, date: null, reference: null },
      attachment: null, decidedAt: null, decidedById: null, decisionNote: null, result: null, createdAt: '2026-03-04T10:06:00Z',
    },
  ],
};

const signIn = (role: ApiRole) =>
  useSession.setState({
    token: 'test-token',
    expiresAt: null,
    user: { id: 'u1', role, companyId: 'c1', employeeId: null, driverId: null, status: 'ACTIVE', mustChangePassword: false, displayName: 'Office', email: 'o@example.test', phone: null },
  });

const renderInbox = () =>
  render(
    <MemoryRouter>
      <InboxConnected />
    </MemoryRouter>,
  );

beforeEach(() => {
  signIn('ADMIN');
  for (const fn of Object.values(api)) fn.mockReset();
  api.summary.mockResolvedValue({ unread: 1, total: 1, needingAttention: 1, pendingSuggestions: 2, byClassification: {} });
  api.list.mockResolvedValue({
    data: [
      {
        id: 'msg-1', from: MESSAGE.from, subject: MESSAGE.subject, receivedAt: MESSAGE.receivedAt, status: 'UNREAD', classification: 'MAINTENANCE',
        classificationConfirmed: false, aiStatus: 'COMPLETED', attachmentCount: 1, pendingSuggestions: 2, hasHtml: false, provider: 'GMAIL',
        aiSummary: 'A workshop invoice.', aiConfidence: 0.9,
      },
    ],
    page: { limit: 50, nextCursor: null },
  });
  api.get.mockResolvedValue(MESSAGE);
  vi.mocked(vehiclesApi.list).mockReset().mockResolvedValue({
    data: [{ id: 'veh-1', registrationNumber: 'KA 22 AB 1234' }] as never,
    page: { limit: 100, nextCursor: null },
  });
});

afterEach(() => vi.restoreAllMocks());

describe('InboxConnected — the mailbox connection', () => {
  it('offers an administrator the consent screen when no mailbox is connected, and says nothing is being read', async () => {
    api.status.mockResolvedValue(status({ mode: 'oauth', provider: 'GMAIL', canConnect: true, connection: null }, false));
    api.authorize.mockResolvedValue({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', provider: 'GMAIL', expiresAt: '' });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });

    renderInbox();
    const panel = await screen.findByTestId('mailbox-connection');
    expect(within(panel).getByText('Not connected')).toBeTruthy();
    expect(within(panel).getByText(/has not been connected yet/)).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Connect Gmail' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'));
    vi.unstubAllGlobals();
  });

  it('does not offer connecting to someone who cannot administer it', async () => {
    signIn('MANAGER');
    api.status.mockResolvedValue(status({ mode: 'oauth', provider: 'GMAIL', canConnect: true, connection: null }, false));
    renderInbox();
    const panel = await screen.findByTestId('mailbox-connection');
    expect(within(panel).queryByRole('button')).toBeNull();
  });

  it('says plainly when the mailbox must be connected again', async () => {
    api.status.mockResolvedValue(
      status(
        {
          mode: 'oauth',
          provider: 'MICROSOFT_GRAPH',
          canConnect: true,
          connection: { ...CONNECTED.connection.connection!, status: 'REAUTHORIZATION_REQUIRED', lastError: 'Microsoft refused the stored authorisation.' },
        },
        false,
      ),
    );
    renderInbox();
    const panel = await screen.findByTestId('mailbox-connection');
    expect(within(panel).getByText('Needs connecting again')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Connect again' })).toBeTruthy();
  });

  it('asks before disconnecting', async () => {
    api.status.mockResolvedValue(CONNECTED);
    api.disconnect.mockResolvedValue({ status: 'DISCONNECTED', revokedAtProvider: true });
    renderInbox();
    const panel = await screen.findByTestId('mailbox-connection');
    expect(within(panel).getByText('Reading accounts@gangamata.example', { exact: false })).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Disconnect' }));
    expect(api.disconnect).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole('button', { name: 'Yes, disconnect' }));
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledTimes(1));
  });
});

describe('InboxConnected — suggestions', () => {
  it('turns a workshop invoice into a service record only with the checked figures', async () => {
    api.status.mockResolvedValue(CONNECTED);
    api.acceptSuggestion.mockResolvedValue({ ...MESSAGE.suggestions[0]!, status: 'ACCEPTED' });
    renderInbox();

    fireEvent.click(await screen.findByText('Invoice INV-2291'));
    const card = (await screen.findByText('Record as a service bill')).closest('.rounded-lg') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }));

    // The registration the model read is matched to the fleet vehicle; the person still confirms it.
    await waitFor(() => expect((within(card).getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('veh-1'));
    fireEvent.click(within(card).getByRole('button', { name: 'Create service record' }));

    await waitFor(() => expect(api.acceptSuggestion).toHaveBeenCalledTimes(1));
    expect(api.acceptSuggestion.mock.calls[0]).toEqual([
      'sug-1',
      { note: undefined, serviceRecord: { vehicleId: 'veh-1', amount: 2596, expenseDate: '2026-03-04', vendorName: 'Sharma Auto Works', attachmentId: 'att-1' } },
    ]);
  });

  it('leaves a payment matter to accounts', async () => {
    signIn('MANAGER');
    api.status.mockResolvedValue(CONNECTED);
    renderInbox();
    fireEvent.click(await screen.findByText('Invoice INV-2291'));

    const payment = (await screen.findByText('For accounts: payment matter')).closest('.rounded-lg') as HTMLElement;
    expect(within(payment).queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(within(payment).getByText('Someone in another role decides this one.')).toBeTruthy();
  });
});
