# Gangamata Transport — backend architecture

Phase 0 establishes the production architecture underneath the existing frontend prototype. The prototype is unchanged and still runs on its own local/demo state.

## Shape

```
/            existing React + Vite frontend (unchanged, Vercel-compatible)
/backend     NestJS + Prisma + PostgreSQL API
/docs        architecture documentation
/mobile      Expo driver app — later phase, not present
```

The backend is a **modular monolith**: one deployable unit with strict module boundaries. Not microservices — the team and traffic do not justify the operational cost, and clean module boundaries preserve the option to split later.

## Request pipeline

```
request
  → requestIdMiddleware        x-request-id accepted or generated, echoed on the response
  → helmet                     security headers
  → CORS                       explicit origin allowlist (CORS_ORIGINS)
  → RequestLoggingMiddleware   one line per request: method, path, status, duration, request id
  → JwtAuthGuard (global)      bearer token verified; user re-read so disabling takes effect at once
  → RolesGuard (global)        @Roles(...) enforced; SUPER_ADMIN always passes
  → ValidationPipe (global)    DTO validation; unknown properties rejected
  → controller → service → Prisma
  → ApiExceptionFilter         every failure rendered in one error envelope
```

Both guards are global, so **a new route is authenticated by default** and must opt out with `@Public()`. The safe direction for a mistake.

### Error envelope

Every non-2xx response:

```json
{
  "error": {
    "statusCode": 403,
    "code": "FORBIDDEN",
    "message": "Your role does not permit this action.",
    "details": [{ "field": "identifier", "messages": ["identifier must be longer than 3 characters"] }],
    "requestId": "…",
    "path": "/api/v1/employees",
    "timestamp": "2026-03-04T10:00:00.000Z"
  }
}
```

Internal errors never leak messages or stack traces; the server log carries the detail, correlated by `requestId`.

## Routes

`/api/v1` prefixes every route. `/health` deliberately sits outside the prefix and outside authentication so load balancers and process supervisors can probe it; it returns 503 when the database is unreachable, so an unhealthy instance leaves rotation rather than serving errors.

| Route | Roles |
|---|---|
| `POST /api/v1/auth/login` | public |
| `GET /api/v1/auth/me` | any authenticated user |
| `GET /api/v1/employees`, `/employees/:id` | ADMIN, MANAGER, ACCOUNTING |
| `GET /api/v1/drivers`, `/drivers/:id` | ADMIN, MANAGER, ACCOUNTING |
| `GET /api/v1/drivers/me` | DRIVER |
| `GET /api/v1/vehicles`, `/vehicles/:id` | ADMIN, MANAGER, ACCOUNTING |
| `GET /api/v1/documents` | any authenticated user (drivers scoped to their own) |
| `GET /health` | public |

These read endpoints exist to prove the auth, scoping and pagination foundation end to end. Business workflows belong to later phases.

## Authorization model

Three layers, each doing one job:

1. **Role** — `@Roles(...)` on the route.
2. **Tenant** — every query filters by the authenticated user's `companyId`. A record from another company returns 404, not 403, so IDs cannot be probed.
3. **Ownership** — for `DRIVER`, the driver id comes from the session (`requireDriverScope`), never from the request. A driver sees their own records and those of the vehicle assigned to them, and a query filter can only narrow that set, never widen it.

Payroll figures (salary, PF, UAN) are omitted from employee responses for roles that may not see them, rather than returned and hidden by the UI.

## Modules

**Implemented:** `auth`, `users`, `employees`, `drivers`, `vehicles`, `documents`, `files`, `health`, `ai`.

**Boundaries only** (contracts and pure policies; no tables or endpoints yet): `fuel`, `expenses`, `finance`, `payments`, `compliance`, `locations`, `notifications`, `reports`, `inbox`.

Boundary modules exist so later phases add behaviour without restructuring. Each fixes the vocabulary its phase needs:

- `finance` — Salary and Advance are **distinct** transaction types. An advance is money handed over before it is earned and later recovered; recording it as salary would overstate payroll cost. Execution of money movement lives in `payments`, so a failed payout never rewrites financial history.
- `payments` — `PayoutProvider` (RazorpayX) and `PaymentGateway` (Razorpay) interfaces, with idempotency keys so a retry cannot pay twice. No SDK, no credentials.
- `locations` — `deriveLocationStatus` maps permission/heartbeat/fix age onto ACTIVE, PERMISSION_DENIED, LOCATION_DISABLED, OFFLINE, STALE. It runs when a phone reports *and* again whenever the fleet is read, so a driver who goes quiet ages from ACTIVE to STALE to OFFLINE with the clock (`LOCATION_STALE_AFTER_MINUTES` / `LOCATION_OFFLINE_AFTER_MINUTES`); the stored `status` column is only the verdict at the last report. The fleet's `?status=` filter and summary counts use the status as of the request. `StationaryDetectionPolicy` carries the future rule (configurable radius, 4 hours) but no engine.
- `compliance` — document expiry thresholds identical to the admin UI (30/15/7/3 days), so backend and frontend never disagree.
- `inbox` — `EmailProvider` behind Gmail API / Microsoft Graph (OAuth) or IMAP; sync, classification and reviewable suggestions since Phase 7 (see [`docs/email-inbox.md`](../email-inbox.md)).
- `fuel` / `expenses` — drafts carry a device-generated `clientEntryId` so an offline entry that syncs twice is stored once. The prototype already queues entries offline; the API must not duplicate them.

## File storage

`FileStorage` is an abstract class used as the DI token; `LocalDiskFileStorage` implements it for development. R2-specific code will live in one adapter in `modules/files/` and nowhere else. There is deliberately no `delete()` — stored originals are retained, and removal will be an explicit, audited archival operation.

`FilesService` writes the object **first**, then the metadata row, so a referenced file always exists; a failed metadata write orphans an object rather than leaving a dangling reference. Keys are `companies/<companyId>/<category>/<yyyy>/<mm>/<uuid><ext>`, validated against a strict pattern and resolved inside the storage root so no key can escape it. Binary data never goes into PostgreSQL.

## Receipt AI

Unchanged from the approved design, now wired into DI: `ReceiptAIService` → `AIProvider` → Ollama (default) or Dify. See [ai-receipt-processing.md](../ai-receipt-processing.md).

## Configuration

Every variable is declared and validated in `src/config/env.schema.ts`; the process refuses to start on invalid configuration and reports **all** problems at once. Env files load as `.env.<NODE_ENV>.local` → `.env.<NODE_ENV>` → `.env.local` → `.env`, with real environment variables always winning. Inject `AppConfigService` for typed access; nothing reads `process.env` directly. Production additionally rejects placeholder JWT secrets and wildcard CORS.

## Audit

`AuditService.record()` writes to an append-only trail. Writes are best-effort — an audit failure must never fail the business operation it describes — but always logged. The `audit_logs` table blocks UPDATE, DELETE and TRUNCATE with a database trigger, so the guarantee does not depend on application code.

## Deployment

The API is a standard 12-factor Node service: configuration from the environment, stateless, `/health` for probes, graceful shutdown via `enableShutdownHooks` (verified: SIGTERM closes the database connection and exits).

```bash
npm ci && npm run build
npm run db:deploy      # prisma migrate deploy — run before starting new code
npm start              # node dist/main
```

Nothing is tied to a specific host, so any VPS (Hetzner or otherwise) works behind a reverse proxy. Set `TRUST_PROXY=true` there so client IPs are recorded correctly in the audit trail. The runtime uses Prisma's driver adapter, so no native query-engine binary is needed. The frontend's Vercel deployment is untouched.
