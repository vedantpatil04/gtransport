-- Phase 5 — finance and payments.
--
-- Additive: new finance tables plus one nullable column on vehicle_financings. Existing fuel,
-- RTO/tyre/maintenance and tyre-insurance premium records are posted into the new ledger once,
-- by reference (source_type + source_id); the records themselves are not copied or changed.

-- CreateEnum
CREATE TYPE "ledger_direction" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ledger_entry_type" AS ENUM ('FUEL', 'RTO', 'TYRE', 'TYRE_INSURANCE', 'MAINTENANCE', 'SALARY', 'ADVANCE', 'ALLOWANCE', 'OTHER_PAYMENT', 'EMI', 'CUSTOMER_PAYMENT', 'OTHER_INCOME', 'OTHER_EXPENSE');

-- CreateEnum
CREATE TYPE "ledger_source_type" AS ENUM ('FUEL_ENTRY', 'VEHICLE_EXPENSE', 'DOCUMENT', 'SALARY', 'ADVANCE', 'PAYMENT', 'FINANCE_INSTALLMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "salary_status" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "advance_type" AS ENUM ('SALARY_ADVANCE', 'FUEL_ADVANCE', 'TRIP_ADVANCE', 'OTHER_ADVANCE');

-- CreateEnum
CREATE TYPE "advance_status" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_type" AS ENUM ('SALARY', 'ADVANCE', 'ALLOWANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'STATUS_REVIEW_REQUIRED', 'PAID', 'FAILED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('UPI', 'BANK_TRANSFER', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('MANUAL', 'RAZORPAY', 'RAZORPAYX');

-- CreateEnum
CREATE TYPE "finance_event_type" AS ENUM ('PAYMENT_CREATED', 'PAYMENT_PROCESSING', 'PAYMENT_PAID', 'PAYMENT_FAILED', 'PAYMENT_REVERSED');

-- CreateEnum
CREATE TYPE "installment_status" AS ENUM ('PENDING', 'PAID');

-- AlterTable
ALTER TABLE "vehicle_financings" ADD COLUMN     "finance_end_date" DATE;

-- CreateTable
CREATE TABLE "finance_ledger_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "transaction_date" DATE NOT NULL,
    "type" "ledger_entry_type" NOT NULL,
    "direction" "ledger_direction" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "employee_id" UUID,
    "driver_id" UUID,
    "vehicle_id" UUID,
    "source_type" "ledger_source_type" NOT NULL,
    "source_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "payment_record_id" UUID,
    "reversal_of_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "finance_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "pay_period" DATE NOT NULL,
    "base_salary" DECIMAL(12,2) NOT NULL,
    "allowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "advance_recovery" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_payable" DECIMAL(12,2) NOT NULL,
    "status" "salary_status" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "salary_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advances" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" "advance_type" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "advance_date" DATE NOT NULL,
    "reason" TEXT,
    "status" "advance_status" NOT NULL DEFAULT 'PENDING',
    "recovered_in_salary_id" UUID,
    "notes" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" "payment_type" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'DRAFT',
    "method" "payment_method" NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "salary_record_id" UUID,
    "advance_id" UUID,
    "description" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT,
    "provider_reference" TEXT,
    "provider_status" TEXT,
    "payment_reference" TEXT,
    "recipient_summary" TEXT,
    "provider_fund_account_id" TEXT,
    "failure_reason" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "reversed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_provider_events" (
    "id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "provider_reference" TEXT,
    "payment_record_id" UUID,
    "payload" JSONB NOT NULL,
    "outcome" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "finance_event_type" NOT NULL,
    "payment_record_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMPTZ(3),

    CONSTRAINT "finance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_payout_accounts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "account_holder_name" TEXT NOT NULL,
    "ifsc" TEXT,
    "account_number_last4" TEXT,
    "upi_id_masked" TEXT,
    "provider" "payment_provider" NOT NULL,
    "provider_contact_id" TEXT,
    "provider_fund_account_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "employee_payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_finance_installments" (
    "id" UUID NOT NULL,
    "financing_id" UUID NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "installment_status" NOT NULL DEFAULT 'PENDING',
    "paid_at" DATE,
    "payment_reference" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "vehicle_finance_installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_ledger_entries_reversal_of_id_key" ON "finance_ledger_entries"("reversal_of_id");

-- CreateIndex
CREATE INDEX "finance_ledger_entries_company_id_transaction_date_idx" ON "finance_ledger_entries"("company_id", "transaction_date" DESC);

-- CreateIndex
CREATE INDEX "finance_ledger_entries_company_id_type_transaction_date_idx" ON "finance_ledger_entries"("company_id", "type", "transaction_date");

-- CreateIndex
CREATE INDEX "finance_ledger_entries_company_id_employee_id_transaction_d_idx" ON "finance_ledger_entries"("company_id", "employee_id", "transaction_date");

-- CreateIndex
CREATE INDEX "finance_ledger_entries_company_id_vehicle_id_transaction_da_idx" ON "finance_ledger_entries"("company_id", "vehicle_id", "transaction_date");

-- CreateIndex
CREATE UNIQUE INDEX "finance_ledger_entries_company_id_source_type_source_id_seq_key" ON "finance_ledger_entries"("company_id", "source_type", "source_id", "sequence");

-- CreateIndex
CREATE INDEX "salary_records_company_id_pay_period_idx" ON "salary_records"("company_id", "pay_period");

-- CreateIndex
CREATE INDEX "salary_records_company_id_employee_id_pay_period_idx" ON "salary_records"("company_id", "employee_id", "pay_period");

-- CreateIndex
CREATE INDEX "advances_company_id_advance_date_idx" ON "advances"("company_id", "advance_date");

-- CreateIndex
CREATE INDEX "advances_company_id_employee_id_status_idx" ON "advances"("company_id", "employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_records_idempotency_key_key" ON "payment_records"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_records_provider_reference_key" ON "payment_records"("provider_reference");

-- CreateIndex
CREATE INDEX "payment_records_company_id_status_idx" ON "payment_records"("company_id", "status");

-- CreateIndex
CREATE INDEX "payment_records_company_id_employee_id_created_at_idx" ON "payment_records"("company_id", "employee_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_records_salary_record_id_idx" ON "payment_records"("salary_record_id");

-- CreateIndex
CREATE INDEX "payment_records_advance_id_idx" ON "payment_records"("advance_id");

-- CreateIndex
CREATE INDEX "payment_provider_events_provider_reference_idx" ON "payment_provider_events"("provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_events_provider_event_id_key" ON "payment_provider_events"("provider", "event_id");

-- CreateIndex
CREATE INDEX "finance_events_company_id_notified_at_occurred_at_idx" ON "finance_events"("company_id", "notified_at", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "finance_events_payment_record_id_type_key" ON "finance_events"("payment_record_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "employee_payout_accounts_employee_id_key" ON "employee_payout_accounts"("employee_id");

-- CreateIndex
CREATE INDEX "employee_payout_accounts_company_id_idx" ON "employee_payout_accounts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_finance_installments_financing_id_installment_numbe_key" ON "vehicle_finance_installments"("financing_id", "installment_number");

-- AddForeignKey
ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_payment_record_id_fkey" FOREIGN KEY ("payment_record_id") REFERENCES "payment_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "finance_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_recovered_in_salary_id_fkey" FOREIGN KEY ("recovered_in_salary_id") REFERENCES "salary_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_salary_record_id_fkey" FOREIGN KEY ("salary_record_id") REFERENCES "salary_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_provider_events" ADD CONSTRAINT "payment_provider_events_payment_record_id_fkey" FOREIGN KEY ("payment_record_id") REFERENCES "payment_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_payment_record_id_fkey" FOREIGN KEY ("payment_record_id") REFERENCES "payment_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payout_accounts" ADD CONSTRAINT "employee_payout_accounts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_finance_installments" ADD CONSTRAINT "vehicle_finance_installments_financing_id_fkey" FOREIGN KEY ("financing_id") REFERENCES "vehicle_financings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill the ledger from existing operating expenses (active records only).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "finance_ledger_entries"
  ("id", "company_id", "transaction_date", "type", "direction", "amount", "description",
   "driver_id", "vehicle_id", "source_type", "source_id", "sequence", "created_at", "updated_at", "created_by_id")
SELECT gen_random_uuid(), f."company_id", f."transaction_date", 'FUEL', 'EXPENSE', f."amount", f."fuel_station",
       f."driver_id", f."vehicle_id", 'FUEL_ENTRY', f."id", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, f."created_by_id"
  FROM "fuel_entries" f
 WHERE f."status" = 'ACTIVE';

INSERT INTO "finance_ledger_entries"
  ("id", "company_id", "transaction_date", "type", "direction", "amount", "description",
   "driver_id", "vehicle_id", "source_type", "source_id", "sequence", "created_at", "updated_at", "created_by_id")
SELECT gen_random_uuid(), e."company_id", e."expense_date", e."category"::text::"ledger_entry_type", 'EXPENSE', e."amount",
       COALESCE(e."vendor_name", e."description"), e."driver_id", e."vehicle_id", 'VEHICLE_EXPENSE', e."id", 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, e."created_by_id"
  FROM "vehicle_expenses" e
 WHERE e."status" = 'ACTIVE';

-- Tyre-insurance premiums were real payments even when the policy was later superseded.
INSERT INTO "finance_ledger_entries"
  ("id", "company_id", "transaction_date", "type", "direction", "amount", "description",
   "vehicle_id", "source_type", "source_id", "sequence", "created_at", "updated_at", "created_by_id")
SELECT gen_random_uuid(), d."company_id", COALESCE(d."issue_date", d."created_at"::date), 'TYRE_INSURANCE', 'EXPENSE', d."amount",
       d."issuer", d."vehicle_id", 'DOCUMENT', d."id", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, d."created_by_id"
  FROM "documents" d
 WHERE d."type" = 'TYRE_INSURANCE' AND d."amount" > 0 AND d."deleted_at" IS NULL AND d."state" <> 'ARCHIVED';

-- ─────────────────────────────────────────────────────────────────────────────
-- Money rules the Prisma schema language cannot express.
-- ─────────────────────────────────────────────────────────────────────────────

-- A ledger line is never zero; only a reversal may be negative, and a reversal must be negative.
ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "ledger_amount_sign" CHECK (
  ("reversal_of_id" IS NULL AND "amount" > 0) OR ("reversal_of_id" IS NOT NULL AND "amount" < 0)
);

ALTER TABLE "salary_records" ADD CONSTRAINT "salary_components_non_negative" CHECK (
  "base_salary" >= 0 AND "allowances" >= 0 AND "advance_recovery" >= 0 AND "deductions" >= 0 AND "net_payable" >= 0
);
-- The stored net can never disagree with its components.
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_net_payable_matches" CHECK (
  "net_payable" = "base_salary" + "allowances" - "advance_recovery" - "deductions"
);

ALTER TABLE "advances" ADD CONSTRAINT "advances_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "vehicle_finance_installments" ADD CONSTRAINT "installments_amount_positive" CHECK ("amount" > 0);

-- A provider payout cannot be in flight without the idempotency key that protects it.
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_payout_has_key" CHECK (
  "provider" <> 'RAZORPAYX' OR "status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED') OR "idempotency_key" IS NOT NULL
);

-- One active (non-cancelled) salary per employee per month. A trigger, because Prisma cannot
-- represent a partial unique index and would otherwise report it as drift.
CREATE FUNCTION "assert_single_salary_per_period"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'CANCELLED' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "salary_records"
     WHERE "id" <> NEW."id" AND "company_id" = NEW."company_id" AND "employee_id" = NEW."employee_id"
       AND "pay_period" = NEW."pay_period" AND "status" <> 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'a salary already exists for this employee and month'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- At most one ACTIVE payment per salary and per advance. A cancelled or reversed payment stays
-- on record, and a new payment can then be made for the same salary.
CREATE FUNCTION "assert_single_active_payment"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IN ('CANCELLED', 'REVERSED') THEN
    RETURN NEW;
  END IF;
  IF NEW."salary_record_id" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "payment_records" WHERE "id" <> NEW."id" AND "salary_record_id" = NEW."salary_record_id"
       AND "status" NOT IN ('CANCELLED', 'REVERSED')
  ) THEN
    RAISE EXCEPTION 'this salary already has an active payment' USING ERRCODE = 'unique_violation';
  END IF;
  IF NEW."advance_id" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "payment_records" WHERE "id" <> NEW."id" AND "advance_id" = NEW."advance_id"
       AND "status" NOT IN ('CANCELLED', 'REVERSED')
  ) THEN
    RAISE EXCEPTION 'this advance already has an active payment' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payment_records_single_active"
  BEFORE INSERT OR UPDATE OF "status", "salary_record_id", "advance_id" ON "payment_records"
  FOR EACH ROW EXECUTE FUNCTION "assert_single_active_payment"();

CREATE TRIGGER "salary_records_single_per_period"
  BEFORE INSERT OR UPDATE OF "status", "pay_period", "employee_id" ON "salary_records"
  FOR EACH ROW EXECUTE FUNCTION "assert_single_salary_per_period"();
