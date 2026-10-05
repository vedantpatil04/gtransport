import type { FetchLike } from '../oauth/oauth-client';
import { GraphEmailProvider } from './graph.provider';

/**
 * The Microsoft Graph adapter against a scripted Graph API: delta paging, removals, attachments,
 * and the guard that keeps a stored cursor from pointing the sync anywhere but Graph.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const graphMessage = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  conversationId: `conv-${id}`,
  internetMessageId: `<${id}@vendor.example>`,
  subject: `Bill ${id}`,
  from: { emailAddress: { name: 'IndianOil Fleet Card', address: 'Statements@IOCL.example' } },
  toRecipients: [{ emailAddress: { address: 'Office@Gangamata.example' } }],
  ccRecipients: [],
  receivedDateTime: '2026-03-04T10:00:00Z',
  hasAttachments: false,
  body: { contentType: 'text', content: 'Your fuel statement is attached.' },
  categories: [],
  ...extra,
});

function graph(routes: (url: string, headers: Record<string, string>) => Response | undefined) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    const response = routes(url, headers);
    if (!response) throw new Error(`unscripted request: ${url}`);
    return response;
  };
  const tokens = { getAccessToken: jest.fn().mockResolvedValue('access-token') };
  return { provider: new GraphEmailProvider({ account: 'office@gangamata.example', tokens, initialSyncDays: 30, maxBodyChars: 20_000, fetch }), calls };
}

describe('GraphEmailProvider', () => {
  it('starts a delta round on the inbox, bounded to the initial window, asking for text bodies', async () => {
    const { provider, calls } = graph(() => json(200, { value: [graphMessage('a1')], '@odata.nextLink': `${GRAPH}/me/mailFolders/inbox/messages/delta?$skiptoken=abc` }));
    const page = await provider.fetchSince(null, 25);

    const first = new URL(calls[0]!.url);
    expect(first.pathname).toBe('/v1.0/me/mailFolders/inbox/messages/delta');
    expect(first.searchParams.get('$filter')).toMatch(/^receivedDateTime ge \d{4}-/);
    expect(calls[0]!.headers.Prefer).toContain('odata.maxpagesize=25');
    expect(calls[0]!.headers.Prefer).toContain('outlook.body-content-type="text"');
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toContain('$skiptoken=abc');
    expect(page.messages[0]).toMatchObject({
      providerMessageId: 'a1',
      providerThreadId: 'conv-a1',
      fromAddress: 'statements@iocl.example',
      toAddresses: ['office@gangamata.example'],
      bodyText: 'Your fuel statement is attached.',
    });
  });

  it('finishes a round on the delta link and skips removals', async () => {
    const delta = `${GRAPH}/me/mailFolders/inbox/messages/delta?$deltatoken=xyz`;
    const { provider } = graph(() => json(200, { value: [graphMessage('a2'), { id: 'gone', '@removed': { reason: 'deleted' } }], '@odata.deltaLink': delta }));
    const page = await provider.fetchSince(`${GRAPH}/me/mailFolders/inbox/messages/delta?$skiptoken=abc`, 25);
    expect(page.messages.map((m) => m.providerMessageId)).toEqual(['a2']);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBe(delta);
  });

  it('starts over, and says so, when the delta token has expired', async () => {
    let expired = true;
    const { provider } = graph(() => {
      if (expired) {
        expired = false;
        return json(410, { error: { code: 'SyncStateNotFound' } });
      }
      return json(200, { value: [graphMessage('a3')], '@odata.deltaLink': `${GRAPH}/me/mailFolders/inbox/messages/delta?$deltatoken=new` });
    });
    const page = await provider.fetchSince(`${GRAPH}/me/mailFolders/inbox/messages/delta?$deltatoken=old`, 25);
    expect(page.messages).toHaveLength(1);
    expect(page.notices?.[0]).toContain('read again');
  });

  it('never follows a stored cursor to another host', async () => {
    const { provider, calls } = graph(() => json(200, { value: [], '@odata.deltaLink': `${GRAPH}/me/mailFolders/inbox/messages/delta?$deltatoken=d` }));
    await provider.fetchSince('https://attacker.example/steal', 25);
    expect(calls[0]!.url.startsWith(`${GRAPH}/me/mailFolders/inbox/messages/delta`)).toBe(true);
  });

  it('describes attachments without downloading them, leaving out inline images and non-files', async () => {
    const { provider } = graph((url) => {
      if (url.includes('/attachments?')) {
        return json(200, {
          value: [
            { '@odata.type': '#microsoft.graph.fileAttachment', id: 'f1', name: 'statement.pdf', contentType: 'application/pdf', size: 2048, isInline: false },
            { '@odata.type': '#microsoft.graph.fileAttachment', id: 'logo', name: 'logo.png', contentType: 'image/png', size: 900, isInline: true },
            { '@odata.type': '#microsoft.graph.itemAttachment', id: 'i1', name: 'Forwarded mail', contentType: null, size: 5000, isInline: false },
          ],
        });
      }
      return json(200, { value: [graphMessage('a4', { hasAttachments: true })], '@odata.deltaLink': `${GRAPH}/me/mailFolders/inbox/messages/delta?$deltatoken=d` });
    });
    const [mail] = (await provider.fetchSince(null, 25)).messages;
    expect(mail!.attachments).toEqual([
      { providerAttachmentId: 'f1', filename: 'statement.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
      // An attached email is recorded with a type the policy refuses, rather than downloaded.
      { providerAttachmentId: 'i1', filename: 'Forwarded mail', mimeType: 'application/x-graph-item', sizeBytes: 5000 },
    ]);
  });

  it('downloads attachment bytes through the $value endpoint', async () => {
    const { provider, calls } = graph(() => new Response(new Uint8Array([7, 8, 9]), { status: 200 }));
    expect([...(await provider.fetchAttachment('a4', 'f1'))]).toEqual([7, 8, 9]);
    expect(calls[0]!.url).toBe(`${GRAPH}/me/messages/a4/attachments/f1/$value`);
  });
});
