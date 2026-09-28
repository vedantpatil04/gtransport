# Gangamata Transport — backend API

NestJS + Prisma + PostgreSQL. Modular monolith serving the driver and admin applications.

Architecture: [`docs/backend/architecture.md`](../docs/backend/architecture.md) ·
Data model: [`docs/backend/data-model.md`](../docs/backend/data-model.md) ·
Retention: [`docs/backend/data-retention.md`](../docs/backend/data-retention.md) ·
Receipt AI: [`docs/ai-receipt-processing.md`](../docs/ai-receipt-processing.md)

## Quick start

Service-receipt reading needs Poppler on the host — `pdftotext` and `pdftoppm`, from
`poppler-utils` on Debian/Ubuntu and `poppler` on Alpine and macOS. A digital e-invoice is read
from its own text layer, which is exact; a scan or photograph is rasterised first. Without Poppler,
a PDF receipt fails with a stated reason that reaches the review screen — it is never read
approximately and never silently skipped. Photographs of bills, which is most of what drivers send,
need nothing extra.

```bash
docker compose up -d                 # PostgreSQL 16 (from the repository root)
sudo apt-get install -y poppler-utils   # Debian/Ubuntu; needed for PDF receipts

cd backend
cp .env.example .env                 # then set JWT_SECRET (see below)
npm install
npm run db:migrate                   # apply migrations
npm run dev                          # http://localhost:3000/health
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Optional first login (otherwise no user exists, by design — no default credentials ship):

```bash
SEED_SUPER_ADMIN_EMAIL=you@example.com SEED_SUPER_ADMIN_PASSWORD=a-long-password npm run db:seed
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | watch mode |
| `npm run build` / `npm start` | compile to `dist/` / run the compiled API |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | unit tests (no database) |
| `npm run test:e2e` | end-to-end tests against a real test database |
| `npm run db:migrate` | create/apply a migration in development |
| `npm run db:deploy` | apply pending migrations (production) |
| `npm run db:generate` | regenerate the Prisma client |
| `npm run db:studio` | browse data |
| `npm run db:seed` | idempotent bootstrap seed |
| `npm run ai:worker` | drain the receipt-reading queue once (for cron, or a separate machine, with `AI_WORKER_ENABLED=false`) |
| `npm run inbox:sync` | fetch the company mailbox once (for cron, with `EMAIL_SYNC_ENABLED=false`) |

## Tests

Unit tests need nothing but Node. End-to-end tests need PostgreSQL:

```bash
cp .env.example .env.test    # point DATABASE_URL at ...gangamata_test
npm run test:e2e
```

The e2e setup refuses to run against a database whose name does not end in `_test`, so a
misconfigured `DATABASE_URL` cannot wipe development data.

## Notes

- Configuration is validated at startup; the API refuses to boot on invalid values and reports every problem at once.
- Authentication is global: new routes are protected unless marked `@Public()`.
- Binary files never go into PostgreSQL — only object-storage metadata.
- An AI reading is never authoritative. A service receipt's figures become the record only when a
  person confirms them, and a later run cannot change a record someone has already settled.
- The company mailbox is read-only: there is no send, reply, forward or delete anywhere in the
  provider interface. Inbound mail is treated as untrusted — HTML is flattened to text on the way
  in, and attachments outside a small allowlist are recorded with a reason and left in the mailbox.
