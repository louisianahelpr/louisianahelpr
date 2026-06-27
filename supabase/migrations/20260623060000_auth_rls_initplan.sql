-- perf: wrap bare auth.uid() calls in RLS policies with (SELECT auth.uid())
-- so Postgres evaluates the auth function once per query (init-plan caching)
-- instead of once per scanned row. For a table with thousands of rows, this
-- turns O(n) auth-function evaluations into O(1) per query.
--
-- The pattern to fix: `auth.uid() = column` (re-evaluated per row)
-- The fix:           `(SELECT auth.uid()) = column` (evaluated once, cached)
--
-- Applies only to policies where qual/with_check contains literal auth.uid()
-- NOT already wrapped in (SELECT ...). Replay-safe: the DO block re-reads
-- live policy text on each run, so re-running after a partial failure or on
-- a from-scratch rebuild is safe — already-fixed policies are skipped.

DO $$
DECLARE
  r        record;
  new_qual text;
  new_wc   text;
  fix_qual boolean;
  fix_wc   boolean;
  stmt     text;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  (
             (qual       ~ 'auth\.uid\(\)' AND qual       !~ '\( *SELECT auth\.uid\(\)')
          OR (with_check ~ 'auth\.uid\(\)' AND with_check !~ '\( *SELECT auth\.uid\(\)')
           )
  LOOP
    fix_qual := r.qual IS NOT NULL
                AND r.qual       ~ 'auth\.uid\(\)'
                AND r.qual       !~ '\( *SELECT auth\.uid\(\)';
    fix_wc   := r.with_check IS NOT NULL
                AND r.with_check ~ 'auth\.uid\(\)'
                AND r.with_check !~ '\( *SELECT auth\.uid\(\)';

    new_qual := CASE WHEN fix_qual
                  THEN regexp_replace(r.qual,       'auth\.uid\(\)', '(SELECT auth.uid())', 'g')
                  ELSE r.qual END;
    new_wc   := CASE WHEN fix_wc
                  THEN regexp_replace(r.with_check, 'auth\.uid\(\)', '(SELECT auth.uid())', 'g')
                  ELSE r.with_check END;

    stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF fix_qual THEN
      stmt := stmt || format(' USING (%s)', new_qual);
    END IF;
    IF fix_wc THEN
      stmt := stmt || format(' WITH CHECK (%s)', new_wc);
    END IF;

    EXECUTE stmt;
    RAISE NOTICE 'auth_rls_initplan fix: %s.%s', r.tablename, r.policyname;
  END LOOP;
END;
$$;
