-- =====================================================================
-- AYA POS — Purchases Module Migration (Weighted-Average Cost)
-- =====================================================================
-- Run this ONCE in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Idempotent where possible (uses IF NOT EXISTS / IF EXISTS).
--
-- WHAT THIS DOES:
--   1. Creates the `purchases` table (one row per stock-buy event).
--   2. Adds an index on purchase_date for fast date-range queries.
--   3. Adds a `purchase` row to the `sequences` table for PRCS-NNNNN numbering.
--   4. Enables RLS + adds the permissive anon_all policy (matches every
--      other table in schema.sql).
--   5. Adds `purchases` to the supabase_realtime publication so all tablets
--      see new purchases live.
--   6. Registers a BEFORE UPDATE trigger for auto-stamping updated_at
--      (same pattern as trg_products_updated_at etc.).
--
-- COMPATIBILITY:
--   - Uses standard PostgreSQL DDL — no special characters that would
--     confuse exec_batch / exec_sql (those functions only parse '?'
--     placeholders, which this migration does NOT contain).
--   - RLS policy matches the existing trusted-single-shop model in
--     schema.sql lines 430-469.
--   - Realtime publication line matches schema.sql lines 479-492.
--
-- ROLLBACK: see 02_rollback_purchases.sql
-- =====================================================================

-- ─── 1. Table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchases (
  id              TEXT PRIMARY KEY,
  purchase_number TEXT NOT NULL UNIQUE,
  purchase_date   TEXT NOT NULL,                  -- YYYY-MM-DD (assertClockNotTampered)
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name    TEXT NOT NULL,                  -- snapshot at purchase time
  product_sku     TEXT,                           -- snapshot at purchase time (nullable)
  category        TEXT,                           -- snapshot at purchase time
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost       INTEGER NOT NULL CHECK (unit_cost >= 0),  -- fils (purchase price per unit)
  total_cost      INTEGER NOT NULL CHECK (total_cost >= 0), -- fils = quantity * unit_cost
  -- Weighted-average snapshot (for audit / traceability — NOT used by COGS):
  old_stock_qty   INTEGER NOT NULL,               -- products.stock_qty BEFORE this purchase
  old_cost_price  INTEGER NOT NULL,               -- products.cost_price BEFORE this purchase
  new_stock_qty   INTEGER NOT NULL,               -- products.stock_qty AFTER this purchase
  new_cost_price  INTEGER NOT NULL,               -- products.cost_price AFTER this purchase (the WAC)
  -- Optional cash-side (NULL when no account is debited — credit purchase):
  account_id      TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  account_name    TEXT,                           -- snapshot at purchase time
  supplier_id     TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name   TEXT,                           -- snapshot at purchase time
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT,
  device_id       TEXT,
  deleted_at      TEXT
);

-- ─── 2. Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_purchases_date     ON purchases(purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_product  ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_device   ON purchases(device_id);
CREATE INDEX IF NOT EXISTS idx_purchases_deleted  ON purchases(deleted_at);

-- ─── 3. Sequence seed (idempotent) ───────────────────────────────────────
INSERT INTO sequences (name, last_val)
VALUES ('purchase', 0)
ON CONFLICT (name) DO NOTHING;

-- ─── 4. RLS ──────────────────────────────────────────────────────────────
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- Permissive policy — matches the existing trusted-single-shop model
-- (see schema.sql lines 450-469). Drop+recreate so re-running is safe.
DROP POLICY IF EXISTS "anon_all" ON purchases;
CREATE POLICY "anon_all" ON purchases
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- ─── 5. Realtime publication ─────────────────────────────────────────────
-- Matches schema.sql lines 479-492. ALTER PUBLICATION ... ADD TABLE is
-- idempotent in Postgres 14+ (will error harmlessly if already a member
-- in older versions — wrap in DO block to swallow).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE purchases;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN OTHERS THEN NULL;
END $$;

-- ─── 6. updated_at trigger ───────────────────────────────────────────────
-- trigger_set_updated_at() is already defined in schema.sql step 2.
DROP TRIGGER IF EXISTS trg_purchases_updated_at ON purchases;
CREATE TRIGGER trg_purchases_updated_at
  BEFORE UPDATE ON purchases
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ─── DONE ────────────────────────────────────────────────────────────────
-- Verify in Supabase Dashboard → Table Editor: `purchases` table should appear.
-- Verify Realtime: Database → Replication → supabase_realtime → `purchases` listed.
-- Verify RLS: Table Editor → purchases → "RLS Enabled" badge.
-- =====================================================================
