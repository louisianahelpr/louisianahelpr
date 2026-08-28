-- Verified arrival, and completion gated on it.
--
-- WHAT WAS WRONG. `public.job_checkins` has zero writers (0 rows in prod on
-- 2026-08-27). Two things leaned on it anyway:
--   * completeJob's "or a verified arrival check-in" fallback, reached when
--     the live 500ft GPS check fails at COMPLETION time. It can never
--     succeed, so a helper with poor/denied GPS at wrap-up time — indoors, in
--     their van, on a large site — was hard-blocked from the write that gets
--     them paid, and told to use a "Check In with Photo" control that does
--     not exist.
--   * the poster's "Confirm Start" button, gated on
--     `job_checkins.type = 'start_request'` — unreachable app-wide.
--
-- WHAT REPLACES IT. Arrival becomes a first-class, two-party event on the
-- jobs row itself (one ladder, not two):
--   * `helper_arrival_verified_at` — stamped ONLY by mark_helper_arrival()
--     below, and only when the server itself computed the helper within 500ft
--     of the job site. The client sends coordinates; it does not get to send
--     the verdict, and the column is not in the helper's write whitelist, so
--     there is no client path that sets it directly.
--   * `poster_confirmed_arrival_at` — already existed, already written by the
--     poster's "Confirm They Arrived" tap. It is now load-bearing: it is the
--     RECOURSE PATH for a helper whose GPS legitimately fails. A poster who
--     can see the helper standing in front of them can vouch, and that vouch
--     satisfies the completion gate on its own.
--   * `helper_arrived_at` stays the CLAIM. A helper with no fix can still say
--     "I'm here" (the poster needs to know), but a bare claim no longer
--     unlocks completion by itself.
--
-- Completion therefore gates on "arrival was established" (server-verified
-- GPS, or the poster's vouch) rather than on a fresh proximity check at
-- completion time. That is stronger evidence AND less brittle: stepping away
-- from the site at the end of a job is normal and is not evidence of fraud.
--
-- SCOPED TO NEW TRANSITIONS. This is a trigger on the completion write, not a
-- CHECK constraint, so no existing row is validated. In-flight jobs that
-- already carry a bare `helper_arrived_at` (9 of the 11 arrivals in prod have
-- no `helper_on_the_way_at` at all) are grandfathered by the cutoff below, so
-- nobody mid-job is stranded by the deploy.
--
-- REPLAY-SAFETY: only ADD COLUMN IF NOT EXISTS and CREATE OR REPLACE, all
-- against `public.jobs`, which exists from the initial schema. No reference
-- to any object defined by a later migration.

-- 1. The verified-arrival stamp -------------------------------------------

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS helper_arrival_verified_at timestamptz;

COMMENT ON COLUMN public.jobs.helper_arrival_verified_at IS
  'Set only by public.mark_helper_arrival() when the server computed the helper within 500ft of the job site. Never client-writable.';

-- 2. Server-side proximity check ------------------------------------------
--
-- SECURITY DEFINER so the distance math is the server''s, not the client''s.
-- The client can still lie about its coordinates (true of any GPS check
-- without hardware attestation) but it cannot lie about the VERDICT, which is
-- what the completion gate reads.

CREATE OR REPLACE FUNCTION public.mark_helper_arrival(
  p_job_id uuid,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs;
  v_dist double precision;
  v_verified boolean := false;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
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

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    IF v_job.latitude IS NOT NULL AND v_job.longitude IS NOT NULL THEN
      -- Haversine, in feet (earth radius 20 902 231 ft) — same 500ft
      -- threshold the client shows.
      v_dist := 20902231 * 2 * asin(sqrt(
        power(sin(radians((p_lat - v_job.latitude)::double precision) / 2), 2)
        + cos(radians(v_job.latitude::double precision))
          * cos(radians(p_lat::double precision))
          * power(sin(radians((p_lng - v_job.longitude)::double precision) / 2), 2)
      ));
      v_verified := v_dist <= 500;
    ELSE
      -- The job itself has no coordinates, so there is nothing to check
      -- against. A real fix is the best evidence available; accept it rather
      -- than punishing the helper for the poster's address never geocoding.
      v_verified := true;
    END IF;
  END IF;

  -- Lets the helper column whitelist below admit this ONE column from this
  -- ONE function. Transaction-local (third arg true).
  PERFORM set_config('app.arrival_rpc', '1', true);

  UPDATE public.jobs
     SET helper_arrived_at = COALESCE(helper_arrived_at, v_now),
         helper_arrival_verified_at = CASE
           WHEN v_verified THEN COALESCE(helper_arrival_verified_at, v_now)
           ELSE helper_arrival_verified_at
         END,
         status = CASE WHEN status = 'accepted' THEN 'in_progress' ELSE status END
   WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'verified', v_verified,
    'distance_ft', CASE WHEN v_dist IS NULL THEN NULL ELSE round(v_dist::numeric) END,
    'arrived_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) FROM public;
REVOKE ALL ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) TO authenticated;

-- 3. Whitelist: admit helper_arrival_verified_at ONLY from that function ---
--
-- Byte-identical to 20260824233000 apart from the CONTINUE branch, so a diff
-- of the two shows exactly the change.

CREATE OR REPLACE FUNCTION public.enforce_helper_jobs_column_whitelist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  changed_col text;
  allowed CONSTANT text[] := ARRAY[
    'status',
    'helper_confirmed_at',
    'helper_dayof_confirmed_at',
    'helper_on_the_way_at',
    'helper_arrived_at',
    'helper_completed_at',
    'proof_before_urls',
    'proof_after_urls',
    'dispute_reason',
    'dispute_evidence_urls',
    'disputed_at',
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
      -- The verified-arrival stamp is deliberately NOT in `allowed`: the only
      -- writer is public.mark_helper_arrival(), which computes the proximity
      -- verdict server-side and sets this transaction-local flag. A direct
      -- PATCH from the client still hits the RAISE below.
      IF changed_col = 'helper_arrival_verified_at'
         AND current_setting('app.arrival_rpc', true) = '1' THEN
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
$$;

-- 4. Completion gates: add "arrival was established" -----------------------
--
-- Byte-identical to 20260824235000 apart from the new first block.

CREATE OR REPLACE FUNCTION public.enforce_helper_completion_gates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL THEN
    -- ARRIVAL MUST BE ESTABLISHED. Either the server verified the helper was
    -- within 500ft when they marked arrived, or the poster vouched for them.
    -- Grandfathered for jobs that were already underway when this shipped —
    -- those helpers marked arrival under the old rules and must not be
    -- stranded mid-job by a deploy.
    IF OLD.helper_arrival_verified_at IS NULL
       AND OLD.poster_confirmed_arrival_at IS NULL
       AND NOT (OLD.helper_arrived_at IS NOT NULL
                AND OLD.helper_arrived_at < timestamptz '2026-08-28 00:00:00+00') THEN
      RAISE EXCEPTION 'completion_requires_confirmed_arrival'
        USING ERRCODE = '23514',
              HINT = 'Mark arrival at the job site, or ask the poster to confirm you arrived.';
    END IF;

    IF COALESCE(array_length(NEW.proof_before_urls, 1), 0) = 0
       OR COALESCE(array_length(NEW.proof_after_urls, 1), 0) = 0 THEN
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
$$;
