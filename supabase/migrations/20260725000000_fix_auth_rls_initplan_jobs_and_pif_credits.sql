-- Performance advisor 2026-07-25: auth_rls_initplan fixes
--
-- Two RLS policies were flagged for calling auth functions without the
-- (SELECT ...) initplan wrapper, causing Postgres to re-evaluate the auth
-- call for every row scanned instead of once per query.
--
-- 1. public.jobs "Customers can create jobs" (INSERT) — bare auth.uid() calls
--    in the WITH CHECK. This is the server-side IDV + business-membership gate
--    (source: 20260710140000_jobs_insert_idv_gate.sql). All three auth.uid()
--    references are wrapped in (SELECT auth.uid()).
--
-- 2. public.pif_credits "PIF credits are party-only" (SELECT) — the email
--    branch uses current_setting('request.jwt.claims', true) to derive the
--    caller's email. That call does not receive the initplan optimisation;
--    replacing it with (SELECT auth.email()) aligns it with the established
--    pattern used in 20260705120000_perf_index_and_rls_initplan.sql (business
--    members policies). auth.email() is the canonical Supabase helper; it is
--    available in prod and in the CI Supabase Postgres image (unlike auth.jwt()
--    which 20260706120100 deliberately avoided).
--
-- Both statements are replay-safe: DROP POLICY IF EXISTS + CREATE POLICY is
-- idempotent; re-running produces identical policies.

-- ============================================================
-- 1. jobs "Customers can create jobs" — wrap bare auth.uid()
-- ============================================================

DROP POLICY IF EXISTS "Customers can create jobs" ON public.jobs;

CREATE POLICY "Customers can create jobs"
  ON public.jobs FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = customer_id
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.idv_status = 'verified'
    )
    AND (
      business_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.businesses b
        JOIN public.business_members bm ON bm.business_id = b.id
        WHERE b.id = jobs.business_id
          AND bm.user_id = (SELECT auth.uid())
          AND bm.status = 'active'
          AND b.verification_status = 'verified'
      )
    )
  );

-- ============================================================
-- 2. pif_credits "PIF credits are party-only" — use auth.email()
-- ============================================================

DROP POLICY IF EXISTS "PIF credits are party-only" ON public.pif_credits;

CREATE POLICY "PIF credits are party-only" ON public.pif_credits
  FOR SELECT USING (
    (SELECT auth.uid()) = donor_id
    OR (SELECT auth.uid()) = recipient_id
    OR (
      recipient_email IS NOT NULL
      AND lower(recipient_email) = lower((SELECT auth.email()))
    )
  );
