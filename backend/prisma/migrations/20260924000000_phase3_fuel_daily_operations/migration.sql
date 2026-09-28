-- Phase 3 — fuel and daily operations.
--
-- Additive only: two new tables and two nullable columns on documents. No existing data is
-- changed or removed. Parking, food and repair never existed in the production schema, so
-- nothing needs migrating away from them.

-- CreateEnum
CREATE TYPE "record_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "operation_category" AS ENUM ('RTO', 'TYRE', 'MAINTENANCE');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "amount" DECIMAL(12,2),
ADD COLUMN     "client_submission_id" TEXT;

-- CreateTable
CREATE TABLE "fuel_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "fuel_type" "fuel_type" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "litres" DECIMAL(10,3) NOT NULL,
    "fuel_station" TEXT NOT NULL,
    "transaction_date" DATE NOT NULL,
    "receipt_file_id" UUID,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "archive_reason" TEXT,
    "client_submission_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "fuel_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_expenses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID,
    "category" "operation_category" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "expense_date" DATE NOT NULL,
    "vendor_name" TEXT,
    "description" TEXT,
    "receipt_file_id" UUID,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(3),
    "archive_reason" TEXT,
    "client_submission_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "vehicle_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fuel_entries_company_id_transaction_date_idx" ON "fuel_entries"("company_id", "transaction_date" DESC);

-- CreateIndex
CREATE INDEX "fuel_entries_company_id_vehicle_id_transaction_date_idx" ON "fuel_entries"("company_id", "vehicle_id", "transaction_date" DESC);

-- CreateIndex
CREATE INDEX "fuel_entries_company_id_driver_id_transaction_date_idx" ON "fuel_entries"("company_id", "driver_id", "transaction_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "fuel_entries_company_id_client_submission_id_key" ON "fuel_entries"("company_id", "client_submission_id");

-- CreateIndex
CREATE INDEX "vehicle_expenses_company_id_category_expense_date_idx" ON "vehicle_expenses"("company_id", "category", "expense_date" DESC);

-- CreateIndex
CREATE INDEX "vehicle_expenses_company_id_vehicle_id_category_expense_dat_idx" ON "vehicle_expenses"("company_id", "vehicle_id", "category", "expense_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_expenses_company_id_client_submission_id_key" ON "vehicle_expenses"("company_id", "client_submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_company_id_client_submission_id_key" ON "documents"("company_id", "client_submission_id");

-- AddForeignKey
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_company_id_driver_id_fkey" FOREIGN KEY ("company_id", "driver_id") REFERENCES "drivers"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_company_id_vehicle_id_fkey" FOREIGN KEY ("company_id", "vehicle_id") REFERENCES "vehicles"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_receipt_file_id_fkey" FOREIGN KEY ("receipt_file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_company_id_vehicle_id_fkey" FOREIGN KEY ("company_id", "vehicle_id") REFERENCES "vehicles"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_company_id_driver_id_fkey" FOREIGN KEY ("company_id", "driver_id") REFERENCES "drivers"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_receipt_file_id_fkey" FOREIGN KEY ("receipt_file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Integrity rules the Prisma schema language cannot express.
-- ─────────────────────────────────────────────────────────────────────────────

-- A fill-up must have spent money on a positive quantity of fuel. This is also what makes the
-- derived rate (amount / litres) safe: litres can never be zero, so there is no division by it.
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_litres_positive" CHECK ("litres" > 0);
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_station_present" CHECK (length(btrim("fuel_station")) > 0);

ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "documents" ADD CONSTRAINT "documents_amount_non_negative" CHECK ("amount" IS NULL OR "amount" >= 0);

-- Archival is recorded consistently: an archived record always says when, an active one never does.
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_archive_consistency" CHECK (
  ("status" = 'ARCHIVED' AND "archived_at" IS NOT NULL) OR ("status" = 'ACTIVE' AND "archived_at" IS NULL)
);
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_archive_consistency" CHECK (
  ("status" = 'ARCHIVED' AND "archived_at" IS NOT NULL) OR ("status" = 'ACTIVE' AND "archived_at" IS NULL)
);
