# Gangamata Transport — backend API

NestJS + Prisma + PostgreSQL. Modular monolith serving the driver and admin applications.

Architecture: [`docs/backend/architecture.md`](../docs/backend/architecture.md) ·
Data model: [`docs/backend/data-model.md`](../docs/backend/data-model.md) ·
Retention: [`docs/backend/data-retention.md`](../docs/backend/data-retention.md) ·
Receipt AI: [`docs/ai-receipt-processing.md`](../docs/ai-receipt-processing.md)

## Quick start

```bash
docker compose up -d                 # PostgreSQL 16 (from the repository root)

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
