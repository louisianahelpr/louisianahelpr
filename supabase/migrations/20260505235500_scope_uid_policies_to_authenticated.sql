-- Scope every public-schema policy that uses auth.uid() down from
-- roles={public} to roles={authenticated}.
--
-- Why: a policy whose body is `auth.uid() = X` can never match anon
-- (auth.uid() is NULL for anon, so NULL = uuid is FALSE). But because
-- the policy is registered under `public`, Postgres still evaluates it
-- once per non-authenticated role, and Supabase's perf advisor reports
-- one `multiple_permissive_policies` row per (table, role, action). On
-- 61 such policies that's hundreds of redundant rows.
--
-- Restricting to {authenticated} eliminates the four spurious copies
-- per policy (anon, authenticator, dashboard_user, supabase_privileged_role)
-- and closes ~30 multiple_permissive_policies advisor entries with no
-- semantic change.
--
-- Excluded: `anyone_can_insert_analytics` (analytics_events) and
-- `anyone_can_insert_errors` (error_logs) — both intentionally allow
-- anon inserts via `(user_id IS NULL OR user_id = auth.uid())`.

DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND 'public' = ANY(roles)
      AND (
        qual LIKE '%auth.uid()%' OR qual LIKE '%SELECT auth.uid()%'
        OR with_check LIKE '%auth.uid()%' OR with_check LIKE '%SELECT auth.uid()%'
      )
      -- Keep these two anon-permitting INSERT policies as-is.
      AND NOT (tablename = 'analytics_events' AND policyname = 'anyone_can_insert_analytics')
      AND NOT (tablename = 'error_logs'       AND policyname = 'anyone_can_insert_errors')
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated',
                   p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;
