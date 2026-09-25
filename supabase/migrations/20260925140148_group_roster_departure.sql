-- A Helpr who leaves a group job's crew, or is removed from it, is off the job.
--
-- A crew is the roster in `group_job_helpers`; `jobs.helper_id` is the crew's
-- lead (the first hire, kept so the single-helper payout and notification
-- paths resolve). Three defects, each reproduced on prod inside a DO block
-- that rolled back (2026-09-25, on the one seed group job):
--
--   D1  The poster removes the lead from a crew that is still staffing. The
--       roster row goes, but `jobs.helper_id` still names the removed Helpr,
--       so they keep the address, the message thread and party status, and
--       their application stays `accepted` (My Jobs shows the job as theirs).
--   D2  A crew member other than the lead cannot leave at all
--       (`helper_cancel_booking` answers not_authorized), and the lead who
--       leaves keeps their roster row: still on the crew, still paid by the
--       roster payout fan-out, and the stale row fills a slot so the poster
--       cannot hire a replacement (`accept_group_application` -> roster_full).
--   D3  The crew tracker's Working step judges the JOB's before photo, which
--       members 2..N never write (their proof lives on their own roster row,
--       where the per-member completion gate reads it), so they cannot start.
--
-- What this installs:
--
--   1. sync_job_after_roster_departure, AFTER DELETE on group_job_helpers.
--      Whoever deletes the row (the poster while staffing, the Helpr through
--      helper_cancel_booking, account deletion), the departed Helpr's accepted
--      application becomes `rejected` (no notice: notify_on_application only
--      speaks on pending -> rejected), and if they were the lead:
--        - on a FUNDED job the lead moves to the earliest remaining member the
--          award gate would accept (helper_award_block_reason IS NULL);
--        - otherwise `jobs.helper_id` is cleared, and the next hire becomes the
--          lead (accept_group_application sets COALESCE(lead, new hire)).
--      An unfunded job never gets a lead re-pointed: that is an award
--      enforce_job_funded_before_award refuses, and refusing it would refuse
--      the removal itself.
--   2. helper_cancel_booking, restated from its live pg_get_functiondef
--      (md5 edc357c58aede8e6cd26d1424b4742eb, 2026-09-25) with a crew branch
--      ahead of the unchanged single-helper path: a crew member with a roster
--      slot, on an open or booked job, whose own part is not done and whose
--      start has not passed, takes the same reliability consequence, leaves
--      the roster (the trigger above does the rest), and a booked job whose
--      roster drops below helpers_needed reopens for hiring.
--   3. enforce_job_tracking_arrival_gate, restated from its live definition
--      (md5 92d5e1ad8ecb2bb3d2a57b1b7d2af7ad) with the crew Working step
--      reading the member's OWN roster before photo. The lead may also clear
--      it with the job-level photo, which is where the lead's photo is stored
--      on a job that has one helper_id. The single-helper branch is unchanged
--      and stays first (src/test/jobsGuardRpcParity.test.ts).
--
-- REPLAY-SAFETY: every object here is created by 20260311041556
-- (group_job_helpers), 20260919192559 (the roster lifecycle columns) and the
-- functions' own earlier migrations, all before this one. CREATE OR REPLACE
-- and DROP TRIGGER IF EXISTS make it idempotent; applied 3x in PGlite
-- (src/test/pglite/groupRosterDeparture.pglite.mjs --replay).

-- ── 1. THE ROSTER DEPARTURE TRIGGER ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_job_after_roster_departure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_job_helper   uuid;
  v_payment      text;
  v_next_lead    uuid;
BEGIN
  IF OLD.helper_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- The departed Helpr's hire is over. accepted -> rejected is silent
  -- (notify_on_application speaks only on pending -> rejected).
  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = OLD.job_id
     AND helper_id = OLD.helper_id
     AND status = 'accepted';

  SELECT j.helper_id, j.payment_status
    INTO v_job_helper, v_payment
    FROM public.jobs j
   WHERE j.id = OLD.job_id
   FOR UPDATE;

  -- No job row (a job delete cascading here) or the departed Helpr was not the
  -- lead: nothing on the job names them.
  IF NOT FOUND OR v_job_helper IS DISTINCT FROM OLD.helper_id THEN
    RETURN OLD;
  END IF;

  IF public.job_payment_is_funded(v_payment) THEN
    SELECT g.helper_id
      INTO v_next_lead
      FROM public.group_job_helpers g
     WHERE g.job_id = OLD.job_id
       AND g.helper_id IS NOT NULL
       AND g.helper_id IS DISTINCT FROM OLD.helper_id
       AND public.helper_award_block_reason(g.helper_id) IS NULL
     ORDER BY g.joined_at NULLS LAST, g.id
     LIMIT 1;
  END IF;

  -- Two statements, not one. enforce_helper_jobs_column_whitelist lets a lead
  -- CLEAR jobs.helper_id but never move it to another account; when the lead
  -- is the one leaving (auth.uid() = OLD.helper_id) the move is made from a
  -- row whose helper_id is already NULL, which that trigger does not judge as
  -- the lead's write. The award and funding gates still judge the second
  -- statement, and the candidate above is chosen to pass both.
  UPDATE public.jobs
     SET helper_id = NULL
   WHERE id = OLD.job_id;

  IF v_next_lead IS NOT NULL THEN
    UPDATE public.jobs
       SET helper_id = v_next_lead
     WHERE id = OLD.job_id;
  END IF;

  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_job_after_roster_departure() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_job_after_roster_departure ON public.group_job_helpers;
CREATE TRIGGER trg_sync_job_after_roster_departure
  AFTER DELETE ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.sync_job_after_roster_departure();

-- ── 2. helper_cancel_booking: A CREW MEMBER CAN LEAVE ────────────────────────
CREATE OR REPLACE FUNCTION public.helper_cancel_booking(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_starts_at timestamptz;
  v_result jsonb;
  v_slot_id uuid;
  v_slot_completed_at timestamptz;
  v_remaining int;
BEGIN
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status,
         j.date_needed, j.start_time, j.helper_completed_at,
         j.is_group_job, j.helpers_needed
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- ── THE CREW BRANCH ──────────────────────────────────────────────────────
  -- Membership is the caller's roster slot, not jobs.helper_id (the lead).
  IF v_job.is_group_job IS TRUE THEN
    SELECT g.id, g.helper_completed_at
      INTO v_slot_id, v_slot_completed_at
      FROM public.group_job_helpers g
     WHERE g.job_id = v_job.id AND g.helper_id = auth.uid()
     FOR UPDATE;

    IF v_slot_id IS NULL THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
    -- 'open' included: a crew that is still staffing already holds the
    -- members hired so far, and each of them has committed.
    IF v_job.status::text NOT IN ('open', 'accepted') THEN
      RAISE EXCEPTION 'not_cancellable'
        USING HINT = 'Only a booked job that has not started can be cancelled this way.';
    END IF;
    -- Leaving would drop a part this Helpr already marked done out of the
    -- roll-up that pays the crew.
    IF v_slot_completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'not_cancellable'
        USING HINT = 'You already marked your part done, so you can''t leave this job. Message the poster or open a dispute.';
    END IF;

    v_starts_at := ((v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time))
                      AT TIME ZONE 'America/Chicago');
    IF v_starts_at IS NOT NULL AND now() >= v_starts_at THEN
      RAISE EXCEPTION 'job_already_started'
        USING HINT = 'The scheduled start has passed — contact the poster or support.';
    END IF;

    v_result := public.apply_job_denial_consequence(
      auth.uid(), v_job.id,
      'Cancelled after committing to: "' || COALESCE(v_job.title, 'Unknown') || '"');

    -- trg_sync_job_after_roster_departure rejects this Helpr's application
    -- and moves or clears the lead when they were it.
    DELETE FROM public.group_job_helpers WHERE id = v_slot_id;

    SELECT count(*) INTO v_remaining
      FROM public.group_job_helpers g
     WHERE g.job_id = v_job.id;

    IF v_job.status::text = 'accepted' AND v_remaining < COALESCE(v_job.helpers_needed, 1) THEN
      UPDATE public.jobs
         SET status = 'open'
       WHERE id = v_job.id;
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_job.customer_id,
      'A Helpr left your crew',
      'One of your Helprs can''t make "' || COALESCE(v_job.title, 'your job')
        || '" — their spot is open to everyone again.',
      'warning',
      '/posts?job=' || v_job.id::text,
      v_job.id
    );

    RETURN v_result;
  END IF;

  -- ── THE SINGLE-HELPER PATH ───────────────────────────────────────────────
  IF v_job.helper_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.status <> 'accepted' THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'Only a booked job that has not started can be cancelled this way.';
  END IF;
  -- Reopening would hand the next Helpr this one's done stamp.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'You already marked this job done, so it can''t be cancelled. Message the poster or open a dispute.';
  END IF;

  -- Once the start has passed this is a no-show question, not a cancellation.
  v_starts_at := ((v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time))
                    AT TIME ZONE 'America/Chicago');
  IF v_starts_at IS NOT NULL AND now() >= v_starts_at THEN
    RAISE EXCEPTION 'job_already_started'
      USING HINT = 'The scheduled start has passed — contact the poster or support.';
  END IF;

  v_result := public.apply_job_denial_consequence(
    auth.uid(), v_job.id,
    'Cancelled after committing to: "' || COALESCE(v_job.title, 'Unknown') || '"');

  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = v_job.id AND helper_id = auth.uid() AND status = 'accepted';

  -- Reopen with a clean slate for the next helper: confirmation stamps and
  -- the reminder sent-ats reset so the day-of machinery runs fresh.
  UPDATE public.jobs
     SET status = 'open',
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL
   WHERE id = v_job.id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_job.customer_id,
    'Your Helpr cancelled',
    'Your Helpr can''t make "' || COALESCE(v_job.title, 'your job')
      || '" — it''s open to everyone again. Your payment stays protected in escrow for whoever you pick next.',
    'warning',
    '/posts?job=' || v_job.id::text
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.helper_cancel_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_cancel_booking(uuid) TO authenticated, service_role;

-- ── 3. THE CREW TRACKER READS THE MEMBER'S OWN BEFORE PHOTO ──────────────────
CREATE OR REPLACE FUNCTION public.enforce_job_tracking_arrival_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs;
  -- Scalars, not a record: a %ROWTYPE of group_job_helpers would bind at CREATE
  -- time, and an unassigned `record` raises on field access when the SELECT
  -- finds nothing — which is exactly the case this has to test for.
  v_slot_id                  uuid;
  v_slot_arrived_at          timestamptz;
  v_slot_poster_arrival_at   timestamptz;
  v_slot_completed_at        timestamptz;
  v_slot_proof_before        text[];
  -- The app's own rule (src/lib/photoProofPolicy.ts requiredProof().before)
  -- for a job with one Helpr: the job-level before photo.
  v_needs_before_photo       boolean;
  -- The same rule for one crew member: that member's own roster photo.
  v_slot_needs_before_photo  boolean;
BEGIN
  -- Server-side writers (service role) are not constrained. The helper's
  -- on-the-way RPC writes 'on_the_way', which is not gated here. A NULL uid
  -- alone is not the service role — anon has one too (20260915101102).
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  -- FOR SHARE: the stamps this decides from must not change under it (the race
  -- class fixed in 20260913014328). helper_mark_on_the_way holds this jobs row
  -- FOR UPDATE when it writes 'on_the_way' here; a share lock taken by the same
  -- transaction does not wait on its own row lock.
  SELECT * INTO v_job FROM public.jobs WHERE id = NEW.job_id FOR SHARE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- MIRROR OF requiredProof(job).before && (beforeUrls?.length ?? 0) === 0.
  -- Read off the row this function already holds FOR SHARE, so the photo it
  -- judges cannot be deleted out from under the decision.
  v_needs_before_photo :=
    COALESCE(v_job.require_photo_proof, true)
    AND COALESCE(array_length(v_job.proof_before_urls, 1), 0) = 0;

  -- ── THE SINGLE-HELPER PATH, UNCHANGED ────────────────────────────────────
  -- FIRST in the function on purpose: the standing parity guard
  -- (src/test/jobsGuardRpcParity.test.ts) reads the FIRST Working branch in
  -- this body as THE Working predicate, so it must keep landing on the rule
  -- every real job runs, not on the crew rule below.
  IF v_job.is_group_job IS NOT TRUE THEN
    -- The row must belong to the job's assigned helper — on EVERY client write,
    -- position pings included.
    IF v_job.helper_id IS DISTINCT FROM NEW.helper_id THEN
      RAISE EXCEPTION 'tracker_not_assigned_helper' USING ERRCODE = '42501',
        HINT = 'Only the Helpr assigned to this job can update its tracker.';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      -- Position pings (latitude/longitude/updated_at) never move a step.
      RETURN NEW;
    END IF;
    IF NEW.status NOT IN ('arrived', 'working', 'done') THEN
      RETURN NEW;
    END IF;

    IF NEW.status = 'arrived' AND v_job.helper_arrived_at IS NULL THEN
      RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
        HINT = 'Mark arrival at the job site first.';
    END IF;

    -- THE WORKING UNLOCK. Owner, 2026-09-19: "they can not start working until
    -- the poster confirms they are there … even if gps does confirm they are
    -- there the poster still needs ro cfnrm wither way". So this reads ONE
    -- stamp. The GPS half (helper_arrival_verified_at / the near-miss columns)
    -- is evidence shown to both parties, and not part of this predicate.
    IF NEW.status = 'working'
       AND v_job.helper_completed_at IS NULL
       AND v_job.poster_confirmed_arrival_at IS NULL THEN
      RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
        HINT = 'The person who posted this job has to tap Confirm They Arrived before you can start working.';
    END IF;

    -- THE BEFORE PHOTO (owner, 2026-09-19). Second, deliberately — see the
    -- header. `helper_completed_at IS NULL` carried over from the arrival gate
    -- for the same reason it is there: a job already marked complete is not
    -- re-gated by its tracker, so a late tracker write cannot strand a finished
    -- job behind a photo nobody can add any more.
    IF NEW.status = 'working'
       AND v_job.helper_completed_at IS NULL
       AND v_needs_before_photo THEN
      RAISE EXCEPTION 'tracker_requires_before_photo' USING ERRCODE = '23514',
        HINT = 'Tap Before Photo on this job and add one before you start working.';
    END IF;

    IF NEW.status = 'done'
       AND v_job.helper_completed_at IS NULL
       AND v_job.poster_completed_at IS NULL
       AND v_job.status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'tracker_requires_completion' USING ERRCODE = '23514',
        HINT = 'Mark the job complete first.';
    END IF;

    RETURN NEW;
  END IF;

  -- ── THE CREW BRANCH ──────────────────────────────────────────────────────
  SELECT g.id, g.helper_arrived_at, g.poster_confirmed_arrival_at, g.helper_completed_at,
         g.proof_before_urls
    INTO v_slot_id, v_slot_arrived_at, v_slot_poster_arrival_at, v_slot_completed_at,
         v_slot_proof_before
  FROM public.group_job_helpers g
  WHERE g.job_id = NEW.job_id AND g.helper_id = NEW.helper_id
  FOR SHARE;

  IF v_slot_id IS NULL THEN
    RAISE EXCEPTION 'tracker_not_assigned_helper' USING ERRCODE = '42501',
      HINT = 'Only a Helpr on this job''s crew can update its tracker.';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('arrived', 'working', 'done') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'arrived' AND v_slot_arrived_at IS NULL THEN
    RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
      HINT = 'Mark arrival at the job site first.';
  END IF;

  IF NEW.status = 'working'
     AND v_slot_completed_at IS NULL
     AND v_slot_poster_arrival_at IS NULL THEN
    RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
      HINT = 'The person who posted this job has to tap Confirm They Arrived before you can start working.';
  END IF;

  -- Each member's before photo is their own (rpc_group_member_set_proof writes
  -- it to their roster row, and enforce_group_member_completion_gates reads it
  -- there). One member's photo never clears another member's step. The lead
  -- (jobs.helper_id) may also clear it with the job-level photo.
  v_slot_needs_before_photo :=
    COALESCE(v_job.require_photo_proof, true)
    AND COALESCE(array_length(v_slot_proof_before, 1), 0) = 0
    AND NOT (v_job.helper_id IS NOT DISTINCT FROM NEW.helper_id AND NOT v_needs_before_photo);

  IF NEW.status = 'working'
     AND v_slot_completed_at IS NULL
     AND v_slot_needs_before_photo THEN
    RAISE EXCEPTION 'tracker_requires_before_photo' USING ERRCODE = '23514',
      HINT = 'Tap Before Photo on this job and add one before you start working.';
  END IF;

  IF NEW.status = 'done'
     AND v_slot_completed_at IS NULL
     AND v_job.poster_completed_at IS NULL
     AND v_job.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'tracker_requires_completion' USING ERRCODE = '23514',
      HINT = 'Mark your part complete first.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_job_tracking_arrival_gate() FROM PUBLIC, anon, authenticated;
