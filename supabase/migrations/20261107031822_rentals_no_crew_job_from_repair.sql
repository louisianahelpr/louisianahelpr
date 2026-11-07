-- Q2081: a crew (group) job can no longer be linked to a tenant's repair request.
--
-- link_maintenance_request_job (newest 20261017220911) accepted any open job of the landlord's, group jobs
-- included, but rentals_propose_visit and rentals_visit_for_job authorise only the job's single confirmed Helpr
-- (jobs.helper_id), never the crew roster, so on a crew job nobody could offer the tenant a visit time. The lead's
-- 11-06 decision (OWNER-DECISIONS 6:25 PM): no crew job from a repair request, matching the Helpr Guarantee,
-- refunds and continue-another-day, which are single-Helpr too. Post a Job hides Group while ?maintenance= is set
-- and never sends is_group_job for one; this is the server's half.
--
-- Restated from 20261017220911 with one change: the job's FOR UPDATE read now also takes is_group_job (the
-- locked row's flag), and a group job returns false, like the other cannot-link answers. Grants restated by role name.
-- Replay-safe: CREATE OR REPLACE only. Applied 3x in PGlite by src/test/pglite/rentalsNoCrewRepairJob.pglite.mjs.

CREATE OR REPLACE FUNCTION public.link_maintenance_request_job(p_request_id uuid, p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_cur uuid;
  v_group boolean;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- FOR UPDATE: every link to one job serializes here, so two requests racing
  -- for the same job get true/false, never a raw unique violation (review #7).
  SELECT j.is_group_job INTO v_group FROM public.jobs j
   WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not your open job' USING ERRCODE = '42501';
  END IF;
  -- Q2081 (lead 11-06): never a crew (group) job. The visit-time offer, the Helpr
  -- Guarantee, refunds and continue-another-day all work with one confirmed Helpr,
  -- so a crew job linked here could never offer the tenant a visit time. Refused
  -- like the other "cannot link" cases (false): Post a Job tells the landlord the
  -- job is not linked, and its form never offers Group from a repair request.
  IF v_group IS TRUE THEN
    RETURN false;
  END IF;
  SELECT r.job_id INTO v_cur FROM public.maintenance_requests r
   WHERE r.id = p_request_id AND r.landlord_id = v_uid AND r.status = 'approved'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.maintenance_requests o WHERE o.job_id = p_job_id AND o.id <> p_request_id) THEN
    RETURN false;
  END IF;
  -- One live job per request: the request moves off its current job only
  -- once that job is settled (see the header); re-pointing a job that can
  -- still be paid lets the same repair be paid twice (lh-money-escrow reviews
  -- of 01f8eab54 #2, 64bc6343a #1 and bb5b8bc6e #2/#4).
  IF v_cur IS NOT NULL AND v_cur <> p_job_id AND EXISTS (
       SELECT 1 FROM public.jobs cur
        WHERE cur.id = v_cur
          AND NOT (COALESCE(cur.payment_status, 'unpaid') IN ('refunded', 'cancelled')
                   OR (cur.status = 'cancelled'
                       AND COALESCE(cur.payment_status, 'unpaid') IN ('unpaid', 'failed', 'abandoned')
                       AND (cur.stripe_session_id IS NULL OR cur.payment_status = 'abandoned')))
        FOR SHARE) THEN
    RETURN false;
  END IF;
  UPDATE public.maintenance_requests SET job_id = p_job_id, updated_at = now() WHERE id = p_request_id;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.link_maintenance_request_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_maintenance_request_job(uuid, uuid) TO authenticated, service_role;
