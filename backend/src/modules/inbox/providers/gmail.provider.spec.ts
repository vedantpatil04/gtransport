import { EmailProviderError } from '../email-provider';
import type { FetchLike } from '../oauth/oauth-client';
import { GmailEmailProvider } from './gmail.provider';

/**
 * The Gmail adapter against a scripted Gmail API. The adapter, its cursor handling, its parsing and
 * its error mapping are the production code; only the HTTP transport is replaced (§36).
 */

const b64url = (text: string | Buffer) => Buffer.from(text).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function message(id: string, overrides: { subject?: string; html?: boolean; attachment?: boolean; date?: number } = {}) {
  const body = overrides.html
    ? { partId: '0', mimeType: 'text/html', body: { size: 40, data: b64url('<p>Invoice <b>INV-2291</b> attached</p>') } }
    : { partId: '0', mimeType: 'text/plain', body: { size: 30, data: b64url('Invoice INV-2291 attached.') } };
  return {
    id,
    threadId: `t-${id}`,
    labelIds: ['INBOX', 'UNREAD'],
    internalDate: String(overrides.date ?? Date.parse('2026-03-04T10:00:00Z')),
    sizeEstimate: 2048,
    payload: {
      partId: '',
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: '"Sharma Auto Works" <billing@sharmaauto.example>' },
        { name: 'To', value: 'accounts@gangamata.example' },
        { name: 'Subject', value: overrides.subject ?? `Invoice ${id}` },
        { name: 'Message-ID', value: `<${id}@sharmaauto.example>` },
        { name: 'Authentication-Results', value: 'mx.google.com; spf=pass; dkim=pass' },
      ],
      parts: [
        body,
        ...(overrides.attachment
          ? [{ partId: '1', mimeType: 'application/pdf', filename: 'invoice.pdf', body: { size: 3, attachmentId: `att-${id}-volatile` } }]
          : []),
      ],
    },
  };
}

function gmail(routes: (url: URL, attempt: number) => Response | undefined) {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const fetch: FetchLike = async (input) => {
    calls.push(input);
    const url = new URL(input);
    const key = url.pathname;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const response = routes(url, counts.get(key)!);
    if (!response) throw new Error(`unscripted request: ${input}`);
    return response;
  };
  const tokens = { getAccessToken: jest.fn().mockResolvedValue('access-token') };
  const provider = new GmailEmailProvider({ account: 'accounts@gangamata.example', tokens, initialSyncDays: 30, maxBodyChars: 20_000, fetch });
  return { provider, calls, tokens };
}

describe('GmailEmailProvider', () => {
  it('lists the inbox page by page on first sync, then switches to the change feed', async () => {
    const { provider, calls } = gmail((url) => {
      if (url.pathname.endsWith('/profile')) return json(200, { emailAddress: 'accounts@gangamata.example', historyId: '1000' });
      if (url.pathname.endsWith('/messages') && !url.searchParams.get('pageToken')) {
        return json(200, { messages: [{ id: 'm2' }, { id: 'm1' }], nextPageToken: 'page-2' });
      }
      if (url.pathname.endsWith('/messages')) return json(200, { messages: [{ id: 'm0' }] });
      const id = url.pathname.split('/').pop()!;
      return json(200, message(id, { date: Date.parse('2026-03-01T00:00:00Z') + Number(id.slice(1)) * 1000 }));
    });

    const first = await provider.fetchSince(null, 2);
    expect(first.messages.map((m) => m.providerMessageId)).toEqual(['m1', 'm2']); // oldest first
    expect(first.hasMore).toBe(true);
    expect(JSON.parse(first.nextCursor!)).toMatchObject({ mode: 'initial', historyId: '1000', pageToken: 'page-2' });
    // The first listing is bounded to the configured window and to the inbox.
    const list = new URL(calls.find((c) => c.includes('/messages?'))!);
    expect(list.searchParams.get('q')).toBe('newer_than:30d');
    expect(list.searchParams.get('labelIds')).toBe('INBOX');

    const second = await provider.fetchSince(first.nextCursor, 2);
    expect(second.messages.map((m) => m.providerMessageId)).toEqual(['m0']);
    expect(second.hasMore).toBe(false);
    // The history position was taken before listing began, so nothing arriving meanwhile is missed.
    expect(JSON.parse(second.nextCursor!)).toEqual({ v: 1, mode: 'history', historyId: '1000' });
  });

  it('follows the change feed incrementally and advances the history position', async () => {
    const { provider } = gmail((url) => {
      if (url.pathname.endsWith('/history')) {
        expect(url.searchParams.get('startHistoryId')).toBe('1000');
        expect(url.searchParams.get('historyTypes')).toBe('messageAdded');
        return json(200, {
          history: [
            { messagesAdded: [{ message: { id: 'm5', labelIds: ['INBOX'] } }] },
            { messagesAdded: [{ message: { id: 'm5', labelIds: ['INBOX'] } }, { message: { id: 'sent-1', labelIds: ['SENT'] } }] },
          ],
          historyId: '1042',
        });
      }
      return json(200, message(url.pathname.split('/').pop()!));
    });

    const page = await provider.fetchSince(JSON.stringify({ v: 1, mode: 'history', historyId: '1000' }), 50);
    // Each message once, and only what landed in the inbox.
    expect(page.messages.map((m) => m.providerMessageId)).toEqual(['m5']);
    expect(JSON.parse(page.nextCursor!)).toEqual({ v: 1, mode: 'history', historyId: '1042' });
  });

  it('lists the inbox again, and says so, when Gmail no longer holds the history', async () => {
    const { provider } = gmail((url) => {
      if (url.pathname.endsWith('/history')) return json(404, { error: { code: 404, status: 'NOT_FOUND' } });
      if (url.pathname.endsWith('/profile')) return json(200, { historyId: '2000' });
      if (url.pathname.endsWith('/messages')) return json(200, { messages: [{ id: 'm9' }] });
      return json(200, message('m9'));
    });
    const page = await provider.fetchSince(JSON.stringify({ v: 1, mode: 'history', historyId: '5' }), 10);
    expect(page.messages).toHaveLength(1);
    expect(page.notices?.[0]).toContain('listed again');
    expect(JSON.parse(page.nextCursor!)).toMatchObject({ mode: 'history', historyId: '2000' });
  });

  it('normalises a message into plain text, addresses and attachment descriptors', async () => {
    const { provider } = gmail((url) => {
      if (url.pathname.endsWith('/history')) return json(200, { history: [{ messagesAdded: [{ message: { id: 'h1' } }] }], historyId: '7' });
      return json(200, message('h1', { html: true, attachment: true }));
    });
    const [mail] = (await provider.fetchSince(JSON.stringify({ v: 1, mode: 'history', historyId: '6' }), 10)).messages;

    expect(mail).toMatchObject({
      providerMessageId: 'h1',
      providerThreadId: 't-h1',
      rfcMessageId: '<h1@sharmaauto.example>',
      fromAddress: 'billing@sharmaauto.example',
      fromName: 'Sharma Auto Works',
      toAddresses: ['accounts@gangamata.example'],
      hasHtml: true,
      authenticationResults: 'mx.google.com; spf=pass; dkim=pass',
    });
    // HTML is flattened at the edge; no markup travels further.
    expect(mail!.bodyText).toBe('Invoice INV-2291 attached');
    // The part id is the stable key; Gmail's volatile attachment id is only a fetch hint.
    expect(mail!.attachments).toEqual([
      expect.objectContaining({ providerAttachmentId: '1', filename: 'invoice.pdf', mimeType: 'application/pdf', fetchHandle: 'att-h1-volatile' }),
    ]);
  });

  it('downloads an attachment, finding its current id again when the old handle has lapsed', async () => {
    const { provider } = gmail((url) => {
      if (url.pathname.endsWith('/attachments/att-h1-volatile')) return json(400, { error: { code: 400, status: 'INVALID_ARGUMENT' } });
      if (url.pathname.endsWith('/attachments/att-h1-fresh')) return json(200, { data: b64url(Buffer.from([1, 2, 3])) });
      const fresh = message('h1', { attachment: true });
      fresh.payload.parts[1]!.body = { size: 3, attachmentId: 'att-h1-fresh' };
      return json(200, fresh);
    });
    const bytes = await provider.fetchAttachment('h1', '1', 'att-h1-volatile');
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it('refreshes the token once on a 401 and carries on', async () => {
    let unauthorised = true;
    const { provider, tokens } = gmail(() => {
      if (unauthorised) {
        unauthorised = false;
        return json(401, { error: { code: 401 } });
      }
      return json(200, { emailAddress: 'accounts@gangamata.example', messagesTotal: 12 });
    });
    expect(await provider.verifyConnection()).toEqual({ ok: true, mailbox: 'accounts@gangamata.example', messageCount: 12 });
    expect(tokens.getAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true });
  });

  it('reports throttling as retryable rather than as an empty mailbox', async () => {
    const { provider } = gmail(() => json(429, { error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } }, { 'Retry-After': '30' }));
    const failure = await provider.fetchSince(JSON.stringify({ v: 1, mode: 'history', historyId: '1' }), 10).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(EmailProviderError);
    expect(failure).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  it('reports refused access as needing a person, not as a retry', async () => {
    const { provider } = gmail(() => json(401, { error: { code: 401 } }));
    await expect(provider.fetchSince(JSON.stringify({ v: 1, mode: 'history', historyId: '1' }), 10)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
      retryable: false,
    });
  });

  it('keys its cursor and stored mail to the connected account', () => {
    expect(gmail(() => undefined).provider.mailbox).toBe('accounts@gangamata.example/INBOX');
  });
});
