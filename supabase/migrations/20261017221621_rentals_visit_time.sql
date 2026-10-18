-- RENTALS slice 3: the tenant OKs the visit time the Helpr offers (owner Q41,
-- docs/specs/landlord-hub-prep.md; "the tenant OKs the visit time the Helpr
-- offers").
--
-- S1 records the tenant's "when may someone come in" on the request and copies
-- it into the job's private access notes. This adds the step after hiring: the
-- booked Helpr proposes a time, the TENANT (who is not a job party) confirms
-- it, and the Helpr sees the confirmation.
--
--   rentals_propose_visit(p_job_id, p_at)      caller = the job's hired AND
--     confirmed Helpr (jobs.helper_id, helper_confirmed_at set); the job is linked to an APPROVED request, funded
--     (escrow) and accepted / in progress / revision requested; p_at is in the
--     future and within 90 days. A new proposal replaces the old one and
--     clears its confirmation. Tells the tenant (in-app).
--   rentals_confirm_visit(p_request_id, p_at)  caller = the request's tenant;
--     p_at must equal the time on file (a stale screen cannot confirm a time
--     the Helpr already changed) and still ahead, the proposal must be for
--     the request's CURRENT job, that job still live as above, and the
--     request's tenancy still active (a former tenant OKs nobody coming in).
--     Tells the Helpr.
--   rentals_visit_for_job(p_job_id)            the proposal for the job's
--     Helpr or poster only (they cannot read the request row: RLS lets only
--     the tenant and landlord read it).
-- The tenant and landlord read the new columns on the request row itself
-- (table SELECT grant + the "tenant or landlord" policy); the screen shows a
-- proposal only while visit_job_id = job_id.
--
-- The Helpr is not a Rentals member: no rentals_assert_member. Both writes are
-- behind require_feature('rentals'), so while the switch is testers-only the
-- Helpr must be a tester too. Banned callers write nothing. Under-18: the
-- tenant check is rentals_assert_member (Q59); a minor Helpr is refused by
-- trg_jobs_refuse_under_18 (refuse_under_18_member, BEFORE INSERT OR UPDATE OF
-- helper_id, helper_confirmed_at ON jobs, direct offers included), and
-- proposing needs helper_confirmed_at.
--
-- Lock order (as rentals_tenant_answer_fixed and link_maintenance_request_job):
-- the job first (FOR SHARE), then the request (FOR UPDATE), so none of them
-- deadlock; the request is re-read under its lock and must still point at the
-- job that was checked.
--
-- Data export: export_my_data writes to_jsonb(maintenance_requests), so the new
-- columns export with no restatement.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, constraint dropped and re-added,
-- CREATE OR REPLACE, grants restated by role name. Applied 3x in PGlite by
-- src/test/pglite/rentalsMaintenance.pglite.mjs.

ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS visit_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visit_proposed_for timestamptz,
  ADD COLUMN IF NOT EXISTS visit_proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS visit_confirmed_at timestamptz;
ALTER TABLE public.maintenance_requests DROP CONSTRAINT IF EXISTS maintenance_requests_visit_confirmed_needs_proposal;
ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_visit_confirmed_needs_proposal
  CHECK (visit_confirmed_at IS NULL OR visit_proposed_for IS NOT NULL);

CREATE OR REPLACE FUNCTION public.rentals_propose_visit(p_job_id uuid, p_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_req uuid;
  v_tenant uuid;
  v_last timestamptz;
  v_was_ok boolean;
  v_other_job boolean;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_at IS NULL OR p_at <= now() OR p_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'visit_time_invalid' USING ERRCODE = '22023';
  END IF;
  -- Hired AND confirmed: a Helpr who was only offered the job (helper_id set,
  -- helper_confirmed_at NULL: accept_application's offer) has not agreed to
  -- come, so may not offer a time to enter the tenant's home (lh-authz-rls #1).
  PERFORM 1 FROM public.jobs j
   WHERE j.id = p_job_id AND j.helper_id = v_uid AND j.helper_confirmed_at IS NOT NULL
     AND j.status::text IN ('accepted', 'in_progress', 'revision_requested')
     AND j.payment_status = 'escrow'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT r.id, r.tenant_id, r.visit_proposed_at, r.visit_confirmed_at IS NOT NULL, r.visit_job_id IS DISTINCT FROM p_job_id
    INTO v_req, v_tenant, v_last, v_was_ok, v_other_job FROM public.maintenance_requests r
   WHERE r.job_id = p_job_id AND r.status = 'approved'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.maintenance_requests
     SET visit_job_id = p_job_id, visit_proposed_for = p_at, visit_proposed_at = now(),
         visit_confirmed_at = NULL, updated_at = now()
   WHERE id = v_req;
  -- One notice per 10 minutes for un-OK'd re-offers on the same job: a Helpr
  -- changing the time again and again does not flood the tenant, who is not a
  -- party to the job (lh-authz-rls #4). A new offer that voids the tenant's OK,
  -- or follows an offer made for another job, is always told (re-review A2).
  IF v_last IS NULL OR v_was_ok OR v_other_job OR v_last < now() - interval '10 minutes' THEN
    PERFORM public.rentals_notify(v_tenant, 'A Helpr offered a visit time',
      'Open your repair request to OK the time.', '/rentals/requests/' || v_req::text, false);
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_propose_visit(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_propose_visit(uuid, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_confirm_visit(p_request_id uuid, p_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_job uuid;
  v_helper uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.rentals_assert_member();
  SELECT r.job_id INTO v_job FROM public.maintenance_requests r
   WHERE r.id = p_request_id AND r.tenant_id = v_uid AND r.status = 'approved';
  IF NOT FOUND OR v_job IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT j.helper_id INTO v_helper FROM public.jobs j
   WHERE j.id = v_job AND j.helper_confirmed_at IS NOT NULL
     AND j.status::text IN ('accepted', 'in_progress', 'revision_requested')
     AND j.payment_status = 'escrow'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.maintenance_requests r
   WHERE r.id = p_request_id AND r.tenant_id = v_uid AND r.status = 'approved' AND r.job_id = v_job
     AND r.visit_job_id = v_job AND r.visit_proposed_for IS NOT NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_visit_proposed' USING ERRCODE = 'P0002';
  END IF;
  -- Only someone who still lives there OKs someone coming in (lh-authz-rls #2):
  -- the request's own tenancy must still be active.
  IF NOT EXISTS (SELECT 1 FROM public.maintenance_requests r
                   JOIN public.rental_tenancies t ON t.id = r.tenancy_id
                  WHERE r.id = p_request_id AND t.tenant_id = v_uid AND t.status = 'active') THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Stale guard: the time on the tenant's screen must be the one on file.
  IF p_at IS NULL OR NOT EXISTS (SELECT 1 FROM public.maintenance_requests r
                                  WHERE r.id = p_request_id AND r.visit_proposed_for = p_at) THEN
    RAISE EXCEPTION 'visit_time_changed' USING ERRCODE = '22023';
  END IF;
  IF p_at <= now() THEN
    RAISE EXCEPTION 'visit_time_passed' USING ERRCODE = '22023';
  END IF;
  UPDATE public.maintenance_requests SET visit_confirmed_at = now(), updated_at = now() WHERE id = p_request_id;
  PERFORM public.rentals_notify(v_helper, 'The tenant OK''d your visit time',
    'The visit time you offered is confirmed.', '/posts?job=' || v_job::text, false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_confirm_visit(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_confirm_visit(uuid, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_visit_for_job(p_job_id uuid)
RETURNS TABLE (request_id uuid, proposed_for timestamptz, confirmed_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.id,
           CASE WHEN r.visit_job_id = p_job_id THEN r.visit_proposed_for END,
           CASE WHEN r.visit_job_id = p_job_id THEN r.visit_confirmed_at END
      FROM public.maintenance_requests r
      JOIN public.jobs j ON j.id = r.job_id
     WHERE r.job_id = p_job_id AND r.status = 'approved'
       AND ((j.helper_id = v_uid AND j.helper_confirmed_at IS NOT NULL) OR j.customer_id = v_uid);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_visit_for_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_visit_for_job(uuid) TO authenticated, service_role;
