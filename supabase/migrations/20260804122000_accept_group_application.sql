-- Group jobs: slot-aware, race-safe acceptance.
--
-- THE GAP THIS CLOSES. A poster could create a job needing N helpers, but only
-- ONE could ever be accepted: accept_application requires jobs.status = 'open'
-- and then flips it to 'accepted', so the second and third accepts were
-- rejected with job_not_open. Nothing ever INSERTed into group_job_helpers
-- either — the roster table was only ever SELECTed and DELETEd — so the roster
-- was permanently empty. Verified against production 2026-08-04: 0 group jobs,
-- 0 roster rows, so no live data is affected.
--
-- THE MONEY MODEL (decided by the owner, and already what the payout code
-- implements): ONE escrow for the whole job, split across the roster at
-- completion. release-payout and process-scheduled-payouts both already pay
-- `budget / helpers_needed` per helper plus their 1/N share of the urgent fee,
-- so this migration only has to fill the roster correctly — it deliberately
-- introduces no second escrow and no per-slot charge.
--
-- CONCURRENCY. The whole point is that N concurrent accepts must not overfill
-- the roster. Callers serialize on the job's FOR UPDATE lock; each one re-counts
-- the roster INSIDE the lock, so the (N+1)th sees a full roster and is rejected.
-- `group_job_helpers` also carries UNIQUE (job_id, helper_id) in production,
-- which is the backstop against the same helper taking two slots.
--
-- STATUS TRANSITION. jobs.status stays 'open' until the FINAL slot is filled,
-- so the job keeps accepting applicants while it is partially staffed. Only the
-- accept that fills the last slot flips it to 'accepted'.
--
-- jobs.helper_id is set to the FIRST accepted helper and left alone thereafter.
-- Every existing payout/notification path reads that single column, so this
-- keeps them working; the roster is the authoritative list of who is staffed.
CREATE OR REPLACE FUNCTION public.accept_group_application(
  p_application_id uuid,
  p_deadline timestamptz DEFAULT NULL,
  p_offer_message text DEFAULT NULL
)
RETURNS TABLE (slots_filled int, slots_total int, roster_complete boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job_id        uuid;
  v_helper_id     uuid;
  v_app_status    text;
  v_job_status    text;
  v_job_customer  uuid;
  v_is_group      boolean;
  v_needed        int;
  v_current       int;
  v_existing_lead uuid;
BEGIN
  SELECT a.job_id, a.helper_id, a.status
    INTO v_job_id, v_helper_id, v_app_status
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Lock the job row — concurrent accepts serialize here, which is what makes
  -- the slot count below trustworthy.
  SELECT j.status, j.customer_id, j.is_group_job, j.helpers_needed, j.helper_id
    INTO v_job_status, v_job_customer, v_is_group, v_needed, v_existing_lead
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  IF v_job_customer IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_is_group IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not_a_group_job';
  END IF;

  -- Defensive: a group job with missing or invalid capacity would let the
  -- roster grow without bound.
  IF v_needed IS NULL OR v_needed < 1 THEN
    RAISE EXCEPTION 'invalid_helpers_needed';
  END IF;

  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_app_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;

  SELECT COUNT(*) INTO v_current
  FROM public.group_job_helpers g
  WHERE g.job_id = v_job_id;

  -- Capacity guard. Under contention the loser lands here rather than
  -- overfilling the roster.
  IF v_current >= v_needed THEN
    RAISE EXCEPTION 'roster_full';
  END IF;

  UPDATE public.applications
     SET status = 'accepted',
         offer_message = COALESCE(p_offer_message, offer_message)
   WHERE id = p_application_id;

  -- UNIQUE (job_id, helper_id) turns a double-accept of the SAME helper into a
  -- 23505 rather than a silently duplicated slot.
  INSERT INTO public.group_job_helpers (job_id, helper_id)
  VALUES (v_job_id, v_helper_id);

  v_current := v_current + 1;

  UPDATE public.jobs
     SET
         -- Keep the legacy single-helper column pointing at the first accepted
         -- helper so existing payout/notification paths keep resolving.
         helper_id = COALESCE(v_existing_lead, v_helper_id),
         -- Stay 'open' while partially staffed; only the final slot closes it.
         status = CASE WHEN v_current >= v_needed THEN 'accepted' ELSE 'open' END,
         response_deadline = COALESCE(p_deadline, response_deadline)
   WHERE id = v_job_id;

  slots_filled := v_current;
  slots_total := v_needed;
  roster_complete := v_current >= v_needed;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_group_application(uuid, timestamptz, text) TO authenticated;
