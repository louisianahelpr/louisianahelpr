-- PER-MEMBER LIFECYCLE ON THE GROUP ROSTER — breakage (b) of src/lib/groupJobs.ts.
--
-- OWNER DECISION, 2026-09-19: "Build it properly — move lifecycle onto the
-- roster." With the two semantics that follow from it:
--   1. COMPLETION. The JOB is done when EVERY Helpr marks their own part done.
--      Each crew member arrives and completes independently; the job finishes
--      when the last one does.
--   2. PAYOUT. An even split across the crew. (The "each share releases on its
--      own member's completion" half of that decision is NOT in this migration
--      — see THE PAYOUT LINE below. This file stops at the job-level roll-up,
--      which the existing fan-out already pays correctly and evenly.)
--
-- ── THE PROBLEM THIS FILE EXISTS FOR ────────────────────────────────────────
--
-- `jobs` carries SCALAR helper_confirmed_at / helper_on_the_way_at /
-- helper_arrived_at / helper_arrival_verified_at / helper_completed_at. The
-- schema cannot represent N arrivals or N completions, so crew members 2..N —
-- who are on `group_job_helpers` but are not `jobs.helper_id` — have nowhere to
-- record that they turned up or finished, and every lifecycle RPC refuses them
-- with `not_the_assigned_helper`.
--
-- ── THE TRAP, AND WHY THIS IS NOT A POLICY CHANGE ───────────────────────────
--
-- The obvious "fix" is to widen `jobs`' UPDATE policy from
-- `USING (auth.uid() = helper_id)` to the roster. DO NOT. Both
-- `enforce_helper_completion_gates` and `enforce_helper_jobs_column_whitelist`
-- (20260828011057) early-return on `auth.uid() IS DISTINCT FROM OLD.helper_id`.
-- A roster member is, by definition, distinct from OLD.helper_id on every job
-- but their own lead slot — so widening the policy hands members 2..N a job row
-- with NO completion gate and NO column whitelist at all: complete with no
-- confirmed arrival, no proof photos and no 30-minute floor, and write
-- arbitrary `jobs` columns on the way past. That trades a lockout for an escrow
-- hole.
--
-- So the `jobs` UPDATE policy is NOT touched here, and neither are those two
-- triggers' early returns. Members 2..N never write `jobs` at all. Their
-- lifecycle lives on their OWN `group_job_helpers` row, and the gates that
-- protect it are properties of THE ROW, not of who is writing — which is what
-- "the gates apply per member" means below: there is no
-- `auth.uid() = OLD.helper_id` test anywhere in
-- `enforce_group_member_completion_gates`, so it cannot be walked past by
-- being someone else.
--
-- ── THE ARRIVAL RULE THIS FOLLOWS ───────────────────────────────────────────
--
-- 20260919155016 (today) reversed VN-33 for single-helper jobs: a Helpr may
-- ALWAYS record an arrival, GPS is EVIDENCE rather than a gate, and
-- `poster_confirmed_arrival_at` is THE gate in every case. The per-member model
-- follows that rule and not the old one: `rpc_group_member_mark_arrival` never
-- raises for a far or fix-less location, and
-- `enforce_group_member_completion_gates` reads exactly one arrival predicate —
-- the poster's confirmation of THAT MEMBER.
--
-- ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
--
-- * `GROUP_JOBS_ENABLED` stays false and `reject_new_group_jobs` stays
--   installed. This is the data model, not the feature.
-- * Breakage (d) — reviews — is untouched: `reviews` still carries
--   UNIQUE (job_id, reviewer_id), so a poster still gets exactly ONE review per
--   job however many people worked it. Changing that changes the trust ladder,
--   the tier calculation, the double-blind reveal and the review-nag cron, and
--   is an owner decision, not a schema detail.
-- * THE PAYOUT LINE. `process-scheduled-payouts` ALREADY fans a group job's
--   escrow across the roster — one transfer, one idempotency key and one ledger
--   row per member, each `budget / helpers_needed`, holding the job in
--   payout_pending until every member is settled — and `release-payout`,
--   `create-payment`'s admin_release_dispute and `execute-dispute-split` all
--   refuse a multi-member roster rather than pay 1-of-N. The even split is
--   therefore already correct and already even; what this migration adds is the
--   roll-up that lets a group job REACH that pipeline honestly (semantic 1).
--   Releasing each member's share on their OWN completion (semantic 2) requires
--   per-member payout state and changes to create-payment /
--   auto-release-payment / release-payout / process-scheduled-payouts, and is
--   reported as a design rather than half-built here.
--
-- ── REPLAY-SAFETY ───────────────────────────────────────────────────────────
--
-- Every statement is ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS + CREATE TRIGGER, and the
-- REVOKE/GRANT block is guarded on `to_regprocedure(...) IS NOT NULL`. Applying
-- this file three times in a row is a no-op after the first.
--
-- `enforce_helper_completion_gates` is restated VERBATIM from prod
-- (pg_get_functiondef, read 2026-09-19) with ONE addition, conjoined on
-- `OLD.is_group_job IS TRUE`, so the single-helper path it governs — every real
-- job on prod today — cannot reach the new branch at all.

-- ── 1. THE COLUMNS ──────────────────────────────────────────────────────────
-- A per-member mirror of the `jobs` scalars the gates read, plus per-member
-- proof arrays: "each Helpr marks their own part done" means each Helpr's part
-- carries its own before/after evidence, not a shared job-level pair that the
-- first member to upload satisfies for everyone.
ALTER TABLE public.group_job_helpers
  ADD COLUMN IF NOT EXISTS helper_confirmed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS helper_dayof_confirmed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS helper_on_the_way_at           timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrived_at              timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrival_verified_at     timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_at    timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_ft    integer,
  ADD COLUMN IF NOT EXISTS poster_confirmed_arrival_at    timestamptz,
  ADD COLUMN IF NOT EXISTS poster_confirmed_working_at    timestamptz,
  ADD COLUMN IF NOT EXISTS helper_completed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS poster_confirmed_completion_at timestamptz,
  ADD COLUMN IF NOT EXISTS proof_before_urls              text[],
  ADD COLUMN IF NOT EXISTS proof_after_urls               text[];

COMMENT ON COLUMN public.group_job_helpers.helper_completed_at IS
  'Per-member completion. The JOB completes (jobs.helper_completed_at) only when every roster row carries this stamp — owner semantic 1, 2026-09-19. Server-owned: the only writer is rpc_group_member_mark_done.';

-- "Is anyone on this job still unfinished?" is the roll-up's hot question.
CREATE INDEX IF NOT EXISTS idx_group_job_helpers_job_unfinished
  ON public.group_job_helpers (job_id)
  WHERE helper_completed_at IS NULL;

-- ── 2. THE LIFECYCLE COLUMNS ARE SERVER-OWNED ───────────────────────────────
-- The same rule and the same mechanism as `enforce_job_completion_server_owned`
-- (H-001, 20260915073143) applies to `jobs.helper_completed_at`: the stamps
-- that enter a member into the payout pipeline are never written by a client
-- PATCH, only by the definer RPCs below. This is what makes the gate in §3
-- unbypassable — there is no second door into these columns.
--
-- NOT SECURITY DEFINER, on purpose: current_user is the CALLER's role. Inside a
-- SECURITY DEFINER RPC owned by postgres it reads `postgres`; the service key
-- reads `service_role`; cron reads `postgres`. Only a direct client write reads
-- `authenticated` / `anon`.
CREATE OR REPLACE FUNCTION public.enforce_group_member_lifecycle_server_owned()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  server_owned CONSTANT text[] := ARRAY[
    'helper_confirmed_at',
    'helper_dayof_confirmed_at',
    'helper_on_the_way_at',
    'helper_arrived_at',
    'helper_arrival_verified_at',
    'helper_arrival_near_miss_at',
    'helper_arrival_near_miss_ft',
    'poster_confirmed_arrival_at',
    'poster_confirmed_working_at',
    'helper_completed_at',
    'poster_confirmed_completion_at',
    'proof_before_urls',
    'proof_after_urls'
  ];
BEGIN
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- A roster row is never born mid-lifecycle. Cleared rather than refused, the
  -- same way enforce_jobs_insert_column_lock clears the job's stamps.
  IF TG_OP = 'INSERT' THEN
    NEW.helper_confirmed_at            := NULL;
    NEW.helper_dayof_confirmed_at      := NULL;
    NEW.helper_on_the_way_at           := NULL;
    NEW.helper_arrived_at              := NULL;
    NEW.helper_arrival_verified_at     := NULL;
    NEW.helper_arrival_near_miss_at    := NULL;
    NEW.helper_arrival_near_miss_ft    := NULL;
    NEW.poster_confirmed_arrival_at    := NULL;
    NEW.poster_confirmed_working_at    := NULL;
    NEW.helper_completed_at            := NULL;
    NEW.poster_confirmed_completion_at := NULL;
    NEW.proof_before_urls              := NULL;
    NEW.proof_after_urls               := NULL;
    RETURN NEW;
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (server_owned) THEN
      RAISE EXCEPTION 'group_job_helpers.% is stamped by the server, not by the client (job_id=%)', changed_col, OLD.job_id
        USING ERRCODE = '42501',
              HINT = 'Use the crew lifecycle RPCs; these stamps are the server clock and cannot be set directly.';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zza_group_member_lifecycle_server_owned ON public.group_job_helpers;
CREATE TRIGGER zza_group_member_lifecycle_server_owned
  BEFORE INSERT OR UPDATE ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_member_lifecycle_server_owned();

-- ── 3. THE COMPLETION GATES, PER MEMBER ─────────────────────────────────────
-- The three gates `enforce_helper_completion_gates` applies to the assigned
-- Helpr, applied to EACH roster member's own row and own stamps.
--
-- THE DIFFERENCE THAT MATTERS: there is no `auth.uid() IS DISTINCT FROM
-- OLD.helper_id` early return here. That test is what makes the `jobs` triggers
-- unusable for a crew — it waves through everyone who is not the one scalar
-- helper. This gate is a property of the ROW being completed, so it fires for
-- the lead, for member 2, for member N, and for a definer RPC acting on any of
-- their behalf, identically. Only a true server context (migration, cron,
-- service key with no uid) passes, matching the sibling triggers on `jobs`.
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
  IF NEW.poster_confirmed_arrival_at IS NULL THEN
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

DROP TRIGGER IF EXISTS zzb_group_member_completion_gates ON public.group_job_helpers;
CREATE TRIGGER zzb_group_member_completion_gates
  BEFORE UPDATE OF helper_completed_at ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_member_completion_gates();

-- A member's completion, like a job's, is not un-doable by an end user.
CREATE OR REPLACE FUNCTION public.enforce_group_member_completion_not_clearable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.helper_completed_at IS NOT NULL
     AND NEW.helper_completed_at IS NULL
     AND NOT public.is_server_context() THEN
    RAISE EXCEPTION 'group_member_completed_at_not_clearable'
      USING ERRCODE = '42501',
            HINT = 'A part marked done stays marked done. Ask for a change or open a dispute instead.';
  END IF;
  -- A second Done keeps the FIRST stamp, idempotently.
  IF OLD.helper_completed_at IS NOT NULL
     AND NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at
     AND NOT public.is_server_context() THEN
    NEW.helper_completed_at := OLD.helper_completed_at;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzc_group_member_completion_not_clearable ON public.group_job_helpers;
CREATE TRIGGER zzc_group_member_completion_not_clearable
  BEFORE UPDATE OF helper_completed_at ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_member_completion_not_clearable();

-- ── 4. WHO IS ON THE CREW ───────────────────────────────────────────────────
-- One place that answers "may this account act as a crew member on this job",
-- so the RPCs below cannot drift apart. Returns the roster row id, or NULL.
CREATE OR REPLACE FUNCTION public.group_member_slot(_job_id uuid, _user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT g.id
  FROM public.group_job_helpers g
  WHERE g.job_id = _job_id
    AND _user_id IS NOT NULL
    AND g.helper_id = _user_id
  LIMIT 1;
$function$;

-- ── 5. THE MEMBER RPCs ──────────────────────────────────────────────────────
-- Mirrors of helper_mark_on_the_way / mark_helper_arrival / rpc_helper_mark_done
-- that resolve the actor against the ROSTER instead of `jobs.helper_id`. Each
-- is SECURITY DEFINER with a pinned search_path, each locks the roster row
-- FOR UPDATE so a double tap cannot run two stamps, and each leaves the §3
-- trigger authoritative: the checks inside give a clean, specific refusal, and
-- if the two ever drift the trigger still fails closed.

CREATE OR REPLACE FUNCTION public.rpc_group_member_confirm(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
  v_row record;
  v_status text;
  v_now timestamptz := now();
  v_stamp timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_slot := public.group_member_slot(_job_id, v_uid);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.group_job_helpers WHERE id = v_slot FOR UPDATE;
  SELECT j.status::text INTO v_status FROM public.jobs j WHERE j.id = _job_id;

  -- `in_progress` is admitted here and is NOT admitted by the single-helper
  -- `enforce_confirm_on_live_job`, on purpose. `jobs.status` on a crew job is a
  -- CREW-WIDE aggregate: the first member to set out flips it to in_progress
  -- (rpc_group_member_on_the_way, below). Judging a member's own confirmation
  -- against it would mean a slower crew member is locked out of confirming
  -- their slot by a colleague's departure — the same class of deadlock the
  -- 2026-09-19 arrival reversal removed. A member's confirmation is judged
  -- against their OWN slot; the job only has to still be live.
  IF v_status IS NULL OR v_status NOT IN ('open', 'accepted', 'in_progress') THEN
    RAISE EXCEPTION 'job_not_confirmable' USING ERRCODE = '23514',
      HINT = 'This job is no longer live (status=' || COALESCE(v_status, 'null') || ').';
  END IF;

  UPDATE public.group_job_helpers
     SET helper_confirmed_at = COALESCE(helper_confirmed_at, v_now)
   WHERE id = v_slot
   RETURNING helper_confirmed_at INTO v_stamp;

  RETURN jsonb_build_object('helper_confirmed_at', v_stamp);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_group_member_on_the_way(
  _job_id uuid,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
  v_row record;
  v_status text;
  v_now timestamptz := now();
  v_tracking_id uuid;
  v_stamp timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_slot := public.group_member_slot(_job_id, v_uid);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.group_job_helpers WHERE id = v_slot FOR UPDATE;
  SELECT j.status::text INTO v_status FROM public.jobs j WHERE j.id = _job_id;

  IF v_status NOT IN ('accepted', 'in_progress') THEN
    RAISE EXCEPTION 'job_not_active' USING ERRCODE = '23514',
      HINT = 'On-the-way can only be marked on an accepted or in-progress job.';
  END IF;
  IF v_row.helper_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'helper_not_confirmed' USING ERRCODE = '23514',
      HINT = 'Confirm the job before heading out.';
  END IF;

  -- Tracking row, per (job, member) — the same shape helper_mark_on_the_way
  -- writes for the single-helper path.
  SELECT id INTO v_tracking_id
    FROM public.job_tracking
   WHERE job_id = _job_id AND helper_id = v_uid
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_tracking_id IS NOT NULL THEN
    UPDATE public.job_tracking
       SET status = 'on_the_way', latitude = p_lat, longitude = p_lng, updated_at = v_now
     WHERE id = v_tracking_id;
  ELSE
    INSERT INTO public.job_tracking (job_id, helper_id, status, latitude, longitude)
    VALUES (_job_id, v_uid, 'on_the_way', p_lat, p_lng)
    RETURNING id INTO v_tracking_id;
  END IF;

  UPDATE public.group_job_helpers
     SET helper_on_the_way_at = COALESCE(helper_on_the_way_at, v_now)
   WHERE id = v_slot
   RETURNING helper_on_the_way_at INTO v_stamp;

  -- The JOB moves to in_progress on the FIRST member who sets out; it is
  -- already in_progress for everyone after that.
  UPDATE public.jobs
     SET status = 'in_progress'
   WHERE id = _job_id AND status = 'accepted';

  RETURN jsonb_build_object('helper_on_the_way_at', v_stamp, 'tracking_id', v_tracking_id);
END;
$function$;

-- ARRIVAL, under the 2026-09-19 rule: RECORD IT ALWAYS, the poster CONFIRMS IT
-- ALWAYS. Nothing below raises for a far or fix-less location; the branches
-- differ only in whether they can also VERIFY the arrival.
CREATE OR REPLACE FUNCTION public.rpc_group_member_mark_arrival(
  _job_id uuid,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
  v_row record;
  v_job record;
  v_dist double precision;
  v_verified boolean := false;
  v_near_miss boolean := false;
  v_new_window boolean := false;
  v_basis text;
  v_now timestamptz := now();
  v_arrived_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_slot := public.group_member_slot(_job_id, v_uid);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.group_job_helpers WHERE id = v_slot FOR UPDATE;
  SELECT j.status::text AS status, j.latitude, j.longitude, j.title, j.customer_id
    INTO v_job
  FROM public.jobs j WHERE j.id = _job_id;

  IF v_job.status NOT IN ('accepted', 'in_progress') THEN
    RAISE EXCEPTION 'job_not_active' USING ERRCODE = '23514',
      HINT = 'Arrival can only be marked on an accepted or in-progress job.';
  END IF;

  -- Already settled by the poster for this member: nothing left to establish
  -- and nothing to re-measure. No write.
  IF v_row.poster_confirmed_arrival_at IS NOT NULL AND v_row.helper_arrived_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'arrival_recorded', true,
      'arrived_at', v_row.helper_arrived_at,
      'verified', v_row.helper_arrival_verified_at IS NOT NULL,
      'basis', 'already_confirmed',
      'poster_confirmation_required', false,
      'arrival_established', true
    );
  END IF;

  -- Already verified: a retry must never DOWNGRADE the verification. No write.
  IF v_row.helper_arrival_verified_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'arrival_recorded', true,
      'arrived_at', COALESCE(v_row.helper_arrived_at, v_row.helper_arrival_verified_at),
      'verified', true,
      'basis', 'already_verified',
      'poster_confirmation_required', true,
      'arrival_established', false
    );
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL THEN
    v_basis := 'no_location';
  ELSIF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    v_basis := 'location_invalid';
  ELSIF v_job.latitude IS NULL OR v_job.longitude IS NULL THEN
    v_verified := true;
    v_basis := 'no_job_coordinates';
  ELSE
    -- Haversine in feet (earth radius 20 902 231 ft), the same 500 ft threshold
    -- the client shows. LEAST(1, …) keeps asin in its domain.
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
      v_near_miss := true;
      v_basis := 'near_miss';
      v_new_window := v_row.helper_arrival_near_miss_at IS NULL
                      OR v_row.helper_arrival_near_miss_at <= v_now - interval '12 hours';
    ELSE
      v_basis := 'too_far';
    END IF;
  END IF;

  UPDATE public.group_job_helpers
     SET helper_arrived_at = COALESCE(helper_arrived_at, v_now),
         helper_arrival_verified_at = CASE
           WHEN v_verified THEN COALESCE(helper_arrival_verified_at, v_now)
           ELSE helper_arrival_verified_at END,
         helper_arrival_near_miss_at = CASE
           WHEN v_near_miss AND v_new_window THEN v_now
           ELSE helper_arrival_near_miss_at END,
         helper_arrival_near_miss_ft = CASE
           WHEN v_near_miss THEN round(v_dist)::integer
           ELSE helper_arrival_near_miss_ft END
   WHERE id = v_slot
   RETURNING helper_arrived_at INTO v_arrived_at;

  UPDATE public.jobs SET status = 'in_progress' WHERE id = _job_id AND status = 'accepted';

  IF v_job.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.customer_id,
      'Is your Helpr at the door?',
      '"' || COALESCE(v_job.title, 'Your job') || '" — a crew member marked themselves arrived'
        || CASE WHEN v_near_miss THEN ', ' || round(v_dist)::bigint || ' ft from the map pin' ELSE '' END
        || '. If they are there, tap Confirm They Arrived.',
      'job_updates',
      '/my-posts?job=' || _job_id
    );
  END IF;

  RETURN jsonb_build_object(
    'arrival_recorded', true,
    'arrived_at', v_arrived_at,
    'verified', v_verified,
    'basis', v_basis,
    'distance_ft', CASE WHEN v_dist IS NULL THEN NULL ELSE round(v_dist::numeric) END,
    'poster_confirmation_required', true,
    'arrival_established', false
  );
END;
$function$;

-- THE POSTER'S HALF. Per member, and only the poster of the job — the one stamp
-- a Helpr cannot manufacture, which is the whole reason it is the gate.
CREATE OR REPLACE FUNCTION public.rpc_poster_confirm_member_arrival(_job_id uuid, _helper_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
  v_row record;
  v_customer uuid;
  v_status text;
  v_now timestamptz := now();
  v_stamp timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT j.customer_id, j.status::text INTO v_customer, v_status
    FROM public.jobs j WHERE j.id = _job_id;
  IF v_customer IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_the_poster' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_active' USING ERRCODE = '23514';
  END IF;

  v_slot := public.group_member_slot(_job_id, _helper_id);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_row FROM public.group_job_helpers WHERE id = v_slot FOR UPDATE;

  -- The poster confirms an arrival that EXISTS. Under the 2026-09-19 rule a
  -- Helpr can always record one, so there is no case where this is unreachable.
  IF v_row.helper_arrived_at IS NULL THEN
    RAISE EXCEPTION 'arrival_confirm_before_arrival' USING ERRCODE = '23514',
      HINT = 'That Helpr has not marked arrived yet.';
  END IF;

  UPDATE public.group_job_helpers
     SET poster_confirmed_arrival_at = COALESCE(poster_confirmed_arrival_at, v_now),
         poster_confirmed_working_at = COALESCE(poster_confirmed_working_at, v_now)
   WHERE id = v_slot
   RETURNING poster_confirmed_arrival_at INTO v_stamp;

  RETURN jsonb_build_object('poster_confirmed_arrival_at', v_stamp);
END;
$function$;

-- The member's own proof photos. Separate from the Done stamp so the upload and
-- the completion are not one all-or-nothing write, exactly as the job-level
-- path keeps proof_*_urls on the whitelist rather than inside the completion.
CREATE OR REPLACE FUNCTION public.rpc_group_member_set_proof(
  _job_id uuid,
  _before text[] DEFAULT NULL,
  _after text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_slot := public.group_member_slot(_job_id, v_uid);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = '42501';
  END IF;

  UPDATE public.group_job_helpers
     SET proof_before_urls = COALESCE(_before, proof_before_urls),
         proof_after_urls  = COALESCE(_after, proof_after_urls)
   WHERE id = v_slot
     AND helper_completed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'part_already_done' USING ERRCODE = '42501',
      HINT = 'Your part is already marked done; its photos are part of the record now.';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ── 6. DONE, AND THE ROLL-UP ────────────────────────────────────────────────
-- OWNER SEMANTIC 1: the JOB is done when EVERY Helpr marks their own part done.
-- So this stamps the member's own row, then — and only when the LAST unfinished
-- slot closes — stamps `jobs.helper_completed_at`, which is what enters the job
-- into the existing payout pipeline (auto-release-payment → payout_pending →
-- process-scheduled-payouts' roster fan-out, one even share per member).
CREATE OR REPLACE FUNCTION public.rpc_group_member_mark_done(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
  v_row record;
  v_now timestamptz := now();
  v_remaining int;
  v_filled int;
  v_needed int;
  v_job_complete boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_slot := public.group_member_slot(_job_id, v_uid);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.group_job_helpers WHERE id = v_slot FOR UPDATE;

  IF v_row.helper_completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('already_done', true, 'helper_completed_at', v_row.helper_completed_at);
  END IF;

  -- The §3 trigger is AUTHORITATIVE and fires on the UPDATE below. This write
  -- is plain: no pre-flight copy of the gates to drift out of step with it.
  UPDATE public.group_job_helpers
     SET helper_completed_at = v_now
   WHERE id = v_slot
     AND helper_completed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'part_not_completable' USING ERRCODE = '42501';
  END IF;

  -- THE ROLL-UP. Lock the job row so two members finishing at once cannot both
  -- decide they were last.
  PERFORM 1 FROM public.jobs WHERE id = _job_id FOR UPDATE;

  SELECT count(*) FILTER (WHERE g.helper_completed_at IS NULL), count(*)
    INTO v_remaining, v_filled
  FROM public.group_job_helpers g
  WHERE g.job_id = _job_id;

  SELECT COALESCE(j.helpers_needed, 1) INTO v_needed FROM public.jobs j WHERE j.id = _job_id;

  -- Every slot the poster paid for must be BOTH filled and finished. An
  -- under-filled roster does not complete the job on its own: that is a human
  -- decision about the unallocated share, which process-scheduled-payouts
  -- already pages on, and silently completing here would hand it that decision
  -- by default.
  IF v_remaining = 0 AND v_filled >= v_needed THEN
    -- The transaction-local flag the restated `enforce_helper_completion_gates`
    -- below reads. It admits THIS write, on a group job only, past a job-level
    -- arrival predicate that a crew job never satisfies (the arrivals are on the
    -- roster rows, and each of them has already passed the per-member gate
    -- above). It is dropped immediately after its single UPDATE, so nothing
    -- later in the transaction inherits it.
    PERFORM set_config('app.group_rollup_rpc', '1', true);
    UPDATE public.jobs
       SET helper_completed_at = v_now
     WHERE id = _job_id
       AND helper_completed_at IS NULL
       AND status IN ('accepted', 'in_progress', 'revision_requested');
    PERFORM set_config('app.group_rollup_rpc', '0', true);
    v_job_complete := true;
  END IF;

  RETURN jsonb_build_object(
    'already_done', false,
    'helper_completed_at', v_now,
    'crew_remaining', v_remaining,
    'job_complete', v_job_complete
  );
END;
$function$;

-- ── 7. THE ONE CARVE-OUT ON THE SINGLE-HELPER GATE ──────────────────────────
-- Restated VERBATIM from prod (pg_get_functiondef, 2026-09-19) with ONE added
-- early return, conjoined on `OLD.is_group_job IS TRUE` AND the transaction-
-- local flag that only §6's roll-up sets. A single-helper job — every real job
-- on prod today — has is_group_job false or null, so it cannot reach the new
-- branch at all, and no client can set the flag: `set_config` is not reachable
-- from PostgREST, and even if it were, the branch also requires is_group_job.
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

-- ── 8. ROSTER RLS: A MEMBER MAY ACT ON THEIR OWN ROW ────────────────────────
-- Members 2..N already SELECT their own roster row ("Job participants can view
-- group helpers"). They do NOT get an UPDATE policy: every lifecycle column is
-- server-owned by §2, so a client UPDATE policy could only grant the right to
-- change columns the §2 trigger then refuses — a door that opens onto a wall,
-- and one more thing to get wrong later. Members act through the §5/§6 RPCs.
--
-- What IS tightened: `anon` holds arwdxm on this table from prod's default
-- privileges, and the UPDATE/DELETE policies on it are `TO public` (they are
-- null-safe for anon today, which is luck, not design). Revoke the write half
-- by ROLE NAME — `FROM PUBLIC` alone leaves anon's explicit grant.
REVOKE INSERT, UPDATE, DELETE ON public.group_job_helpers FROM PUBLIC, anon;

-- ── 9. EXECUTE: authenticated + service_role only ───────────────────────────
-- Every function above is SECURITY DEFINER, so EXECUTE is the whole authz
-- boundary. Guarded on existence so a from-scratch replay before these exist
-- does not fail, and restated because prod's default privileges have silently
-- re-granted PUBLIC before. The two trigger functions take NO client EXECUTE at
-- all (20260916030921's class).
DO $$
DECLARE
  f text;
  client_fns CONSTANT text[] := ARRAY[
    'public.rpc_group_member_confirm(uuid)',
    'public.rpc_group_member_on_the_way(uuid,double precision,double precision)',
    'public.rpc_group_member_mark_arrival(uuid,numeric,numeric)',
    'public.rpc_poster_confirm_member_arrival(uuid,uuid)',
    'public.rpc_group_member_set_proof(uuid,text[],text[])',
    'public.rpc_group_member_mark_done(uuid)',
    'public.group_member_slot(uuid,uuid)'
  ];
  trigger_fns CONSTANT text[] := ARRAY[
    'public.enforce_group_member_lifecycle_server_owned()',
    'public.enforce_group_member_completion_gates()',
    'public.enforce_group_member_completion_not_clearable()',
    'public.enforce_helper_completion_gates()'
  ];
BEGIN
  FOREACH f IN ARRAY client_fns LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
    END IF;
  END LOOP;
  FOREACH f IN ARRAY trigger_fns LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    END IF;
  END LOOP;
END $$;
