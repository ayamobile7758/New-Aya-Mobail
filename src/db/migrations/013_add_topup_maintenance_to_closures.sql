-- Phase 1 migration: extend day_closures with topup/maintenance and fix net_profit formula

ALTER TABLE day_closures ADD COLUMN topup_profit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE day_closures ADD COLUMN maintenance_revenue INTEGER NOT NULL DEFAULT 0;

-- Backfill existing closures with correct values
UPDATE day_closures SET
  topup_profit = COALESCE((
    SELECT SUM(profit) FROM topups WHERE topup_date = day_closures.closure_date
  ), 0),
  maintenance_revenue = COALESCE((
    SELECT SUM(final_amount) FROM maintenance_jobs
    WHERE status = 'delivered' AND substr(delivered_at, 1, 10) = day_closures.closure_date
  ), 0),
  net_profit = sales_total - cogs_total
             + COALESCE((SELECT SUM(profit) FROM topups WHERE topup_date = day_closures.closure_date), 0)
             + COALESCE((SELECT SUM(final_amount) FROM maintenance_jobs
                         WHERE status = 'delivered' AND substr(delivered_at, 1, 10) = day_closures.closure_date), 0)
             - expenses_total
WHERE closure_date IS NOT NULL;
