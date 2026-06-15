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

-- Grant EXECUTE permission to anon, authenticated, and service_role
GRANT EXECUTE ON FUNCTION public.date(timestamp with time zone) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.date(timestamp without time zone) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.date(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exec_sql(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exec_batch(jsonb) TO anon, authenticated, service_role;

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
