-- Phase 7 (completion) — service AI states, verified service details, OAuth mailboxes and
-- reviewable email suggestions.
--
--   1. Service receipt states take the explicit Phase 7 names. Values are RENAMED, not recreated,
--      so every existing row, job and constraint keeps its meaning:
--        PENDING → QUEUED, COMPLETED → SUCCEEDED, REVIEW_REQUIRED → NEEDS_REVIEW, CONFIRMED → VERIFIED.
--   2. A verified maintenance record can carry the structured service details a person confirmed
--      (invoice number, service type, odometer, next service, labour/parts/tax, line items).
--      Nullable: nothing existing is rewritten, and nothing is ever filled in by a model.
--   3. Gmail and Microsoft 365 mailboxes connect through OAuth; tokens are stored encrypted.
--   4. Email categories follow the office's own vocabulary; AI-proposed actions become reviewable
--      suggestions that nothing acts on until a person accepts them.

-- ───────────────────────── 1. Receipt states ─────────────────────────

ALTER TYPE "service_receipt_ai_status" RENAME VALUE 'PENDING' TO 'QUEUED';
ALTER TYPE "service_receipt_ai_status" RENAME VALUE 'COMPLETED' TO 'SUCCEEDED';
ALTER TYPE "service_receipt_ai_status" RENAME VALUE 'REVIEW_REQUIRED' TO 'NEEDS_REVIEW';
ALTER TYPE "service_receipt_ai_status" RENAME VALUE 'CONFIRMED' TO 'VERIFIED';

ALTER TABLE "service_receipt_ai_jobs" ALTER COLUMN "status" SET DEFAULT 'QUEUED';

-- Enum constants in a CHECK are stored by identity, so the constraint below already follows the
-- rename; it is recreated under a name that says what it now checks.
ALTER TABLE "vehicle_expenses" DROP CONSTRAINT "vehicle_expenses_confirmed_has_verification";
ALTER TABLE "vehicle_expenses"
  ADD CONSTRAINT "vehicle_expenses_verified_has_verification"
    CHECK ("ai_status" <> 'VERIFIED' OR "ai_verified_at" IS NOT NULL);

-- ───────────────────────── 2. Verified service details ─────────────────────────

ALTER TABLE "vehicle_expenses"
  ADD COLUMN "invoice_number"     TEXT,
  ADD COLUMN "service_type"       TEXT,
  ADD COLUMN "odometer_km"        INTEGER,
  ADD COLUMN "next_service_date"  DATE,
  ADD COLUMN "next_service_km"    INTEGER,
  ADD COLUMN "labour_amount"      DECIMAL(12,2),
  ADD COLUMN "parts_amount"       DECIMAL(12,2),
  ADD COLUMN "tax_amount"         DECIMAL(12,2),
  ADD COLUMN "service_line_items" JSONB;

ALTER TABLE "vehicle_expenses"
  ADD CONSTRAINT "vehicle_expenses_odometer_non_negative" CHECK ("odometer_km" IS NULL OR "odometer_km" >= 0),
  ADD CONSTRAINT "vehicle_expenses_next_service_km_non_negative" CHECK ("next_service_km" IS NULL OR "next_service_km" >= 0),
  ADD CONSTRAINT "vehicle_expenses_service_amounts_non_negative" CHECK (
    ("labour_amount" IS NULL OR "labour_amount" >= 0)
    AND ("parts_amount" IS NULL OR "parts_amount" >= 0)
    AND ("tax_amount" IS NULL OR "tax_amount" >= 0)
  );

CREATE INDEX "vehicle_expenses_company_id_next_service_date_idx"
  ON "vehicle_expenses"("company_id", "next_service_date");

-- ───────────────────────── 3. Mailbox connections ─────────────────────────

CREATE TYPE "mailbox_connection_status" AS ENUM ('PENDING', 'CONNECTED', 'REAUTHORIZATION_REQUIRED', 'DISCONNECTED');

CREATE TABLE "mailbox_connections" (
    "id"                             UUID NOT NULL,
    "company_id"                     UUID NOT NULL,
    "provider"                       "email_provider_name" NOT NULL,
    "status"                         "mailbox_connection_status" NOT NULL DEFAULT 'PENDING',
    "email_address"                  TEXT,
    "scopes"                         TEXT[] DEFAULT ARRAY[]::TEXT[],
    "refresh_token_ciphertext"       TEXT,
    "access_token_ciphertext"        TEXT,
    "access_token_expires_at"        TIMESTAMPTZ(3),
    "oauth_state_hash"               TEXT,
    "oauth_code_verifier_ciphertext" TEXT,
    "oauth_requested_by_id"          UUID,
    "oauth_expires_at"               TIMESTAMPTZ(3),
    "connected_at"                   TIMESTAMPTZ(3),
    "connected_by_id"                UUID,
    "disconnected_at"                TIMESTAMPTZ(3),
    "disconnected_by_id"             UUID,
    "last_error"                     TEXT,
    "last_error_at"                  TIMESTAMPTZ(3),
    "created_at"                     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                     TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mailbox_connections_pkey" PRIMARY KEY ("id")
);

-- A connected mailbox has a refresh token; a disconnected one has none. The database refuses
-- a "connected" row with nothing behind it, which is the fake connection Phase 7 forbids.
ALTER TABLE "mailbox_connections"
  ADD CONSTRAINT "mailbox_connections_oauth_provider"
    CHECK ("provider" IN ('GMAIL', 'MICROSOFT_GRAPH')),
  ADD CONSTRAINT "mailbox_connections_connected_has_token"
    CHECK ("status" <> 'CONNECTED' OR ("refresh_token_ciphertext" IS NOT NULL AND "email_address" IS NOT NULL)),
  ADD CONSTRAINT "mailbox_connections_disconnected_has_no_token"
    CHECK ("status" <> 'DISCONNECTED' OR ("refresh_token_ciphertext" IS NULL AND "access_token_ciphertext" IS NULL));

CREATE UNIQUE INDEX "mailbox_connections_oauth_state_hash_key" ON "mailbox_connections"("oauth_state_hash");
CREATE UNIQUE INDEX "mailbox_connections_company_id_provider_key" ON "mailbox_connections"("company_id", "provider");

ALTER TABLE "mailbox_connections"
  ADD CONSTRAINT "mailbox_connections_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sync retry with backoff.
ALTER TABLE "email_sync_cursors" ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3);

-- ───────────────────────── 4. Categories, retries, suggestions ─────────────────────────

-- The category vocabulary changes, so the type is replaced and existing values are mapped onto
-- the nearest new category. Nothing is dropped: every message keeps a category.
ALTER TYPE "inbox_classification" RENAME TO "inbox_classification_old";
CREATE TYPE "inbox_classification" AS ENUM (
  'VEHICLE_DOCUMENT', 'FUEL', 'MAINTENANCE', 'FINANCE', 'SALARY_PAYMENT', 'COMPLIANCE',
  'VENDOR', 'CUSTOMER', 'GENERAL', 'SPAM', 'UNCLASSIFIED'
);

ALTER TABLE "inbox_messages" ALTER COLUMN "classification" DROP DEFAULT;
ALTER TABLE "inbox_messages"
  ALTER COLUMN "classification" TYPE "inbox_classification"
  USING (
    CASE "classification"::text
      WHEN 'DOCUMENT' THEN 'VEHICLE_DOCUMENT'
      WHEN 'SERVICE_INVOICE' THEN 'MAINTENANCE'
      WHEN 'PAYMENT_NOTIFICATION' THEN 'SALARY_PAYMENT'
      WHEN 'SUPPLIER' THEN 'VENDOR'
      WHEN 'CUSTOMER_ENQUIRY' THEN 'CUSTOMER'
      WHEN 'OPERATIONAL' THEN 'GENERAL'
      ELSE "classification"::text
    END
  )::"inbox_classification";
ALTER TABLE "inbox_messages" ALTER COLUMN "classification" SET DEFAULT 'UNCLASSIFIED';

ALTER TABLE "inbox_ai_results"
  ALTER COLUMN "classification" TYPE "inbox_classification"
  USING (
    CASE "classification"::text
      WHEN 'DOCUMENT' THEN 'VEHICLE_DOCUMENT'
      WHEN 'SERVICE_INVOICE' THEN 'MAINTENANCE'
      WHEN 'PAYMENT_NOTIFICATION' THEN 'SALARY_PAYMENT'
      WHEN 'SUPPLIER' THEN 'VENDOR'
      WHEN 'CUSTOMER_ENQUIRY' THEN 'CUSTOMER'
      WHEN 'OPERATIONAL' THEN 'GENERAL'
      ELSE "classification"::text
    END
  )::"inbox_classification";

DROP TYPE "inbox_classification_old";

ALTER TYPE "inbox_ai_status" ADD VALUE 'RETRYING' BEFORE 'FAILED';
ALTER TABLE "inbox_messages" ADD COLUMN "ai_next_attempt_at" TIMESTAMPTZ(3);

ALTER TABLE "inbox_attachments" ADD COLUMN "download_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "inbox_attachments"
  ADD CONSTRAINT "inbox_attachments_download_attempts_non_negative" CHECK ("download_attempts" >= 0);
-- Attachments filed before this column existed were downloaded (or refused) once.
UPDATE "inbox_attachments" SET "download_attempts" = 1;

CREATE TYPE "inbox_suggestion_type" AS ENUM (
  'CREATE_SERVICE_RECORD', 'REVIEW_VEHICLE_DOCUMENT', 'REVIEW_COMPLIANCE',
  'RECORD_FUEL_EXPENSE', 'REVIEW_FINANCE', 'REVIEW_PAYMENT'
);
CREATE TYPE "inbox_suggestion_status" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

CREATE TABLE "inbox_suggestions" (
    "id"                 UUID NOT NULL,
    "company_id"         UUID NOT NULL,
    "message_id"         UUID NOT NULL,
    "ai_result_id"       UUID NOT NULL,
    "type"               "inbox_suggestion_type" NOT NULL,
    "status"             "inbox_suggestion_status" NOT NULL DEFAULT 'PENDING',
    "reason"             TEXT,
    "details"            JSONB,
    "attachment_id"      UUID,
    "decided_at"         TIMESTAMPTZ(3),
    "decided_by_id"      UUID,
    "decision_note"      TEXT,
    "result_entity_type" TEXT,
    "result_entity_id"   UUID,
    "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inbox_suggestions_pkey" PRIMARY KEY ("id")
);

-- A decision names its author; an undecided suggestion has none.
ALTER TABLE "inbox_suggestions"
  ADD CONSTRAINT "inbox_suggestions_decision_complete"
    CHECK (("status" IN ('PENDING', 'SUPERSEDED')) = ("decided_at" IS NULL)),
  ADD CONSTRAINT "inbox_suggestions_decider_complete"
    CHECK (("decided_at" IS NULL) = ("decided_by_id" IS NULL));

CREATE INDEX "inbox_suggestions_company_id_status_created_at_idx"
  ON "inbox_suggestions"("company_id", "status", "created_at" DESC);
CREATE INDEX "inbox_suggestions_message_id_idx" ON "inbox_suggestions"("message_id");

ALTER TABLE "inbox_suggestions"
  ADD CONSTRAINT "inbox_suggestions_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inbox_suggestions_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "inbox_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "inbox_suggestions_ai_result_id_fkey"
    FOREIGN KEY ("ai_result_id") REFERENCES "inbox_ai_results"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "inbox_suggestions_attachment_id_fkey"
    FOREIGN KEY ("attachment_id") REFERENCES "inbox_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
