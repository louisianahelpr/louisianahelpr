-- The job's steps happen in order, on the server (owner, 2026-10-08, the job
-- lifecycle contract docs/JOB-LIFECYCLE.md):
--
-- 1. ON MY WAY needs the Helpr's OWN day-before confirm (Q1570, "both must tap
--    confirm"; accepting never counts) and opens 2 hours before the start (the
--    tracker's own unlock; a job with no start time opens on its day). Measured
--    job 28f8cff5: On My Way with no confirmation from either side.
-- 2. THE POSTER'S "THEY'RE WORKING" waits for the Helpr's Start Working
--    (Q1571). Measured job 28f8cff5: poster_confirmed_working_at 19:09:54Z,
--    the Helpr's working 19:10:26Z.
-- 3. START WORKING and MARK DONE accept a GPS-verified arrival without the
--    poster's tap (owner pop-up 2026-10-08, "GPS skips it", over the 09-19
--    rule); an arrival the location did not verify still needs the poster's
--    "Confirm They Arrived". Same predicate as arrivalEstablished
--    (supabase/functions/_shared/arrivalRule.ts).
--
-- Not judged by 1 and 2: server context, and jobs posted by is_seed test
-- accounts (the nightly journeys run a whole job in one pass and back-date the
-- working stamp to clear the 30-minute floor; profiles.is_seed is not
-- user-writable). The same exemption as refuse_short_notice_job.
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS; grants restated.

CREATE OR REPLACE FUNCTION public.job_posted_by_seed(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_customer_id AND p.is_seed);
$fn$;
REVOKE ALL ON FUNCTION public.job_posted_by_seed(uuid) FROM PUBLIC, anon, authenticated;

-- ── 1. ON MY WAY ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.helper_mark_on_the_way(p_job_id uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs;
  v_now timestamptz := now();
  v_tracking_id uuid;
  v_start timestamptz;
BEGIN
  -- Lock the row: two concurrent taps must not both run the transition.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_the_assigned_helper' USING ERRCODE = '42501';
  END IF;
  IF v_job.status NOT IN ('accepted', 'in_progress') THEN
    RAISE EXCEPTION 'job_not_active' USING ERRCODE = '23514',
      HINT = 'On-the-way can only be marked on an accepted or in-progress job.';
  END IF;
  IF v_job.helper_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'helper_not_confirmed' USING ERRCODE = '23514',
      HINT = 'Confirm the job before heading out.';
  END IF;

  -- THE DAY-BEFORE CONFIRM AND THE 2-HOUR WINDOW (Q1570). A second tap after
  -- heading out is a no-op below, never refused here.
  IF v_job.helper_on_the_way_at IS NULL
     AND NOT public.job_posted_by_seed(v_job.customer_id) THEN
    IF v_job.helper_dayof_confirmed_at IS NULL THEN
      RAISE EXCEPTION 'helper_not_dayof_confirmed' USING ERRCODE = '23514',
        HINT = 'Tap "Confirm You''ll Be at the Job" before heading out.';
    END IF;
    IF v_job.date_needed IS NOT NULL THEN
      v_start := (v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
      IF (v_job.start_time IS NOT NULL AND v_now < v_start - interval '2 hours')
         OR (v_job.start_time IS NULL AND v_now < v_start) THEN
        RAISE EXCEPTION 'on_the_way_too_early' USING ERRCODE = '23514',
          HINT = 'I''m On My Way turns on 2 hours before the job starts.';
      END IF;
    END IF;
  END IF;

  -- Tracking row: job_tracking has no unique(job_id, helper_id), so update
  -- the newest existing row for this pair, else insert one.
  SELECT id INTO v_tracking_id
    FROM public.job_tracking
   WHERE job_id = p_job_id AND helper_id = v_job.helper_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_tracking_id IS NOT NULL THEN
    UPDATE public.job_tracking
       SET status = 'on_the_way',
           latitude = p_lat,
           longitude = p_lng,
           updated_at = v_now
     WHERE id = v_tracking_id;
  ELSE
    INSERT INTO public.job_tracking (job_id, helper_id, status, latitude, longitude)
    VALUES (p_job_id, v_job.helper_id, 'on_the_way', p_lat, p_lng)
    RETURNING id INTO v_tracking_id;
  END IF;

  -- ONE update: status transition + departure stamp together, so the notify
  -- trigger sees both in a single firing and an interrupted run can never
  -- leave one without the other.
  UPDATE public.jobs
     SET status = CASE WHEN status = 'accepted' THEN 'in_progress' ELSE status END,
         helper_on_the_way_at = COALESCE(helper_on_the_way_at, v_now)
   WHERE id = p_job_id;

  RETURN v_tracking_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.helper_mark_on_the_way(uuid, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_mark_on_the_way(uuid, double precision, double precision) TO authenticated, service_role;

-- ── 2. THE POSTER'S "THEY'RE WORKING" WAITS FOR THE HELPR ──────────────────
CREATE OR REPLACE FUNCTION public.enforce_poster_working_confirm_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.poster_confirmed_working_at IS NULL OR OLD.poster_confirmed_working_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.customer_id
     OR OLD.is_group_job IS TRUE
     OR public.job_posted_by_seed(OLD.customer_id) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.job_tracking t
     WHERE t.job_id = OLD.id AND t.helper_id = OLD.helper_id
       AND t.status IN ('working', 'done')
  ) THEN
    RAISE EXCEPTION 'working_confirm_before_working' USING ERRCODE = '23514',
      HINT = 'Your Helpr has not tapped Start Working yet.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_poster_working_confirm_order() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_poster_working_confirm_order ON public.jobs;
CREATE TRIGGER trg_jobs_poster_working_confirm_order
  BEFORE UPDATE OF poster_confirmed_working_at ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_poster_working_confirm_order();

-- ── 3. A GPS-VERIFIED ARRIVAL UNLOCKS WORKING AND DONE ──────────────────────
-- Each body is its newest definition with only the arrival predicate widened.

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
  v_slot_verified_at         timestamptz;
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
    -- GPS SKIPS THE POSTER'S TAP (owner, 2026-10-08): a verified arrival
    -- unlocks Working on its own; an unverified one still needs the poster.
    IF NEW.status = 'working'
       AND v_job.helper_completed_at IS NULL
       AND v_job.poster_confirmed_arrival_at IS NULL
       AND v_job.helper_arrival_verified_at IS NULL THEN
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
         g.proof_before_urls, g.helper_arrival_verified_at
    INTO v_slot_id, v_slot_arrived_at, v_slot_poster_arrival_at, v_slot_completed_at,
         v_slot_proof_before, v_slot_verified_at
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
     AND v_slot_poster_arrival_at IS NULL
     AND v_slot_verified_at IS NULL THEN
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

CREATE OR REPLACE FUNCTION public.enforce_helper_completion_gates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- THE GROUP ROLL-UP (2026-09-19). A crew job's arrivals and completions live
  -- on `group_job_helpers`, one row per member, each already past
  -- `enforce_group_member_completion_gates` — the SAME three gates, applied per
  -- member. `rpc_group_member_mark_done` stamps this job column only once every
  -- slot is finished. The job-level predicates below read scalars a crew job
  -- never fills (poster_confirmed_arrival_at, the job's shared proof arrays),
  -- so without this the last member's roll-up would be refused for a stamp
  -- nobody on a crew job can produce.
  IF OLD.is_group_job IS TRUE
     AND COALESCE(current_setting('app.group_rollup_rpc', true), '') = '1' THEN
    RETURN NEW;
  END IF;

  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  -- THE STATUS DOOR (VN-33 review). The whitelist allows `status` and
  -- enforce_job_status_transition allows in_progress/accepted → completed, so
  -- the assigned Helpr writing status = 'completed' directly reached a
  -- completed job with no arrival at all — and a completed status also takes
  -- the job out of create-payment's release and auto-release-payment,
  -- stranding the escrow. The app never writes that status as a Helpr; the one
  -- sanctioned Helpr-session writer is rpc_withdraw_dispute, which restores a
  -- completed job under its own transaction-local flag.
  IF NEW.status::text = 'completed'
     AND OLD.status::text IS DISTINCT FROM 'completed'
     AND COALESCE(current_setting('app.dispute_withdraw_rpc', true), '') <> '1' THEN
    RAISE EXCEPTION 'helper_cannot_complete_by_status'
      USING ERRCODE = '42501',
            HINT = 'Mark the job complete; the job is completed when the payment is released.';
  END IF;

  IF NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL THEN
    -- ARRIVAL MUST BE ESTABLISHED, and since the owner's 2026-09-19 reversal
    -- that is ONE stamp: the poster tapped "Confirm They Arrived". VN-33's
    -- "GPS AND poster" and VN-33(b)'s near-miss stand-in are both superseded —
    -- keeping GPS in this predicate while the tracker's Working step no longer
    -- reads it would let a Helpr be waved into work and then refused payment
    -- for a stamp nobody can produce. No grandfather clause: the rule only ever
    -- widens what passes, so no in-flight job is stranded by it.
    IF OLD.poster_confirmed_arrival_at IS NULL
       AND OLD.helper_arrival_verified_at IS NULL THEN  -- GPS skips the tap (2026-10-08)
      RAISE EXCEPTION 'completion_requires_confirmed_arrival'
        USING ERRCODE = '23514',
              HINT = 'The person who posted this job has to tap Confirm They Arrived before you can mark it complete.';
    END IF;

    -- Photo proof is the POSTER'S call, per job. COALESCE to true so a row
    -- written by a client that predates the column (or by any path that omits
    -- it) still gets the historic always-on behaviour rather than a silent
    -- opt-out. Read off NEW so a poster who turns the requirement off while the
    -- job is in flight releases the helper immediately.
    IF COALESCE(NEW.require_photo_proof, true)
       AND (COALESCE(array_length(NEW.proof_before_urls, 1), 0) = 0
            OR COALESCE(array_length(NEW.proof_after_urls, 1), 0) = 0) THEN
      RAISE EXCEPTION 'completion_requires_proof_photos'
        USING ERRCODE = '23514',
              HINT = 'Add before and after photos before marking the job done.';
    END IF;

    IF COALESCE(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) IS NOT NULL
       AND now() - COALESCE(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) < interval '30 minutes' THEN
      RAISE EXCEPTION 'completion_min_work_time'
        USING ERRCODE = '23514',
              HINT = 'A job cannot be marked done within 30 minutes of starting.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_helper_completion_gates() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_group_member_completion_gates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
BEGIN
  -- Only the stamping transition is judged.
  IF NEW.helper_completed_at IS NULL OR OLD.helper_completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  SELECT j.status, j.require_photo_proof
    INTO v_job
  FROM public.jobs j
  WHERE j.id = NEW.job_id;

  IF v_job.status IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status::text NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_completable'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer active (status=' || v_job.status::text || '), so your part cannot be marked done.';
  END IF;

  -- ARRIVAL. One predicate, the poster's confirmation of THIS member — the
  -- 2026-09-19 rule (GPS is evidence, the poster's tap is the gate), read off
  -- the member's own row rather than the job's scalar.
  IF NEW.poster_confirmed_arrival_at IS NULL
     AND NEW.helper_arrival_verified_at IS NULL THEN  -- GPS skips the tap (2026-10-08)
    RAISE EXCEPTION 'completion_requires_confirmed_arrival'
      USING ERRCODE = '23514',
            HINT = 'The person who posted this job has to tap Confirm They Arrived for you before you can mark your part complete.';
  END IF;

  -- PHOTO PROOF. The poster's call, per job (COALESCE to the historic
  -- always-on behaviour), but satisfied PER MEMBER: one member's photos do not
  -- discharge another member's proof.
  IF COALESCE(v_job.require_photo_proof, true)
     AND (COALESCE(array_length(NEW.proof_before_urls, 1), 0) = 0
          OR COALESCE(array_length(NEW.proof_after_urls, 1), 0) = 0) THEN
    RAISE EXCEPTION 'completion_requires_proof_photos'
      USING ERRCODE = '23514',
            HINT = 'Add before and after photos of your part before marking it done.';
  END IF;

  -- 30-MINUTE FLOOR, from this member's own clock.
  IF COALESCE(NEW.poster_confirmed_working_at, NEW.helper_arrived_at) IS NOT NULL
     AND now() - COALESCE(NEW.poster_confirmed_working_at, NEW.helper_arrived_at) < interval '30 minutes' THEN
    RAISE EXCEPTION 'completion_min_work_time'
      USING ERRCODE = '23514',
            HINT = 'A job cannot be marked done within 30 minutes of starting.';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_group_member_completion_gates() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_helper_mark_done(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- `record`, not `public.jobs`, so the function body does not bind the jobs
  -- rowtype at CREATE time (keeps this file creatable on a from-scratch replay
  -- before jobs exists, and matches the trigger's skip guard below).
  v_job record;
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: a double tap must not run two stamps against one row.
  SELECT * INTO v_job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_uid IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_the_assigned_helper' USING ERRCODE = '42501';
  END IF;

  -- Already done: keep the FIRST stamp and report state.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'already_done', true,
      'helper_completed_at', v_job.helper_completed_at,
      'poster_completed_at', v_job.poster_completed_at
    );
  END IF;

  IF v_job.status::text NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_completable' USING ERRCODE = '42501',
      HINT = 'This job is no longer active (status=' || v_job.status::text || '), so it cannot be marked done.';
  END IF;

  -- The gate checks below mirror enforce_helper_completion_gates, which is
  -- AUTHORITATIVE: it fires on this UPDATE too (its trigger is BEFORE UPDATE OF
  -- helper_completed_at, status, and auth.uid() is still the Helpr inside this
  -- definer). These give the Helpr a clean, specific refusal before the write;
  -- if the two ever drift, the trigger still fails closed. Keep them in step.
  --
  -- Arrival established = the poster's confirmation, GPS or no GPS (owner,
  -- 2026-09-19; the exact predicate the trigger enforces on the write).
  IF v_job.poster_confirmed_arrival_at IS NULL
     AND v_job.helper_arrival_verified_at IS NULL THEN  -- GPS skips the tap (2026-10-08)
    RAISE EXCEPTION 'completion_requires_confirmed_arrival' USING ERRCODE = '23514',
      HINT = 'The person who posted this job has to tap Confirm They Arrived before you can mark it complete.';
  END IF;

  IF COALESCE(v_job.require_photo_proof, true)
     AND (COALESCE(array_length(v_job.proof_before_urls, 1), 0) = 0
          OR COALESCE(array_length(v_job.proof_after_urls, 1), 0) = 0) THEN
    RAISE EXCEPTION 'completion_requires_proof_photos' USING ERRCODE = '23514',
      HINT = 'Add before and after photos before marking the job done.';
  END IF;

  IF COALESCE(v_job.poster_confirmed_working_at, v_job.helper_arrived_at) IS NOT NULL
     AND v_now - COALESCE(v_job.poster_confirmed_working_at, v_job.helper_arrived_at) < interval '30 minutes' THEN
    RAISE EXCEPTION 'completion_min_work_time' USING ERRCODE = '23514',
      HINT = 'A job cannot be marked done within 30 minutes of starting.';
  END IF;

  -- THE STAMP. The server clock, never a client-chosen time. Conditional on the
  -- live status and an unset stamp so a cancel / release / stamp that committed
  -- between the SELECT and here wins the race and this no-ops rather than
  -- reviving a job that moved on.
  UPDATE public.jobs
     SET helper_completed_at = v_now
   WHERE id = _job_id
     AND helper_completed_at IS NULL
     AND status IN ('accepted', 'in_progress', 'revision_requested');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_completable' USING ERRCODE = '42501',
      HINT = 'This job is no longer active, so it cannot be marked done.';
  END IF;

  RETURN jsonb_build_object(
    'already_done', false,
    'helper_completed_at', v_now,
    'poster_completed_at', v_job.poster_completed_at
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rpc_helper_mark_done(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_helper_mark_done(uuid) TO authenticated, service_role;

-- The arrival verdict says so too: a verified check-in is established and owes
-- no poster tap (the body is its newest definition with only those two flags).
CREATE OR REPLACE FUNCTION public.mark_helper_arrival(p_job_id uuid, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs;
  v_dist double precision;
  v_verified boolean := false;
  v_near_miss boolean := false;
  v_new_window boolean := false;
  v_now timestamptz := now();
  v_basis text;
  v_arrived_at timestamptz;
BEGIN
  -- FOR UPDATE: a double tap must not run two verdicts against one row.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_the_assigned_helper' USING ERRCODE = '42501';
  END IF;
  IF v_job.status NOT IN ('accepted', 'in_progress') THEN
    RAISE EXCEPTION 'job_not_active' USING ERRCODE = '23514',
      HINT = 'Arrival can only be marked on an accepted or in-progress job.';
  END IF;

  -- ALREADY SETTLED BY THE POSTER. Their tap IS the arrival under the new
  -- rule, so there is nothing left for a retry to establish and nothing to
  -- re-measure — a pin known to be wrong must not be measured against again.
  -- No write. (Generalised from the 20260915074058 near-miss-only carve-out.)
  IF v_job.poster_confirmed_arrival_at IS NOT NULL
     AND v_job.helper_arrived_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'arrival_recorded', true,
      'arrived_at', v_job.helper_arrived_at,
      'verified', v_job.helper_arrival_verified_at IS NOT NULL,
      'basis', 'already_confirmed',
      'distance_ft', v_job.helper_arrival_near_miss_ft,
      'poster_confirmed', true,
      'poster_confirmation_required', false,
      'poster_can_confirm', false,
      'arrival_established', true
    );
  END IF;

  -- ALREADY VERIFIED. A second call (double tap, a retry after a lost
  -- response) must not be refused because the Helpr has since walked to their
  -- van, and must never DOWNGRADE the verification to a bare claim. No write.
  IF v_job.helper_arrival_verified_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'arrival_recorded', true,
      'arrived_at', COALESCE(v_job.helper_arrived_at, v_job.helper_arrival_verified_at),
      'verified', true,
      'basis', 'already_verified',
      'distance_ft', NULL,
      'poster_confirmed', false,
      'poster_confirmation_required', false,
      'poster_can_confirm', true,
      'arrival_established', true
    );
  END IF;

  -- WHAT DID THE LOCATION PROVE? Every branch below RECORDS the arrival; they
  -- differ only in whether they can also verify it. Nothing raises.
  IF p_lat IS NULL OR p_lng IS NULL THEN
    -- Location off, denied, or no fix. Owner, 2026-09-19: "if gps is not on,
    -- they can mark themselves as arrived but can not move on until the poster
    -- marks them arrived."
    v_basis := 'no_location';
  ELSIF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    v_basis := 'location_invalid';
  ELSIF v_job.latitude IS NULL OR v_job.longitude IS NULL THEN
    -- The job itself never geocoded, so there is nothing to measure against. A
    -- real fix is the best evidence available; accept it rather than punishing
    -- the Helpr for the poster's address. (Unchanged from 20260915044137.)
    v_verified := true;
    v_basis := 'no_job_coordinates';
  ELSE
    -- Haversine, in feet (earth radius 20 902 231 ft) — the same 500 ft
    -- threshold the client shows. LEAST(1, …) keeps asin in its domain for a
    -- near-antipodal fix, where rounding can push the argument past 1.
    v_dist := 20902231 * 2 * asin(LEAST(1::double precision, sqrt(
      power(sin(radians((p_lat - v_job.latitude)::double precision) / 2), 2)
      + cos(radians(v_job.latitude::double precision))
        * cos(radians(p_lat::double precision))
        * power(sin(radians((p_lng - v_job.longitude)::double precision) / 2), 2)
    )));
    IF v_dist <= 500 THEN
      v_verified := true;
      v_basis := 'gps_verified';
    ELSIF v_dist <= 5280 THEN
      -- BAD PIN (VN-33(b), 20260915074058), recorded exactly as before. The
      -- stamp is the FIRST near miss of a 12-hour window, not the latest: the
      -- no-show hold (report_helper_no_show GUARD 0b) and the admin escalation
      -- count from it, so a Helpr who keeps tapping from 1,500 ft away cannot
      -- hold them open indefinitely. The distance is always the latest.
      v_near_miss := true;
      v_basis := 'near_miss';
      v_new_window := v_job.helper_arrival_near_miss_at IS NULL
                      OR v_job.helper_arrival_near_miss_at <= v_now - interval '12 hours';
    ELSE
      -- Beyond a mile. Recorded as a claim and nothing more: no verification,
      -- no near-miss stamp (the near-miss columns mean "close enough that the
      -- pin is the likely culprit", and a mile out is not that). The poster's
      -- confirmation is what can still move this job, and they are told the
      -- Helpr marked arrived by notify_poster_on_status_change.
      v_basis := 'too_far';
    END IF;
  END IF;

  -- THE WRITE. One statement, so a double tap cannot interleave two.
  --   helper_arrived_at           first claim wins; a retry never re-stamps it.
  --   helper_arrival_verified_at  set only on a genuine verification, and only
  --                               if not already set — a later claim from the
  --                               van can never clear or move it.
  --   near-miss columns           as before.
  --   status                      accepted → in_progress, because the Helpr is
  --                               on site. This is NOT the working unlock; that
  --                               is the tracker's 'working' row, gated on the
  --                               poster's confirmation below.
  -- The transaction-local flag is what lets the helper column whitelist admit
  -- these four columns from this ONE function; it is dropped the moment its
  -- single UPDATE is done, so nothing later in the transaction inherits it.
  PERFORM set_config('app.arrival_rpc', '1', true);
  UPDATE public.jobs
     SET helper_arrived_at = COALESCE(helper_arrived_at, v_now),
         helper_arrival_verified_at = CASE
           WHEN v_verified THEN COALESCE(helper_arrival_verified_at, v_now)
           ELSE helper_arrival_verified_at END,
         helper_arrival_near_miss_at = CASE
           WHEN v_near_miss AND v_new_window THEN v_now
           ELSE helper_arrival_near_miss_at END,
         helper_arrival_near_miss_ft = CASE
           WHEN v_near_miss THEN round(v_dist)::integer
           ELSE helper_arrival_near_miss_ft END,
         status = CASE WHEN status = 'accepted' THEN 'in_progress' ELSE status END
   WHERE id = p_job_id
   RETURNING helper_arrived_at INTO v_arrived_at;
  PERFORM set_config('app.arrival_rpc', '0', true);

  -- One near-miss notice per 12-hour window, however often the Helpr retries
  -- (arrival-confirm-reminder sends the follow-ups). The generic "<Helpr> has
  -- arrived" notice is sent by notify_poster_on_status_change off
  -- helper_arrived_at, which now fires for EVERY recorded arrival; this extra
  -- one exists because it carries the distance and names the control.
  IF v_near_miss AND v_new_window AND v_job.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.customer_id,
      'Is your Helpr at the door?',
      '"' || v_job.title || '" — their location is ' || round(v_dist)::bigint
        || ' ft from the map pin. If they are there, tap Confirm They Arrived.',
      'job_updates',
      '/posts?job=' || p_job_id
    );
  END IF;

  -- THE VERDICT. `poster_confirmation_required` is true on every path that
  -- reaches here: the owner's rule is that the poster confirms either way, so
  -- a verified arrival is just as blocked as a fix-less one. `poster_can_confirm`
  -- is kept (and widened from the near-miss-only case) so the currently shipped
  -- client, which branches on it, degrades into telling the Helpr the truth
  -- rather than into an error toast.
  RETURN jsonb_build_object(
    'arrival_recorded', true,
    'arrived_at', v_arrived_at,
    'verified', v_verified,
    'basis', v_basis,
    'distance_ft', CASE WHEN v_dist IS NULL THEN NULL ELSE round(v_dist::numeric) END,
    'poster_confirmed', false,
    'poster_confirmation_required', NOT v_verified,
    'poster_can_confirm', NOT v_verified,
    'arrival_established', v_verified
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) TO authenticated, service_role;
