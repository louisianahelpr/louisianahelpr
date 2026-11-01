-- POST-H3 (owner pop-up 10-31 ~9:35 PM): "the job can't be marked done until the listings are live (the listings
-- are the proof)".
--
-- A "Have a Helpr list it for me" job (category declutter_help) is a Helpr helping a seller photograph and list
-- things; the seller posts the listings from their own account (no account access). Until now its Mark done asked
-- for before and after photos like any job, and nothing tied it to the listings it exists for, so a Helpr could be
-- paid with nothing listed. Now the Helpr can mark it done only once at least one Declutter listing of the
-- seller's, created since the job was posted, has gone live (live, or already reserved, sold or handed over). This
-- is ADDED to the existing gates; the photo rule (the poster's require_photo_proof) and every other job are
-- unchanged, so nothing that was refused before is let through.
--
-- Two places say it, as before: enforce_helper_completion_gates (the AUTHORITATIVE trigger on the jobs write) and
-- rpc_helper_mark_done (the clean refusal before the write). Both are restated from their NEWEST definition,
-- 20261029042735_done_floor_from_arrival.sql, verbatim except the marked POST-H3 block. A crew job's members are
-- not touched (the group roll-up path returns before this rule; no declutter_help crew exists in the app).
--
-- The helper: sell_for_me_listings_live(job). SECURITY DEFINER because a Helpr cannot read a seller's reserved or
-- sold items; it answers only a boolean, only to the job's own Helpr or poster (or the server), and anon cannot
-- call it. authenticated keeps EXECUTE because the jobs trigger runs as the Helpr.
--
-- REPLAY-SAFE: CREATE OR REPLACE throughout; the helper only references declutter_items at call time (plpgsql), so
-- a from-scratch replay before declutter_items exists still creates it. PGlite proof:
-- src/test/pglite/sellForMeDoneWaitsForListings.pglite.mjs (applied 3x).

CREATE OR REPLACE FUNCTION public.sell_for_me_listings_live(_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seller uuid;
  v_helper uuid;
  v_since timestamptz;
BEGIN
  SELECT customer_id, helper_id, created_at INTO v_seller, v_helper, v_since FROM public.jobs WHERE id = _job_id;
  -- Answers only the job's own two people (or the server): never a probe of anyone's listings.
  IF v_seller IS NULL OR (auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_helper AND auth.uid() IS DISTINCT FROM v_seller) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.declutter_items i
     WHERE i.seller_id = v_seller
       AND i.status IN ('live', 'reserved', 'sold', 'completed')
       AND i.created_at >= COALESCE(v_since, '-infinity'::timestamptz)
  );
END;
$function$;
-- The jobs trigger runs as the Helpr (it is not a definer), so authenticated may call it; the caller check above
-- keeps it to the job's own two people.
REVOKE ALL ON FUNCTION public.sell_for_me_listings_live(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sell_for_me_listings_live(uuid) TO authenticated, service_role;

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
    -- POST-H3 (owner 10-31 ~9:35 PM): a "Have a Helpr list it" job (declutter_help) is done only once its
    -- listings are live; the listings are its proof. The photo rule below is unchanged.
    IF OLD.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_live(OLD.id) THEN
      RAISE EXCEPTION 'completion_requires_live_listings'
        USING ERRCODE = '23514',
              HINT = 'The listings are the proof: mark it done once the seller''s listings are live on Declutter.';
    END IF;

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

  -- POST-H3: a Have-a-Helpr-list-it job waits for its live listings (the trigger's rule, said first).
  IF v_job.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_live(v_job.id) THEN
    RAISE EXCEPTION 'completion_requires_live_listings' USING ERRCODE = '23514',
      HINT = 'The listings are the proof: mark it done once the seller''s listings are live on Declutter.';
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
