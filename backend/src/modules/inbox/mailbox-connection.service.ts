import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EmailProviderName, MailboxConnectionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { EMAIL_PROVIDER, MAILBOX_FETCH, MAILBOX_OAUTH_CLIENT } from './inbox.tokens';
import { EmailProviderError, type EmailProvider } from './email-provider';
import { GoogleOAuthClient, MicrosoftOAuthClient, OAuthError, type FetchLike, type MailboxOAuthClient } from './oauth/oauth-client';
import { TokenCipher } from './oauth/token-cipher';
import type { AccessTokenSource } from './providers/mail-api-client';
import { GmailEmailProvider } from './providers/gmail.provider';
import { GraphEmailProvider } from './providers/graph.provider';

/** How long an administrator has to complete consent after starting it. */
const AUTHORIZATION_WINDOW_MS = 10 * 60_000;

export type ProviderResolution = { provider: EmailProvider } | { provider: null; reason: string };

/**
 * The company mailbox connection: OAuth consent, token custody, and which provider to read.
 *
 * ── Custody ──
 * Tokens are encrypted before they are written and decrypted only in this process, only to make
 * a provider call. They never appear in an API response, a log line or an audit entry. The OAuth
 * `state` is stored hashed and is single-use, and PKCE binds the authorisation code to the
 * verifier this server generated — a code intercepted on its way back is useless on its own.
 *
 * ── Honesty ──
 * A mailbox is "connected" only when the provider has issued a refresh token and named the
 * account it belongs to; the database refuses a connected row without both. When the provider
 * later refuses the refresh token, the connection says so (REAUTHORIZATION_REQUIRED) and syncing
 * stops with that reason, rather than reporting an inbox that is merely quiet.
 */
@Injectable()
export class MailboxConnectionService {
  private readonly logger = new Logger(MailboxConnectionService.name);
  private cipherInstance: TokenCipher | null = null;
  private clientInstance: MailboxOAuthClient | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    @Optional() @Inject(EMAIL_PROVIDER) private readonly staticProvider: EmailProvider | null,
    @Optional() @Inject(MAILBOX_OAUTH_CLIENT) private readonly injectedClient: MailboxOAuthClient | null,
    @Optional() @Inject(MAILBOX_FETCH) private readonly fetchImpl: FetchLike | null,
  ) {}

  /** The OAuth provider this deployment uses, or null when it uses IMAP or nothing. */
  oauthProvider(): EmailProviderName | null {
    const configured = this.config.email.provider;
    if (configured === 'gmail') return EmailProviderName.GMAIL;
    if (configured === 'microsoft_graph') return EmailProviderName.MICROSOFT_GRAPH;
    return null;
  }

  /**
   * The provider to read this company's mail with, or the reason there is none.
   *
   * IMAP is one mailbox for the deployment; the OAuth providers are per company and exist only
   * while the company's connection holds a refresh token.
   */
  async resolve(companyId: string): Promise<ProviderResolution> {
    if (this.staticProvider?.isConfigured()) return { provider: this.staticProvider };

    const provider = this.oauthProvider();
    if (!provider) return { provider: null, reason: 'No mailbox is configured on this server.' };

    const connection = await this.prisma.mailboxConnection.findUnique({
      where: { companyId_provider: { companyId, provider } },
      select: { id: true, status: true, emailAddress: true, lastError: true },
    });
    if (!connection || connection.status === MailboxConnectionStatus.PENDING || connection.status === MailboxConnectionStatus.DISCONNECTED) {
      return { provider: null, reason: 'The company mailbox has not been connected yet. An administrator can connect it from the Inbox.' };
    }
    if (connection.status === MailboxConnectionStatus.REAUTHORIZATION_REQUIRED || !connection.emailAddress) {
      return {
        provider: null,
        reason: connection.lastError ?? 'The mailbox needs to be connected again before it can be read.',
      };
    }

    const options = {
      account: connection.emailAddress,
      tokens: this.tokenSource(companyId, connection.id),
      initialSyncDays: this.config.email.initialSyncDays,
      maxBodyChars: this.config.email.maxBodyChars,
      fetch: this.fetchImpl ?? undefined,
    };
    return { provider: provider === EmailProviderName.GMAIL ? new GmailEmailProvider(options) : new GraphEmailProvider(options) };
  }

  /** What the Inbox header shows about the connection. Never includes a token. */
  async status(companyId: string) {
    const oauthProvider = this.oauthProvider();
    const mode = this.staticProvider?.isConfigured() ? 'imap' : oauthProvider ? 'oauth' : 'none';
    const connection = oauthProvider
      ? await this.prisma.mailboxConnection.findUnique({
          where: { companyId_provider: { companyId, provider: oauthProvider } },
          select: {
            status: true, emailAddress: true, scopes: true, connectedAt: true, connectedById: true,
            disconnectedAt: true, lastError: true, lastErrorAt: true, oauthExpiresAt: true,
          },
        })
      : null;

    return {
      mode,
      provider: mode === 'imap' ? (this.staticProvider?.name ?? null) : oauthProvider,
      /** True when an administrator can start OAuth consent from the console. */
      canConnect: mode === 'oauth',
      connection: connection
        ? {
            status: connection.status,
            emailAddress: connection.emailAddress,
            scopes: connection.scopes,
            connectedAt: connection.connectedAt?.toISOString() ?? null,
            connectedById: connection.connectedById,
            disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
            lastError: connection.lastError,
            lastErrorAt: connection.lastErrorAt?.toISOString() ?? null,
            authorizationPending: Boolean(connection.oauthExpiresAt && connection.oauthExpiresAt > new Date()),
          }
        : null,
    };
  }

  // ───────────────────────────── OAuth consent ─────────────────────────────

  /** Starts consent: returns the provider URL the administrator's browser should open. */
  async beginAuthorization(user: AuthenticatedUser): Promise<{ authorizationUrl: string; provider: EmailProviderName; expiresAt: string }> {
    const provider = this.oauthProvider();
    if (!provider) {
      throw new BadRequestException('This server is not configured for Gmail or Microsoft 365 (EMAIL_PROVIDER).');
    }
    const client = this.client();

    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const expiresAt = new Date(Date.now() + AUTHORIZATION_WINDOW_MS);

    await this.prisma.mailboxConnection.upsert({
      where: { companyId_provider: { companyId: user.companyId, provider } },
      create: {
        companyId: user.companyId,
        provider,
        status: MailboxConnectionStatus.PENDING,
        scopes: [],
        oauthStateHash: hashState(state),
        oauthCodeVerifierCiphertext: this.cipher().encrypt(verifier),
        oauthRequestedById: user.id,
        oauthExpiresAt: expiresAt,
      },
      // A connected mailbox stays connected while it is being re-authorised; only the pending
      // authorisation is replaced.
      update: {
        oauthStateHash: hashState(state),
        oauthCodeVerifierCiphertext: this.cipher().encrypt(verifier),
        oauthRequestedById: user.id,
        oauthExpiresAt: expiresAt,
      },
    });

    await this.audit.record({
      action: 'inbox.mailbox_connect_started',
      entityType: 'MailboxConnection',
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { provider },
    });

    return { authorizationUrl: client.authorizationUrl({ state, codeChallenge: challenge }), provider, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Completes consent from the provider's redirect.
   *
   * Reached without a session (it is the provider redirecting the browser), so it trusts nothing
   * but the state: an unknown, reused or expired state is refused before any token is requested.
   */
  async completeAuthorization(input: { state?: string; code?: string; error?: string }): Promise<
    { ok: true; emailAddress: string } | { ok: false; reason: string }
  > {
    if (!input.state) return { ok: false, reason: 'invalid_request' };
    const connection = await this.prisma.mailboxConnection.findUnique({
      where: { oauthStateHash: hashState(input.state) },
      select: {
        id: true, companyId: true, provider: true, status: true, emailAddress: true,
        oauthCodeVerifierCiphertext: true, oauthRequestedById: true, oauthExpiresAt: true,
      },
    });
    if (!connection) return { ok: false, reason: 'invalid_state' };

    // Single use: whatever happens next, this state cannot be presented again.
    await this.prisma.mailboxConnection.update({
      where: { id: connection.id },
      data: { oauthStateHash: null, oauthCodeVerifierCiphertext: null, oauthExpiresAt: null },
    });

    const fail = async (reason: string, message: string) => {
      await this.prisma.mailboxConnection.update({
        where: { id: connection.id },
        data: { lastError: message, lastErrorAt: new Date() },
      });
      await this.audit.record({
        action: 'inbox.mailbox_connect_failed',
        entityType: 'MailboxConnection',
        entityId: connection.id,
        companyId: connection.companyId,
        actorUserId: connection.oauthRequestedById,
        changes: { provider: connection.provider, reason },
      });
      return { ok: false as const, reason };
    };

    if (!connection.oauthExpiresAt || connection.oauthExpiresAt < new Date()) {
      return fail('expired', 'The connection attempt expired before consent was given. Start again from the Inbox.');
    }
    if (input.error) {
      return fail(input.error === 'access_denied' ? 'consent_denied' : 'provider_error', `The provider did not grant access (${input.error.slice(0, 60)}).`);
    }
    if (!input.code || !connection.oauthCodeVerifierCiphertext) return fail('invalid_request', 'The provider did not return an authorisation code.');

    try {
      const client = this.client();
      const tokens = await client.exchangeCode(input.code, this.cipher().decrypt(connection.oauthCodeVerifierCiphertext));
      if (!tokens.refreshToken) {
        return fail('no_offline_access', 'The provider did not grant offline access, so the mailbox could not be kept connected.');
      }
      const emailAddress = await client.accountAddress(tokens.accessToken);
      const now = new Date();

      await this.prisma.mailboxConnection.update({
        where: { id: connection.id },
        data: {
          status: MailboxConnectionStatus.CONNECTED,
          emailAddress,
          scopes: tokens.scopes,
          refreshTokenCiphertext: this.cipher().encrypt(tokens.refreshToken),
          accessTokenCiphertext: this.cipher().encrypt(tokens.accessToken),
          accessTokenExpiresAt: tokens.expiresAt,
          connectedAt: now,
          connectedById: connection.oauthRequestedById,
          disconnectedAt: null,
          disconnectedById: null,
          lastError: null,
          lastErrorAt: null,
        },
      });

      await this.audit.record({
        action: 'inbox.mailbox_connected',
        entityType: 'MailboxConnection',
        entityId: connection.id,
        companyId: connection.companyId,
        actorUserId: connection.oauthRequestedById,
        changes: {
          provider: connection.provider,
          emailAddress,
          previousEmailAddress: connection.emailAddress,
          scopes: tokens.scopes,
          reconnected: connection.status !== MailboxConnectionStatus.PENDING,
        },
      });
      this.logger.log(`Company ${connection.companyId} connected its ${connection.provider} mailbox.`);
      return { ok: true, emailAddress };
    } catch (error) {
      const message = error instanceof OAuthError ? error.message : 'The mailbox could not be connected.';
      if (!(error instanceof OAuthError)) this.logger.error('Mailbox authorisation failed unexpectedly', error instanceof Error ? error.stack : String(error));
      return fail(error instanceof OAuthError ? error.code.toLowerCase() : 'unknown', message);
    }
  }

  /** Disconnects the mailbox: revokes where the provider allows, and erases the tokens. Filed mail stays. */
  async disconnect(user: AuthenticatedUser) {
    const provider = this.oauthProvider();
    if (!provider) throw new BadRequestException('This server does not use an OAuth mailbox, so there is nothing to disconnect.');

    const connection = await this.prisma.mailboxConnection.findUnique({
      where: { companyId_provider: { companyId: user.companyId, provider } },
      select: { id: true, status: true, emailAddress: true, refreshTokenCiphertext: true },
    });
    if (!connection || connection.status === MailboxConnectionStatus.DISCONNECTED) {
      throw new BadRequestException('The mailbox is not connected.');
    }

    let revoked = false;
    if (connection.refreshTokenCiphertext) {
      try {
        revoked = await this.client().revoke(this.cipher().decrypt(connection.refreshTokenCiphertext));
      } catch {
        revoked = false;
      }
    }

    await this.prisma.mailboxConnection.update({
      where: { id: connection.id },
      data: {
        status: MailboxConnectionStatus.DISCONNECTED,
        refreshTokenCiphertext: null,
        accessTokenCiphertext: null,
        accessTokenExpiresAt: null,
        oauthStateHash: null,
        oauthCodeVerifierCiphertext: null,
        oauthExpiresAt: null,
        disconnectedAt: new Date(),
        disconnectedById: user.id,
      },
    });

    await this.audit.record({
      action: 'inbox.mailbox_disconnected',
      entityType: 'MailboxConnection',
      entityId: connection.id,
      companyId: user.companyId,
      actorUserId: user.id,
      actorRole: user.role,
      changes: { provider, emailAddress: connection.emailAddress, revokedAtProvider: revoked },
    });

    return { status: MailboxConnectionStatus.DISCONNECTED, revokedAtProvider: revoked };
  }

  /** Where the browser goes after the callback. */
  returnUrl(outcome: { ok: true } | { ok: false; reason: string }): string | null {
    const base = this.config.email.oauth.returnUrl;
    if (!base) return null;
    const url = new URL(base);
    url.searchParams.set('mailbox', outcome.ok ? 'connected' : 'error');
    if (!outcome.ok) url.searchParams.set('reason', outcome.reason);
    return url.toString();
  }

  // ───────────────────────────── tokens ─────────────────────────────

  /**
   * An access-token source bound to one connection.
   *
   * Refreshes when the stored token is near expiry (or after a 401), stores the new token — and a
   * rotated refresh token, which Microsoft issues on every use — encrypted, and turns a refused
   * refresh token into REAUTHORIZATION_REQUIRED with an audit entry.
   */
  private tokenSource(companyId: string, connectionId: string): AccessTokenSource {
    let cached: { token: string; expiresAt: Date } | null = null;

    return {
      getAccessToken: async ({ forceRefresh } = {}) => {
        if (!forceRefresh && cached && cached.expiresAt.getTime() - Date.now() > 30_000) return cached.token;

        const row = await this.prisma.mailboxConnection.findUnique({
          where: { id: connectionId },
          select: { status: true, provider: true, refreshTokenCiphertext: true, accessTokenCiphertext: true, accessTokenExpiresAt: true },
        });
        if (!row || row.status !== MailboxConnectionStatus.CONNECTED || !row.refreshTokenCiphertext) {
          throw new EmailProviderError('The mailbox is no longer connected.', 'NOT_CONNECTED', false);
        }
        if (!forceRefresh && row.accessTokenCiphertext && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() - Date.now() > 30_000) {
          cached = { token: this.cipher().decrypt(row.accessTokenCiphertext), expiresAt: row.accessTokenExpiresAt };
          return cached.token;
        }

        try {
          const tokens = await this.client().refresh(this.cipher().decrypt(row.refreshTokenCiphertext));
          await this.prisma.mailboxConnection.update({
            where: { id: connectionId },
            data: {
              accessTokenCiphertext: this.cipher().encrypt(tokens.accessToken),
              accessTokenExpiresAt: tokens.expiresAt,
              ...(tokens.refreshToken ? { refreshTokenCiphertext: this.cipher().encrypt(tokens.refreshToken) } : {}),
              lastError: null,
              lastErrorAt: null,
            },
          });
          cached = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
          return tokens.accessToken;
        } catch (error) {
          if (error instanceof OAuthError && error.code === 'INVALID_GRANT') {
            await this.prisma.mailboxConnection.update({
              where: { id: connectionId },
              data: {
                status: MailboxConnectionStatus.REAUTHORIZATION_REQUIRED,
                refreshTokenCiphertext: null,
                accessTokenCiphertext: null,
                accessTokenExpiresAt: null,
                lastError: error.message,
                lastErrorAt: new Date(),
              },
            });
            await this.audit.record({
              action: 'inbox.mailbox_authorization_lost',
              entityType: 'MailboxConnection',
              entityId: connectionId,
              companyId,
              changes: { provider: row.provider },
            });
            throw new EmailProviderError(error.message, 'AUTHENTICATION_FAILED', false, { cause: error });
          }
          if (error instanceof OAuthError) {
            throw new EmailProviderError(error.message, error.retryable ? 'UNAVAILABLE' : 'AUTHENTICATION_FAILED', error.retryable, {
              cause: error,
            });
          }
          throw error;
        }
      },
    };
  }

  private client(): MailboxOAuthClient {
    if (this.injectedClient) return this.injectedClient;
    if (this.clientInstance) return this.clientInstance;
    const { oauth } = this.config.email;
    const provider = this.oauthProvider();
    const fetch = this.fetchImpl ?? undefined;
    if (provider === EmailProviderName.GMAIL) {
      this.clientInstance = new GoogleOAuthClient({ ...oauth.gmail, redirectUri: oauth.redirectUri, fetch });
    } else if (provider === EmailProviderName.MICROSOFT_GRAPH) {
      this.clientInstance = new MicrosoftOAuthClient({ ...oauth.microsoft, redirectUri: oauth.redirectUri, fetch });
    } else {
      throw new BadRequestException('No OAuth mailbox provider is configured on this server.');
    }
    return this.clientInstance;
  }

  private cipher(): TokenCipher {
    this.cipherInstance ??= new TokenCipher(this.config.email.oauth.tokenEncryptionKey);
    return this.cipherInstance;
  }
}

/** The state is stored hashed: a leaked row cannot be replayed into a callback. */
function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}
