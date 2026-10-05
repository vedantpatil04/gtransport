import { GoogleOAuthClient, MicrosoftOAuthClient, OAuthError, type FetchLike } from './oauth-client';

/**
 * The OAuth clients against scripted provider endpoints: what is sent, and how each answer is
 * read. The token endpoints are the providers' real ones; only the transport is replaced.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function recorder(responses: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next;
  };
  return { calls, fetch };
}

const OPTIONS = { clientId: 'client-id', clientSecret: 'client-secret', redirectUri: 'https://api.example.com/api/v1/inbox/oauth/callback' };

describe('GoogleOAuthClient', () => {
  it('asks for read-only Gmail access, offline, with PKCE and the state', () => {
    const url = new URL(new GoogleOAuthClient(OPTIONS).authorizationUrl({ state: 'state-1', codeChallenge: 'challenge-1' }));
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(OPTIONS.redirectUri);
  });

  it('exchanges a code with the verifier and reads the tokens', async () => {
    const { calls, fetch } = recorder([json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: 'https://www.googleapis.com/auth/gmail.readonly' })]);
    const tokens = await new GoogleOAuthClient({ ...OPTIONS, fetch }).exchangeCode('code-1', 'verifier-1');

    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(String(calls[0]!.init!.body));
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code_verifier')).toBe('verifier-1');
    expect(form.get('client_secret')).toBe('client-secret');
    expect(tokens).toMatchObject({ accessToken: 'at', refreshToken: 'rt', scopes: ['https://www.googleapis.com/auth/gmail.readonly'] });
    // Treated as expiring early, never late.
    expect(tokens.expiresAt.getTime()).toBeLessThan(Date.now() + 3_599_000);
  });

  it('turns a refused refresh token into INVALID_GRANT, which needs a person', async () => {
    const { fetch } = recorder([json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })]);
    await expect(new GoogleOAuthClient({ ...OPTIONS, fetch }).refresh('rt')).rejects.toMatchObject({ code: 'INVALID_GRANT', retryable: false });
  });

  it('reports a wrong client as configuration, not as the mailbox being down', async () => {
    const { fetch } = recorder([json(401, { error: 'invalid_client' })]);
    await expect(new GoogleOAuthClient({ ...OPTIONS, fetch }).refresh('rt')).rejects.toMatchObject({ code: 'CONFIGURATION' });
  });

  it('treats an outage as retryable', async () => {
    const { fetch } = recorder([json(503, { error: 'backend_error' })]);
    await expect(new GoogleOAuthClient({ ...OPTIONS, fetch }).refresh('rt')).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true });
    const unreachable: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(new GoogleOAuthClient({ ...OPTIONS, fetch: unreachable }).refresh('rt')).rejects.toBeInstanceOf(OAuthError);
  });

  it('identifies the mailbox from the Gmail profile', async () => {
    const { calls, fetch } = recorder([json(200, { emailAddress: 'Accounts@Gangamata.example' })]);
    expect(await new GoogleOAuthClient({ ...OPTIONS, fetch }).accountAddress('at')).toBe('accounts@gangamata.example');
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer at');
  });
});

describe('MicrosoftOAuthClient', () => {
  const ms = (fetch?: FetchLike) => new MicrosoftOAuthClient({ ...OPTIONS, tenantId: 'tenant-1', fetch });

  it('asks the company tenant for delegated, read-only mail access with offline_access', () => {
    const url = new URL(ms().authorizationUrl({ state: 's', codeChallenge: 'c' }));
    expect(url.pathname).toBe('/tenant-1/oauth2/v2.0/authorize');
    expect(url.searchParams.get('scope')).toBe('offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('restates the scope on refresh and keeps the rotated refresh token', async () => {
    const { calls, fetch } = recorder([json(200, { access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 })]);
    const tokens = await ms(fetch).refresh('rt1');
    expect(calls[0]!.url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    expect(new URLSearchParams(String(calls[0]!.init!.body)).get('scope')).toContain('Mail.Read');
    expect(tokens.refreshToken).toBe('rt2');
  });

  it('identifies the mailbox, falling back to the sign-in name', async () => {
    const { fetch } = recorder([json(200, { mail: null, userPrincipalName: 'office@gangamata.example' })]);
    expect(await ms(fetch).accountAddress('at')).toBe('office@gangamata.example');
  });

  it('does not pretend to revoke what Microsoft offers no way to revoke', async () => {
    expect(await ms().revoke()).toBe(false);
  });
});
