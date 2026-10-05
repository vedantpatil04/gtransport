import { createHash, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PasswordHasher } from '../src/modules/auth/password-hasher';
import { MAILBOX_FETCH } from '../src/modules/inbox/inbox.tokens';
import type { FetchLike } from '../src/modules/inbox/oauth/oauth-client';

/**
 * Phase 7: a Gmail company mailbox connected through OAuth, end to end.
 *
 * Everything is the production code path — the OAuth client, PKCE and state handling, token
 * encryption, the Gmail adapter, the sync and the audit trail — against a real PostgreSQL
 * database. The one thing replaced is the network: Google's token endpoint and the Gmail API are
 * scripted here (§36), because a test suite cannot hold a real Google account's consent.
 */

const ACCOUNT = 'accounts@gangamata.example';
const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function gmailMessage(id: string, withAttachment = false) {
  return {
    id,
    threadId: `thread-${id}`,
    labelIds: ['INBOX'],
    internalDate: String(Date.now()),
    sizeEstimate: 4096,
    payload: {
      partId: '',
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Sharma Auto Works <billing@sharmaauto.example>' },
        { name: 'To', value: ACCOUNT },
        { name: 'Subject', value: `Invoice ${id}` },
        { name: 'Message-ID', value: `<${id}@sharmaauto.example>` },
      ],
      parts: [
        { partId: '0', mimeType: 'text/plain', body: { size: 20, data: b64url(`Invoice ${id} attached.`) } },
        ...(withAttachment ? [{ partId: '1', mimeType: 'application/pdf', filename: 'invoice.pdf', body: { size: 4, attachmentId: `att-${id}` } }] : []),
      ],
    },
  };
}

/** Google, as far as this server can tell: token endpoint, Gmail API and revocation. */
class ScriptedGoogle {
  validTokens = new Set<string>();
  refreshFails = false;
  inbox = ['g1', 'g2'];
  history: string[] = [];
  revoked: string[] = [];
  tokenRequests: URLSearchParams[] = [];
  private issued = 0;

  fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    if (url.href === 'https://oauth2.googleapis.com/token') return this.token(new URLSearchParams(String(init?.body)));
    if (url.href === 'https://oauth2.googleapis.com/revoke') {
      this.revoked.push(new URLSearchParams(String(init?.body)).get('token') ?? '');
      return new Response(null, { status: 200 });
    }

    const auth = ((init?.headers ?? {}) as Record<string, string>).Authorization ?? '';
    if (!this.validTokens.has(auth.replace('Bearer ', ''))) return json(401, { error: { code: 401 } });

    const path = url.pathname.replace('/gmail/v1/users/me', '');
    if (path === '/profile') return json(200, { emailAddress: ACCOUNT, historyId: '100', messagesTotal: this.inbox.length });
    if (path === '/messages') return json(200, { messages: this.inbox.map((id) => ({ id })) });
    if (path === '/history') {
      return json(200, { history: [{ messagesAdded: this.history.map((id) => ({ message: { id, labelIds: ['INBOX'] } })) }], historyId: '150' });
    }
    const attachment = /^\/messages\/([^/]+)\/attachments\/(.+)$/.exec(path);
    if (attachment) return json(200, { size: 4, data: b64url(Buffer.from([37, 80, 68, 70])) });
    const message = /^\/messages\/([^/]+)$/.exec(path);
    if (message) return json(200, gmailMessage(message[1]!, message[1] === 'g1'));
    return json(404, { error: { code: 404 } });
  };

  private token(form: URLSearchParams): Response {
    this.tokenRequests.push(form);
    if (form.get('grant_type') === 'authorization_code') {
      if (form.get('code') !== 'good-code') return json(400, { error: 'invalid_grant' });
      return this.issue('refresh-1');
    }
    if (this.refreshFails) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    return this.issue(null);
  }

  private issue(refreshToken: string | null): Response {
    this.issued += 1;
    const accessToken = `access-${this.issued}`;
    this.validTokens.add(accessToken);
    return json(200, {
      access_token: accessToken,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      expires_in: 3599,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    });
  }
}

describe('Phase 7: Gmail mailbox through OAuth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixture: typeof import('./app-fixture');
  let seed: Awaited<ReturnType<typeof import('./app-fixture')['seedCompany']>>;
  let admin: string;
  let manager: string;
  let accounting: string;
  let driver: string;
  let google: ScriptedGoogle;

  const V = '/api/v1';
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => api().get(`${V}${url}`).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => api().post(`${V}${url}`).set('Authorization', `Bearer ${token}`).send(body),
  });
  const login = async (identifier: string) =>
    (await api().post(`${V}/auth/login`).send({ identifier, password: fixture.TEST_PASSWORD }).expect(200)).body.accessToken as string;
  const connection = () =>
    prisma.mailboxConnection.findUniqueOrThrow({ where: { companyId_provider: { companyId: seed.company.id, provider: 'GMAIL' } } });

  /** Starts consent as the admin and returns what the browser would carry to Google. */
  const startConsent = async () => {
    const started = await as(admin).post('/inbox/connection/authorize').expect(200);
    const url = new URL(started.body.authorizationUrl);
    return { state: url.searchParams.get('state')!, challenge: url.searchParams.get('code_challenge')!, url };
  };
  const callback = (query: Record<string, string>) => api().get(`${V}/inbox/oauth/callback`).query(query);

  beforeAll(async () => {
    Object.assign(process.env, {
      EMAIL_PROVIDER: 'gmail',
      GMAIL_CLIENT_ID: 'e2e-client-id.apps.googleusercontent.com',
      GMAIL_CLIENT_SECRET: 'e2e-client-secret',
      EMAIL_OAUTH_REDIRECT_URI: 'http://localhost:3001/api/v1/inbox/oauth/callback',
      EMAIL_OAUTH_RETURN_URL: 'http://localhost:5173/inbox',
      EMAIL_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      EMAIL_SYNC_ENABLED: 'false',
      EMAIL_AI_ENABLED: 'false',
      AI_WORKER_ENABLED: 'false',
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fixture = require('./app-fixture') as typeof import('./app-fixture');
    prisma = fixture.rawPrisma();
    google = new ScriptedGoogle();
    app = await fixture.createTestApp([{ token: MAILBOX_FETCH, value: google.fetch }]);

    seed = await fixture.seedCompany(prisma);
    admin = await login(seed.admin.identifier);
    driver = await login(seed.driver.identifier);

    const hash = await new PasswordHasher().hash(fixture.TEST_PASSWORD);
    const stamp = Date.now();
    for (const role of ['MANAGER', 'ACCOUNTING'] as const) {
      const employee = await prisma.employee.create({ data: { companyId: seed.company.id, employeeCode: `${role}-${stamp}`, fullName: role } });
      await prisma.user.create({ data: { companyId: seed.company.id, employeeId: employee.id, email: `${role.toLowerCase()}-${stamp}@e2e.test`, role, passwordHash: hash } });
    }
    manager = await login(`manager-${stamp}@e2e.test`);
    accounting = await login(`accounting-${stamp}@e2e.test`);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('says the mailbox is not connected yet — which is not the same as an empty inbox', async () => {
    const status = await as(admin).get('/inbox/status').expect(200);
    expect(status.body).toMatchObject({ configured: false, connection: { mode: 'oauth', provider: 'GMAIL', canConnect: true, connection: null } });
    expect(status.body.unavailableReason).toMatch(/not been connected/i);

    const sync = await as(admin).post('/inbox/sync').expect(200);
    expect(sync.body).toMatchObject({ ok: false, created: 0 });
  });

  it('lets only an administrator connect the company mailbox', async () => {
    await as(manager).post('/inbox/connection/authorize').expect(403);
    await as(accounting).post('/inbox/connection/authorize').expect(403);
    await as(driver).post('/inbox/connection/authorize').expect(403);
  });

  it('sends the administrator to Google for read-only consent, with PKCE and a stored-hashed state', async () => {
    const { state, url } = await startConsent();
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    const row = await connection();
    expect(row.status).toBe('PENDING');
    // The state is kept only as a hash, so a database read cannot be replayed into the callback.
    expect(row.oauthStateHash).toBe(createHash('sha256').update(state).digest('hex'));
    expect(row.oauthStateHash).not.toBe(state);
  });

  it('refuses a callback whose state it did not issue', async () => {
    const response = await callback({ state: 'not-a-state-we-issued', code: 'good-code' }).expect(303);
    expect(response.headers.location).toBe('http://localhost:5173/inbox?mailbox=error&reason=invalid_state');
  });

  it('records a refused consent as a failure, not a connection', async () => {
    const { state } = await startConsent();
    const response = await callback({ state, error: 'access_denied' }).expect(303);
    expect(response.headers.location).toContain('reason=consent_denied');
    expect((await connection()).status).toBe('PENDING');
    expect(await prisma.auditLog.count({ where: { companyId: seed.company.id, action: 'inbox.mailbox_connect_failed' } })).toBeGreaterThan(0);
  });

  it('connects the mailbox, keeping the tokens only in encrypted form', async () => {
    const { state, challenge } = await startConsent();
    const response = await callback({ state, code: 'good-code' }).expect(303);
    expect(response.headers.location).toBe('http://localhost:5173/inbox?mailbox=connected');

    // The code was exchanged with the verifier that matches the challenge sent to Google.
    const exchange = google.tokenRequests.find((form) => form.get('grant_type') === 'authorization_code' && form.get('code') === 'good-code')!;
    expect(createHash('sha256').update(exchange.get('code_verifier')!).digest('base64url')).toBe(challenge);

    const row = await connection();
    expect(row).toMatchObject({ status: 'CONNECTED', emailAddress: ACCOUNT, connectedById: seed.admin.id, oauthStateHash: null });
    expect(row.refreshTokenCiphertext).toMatch(/^v1:/);
    expect(row.refreshTokenCiphertext).not.toContain('refresh-1');

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { companyId: seed.company.id, action: 'inbox.mailbox_connected' } });
    expect(audit.actorUserId).toBe(seed.admin.id);
    expect(JSON.stringify(audit)).not.toMatch(/refresh-1|access-\d/);

    // The state was single use.
    const replay = await callback({ state, code: 'good-code' }).expect(303);
    expect(replay.headers.location).toContain('reason=invalid_state');
  });

  it('reports the connection, and never a token', async () => {
    const status = await as(accounting).get('/inbox/status').expect(200);
    expect(status.body).toMatchObject({ configured: true, provider: 'GMAIL', mailbox: `${ACCOUNT}/INBOX` });
    expect(status.body.connection.connection).toMatchObject({ status: 'CONNECTED', emailAddress: ACCOUNT });
    expect(JSON.stringify(status.body)).not.toMatch(/refresh-1|access-\d|Ciphertext|client-secret/i);

    const verify = await as(admin).post('/inbox/verify-connection').expect(200);
    expect(verify.body).toMatchObject({ ok: true, mailbox: ACCOUNT });
  });

  it('syncs through the Gmail API, storing the attachment in object storage', async () => {
    const outcome = await as(admin).post('/inbox/sync').expect(200);
    expect(outcome.body).toMatchObject({ ok: true, created: 2, duplicates: 0, failed: 0 });

    const messages = await prisma.inboxMessage.findMany({
      where: { companyId: seed.company.id },
      include: { attachments: true },
      orderBy: { providerMessageId: 'asc' },
    });
    expect(messages.map((m) => [m.provider, m.providerMessageId, m.providerThreadId, m.mailbox])).toEqual([
      ['GMAIL', 'g1', 'thread-g1', `${ACCOUNT}/INBOX`],
      ['GMAIL', 'g2', 'thread-g2', `${ACCOUNT}/INBOX`],
    ]);
    const attachment = messages[0]!.attachments[0]!;
    expect(attachment).toMatchObject({ providerAttachmentId: '1', filename: 'invoice.pdf', skipReason: null });
    const stored = await prisma.storedFile.findUniqueOrThrow({ where: { id: attachment.fileId! } });
    expect(Number(stored.sizeBytes)).toBe(4);

    const cursor = await prisma.emailSyncCursor.findFirstOrThrow({ where: { companyId: seed.company.id, provider: 'GMAIL' } });
    expect(JSON.parse(cursor.cursor!)).toMatchObject({ mode: 'history', historyId: '100' });
  });

  it('continues incrementally from the change feed, filing nothing twice', async () => {
    google.history = ['g2', 'g3'];
    const outcome = await as(admin).post('/inbox/sync').expect(200);
    expect(outcome.body).toMatchObject({ ok: true, created: 1, duplicates: 1 });
    expect(await prisma.inboxMessage.count({ where: { companyId: seed.company.id, providerMessageId: 'g2' } })).toBe(1);
  });

  it('refreshes an expired access token by itself', async () => {
    const before = google.tokenRequests.filter((form) => form.get('grant_type') === 'refresh_token').length;
    await prisma.mailboxConnection.update({ where: { id: (await connection()).id }, data: { accessTokenExpiresAt: new Date(0) } });
    google.history = [];

    const outcome = await as(admin).post('/inbox/sync').expect(200);
    expect(outcome.body.ok).toBe(true);
    expect(google.tokenRequests.filter((form) => form.get('grant_type') === 'refresh_token').length).toBe(before + 1);
  });

  it('stops and says so when Google refuses the refresh token, rather than reporting a quiet inbox', async () => {
    google.refreshFails = true;
    await prisma.mailboxConnection.update({ where: { id: (await connection()).id }, data: { accessTokenExpiresAt: new Date(0) } });

    const outcome = await as(admin).post('/inbox/sync').expect(200);
    expect(outcome.body).toMatchObject({ ok: false, retryable: false });
    expect(outcome.body.reason).toMatch(/connect the mailbox again/i);

    const row = await connection();
    expect(row).toMatchObject({ status: 'REAUTHORIZATION_REQUIRED', refreshTokenCiphertext: null, accessTokenCiphertext: null });
    expect(await prisma.auditLog.count({ where: { companyId: seed.company.id, action: 'inbox.mailbox_authorization_lost' } })).toBe(1);

    const status = await as(admin).get('/inbox/status').expect(200);
    expect(status.body.configured).toBe(false);
    expect(status.body.unavailableReason).toMatch(/connect the mailbox again/i);
  });

  it('reconnects through consent again', async () => {
    google.refreshFails = false;
    const { state } = await startConsent();
    await callback({ state, code: 'good-code' }).expect(303);
    expect((await connection()).status).toBe('CONNECTED');
  });

  it('disconnects: revokes at Google, erases the tokens, keeps the mail', async () => {
    await as(manager).post('/inbox/connection/disconnect').expect(403);
    const response = await as(admin).post('/inbox/connection/disconnect').expect(200);
    expect(response.body).toMatchObject({ status: 'DISCONNECTED', revokedAtProvider: true });
    expect(google.revoked).toContain('refresh-1');

    const row = await connection();
    expect(row).toMatchObject({ status: 'DISCONNECTED', refreshTokenCiphertext: null, accessTokenCiphertext: null, disconnectedById: seed.admin.id });
    expect(await prisma.auditLog.count({ where: { companyId: seed.company.id, action: 'inbox.mailbox_disconnected' } })).toBe(1);

    // Mail already filed stays; nothing more is fetched.
    expect(await prisma.inboxMessage.count({ where: { companyId: seed.company.id } })).toBe(3);
    const sync = await as(admin).post('/inbox/sync').expect(200);
    expect(sync.body).toMatchObject({ ok: false, created: 0 });
    await as(admin).post('/inbox/connection/disconnect').expect(400);
  });

  it('lets a consent attempt lapse', async () => {
    const { state } = await startConsent();
    await prisma.mailboxConnection.update({ where: { id: (await connection()).id }, data: { oauthExpiresAt: new Date(0) } });
    const response = await callback({ state, code: 'good-code' }).expect(303);
    expect(response.headers.location).toContain('reason=expired');
    expect((await connection()).status).toBe('DISCONNECTED');
  });
});
