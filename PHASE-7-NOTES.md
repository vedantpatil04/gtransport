# Phase 7 — Service AI & Email Intelligence

Architecture: [`docs/ai-receipt-processing.md`](docs/ai-receipt-processing.md) (service receipts,
OCR, verification, maintenance intelligence) and [`docs/email-inbox.md`](docs/email-inbox.md)
(mailbox connection, sync, classification, suggestions).

## After pulling

```bash
cd backend
npm install
npm run db:deploy      # applies 20261004000000_phase7_service_ai_email_intelligence
npm run db:generate
```

The migration renames the receipt states in place (PENDING→QUEUED, COMPLETED→SUCCEEDED,
REVIEW_REQUIRED→NEEDS_REVIEW, CONFIRMED→VERIFIED), maps existing email categories onto the new
ones, and adds nullable columns and new tables only. No existing row is rewritten otherwise.

Everything has working defaults, so the API boots without any new setting. Without the external
pieces below, receipts fail with a stated reason (the office can still type the figures off the
stored original and verify the record), and the Inbox says no mailbox is connected.

## Host prerequisites

| Tool | Needed for | Without it |
|---|---|---|
| Poppler (`poppler-utils`) | PDF receipts (text layer + page images) | PDF receipts fail with a stated reason |
| Tesseract (`tesseract-ocr`, plus e.g. `tesseract-ocr-hin`) | Local OCR of photos and scanned PDFs | `OCR_ENGINE=auto`: the vision model reads images without OCR; `OCR_ENGINE=tesseract`: receipts needing OCR fail visibly |

## External services (credentials are configuration, never committed)

**AI provider** — `AI_PROVIDER=ollama` (default): a reachable Ollama server with a vision-capable
model (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`). Or `AI_PROVIDER=dify` with `DIFY_BASE_URL`,
`DIFY_API_KEY`, `DIFY_APP_ID` and a published workflow (inputs listed in the AI doc). The same
provider classifies email.

**Company mailbox** — pick one:

- **Gmail / Google Workspace**: `EMAIL_PROVIDER=gmail`. In Google Cloud: enable the Gmail API,
  configure the OAuth consent screen, create an OAuth client of type *Web application* with the
  redirect URI below, and set `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`. Scope used:
  `https://www.googleapis.com/auth/gmail.readonly`.
- **Microsoft 365**: `EMAIL_PROVIDER=microsoft_graph`. In Microsoft Entra: register an app, add
  the redirect URI below (platform *Web*), grant delegated `Mail.Read`, `offline_access` and
  `User.Read`, create a client secret, and set `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`,
  `MS_GRAPH_TENANT_ID` (the company tenant id).
- **Other hosts**: `EMAIL_PROVIDER=imap` with `IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD` (an app
  password). Sync of an IMAP mailbox is automatic only on a single-company deployment.

For Gmail and Microsoft 365 also set:

```bash
EMAIL_OAUTH_REDIRECT_URI=https://<api-host>/api/v1/inbox/oauth/callback   # exactly as registered
EMAIL_OAUTH_RETURN_URL=https://<admin-host>/admin/inbox
EMAIL_TOKEN_ENCRYPTION_KEY=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
```

Then an administrator opens **Admin → Inbox → Connect**, signs in to the *company* mailbox (never
a personal one) and grants read-only access. Use a dedicated mailbox account.

## Background processing

By default the API process drains the receipt queue (`AI_WORKER_ENABLED=true`) and, when
`EMAIL_SYNC_ENABLED=true`, syncs and classifies mail every `EMAIL_SYNC_INTERVAL_MINUTES`. To run
these elsewhere, turn them off and schedule `npm run ai:worker` and `npm run inbox:sync`. State
lives in PostgreSQL, so nothing is lost between runs and concurrent workers never duplicate work.
