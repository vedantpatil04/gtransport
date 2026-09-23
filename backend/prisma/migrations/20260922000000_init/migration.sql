-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'ACCOUNTING', 'MANAGER', 'DRIVER');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "employment_status" AS ENUM ('ACTIVE', 'ON_LEAVE', 'INACTIVE', 'EXITED');

-- CreateEnum
CREATE TYPE "app_language" AS ENUM ('EN', 'HI', 'KN', 'MR', 'TA', 'TE');

-- CreateEnum
CREATE TYPE "vehicle_kind" AS ENUM ('LCV', 'PICKUP', 'TRUCK');

-- CreateEnum
CREATE TYPE "fuel_type" AS ENUM ('PETROL', 'DIESEL');

-- CreateEnum
CREATE TYPE "vehicle_status" AS ENUM ('ACTIVE', 'MAINTENANCE', 'IDLE', 'RETIRED');

-- CreateEnum
CREATE TYPE "vehicle_ownership" AS ENUM ('OWNED', 'FINANCED');

-- CreateEnum
CREATE TYPE "document_type" AS ENUM ('RC', 'INSURANCE', 'PUC', 'DRIVING_LICENCE', 'TYRE_INSURANCE', 'FITNESS', 'PERMIT', 'OTHER');

-- CreateEnum
CREATE TYPE "document_owner_type" AS ENUM ('VEHICLE', 'EMPLOYEE', 'COMPANY');

-- CreateEnum
CREATE TYPE "document_verification_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "storage_provider" AS ENUM ('LOCAL', 'R2');

-- CreateEnum
CREATE TYPE "location_status" AS ENUM ('ACTIVE', 'PERMISSION_DENIED', 'LOCATION_DISABLED', 'OFFLINE', 'STALE');

-- CreateEnum
CREATE TYPE "location_permission" AS ENUM ('UNKNOWN', 'GRANTED_ALWAYS', 'GRANTED_FOREGROUND', 'DENIED');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "gstin" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID,
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "designation" TEXT,
    "preferred_language" "app_language" NOT NULL DEFAULT 'EN',
    "status" "employment_status" NOT NULL DEFAULT 'ACTIVE',
    "joining_date" DATE,
    "exit_date" DATE,
    "base_salary" DECIMAL(12,2),
    "pf_applicable" BOOLEAN NOT NULL DEFAULT false,
    "uan" TEXT,
    "pf_member_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "licence_number" TEXT,
    "home_town" TEXT,
    "location_sharing_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "registration_number" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "kind" "vehicle_kind" NOT NULL,
    "fuel_type" "fuel_type" NOT NULL,
    "capacity_tonnes" DECIMAL(6,2),
    "manufacture_year" INTEGER,
    "mileage_kmpl" DECIMAL(5,2),
    "status" "vehicle_status" NOT NULL DEFAULT 'ACTIVE',
    "ownership" "vehicle_ownership" NOT NULL DEFAULT 'OWNED',
    "assigned_driver_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_financings" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "lender_name" TEXT,
    "loan_amount" DECIMAL(14,2),
    "down_payment" DECIMAL(14,2),
    "tenure_months" INTEGER,
    "interest_rate_pct" DECIMAL(5,2),
    "emi_amount" DECIMAL(12,2),
    "paid_installments" INTEGER,
    "outstanding_amount" DECIMAL(14,2),
    "next_due_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "vehicle_financings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" "storage_provider" NOT NULL,
    "bucket" TEXT,
    "object_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "document_type" NOT NULL,
    "custom_name" TEXT,
    "owner_type" "document_owner_type" NOT NULL,
    "vehicle_id" UUID,
    "employee_id" UUID,
    "document_number" TEXT,
    "issuer" TEXT,
    "issue_date" DATE,
    "expiry_date" DATE,
    "file_id" UUID,
    "verification_status" "document_verification_status" NOT NULL DEFAULT 'PENDING',
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_location_states" (
    "driver_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" "location_status" NOT NULL DEFAULT 'OFFLINE',
    "permission" "location_permission" NOT NULL DEFAULT 'UNKNOWN',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "accuracy_meters" DECIMAL(8,2),
    "speed_kmh" DECIMAL(6,2),
    "heading_deg" DECIMAL(5,2),
    "battery_pct" INTEGER,
    "recorded_at" TIMESTAMPTZ(3),
    "last_heartbeat_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_location_states_pkey" PRIMARY KEY ("driver_id")
);

-- CreateTable
CREATE TABLE "driver_location_pings" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "accuracy_meters" DECIMAL(8,2),
    "speed_kmh" DECIMAL(6,2),
    "heading_deg" DECIMAL(5,2),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_location_pings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "company_id" UUID,
    "actor_user_id" UUID,
    "actor_role" "user_role",
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE INDEX "users_company_id_role_idx" ON "users"("company_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_company_id_email_key" ON "users"("company_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_company_id_phone_key" ON "users"("company_id", "phone");

-- CreateIndex
CREATE INDEX "employees_company_id_status_idx" ON "employees"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_employee_code_key" ON "employees"("company_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_employee_id_key" ON "drivers"("employee_id");

-- CreateIndex
CREATE INDEX "drivers_company_id_idx" ON "drivers"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_assigned_driver_id_key" ON "vehicles"("assigned_driver_id");

-- CreateIndex
CREATE INDEX "vehicles_company_id_status_idx" ON "vehicles"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_company_id_registration_number_key" ON "vehicles"("company_id", "registration_number");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_financings_vehicle_id_key" ON "vehicle_financings"("vehicle_id");

-- CreateIndex
CREATE INDEX "stored_files_company_id_created_at_idx" ON "stored_files"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_provider_object_key_key" ON "stored_files"("provider", "object_key");

-- CreateIndex
CREATE INDEX "documents_company_id_expiry_date_idx" ON "documents"("company_id", "expiry_date");

-- CreateIndex
CREATE INDEX "documents_company_id_type_idx" ON "documents"("company_id", "type");

-- CreateIndex
CREATE INDEX "documents_vehicle_id_idx" ON "documents"("vehicle_id");

-- CreateIndex
CREATE INDEX "documents_employee_id_idx" ON "documents"("employee_id");

-- CreateIndex
CREATE INDEX "driver_location_states_company_id_status_idx" ON "driver_location_states"("company_id", "status");

-- CreateIndex
CREATE INDEX "driver_location_pings_driver_id_recorded_at_idx" ON "driver_location_pings"("driver_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "driver_location_pings_company_id_recorded_at_idx" ON "driver_location_pings"("company_id", "recorded_at");

-- CreateIndex
CREATE INDEX "audit_logs_company_id_occurred_at_idx" ON "audit_logs"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_occurred_at_idx" ON "audit_logs"("actor_user_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_assigned_driver_id_fkey" FOREIGN KEY ("assigned_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_financings" ADD CONSTRAINT "vehicle_financings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_location_states" ADD CONSTRAINT "driver_location_states_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_location_pings" ADD CONSTRAINT "driver_location_pings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Integrity rules that the Prisma schema language cannot express.
-- Prisma does not track CHECK constraints or triggers, so they never cause drift.
-- ─────────────────────────────────────────────────────────────────────────────

-- A document belongs to exactly the owner its owner_type names.
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_consistency" CHECK (
  ("owner_type" = 'VEHICLE'  AND "vehicle_id" IS NOT NULL AND "employee_id" IS NULL) OR
  ("owner_type" = 'EMPLOYEE' AND "employee_id" IS NOT NULL AND "vehicle_id" IS NULL) OR
  ("owner_type" = 'COMPANY'  AND "vehicle_id" IS NULL AND "employee_id" IS NULL)
);

ALTER TABLE "documents" ADD CONSTRAINT "documents_date_order"
  CHECK ("issue_date" IS NULL OR "expiry_date" IS NULL OR "issue_date" <= "expiry_date");

ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_size_non_negative" CHECK ("size_bytes" >= 0);

ALTER TABLE "driver_location_pings" ADD CONSTRAINT "driver_location_pings_coordinates_range"
  CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);

ALTER TABLE "driver_location_states" ADD CONSTRAINT "driver_location_states_coordinates_range"
  CHECK (("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90) AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180));

ALTER TABLE "driver_location_states" ADD CONSTRAINT "driver_location_states_battery_range"
  CHECK ("battery_pct" IS NULL OR "battery_pct" BETWEEN 0 AND 100);

-- Audit records are append-only: block UPDATE, DELETE and TRUNCATE at the database level.
CREATE FUNCTION "audit_logs_prevent_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_logs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_prevent_mutation"();

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_prevent_mutation"();
