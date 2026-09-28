/**
 * DI token for the active EmailProvider.
 *
 * Optional by design: a deployment with no mailbox configured binds null, and the Inbox says so
 * rather than failing to start. Business code never injects a concrete provider.
 */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
