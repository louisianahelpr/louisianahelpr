-- A Helpr who leaves a group job's crew, or is removed from it, is off the job.
--
-- A crew is the roster in `group_job_helpers`; `jobs.helper_id` is the crew's
-- lead (the first hire, kept so the single-helper payout, cancellation-fee and
-- notification paths resolve). Three defects, each reproduced on prod inside a
-- DO block that rolled back (2026-09-25, on the one seed group job):
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
--      helper_cancel_booking), the departed Helpr's accepted application
--      becomes `rejected` (no notice: notify_on_application only speaks on
--      pending -> rejected), and if they were the lead:
--      (Account deletion does NOT come through here: purge_user_data
--      anonymises the roster row with an UPDATE, helper_id -> NULL, and
--      _shared/accountPurge.ts findActiveWork refuses the deletion while the
--      Helpr is on a live crew. 20260925154606 removes the lead entirely.)
--        - on a FUNDED job the lead moves to the earliest remaining member the
--          award gate would accept (helper_award_block_reason IS NULL);
--        - otherwise `jobs.helper_id` is cleared, and the next hire becomes the
--          lead (accept_group_application sets COALESCE(lead, new hire)).
--      The job-level commitment stamps follow the lead: helper_confirmed_at and
--      helper_dayof_confirmed_at become the NEW lead's own roster stamps (NULL
--      when there is no lead), and response_deadline and the three reminder
--      sent-ats are cleared. poster_cancel_job prices the late-cancellation fee
--      from helper_confirmed_at and void-cancelled-payments pays it to
--      helper_id, so a lead who never confirmed is never priced as committed.
--   2. enforce_poster_jobs_money_lock, restated from its newest text
--      (20260915101102) with one carve-out: the departure trigger's own
--      helper_id -> NULL, announced by the transaction-local app.roster_departure
--      flag that only that trigger sets and resets around that one statement.
--      Without it the poster's removal of a funded crew's lead is refused
--      ("Posters may not modify jobs.helper_id once checkout has opened").
--   3. helper_cancel_booking, restated from its live pg_get_functiondef
--      (md5 edc357c58aede8e6cd26d1424b4742eb, 2026-09-25) with a crew branch
--      ahead of the unchanged single-helper path: a crew member with a roster
--      slot, on an open or booked job, whose own part is not done and whose
--      start has not passed, takes the same reliability consequence, leaves
--      the roster (the trigger above moves or clears the lead and its stamps),
--      and a booked job whose roster drops below helpers_needed reopens. A
--      caller with no roster slot who IS jobs.helper_id (a group job from
--      before the roster existed) takes the single-helper path.
--      20260925143327 later rewrites two hints in this function by pattern.
--   4. enforce_job_tracking_arrival_gate, restated from its live definition
--      (md5 92d5e1ad8ecb2bb3d2a57b1b7d2af7ad): on a crew, every member's
--      Working step reads that member's OWN roster before photo, the lead's
--      included (the lead's completion gate reads the roster photo too), so a
--      departed lead's job-level photo clears nobody's step. The single-helper
--      branch is unchanged and stays first (src/test/jobsGuardRpcParity.test.ts).
--
-- LOCK ORDER: helper_cancel_booking locks the jobs row, then the caller's
-- roster row. The poster's direct DELETE locks the roster row it deletes, then
-- (in the trigger) the jobs row. Postgres takes a row's lock before any BEFORE
-- ROW trigger on it runs, so no trigger can put the jobs lock first on that
-- path. The two collide only when the poster removes a member at the moment
-- that same member leaves: Postgres then aborts one of the two whole
-- transactions with 40P01 (nothing half-written) and the other completes,
-- which leaves that member off the crew either way.
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
  v_job_helper        uuid;
  v_payment           text;
  v_next_lead         uuid;
  v_next_confirmed    timestamptz;
  v_next_dayof        timestamptz;
  v_prior_flag        text;
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
    SELECT g.helper_id, g.helper_confirmed_at, g.helper_dayof_confirmed_at
      INTO v_next_lead, v_next_confirmed, v_next_dayof
      FROM public.group_job_helpers g
     WHERE g.job_id = OLD.job_id
       AND g.helper_id IS NOT NULL
       AND g.helper_id IS DISTINCT FROM OLD.helper_id
       AND public.helper_award_block_reason(g.helper_id) IS NULL
     ORDER BY g.joined_at NULLS LAST, g.id
     LIMIT 1;
  END IF;

  -- Step 1: the departed lead's name comes off the job, and nothing else.
  -- enforce_helper_jobs_column_whitelist lets a leaving lead clear helper_id;
  -- enforce_poster_jobs_money_lock lets a poster do so on a funded job only
  -- under app.roster_departure, which is set for this statement alone and put
  -- back to what it was straight after.
  v_prior_flag := current_setting('app.roster_departure', true);
  PERFORM set_config('app.roster_departure', 'on', true);
  UPDATE public.jobs
     SET helper_id = NULL
   WHERE id = OLD.job_id;
  PERFORM set_config('app.roster_departure', COALESCE(v_prior_flag, ''), true);

  -- Step 2: the new lead (or none) and the commitment stamps that go with it.
  -- A separate statement because OLD.helper_id is now NULL: the whitelist no
  -- longer reads this as the departing lead's own write (a lead may never
  -- move helper_id to another account), and the money lock's open-job
  -- NULL -> Helpr carve-out covers the poster. The award and funding gates
  -- judge the new lead; the candidate above is chosen to pass both.
  UPDATE public.jobs
     SET helper_id = v_next_lead,
         helper_confirmed_at = v_next_confirmed,
         helper_dayof_confirmed_at = v_next_dayof,
         response_deadline = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL
   WHERE id = OLD.job_id;

  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_job_after_roster_departure() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_job_after_roster_departure ON public.group_job_helpers;
CREATE TRIGGER trg_sync_job_after_roster_departure
  AFTER DELETE ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.sync_job_after_roster_departure();

-- ── 2. THE POSTER MONEY LOCK LETS THE DEPARTURE TRIGGER CLEAR THE LEAD ───────
CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'boosted_at',
    'boost_expires_at',
    'boost_auto_extended',
    'is_urgent',
    'is_seed',
    -- Added 20260915044137 (VN-33). The Helpr arrival stamps are written
    -- only by mark_helper_arrival (helper) and reset by
    -- zz_jobs_arrival_integrity (which sorts after this trigger). A poster
    -- writing the GPS half would satisfy half of the arrival rule for them.
    'helper_arrived_at',
    'helper_arrival_verified_at',
    -- VN-33(b): server-owned near-miss record. A poster writing it would make
    -- their own confirmation count without the Helpr ever being near.
    'helper_arrival_near_miss_at',
    'helper_arrival_near_miss_ft'
  ];
  locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'protection_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
  ];
BEGIN
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Posters may not reassign jobs.customer_id'
      USING ERRCODE = '42501';
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_always) THEN
      RAISE EXCEPTION 'Posters may not modify jobs.%', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF OLD.payment_status IS DISTINCT FROM 'unpaid'
     OR OLD.stripe_session_id IS NOT NULL THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_funded) THEN
        IF changed_col = 'helper_id'
           AND OLD.helper_id IS NULL
           AND NEW.helper_id IS NOT NULL
           AND OLD.status = 'open' THEN
          CONTINUE;
        END IF;
        -- ADDED 2026-09-05 — the server-owned UNASSIGN.
        -- `report_helper_no_show` reopens the job by clearing helper_id, and
        -- announces itself with the same transaction-local flag four other
        -- triggers already honour. Narrow on purpose: trusted ladder write,
        -- this column, and NULL specifically. Re-pointing helper_id at another
        -- person stays blocked even here.
        IF changed_col = 'helper_id'
           AND NEW.helper_id IS NULL
           AND current_setting('app.trusted_ladder_write', true) = 'on' THEN
          CONTINUE;
        END IF;
        -- The roster departure: sync_job_after_roster_departure clears the
        -- departed lead under app.roster_departure, set around that one
        -- statement. This column, and NULL specifically, as above.
        IF changed_col = 'helper_id'
           AND NEW.helper_id IS NULL
           AND current_setting('app.roster_departure', true) = 'on' THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Posters may not modify jobs.% once checkout has opened', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_poster_jobs_money_lock() FROM PUBLIC, anon, authenticated;

-- ── 3. helper_cancel_booking: A CREW MEMBER CAN LEAVE ────────────────────────
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

  IF v_job.is_group_job IS TRUE THEN
    SELECT g.id, g.helper_completed_at
      INTO v_slot_id, v_slot_completed_at
      FROM public.group_job_helpers g
     WHERE g.job_id = v_job.id AND g.helper_id = auth.uid()
     FOR UPDATE;
  END IF;

  -- ── THE CREW BRANCH ──────────────────────────────────────────────────────
  -- Membership is the caller's roster slot, not jobs.helper_id (the lead). A
  -- group job's lead with no slot (hired before the roster existed) falls
  -- through to the single-helper path below, which is the job they hold.
  IF v_job.is_group_job IS TRUE
     AND (v_slot_id IS NOT NULL OR v_job.helper_id IS DISTINCT FROM auth.uid()) THEN
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
    -- and, when they were the lead, moves or clears the lead together with
    -- its confirmation stamps, response deadline and reminder sent-ats.
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

-- ── 4. THE CREW TRACKER READS THE MEMBER'S OWN BEFORE PHOTO ──────────────────
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
  -- there), the lead's included. One member's photo never clears another
  -- member's step, and the job-level photo clears nobody's: it may belong to
  -- a lead who has since left.
  v_slot_needs_before_photo :=
    COALESCE(v_job.require_photo_proof, true)
    AND COALESCE(array_length(v_slot_proof_before, 1), 0) = 0;

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
