-- =============================================================================
-- BUNDLE 6 — SECURITY (OPTIONAL, DEPLOY SEPARATELY)
-- File 1 of 2: Make exec_sql READ-ONLY (rejects INSERT/UPDATE/DELETE/DROP/etc.)
-- HEAD: b6c491e
--
-- ⚠️ يجب نسخ هذا في محرر SQL في Supabase
--
-- PURPOSE:
--   The existing `exec_sql` function is `SECURITY DEFINER` and accepts any SQL
--   text. Combined with the public anon key (which ships in the client bundle),
--   anyone can execute `DROP TABLE invoices` or `UPDATE accounts SET balance=0`
--   by extracting the anon key from a tablet and calling the RPC.
--
--   This file modifies `exec_sql` to reject any mutation statement. Read-only
--   SELECT queries continue to work. Mutations must go through typed RPCs
--   (complete_sale is already typed; the remaining batchRun callers should be
--   migrated to typed RPCs in a follow-up — see BUNDLE6_README.md).
--
-- WHAT CHANGED:
--   - Added a regex check at the top of `exec_sql` that scans the lowercased
--     query for any of: insert, update, delete, drop, alter, truncate, grant,
--     revoke, create, vacuum, reindex. If found, raise an exception.
--   - Everything else is unchanged.
--
-- ⚠️ IMPORTANT — APPLICATION ORDER:
--   Apply this BEFORE file 02 (RLS policies). If you apply RLS first without
--   locking down exec_sql, the existing batchRun callers will break (RLS
--   blocks their UPDATEs) but exec_sql could still be used to bypass RLS.
--   Applying this file first means exec_sql can no longer mutate, then RLS
--   tightens what direct table access can do.
--
-- ⚠️ BREAKING CHANGE FOR THE APP:
--   After applying this, `dbClient.batchRun([...])` calls in the app will FAIL
--   because they currently route through `exec_batch` which uses `EXECUTE
--   parsed_query` for arbitrary statements. The app's batchRun callers are:
--     - sales.ts returnInvoice (UPDATE invoices, UPDATE products, INSERT ...)
--     - closures.ts closeDay, reopenDay
--     - inventory.ts createInventoryCount, createAccountReconciliation
--     - expenses.ts addExpense, deleteExpense, restoreExpense, updateExpense
--     - operations.ts createTopup, createTransfer
--     - maintenance.ts updateJobStatus (delivery branch)
--
--   Two options:
--     (A) RECOMMENDED: also lock down exec_batch the same way (mutation
--         statements rejected). Then migrate each batchRun caller to a typed
--         RPC. This is the secure end-state but requires significant app work.
--     (B) STOP-GAP: leave exec_batch as-is for now (it still allows mutations
--         via the anon key) but apply this file to lock down exec_sql. This
--         closes the SQL injection vector via direct exec_sql calls but NOT
--         via exec_batch. Apply only if you need to ship a partial fix quickly.
--
--   This file implements option (A) for exec_sql only. See BUNDLE6_README.md
--   for the migration plan to fully eliminate exec_batch mutations.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.exec_sql(query_text text, params jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  parsed_query text := '';
  param_count int := jsonb_array_length(COALESCE(params, '[]'::jsonb));
  i int;
  val jsonb;
  val_text text;
  inlined_val text;
  result_rows jsonb := '[]'::jsonb;
  affected_rows int := 0;
  r record;
  segments text[];
  num_segments int;
  lower_q text;
BEGIN
  IF query_text IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'rowCount', 0);
  END IF;

  -- A-2 SECURITY: reject any mutation statement. exec_sql is READ-ONLY.
  -- Mutations must go through typed RPCs (complete_sale, create_expense, etc.).
  lower_q := lower(query_text);
  IF lower_q ~ '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|vacuum|reindex)\M' THEN
    RAISE EXCEPTION 'exec_sql is read-only. Mutation statements (INSERT/UPDATE/DELETE/DDL) must use a typed RPC.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  segments := string_to_array(query_text, '?');
  num_segments := array_length(segments, 1);

  FOR i IN 1..num_segments LOOP
    parsed_query := parsed_query || segments[i];
    IF i < num_segments THEN
      IF (i - 1) < param_count THEN
        val := params -> (i - 1);
        val_text := jsonb_build_array(val)->>0;

        IF jsonb_typeof(val) = 'null' THEN
          inlined_val := 'NULL';
        ELSIF jsonb_typeof(val) = 'string' THEN
          inlined_val := quote_literal(val_text);
        ELSIF jsonb_typeof(val) = 'number' THEN
          inlined_val := val_text || '::numeric';
        ELSIF jsonb_typeof(val) = 'boolean' THEN
          IF val_text = 'true' THEN
            inlined_val := '1';
          ELSE
            inlined_val := '0';
          END IF;
        ELSE
          inlined_val := quote_literal(val::text) || '::jsonb';
        END IF;

        parsed_query := parsed_query || inlined_val;
      ELSE
        parsed_query := parsed_query || '?';
      END IF;
    END IF;
  END LOOP;

  -- Execute the query. If it contains SELECT or RETURNING, treat it as returning rows.
  IF lower(parsed_query) ~ '\mselect\M' OR lower(parsed_query) ~ '\mreturning\M' THEN
    FOR r IN EXECUTE parsed_query LOOP
      result_rows := result_rows || to_jsonb(r);
      affected_rows := affected_rows + 1;
    END LOOP;
  ELSE
    EXECUTE parsed_query;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('rows', result_rows, 'rowCount', affected_rows);
END;
$$;

-- Re-grant (CREATE OR REPLACE may reset grants in some Postgres versions)
GRANT EXECUTE ON FUNCTION public.exec_sql(text, jsonb) TO anon, authenticated, service_role;

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
