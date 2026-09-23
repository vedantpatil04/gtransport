# Gangamata Transport — data model

Source of truth: `backend/prisma/schema.prisma`. This document explains the decisions behind it.

## Conventions

| Decision | Why |
|---|---|
| **UUIDv7** primary keys | Time-ordered, so inserts stay at the right edge of the B-tree instead of scattering like UUIDv4. Keeps indexes compact over a decade of data, and makes `ORDER BY id DESC` a valid newest-first ordering — which is what keyset pagination uses. |
| **snake_case** tables/columns | Ten years of SQL — backups, ad-hoc reporting, psql — is easier without quoting camelCase identifiers. Prisma fields stay camelCase. |
| **timestamptz** everywhere | The fleet runs across state lines and the office is in one timezone; absolute instants avoid ambiguity. Calendar values (joining date, expiry date) use `date`, because an insurance policy expires on a date, not at an instant. |
| **Decimal** for money | Never float. `Decimal(14,2)` for amounts, `Decimal(12,2)` for salary/EMI. |
| **Soft delete** (`deleted_at`) | Business records are archived, never physically deleted. Every query filters `deletedAt: null`. |
| `created_by_id` / `updated_by_id` | Plain UUID columns without an FK, so attribution survives user archival and avoids a cyclic User→User relation. |
| `onDelete: Restrict` | The database refuses to cascade away financial or compliance history by accident. |

## Entities

**Company** — tenancy root. Every business table carries `company_id`, and every query filters on it.

**User** — a login identity only. Unique per company by email and by phone. `SUPER_ADMIN`, `ADMIN`, `ACCOUNTING`, `MANAGER`, `DRIVER`.

**Employee** — the parent concept for every person on the payroll: code, designation, joining/exit dates, base salary, PF applicability, UAN, PF member id, preferred language.

**Driver** — a one-to-one *extension* of Employee, holding licence number, home town and location-sharing preference. There is deliberately no separate driver person-record: a driver is an employee who drives, so payroll and documents work the same for everyone, and nobody can exist twice with two sets of details.

**Vehicle** — registration (unique per company, normalised upper-case), kind, fuel type, capacity, mileage, status, ownership (`OWNED` / `FINANCED`), and `assigned_driver_id` (unique — one vehicle, one current driver). Assignment history gets its own table when trips are implemented.

**VehicleFinancing** — optional 1:1 with Vehicle: lender, loan amount, down payment, tenure, interest rate, EMI, paid installments, outstanding amount, next due date. All nullable; the EMI workflow is a later phase.

**StoredFile** — object-storage metadata: provider, bucket, key, original filename, MIME type, size, SHA-256 checksum, uploader. **Never the bytes.**

**Document** — RC, insurance, PUC, driving licence, tyre insurance, fitness, permit, other. Owner is a vehicle, an employee or the company, with a CHECK constraint (`documents_owner_consistency`) ensuring the owner columns match the declared `owner_type` — a rule the schema language cannot express and application code should not be solely trusted with. Indexed on `(company_id, expiry_date)` for expiry scans.

**DriverLocationState** — one row per driver, updated in place: status, permission, last fix, last heartbeat, battery.

**DriverLocationPing** — append-only history, `BIGINT` identity (the highest-volume table by far), indexed `(driver_id, recorded_at DESC)`. `recorded_at` is device time, `received_at` is server time — they differ after an offline stretch, and conflating them would corrupt trip reconstruction.

**AuditLog** — immutable: actor, action (`auth.login`), entity, changes, IP, user agent, request id. No `updated_at`, because nothing may update it.

## Rules enforced in the database

Application bugs should not be able to violate these, so they live in the initial migration rather than only in code:

- `documents_owner_consistency` — owner columns match `owner_type`.
- `documents_date_order` — expiry is not before issue.
- `stored_files_size_non_negative`.
- coordinate range checks on both location tables; battery 0–100.
- `audit_logs_no_update_delete` / `audit_logs_no_truncate` triggers — audit records are append-only.

Prisma does not track CHECK constraints or triggers, so these never appear as schema drift.

## Not yet modelled

Finance ledger, salary/advance transactions, fuel entries, expenses, payments, notifications, inbox messages and trips have **no tables yet** — their business rules are not settled, and guessing at them now would mean migrating real data later. Their vocabulary is fixed in the corresponding modules so the eventual tables have no surprises.
