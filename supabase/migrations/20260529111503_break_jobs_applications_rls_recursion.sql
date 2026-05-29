-- Break the infinite-recursion cycle between jobs and applications RLS
-- policies that bricks every query touching public.jobs with PG 42P17.
--
-- Symptom (2026-05-29, reproduced via direct REST query with a real
-- authenticated session):
--
--   SELECT id, title FROM open_jobs_browse LIMIT 1;
--   ERROR: 42P17 — infinite recursion detected in policy for relation "jobs"
--
-- This bricks Dashboard (BrowseTasksFeed), Activity Posts/Jobs tabs,
-- Messages thread hydration that joins via jobs, Profile stats — every
-- surface beyond the basic profile fetch.
--
-- The cycle, in two steps:
--
--   1. `public.jobs` SELECT policy "Applicants can view their pending
--      applied jobs" (added 2026-05-10 in migration 20260510032605):
--        USING (
--          status = 'open' AND EXISTS (
--            SELECT 1 FROM public.applications a
--            WHERE a.job_id = jobs.id AND a.helper_id = auth.uid()
--          )
--        )
--      → triggers RLS evaluation on `applications` rows.
--
--   2. `public.applications` SELECT policy "Job owners can view
--      applications for their jobs" (original 2026-03-11 schema):
--        USING (auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_id))
--      → triggers RLS evaluation on `jobs` rows.
--      → loops back to step 1.
--
-- Postgres detects the cycle and aborts every query on jobs. The
-- infinite-recursion was latent for weeks but masked by PR #355's
-- has_role grant regression — users bounced to /login before ever
-- reaching a surface that queries jobs. PR #355 + #358 + #364 fixed the
-- bouncer; the recursion underneath surfaces now.
--
-- Fix: wrap the cross-table subquery in a SECURITY DEFINER helper that
-- bypasses RLS during evaluation. Same pattern the codebase already uses
-- for `has_role()`, `is_business_member()`, `is_business_owner()`. The
-- fix lands on the jobs side (the newer policy) rather than the
-- applications side, because the applications policy is older and reused
-- across more surfaces, while the jobs-side policy was added recently
-- with the exact subquery shape that introduced the cycle.
--
-- Replay-safe: function CREATE OR REPLACE is always safe; the DROP +
-- recreate of the policy is guarded behind a check that the policy
-- actually exists. The new GRANT is guarded with to_regprocedure so
-- this stays idempotent on rebuilds.

-- ── 1. SECURITY DEFINER helper ─────────────────────────────────────
-- Encapsulates the applications subquery from the recursive policy so
-- RLS on applications doesn't re-trigger RLS on jobs during evaluation.
CREATE OR REPLACE FUNCTION public.user_has_pending_application(_job_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.applications
    WHERE job_id = _job_id
      AND helper_id = _user_id
  );
$$;

-- Explicit grant — defensive against the same Supabase-advisor strip
-- that has bitten has_role, is_business_member, mask_job_location, and
-- the 12 client RPCs landed today. authenticated only; this is the only
-- role that can be an applicant.
DO $$
BEGIN
  IF to_regprocedure('public.user_has_pending_application(uuid, uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.user_has_pending_application(uuid, uuid) TO authenticated;
  END IF;
END $$;

-- ── 2. Drop the recursive policy and recreate using the helper ─────
DROP POLICY IF EXISTS "Applicants can view their pending applied jobs" ON public.jobs;

CREATE POLICY "Applicants can view their pending applied jobs"
ON public.jobs
FOR SELECT
TO authenticated
USING (
  status = 'open'
  AND public.user_has_pending_application(id, (SELECT auth.uid()))
);
