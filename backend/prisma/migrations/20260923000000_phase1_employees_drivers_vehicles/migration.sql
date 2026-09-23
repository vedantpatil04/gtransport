-- Phase 1 — employees, drivers, vehicles, assignments and vehicle financing.
--
-- Data-preserving: existing rows are backfilled rather than recreated. The vehicle→driver
-- link moves from `vehicles.assigned_driver_id` to the `vehicle_assignments` history table,
-- and any existing link is converted into an open assignment before the column is dropped.

-- ───────────────────────────── Enums ─────────────────────────────

-- New employment state. Added before INACTIVE to match the schema's declaration order.
ALTER TYPE "employment_status" ADD VALUE 'SUSPENDED' BEFORE 'INACTIVE';

CREATE TYPE "employee_role" AS ENUM ('DRIVER', 'ACCOUNTING', 'MANAGER', 'ADMIN', 'OTHER');
CREATE TYPE "driver_status" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ON_LEAVE');
CREATE TYPE "finance_status" AS ENUM ('ACTIVE', 'COMPLETED', 'CLOSED', 'DEFAULTED');

-- ───────────────────────────── Employees ─────────────────────────────

ALTER TABLE "employees"
  ADD COLUMN "role" "employee_role" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "department" TEXT,
  ADD COLUMN "date_of_birth" DATE,
  ADD COLUMN "notes" TEXT;

-- Anyone who already has a driver profile is a driver by role.
UPDATE "employees" e
   SET "role" = 'DRIVER'
 WHERE EXISTS (SELECT 1 FROM "drivers" d WHERE d."employee_id" = e."id");

CREATE INDEX "employees_company_id_role_idx" ON "employees"("company_id", "role");

-- ───────────────────────────── Vehicle assignments ─────────────────────────────

CREATE TABLE "vehicle_assignments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "vehicle_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vehicle_assignments_vehicle_id_started_at_idx" ON "vehicle_assignments"("vehicle_id", "started_at" DESC);
CREATE INDEX "vehicle_assignments_driver_id_started_at_idx" ON "vehicle_assignments"("driver_id", "started_at" DESC);
CREATE INDEX "vehicle_assignments_company_id_ended_at_idx" ON "vehicle_assignments"("company_id", "ended_at");

-- ───────────────────────────── Drivers ─────────────────────────────

ALTER TABLE "drivers"
  ADD COLUMN "driver_code" TEXT,
  ADD COLUMN "status" "driver_status" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "licence_expiry_date" DATE,
  ADD COLUMN "emergency_contact_name" TEXT,
  ADD COLUMN "emergency_contact_phone" TEXT,
  ADD COLUMN "current_assignment_id" UUID;

-- Existing drivers get a stable generated code, numbered per company from GR-D-101.
UPDATE "drivers" d
   SET "driver_code" = 'GR-D-' || (100 + numbered.seq)::text
  FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "company_id" ORDER BY "created_at", "id") AS seq
      FROM "drivers"
  ) AS numbered
 WHERE numbered."id" = d."id";

ALTER TABLE "drivers" ALTER COLUMN "driver_code" SET NOT NULL;

CREATE UNIQUE INDEX "drivers_current_assignment_id_key" ON "drivers"("current_assignment_id");
CREATE UNIQUE INDEX "drivers_company_id_driver_code_key" ON "drivers"("company_id", "driver_code");
CREATE UNIQUE INDEX "drivers_company_id_id_key" ON "drivers"("company_id", "id");
CREATE INDEX "drivers_company_id_status_idx" ON "drivers"("company_id", "status");
-- Superseded by the composite index above.
DROP INDEX "drivers_company_id_idx";

-- ───────────────────────────── Vehicles ─────────────────────────────

ALTER TABLE "vehicles"
  ADD COLUMN "variant" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "current_assignment_id" UUID;

CREATE UNIQUE INDEX "vehicles_current_assignment_id_key" ON "vehicles"("current_assignment_id");
CREATE UNIQUE INDEX "vehicles_company_id_id_key" ON "vehicles"("company_id", "id");
CREATE INDEX "vehicles_company_id_ownership_idx" ON "vehicles"("company_id", "ownership");

-- Convert every existing vehicle→driver link into an open assignment, then point both
-- sides at it. gen_random_uuid() is used for the backfill only; the application writes UUIDv7.
INSERT INTO "vehicle_assignments" ("id", "company_id", "vehicle_id", "driver_id", "started_at", "notes", "created_at", "updated_at")
SELECT gen_random_uuid(), v."company_id", v."id", v."assigned_driver_id", v."created_at",
       'Backfilled from vehicles.assigned_driver_id during the Phase 1 migration.',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "vehicles" v
 WHERE v."assigned_driver_id" IS NOT NULL;

UPDATE "vehicles" v
   SET "current_assignment_id" = a."id"
  FROM "vehicle_assignments" a
 WHERE a."vehicle_id" = v."id" AND a."ended_at" IS NULL;

UPDATE "drivers" d
   SET "current_assignment_id" = a."id"
  FROM "vehicle_assignments" a
 WHERE a."driver_id" = d."id" AND a."ended_at" IS NULL;

-- The link now lives in vehicle_assignments.
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_assigned_driver_id_fkey";
DROP INDEX "vehicles_assigned_driver_id_key";
ALTER TABLE "vehicles" DROP COLUMN "assigned_driver_id";

-- ───────────────────────────── Vehicle financing ─────────────────────────────

ALTER TABLE "vehicle_financings"
  ADD COLUMN "status" "finance_status" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "loan_account_number" TEXT,
  ADD COLUMN "finance_start_date" DATE,
  ADD COLUMN "total_installments" INTEGER;

-- ───────────────────────────── Foreign keys ─────────────────────────────

ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_company_id_vehicle_id_fkey" FOREIGN KEY ("company_id", "vehicle_id") REFERENCES "vehicles"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_company_id_driver_id_fkey" FOREIGN KEY ("company_id", "driver_id") REFERENCES "drivers"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_current_assignment_id_fkey" FOREIGN KEY ("current_assignment_id") REFERENCES "vehicle_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_current_assignment_id_fkey" FOREIGN KEY ("current_assignment_id") REFERENCES "vehicle_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Integrity rules the Prisma schema language cannot express.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_period_order"
  CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");

ALTER TABLE "vehicle_financings" ADD CONSTRAINT "vehicle_financings_amounts_non_negative" CHECK (
  ("loan_amount" IS NULL OR "loan_amount" >= 0) AND
  ("down_payment" IS NULL OR "down_payment" >= 0) AND
  ("emi_amount" IS NULL OR "emi_amount" >= 0) AND
  ("outstanding_amount" IS NULL OR "outstanding_amount" >= 0)
);

ALTER TABLE "vehicle_financings" ADD CONSTRAINT "vehicle_financings_rate_range"
  CHECK ("interest_rate_pct" IS NULL OR ("interest_rate_pct" >= 0 AND "interest_rate_pct" <= 100));

ALTER TABLE "vehicle_financings" ADD CONSTRAINT "vehicle_financings_installments_valid" CHECK (
  ("tenure_months" IS NULL OR "tenure_months" > 0) AND
  ("total_installments" IS NULL OR "total_installments" > 0) AND
  ("paid_installments" IS NULL OR "paid_installments" >= 0) AND
  ("paid_installments" IS NULL OR "total_installments" IS NULL OR "paid_installments" <= "total_installments")
);

-- A "current" assignment must be open and must belong to the row pointing at it. Without this,
-- application code could leave a vehicle pointing at a closed or unrelated assignment.
CREATE FUNCTION "assert_current_assignment"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_column text := TG_ARGV[0];
  assignment RECORD;
BEGIN
  IF NEW."current_assignment_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO assignment FROM "vehicle_assignments" WHERE "id" = NEW."current_assignment_id";

  IF assignment."ended_at" IS NOT NULL THEN
    RAISE EXCEPTION 'current_assignment_id % is already closed', NEW."current_assignment_id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF assignment."company_id" <> NEW."company_id" THEN
    RAISE EXCEPTION 'current_assignment_id % belongs to another company', NEW."current_assignment_id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF (target_column = 'vehicle' AND assignment."vehicle_id" <> NEW."id")
     OR (target_column = 'driver' AND assignment."driver_id" <> NEW."id") THEN
    RAISE EXCEPTION 'current_assignment_id % does not belong to this %', NEW."current_assignment_id", target_column
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "vehicles_current_assignment_check"
  BEFORE INSERT OR UPDATE OF "current_assignment_id" ON "vehicles"
  FOR EACH ROW EXECUTE FUNCTION "assert_current_assignment"('vehicle');

CREATE TRIGGER "drivers_current_assignment_check"
  BEFORE INSERT OR UPDATE OF "current_assignment_id" ON "drivers"
  FOR EACH ROW EXECUTE FUNCTION "assert_current_assignment"('driver');

-- Closing an assignment while a vehicle or driver still points at it would strand the pointer.
CREATE FUNCTION "assert_assignment_not_current_on_close"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ended_at" IS NOT NULL AND OLD."ended_at" IS NULL THEN
    IF EXISTS (SELECT 1 FROM "vehicles" WHERE "current_assignment_id" = NEW."id")
       OR EXISTS (SELECT 1 FROM "drivers" WHERE "current_assignment_id" = NEW."id") THEN
      RAISE EXCEPTION 'assignment % is still referenced as current; clear it before closing', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vehicle_assignments_close_check"
  BEFORE UPDATE OF "ended_at" ON "vehicle_assignments"
  FOR EACH ROW EXECUTE FUNCTION "assert_assignment_not_current_on_close"();

-- At most one OPEN assignment per driver and per vehicle. The unique current_assignment_id
-- columns only constrain the pointers; this constrains the rows themselves, so the invariant
-- holds even for writes that bypass the application. A partial unique index would be the
-- usual tool, but Prisma cannot represent one and would report it as drift, whereas triggers
-- are invisible to Prisma.
CREATE FUNCTION "assert_single_open_assignment"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ended_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "vehicle_assignments"
     WHERE "driver_id" = NEW."driver_id" AND "ended_at" IS NULL AND "id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'driver % already has an open assignment', NEW."driver_id"
      USING ERRCODE = 'unique_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "vehicle_assignments"
     WHERE "vehicle_id" = NEW."vehicle_id" AND "ended_at" IS NULL AND "id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'vehicle % already has an open assignment', NEW."vehicle_id"
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "vehicle_assignments_single_open"
  BEFORE INSERT OR UPDATE OF "ended_at", "driver_id", "vehicle_id" ON "vehicle_assignments"
  FOR EACH ROW EXECUTE FUNCTION "assert_single_open_assignment"();
