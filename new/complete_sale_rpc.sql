-- =============================================================================
-- BUNDLE 2 — Payment Fee Simplification (C-2)
-- HEAD: b6c491e
--
-- OWNER DECISION: DO NOT TRACK FEES AT ALL.
--   - The account is credited the FULL `amount` (not the net after fee).
--   - `fee_amount` is stored as 0 on the invoice_payments row (informational only).
--   - The ledger entry records the FULL amount.
--   - `fee_percent` on the accounts table remains in the schema but is ignored.
--
-- WHAT CHANGED FROM THE PREVIOUS VERSION:
--   - Line: `UPDATE accounts SET balance = balance + v_net_amount, ...`
--     → `UPDATE accounts SET balance = balance + v_amount, ...`           (credit GROSS)
--   - Line: `INSERT INTO ledger_entries ... 'credit', v_net_amount, ...`
--     → `INSERT INTO ledger_entries ... 'credit', v_amount, ...`           (ledger GROSS)
--   - The `v_net_amount` variable is still computed (for backward readability) but is
--     NO LONGER used in any UPDATE or INSERT. It is set equal to v_amount.
--   - The `fee_amount` column on the inserted invoice_payments row is forced to 0
--     (even if the client sent a non-zero value, which the TS layer no longer computes
--     after the matching change in sales.ts — see BUNDLE 2 notes file).
--
-- THREE-SURFACE CONSISTENCY:
--   - getReport "Sales by Account" already sums `ip.amount` (gross) → now matches balance.
--   - getProfitAndLoss does not subtract any fee term (none was ever in the formula).
--   - getOpenDayPreview does not subtract any fee term.
--   All three surfaces agree by construction after this change.
--
-- ⚠️ APPLICATION INSTRUCTIONS FOR THE ENGINEER:
--   1. Open Supabase Dashboard → SQL Editor.
--   2. Paste this ENTIRE file.
--   3. Click "Run".
--   4. The function is replaced atomically. No data migration needed — existing
--      invoice_payments rows keep their old `fee_amount` values (informational only;
--      no surface reads fee_amount for balance math).
-- =============================================================================

-- complete_sale: Performs an entire sale atomically inside a single transaction.
-- C-2: credits the GROSS amount to the payment account and ledgers the GROSS.
CREATE OR REPLACE FUNCTION public.complete_sale(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- Header fields
  v_invoice_id text;
  v_invoice_number text;
  v_invoice_date text;
  v_subtotal int;
  v_discount_amount int;
  v_total_amount int;
  v_paid_amount int;
  v_created_at text;
  v_updated_at text;
  v_device_id text;

  -- Line item fields
  item jsonb;
  v_item_id text;
  v_product_id text;
  v_product_name text;
  v_quantity int;
  v_unit_price int;
  v_unit_cost int;
  v_product_category text;
  v_item_discount_amount int;
  v_line_total int;
  v_is_gift int;
  v_track_stock int;
  v_affected_rows int;
  v_item_count int;

  -- Payment fields
  payment jsonb;
  v_payment_id text;
  v_account_id text;
  v_amount int;
  v_fee_amount int;
  v_net_amount int;       -- C-2: kept for readability, but set equal to v_amount
  v_account_name text;
  v_payment_count int;

  i int;
BEGIN
  -- Extract header fields
  v_invoice_id := payload ->> 'id';
  v_invoice_number := payload ->> 'invoice_number';
  v_invoice_date := payload ->> 'invoice_date';
  v_subtotal := (payload ->> 'subtotal')::int;
  v_discount_amount := (payload ->> 'discount_amount')::int;
  v_total_amount := (payload ->> 'total_amount')::int;
  v_paid_amount := (payload ->> 'paid_amount')::int;
  v_created_at := payload ->> 'created_at';
  v_updated_at := payload ->> 'updated_at';
  v_device_id := payload ->> 'device_id';

  -- Insert invoice row
  INSERT INTO invoices (id, invoice_number, invoice_date, customer_id, customer_name, customer_phone,
                        subtotal, discount_amount, total_amount, paid_amount, created_at, updated_at, device_id)
  VALUES (v_invoice_id, v_invoice_number, v_invoice_date, null, null, null,
          v_subtotal, v_discount_amount, v_total_amount, v_paid_amount, v_created_at, v_updated_at, v_device_id);

  -- Process line items
  v_item_count := jsonb_array_length(payload -> 'items');
  FOR i IN 0..(v_item_count - 1) LOOP
    item := (payload -> 'items') -> i;
    v_item_id := item ->> 'id';
    v_product_id := item ->> 'product_id';
    v_product_name := item ->> 'product_name';
    v_quantity := (item ->> 'quantity')::int;
    v_unit_price := (item ->> 'unit_price')::int;
    v_unit_cost := (item ->> 'unit_cost')::int;
    v_product_category := item ->> 'product_category';
    v_item_discount_amount := (item ->> 'discount_amount')::int;
    v_line_total := (item ->> 'line_total')::int;
    v_is_gift := (item ->> 'is_gift')::int;
    v_track_stock := (item ->> 'track_stock')::int;

    -- Insert line item
    INSERT INTO invoice_items (id, invoice_id, product_id, product_name, quantity,
                               unit_price, unit_cost, product_category, discount_amount, line_total, is_gift,
                               updated_at, device_id)
    VALUES (v_item_id, v_invoice_id, v_product_id, v_product_name, v_quantity,
            v_unit_price, v_unit_cost, v_product_category, v_item_discount_amount, v_line_total, v_is_gift,
            v_updated_at, v_device_id);

    -- Decrement stock if track_stock is enabled
    IF v_track_stock = 1 THEN
      UPDATE products
      SET stock_qty = stock_qty - v_quantity, updated_at = v_updated_at
      WHERE id = v_product_id AND track_stock = 1 AND stock_qty >= v_quantity;

      GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
      IF v_affected_rows = 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK:%', v_product_id;
      END IF;
    END IF;
  END LOOP;

  -- Process payments
  v_payment_count := jsonb_array_length(payload -> 'payments');
  FOR i IN 0..(v_payment_count - 1) LOOP
    payment := (payload -> 'payments') -> i;
    v_payment_id := payment ->> 'id';
    v_account_id := payment ->> 'account_id';
    v_amount := (payment ->> 'amount')::int;
    v_fee_amount := (payment ->> 'fee_amount')::int;
    v_account_name := payment ->> 'account_name';

    -- C-2 DECISION: DO NOT TRACK FEES.
    -- Force fee_amount to 0 on the stored row (informational only) and treat
    -- the net amount as equal to the gross amount. The account is credited the
    -- full amount, and the ledger records the full amount.
    v_fee_amount := 0;
    v_net_amount := v_amount;

    IF v_amount <= 0 THEN
      CONTINUE;
    END IF;

    -- Insert payment record — fee_amount forced to 0 (C-2)
    INSERT INTO invoice_payments (id, invoice_id, account_id, amount, fee_amount, updated_at, device_id)
    VALUES (v_payment_id, v_invoice_id, v_account_id, v_amount, 0, v_updated_at, v_device_id);

    -- C-2: Update account balance with the GROSS amount (was v_net_amount before)
    UPDATE accounts
    SET balance = balance + v_amount, updated_at = v_updated_at
    WHERE id = v_account_id;

    -- C-2: Insert ledger entry with the GROSS amount (was v_net_amount before)
    INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
    VALUES (
      payment ->> 'ledger_entry_id',
      v_invoice_date,
      v_account_id,
      v_account_name,
      'credit',
      v_amount,
      'invoice',
      v_invoice_id,
      'مبيعات فاتورة رقم ' || v_invoice_number,
      v_created_at,
      v_updated_at,
      v_device_id
    );
  END LOOP;

  RETURN jsonb_build_object('invoiceId', v_invoice_id, 'invoiceNumber', v_invoice_number);
END;
$$;

-- Re-grant (in case the CREATE OR REPLACE dropped grants — it shouldn't, but be safe)
GRANT EXECUTE ON FUNCTION public.complete_sale(jsonb) TO anon, authenticated, service_role;

-- Force PostgREST schema cache reload so the new function body is picked up
NOTIFY pgrst, 'reload schema';
