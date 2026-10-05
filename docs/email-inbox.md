# Gangamata Transport — Company Inbox & Email Intelligence

The office's company mailbox, read through the provider's official API, filed, classified and
turned into reviewable follow-ups. Code lives in `backend/src/modules/inbox/`.

## Providers

| `EMAIL_PROVIDER` | Mailbox | How it connects |
|---|---|---|
| `none` (default) | — | Nothing is read. The Inbox says no mailbox is connected (not "no mail"). |
| `gmail` | Gmail / Google Workspace | Gmail API, OAuth 2.0 consent by an administrator, scope `gmail.readonly` |
| `microsoft_graph` | Microsoft 365 | Microsoft Graph, OAuth 2.0 consent, delegated `Mail.Read` + `offline_access` |
| `imap` | Any other host | IMAP with an app password set on the server (Zoho, a hosting provider) |

Only official APIs and protocols are used — no browser automation or scraping anywhere. The
provider interface (`email-provider.ts`) is read-only: there is no send, reply, forward, delete or
label method, and the OAuth scopes are read-only to match.

## Connecting a mailbox (OAuth)

```text
Admin → Inbox → Connect           POST /api/v1/inbox/connection/authorize        (ADMIN / SUPER_ADMIN)
  → state (32 random bytes, stored only as SHA-256) + PKCE verifier (stored encrypted), 10-minute window
  → browser to Google / Microsoft consent
  → GET /api/v1/inbox/oauth/callback?state&code                                    (public; trusts only the state)
      state single-use · code exchanged with the verifier · mailbox address read from the provider
      refresh + access tokens encrypted with EMAIL_TOKEN_ENCRYPTION_KEY (AES-256-GCM)
  → mailbox_connections.status = CONNECTED                                         audit: inbox.mailbox_connected
  → browser returned to EMAIL_OAUTH_RETURN_URL?mailbox=connected (or =error&reason=…)
```

Refused consent, an expired attempt or an unknown state are recorded (`inbox.mailbox_connect_failed`)
and never produce a connection. When the provider later refuses the refresh token (revoked,
password changed), the connection becomes `REAUTHORIZATION_REQUIRED`, its tokens are erased, sync
stops with that reason, and `inbox.mailbox_authorization_lost` is audited. Disconnecting
(`POST /inbox/connection/disconnect`) revokes the grant at Google (Microsoft has no per-app
revocation endpoint), erases the tokens and keeps every filed message (`inbox.mailbox_disconnected`).
The database refuses a `CONNECTED` row without a refresh token and mailbox address.

## Sync

- **Initial**: the last `EMAIL_INITIAL_SYNC_DAYS` of the inbox, page by page (Gmail
  `messages.list` with the history position taken first; Graph `delta` with a `receivedDateTime`
  filter).
- **Incremental**: Gmail `history.list` (`messageAdded`, INBOX) from the stored history id; Graph
  `delta` from the stored `deltaLink`. Up to `EMAIL_SYNC_MAX_PAGES` pages per run.
- **Expired position**: Gmail's 404 on an old history id and Graph's 410 on an expired delta token
  restart the listing; already-filed mail is skipped and the office is told.
- **Deduplication**: `inbox_messages` is unique on (company, provider, provider message id); the
  insert itself is the check, so overlapping windows, two schedulers or two instances converge.
  Thread ids (Gmail thread, Graph conversation) and RFC Message-IDs are stored too.
- **Cursor**: kept per company/provider/mailbox (`<account>/INBOX` for OAuth). It only moves past a
  page once every message on it is filed; a page that keeps failing is moved past after three runs,
  with the count recorded.
- **Failure and retry**: a failed run records the reason, increments `consecutive_failures`, sets
  `next_attempt_at` with exponential backoff (1, 2, 4 … minutes, capped at an hour) and writes
  `inbox.sync_failed`. A non-retryable failure (authorisation lost) waits for a person. "Check now"
  ignores the backoff. Throttling (HTTP 429 / rate-limit 403) is retryable.
- **Audit**: every manual sync, and every scheduled sync that filed or failed something
  (`inbox.synced`).

## Attachments

Decided on metadata before any bytes are fetched (type allowlist, size limit, dangerous and
double extensions refused). Kept files go to object storage through `FilesService`; PostgreSQL holds
the reference. A refused attachment keeps a row with its reason. A failed download is recorded as
`download_failed` and retried on later runs (not the same run) up to three attempts. Downloads are
served as attachments with `nosniff` and a sandbox CSP — never rendered inline. Gmail attachments
are keyed by part id (Gmail's attachment ids change between reads); Graph inline images and attached
items/links are left out or refused.

## Classification

Each new message is classified by the configured AI provider (`EMAIL_AI_ENABLED`) into:
`VEHICLE_DOCUMENT`, `FUEL`, `MAINTENANCE`, `FINANCE`, `SALARY_PAYMENT`, `COMPLIANCE`, `VENDOR`,
`CUSTOMER`, `GENERAL`, `SPAM`, or `UNCLASSIFIED`. The output is schema-validated; every reading is
stored as a version with its confidence. A reading is applied only when no person has set the
category and its confidence is at least `EMAIL_AI_MIN_CONFIDENCE`; otherwise it is recorded and the
message stays as it was. Applying one is audited (`inbox.ai_classified`); a person's change is audited
(`inbox.classified`) and never overridden by a later run. Retryable failures move to `RETRYING` with
backoff up to `EMAIL_AI_MAX_ATTEMPTS`, then `FAILED`.

## Suggestions — reviewable, never automatic

A confident reading may propose up to three follow-ups from a fixed list. They are stored as
`PENDING` and do nothing until a person decides:

| Suggestion | Who may decide | What acceptance does |
|---|---|---|
| `CREATE_SERVICE_RECORD` | ADMIN, MANAGER, ACCOUNTING | Creates a MAINTENANCE record from the figures the person checked, with the stored invoice attachment as its receipt. It then goes through Service AI reading and needs **verifying** like any upload. |
| `RECORD_FUEL_EXPENSE` | ADMIN, MANAGER, ACCOUNTING | Records the decision; the bill is entered in Fuel |
| `REVIEW_VEHICLE_DOCUMENT`, `REVIEW_COMPLIANCE` | ADMIN, MANAGER | Records the decision; handled in Documents |
| `REVIEW_FINANCE`, `REVIEW_PAYMENT` | ADMIN, ACCOUNTING | Records the decision; no finance or payment record is created |

Acceptance is idempotent and single-decision (`409` if already decided); a newer reading supersedes
undecided suggestions only. Audit: `inbox.suggestion_accepted` / `inbox.suggestion_rejected`.

## Roles

Office roles read the inbox and suggestions; ADMIN and MANAGER sync and re-run classification;
only ADMIN connects or disconnects the mailbox; drivers have no inbox access at all.

## Scheduling

`EMAIL_SYNC_ENABLED=true` syncs every `EMAIL_SYNC_INTERVAL_MINUTES` inside the API process: each
company with a connected OAuth mailbox (or, for IMAP, the single company of a single-company
deployment), then classifies new mail and due retries. Alternatively schedule `npm run inbox:sync`,
which exits non-zero when a mailbox could not be synced.
