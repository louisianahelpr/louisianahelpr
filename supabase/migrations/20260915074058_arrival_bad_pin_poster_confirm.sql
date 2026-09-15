-- VN-33(b) — the poster's "Confirm They Arrived" counts when the job's MAP PIN is
-- wrong: a Helpr refused as too far, but within a mile, becomes arrived once
-- the poster (who is standing at the real door) confirms.
--
-- WHY. 20260915044137 made arrival need BOTH the server's 500ft GPS check AND
-- the poster's tap, with no fallback. A job's coordinates are one geocode of
-- the address; when that pin lands more than 500ft from the actual door, a
-- Helpr who IS there is refused every time, and the poster never even sees the
-- Confirm button (it appears only once helper_arrived_at exists). Owner,
-- 2026-09-14 (pop-up): "Poster can confirm anyway — let the poster's Confirm
-- They Arrived work even when the Helpr's GPS check failed, for that case only".
--
-- THE NARROW CASE, and nothing wider:
--   1. mark_helper_arrival computes the Helpr more than 500ft but at most
--      BAD_PIN_MAX_FT (5280 ft, one mile) from the job pin. Instead of raising
--      (a RAISE would roll back any record of the attempt) it stamps
--      helper_arrival_near_miss_at / _ft, tells the poster, and RETURNS
--      {verified:false, reason:'arrival_too_far', distance_ft,
--      poster_can_confirm:true}. It writes NO arrival stamp. Further than a
--      mile, no fix, or a bad fix: refused exactly as before.
--   2. The poster may confirm an arrival that has no helper_arrived_at ONLY
--      when a near miss by the CURRENT Helpr was recorded in the last 12 hours.
--      That confirmation stamps helper_arrived_at (the poster's attestation is
--      the arrival). helper_arrival_verified_at stays NULL, so the row always
--      tells an admin the GPS never passed.
--   3. Arrival is established when the poster confirmed AND (the GPS verified
--      OR a near miss was recorded) — in enforce_helper_completion_gates, in
--      the job_tracking Working gate, and (in TypeScript) in the shared
--      arrivalRule used by the app and create-payment. A near miss alone,
--      with no poster tap, unlocks nothing.
--   4. The two new columns are server-owned: the Helpr whitelist admits them
--      only under mark_helper_arrival's app.arrival_rpc flag; the poster lock
--      and the insert lock refuse / clear them; a change of Helpr clears them.
--
-- Bodies rebuilt from 20260915044137, whose function sources match live prod
-- byte for byte (md5(prosrc) checked 2026-09-15: mark_helper_arrival
-- 6d1b9df8…, enforce_helper_jobs_column_whitelist 3670e25c…,
-- enforce_helper_completion_gates d0656373…, enforce_job_tracking_arrival_gate
-- 162b76f2…, enforce_poster_jobs_money_lock 98e3343f…,
-- enforce_jobs_arrival_integrity a4179932…) and enforce_jobs_insert_column_lock
-- from its live definition (2a08f7b2…). Proof:
-- scripts/probes/arrival-bad-pin.probe.mjs.
--
--   5. report_helper_no_show refuses while a near miss from the last 12 hours
--      is pending (section 8), and gets back 20260915044137's arrived guard,
--      which prod lost to an out-of-order apply (see section 8).
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE for every
-- function; triggers are unchanged (same names, same functions). Grants are
-- restated as live.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_ft integer;

-- Column-level SELECT on jobs (20260915045110): a new column has no grant for
-- authenticated until the grants are re-derived. Parties read these two to
-- show the poster's Confirm button and the Helpr's message.
DO $$
BEGIN
  IF to_regprocedure('public.sync_jobs_select_grants()') IS NOT NULL THEN
    PERFORM public.sync_jobs_select_grants();
  END IF;
END $$;

COMMENT ON COLUMN public.jobs.helper_arrival_near_miss_at IS
  'Last time mark_helper_arrival found the assigned Helpr >500ft but <=1 mile from the pin (VN-33b). Server-owned.';


-- 1. mark_helper_arrival: record a within-a-mile near miss ---------------

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

  -- VN-33(b): the poster already confirmed a near-miss arrival. Arrival is
  -- established by that attestation; a retry must not re-measure against a pin
  -- known to be wrong. No write.
  IF v_job.poster_confirmed_arrival_at IS NOT NULL
     AND v_job.helper_arrival_near_miss_at IS NOT NULL
     AND v_job.helper_arrived_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'verified', false,
      'arrival_established', true,
      'basis', 'poster_confirmed_bad_pin',
      'distance_ft', v_job.helper_arrival_near_miss_ft,
      'arrived_at', v_job.helper_arrived_at
    );
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
    IF NOT v_verified AND v_dist <= 5280 THEN
      -- VN-33(b) BAD PIN. Within a mile: record the near miss (no arrival
      -- stamp), tell the poster, and RETURN — a RAISE would roll the record
      -- back. The poster's Confirm They Arrived now counts for this Helpr.
      PERFORM set_config('app.arrival_rpc', '1', true);
      UPDATE public.jobs
         SET helper_arrival_near_miss_at = v_now,
             helper_arrival_near_miss_ft = round(v_dist)::integer
       WHERE id = p_job_id;
      PERFORM set_config('app.arrival_rpc', '0', true);
      -- One notice per half hour, however often the Helpr retries.
      IF v_job.customer_id IS NOT NULL
         AND (v_job.helper_arrival_near_miss_at IS NULL
              OR v_job.helper_arrival_near_miss_at < v_now - interval '30 minutes') THEN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (
          v_job.customer_id,
          'Is your Helpr at the door?',
          '"' || v_job.title || '" — their location is ' || round(v_dist)::bigint
            || ' ft from the map pin. If they are there, tap Confirm They Arrived.',
          'job_updates',
          '/my-posts?job=' || p_job_id
        );
      END IF;
      RETURN jsonb_build_object(
        'verified', false,
        'reason', 'arrival_too_far',
        'distance_ft', round(v_dist::numeric),
        'poster_can_confirm', true
      );
    END IF;
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


-- 2. Helper whitelist: near-miss columns only via the arrival RPC ---------

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
      IF changed_col IN ('helper_arrival_verified_at', 'helper_arrived_at',
                         'helper_arrival_near_miss_at', 'helper_arrival_near_miss_ft')
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


-- 3. Completion: poster confirmed AND (GPS verified OR near miss) ---------

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
    -- VN-33(b): a recorded within-a-mile near miss stands in for the GPS half,
    -- but only beside the poster's confirmation.
    IF (OLD.helper_arrival_verified_at IS NULL AND OLD.helper_arrival_near_miss_at IS NULL)
       OR OLD.poster_confirmed_arrival_at IS NULL THEN
      RAISE EXCEPTION 'completion_requires_confirmed_arrival'
        USING ERRCODE = '23514',
              HINT = CASE
                WHEN OLD.helper_arrival_near_miss_at IS NOT NULL AND OLD.poster_confirmed_arrival_at IS NULL
                  THEN 'Your location was a little way from the job''s map pin. The person who posted this job needs to tap Confirm They Arrived first.'
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


-- Restated unchanged (same name, same columns) so this file carries the whole
-- completion gate, trigger included.
DROP TRIGGER IF EXISTS trg_helper_completion_gates ON public.jobs;
CREATE TRIGGER trg_helper_completion_gates
  BEFORE UPDATE OF helper_completed_at, status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_helper_completion_gates();

-- 4. Tracker Working gate: same rule -------------------------------------

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
     AND ((v_job.helper_arrival_verified_at IS NULL AND v_job.helper_arrival_near_miss_at IS NULL)
          OR v_job.poster_confirmed_arrival_at IS NULL) THEN
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


-- 5. Poster lock: near-miss columns ------------------------------------

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


-- 6. Poster confirms a near-miss arrival ---------------------------------

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
    NEW.helper_arrival_near_miss_at := NULL;
    NEW.helper_arrival_near_miss_ft := NULL;
  END IF;

  -- The poster confirms an arrival that exists. The app only shows "Confirm
  -- They Arrived" once helper_arrived_at is stamped; this makes that the rule.
  IF auth.uid() IS NOT NULL
     AND auth.uid() = OLD.customer_id
     AND NEW.poster_confirmed_arrival_at IS NOT NULL
     AND OLD.poster_confirmed_arrival_at IS NULL
     AND NEW.helper_arrived_at IS NULL THEN
    -- VN-33(b) BAD PIN: the current Helpr was refused as too far, but within a
    -- mile, in the last 12 hours. The poster at the real door attests the
    -- arrival; that confirmation IS the arrival. helper_arrival_verified_at is
    -- left NULL on purpose, so the row still shows the GPS never passed.
    IF NEW.helper_id IS NOT DISTINCT FROM OLD.helper_id
       AND OLD.helper_id IS NOT NULL
       AND OLD.helper_arrival_near_miss_at IS NOT NULL
       AND OLD.helper_arrival_near_miss_at > now() - interval '12 hours'
       AND OLD.status::text IN ('accepted', 'in_progress')
       AND NEW.status::text IN ('accepted', 'in_progress') THEN
      NEW.helper_arrived_at := now();
    ELSE
      RAISE EXCEPTION 'arrival_confirm_before_arrival' USING ERRCODE = '23514',
        HINT = 'Your Helpr has not marked arrived yet.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_jobs_arrival_integrity() FROM PUBLIC, anon, authenticated;

-- 7. Insert lock: a new job carries no near miss --------------------------
--
-- Live body (md5 2a08f7b27410b54d5b5fc392e60708f8) verbatim except the two
-- near-miss columns added to the lifecycle stamps it clears.

CREATE OR REPLACE FUNCTION public.enforce_jobs_insert_column_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Service role (uid NULL) and anyone not inserting their own job pass
  -- through untouched. Same gate as the UPDATE money lock.
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  -- Escrow state is the webhook's to set, never the poster's.
  NEW.payment_status           := 'unpaid';
  NEW.stripe_payment_intent_id := NULL;
  NEW.stripe_session_id        := NULL;

  -- Paid placement is create-boost-payment's to grant.
  NEW.boosted_at               := NULL;
  NEW.boost_expires_at         := NULL;

  -- Fixture flag: still not the poster's to set — whatever they sent is
  -- discarded — but the answer is now DERIVED from the posting account
  -- rather than hardcoded false. A fixture account's jobs are fixture jobs;
  -- a real account's jobs cannot be hidden, because profiles.is_seed is
  -- itself locked by prevent_self_escalation.
  NEW.is_seed                  := EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = NEW.customer_id
       AND p.is_seed
  );

  -- A new job is open and unassigned. Assignment happens on UPDATE, through
  -- accept_application / the direct-offer flow; a direct offer at post time
  -- uses offered_to_helper_id, which is deliberately left writable.
  NEW.status                   := 'open';
  NEW.helper_id                := NULL;

  -- A brand-new job has lived through none of its own lifecycle. Every one
  -- of these can only be set legitimately by the corresponding server-side
  -- action AFTER a helper is actually hired (accept_application,
  -- mark_helper_arrival, the on-my-way/arrived RPCs, the completion RPCs) —
  -- none of that can have happened yet to a row that does not exist until
  -- this statement returns.
  NEW.helper_confirmed_at         := NULL;
  NEW.helper_on_the_way_at        := NULL;
  NEW.helper_arrived_at           := NULL;
  NEW.helper_arrival_verified_at  := NULL;
  NEW.helper_arrival_near_miss_at := NULL;
  NEW.helper_arrival_near_miss_ft := NULL;
  NEW.poster_confirmed_at         := NULL;
  NEW.helper_completed_at         := NULL;
  NEW.poster_completed_at         := NULL;
  NEW.payout_scheduled_at         := NULL;

  RETURN NEW;
END;
$function$;


-- 8. No-show: not while a near miss is pending, and restore GUARD 0 --------
--
-- DRIFT FOUND 2026-09-15. Live report_helper_no_show (md5 dd3e9f2f…) is the
-- body from 20260914215112 — it refuses a completed Helpr (helper_marked_done)
-- but NOT an arrived one. 20260915044137's GUARD 0 ('helper_already_arrived')
-- is in the repo and its version is recorded as applied, yet the function it
-- defines is not what runs: 20260914215112 carries an older timestamp but was
-- applied after it and replaced the body. So on prod today a poster can still
-- report a no-show on a Helpr who ARRIVED (GPS-verified), striking them and
-- clearing the arrival stamps. This restates 20260915044137's body (GUARD 0
-- covers the completed case too) and adds GUARD 0b for a pending near miss.
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
  v_near_miss_at timestamptz;
BEGIN
  -- Trusted ladder — see apply_job_denial_consequence for why this line exists.
  -- (Also releases the jobs field-lock for the server-owned unassign below.)
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Lock the job row.
  SELECT j.customer_id, j.helper_id, j.title, j.payment_status, j.date_needed, j.start_time,
         j.helper_arrived_at, j.helper_completed_at, j.helper_arrival_near_miss_at
    INTO v_customer_id, v_helper_id, v_job_title, v_payment_status, v_date_needed, v_start_time,
         v_arrived_at, v_helper_completed_at, v_near_miss_at
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

  -- GUARD 0b (20260915074058, VN-33(b)) — a Helpr whose location was recorded
  -- within a mile of the pin in the last 12 hours may be at the real door of a
  -- wrong pin. The reopen below would strike them AND clear the near-miss
  -- record (zz_jobs_arrival_integrity), erasing the only evidence they came.
  -- The poster confirms the arrival or asks support; after 12 hours, with no
  -- confirmation, the report is allowed again.
  IF v_near_miss_at IS NOT NULL AND v_near_miss_at > now() - interval '12 hours' THEN
    RAISE EXCEPTION 'helper_near_miss_pending'
      USING HINT = 'Your Helpr checked in near the job, a little way from its map pin. If they are there, tap Confirm They Arrived; if not, contact support.';
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
