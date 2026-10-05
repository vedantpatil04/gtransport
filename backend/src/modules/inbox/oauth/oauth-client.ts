import { EmailProviderName } from '@prisma/client';

/**
 * OAuth 2.0 for the company mailbox — authorisation code flow with PKCE, a confidential client
 * (the secret never leaves the server), and a refresh token kept encrypted at rest.
 *
 * Two implementations, one per provider, because the endpoints and a few rules differ: Google only
 * issues a refresh token with `access_type=offline` and a consent prompt; Microsoft rotates the
 * refresh token on every use and needs the scope repeated on refresh. Nothing above this file
 * knows either detail.
 *
 * Only official endpoints are contacted. There is no browser automation, no scraping and no
 * password handling anywhere in the mailbox integration.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OAuthTokens {
  accessToken: string;
  /** Absent on a refresh that did not rotate it; the stored one stays valid. */
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly code:
      /** The refresh token or code was refused: revoked, expired, or the password changed. Needs a person. */
      | 'INVALID_GRANT'
      /** The person declined consent, or an administrator policy blocked it. */
      | 'CONSENT_DENIED'
      /** The client id/secret or redirect URI is wrong on this server. */
      | 'CONFIGURATION'
      | 'UNAVAILABLE'
      | 'BAD_RESPONSE',
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OAuthError';
  }
}

export interface MailboxOAuthClient {
  readonly provider: EmailProviderName;
  readonly scopes: readonly string[];
  /** Where to send the administrator's browser to grant access. */
  authorizationUrl(input: { state: string; codeChallenge: string }): string;
  exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  /** The mailbox address the tokens belong to, as the provider reports it. */
  accountAddress(accessToken: string): Promise<string>;
  /** Revokes the grant where the provider supports it. Best effort; returns whether it was confirmed. */
  revoke(token: string): Promise<boolean>;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

const TIMEOUT_MS = 20_000;

abstract class BaseOAuthClient implements MailboxOAuthClient {
  abstract readonly provider: EmailProviderName;
  abstract readonly scopes: readonly string[];
  protected abstract readonly tokenEndpoint: string;
  protected abstract readonly label: string;

  constructor(
    protected readonly options: { clientId: string; clientSecret: string; redirectUri: string; fetch?: FetchLike },
  ) {}

  abstract authorizationUrl(input: { state: string; codeChallenge: string }): string;
  abstract accountAddress(accessToken: string): Promise<string>;
  abstract revoke(token: string): Promise<boolean>;

  exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
    return this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.options.redirectUri,
      code_verifier: codeVerifier,
    });
  }

  refresh(refreshToken: string): Promise<OAuthTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken, ...this.refreshExtras() });
  }

  protected refreshExtras(): Record<string, string> {
    return {};
  }

  protected get http(): FetchLike {
    return this.options.fetch ?? ((input, init) => fetch(input, init));
  }

  private async token(params: Record<string, string>): Promise<OAuthTokens> {
    let response: Response;
    try {
      response = await this.http(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: this.options.clientId, client_secret: this.options.clientSecret, ...params }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new OAuthError(`${this.label} could not be reached to authorise the mailbox.`, 'UNAVAILABLE', true, { cause: error });
    }

    const body = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !body.access_token) {
      // The error code is the provider's own and safe to show; the description can echo request
      // details, so only the code travels into messages the office will read.
      const code = body.error ?? `http_${response.status}`;
      if (code === 'invalid_grant') {
        throw new OAuthError(
          `${this.label} refused the stored authorisation (it was revoked, expired, or the account password changed). Connect the mailbox again.`,
          'INVALID_GRANT',
          false,
        );
      }
      if (code === 'invalid_client' || code === 'unauthorized_client' || code === 'redirect_uri_mismatch') {
        throw new OAuthError(
          `${this.label} rejected this server's OAuth client (${code}). Check the client id, secret and redirect URI.`,
          'CONFIGURATION',
          false,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        throw new OAuthError(`${this.label} is temporarily unable to issue a token (${code}).`, 'UNAVAILABLE', true);
      }
      throw new OAuthError(`${this.label} did not issue a token (${code}).`, 'BAD_RESPONSE', false);
    }

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      // Treated as expiring a minute early, so a token is never sent in its last seconds.
      expiresAt: new Date(Date.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000),
      scopes: (body.scope ?? this.scopes.join(' ')).split(/\s+/).filter(Boolean),
    };
  }
}

/** Gmail API with read-only access to the mailbox. */
export class GoogleOAuthClient extends BaseOAuthClient {
  readonly provider = EmailProviderName.GMAIL;
  /** Read-only. The integration cannot send, delete or modify mail, by construction. */
  readonly scopes = ['https://www.googleapis.com/auth/gmail.readonly'] as const;
  protected readonly tokenEndpoint = 'https://oauth2.googleapis.com/token';
  protected readonly label = 'Google';

  authorizationUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      // Offline access and an explicit consent prompt are what make Google issue a refresh token.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async accountAddress(accessToken: string): Promise<string> {
    const response = await this.http('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw new OAuthError('Google could not be reached to identify the mailbox.', 'UNAVAILABLE', true, { cause: error });
    });
    const body = (await response.json().catch(() => ({}))) as { emailAddress?: string };
    if (!response.ok || !body.emailAddress) {
      throw new OAuthError(`Google did not report the mailbox address (HTTP ${response.status}).`, 'BAD_RESPONSE', false);
    }
    return body.emailAddress.toLowerCase();
  }

  async revoke(token: string): Promise<boolean> {
    try {
      const response = await this.http('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/** Microsoft Graph with delegated Mail.Read on the signed-in company mailbox. */
export class MicrosoftOAuthClient extends BaseOAuthClient {
  readonly provider = EmailProviderName.MICROSOFT_GRAPH;
  readonly scopes = ['offline_access', 'https://graph.microsoft.com/Mail.Read', 'https://graph.microsoft.com/User.Read'] as const;
  protected readonly label = 'Microsoft';

  constructor(options: { clientId: string; clientSecret: string; redirectUri: string; tenantId: string; fetch?: FetchLike }) {
    super(options);
    this.tenant = encodeURIComponent(options.tenantId);
  }

  private readonly tenant: string;

  protected get tokenEndpoint(): string {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`;
  }

  authorizationUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: 'code',
      response_mode: 'query',
      scope: this.scopes.join(' '),
      prompt: 'select_account',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  /** Microsoft wants the scope restated on refresh. */
  protected override refreshExtras(): Record<string, string> {
    return { scope: this.scopes.join(' ') };
  }

  async accountAddress(accessToken: string): Promise<string> {
    const response = await this.http('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw new OAuthError('Microsoft Graph could not be reached to identify the mailbox.', 'UNAVAILABLE', true, { cause: error });
    });
    const body = (await response.json().catch(() => ({}))) as { mail?: string | null; userPrincipalName?: string };
    const address = body.mail || body.userPrincipalName;
    if (!response.ok || !address) {
      throw new OAuthError(`Microsoft Graph did not report the mailbox address (HTTP ${response.status}).`, 'BAD_RESPONSE', false);
    }
    return address.toLowerCase();
  }

  /**
   * Microsoft offers no endpoint that revokes one application's delegated grant without signing
   * the user out everywhere, which this system has no business doing. Disconnecting erases the
   * tokens here; the grant itself is removed from the account's "My Apps" page if wanted.
   */
  async revoke(): Promise<boolean> {
    return false;
  }
}
