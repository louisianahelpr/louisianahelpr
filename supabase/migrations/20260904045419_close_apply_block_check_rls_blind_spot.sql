-- V-011 (lh-verifier, 2026-09-04): "Helpers can create applications"'s
-- WITH CHECK reads customer_id via a plain subquery —
--   NOT are_users_blocked(helper_id, (SELECT customer_id FROM jobs WHERE id = job_id))
-- — and that subquery runs under the INSERTING role's own RLS on `jobs`, not
-- the SECURITY DEFINER context are_users_blocked() itself runs in. A
-- prospective applicant has no `jobs` SELECT policy that grants them the row
-- (confirmed live: `pg_policies` on public.jobs has no policy admitting a
-- non-owner, non-assigned, non-offered-to helper — browse goes through the
-- separate open_jobs_browse view). So the subquery returns NULL,
-- are_users_blocked(helper_id, NULL) is false, and NOT false = true — the
-- block check passes unconditionally. Reproduced live: a blocked user's
-- application to the blocking poster's job was ACCEPTED, including on a job
-- backdated 3 days (ruling out Early Access as the cause).
--
-- Fix: read customer_id through a SECURITY DEFINER helper (the same pattern
-- is_party_to_job already uses for exactly this reason), so the lookup is not
-- subject to the applicant's own jobs-table RLS.

CREATE OR REPLACE FUNCTION public.get_job_customer_id(_job_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT customer_id FROM public.jobs WHERE id = _job_id;
$$;

-- Match is_party_to_job's own V-015 fix: revoke the default PUBLIC grant a
-- new function gets, don't just add authenticated on top of it.
REVOKE EXECUTE ON FUNCTION public.get_job_customer_id(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_job_customer_id(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_job_customer_id(uuid) TO authenticated;

DROP POLICY IF EXISTS "Helpers can create applications" ON public.applications;
CREATE POLICY "Helpers can create applications"
ON public.applications
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT auth.uid()) = helper_id
  AND status = 'pending'::application_status
  AND NOT are_users_blocked(helper_id, public.get_job_customer_id(job_id))
);
