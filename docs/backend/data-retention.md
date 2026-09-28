# Data retention, backups and growth

The system is designed to hold **10+ years** of business data. Nothing is designed around deleting old records.

## Principles

- Financial, compliance and audit records are retained. Deletion is soft (`deleted_at`) and reversible.
- `audit_logs` cannot be updated or deleted at all — enforced by a database trigger, not just by convention.
- No destructive cleanup jobs exist, and none should be added without an explicit, written retention decision.
- Foreign keys use `onDelete: Restrict`, so history cannot be cascaded away by accident.

## Growth expectations

| Table | Growth driver | Scale over 10 years |
|---|---|---|
| `driver_location_pings` | one row per accepted fix per driver | by far the largest; tens of millions |
| `driver_location_states` | one row per driver, updated in place | fixed at fleet size; never grows with time |
| `fleet_location_alerts` | one row per stationary period that crosses the threshold | small; a handful per driver per month |
| `audit_logs` | one row per significant action | large, steady |
| fuel / expenses / payments (later phases) | daily operations | moderate |
| employees, vehicles, documents | fleet size | small |

## Handling the growth

**Indexed access.** Every listing query hits an index: `(company_id, status)`, `(company_id, expiry_date)`, `(driver_id, recorded_at DESC)`, `(vehicle_id, recorded_at DESC)`, `(company_id, status, triggered_at DESC)`.

**Volume, concretely.** At the default policy — a fix a minute while moving, one every fifteen minutes while stationary — a driver on a ten-hour shift produces roughly 400–600 rows a day. Twenty drivers is about 4 million rows a year: comfortable for one PostgreSQL table with the indexes above, and the reason partitioning can wait. Raising `LOCATION_TRACKING_INTERVAL` is the first lever if that ever needs to come down; it takes no code change.

**Keyset pagination.** Endpoints page by `cursor` + `limit`, never `OFFSET`. Offset pagination degrades linearly deep into a table and can skip or repeat rows when data is inserted concurrently. UUIDv7 ids make `id DESC` a correct newest-first ordering.

**Separating current state from history (Phase 6).** `driver_location_states` holds exactly one row per driver: their current position, tracking state and stationary anchor. Live Fleet reads only that table, so opening it costs one indexed scan of at most one row per driver however many years of fixes `driver_location_pings` holds. Nothing in the admin console queries the history table without a driver (or vehicle) and a bounded page.

**BRIN on the history (Phase 6).** `driver_location_pings` is append-only and written in near-perfect `recorded_at` order, which is the exact shape BRIN indexes exist for. `driver_location_pings_recorded_at_brin_idx` keeps date-range scans cheap at a small fraction of a B-tree's size; the B-tree on `(company_id, recorded_at)` still serves per-company lookups.

**Partitioning (when needed, not yet).** `driver_location_pings` is the first candidate for monthly `RANGE` partitioning on `recorded_at`; `audit_logs` follows the same pattern on `occurred_at`. Doing it prematurely adds operational complexity for no benefit, so the schema is merely shaped for it: both tables are append-only, both have the partition key on every row, and neither is referenced by a foreign key from elsewhere. Phase 6 preserves that shape deliberately — `fleet_location_alerts` stores the alert's own latitude and longitude rather than pointing at a ping row, precisely so no foreign key ever lands on the history table. Partitioning is introduced as a normal SQL migration when volume justifies it.

**Archival.** Once partitioned, old partitions can be detached and moved to cold storage rather than deleted, keeping them restorable.

## Backups

Not yet configured — this is infrastructure work for the deployment phase, listed here so it is not forgotten. Required before production data exists:

1. **Nightly logical backups** (`pg_dump`) with verified restores. A backup that has never been restored is a hypothesis, not a backup.
2. **Point-in-time recovery** — continuous WAL archiving, so recovery targets a moment (for example, just before a bad migration) rather than last night.
3. **Independent backup storage** — a different provider or account from the database host. A backup on the same machine does not survive losing the machine.
4. **Retention** — daily for 30 days, monthly for 12 months, yearly beyond, matching the 10-year horizon.
5. **Migration safety** — take a snapshot before `prisma migrate deploy` in production; expand-then-contract for destructive changes so a rollback never needs the backup.
6. **Object storage** — receipts and documents need their own backup/versioning policy; database backups do not cover them.
