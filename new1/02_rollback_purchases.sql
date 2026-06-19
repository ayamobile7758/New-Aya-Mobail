-- =====================================================================
-- AYA POS — Purchases Module ROLLBACK
-- =====================================================================
-- Run this in Supabase SQL Editor ONLY if you need to undo the migration.
-- WARNING: this will DELETE all purchase records. Back up first.
-- =====================================================================

-- 1. Remove from Realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS purchases;

-- 2. Drop the trigger
DROP TRIGGER IF EXISTS trg_purchases_updated_at ON purchases;

-- 3. Drop RLS policy + disable RLS
DROP POLICY IF EXISTS "anon_all" ON purchases;
ALTER TABLE purchases DISABLE ROW LEVEL SECURITY;

-- 4. Drop indexes (CASCADE handles them, but explicit for clarity)
DROP INDEX IF EXISTS idx_purchases_date;
DROP INDEX IF EXISTS idx_purchases_product;
DROP INDEX IF EXISTS idx_purchases_device;
DROP INDEX IF EXISTS idx_purchases_deleted;

-- 5. Drop the table
DROP TABLE IF EXISTS purchases CASCADE;

-- 6. Remove the sequence row
DELETE FROM sequences WHERE name = 'purchase';

-- ─── DONE ────────────────────────────────────────────────────────────────
-- Note: products.cost_price and products.stock_qty values that were
-- recomputed by past purchases will REMAIN at their last-computed values.
-- Rolling back the table does NOT undo those product changes.
-- =====================================================================
