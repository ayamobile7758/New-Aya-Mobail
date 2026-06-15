-- =====================================================================
-- AYA POS — Complete Supabase PostgreSQL Schema
-- =====================================================================
-- Generated from SQLite migrations 001 → 012 (final state after Phase 4).
-- Run this script ONCE in Supabase SQL Editor on a FRESH project.
--
-- HOW TO USE:
--   1. Open https://supabase.com/dashboard → your project
--   2. Click "SQL Editor" in the left sidebar
--   3. Click "+ New query"
--   4. Paste the ENTIRE content of this file
--   5. Click "Run" (bottom-right)
--   6. Verify success: all green ✓ marks
-- =====================================================================


-- =====================================================================
-- STEP 1 — Clean slate (safe to re-run; wipes ALL data)
-- =====================================================================
-- ⚠️  If you have REAL data already, REMOVE this block before running.

DROP TABLE IF EXISTS ledger_entries        CASCADE;
DROP TABLE IF EXISTS inventory_count_items CASCADE;
DROP TABLE IF EXISTS inventory_counts      CASCADE;
DROP TABLE IF EXISTS maintenance_jobs      CASCADE;
DROP TABLE IF EXISTS transfers             CASCADE;
DROP TABLE IF EXISTS topups                CASCADE;
DROP TABLE IF EXISTS expenses              CASCADE;
DROP TABLE IF EXISTS expense_categories    CASCADE;
DROP TABLE IF EXISTS invoice_payments      CASCADE;
DROP TABLE IF EXISTS invoice_items         CASCADE;
DROP TABLE IF EXISTS invoices              CASCADE;
DROP TABLE IF EXISTS day_closures          CASCADE;
DROP TABLE IF EXISTS audit_log             CASCADE;
DROP TABLE IF EXISTS sequences             CASCADE;
DROP TABLE IF EXISTS products              CASCADE;
DROP TABLE IF EXISTS suppliers             CASCADE;
DROP TABLE IF EXISTS customers             CASCADE;
DROP TABLE IF EXISTS accounts              CASCADE;
DROP TABLE IF EXISTS categories            CASCADE;
DROP FUNCTION IF EXISTS trigger_set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS iso_now()                CASCADE;


-- =====================================================================
-- STEP 2 — Helper functions
-- =====================================================================

-- Returns the current UTC time as an ISO-8601 string (compatible with
-- JavaScript's Date.toISOString() format used by the app).
CREATE OR REPLACE FUNCTION iso_now() RETURNS TEXT AS $$
  SELECT to_char(
    timezone('UTC', now()),
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
$$ LANGUAGE SQL;

-- Trigger function: stamps updated_at on every UPDATE (ISO format).
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := iso_now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =====================================================================
-- STEP 3 — Tables (in dependency order)
-- =====================================================================

-- ---- categories ----
CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#CF694A',
  icon       TEXT DEFAULT 'Box',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT
);
CREATE INDEX idx_categories_deleted ON categories(deleted_at);


-- ---- accounts ----
CREATE TABLE accounts (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('cash','card','bank','wallet')),
  balance      INTEGER NOT NULL DEFAULT 0,   -- fils
  fee_percent  INTEGER NOT NULL DEFAULT 0,   -- per-mille (0.1% = 100)
  module_scope TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT,
  deleted_at   TEXT
);


-- ---- expense_categories ----
CREATE TABLE expense_categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('fixed','variable')),
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  deleted_at  TEXT
);


-- ---- customers (kept for FK compatibility; not actively used) ----
CREATE TABLE customers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);


-- ---- suppliers (kept for FK compatibility; not actively used) ----
CREATE TABLE suppliers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL
);


-- ---- products ----
CREATE TABLE products (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  sku          TEXT UNIQUE,
  category     TEXT NOT NULL,
  sale_price   INTEGER NOT NULL DEFAULT 0,    -- fils
  cost_price   INTEGER NOT NULL DEFAULT 0,    -- fils
  stock_qty    INTEGER NOT NULL DEFAULT 0,
  min_stock    INTEGER NOT NULL DEFAULT 0,
  track_stock  INTEGER NOT NULL DEFAULT 1,    -- boolean (0/1)
  is_quick_add INTEGER NOT NULL DEFAULT 0,    -- boolean (0/1)
  is_active    INTEGER NOT NULL DEFAULT 1,    -- boolean (0/1)
  notes        TEXT,
  image_path   TEXT,
  icon         TEXT DEFAULT 'Box',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX idx_products_active   ON products(is_active);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_deleted  ON products(deleted_at);


-- ---- sequences ----
CREATE TABLE sequences (
  name     TEXT PRIMARY KEY,
  last_val INTEGER NOT NULL DEFAULT 0
);


-- ---- audit_log ----
CREATE TABLE audit_log (
  id        TEXT PRIMARY KEY,
  ts        TEXT NOT NULL,
  action    TEXT NOT NULL,
  detail    TEXT,
  ref_type  TEXT,
  ref_id    TEXT,
  device_id TEXT
);
CREATE INDEX idx_audit_device ON audit_log(device_id);


-- ---- day_closures ----
CREATE TABLE day_closures (
  closure_date    TEXT PRIMARY KEY,           -- YYYY-MM-DD
  closed_at       TEXT NOT NULL,
  closed_by       TEXT,
  sales_total     INTEGER NOT NULL DEFAULT 0, -- fils
  cogs_total      INTEGER NOT NULL DEFAULT 0,
  discounts_total INTEGER NOT NULL DEFAULT 0,
  gifts_value     INTEGER NOT NULL DEFAULT 0,
  returns_total   INTEGER NOT NULL DEFAULT 0,
  expenses_total  INTEGER NOT NULL DEFAULT 0,
  net_profit      INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  device_id       TEXT
);
CREATE INDEX idx_day_closures_date ON day_closures(closure_date);


-- ---- invoices ----
CREATE TABLE invoices (
  id              TEXT PRIMARY KEY,
  invoice_number  TEXT NOT NULL UNIQUE,
  invoice_date    TEXT NOT NULL,              -- YYYY-MM-DD
  customer_id     TEXT REFERENCES customers(id),
  customer_name   TEXT,
  customer_phone  TEXT,
  subtotal        INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  total_amount    INTEGER NOT NULL DEFAULT 0,
  paid_amount     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','returned','partially_returned','cancelled')),
  pos_terminal    TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT,
  device_id       TEXT
);
CREATE INDEX idx_invoices_date     ON invoices(invoice_date);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_status   ON invoices(status);
CREATE INDEX idx_invoices_device   ON invoices(device_id);
CREATE INDEX idx_invoices_updated  ON invoices(updated_at);


-- ---- invoice_items ----
CREATE TABLE invoice_items (
  id               TEXT PRIMARY KEY,
  invoice_id       TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id       TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name     TEXT NOT NULL,
  quantity         INTEGER NOT NULL,
  unit_price       INTEGER NOT NULL,
  discount_amount  INTEGER NOT NULL DEFAULT 0,
  line_total       INTEGER NOT NULL,
  unit_cost        INTEGER NOT NULL DEFAULT 0,
  product_category TEXT,
  is_gift          INTEGER NOT NULL DEFAULT 0,
  device_id        TEXT,
  updated_at       TEXT
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_product ON invoice_items(product_id);


-- ---- invoice_payments ----
CREATE TABLE invoice_payments (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount     INTEGER NOT NULL,
  fee_amount INTEGER NOT NULL DEFAULT 0,
  device_id  TEXT,
  updated_at TEXT
);
CREATE INDEX idx_invoice_payments_inv ON invoice_payments(invoice_id);
CREATE INDEX idx_invoice_payments_acc ON invoice_payments(account_id);


-- ---- expenses ----
CREATE TABLE expenses (
  id             TEXT PRIMARY KEY,
  expense_number TEXT NOT NULL UNIQUE,
  expense_date   TEXT NOT NULL,
  account_id     TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  category_id    TEXT REFERENCES expense_categories(id) ON DELETE SET NULL,
  category_name  TEXT,
  account_name   TEXT,
  amount         INTEGER NOT NULL,
  description    TEXT NOT NULL,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT,
  device_id      TEXT,
  deleted_at     TEXT
);
CREATE INDEX idx_expenses_date   ON expenses(expense_date);
CREATE INDEX idx_expenses_device ON expenses(device_id);


-- ---- topups ----
CREATE TABLE topups (
  id            TEXT PRIMARY KEY,
  topup_number  TEXT NOT NULL UNIQUE,
  topup_date    TEXT NOT NULL,
  account_id    TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  account_name  TEXT,
  supplier_id   TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  amount        INTEGER NOT NULL,
  cost          INTEGER NOT NULL,
  profit        INTEGER NOT NULL,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT,
  device_id     TEXT
);


-- ---- transfers ----
CREATE TABLE transfers (
  id                TEXT PRIMARY KEY,
  transfer_number   TEXT NOT NULL UNIQUE,
  transfer_date     TEXT NOT NULL,
  from_account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  from_account_name TEXT,
  to_account_id     TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  to_account_name   TEXT,
  amount            INTEGER NOT NULL,
  notes             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT,
  device_id         TEXT
);


-- ---- maintenance_jobs ----
CREATE TABLE maintenance_jobs (
  id                 TEXT PRIMARY KEY,
  job_number         TEXT NOT NULL UNIQUE,
  job_date           TEXT NOT NULL,
  customer_name      TEXT NOT NULL,
  customer_phone     TEXT,
  device_type        TEXT NOT NULL,
  issue_description  TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','in_progress','ready','delivered','cancelled')),
  estimated_cost     INTEGER,
  final_amount       INTEGER,
  payment_account_id TEXT REFERENCES accounts(id),
  notes              TEXT,
  delivered_at       TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  device_id          TEXT,
  deleted_at         TEXT
);
CREATE INDEX idx_maintenance_status ON maintenance_jobs(status);


-- ---- inventory_counts ----
CREATE TABLE inventory_counts (
  id         TEXT PRIMARY KEY,
  count_date TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','completed')),
  notes      TEXT,
  created_at TEXT NOT NULL,
  device_id  TEXT
);


-- ---- inventory_count_items ----
CREATE TABLE inventory_count_items (
  id                 TEXT PRIMARY KEY,
  inventory_count_id TEXT NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  system_qty         INTEGER NOT NULL,
  actual_qty         INTEGER NOT NULL DEFAULT 0,
  reason             TEXT
);


-- ---- ledger_entries ----
CREATE TABLE ledger_entries (
  id           TEXT PRIMARY KEY,
  entry_date   TEXT NOT NULL,
  account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  account_name TEXT,
  type         TEXT NOT NULL CHECK (type IN ('debit','credit')),
  amount       INTEGER NOT NULL,
  ref_type     TEXT,
  ref_id       TEXT,
  description  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT,
  device_id    TEXT
);
CREATE INDEX idx_ledger_account ON ledger_entries(account_id);
CREATE INDEX idx_ledger_date    ON ledger_entries(entry_date);
CREATE INDEX idx_ledger_device  ON ledger_entries(device_id);


-- =====================================================================
-- STEP 4 — Triggers for auto-updating updated_at
-- =====================================================================

CREATE TRIGGER trg_categories_updated_at       BEFORE UPDATE ON categories       FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_accounts_updated_at         BEFORE UPDATE ON accounts         FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_products_updated_at         BEFORE UPDATE ON products         FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_invoices_updated_at         BEFORE UPDATE ON invoices         FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_invoice_items_updated_at    BEFORE UPDATE ON invoice_items    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_invoice_payments_updated_at BEFORE UPDATE ON invoice_payments FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_expenses_updated_at         BEFORE UPDATE ON expenses         FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_topups_updated_at           BEFORE UPDATE ON topups           FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_transfers_updated_at        BEFORE UPDATE ON transfers        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_maintenance_updated_at      BEFORE UPDATE ON maintenance_jobs FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_ledger_updated_at           BEFORE UPDATE ON ledger_entries   FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =====================================================================
-- STEP 5 — Initial seed data
-- =====================================================================

-- 6 default product categories
INSERT INTO categories (id, name, color, icon, sort_order, is_active, created_at) VALUES
  ('device',          'أجهزة',       '#2563EB', 'Smartphone', 1, 1, iso_now()),
  ('sim',             'شرائح',        '#7C3AED', 'Wifi',       2, 1, iso_now()),
  ('service_general', 'خدمات عامة',   '#0D9488', 'Wrench',     3, 1, iso_now()),
  ('service_repair',  'خدمات صيانة',  '#EA7317', 'Settings',   4, 1, iso_now()),
  ('accessory',       'إكسسوار',      '#D9A404', 'Package',    5, 1, iso_now()),
  ('package',         'باقات',        '#DB2777', 'Archive',    6, 1, iso_now());

-- Number-generation sequences
INSERT INTO sequences (name, last_val) VALUES
  ('invoice',     0),
  ('expense',     0),
  ('topup',       0),
  ('transfer',    0),
  ('maintenance', 0);


-- =====================================================================
-- STEP 6 — Row-Level Security (RLS)
-- =====================================================================
-- Trusted single-shop multi-device model: any client with the anon key
-- (i.e. any of the shop's tablets) can read/write all tables.
-- Local PIN authentication protects access at the device level.

ALTER TABLE categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequences             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_closures          ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE topups                ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_counts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries        ENABLE ROW LEVEL SECURITY;

-- Permissive policies — single shop trust model
CREATE POLICY "anon_all" ON categories            FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON accounts              FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON expense_categories    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON customers             FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON suppliers             FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON products              FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON sequences             FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON audit_log             FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON day_closures          FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON invoices              FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON invoice_items         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON invoice_payments      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON expenses              FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON topups                FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON transfers             FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON maintenance_jobs      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON inventory_counts      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON inventory_count_items FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON ledger_entries        FOR ALL TO anon USING (true) WITH CHECK (true);


-- =====================================================================
-- STEP 7 — Realtime publication
-- =====================================================================
-- Tables that need live sync between tablets (writes/changes broadcast).
-- Static admin tables (audit_log, categories, expense_categories,
-- customers, suppliers) are excluded to reduce bandwidth.

ALTER PUBLICATION supabase_realtime ADD TABLE invoices;
ALTER PUBLICATION supabase_realtime ADD TABLE invoice_items;
ALTER PUBLICATION supabase_realtime ADD TABLE invoice_payments;
ALTER PUBLICATION supabase_realtime ADD TABLE expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE topups;
ALTER PUBLICATION supabase_realtime ADD TABLE transfers;
ALTER PUBLICATION supabase_realtime ADD TABLE ledger_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE maintenance_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE day_closures;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory_counts;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory_count_items;
ALTER PUBLICATION supabase_realtime ADD TABLE sequences;


-- =====================================================================
-- DONE
-- =====================================================================
-- Verify in Supabase Dashboard → Table Editor: 19 tables should appear.
-- Verify Realtime: Database → Replication → supabase_realtime → 14 tables.
-- =====================================================================

-- Migration 013 Alter Table Additions
ALTER TABLE day_closures ADD COLUMN topup_profit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE day_closures ADD COLUMN maintenance_revenue INTEGER NOT NULL DEFAULT 0;


-- Migration 014 Central Auth Settings
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,           -- JSON string: {hash, salt} or {enabled, hash, salt}
  updated_at  TEXT,
  device_id   TEXT
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON app_settings FOR ALL TO anon USING (true) WITH CHECK (true);

