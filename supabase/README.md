# Supabase Setup — Aya POS

This directory contains the database schema and instructions for setting
up the Supabase backend for the Aya POS application.

## Files

- **`schema.sql`** — Complete PostgreSQL schema (19 tables, indexes,
  triggers, RLS, Realtime). Run once on a fresh Supabase project.

## How to apply the schema

### Step 1 — Open Supabase SQL Editor

1. Sign in at https://supabase.com/dashboard
2. Open your project (e.g. `aya-pos`)
3. In the left sidebar, click **SQL Editor**
4. Click **+ New query** at the top

### Step 2 — Paste and run

1. Open `schema.sql` in this folder
2. Copy the **entire** file content
3. Paste into the SQL Editor
4. Click **Run** (bottom-right corner, or `Ctrl+Enter`)
5. Wait ~3 seconds for the green ✓ "Success" message

### Step 3 — Verify

In the Supabase Dashboard:

- **Table Editor** — should list 19 tables:
  `categories`, `accounts`, `expense_categories`, `customers`,
  `suppliers`, `products`, `sequences`, `audit_log`, `day_closures`,
  `invoices`, `invoice_items`, `invoice_payments`, `expenses`,
  `topups`, `transfers`, `maintenance_jobs`, `inventory_counts`,
  `inventory_count_items`, `ledger_entries`

- **Database → Replication → `supabase_realtime`** — 14 tables
  enabled for live sync.

- **Authentication → Policies** — every table should have one policy
  named `anon_all`.

## Re-running

The script is **safe to re-run on a fresh project**. It drops all
existing tables first (`DROP TABLE IF EXISTS … CASCADE`), so any test
data is wiped and the schema is recreated cleanly.

⚠️ **If you have real production data, REMOVE the entire `STEP 1` block
(the DROP statements) before running — otherwise you lose all data.**

## What's next

After the schema is applied, the application code will be modified
(Phase 6.2) to use Supabase instead of the local SQLite-WASM database.
Until that code change, the schema sits ready and unused.
