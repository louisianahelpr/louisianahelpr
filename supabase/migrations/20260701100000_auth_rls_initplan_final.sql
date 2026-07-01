-- perf: fix last remaining auth_rls_initplan finding on verification_exceptions.
--
-- The "Admins manage exceptions" policy uses bare auth.role() in its USING
-- clause. Unlike auth.uid(), the prior batch DO block (20260623060000) only
-- matched auth.uid() via regex, so this one slipped through.
--
-- Wrapping with (SELECT auth.role()) makes Postgres evaluate the call once per
-- query (init-plan caching) instead of once per scanned row — O(1) vs O(n).
--
-- Replay-safe: the DO block reads live policy text before altering; no-ops if
-- the policy no longer exists, the table is gone, or it is already fixed.

DO $$
DECLARE
  r record;
BEGIN
  SELECT qual, with_check INTO r
  FROM   pg_policies
  WHERE  schemaname = 'public'
    AND  tablename  = 'verification_exceptions'
    AND  policyname = 'Admins manage exceptions';

  IF NOT FOUND THEN RETURN; END IF;

  IF r.qual ~ 'auth\.role\(\)' AND r.qual !~ '\( *SELECT auth\.role\(\)' THEN
    EXECUTE format(
      'ALTER POLICY %I ON public.verification_exceptions USING (%s)',
      'Admins manage exceptions',
      regexp_replace(r.qual, 'auth\.role\(\)', '(SELECT auth.role())', 'g')
    );
    RAISE NOTICE 'auth_rls_initplan fix: verification_exceptions."Admins manage exceptions"';
  END IF;
END;
$$;
