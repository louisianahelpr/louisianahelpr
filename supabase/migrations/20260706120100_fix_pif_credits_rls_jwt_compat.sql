-- ============================================================
-- Fix: pif_credits "PIF credits are party-only" policy uses
-- auth.jwt() which is absent in the CI Supabase Postgres image,
-- causing "Apply migrations + post-job trigger smoke" to fail.
--
-- Replace auth.jwt() ->> 'email' with the pure-Postgres
-- current_setting('request.jwt.claims', true) pattern — PostgREST
-- sets this GUC before every query in prod (same as auth.jwt()
-- internally). In environments where it's unset (CI bare Postgres,
-- direct psql) missing_ok returns NULL, which safely evaluates the
-- email clause to NULL and leaves the other OR branches in control.
--
-- Replay-safe: DROP POLICY IF EXISTS + CREATE POLICY is idempotent.
-- Runs after 20260705190000 which introduces the policy and after
-- 20260706120000 which is the advisor index migration.
-- ============================================================

DROP POLICY IF EXISTS "PIF credits are party-only" ON public.pif_credits;

CREATE POLICY "PIF credits are party-only" ON public.pif_credits
  FOR SELECT USING (
    (select auth.uid()) = donor_id
    OR (select auth.uid()) = recipient_id
    OR (
      recipient_email IS NOT NULL
      AND lower(recipient_email) = lower(
        coalesce(
          nullif(current_setting('request.jwt.claims', true), ''),
          'null'
        )::json ->> 'email'
      )
    )
  );
