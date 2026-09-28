-- Phase 7 — service receipt AI and email intelligence.
--
-- Two workflows, and one rule that shapes both: AI proposes, people decide.
--
--   1. A service receipt gets durable processing jobs and versioned extraction results. The
--      extraction lives beside the maintenance record, never inside it — amount, date and vendor
--      on `vehicle_expenses` stay the authoritative figures, and only a verification writes them.
--   2. Inbound email is normalised into `inbox_messages`, keyed on the provider's own message id
--      so a repeated sync cannot duplicate anything, with attachments stored through the existing
--      file abstraction and AI classification kept as a reviewable suggestion.
--
-- Every column added to an existing table is nullable or defaulted, so Phase 0–6 rows are
-- untouched and remain valid exactly as they are.

-- CreateEnum
CREATE TYPE "service_receipt_ai_status" AS ENUM (
  'NOT_PROCESSED', 'PENDING', 'PROCESSING', 'COMPLETED', 'REVIEW_REQUIRED',
  'FAILED', 'RETRYING', 'CONFIRMED', 'REJECTED'
);

-- CreateEnum
CREATE TYPE "ai_failure_code" AS ENUM (
  'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'PROVIDER_BAD_RESPONSE', 'INVALID_AI_OUTPUT',
  'UNSUPPORTED_DOCUMENT', 'CONFIGURATION_ERROR', 'RATE_LIMITED', 'FILE_UNAVAILABLE',
  'PREPROCESSING_FAILED', 'UNKNOWN'
);

-- CreateEnum
CREATE TYPE "email_provider_name" AS ENUM ('IMAP_MAILBOX', 'GMAIL', 'MICROSOFT_GRAPH');

-- CreateEnum
CREATE TYPE "inbox_classification" AS ENUM (
  'DOCUMENT', 'SERVICE_INVOICE', 'PAYMENT_NOTIFICATION', 'SUPPLIER',
  'CUSTOMER_ENQUIRY', 'OPERATIONAL', 'SPAM', 'UNCLASSIFIED'
);

-- CreateEnum
CREATE TYPE "inbox_message_status" AS ENUM ('UNREAD', 'READ', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "inbox_ai_status" AS ENUM ('NOT_PROCESSED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- ───────────────────────── Maintenance record ─────────────────────────

-- AlterTable
-- The financial columns are deliberately NOT touched here. AI never writes them; verification does.
ALTER TABLE "vehicle_expenses"
  ADD COLUMN "ai_status"          "service_receipt_ai_status" NOT NULL DEFAULT 'NOT_PROCESSED',
  ADD COLUMN "accepted_result_id" UUID,
  ADD COLUMN "ai_verified_at"     TIMESTAMPTZ(3),
  ADD COLUMN "ai_verified_by_id"  UUID,
  ADD COLUMN "ai_rejected_at"     TIMESTAMPTZ(3),
  ADD COLUMN "ai_accepted_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A verification is a human act with an actor behind it: the database refuses half of one, and
-- refuses the CONFIRMED state without the timestamp that says when it happened.
ALTER TABLE "vehicle_expenses"
  ADD CONSTRAINT "vehicle_expenses_verification_complete"
    CHECK (("ai_verified_at" IS NULL) = ("ai_verified_by_id" IS NULL)),
  ADD CONSTRAINT "vehicle_expenses_confirmed_has_verification"
    CHECK ("ai_status" <> 'CONFIRMED' OR "ai_verified_at" IS NOT NULL),
  ADD CONSTRAINT "vehicle_expenses_rejected_has_timestamp"
    CHECK ("ai_status" <> 'REJECTED' OR "ai_rejected_at" IS NOT NULL);

-- CreateIndex
CREATE INDEX "vehicle_expenses_company_id_ai_status_created_at_idx"
  ON "vehicle_expenses"("company_id", "ai_status", "created_at" DESC);

-- ───────────────────────── Receipt AI jobs ─────────────────────────

-- CreateTable
CREATE TABLE "service_receipt_ai_jobs" (
    "id"                 UUID NOT NULL,
    "company_id"         UUID NOT NULL,
    "vehicle_expense_id" UUID NOT NULL,
    "receipt_file_id"    UUID NOT NULL,
    "status"             "service_receipt_ai_status" NOT NULL DEFAULT 'PENDING',
    "attempt"            INTEGER NOT NULL DEFAULT 1,
    "max_attempts"       INTEGER NOT NULL DEFAULT 3,
    "provider"           TEXT,
    "model"              TEXT,
    "claimed_at"         TIMESTAMPTZ(3),
    "claimed_by"         TEXT,
    "queued_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at"         TIMESTAMPTZ(3),
    "finished_at"        TIMESTAMPTZ(3),
    "next_attempt_at"    TIMESTAMPTZ(3),
    "failure_code"       "ai_failure_code",
    "failure_message"    TEXT,
    "requested_by_id"    UUID,
    "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_receipt_ai_jobs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "service_receipt_ai_jobs"
  ADD CONSTRAINT "service_receipt_ai_jobs_attempt_positive" CHECK ("attempt" >= 1),
  ADD CONSTRAINT "service_receipt_ai_jobs_max_attempts_positive" CHECK ("max_attempts" >= 1),
  -- A claim has a holder, or there is no claim. Half a claim would strand the job invisibly.
  ADD CONSTRAINT "service_receipt_ai_jobs_claim_complete" CHECK (("claimed_at" IS NULL) = ("claimed_by" IS NULL));

-- CreateIndex
-- The worker's claim query: the oldest job that is runnable now.
CREATE INDEX "service_receipt_ai_jobs_status_next_attempt_at_queued_at_idx"
  ON "service_receipt_ai_jobs"("status", "next_attempt_at", "queued_at");
CREATE INDEX "service_receipt_ai_jobs_company_id_status_queued_at_idx"
  ON "service_receipt_ai_jobs"("company_id", "status", "queued_at" DESC);
CREATE INDEX "service_receipt_ai_jobs_vehicle_expense_id_created_at_idx"
  ON "service_receipt_ai_jobs"("vehicle_expense_id", "created_at" DESC);

-- ───────────────────────── Receipt AI results ─────────────────────────

-- CreateTable
CREATE TABLE "service_receipt_ai_results" (
    "id"                 UUID NOT NULL,
    "company_id"         UUID NOT NULL,
    "vehicle_expense_id" UUID NOT NULL,
    "job_id"             UUID NOT NULL,
    "version"            INTEGER NOT NULL,
    "provider"           TEXT NOT NULL,
    "model"              TEXT NOT NULL,
    "extraction"         JSONB NOT NULL,
    "confidence"         DECIMAL(4,3),
    "warnings"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "validation_issues"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "preparation"        TEXT,
    "source_text_chars"  INTEGER,
    "duration_ms"        INTEGER,
    "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_receipt_ai_results_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "service_receipt_ai_results"
  ADD CONSTRAINT "service_receipt_ai_results_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "service_receipt_ai_results_confidence_range"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

-- CreateIndex
-- Versioning is enforced here, not in application code: two workers cannot both be version 2.
CREATE UNIQUE INDEX "service_receipt_ai_results_vehicle_expense_id_version_key"
  ON "service_receipt_ai_results"("vehicle_expense_id", "version");
CREATE INDEX "service_receipt_ai_results_company_id_created_at_idx"
  ON "service_receipt_ai_results"("company_id", "created_at" DESC);

-- ───────────────────────── Email sync cursors ─────────────────────────

-- CreateTable
CREATE TABLE "email_sync_cursors" (
    "id"                    UUID NOT NULL,
    "company_id"            UUID NOT NULL,
    "provider"              "email_provider_name" NOT NULL,
    "mailbox"               TEXT NOT NULL,
    "cursor"                TEXT,
    "last_sync_started_at"  TIMESTAMPTZ(3),
    "last_sync_finished_at" TIMESTAMPTZ(3),
    "last_error"            TEXT,
    "consecutive_failures"  INTEGER NOT NULL DEFAULT 0,
    "messages_synced"       INTEGER NOT NULL DEFAULT 0,
    "created_at"            TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_sync_cursors_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "email_sync_cursors"
  ADD CONSTRAINT "email_sync_cursors_failures_non_negative" CHECK ("consecutive_failures" >= 0),
  ADD CONSTRAINT "email_sync_cursors_messages_non_negative" CHECK ("messages_synced" >= 0);

-- CreateIndex
CREATE UNIQUE INDEX "email_sync_cursors_company_id_provider_mailbox_key"
  ON "email_sync_cursors"("company_id", "provider", "mailbox");

-- ───────────────────────── Inbox messages ─────────────────────────

-- CreateTable
CREATE TABLE "inbox_messages" (
    "id"                     UUID NOT NULL,
    "company_id"             UUID NOT NULL,
    "provider"               "email_provider_name" NOT NULL,
    "mailbox"                TEXT NOT NULL DEFAULT 'INBOX',
    "provider_message_id"    TEXT NOT NULL,
    "provider_thread_id"     TEXT,
    "rfc_message_id"         TEXT,
    "from_address"           TEXT NOT NULL,
    "from_name"              TEXT,
    "to_addresses"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "cc_addresses"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "subject"                TEXT,
    "received_at"            TIMESTAMPTZ(3) NOT NULL,
    "body_text"              TEXT,
    "has_html"               BOOLEAN NOT NULL DEFAULT false,
    "labels"                 TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status"                 "inbox_message_status" NOT NULL DEFAULT 'UNREAD',
    "classification"         "inbox_classification" NOT NULL DEFAULT 'UNCLASSIFIED',
    "classified_by_id"       UUID,
    "classified_at"          TIMESTAMPTZ(3),
    "ai_status"              "inbox_ai_status" NOT NULL DEFAULT 'NOT_PROCESSED',
    "ai_attempts"            INTEGER NOT NULL DEFAULT 0,
    "ai_failure_code"        "ai_failure_code",
    "ai_failure_message"     TEXT,
    "authentication_results" TEXT,
    "size_bytes"             INTEGER,
    "body_truncated"         BOOLEAN NOT NULL DEFAULT false,
    "created_at"             TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inbox_messages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "inbox_messages"
  ADD CONSTRAINT "inbox_messages_provider_message_id_present"
    CHECK (length(btrim("provider_message_id")) > 0),
  ADD CONSTRAINT "inbox_messages_ai_attempts_non_negative" CHECK ("ai_attempts" >= 0),
  -- A human classification records who made it and when; an AI one records neither.
  ADD CONSTRAINT "inbox_messages_classification_complete"
    CHECK (("classified_by_id" IS NULL) = ("classified_at" IS NULL));

-- CreateIndex
-- This is what makes synchronisation idempotent: re-reading an overlapping window finds the row.
CREATE UNIQUE INDEX "inbox_messages_company_id_provider_provider_message_id_key"
  ON "inbox_messages"("company_id", "provider", "provider_message_id");
CREATE INDEX "inbox_messages_company_id_received_at_idx" ON "inbox_messages"("company_id", "received_at" DESC);
CREATE INDEX "inbox_messages_company_id_status_received_at_idx" ON "inbox_messages"("company_id", "status", "received_at" DESC);
CREATE INDEX "inbox_messages_company_id_classification_received_at_idx"
  ON "inbox_messages"("company_id", "classification", "received_at" DESC);
CREATE INDEX "inbox_messages_company_id_ai_status_idx" ON "inbox_messages"("company_id", "ai_status");

-- ───────────────────────── Inbox attachments ─────────────────────────

-- CreateTable
CREATE TABLE "inbox_attachments" (
    "id"                     UUID NOT NULL,
    "company_id"             UUID NOT NULL,
    "message_id"             UUID NOT NULL,
    "provider_attachment_id" TEXT NOT NULL,
    "filename"               TEXT NOT NULL,
    "mime_type"              TEXT NOT NULL,
    "size_bytes"             INTEGER NOT NULL,
    "file_id"                UUID,
    "skip_reason"            TEXT,
    "created_at"             TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_attachments_pkey" PRIMARY KEY ("id")
);

-- An attachment was either kept or refused, and a refusal says why. Both at once, or neither,
-- would leave the office unable to tell a stored file from a silently dropped one.
ALTER TABLE "inbox_attachments"
  ADD CONSTRAINT "inbox_attachments_kept_or_explained"
    CHECK (("file_id" IS NULL) <> ("skip_reason" IS NULL)),
  ADD CONSTRAINT "inbox_attachments_size_non_negative" CHECK ("size_bytes" >= 0);

-- CreateIndex
CREATE UNIQUE INDEX "inbox_attachments_message_id_provider_attachment_id_key"
  ON "inbox_attachments"("message_id", "provider_attachment_id");
CREATE INDEX "inbox_attachments_company_id_created_at_idx" ON "inbox_attachments"("company_id", "created_at" DESC);

-- ───────────────────────── Inbox AI results ─────────────────────────

-- CreateTable
CREATE TABLE "inbox_ai_results" (
    "id"             UUID NOT NULL,
    "company_id"     UUID NOT NULL,
    "message_id"     UUID NOT NULL,
    "version"        INTEGER NOT NULL,
    "provider"       TEXT NOT NULL,
    "model"          TEXT NOT NULL,
    "classification" "inbox_classification" NOT NULL,
    "confidence"     DECIMAL(4,3),
    "summary"        TEXT,
    "extraction"     JSONB,
    "warnings"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "duration_ms"    INTEGER,
    "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_ai_results_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "inbox_ai_results"
  ADD CONSTRAINT "inbox_ai_results_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "inbox_ai_results_confidence_range"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

-- CreateIndex
CREATE UNIQUE INDEX "inbox_ai_results_message_id_version_key" ON "inbox_ai_results"("message_id", "version");
CREATE INDEX "inbox_ai_results_company_id_created_at_idx" ON "inbox_ai_results"("company_id", "created_at" DESC);

-- ───────────────────────── Foreign keys ─────────────────────────

ALTER TABLE "service_receipt_ai_jobs" ADD CONSTRAINT "service_receipt_ai_jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_receipt_ai_jobs" ADD CONSTRAINT "service_receipt_ai_jobs_vehicle_expense_id_fkey" FOREIGN KEY ("vehicle_expense_id") REFERENCES "vehicle_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_receipt_ai_jobs" ADD CONSTRAINT "service_receipt_ai_jobs_receipt_file_id_fkey" FOREIGN KEY ("receipt_file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_receipt_ai_results" ADD CONSTRAINT "service_receipt_ai_results_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_receipt_ai_results" ADD CONSTRAINT "service_receipt_ai_results_vehicle_expense_id_fkey" FOREIGN KEY ("vehicle_expense_id") REFERENCES "vehicle_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_receipt_ai_results" ADD CONSTRAINT "service_receipt_ai_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "service_receipt_ai_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The accepted extraction. SET NULL only matters if a result were ever removed, which nothing does.
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_accepted_result_id_fkey" FOREIGN KEY ("accepted_result_id") REFERENCES "service_receipt_ai_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "email_sync_cursors" ADD CONSTRAINT "email_sync_cursors_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inbox_attachments" ADD CONSTRAINT "inbox_attachments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Attachments belong to their message: removing a message removes its parts, and nothing else.
ALTER TABLE "inbox_attachments" ADD CONSTRAINT "inbox_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "inbox_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbox_attachments" ADD CONSTRAINT "inbox_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inbox_ai_results" ADD CONSTRAINT "inbox_ai_results_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inbox_ai_results" ADD CONSTRAINT "inbox_ai_results_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "inbox_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
