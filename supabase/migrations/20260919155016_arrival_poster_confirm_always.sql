-- ARRIVAL: RECORD IT ALWAYS; THE POSTER CONFIRMS IT ALWAYS.
--
-- OWNER DECISION, 2026-09-19 (pop-up, verbatim):
--   "but they can not start working until the poster confirms they are there.
--    they shoud be aware of this so they dont try to cheat the system. if gps
--    is not on, they can mark themselves as arrived but can not move on until
--    the poster marks them arrived. so encourgage to turn on gps. but even if
--    gps does confirm they are there the poster still needs ro cfnrm wither
--    way"
--
-- This REVERSES the VN-33 rule shipped in 20260915044137 (owner, 2026-09-14:
-- "both required: nearby by GPS AND poster confirms. No fallback."). The
-- history is kept, not deleted, because the reason VN-33 existed — a Helpr can
-- send any coordinates, so GPS alone must not unlock money — is satisfied by
-- the NEW rule too, and more cheaply: the half that cannot be faked is the
-- poster's tap, and that half is now required in every case.
--
-- WHAT WAS BROKEN. `mark_helper_arrival` REFUSED a far or fix-less arrival and
-- wrote NOTHING. So `helper_arrived_at` stayed NULL. The poster's "Confirm They
-- Arrived" control renders only once `helper_arrived_at` is stamped, so it
-- never appeared — while the Helpr's blocked CTA told them to go ask the poster
-- for exactly that tap. A Helpr with Location off, or standing at a job whose
-- map pin was geocoded to the wrong block, could not start work and could not
-- be paid, and neither party had a control that would move the job forward.
-- The 20260915074058 near-miss carve-out patched the within-a-mile case only;
-- Location-off and beyond-a-mile stayed dead.
--
-- THE NEW RULE, in three parts:
--   1. A Helpr may ALWAYS record an arrival. `mark_helper_arrival` no longer
--      raises `arrival_too_far` / `arrival_location_required` /
--      `arrival_location_invalid`; it stamps `helper_arrived_at` and returns a
--      verdict describing what the location did or did not prove.
--   2. GPS is EVIDENCE, not a gate. `helper_arrival_verified_at` is still
--      stamped only when the server itself measures the phone's coordinates
--      within 500 ft of the job, and a claim can never overwrite or clear an
--      existing verification. The near-miss columns are recorded exactly as
--      before.
--   3. `poster_confirmed_arrival_at` is THE gate, in every case, GPS-verified
--      or not — for the tracker's Working step and for the Helpr's completion
--      write alike. "Arrival established" now means precisely that one stamp.
--
-- WHY THE COMPLETION GATE MOVES TOO. Leaving completion on the old (GPS OR
-- near miss) AND poster rule while Working needs only the poster's tap would
-- build a fresh deadlock one step further down the tracker: a Helpr with
-- Location off could be told to start working and then be refused payment for
-- the same missing stamp. One predicate, read the same way by the tracker
-- trigger, the completion trigger, `rpc_helper_mark_done` and the app's shared
-- `arrivalRule.ts`.
--
-- AUTHORIZATION IS UNCHANGED AND RESTATED BELOW. Only the job's assigned Helpr
-- may call `mark_helper_arrival`; both arrival stamps and both near-miss
-- columns stay OFF the helper column whitelist and inside the
-- `app.arrival_rpc` transaction-local carve-out, so a direct PATCH still
-- cannot claim an arrival, and both stay on the poster's `locked_always` list,
-- so a poster still cannot manufacture the Helpr's half. EXECUTE stays revoked
-- from PUBLIC and anon (restated at the foot of this file, because prod's
-- default privileges have silently re-granted PUBLIC before).
--
-- REPLAY-SAFETY: every statement here is CREATE OR REPLACE on a function an
-- earlier migration already defines, plus REVOKE/GRANT guarded on the function
-- actually existing. No DDL depends on an object a LATER migration defines.

-- ---------------------------------------------------------------------------
-- 1. mark_helper_arrival — records every arrival; verifies only what verifies.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_helper_arrival(
  p_job_id uuid,
  p_lat numeric DEFAULT NULL::numeric,
  p_lng numeric DEFAULT NULL::numeric
)
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
      'poster_confirmation_required', true,
      'poster_can_confirm', true,
      'arrival_established', false
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
    'poster_confirmation_required', true,
    'poster_can_confirm', NOT v_verified,
    'arrival_established', false
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The tracker's Working step — the rule the owner named directly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_job_tracking_arrival_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs;
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
  -- is evidence shown to both parties, and no longer part of this predicate.
  IF NEW.status = 'working'
     AND v_job.helper_completed_at IS NULL
     AND v_job.poster_confirmed_arrival_at IS NULL THEN
    RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
      HINT = 'The person who posted this job has to tap Confirm They Arrived before you can start working.';
  END IF;

  IF NEW.status = 'done'
     AND v_job.helper_completed_at IS NULL
     AND v_job.poster_completed_at IS NULL
     AND v_job.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'tracker_requires_completion' USING ERRCODE = '23514',
      HINT = 'Mark the job complete first.';
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The Helpr's completion write — the same one predicate, one step later.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_helper_completion_gates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
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
    IF OLD.poster_confirmed_arrival_at IS NULL THEN
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

-- ---------------------------------------------------------------------------
-- 4. rpc_helper_mark_done — its pre-check must mirror the trigger above.
--    (It was ALSO out of step with VN-33(b): it never learned about the
--    near-miss stand-in, so a bad-pin arrival the trigger accepted was refused
--    here. One predicate removes that whole class.)
-- ---------------------------------------------------------------------------
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
  IF v_job.poster_confirmed_arrival_at IS NULL THEN
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

-- ---------------------------------------------------------------------------
-- 5. EXECUTE, restated. CREATE OR REPLACE preserves an existing ACL, but prod's
--    default privileges have silently re-granted PUBLIC on replaced objects
--    before, so the intended end state is written down rather than assumed.
--    Only a signed-in caller may reach either RPC; both then check auth.uid()
--    against the job's helper_id themselves.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.mark_helper_arrival(uuid, numeric, numeric)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) TO authenticated;
  END IF;
  IF to_regprocedure('public.rpc_helper_mark_done(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.rpc_helper_mark_done(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.rpc_helper_mark_done(uuid) TO authenticated;
  END IF;
  -- Trigger functions are invoked by the trigger machinery, never called by a
  -- role: 20260916030921 revoked client EXECUTE on all of them. Restate it for
  -- the two replaced here so a replace cannot quietly hand it back.
  IF to_regprocedure('public.enforce_job_tracking_arrival_gate()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.enforce_job_tracking_arrival_gate() FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.enforce_helper_completion_gates()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.enforce_helper_completion_gates() FROM PUBLIC, anon, authenticated;
  END IF;
END
$$;
