-- Phase 6 — live fleet and location intelligence.
--
-- Three things happen here:
--   1. `driver_location_states` becomes a real current-location read model: the vehicle held at
--      the last fix, the device's own tracking state, and the stationary anchor the alert engine
--      measures against.
--   2. `driver_location_pings` becomes safely re-uploadable (idempotency key) and keeps the
--      vehicle that was assigned at the moment of capture, so reassigning a driver never
--      rewrites where their old fixes happened.
--   3. `fleet_location_alerts` records a stationary-driver alert as a durable fact.
--
-- Nothing existing is dropped or rewritten: every column added here is nullable or has a
-- default, so Phase 0–5 rows and the data behind them stay exactly as they are.

-- CreateEnum
CREATE TYPE "driver_tracking_state" AS ENUM (
  'LOCATION_PERMISSION_DENIED',
  'BACKGROUND_PERMISSION_MISSING',
  'LOCATION_SERVICES_DISABLED',
  'TRACKING_ACTIVE',
  'TRACKING_PAUSED',
  'TRACKING_UNAVAILABLE',
  'SYNC_PENDING',
  'LAST_LOCATION_STALE'
);

-- CreateEnum
CREATE TYPE "fleet_alert_type" AS ENUM ('STATIONARY');

-- CreateEnum
CREATE TYPE "fleet_alert_status" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED');

-- ───────────────────────── Current location ─────────────────────────

-- AlterTable
ALTER TABLE "driver_location_states"
  ADD COLUMN "vehicle_id"                UUID,
  ADD COLUMN "tracking_state"            "driver_tracking_state" NOT NULL DEFAULT 'TRACKING_UNAVAILABLE',
  ADD COLUMN "location_services_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pending_uploads"           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "altitude_meters"           DECIMAL(8,2),
  ADD COLUMN "received_at"               TIMESTAMPTZ(3),
  ADD COLUMN "stationary_anchor_lat"     DECIMAL(9,6),
  ADD COLUMN "stationary_anchor_lng"     DECIMAL(9,6),
  ADD COLUMN "stationary_since"          TIMESTAMPTZ(3),
  ADD COLUMN "stationary_alert_id"       UUID;

-- The position and battery ranges are already constrained by the initial migration
-- (driver_location_states_coordinates_range, _battery_range) and are not repeated here. What is
-- new is the stationary anchor: it needs the same range guard, and its two halves must be set
-- together, because half an anchor would silently disable movement detection for that driver.
ALTER TABLE "driver_location_states"
  ADD CONSTRAINT "driver_location_states_anchor_range"
    CHECK (("stationary_anchor_lat" IS NULL OR "stationary_anchor_lat" BETWEEN -90 AND 90)
       AND ("stationary_anchor_lng" IS NULL OR "stationary_anchor_lng" BETWEEN -180 AND 180)),
  ADD CONSTRAINT "driver_location_states_anchor_complete"
    CHECK (("stationary_anchor_lat" IS NULL) = ("stationary_anchor_lng" IS NULL)),
  -- An anchor without a start time could never reach the threshold, and a start time without an
  -- anchor could never be reset by movement. Neither half is useful alone.
  ADD CONSTRAINT "driver_location_states_stationary_complete"
    CHECK (("stationary_anchor_lat" IS NULL) = ("stationary_since" IS NULL)),
  -- An alert can only belong to a stationary period that exists.
  ADD CONSTRAINT "driver_location_states_alert_needs_period"
    CHECK ("stationary_alert_id" IS NULL OR "stationary_since" IS NOT NULL),
  ADD CONSTRAINT "driver_location_states_accuracy_non_negative" CHECK ("accuracy_meters" IS NULL OR "accuracy_meters" >= 0),
  ADD CONSTRAINT "driver_location_states_pending_uploads_non_negative" CHECK ("pending_uploads" >= 0);

-- ───────────────────────── Location history ─────────────────────────

-- AlterTable
ALTER TABLE "driver_location_pings"
  ADD COLUMN "vehicle_id"      UUID,
  ADD COLUMN "altitude_meters" DECIMAL(8,2),
  ADD COLUMN "battery_pct"     INTEGER,
  ADD COLUMN "provider"        TEXT,
  ADD COLUMN "client_submission_id" TEXT;

-- The idempotency key is required going forward. Existing rows (if any) are back-filled from
-- their primary key, which is unique by construction, so the NOT NULL below can be applied
-- without losing history.
UPDATE "driver_location_pings" SET "client_submission_id" = 'legacy-' || "id"::TEXT WHERE "client_submission_id" IS NULL;
ALTER TABLE "driver_location_pings" ALTER COLUMN "client_submission_id" SET NOT NULL;

-- Coordinates are already covered by driver_location_pings_coordinates_range from the initial
-- migration. These are the columns Phase 6 introduces to this table.
ALTER TABLE "driver_location_pings"
  ADD CONSTRAINT "driver_location_pings_accuracy_non_negative" CHECK ("accuracy_meters" IS NULL OR "accuracy_meters" >= 0),
  ADD CONSTRAINT "driver_location_pings_battery_range" CHECK ("battery_pct" IS NULL OR "battery_pct" BETWEEN 0 AND 100),
  ADD CONSTRAINT "driver_location_pings_submission_id_present" CHECK (length(btrim("client_submission_id")) > 0);

-- ───────────────────────── Stationary alerts ─────────────────────────

-- CreateTable
CREATE TABLE "fleet_location_alerts" (
    "id"                  UUID NOT NULL,
    "company_id"          UUID NOT NULL,
    "driver_id"           UUID NOT NULL,
    "vehicle_id"          UUID,
    "type"                "fleet_alert_type" NOT NULL DEFAULT 'STATIONARY',
    "status"              "fleet_alert_status" NOT NULL DEFAULT 'ACTIVE',
    "triggered_at"        TIMESTAMPTZ(3) NOT NULL,
    "stationary_since"    TIMESTAMPTZ(3) NOT NULL,
    "latitude"            DECIMAL(9,6) NOT NULL,
    "longitude"           DECIMAL(9,6) NOT NULL,
    "duration_minutes"    INTEGER NOT NULL,
    "radius_meters"       INTEGER NOT NULL,
    "acknowledged_at"     TIMESTAMPTZ(3),
    "acknowledged_by_id"  UUID,
    "acknowledge_note"    TEXT,
    "resolved_at"         TIMESTAMPTZ(3),
    "resolved_by_id"      UUID,
    "resolved_reason"     TEXT,
    "moved_at"            TIMESTAMPTZ(3),
    "created_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fleet_location_alerts_pkey" PRIMARY KEY ("id")
);

-- An alert describes a real interval at a real place, and an acknowledged or resolved alert
-- must say who did it and when — the database refuses a half-recorded acknowledgement.
ALTER TABLE "fleet_location_alerts"
  ADD CONSTRAINT "fleet_location_alerts_coordinates_range"
    CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "fleet_location_alerts_duration_positive" CHECK ("duration_minutes" > 0),
  ADD CONSTRAINT "fleet_location_alerts_radius_positive" CHECK ("radius_meters" > 0),
  ADD CONSTRAINT "fleet_location_alerts_interval_ordered" CHECK ("triggered_at" >= "stationary_since"),
  ADD CONSTRAINT "fleet_location_alerts_acknowledgement_complete" CHECK (("acknowledged_at" IS NULL) = ("acknowledged_by_id" IS NULL)),
  ADD CONSTRAINT "fleet_location_alerts_acknowledged_has_timestamp" CHECK ("status" <> 'ACKNOWLEDGED' OR "acknowledged_at" IS NOT NULL),
  ADD CONSTRAINT "fleet_location_alerts_resolved_has_timestamp" CHECK ("status" <> 'RESOLVED' OR "resolved_at" IS NOT NULL);

-- CreateIndex
CREATE INDEX "fleet_location_alerts_company_id_status_triggered_at_idx" ON "fleet_location_alerts"("company_id", "status", "triggered_at" DESC);
CREATE INDEX "fleet_location_alerts_driver_id_triggered_at_idx" ON "fleet_location_alerts"("driver_id", "triggered_at" DESC);
CREATE INDEX "fleet_location_alerts_company_id_type_status_idx" ON "fleet_location_alerts"("company_id", "type", "status");

-- AddForeignKey
ALTER TABLE "fleet_location_alerts" ADD CONSTRAINT "fleet_location_alerts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Composite key: an alert cannot point at a driver belonging to another company.
ALTER TABLE "fleet_location_alerts" ADD CONSTRAINT "fleet_location_alerts_company_id_driver_id_fkey" FOREIGN KEY ("company_id", "driver_id") REFERENCES "drivers"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The state row points at the alert raised for the period it is currently tracking. ON DELETE
-- SET NULL only matters if an alert were ever removed, which the application never does.
ALTER TABLE "driver_location_states" ADD CONSTRAINT "driver_location_states_stationary_alert_id_fkey" FOREIGN KEY ("stationary_alert_id") REFERENCES "fleet_location_alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────────────────── Indexes for the new read paths ─────────────────────────

-- CreateIndex
CREATE UNIQUE INDEX "driver_location_pings_company_id_client_submission_id_key" ON "driver_location_pings"("company_id", "client_submission_id");
CREATE INDEX "driver_location_pings_vehicle_id_recorded_at_idx" ON "driver_location_pings"("vehicle_id", "recorded_at" DESC);
CREATE INDEX "driver_location_states_company_id_last_heartbeat_at_idx" ON "driver_location_states"("company_id", "last_heartbeat_at" DESC);
CREATE INDEX "driver_location_states_company_id_vehicle_id_idx" ON "driver_location_states"("company_id", "vehicle_id");

-- `driver_location_pings` is append-only and written in near-perfect `recorded_at` order, which
-- is exactly the shape BRIN is for: a fraction of a B-tree's size, and it keeps the
-- date-range scans behind history and reports cheap as the table grows into the millions.
-- The existing B-tree on (company_id, recorded_at) still serves per-company lookups.
CREATE INDEX "driver_location_pings_recorded_at_brin_idx" ON "driver_location_pings" USING BRIN ("recorded_at") WITH (pages_per_range = 32);
