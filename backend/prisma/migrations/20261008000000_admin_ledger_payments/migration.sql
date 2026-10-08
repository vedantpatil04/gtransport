-- Admin ledger & payments hardening.
-- Additive only: two enum values (CHEQUE, PHONEPE), two nullable payment columns (remarks, proof),
-- and the manual_ledger_entries source table. No existing row, column or constraint changes.

-- AlterEnum
ALTER TYPE "payment_method" ADD VALUE 'CHEQUE';

-- AlterEnum
ALTER TYPE "payment_provider" ADD VALUE 'PHONEPE';

-- AlterTable
ALTER TABLE "payment_records" ADD COLUMN     "proof_file_id" UUID,
ADD COLUMN     "remarks" TEXT;

-- CreateTable
CREATE TABLE "manual_ledger_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "transaction_date" DATE NOT NULL,
    "type" "ledger_entry_type" NOT NULL,
    "direction" "ledger_direction" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "employee_id" UUID,
    "vehicle_id" UUID,
    "payment_method" "payment_method",
    "reference" TEXT,
    "remarks" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(3),
    "archive_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "manual_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manual_ledger_entries_company_id_transaction_date_idx" ON "manual_ledger_entries"("company_id", "transaction_date" DESC);

-- AddForeignKey
ALTER TABLE "manual_ledger_entries" ADD CONSTRAINT "manual_ledger_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_ledger_entries" ADD CONSTRAINT "manual_ledger_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_ledger_entries" ADD CONSTRAINT "manual_ledger_entries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_proof_file_id_fkey" FOREIGN KEY ("proof_file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
