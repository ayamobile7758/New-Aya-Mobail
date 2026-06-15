-- RUN THIS ONCE IN SUPABASE SQL EDITOR AFTER SCHEMA.SQL
-- This file defines helper functions for SQLite-to-Postgres compatibility and SQL execution.

-- SQLite-compatibility DATE() helper functions (Explicitly in public schema)
CREATE OR REPLACE FUNCTION public.date(t timestamp with time zone)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT t::date;
$$;

CREATE OR REPLACE FUNCTION public.date(t timestamp without time zone)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT t::date;
$$;

CREATE OR REPLACE FUNCTION public.date(t text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- Handle SQLite text timestamps gracefully
    WHEN t ~ '^\d{4}-\d{2}-\d{2}' THEN substr(t, 1, 10)::date
    ELSE NULL
  END;
$$;

-- exec_sql: Executes a raw SQL query with '?' positional placeholders
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
BEGIN
  IF query_text IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'rowCount', 0);
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

-- exec_batch: Executes an array of statements in a single dynamic batch
CREATE OR REPLACE FUNCTION public.exec_batch(statements jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  stmt jsonb;
  query_text text;
  params jsonb;
  parsed_query text;
  param_count int;
  i int;
  val jsonb;
  val_text text;
  inlined_val text;
  affected_rows int;
  total_affected_rows int := 0;
  segments text[];
  num_segments int;
BEGIN
  FOR stmt IN SELECT * FROM jsonb_array_elements(statements) LOOP
    query_text := stmt ->> 'sql';
    params := COALESCE(stmt -> 'params', '[]'::jsonb);
    parsed_query := '';
    
    IF query_text IS NOT NULL THEN
      segments := string_to_array(query_text, '?');
      num_segments := array_length(segments, 1);
      param_count := jsonb_array_length(params);
      
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

      EXECUTE parsed_query;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      total_affected_rows := total_affected_rows + affected_rows;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'rowCount', total_affected_rows);
END;
$$;

-- complete_sale: Performs an entire sale atomically inside a single transaction.
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
  v_net_amount int;
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
    v_net_amount := (payment ->> 'net_amount')::int;
    v_account_name := payment ->> 'account_name';

    IF v_amount <= 0 THEN
      CONTINUE;
    END IF;

    -- Insert payment record
    INSERT INTO invoice_payments (id, invoice_id, account_id, amount, fee_amount, updated_at, device_id)
    VALUES (v_payment_id, v_invoice_id, v_account_id, v_amount, v_fee_amount, v_updated_at, v_device_id);

    -- Update account balance
    UPDATE accounts 
    SET balance = balance + v_net_amount, updated_at = v_updated_at 
    WHERE id = v_account_id;

    -- Insert ledger entry
    INSERT INTO ledger_entries (id, entry_date, account_id, account_name, type, amount, ref_type, ref_id, description, created_at, updated_at, device_id)
    VALUES (
      payment ->> 'ledger_entry_id',
      v_invoice_date,
      v_account_id,
      v_account_name,
      'credit',
      v_net_amount,
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

-- Grant EXECUTE permission to anon, authenticated, and service_role
GRANT EXECUTE ON FUNCTION public.date(timestamp with time zone) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.date(timestamp without time zone) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.date(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exec_sql(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exec_batch(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_sale(jsonb) TO anon, authenticated, service_role;

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
