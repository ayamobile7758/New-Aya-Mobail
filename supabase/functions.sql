-- RUN THIS ONCE IN SUPABASE SQL EDITOR AFTER SCHEMA.SQL
-- This file defines helper functions for SQLite-to-Postgres compatibility and SQL execution.

-- SQLite-compatibility DATE() helper functions
CREATE OR REPLACE FUNCTION date(t timestamp with time zone)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT t::date;
$$;

CREATE OR REPLACE FUNCTION date(t timestamp without time zone)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT t::date;
$$;

CREATE OR REPLACE FUNCTION date(t text)
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
CREATE OR REPLACE FUNCTION exec_sql(query_text text, params jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  parsed_query text := query_text;
  param_count int := jsonb_array_length(params);
  i int;
  val jsonb;
  val_text text;
  inlined_val text;
  pos int;
  result_rows jsonb := '[]'::jsonb;
  affected_rows int := 0;
  r record;
BEGIN
  -- Convert '?' placeholders to inlined parameters in order
  FOR i IN 0..(param_count - 1) LOOP
    val := params -> i;
    pos := strpos(parsed_query, '?');
    IF pos = 0 THEN
      EXIT;
    END IF;
    
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
    
    parsed_query := substr(parsed_query, 1, pos - 1) || inlined_val || substr(parsed_query, pos + 1);
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
CREATE OR REPLACE FUNCTION exec_batch(statements jsonb)
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
  pos int;
  affected_rows int;
  total_affected_rows int := 0;
BEGIN
  FOR stmt IN SELECT * FROM jsonb_array_elements(statements) LOOP
    query_text := stmt ->> 'sql';
    params := COALESCE(stmt -> 'params', '[]'::jsonb);
    parsed_query := query_text;
    param_count := jsonb_array_length(params);
    
    -- Inline parameters
    FOR i IN 0..(param_count - 1) LOOP
      val := params -> i;
      pos := strpos(parsed_query, '?');
      IF pos = 0 THEN
        EXIT;
      END IF;
      
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
      
      parsed_query := substr(parsed_query, 1, pos - 1) || inlined_val || substr(parsed_query, pos + 1);
    END LOOP;

    EXECUTE parsed_query;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    total_affected_rows := total_affected_rows + affected_rows;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'rowCount', total_affected_rows);
END;
$$;

-- Grant EXECUTE permission to anon, authenticated, and service_role
GRANT EXECUTE ON FUNCTION date(timestamp with time zone) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION date(timestamp without time zone) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION date(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION exec_sql(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION exec_batch(jsonb) TO anon, authenticated, service_role;
