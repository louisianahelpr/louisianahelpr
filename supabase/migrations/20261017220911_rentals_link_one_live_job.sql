-- RENTALS slice 3: a repair request is linked to at most ONE live job
-- ("two tabs can still pay twice for one repair request", lh-money-escrow
-- review of 64bc6343a #1; re-reviewed on bb5b8bc6e).
--
-- THE HOLE: link_maintenance_request_job (20261017205605) re-pointed a request
-- away from its current job unless that job was funded or had a Checkout
-- Session. Post a Job inserts the job, links it, then spends seconds on
-- photos, geocode and create-payment before a session is stamped. Tab A links
-- J1; tab B links J2 inside that window; the RPC answered true, both tabs went
-- on to pay, and J1 was silently unlinked: the same repair paid twice.
--
-- THE RULE NOW: the request moves off its current job only when nothing on
-- that job can still take or hold money ("settled"):
--   * the job row is gone, or
--   * payment_status is 'refunded' or 'cancelled' (create-payment never
--     re-mints either; redeem_gift_card refuses both), or
--   * the job is CANCELLED and was never funded: payment_status NULL /
--     unpaid / failed / abandoned, with no checkout session that could still
--     complete (a session id on unpaid / failed / NULL is treated as live;
--     'abandoned' is only set once Stripe says the session expired unpaid).
-- Everything else blocks, including an open job that is unpaid, failed or
-- abandoned (create-payment re-mints a checkout for all three, re-review #2),
-- 'chargeback' and 'cancelling' (both can return to escrow, re-review #4).
-- The same job again (a retry) is still true.
--
-- THE WAY OUT (re-review #1: a declined card left the landlord with a job she
-- could neither pay nor reach): rentals_cancel_request_job cancels the
-- request's current job while it is open and never funded with no checkout
-- running, through poster_cancel_job (the one cancel path: its triggers,
-- notices and strike ladder; no Helpr is hired on an unfunded job, so no fee
-- and no strike). Once cancelled, create-payment and redeem_gift_card refuse
-- the job (FUNDING_CLOSED_JOB_STATUSES, and stampSession's status guard
-- refuses a checkout minted just before), so it cannot be paid later, and the
-- landlord may post again.
--
-- rentals_request_job_state uses the same "settled" test for 'none', and says
-- 'unpaid' for an open, never-funded job with no checkout running (the screen
-- offers the cancel), 'paying' for a session that may still complete, and
-- 'refunding' for money on its way back or contested.
--
-- Locks: the link takes the new job FOR UPDATE, then the request FOR UPDATE,
-- then the current job FOR SHARE (unchanged order). rentals_cancel_request_job
-- takes the request FOR UPDATE, then the job FOR UPDATE: the opposite order,
-- but no cycle: a link waiting on the request holds only its NEW job, and the
-- functions that hold a job before the request (rentals_tenant_answer_fixed,
-- rentals_propose_visit) lock only jobs past 'open', which the cancel's
-- status = 'open' filter never locks.
-- Two concurrent links serialize on the request row; under READ COMMITTED the
-- second one's SELECT ... FOR UPDATE re-reads the committed job_id and is
-- refused.
--
-- Replay-safe: CREATE OR REPLACE of two functions created by 20261017205605
-- (an earlier version) and one new function, grants restated by role name.
-- Applied 3x in PGlite by src/test/pglite/rentalsMaintenance.pglite.mjs.

CREATE OR REPLACE FUNCTION public.link_maintenance_request_job(p_request_id uuid, p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_cur uuid;
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
  PERFORM 1 FROM public.jobs j
   WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not your open job' USING ERRCODE = '42501';
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

-- 'none' = nothing live (no job, or settled as in the link rule: post again),
-- 'refunding' = money on its way back or contested, 'booked' = funded,
-- 'paying' = a checkout session that may still complete, 'unpaid' = open and
-- never funded with no checkout running (the landlord cancels it to post again).
CREATE OR REPLACE FUNCTION public.rentals_request_job_state(p_request_id uuid)
RETURNS TABLE (job_id uuid, booking text, job_status text)
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
    SELECT r.job_id,
           CASE
             WHEN j.id IS NULL THEN 'none'
             WHEN COALESCE(j.payment_status, 'unpaid') IN ('refunded', 'cancelled')
               OR (j.status::text = 'cancelled'
                   AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'failed', 'abandoned')
                   AND (j.stripe_session_id IS NULL OR j.payment_status = 'abandoned')) THEN 'none'
             WHEN j.payment_status IN ('cancelling', 'chargeback') THEN 'refunding'
             WHEN j.payment_status IN ('escrow', 'payout_pending', 'released') AND j.status::text = 'cancelled' THEN 'refunding'
             WHEN j.payment_status IN ('escrow', 'payout_pending', 'released') THEN 'booked'
             WHEN j.stripe_session_id IS NOT NULL AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'failed') THEN 'paying'
             ELSE 'unpaid'
           END,
           j.status::text
      FROM public.maintenance_requests r
      LEFT JOIN public.jobs j ON j.id = r.job_id
     WHERE r.id = p_request_id AND (r.tenant_id = v_uid OR r.landlord_id = v_uid);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_request_job_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_request_job_state(uuid) TO authenticated, service_role;

-- The way out of an unpaid repair job (re-review #1): cancel the request's
-- current job while it is OPEN, never funded and has no checkout running,
-- through poster_cancel_job. Landlord of an approved request only. Re-checked
-- under the job's row lock, so a job funded in another tab a moment ago is
-- refused (job_not_cancellable), never cancelled from a stale screen.
CREATE OR REPLACE FUNCTION public.rentals_cancel_request_job(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT r.job_id INTO v_job FROM public.maintenance_requests r
   WHERE r.id = p_request_id AND r.landlord_id = v_uid AND r.status = 'approved'
   FOR UPDATE;
  IF NOT FOUND OR v_job IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.jobs j
   WHERE j.id = v_job AND j.customer_id = v_uid AND j.status = 'open'
     AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'failed', 'abandoned')
     AND (j.stripe_session_id IS NULL OR j.payment_status = 'abandoned')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_cancellable' USING ERRCODE = '22023';
  END IF;
  PERFORM public.poster_cancel_job(v_job, 'Rental repair: cancelled unpaid to post again');
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_cancel_request_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_cancel_request_job(uuid) TO authenticated, service_role;
