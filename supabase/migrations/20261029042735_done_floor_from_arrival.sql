-- The 30-minute "Mark done" floor counts from the Helpr's own arrival
-- (audit 2026-10-28, Part 4 half 2, F12; lead decision option 1).
--
-- Before: COALESCE(poster_confirmed_working_at, helper_arrived_at) + 30 min.
-- The poster's "Confirm they're working" comes AFTER the Helpr's Start Working
-- (enforce_poster_working_confirm_order, 20261008203441), which needs an
-- established arrival, so a poster who confirmed late moved the Helpr's floor
-- later: arrived 9:00, poster confirms 9:40, Mark done waits until 10:10. The
-- Helpr's card said "30 minutes after arrival" while the server counted from
-- the poster's tap.
--
-- After: LEAST(poster_confirmed_working_at, helper_arrived_at) + 30 min. LEAST
-- skips NULLs (as COALESCE did), so a job with one stamp behaves as before.
-- In every real flow the poster's stamp is later than the arrival, so the
-- floor is exactly arrival + 30 min. The nightly journeys still clear it by
-- back-dating poster_confirmed_working_at (e2e/journeys/02-marketplace.spec.ts,
-- e2e/prod-lifecycle.spec.ts): helper_arrived_at cannot be back-dated (only
-- mark_helper_arrival writes it). A poster back-dating their own stamp lets
-- their own Helpr finish sooner; nothing else is opened.
--
-- Restated from the NEWEST definitions (20261008203441_arrival_gps_or_poster_
-- and_step_order.sql); the only changes are the floor expression and its HINT.
-- create-payment's release check moves with it (supabase/functions/create-payment).
-- Replay-safe: CREATE OR REPLACE; grants restated (the triggers are unchanged
-- and still point at these functions by name).
-- Proof: src/test/pglite/doneFloorFromArrival.pglite.mjs.

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

    -- From the Helpr's own arrival (audit 2026-10-28 F12): LEAST, so a late
    -- "Confirm they're working" never restarts the clock.
    IF LEAST(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) IS NOT NULL
       AND now() - LEAST(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) < interval '30 minutes' THEN
      RAISE EXCEPTION 'completion_min_work_time'
        USING ERRCODE = '23514',
              HINT = 'A job can be marked done 30 minutes after you arrived.';
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

  -- 30-MINUTE FLOOR, from this member's own arrival (audit 2026-10-28 F12:
  -- LEAST, so a late "Confirm they're working" never restarts the clock).
  IF LEAST(NEW.poster_confirmed_working_at, NEW.helper_arrived_at) IS NOT NULL
     AND now() - LEAST(NEW.poster_confirmed_working_at, NEW.helper_arrived_at) < interval '30 minutes' THEN
    RAISE EXCEPTION 'completion_min_work_time'
      USING ERRCODE = '23514',
            HINT = 'Your part can be marked done 30 minutes after you arrived.';
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

  -- From the Helpr's own arrival (audit 2026-10-28 F12), as the trigger.
  IF LEAST(v_job.poster_confirmed_working_at, v_job.helper_arrived_at) IS NOT NULL
     AND v_now - LEAST(v_job.poster_confirmed_working_at, v_job.helper_arrived_at) < interval '30 minutes' THEN
    RAISE EXCEPTION 'completion_min_work_time' USING ERRCODE = '23514',
      HINT = 'A job can be marked done 30 minutes after you arrived.';
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
