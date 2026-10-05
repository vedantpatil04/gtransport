/**
 * DI token for a deployment-wide EmailProvider — the IMAP mailbox configured in the environment.
 *
 * Null for the OAuth providers (Gmail, Microsoft Graph), whose mailbox is connected per company by
 * an administrator and resolved by MailboxConnectionService, and null when no mailbox is
 * configured at all. Business code never injects a concrete provider.
 */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/**
 * Optional DI token for the OAuth client used to connect Gmail or Microsoft 365. Unbound in
 * production, where the client is built from configuration; bound only by tests.
 */
export const MAILBOX_OAUTH_CLIENT = Symbol('MAILBOX_OAUTH_CLIENT');

/**
 * Optional DI token for the HTTP transport the Gmail/Graph adapters and OAuth clients use.
 * Unbound in production (the platform `fetch`); bound only by tests, which is how the real adapter
 * code is exercised against a scripted provider API.
 */
export const MAILBOX_FETCH = Symbol('MAILBOX_FETCH');
