-- Phase 8 — Reports & Management.
-- Additive indexes only: no table, column or row changes. They serve the date-range scans the
-- reports run (all-category expenses, per-driver expenses, payments created/paid in a period,
-- stationary stops in a period), so report queries stay indexed as history grows.

-- CreateIndex
CREATE INDEX "vehicle_expenses_company_id_expense_date_idx" ON "vehicle_expenses"("company_id", "expense_date" DESC);

-- CreateIndex
CREATE INDEX "vehicle_expenses_company_id_driver_id_expense_date_idx" ON "vehicle_expenses"("company_id", "driver_id", "expense_date" DESC);

-- CreateIndex
CREATE INDEX "payment_records_company_id_created_at_idx" ON "payment_records"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_records_company_id_paid_at_idx" ON "payment_records"("company_id", "paid_at");

-- CreateIndex
CREATE INDEX "fleet_location_alerts_company_id_triggered_at_idx" ON "fleet_location_alerts"("company_id", "triggered_at");
