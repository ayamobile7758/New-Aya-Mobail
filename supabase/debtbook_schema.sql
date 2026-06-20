-- =====================================================================
-- DEBT BOOK SCHEMA — Standalone Supabase PostgreSQL Tables
-- =====================================================================
-- This feature is 100% separate from all financial/accounting logic.
-- It does NOT touch day closures, ledger entries, accounts, or invoices.
-- =====================================================================

-- ---- debtbook_debtors ----
CREATE TABLE IF NOT EXISTS debtbook_debtors (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---- debtbook_items ----
CREATE TABLE IF NOT EXISTS debtbook_items (
  id         TEXT PRIMARY KEY,
  debtor_id  TEXT NOT NULL REFERENCES debtbook_debtors(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  amount     INTEGER NOT NULL, -- fils (integer)
  note       TEXT,
  created_at TEXT NOT NULL
);

-- ---- debtbook_payments ----
CREATE TABLE IF NOT EXISTS debtbook_payments (
  id         TEXT PRIMARY KEY,
  debtor_id  TEXT NOT NULL REFERENCES debtbook_debtors(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL, -- fils (integer)
  paid_at    TEXT NOT NULL,
  note       TEXT
);

-- =====================================================================
-- Indexes for performance
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_debtbook_items_debtor ON debtbook_items(debtor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_debtbook_payments_debtor ON debtbook_payments(debtor_id, paid_at);

-- =====================================================================
-- Row-Level Security (RLS) policies
-- =====================================================================
ALTER TABLE debtbook_debtors  ENABLE ROW LEVEL SECURITY;
ALTER TABLE debtbook_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE debtbook_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON debtbook_debtors  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON debtbook_items    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON debtbook_payments FOR ALL TO anon USING (true) WITH CHECK (true);
