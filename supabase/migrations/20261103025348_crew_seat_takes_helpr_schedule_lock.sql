-- Q1919 (lh-authz-rls review of the Q1676 fix, finding lh-authz-rls@78c205c37#1):
-- a crew seat accepted at the same moment as a schedule-change accept for the
-- same Helpr could double-book them with nobody told.
--
-- respond_job_schedule_change re-checks the Helpr's bookings under
-- pg_advisory_xact_lock(hashtext('helpr_schedule:' || helper)). The only
-- writer of crew seats, accept_group_application (a seat is born 'accepted',
-- the column default), took no such lock. Under READ COMMITTED neither saw the
-- other's uncommitted row: the schedule change found no clash and moved the
-- job, and the seat's AFTER INSERT clash notice (notify_helpr_of_booking_clash)
-- found the old time. Both committed, the Helpr was booked twice, no notice.
--
-- Fix: accept_group_application takes the same advisory lock, right after it
-- reads the application and before it locks the job row. The two now take
-- turns; the second one's statements run on a fresh snapshot and see the
-- first's commit: a schedule change second is declined as a clash (Q1262), a
-- seat second gets its "booked for two jobs" notice. Lock order: the lock is
-- taken before any row lock here, and respond_job_schedule_change takes it
-- (after its own job row) only for a job with a lead, which a crew job never
-- is, so no wait cycle can form between the two.
--
-- Restated VERBATIM from live prod (pg_get_functiondef 2026-11-02, md5(prosrc)
-- 375f9abf4f6de07596341dbd8fbfc2b1 = 20261007073145's body); the only change
-- is the PERFORM and its comment. Grants unchanged.

CREATE OR REPLACE FUNCTION public.accept_group_application(p_application_id uuid, p_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone, p_offer_message text DEFAULT NULL::text)
 RETURNS TABLE(slots_filled integer, slots_total integer, roster_complete boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff        timestamptz;
  v_crew_deadline      timestamptz;
  v_date_needed   date;
  v_start_time    time without time zone;
  v_job_id        uuid;
  v_helper_id     uuid;
  v_app_status    text;
  v_job_status    text;
  v_job_customer  uuid;
  v_is_group      boolean;
  v_needed        int;
  v_current       int;
  v_budget        numeric;
  v_slot          int;
BEGIN
  SELECT a.job_id, a.helper_id, a.status
    INTO v_job_id, v_helper_id, v_app_status
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Q1919: the per-Helpr schedule lock respond_job_schedule_change takes, so a
  -- crew seat and a schedule change for the same Helpr take turns: whichever
  -- runs second sees the other's committed booking (the schedule change then
  -- declines as a clash; this seat's clash notice then fires). Taken BEFORE
  -- the job row below, never after: respond_job_schedule_change takes it only
  -- for a job with a lead (jobs.helper_id), which a crew job never has
  -- (trg_group_job_has_no_lead), so it never holds this crew job's row while
  -- waiting for it, and no row is held here while waiting.
  PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' || v_helper_id::text));

  -- Lock the job row — concurrent accepts serialize here, which is what makes
  -- the slot count below trustworthy.
  SELECT j.status, j.customer_id, j.is_group_job, j.helpers_needed, j.budget, j.date_needed, j.start_time
    INTO v_job_status, v_job_customer, v_is_group, v_needed, v_budget, v_date_needed, v_start_time
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- 20261005184940: the answer-by never runs past the job's start, so a hire
  -- too close to it would hand the member a window already gone (and a strike
  -- at the next sweep). Refused like accept_application, before any write.
  v_cutoff := public.job_offer_cutoff(v_date_needed, v_start_time);
  IF v_cutoff IS NOT NULL AND v_cutoff <= now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'job_starts_too_soon';
  END IF;

  IF v_job_customer IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Q345: no hire across a block, in either direction (see accept_application;
  -- are_users_blocked is symmetric, so the argument order does not matter).
  IF public.are_users_blocked(v_job_customer, v_helper_id) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;

  IF v_is_group IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not_a_group_job';
  END IF;

  -- Defensive: a group job with missing or invalid capacity would let the
  -- roster grow without bound.
  IF v_needed IS NULL OR v_needed < 1 THEN
    RAISE EXCEPTION 'invalid_helpers_needed';
  END IF;

  -- Q1378 (owner 2026-10-05): a booked crew a member left carries on with a
  -- free spot, and the poster may refill it before the start
  -- (job_starts_too_soon above refuses a hire inside 15 minutes of it). The
  -- capacity guard below refuses a booked crew that is full.
  IF v_job_status IS NULL OR v_job_status NOT IN ('open', 'accepted') THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_app_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;

  SELECT COUNT(*) INTO v_current
  FROM public.group_job_helpers g
  WHERE g.job_id = v_job_id;
  -- Q1390: a spot closed by a block with a fee is taken (never refilled).
  v_current := v_current + (SELECT count(*)::int FROM public.crew_block_fees b WHERE b.job_id = v_job_id);

  -- Capacity guard. Under contention the loser lands here rather than
  -- overfilling the roster.
  IF v_current >= v_needed THEN
    RAISE EXCEPTION 'roster_full';
  END IF;

  UPDATE public.applications
     SET status = 'accepted',
         offer_message = COALESCE(p_offer_message, offer_message)
   WHERE id = p_application_id;

  -- The lowest free slot, and its frozen share of the budget in cents
  -- (largest remainder; see crew_slot_share_cents). A slot a departed member
  -- left is reused, so the N shares always add up to the budget.
  SELECT min(s) INTO v_slot
    FROM generate_series(0, v_needed - 1) AS s
   WHERE NOT EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = v_job_id AND g.slot_no = s)
     -- Q1390: never the slot of a spot a block closed.
     AND NOT EXISTS (SELECT 1 FROM public.crew_block_fees b WHERE b.job_id = v_job_id AND b.slot_no = s);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'roster_full';
  END IF;

  -- UNIQUE (job_id, helper_id) turns a double-accept of the SAME helper into a
  -- 23505 rather than a silently duplicated slot. group_job_helpers_award_gate
  -- judges THIS member: award gate and, since 20260925154606, a funded job.
  INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents)
  VALUES (v_job_id, v_helper_id, v_slot,
          public.crew_slot_share_cents(round(COALESCE(v_budget, 0) * 100)::bigint, v_needed, v_slot));

  -- Q729 (owner 2026-10-05): the poster's reply deadline is kept for THIS
  -- member; expire_unanswered_offers reopens the spot once it passes unanswered.
  -- Clamped to the shortest deadline the app offers (1 hour, less 5 minutes
  -- of clock skew): a deadline in the past would get the member struck by the
  -- next sweep before they could answer (lh-authz-rls review #1, 2026-10-05).
  -- The answer-by never runs past the job's start (20261005184940), and a NULL
  -- (never expires) is bounded the same way, as accept_application now is.
  v_crew_deadline := LEAST(GREATEST(LEAST(COALESCE(p_deadline, now() + interval '48 hours'), now() + interval '48 hours'), now() + interval '55 minutes'), v_cutoff);
  UPDATE public.group_job_helpers
     SET response_deadline = v_crew_deadline
   WHERE job_id = v_job_id AND slot_no = v_slot;

  v_current := v_current + 1;

  -- A crew has no lead (Q407): jobs.helper_id stays NULL (trg_group_job_has_no_lead),
  -- and the job-level response_deadline, which timed ONE Helpr's reply, is not
  -- written. p_deadline stays in the signature for existing callers.
  UPDATE public.jobs
     SET
         -- Stay 'open' while partially staffed; only the final slot closes it.
         -- The cast is the fix for the one statement that never ran: a CASE of
         -- two bare literals resolves to text, and Postgres will not assign
         -- text to the job_status enum ("column "status" is of type job_status
         -- but expression is of type text"), so every call since 20260804122000
         -- raised here and rolled back (reproduced in PGlite, R0 in
         -- src/test/pglite/groupCrewNoLead.pglite.mjs).
         status = (CASE WHEN v_current >= v_needed THEN 'accepted' ELSE 'open' END)::job_status
   WHERE id = v_job_id
     -- A refill of a booked crew (Q1378) leaves it booked, full or not.
     AND v_job_status = 'open';

  slots_filled := v_current;
  slots_total := v_needed;
  roster_complete := v_current >= v_needed;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_group_application(uuid, timestamp with time zone, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_group_application(uuid, timestamp with time zone, text) TO authenticated, service_role;
