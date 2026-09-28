# Phase 7 — Service AI & Email Intelligence

Every file in this archive sits at its final path, so the tree can be copied straight over the
project root. It is exactly the file set of the commit `feat: add service ai and email intelligence`
on branch `phase-7-service-ai-email` — 73 files, nothing else touched.

## After copying

```bash
cd backend
npm install                 # imapflow, mailparser and html-to-text are new
npm run db:deploy           # applies 20260929000000_phase7_service_ai_email
npm run db:generate         # the Prisma client changes with the schema
```

Then add the new settings to `backend/.env` — all of them have working defaults, so the API boots
without any of them. See `backend/.env.example`, which documents each one.

## The one deployment prerequisite

PDF receipts need Poppler on the host: `pdftotext` and `pdftoppm`, from `poppler-utils` on
Debian/Ubuntu, `poppler` on Alpine and macOS. A digital e-invoice is read from its own text layer,
which is exact; a scan is rasterised first. Without Poppler a PDF receipt **fails with a stated
reason that reaches the review screen** — it is never read approximately and never silently skipped.
Photographs of bills, which is most of what drivers send, need nothing extra.

## What still needs real credentials

Two external services are configured, not bundled. Both are implemented as production integrations —
there is no fake provider anywhere in the runtime path, and no code path that invents an extraction
or a message.

**1. An AI provider.** `AI_PROVIDER=ollama` (default) expects a reachable Ollama server with a
vision-capable model pulled:

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=<a vision model you have pulled>
```

`AI_PROVIDER=dify` uses `DIFY_BASE_URL`, `DIFY_API_KEY` and `DIFY_APP_ID` instead. Until one of them
answers, a queued receipt fails with `PROVIDER_UNAVAILABLE`, says so on the review screen, and the
office can still type the figures off the original and confirm the record. Nothing is fabricated to
fill the gap.

**2. A company mailbox.** `EMAIL_PROVIDER=none` is the default and contacts nothing; the Inbox then
states that no mailbox is connected, which is deliberately not the same as showing no mail. To
connect one:

```bash
EMAIL_PROVIDER=imap
EMAIL_SYNC_ENABLED=true
IMAP_HOST=…   IMAP_PORT=993   IMAP_USER=…   IMAP_PASSWORD=<app password>
```

Use a dedicated company mailbox and an app password, never a personal account and never the
account's own password. `POST /api/v1/inbox/verify-connection` contacts it and reports what actually
happened, so a wrong host or a rejected password is visible immediately rather than looking like an
empty mailbox.

The adapter was verified against a real IMAP server (Dovecot, three real MIME messages): multipart
parsing, attachment bytes, HTML flattening, cursor resume, a UIDVALIDITY change, both failure paths,
and an `invoice.pdf.exe` correctly refused despite declaring `application/pdf`.

## Running the queue elsewhere

By default this process drains the receipt queue itself. To run it on a schedule or another machine
instead, set `AI_WORKER_ENABLED=false` and `EMAIL_SYNC_ENABLED=false`, and use:

```bash
npm run ai:worker      # drains the receipt queue once
npm run inbox:sync     # fetches the mailbox once
```

Jobs are rows in PostgreSQL, so nothing is lost between runs, and two workers never read the same
receipt. The office's queue panel says which arrangement is in force, so a queue nobody is draining
is visible rather than mysterious.

## The rule the whole phase is built around

AI output is a suggestion. A service record becomes authoritative only when a person submits the
figures and confirms it — and once they have, no rerun, retry or stale job can change it. Re-opening
a settled record is an explicit act that requires a reason and is written to the audit trail. Every
reading is kept as a version; none is ever replaced.
