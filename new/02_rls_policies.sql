-- =============================================================================
-- BUNDLE 6 — SECURITY (OPTIONAL, DEPLOY SEPARATELY)
-- File 2 of 2: Tighten RLS policies (remove blanket anon_all)
-- HEAD: b6c491e
--
-- ⚠️ يجب نسخ هذا في محرر SQL في Supabase
--
-- PURPOSE:
--   The existing schema enables RLS on every table but immediately creates a
--   permissive policy: `POLICY "anon_all" ON <table> FOR ALL TO anon USING (true) WITH CHECK (true)`.
--   This effectively disables RLS — anon can SELECT, INSERT, UPDATE, DELETE
--   any row in any table.
--
--   This file replaces those blanket policies with stricter ones:
--     - SELECT: allowed for anon (the app reads data via PostgREST or exec_sql)
--     - INSERT: allowed for anon (the app inserts via direct PostgREST or typed RPCs)
--     - UPDATE: DENIED for anon directly. Updates must go through typed RPCs
--       (which are SECURITY DEFINER and bypass RLS).
--     - DELETE: DENIED for anon directly. Deletes must go through typed RPCs.
--
--   This means even if someone extracts the anon key, they can READ all data
--   but cannot MODIFY it directly via the PostgREST API. They would need to
--   call a typed RPC (which has server-side validation).
--
-- ⚠️ IMPORTANT — APPLICATION ORDER:
--   Apply AFTER file 01 (exec_sql read-only). Otherwise, an attacker could
--   still use exec_sql to bypass these RLS policies (exec_sql is SECURITY
--   DEFINER and bypasses RLS).
--
-- ⚠️ BREAKING CHANGE FOR THE APP:
--   The app currently calls `dbClient.run(...)` and `dbClient.batchRun(...)`
--   for many mutations. These route through `exec_sql` / `exec_batch` which
--   are SECURITY DEFINER (bypass RLS). So:
--     - Direct PostgREST UPDATE/DELETE will be blocked (good).
--     - RPC-based mutations will continue to work (good).
--   As long as the app uses supabase.rpc(...) for all mutations, this change
--   is safe. If the app uses supabase.from('table').update(...) directly
--   anywhere, those calls will start returning 403.
--
--   Test the full app flow after applying:
--     - Sale (complete_sale RPC) — should work
--     - Return (currently uses batchRun → exec_batch) — should work IF
--       exec_batch is still allowed to mutate. If you also lock down
--       exec_batch (recommended but bigger change), returns will break until
--       migrated to a typed RPC.
--     - Expense add/delete/restore (batchRun) — same as above
--     - Topup/Transfer (batchRun) — same
--     - Day closure (batchRun) — same
--     - Maintenance delivery (batchRun) — same
--     - Inventory count (batchRun) — same
--
--   See BUNDLE6_README.md for the full migration plan.
-- =============================================================================

-- Helper: drop the blanket anon_all policy on a table, then create granular ones.
-- SELECT and INSERT remain allowed for anon (read + create).
-- UPDATE and DELETE are denied for anon directly (must go through RPCs).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'products', 'categories', 'accounts', 'invoices', 'invoice_items',
    'invoice_payments', 'expense_categories', 'expenses', 'topups', 'transfers',
    'maintenance_jobs', 'inventory_counts', 'inventory_count_items',
    'ledger_entries', 'sequences', 'audit_log', 'day_closures', 'app_settings',
    'customers', 'suppliers'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Drop the blanket policy if it exists
    EXECUTE format('DROP POLICY IF EXISTS "anon_all" ON public.%I', t);

    -- SELECT: anon can read all rows
    EXECUTE format('CREATE POLICY "anon_select" ON public.%I FOR SELECT TO anon USING (true)', t);

    -- INSERT: anon can insert (with check true — server-side validation in RPCs)
    EXECUTE format('CREATE POLICY "anon_insert" ON public.%I FOR INSERT TO anon WITH CHECK (true)', t);

    -- No UPDATE policy → anon cannot UPDATE directly
    -- No DELETE policy → anon cannot DELETE directly
    -- RPCs (SECURITY DEFINER) bypass RLS, so create_expense etc. still work.
  END LOOP;
END $$;

-- Verify: list all policies on the invoice_payments table (should show only SELECT and INSERT for anon)
-- SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invoice_payments';
