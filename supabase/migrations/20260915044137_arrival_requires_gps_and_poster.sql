-- Arrival needs BOTH: the server finds the Helpr at the job site AND the
-- poster confirms it. (VN-33, owner decision 2026-09-14: "both required …
-- no fallback".)
--
-- WHAT WAS WRONG. The owner, 2000+ miles from a job, tapped "I've Arrived"
-- and the tracker moved on. Read live on prod before this was written:
--   * public.mark_helper_arrival(uuid, numeric, numeric) ALWAYS wrote
--     `helper_arrived_at`. The 500ft verdict only decided whether
--     `helper_arrival_verified_at` was stamped as well. A Helpr with no fix,
--     or a fix 2000 miles away, still became "arrived" (a CLAIM).
--   * `helper_arrived_at` was on the helper's column whitelist
--     (enforce_helper_jobs_column_whitelist), so a plain REST PATCH could set
--     it with no RPC and no location at all.
--   * enforce_helper_completion_gates refused completion only when BOTH the
--     GPS stamp AND the poster's confirmation were missing — i.e. either one
--     unlocked the payout request — plus a grandfather clause for arrivals
--     before 2026-08-28 (0 live rows could still use it on 2026-09-14).
--   * job_tracking.status had no server check at all: its only policy is
--     `auth.uid() = helper_id`, so a client could paint Arrived / Working on
--     the poster's tracker without any arrival on the job row.
--
-- WHAT THIS DOES.
--   1. mark_helper_arrival REFUSES unless the server computes the Helpr
--      within 500ft: no coordinates → 'arrival_location_required'; too far →
--      'arrival_too_far' with DETAIL 'distance_ft=<n>'. A refusal writes
--      NOTHING (no helper_arrived_at, no status change). A success stamps
--      helper_arrived_at and helper_arrival_verified_at together, so a new
--      bare claim can no longer exist. The return shape is unchanged.
--      RAISE rather than `verified:false` on purpose: shipped app builds treat
--      a returned verdict as "marked arrived" and would draw an arrival the
--      server never recorded; on an error they stop and say so.
--   2. helper_arrived_at leaves the helper whitelist and is admitted only
--      under the same transaction-local app.arrival_rpc flag as the verified
--      stamp. The RPC is its only helper-side writer.
--   3. Completion by the Helpr needs helper_arrival_verified_at AND
--      poster_confirmed_arrival_at. The grandfather clause is removed (0 live
--      rows depended on it). Photo proof and the 30-minute floor are
--      unchanged, verbatim.
--   3b. The assigned Helpr can no longer write status = 'completed' directly
--      (the whitelist allowed `status` and the transition matrix allowed it,
--      so that write reached a completed job with no arrival and stranded the
--      escrow). rpc_withdraw_dispute's restore keeps working under its flag.
--   4. job_tracking: a signed-in caller may only move the tracker to
--      'arrived' once the job has an arrival, to 'working' once arrival is
--      established (both stamps), and to 'done' once completion is stamped;
--      and only on a job they are the assigned Helpr of (a stranger could
--      insert, or re-point, a row and paint another poster's tracker).
--   5. The poster can no longer write helper_arrived_at /
--      helper_arrival_verified_at (enforce_poster_jobs_money_lock).
--   6. zz_jobs_arrival_integrity: when a job changes Helpr before it is
--      finished, every arrival/working stamp is cleared, so the next Helpr
--      cannot inherit a verified, poster-confirmed arrival; and the poster
--      cannot confirm an arrival before one exists.
--   7. report_helper_no_show refuses once the Helpr has arrived or marked
--      complete (the app already hides No-Show then): otherwise the reopen
--      would strike a Helpr who was there and clear the proof that they were.
--
-- WHAT THE GPS HALF IS. The server measures the coordinates the phone SENDS.
-- An assigned Helpr can read their job's own coordinates and send those from
-- anywhere; no GPS check without hardware attestation can stop that. The
-- poster's "Confirm They Arrived" is the half that cannot be faked, which is
-- why the owner's rule needs both.
--
-- NOT CHANGED, deliberately (see docs/OPEN.md, VN-33 owner question):
--   * The job-without-coordinates branch: a real fix is still accepted when
--     the job itself has no lat/lng (nothing to measure against). 0 non-seed
--     jobs lack coordinates on 2026-09-14.
--   * auto-release-payment keys on helper_completed_at / poster_completed_at
--     and never reads arrival. A poster who never confirms arrival now means
--     the Helpr cannot mark complete, so nothing starts the 24h clock. What
--     should happen then is the owner's call, not this migration's.
--   * The poster's own release (create-payment 'release' as poster) is not
--     gated on arrival, as before.
--
-- Bodies 1–3, 5 and 7 are rebuilt from the LIVE definitions (pg_get_functiondef
-- on fncmgoasalhdgfwzhsqa, 2026-09-14; md5(prosrc) mark_helper_arrival
-- 3c4bdda67b58f1f7faa56880bd4a56ea, enforce_helper_jobs_column_whitelist
-- 75de6087f63b61837a3f134bd5adc11b, enforce_helper_completion_gates
-- c988ef9309994b2f39fe39d37f5bb182, enforce_poster_jobs_money_lock
-- 3727688fcc4e055f35cb105e52f1ee08, report_helper_no_show
-- 4c902d5c610fbcdd0132d052e0bd85b9). Proof: scripts/probes/arrival-gate.probe.mjs.
--
-- REPLAY-SAFETY: CREATE OR REPLACE for every function; every trigger is
-- DROP IF EXISTS + CREATE (the job_tracking one inside a to_regclass guard). Every object
-- referenced (jobs, job_tracking, the three functions) is defined by earlier
-- migrations. Running this file three times in a row is a no-op after the
-- first (proven in the probe). Grants: mark_helper_arrival keeps its live ACL
-- {postgres, authenticated, service_role}; CREATE OR REPLACE preserves the
-- trigger functions' ACLs, and the statements below pin them anyway.

-- 1. mark_helper_arrival: refuse unless within 500ft ----------------------

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
  v_now timestamptz := now();
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

  -- Already verified: nothing left to prove, and a second call (double tap,
  -- a retry after a lost response) must not be refused because the Helpr has
  -- since walked to their van. No write.
  IF v_job.helper_arrival_verified_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'verified', true,
      'distance_ft', NULL,
      'arrived_at', COALESCE(v_job.helper_arrived_at, v_job.helper_arrival_verified_at)
    );
  END IF;

  -- NO FIX, NO ARRIVAL (owner, VN-33: no fallback). Nothing is written.
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'arrival_location_required' USING ERRCODE = '23514',
      HINT = 'Turn Location on and try again at the job site.';
  END IF;
  IF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'arrival_location_invalid' USING ERRCODE = '22023',
      HINT = 'That location could not be read. Try again at the job site.';
  END IF;

  IF v_job.latitude IS NOT NULL AND v_job.longitude IS NOT NULL THEN
    -- Haversine, in feet (earth radius 20 902 231 ft) — same 500ft
    -- threshold the client shows. LEAST(1, …) keeps asin in its domain for a
    -- near-antipodal fix, where rounding can push the argument past 1.
    v_dist := 20902231 * 2 * asin(LEAST(1::double precision, sqrt(
      power(sin(radians((p_lat - v_job.latitude)::double precision) / 2), 2)
      + cos(radians(v_job.latitude::double precision))
        * cos(radians(p_lat::double precision))
        * power(sin(radians((p_lng - v_job.longitude)::double precision) / 2), 2)
    )));
    v_verified := v_dist <= 500;
    IF NOT v_verified THEN
      -- The distance travels in DETAIL so the app can say how far away the
      -- Helpr is. Nothing is written.
      RAISE EXCEPTION 'arrival_too_far' USING ERRCODE = '23514',
        DETAIL = 'distance_ft=' || round(v_dist)::bigint,
        HINT = 'Get within 500 ft of the job site to mark arrived.';
    END IF;
  ELSE
    -- The job itself has no coordinates, so there is nothing to check
    -- against. A real fix is the best evidence available; accept it rather
    -- than punishing the helper for the poster's address never geocoding.
    -- (Unchanged from the live definition — owner question in docs/OPEN.md.)
    v_verified := true;
  END IF;

  -- Lets the helper column whitelist admit helper_arrived_at and
  -- helper_arrival_verified_at from this ONE function. Transaction-local.
  PERFORM set_config('app.arrival_rpc', '1', true);

  UPDATE public.jobs
     SET helper_arrived_at = COALESCE(helper_arrived_at, v_now),
         helper_arrival_verified_at = COALESCE(helper_arrival_verified_at, v_now),
         status = CASE WHEN status = 'accepted' THEN 'in_progress' ELSE status END
   WHERE id = p_job_id;
  -- Drop the flag the moment its one UPDATE is done (as rpc_withdraw_dispute
  -- does with its own), so nothing later in this transaction inherits it.
  PERFORM set_config('app.arrival_rpc', '0', true);

  RETURN jsonb_build_object(
    'verified', v_verified,
    'distance_ft', CASE WHEN v_dist IS NULL THEN NULL ELSE round(v_dist::numeric) END,
    'arrived_at', v_now
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) TO authenticated, service_role;

-- 2. Whitelist: helper_arrived_at only through the arrival RPC -------------
--
-- Live body verbatim except: 'helper_arrived_at' removed from `allowed`, and
-- the app.arrival_rpc CONTINUE branch now admits it beside the verified stamp.

CREATE OR REPLACE FUNCTION public.enforce_helper_jobs_column_whitelist()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  allowed CONSTANT text[] := ARRAY[
    'status',
    'helper_confirmed_at',
    'helper_dayof_confirmed_at',
    'helper_on_the_way_at',
    'helper_completed_at',
    'proof_before_urls',
    'proof_after_urls',
    'dispute_reason',
    'dispute_evidence_urls',
    'disputed_at',
    -- Added 2026-09-05. Without this a helper cannot open a dispute at all:
    -- rpc_open_dispute stamps it in the same UPDATE as disputed_at/dispute_status.
    'disputed_by',
    'dispute_status',
    'dispute_helper_response',
    'cancelled_by',
    'cancelled_at',
    'cancellation_reason',
    'late_cancellation',
    'cancellation_fee',
    'cancellation_fee_status',
    'helper_id',
    'response_deadline',
    'updated_at'
  ];
BEGIN
  -- Only constrain the assigned helper acting on their own job. Everyone
  -- else (service role: uid NULL; poster; admin) passes through — their
  -- access is governed by RLS as before.
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF NOT (changed_col = ANY (allowed)) THEN
      -- BOTH arrival stamps are deliberately NOT in `allowed`: the only
      -- writer is public.mark_helper_arrival(), which computes the proximity
      -- verdict server-side, refuses (writing nothing) when the helper is not
      -- within 500ft, and sets this transaction-local flag. A direct PATCH
      -- from the client still hits the RAISE below. helper_arrived_at joined
      -- the verified stamp here in 20260915044137 (VN-33): while it was on the
      -- list, a helper 2000 miles away could mark themselves arrived with a
      -- plain PATCH and no location at all.
      IF changed_col IN ('helper_arrival_verified_at', 'helper_arrived_at')
         AND current_setting('app.arrival_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- The dispute-resolution stamp, same pattern and for the same reason.
      -- Its only writer is public.rpc_withdraw_dispute(), which sets this flag
      -- transaction-locally only AFTER establishing that auth.uid() is the
      -- opener_id of a live dispute on this job. Listing the column in
      -- `allowed` instead would let a helper stamp their own job resolved with
      -- a plain PATCH and skip that check entirely — which is the whole reason
      -- the RPC exists.
      IF changed_col = 'dispute_resolved_at'
         AND current_setting('app.dispute_withdraw_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Helpers may not modify jobs.% ', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- A helper may un-assign themselves (decline fallback sets helper_id NULL)
  -- but never reassign the job to another account.
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id AND NEW.helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'Helpers may only clear jobs.helper_id, not reassign it'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Completion: GPS verified AND poster confirmed -------------------------
--
-- Live body verbatim except the arrival block.

CREATE OR REPLACE FUNCTION public.enforce_helper_completion_gates()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  -- THE STATUS DOOR (VN-33 review). The whitelist allows `status` and
  -- enforce_job_status_transition allows in_progress/accepted → completed, so
  -- the assigned Helpr writing status = 'completed' directly reached a
  -- completed job with neither arrival stamp — and a completed status also
  -- takes the job out of create-payment's release and auto-release-payment,
  -- stranding the escrow. The app never writes that status as a Helpr; the
  -- one sanctioned Helpr-session writer is rpc_withdraw_dispute, which
  -- restores a completed job under its own transaction-local flag. Completion
  -- is the helper_completed_at stamp below, and money moves through
  -- create-payment.
  IF NEW.status::text = 'completed'
     AND OLD.status::text IS DISTINCT FROM 'completed'
     AND COALESCE(current_setting('app.dispute_withdraw_rpc', true), '') <> '1' THEN
    RAISE EXCEPTION 'helper_cannot_complete_by_status'
      USING ERRCODE = '42501',
            HINT = 'Mark the job complete; the job is completed when the payment is released.';
  END IF;

  IF NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL THEN
    -- ARRIVAL MUST BE ESTABLISHED, and that now takes BOTH (owner,
    -- 2026-09-14, VN-33): the server verified the helper within 500ft when
    -- they marked arrived, AND the poster tapped "Confirm They Arrived".
    -- Either one alone used to unlock this; neither does now. No grandfather
    -- clause: 0 live jobs depended on the old one when it was removed.
    IF OLD.helper_arrival_verified_at IS NULL
       OR OLD.poster_confirmed_arrival_at IS NULL THEN
      RAISE EXCEPTION 'completion_requires_confirmed_arrival'
        USING ERRCODE = '23514',
              HINT = CASE
                WHEN OLD.helper_arrival_verified_at IS NULL AND OLD.poster_confirmed_arrival_at IS NULL
                  THEN 'Both are needed: mark arrival at the job site with Location on, and the poster confirms you arrived.'
                WHEN OLD.helper_arrival_verified_at IS NULL
                  THEN 'The poster confirmed you arrived, but your location has not. Both are needed: try your location again at the job site.'
                ELSE 'Your location is confirmed. Both are needed: the poster still has to tap Confirm They Arrived.'
              END;
    END IF;

    -- Photo proof is now the POSTER'S call, per job. COALESCE to true so a row
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

-- The gate now also fires on a status write (the status door, above).
DROP TRIGGER IF EXISTS trg_helper_completion_gates ON public.jobs;
CREATE TRIGGER trg_helper_completion_gates
  BEFORE UPDATE OF helper_completed_at, status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_helper_completion_gates();

-- 4. job_tracking: the tracker cannot lead the arrival --------------------

CREATE OR REPLACE FUNCTION public.enforce_job_tracking_arrival_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs;
BEGIN
  -- Server-side writers (service role, uid NULL) are not constrained. The
  -- helper's on-the-way RPC writes 'on_the_way', which is not gated here.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- FOR SHARE: the stamps this decides from must not change under it (the
  -- race class fixed in 20260913014328). helper_mark_on_the_way holds this
  -- jobs row FOR UPDATE when it writes 'on_the_way' here; a share lock taken
  -- by the same transaction does not wait on its own row lock.
  SELECT * INTO v_job FROM public.jobs WHERE id = NEW.job_id FOR SHARE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- The row must belong to the job's assigned helper — on EVERY client write,
  -- position pings included. The INSERT policy only checks auth.uid() =
  -- helper_id, and the tracker reads the newest row per job with no helper
  -- filter, so without this a stranger could insert (or re-point an old row
  -- at) someone else's job, and a Helpr taken off a job could keep moving
  -- their old row's pin on the poster's map.
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

  IF NEW.status = 'working'
     AND v_job.helper_completed_at IS NULL
     AND (v_job.helper_arrival_verified_at IS NULL OR v_job.poster_confirmed_arrival_at IS NULL) THEN
    RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
      HINT = 'Both are needed before work starts: your location at the job site, and the poster confirming you arrived.';
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

REVOKE ALL ON FUNCTION public.enforce_job_tracking_arrival_gate() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.job_tracking') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_job_tracking_arrival_gate ON public.job_tracking;
    CREATE TRIGGER trg_job_tracking_arrival_gate
      BEFORE INSERT OR UPDATE ON public.job_tracking
      FOR EACH ROW EXECUTE FUNCTION public.enforce_job_tracking_arrival_gate();
  END IF;
END $$;

-- 5. The poster cannot write the helper's arrival stamps ------------------
--
-- Live body (md5 3727688fcc4e055f35cb105e52f1ee08) verbatim except the two
-- columns added to locked_always.

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
    'helper_arrival_verified_at'
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
  IF auth.uid() IS NULL
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
        RAISE EXCEPTION 'Posters may not modify jobs.% once checkout has opened', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

-- 6. Arrival belongs to ONE helper, and the poster confirms a real arrival --
--
-- VN-33 review: the stamps have no helper_id of their own. When a job is
-- reopened and awarded again (helper_abort_job, helper_cancel_booking,
-- decline, auto-expire; report_helper_no_show no longer can once anyone has
-- arrived — section 7) they stayed on the row, and
-- mark_helper_arrival's already-verified early return then handed the NEXT
-- helper a verified arrival with no location at all. And the poster's
-- confirmation could be written before anyone had arrived, which attests
-- nothing. Named zz_ so it runs AFTER every column-lock trigger on jobs
-- (BEFORE triggers fire in name order): those judge what the CLIENT sent,
-- and this reset is the server's own write on top.

CREATE OR REPLACE FUNCTION public.enforce_jobs_arrival_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A new (or no) helper on a job that is not finished starts with a clean
  -- arrival: nothing the previous helper earned carries over.
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id
     AND OLD.helper_completed_at IS NULL
     AND NEW.helper_completed_at IS NULL
     AND NEW.status::text IN ('open', 'accepted', 'in_progress') THEN
    NEW.helper_arrived_at := NULL;
    NEW.helper_arrival_verified_at := NULL;
    NEW.poster_confirmed_arrival_at := NULL;
    NEW.poster_confirmed_working_at := NULL;
  END IF;

  -- The poster confirms an arrival that exists. The app only shows "Confirm
  -- They Arrived" once helper_arrived_at is stamped; this makes that the rule.
  IF auth.uid() IS NOT NULL
     AND auth.uid() = OLD.customer_id
     AND NEW.poster_confirmed_arrival_at IS NOT NULL
     AND OLD.poster_confirmed_arrival_at IS NULL
     AND NEW.helper_arrived_at IS NULL THEN
    RAISE EXCEPTION 'arrival_confirm_before_arrival' USING ERRCODE = '23514',
      HINT = 'Your Helpr has not marked arrived yet.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_jobs_arrival_integrity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_jobs_arrival_integrity ON public.jobs;
CREATE TRIGGER zz_jobs_arrival_integrity
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_arrival_integrity();

-- 7. No no-show report once the Helpr has arrived --------------------------
--
-- Live body (md5 4c902d5c610fbcdd0132d052e0bd85b9, from
-- 20260831183302) verbatim except GUARD 0 and the two columns it reads under
-- the existing FOR UPDATE. CREATE OR REPLACE keeps its live ACL
-- {postgres, authenticated, service_role}; pinned below anyway.

CREATE OR REPLACE FUNCTION public.report_helper_no_show(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_helper_id uuid;
  v_job_title text;
  v_payment_status text;
  v_date_needed date;
  v_start_time time;
  v_starts_at timestamptz;
  v_prior_count int;
  v_result jsonb;
  v_arrived_at timestamptz;
  v_helper_completed_at timestamptz;
BEGIN
  -- Trusted ladder — see apply_job_denial_consequence for why this line exists.
  -- (Also releases the jobs field-lock for the server-owned unassign below.)
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Lock the job row.
  SELECT j.customer_id, j.helper_id, j.title, j.payment_status, j.date_needed, j.start_time,
         j.helper_arrived_at, j.helper_completed_at
    INTO v_customer_id, v_helper_id, v_job_title, v_payment_status, v_date_needed, v_start_time,
         v_arrived_at, v_helper_completed_at
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Only the job's poster may report a no-show.
  IF v_customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_helper_id IS NULL THEN
    RAISE EXCEPTION 'no_helper_assigned';
  END IF;

  -- GUARD 0 (20260915044137, VN-33) — a Helpr who ARRIVED did not no-show.
  -- Since that migration an arrival exists only when the server found the
  -- Helpr within 500ft, and a reopen clears the arrival stamps
  -- (zz_jobs_arrival_integrity) — so a no-show report after an arrival would
  -- both strike a Helpr who was there AND erase the evidence that they were.
  -- The app already hides No-Show once helper_arrived_at is stamped; this is
  -- the same rule on the server. A completed Helpr is refused for the same
  -- reason, and because reopening would hand their completion to the next one.
  IF v_arrived_at IS NOT NULL OR v_helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'helper_already_arrived'
      USING HINT = 'The Helpr marked arrived on this job, so it cannot be reported as a no-show.';
  END IF;

  -- GUARD 1 — the job must be funded. Closes the throwaway-job ban attack.
  IF v_payment_status IS NULL OR v_payment_status = 'unpaid' THEN
    RAISE EXCEPTION 'job_not_funded'
      USING HINT = 'A no-show can only be reported on a funded job.';
  END IF;

  -- GUARD 2 — the scheduled start must have passed.
  v_starts_at := (v_date_needed + COALESCE(v_start_time, '00:00'::time))
                   AT TIME ZONE 'America/Chicago';
  IF v_starts_at IS NULL OR now() < v_starts_at THEN
    RAISE EXCEPTION 'job_not_started'
      USING HINT = 'Wait until the scheduled start time before reporting a no-show.';
  END IF;

  -- GUARD 3a — one report per job.
  IF EXISTS (
    SELECT 1 FROM public.user_violations
    WHERE job_id = p_job_id AND violation_type = 'no_show'
  ) THEN
    RAISE EXCEPTION 'already_reported'
      USING HINT = 'This job already has a no-show report.';
  END IF;

  -- GUARD 3b — escalate on DISTINCT reporters, so one poster acting alone
  -- can warn but never reach the top rung.
  SELECT count(DISTINCT reported_by) INTO v_prior_count
  FROM public.user_violations
  WHERE user_id = v_helper_id
    AND violation_type = 'no_show'
    AND reported_by IS DISTINCT FROM auth.uid();

  -- The ladder itself is no longer written here. Same core, same policy switch
  -- as the other three wrappers: 'permanent' + p_permanent_requires_review
  -- becomes 'review' — a reversible 7-day restriction plus an admin case.
  v_result := public.apply_consequence_ladder(
    p_user                      => v_helper_id,
    p_violation_type            => 'no_show',
    p_description               => 'No-show for job: ' || COALESCE(v_job_title, 'Unknown'),
    p_job_id                    => p_job_id,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['warning', 'pending_ban_review'],
    p_effects                   => ARRAY['final_warning', 'permanent'],
    -- No Helpr-facing copy from the core: the client already sends exactly one
    -- notification for this event (see the header). Casts are required —
    -- jsonb_build_array is VARIADIC "any" and cannot resolve a bare NULL.
    p_copy                      => jsonb_build_array(null::jsonb, null::jsonb),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => true,
    p_admin_message_format      => '%s has %s no-show reports on file from different posters and is restricted for 7 days pending your decision.',
    -- Unused while p_permanent_requires_review is true; kept verbatim from the
    -- old direct-ban path so that path stays fully specified if the policy is
    -- ever revisited.
    p_ban_reason                => 'Repeated no-show violations'
  );

  -- ATTRIBUTION. The shared core does not know about `reported_by` — it is a
  -- column only the no-show ladder uses, and it is load-bearing: GUARD 3b
  -- counts DISTINCT reporters, and count(DISTINCT reported_by) ignores NULLs,
  -- so an unstamped row would make every future no-show look like a first
  -- offence and the ladder would never escalate at all. GUARD 3a proved above
  -- that this job had NO no_show row before the core inserted one, so this
  -- matches exactly the row just written.
  UPDATE public.user_violations
     SET reported_by = auth.uid()
   WHERE job_id = p_job_id
     AND violation_type = 'no_show'
     AND reported_by IS NULL;

  -- Reopen the job so the poster can pick another applicant.
  UPDATE public.jobs SET status = 'open', helper_id = NULL WHERE id = p_job_id;

  -- Return shape unchanged: the core supplies {action, prior_count}, and the
  -- two fields the client reads for its own notifications are merged back on.
  RETURN v_result || jsonb_build_object(
    'helper_id', v_helper_id,
    'job_title', v_job_title
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.report_helper_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_helper_no_show(uuid) TO authenticated, service_role;
