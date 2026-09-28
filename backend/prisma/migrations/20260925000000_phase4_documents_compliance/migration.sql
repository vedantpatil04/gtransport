-- Phase 4 — documents and compliance.
--
-- Data-preserving: documents gain a history state (CURRENT / SUPERSEDED / ARCHIVED) and every
-- existing row starts as CURRENT. Where earlier phases left several current documents of the
-- same type on one vehicle or person (e.g. repeated tyre-insurance entries), the newest stays
-- current and the older ones become its history. Nothing is deleted.

-- CreateEnum
CREATE TYPE "document_state" AS ENUM ('CURRENT', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "expiry_threshold" AS ENUM ('DAYS_30', 'DAYS_15', 'DAYS_7', 'DAYS_3', 'DAYS_1', 'EXPIRED');

-- DropIndex
DROP INDEX "documents_company_id_expiry_date_idx";

-- DropIndex
DROP INDEX "documents_company_id_type_idx";

-- DropIndex
DROP INDEX "documents_vehicle_id_idx";

-- DropIndex
DROP INDEX "documents_employee_id_idx";

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "archive_reason" TEXT,
ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "state" "document_state" NOT NULL DEFAULT 'CURRENT',
ADD COLUMN     "superseded_at" TIMESTAMPTZ(3),
ADD COLUMN     "superseded_by_id" UUID;

-- CreateTable
CREATE TABLE "document_expiry_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "threshold" "expiry_threshold" NOT NULL,
    "expiry_date" DATE NOT NULL,
    "days_remaining" INTEGER NOT NULL,
    "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMPTZ(3),

    CONSTRAINT "document_expiry_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_expiry_events_company_id_notified_at_detected_at_idx" ON "document_expiry_events"("company_id", "notified_at", "detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_expiry_events_document_id_threshold_expiry_date_key" ON "document_expiry_events"("document_id", "threshold", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "documents_superseded_by_id_key" ON "documents"("superseded_by_id");

-- CreateIndex
CREATE INDEX "documents_company_id_state_expiry_date_idx" ON "documents"("company_id", "state", "expiry_date");

-- CreateIndex
CREATE INDEX "documents_company_id_state_type_idx" ON "documents"("company_id", "state", "type");

-- CreateIndex
CREATE INDEX "documents_company_id_state_verification_status_idx" ON "documents"("company_id", "state", "verification_status");

-- CreateIndex
CREATE INDEX "documents_vehicle_id_type_state_idx" ON "documents"("vehicle_id", "type", "state");

-- CreateIndex
CREATE INDEX "documents_employee_id_type_state_idx" ON "documents"("employee_id", "type", "state");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_expiry_events" ADD CONSTRAINT "document_expiry_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: one CURRENT document per type per owner. "Other" documents may be many.
-- Older duplicates are chained to the next newer one, preserving their file references.
-- ─────────────────────────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT "id",
         LEAD("id") OVER (
           PARTITION BY "company_id", "type", COALESCE("vehicle_id", "employee_id")
           ORDER BY "created_at", "id"
         ) AS next_id
    FROM "documents"
   WHERE "type" <> 'OTHER' AND "deleted_at" IS NULL AND COALESCE("vehicle_id", "employee_id") IS NOT NULL
)
UPDATE "documents" d
   SET "state" = 'SUPERSEDED',
       "superseded_at" = CURRENT_TIMESTAMP,
       "superseded_by_id" = ranked.next_id
  FROM ranked
 WHERE d."id" = ranked."id" AND ranked.next_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Integrity rules the Prisma schema language cannot express.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "documents" ADD CONSTRAINT "documents_state_consistency" CHECK (
  ("state" = 'ARCHIVED' AND "archived_at" IS NOT NULL) OR
  ("state" = 'SUPERSEDED' AND "superseded_at" IS NOT NULL) OR
  ("state" = 'CURRENT' AND "archived_at" IS NULL AND "superseded_at" IS NULL)
);

ALTER TABLE "document_expiry_events" ADD CONSTRAINT "document_expiry_events_days_consistent" CHECK (
  ("threshold" = 'EXPIRED' AND "days_remaining" < 0) OR ("threshold" <> 'EXPIRED' AND "days_remaining" >= 0)
);

-- At most one CURRENT document of each type per vehicle or person ("Other" excepted). A partial
-- unique index would be the usual tool, but Prisma cannot represent one; triggers are invisible
-- to Prisma, so this cannot be dropped by a later `migrate dev`.
CREATE FUNCTION "assert_single_current_document"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."state" <> 'CURRENT' OR NEW."type" = 'OTHER' OR NEW."deleted_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "documents"
     WHERE "id" <> NEW."id"
       AND "company_id" = NEW."company_id"
       AND "type" = NEW."type"
       AND "state" = 'CURRENT'
       AND "deleted_at" IS NULL
       AND ((NEW."vehicle_id" IS NOT NULL AND "vehicle_id" = NEW."vehicle_id")
         OR (NEW."employee_id" IS NOT NULL AND "employee_id" = NEW."employee_id"))
  ) THEN
    RAISE EXCEPTION 'a current % document already exists for this owner; replace it instead', NEW."type"
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "documents_single_current"
  BEFORE INSERT OR UPDATE OF "state", "type", "vehicle_id", "employee_id" ON "documents"
  FOR EACH ROW EXECUTE FUNCTION "assert_single_current_document"();
