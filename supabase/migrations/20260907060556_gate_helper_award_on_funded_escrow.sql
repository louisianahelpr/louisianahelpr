-- Gate helper-facing binding on a FUNDED job.
--
-- THE HOLE (reproduced against prod 2026-09-06, read-only, in a rolled-back
-- transaction, using a real non-admin helper who clears helper_award_block_reason):
--
--   PHASE A  helper INSERTs applications row on unpaid job  -> ALLOWED
--   PHASE B  poster calls accept_application(...)           -> ALLOWED
--            job ends: status=accepted payment_status=unpaid helper_id=<helper>
--   DOOR C   poster plain UPDATE jobs SET helper_id,status  -> ALLOWED (no RPC)
--   DOOR D   helper calls respond_to_direct_offer(job,true) -> ALLOWED
--            job ends: accepted/unpaid/helper=<helper>/helper_confirmed_at=<now>
--
-- A helper could therefore be hired, confirmed, and do real work on a job with
-- no money held anywhere. Nothing in the authorization layer looked at
-- payment_status: not the applications INSERT policy, not accept_application,
-- not helper_award_block_reason, not enforce_job_status_transition.
--
-- The only thing standing in the way was that open_jobs_browse,
-- get_ranked_open_jobs and get_public_open_jobs all filter
-- payment_status IN ('escrow','payout_pending','released'), so the job was not
-- DISCOVERABLE. That is obscurity, not authorization -- the apply path takes a
-- job id, and a job id travels in a shared /jobs/<id> link.
--
-- WHY A TRIGGER ON jobs AND NOT A CHECK IN accept_application:
-- there are four doors and they share exactly one thing -- they all move
-- jobs.helper_id from NULL to a person (DOOR D also stamps helper_confirmed_at).
-- A check added to accept_application leaves DOOR C wide open, and DOOR C needs
-- nothing but the public anon key. The award transition is the chokepoint, and
-- enforce_helper_award_gate already computes it; this is its money-shaped
-- sibling, kept separate so the refusal reason stays legible.
--
-- DEFERRED, DELIBERATELY: a real pre-funding `status`.
--
-- The owner asked for a job not to read as `open` before it is funded. That is
-- the right long-term model and this migration does NOT deliver it. Why it
-- cannot ship in one deploy, measured rather than assumed (2026-09-06):
--
--   * `jobs.status` is the ENUM `job_status`, today
--     (open, accepted, in_progress, completed, cancelled, revision_requested,
--      disputed, pending_approval).
--   * Postgres refuses to USE a new enum value in the same transaction that
--     ADDED it. Proven in PGlite:
--         BEGIN;
--           ALTER TYPE job_status ADD VALUE 'pending_payment';
--           INSERT INTO j VALUES (1,'pending_payment');
--         -> ERROR: unsafe use of new value "pending_payment" of enum type job_status
--     The same two statements in SEPARATE transactions succeed. `supabase db
--     push` applies each migration inside a transaction, so adopting a new
--     status is a MINIMUM two-deploy sequence with a window in between where
--     the value exists and nothing handles it.
--   * The surfaces that would have to move together, counted against prod and
--     the repo: 35 functions, 1 view and 3 RLS policies whose bodies test
--     'open'; 43 non-test client files and 7 edge functions. Plus
--     `enforce_job_status_transition`'s matrix (which has no pre-funding state
--     and no edge into 'open'), `enforce_jobs_insert_column_lock` (which
--     hard-forces status := 'open'), and `jobStatusExhaustive.test.ts`.
--
-- Shipping half of that on launch day is how a job becomes invisible to its
-- own poster. So it is filed as deferred, and the harm it was meant to prevent
-- is closed HERE instead, at the authorization layer: after this migration a
-- job that reads `open` while unfunded cannot be applied to and cannot be
-- assigned to anyone, through any of the five doors. A surface that misreads
-- the status can now only mis-DISPLAY it, not mis-SELL it.
--
-- WHY payment_status AND NOT A NEW PRE-FUNDING JOB STATUS:
-- enforce_jobs_insert_column_lock hard-forces status='open' on every
-- poster-created row, so "open before funded" is structural, not incidental.
-- Moving it would touch the insert lock, the transition matrix (which has no
-- pre-funding state), str-ical-sync, four browse surfaces, both notify triggers
-- and the activity cards -- on launch day. payment_status is already the
-- platform's funding source of truth and already the predicate eight functions
-- read. Adding a ninth consumer is cohesive; adding a parallel status axis is not.
--
-- AN UNFUNDED OPEN JOB IS LEGITIMATE AND MUST STAY THAT WAY.
-- str-ical-sync inserts cleaning jobs with payment_status left at 'unpaid' and
-- the host funds them later via useFundExistingJob/create-payment. This
-- migration gates the HELPER-facing paths only. The poster's own screens read
-- public.jobs directly and are untouched; they must keep seeing and funding
-- their unpaid job.
--
-- NON-BREAKING AGAINST LIVE DATA: prod holds zero jobs that are assigned
-- (helper_id IS NOT NULL) and not funded, so nothing existing trips this.

-- ---------------------------------------------------------------------------
-- 1. ONE definition of "funded".
-- ---------------------------------------------------------------------------
-- Eight functions currently repeat this predicate inline. This does not
-- repoint them (too wide a blast radius for today); it stops the count going
-- to nine by hand, and gives the two new gates below a single source.
--
-- COALESCE, not a bare `= ANY`: payment_status is nullable, and a NULL would
-- make the comparison NULL, which both an IF and a policy treat as false --
-- correct here (unfunded), but only by accident. Made explicit.
CREATE OR REPLACE FUNCTION public.job_payment_is_funded(p_payment_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p_payment_status, '') = ANY (
    ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]
  );
$$;

COMMENT ON FUNCTION public.job_payment_is_funded(text) IS
  'True when a job''s payment_status means money is actually held or has moved. '
  'Mirrors the predicate the browse surfaces and notify triggers use.';

-- Row-lookup form, for the applications RLS policy. SECURITY DEFINER for the
-- same reason get_job_customer_id is: a helper has no SELECT on a job they
-- cannot yet see, and the policy must still be able to judge it.
CREATE OR REPLACE FUNCTION public.job_is_funded(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.job_payment_is_funded(j.payment_status)
  FROM public.jobs j
  WHERE j.id = p_job_id;
$$;

COMMENT ON FUNCTION public.job_is_funded(uuid) IS
  'True when the job exists and is funded. NULL (job missing) is not true, so a '
  'policy using it fails closed.';

-- Name the roles explicitly. REVOKE ... FROM PUBLIC does NOT revoke anon --
-- Supabase''s ALTER DEFAULT PRIVILEGES grants EXECUTE to anon, authenticated
-- and service_role individually.
REVOKE ALL ON FUNCTION public.job_payment_is_funded(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.job_is_funded(uuid)          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_payment_is_funded(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.job_is_funded(uuid)         TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. THE HIRE GATE -- closes PHASE B, DOOR C and DOOR D at their one chokepoint.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_job_funded_before_award()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_awarding boolean;
BEGIN
  -- Only real end-user sessions are judged, exactly as enforce_helper_award_gate
  -- does. The stripe webhook, the payout crons, str-ical-sync and
  -- charge-recurring-visits all run as service role with a NULL auth.uid() and
  -- must keep being able to write these columns.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- The two transitions that mean "this job is now theirs" -- same definition
  -- as enforce_helper_award_gate, deliberately. A re-save that leaves both
  -- columns as they were is not an award: an already-hired helper on a job
  -- whose escrow has since been refunded must still be able to have that job
  -- completed, cancelled or disputed.
  v_awarding :=
    (NEW.helper_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_id IS DISTINCT FROM NEW.helper_id))
    OR (NEW.helper_confirmed_at IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL));

  IF NOT v_awarding THEN
    RETURN NEW;
  END IF;

  -- Judge the funding state the row is LANDING in, not the one it left. The
  -- webhook sets payment_status and helper_id in separate statements, but a
  -- service-role session is already exempt above, so NEW is the honest read
  -- for every session this gate actually judges.
  IF NOT public.job_payment_is_funded(NEW.payment_status) THEN
    RAISE EXCEPTION
      'This job is not funded yet, so it cannot be assigned to a helper. The poster needs to complete checkout first.'
      USING
        ERRCODE = 'check_violation',
        HINT = 'jobs.payment_status must be escrow, payout_pending or released before jobs.helper_id / helper_confirmed_at may be set. See enforce_job_funded_before_award().';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_job_funded_before_award() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_job_funded_before_award ON public.jobs;
CREATE TRIGGER trg_job_funded_before_award
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_job_funded_before_award();

-- ---------------------------------------------------------------------------
-- 3. THE APPLY GATE -- closes PHASE A.
-- ---------------------------------------------------------------------------
-- A separate harm from the hire, and it deserves its own answer: a helper who
-- applies to a dead job wastes their effort, burns one of their 15 daily
-- applications (enforce_application_limit), and pushes a notification to a
-- poster who has not paid. Blocking it at the policy is also what makes the
-- job's invisibility in browse mean something.
DROP POLICY IF EXISTS "Helpers can create applications" ON public.applications;
CREATE POLICY "Helpers can create applications"
  ON public.applications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = helper_id
    AND status = 'pending'::application_status
    AND NOT are_users_blocked(helper_id, get_job_customer_id(job_id))
    -- ADDED 2026-09-06 -- the funding gate. Same authority the four browse
    -- surfaces already use to hide this job from the helper entirely.
    AND public.job_is_funded(job_id)
  );

-- ---------------------------------------------------------------------------
-- 4. THE APPLY GATE, WHERE IT ACTUALLY BITES -- apply_to_job (DOOR E).
-- ---------------------------------------------------------------------------
-- The policy above is NOT sufficient on its own, and it would have been easy
-- to stop there and believe the apply path was closed.
--
-- useApplyFlow.ts calls rpc('apply_to_job') FIRST and only falls back to a
-- direct INSERT on PGRST202 (function-not-deployed). apply_to_job is
-- SECURITY DEFINER and owned by `postgres`, which owns public.applications --
-- so row-level security is NOT enforced for it at all. In production
-- essentially every application is created through this function, meaning the
-- policy is the fallback path and this is the real one.
--
-- Verified against prod 2026-09-06 in a rolled-back transaction:
--   DOOR E  apply_to_job(<unpaid job>, 'probe') -> ALLOWED
--
-- Replaced verbatim except for the funding gate: the rate limits, the advisory
-- lock, the FOR SHARE that composes with accept_application's FOR UPDATE, the
-- own-job check and the duplicate check are all unchanged.
CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_id uuid, p_message text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_app_id uuid;
  v_existing int;
  v_status text;
  v_payment_status text;
  v_count_1m int;
  v_count_1h int;
  v_count_1d int;
BEGIN
  -- Serialize this helper's concurrent applications so the counts below see
  -- each other's inserts. Released automatically at transaction end.
  PERFORM pg_advisory_xact_lock(hashtextextended('apply_rate:' || auth.uid()::text, 0));

  SELECT COUNT(*) INTO v_count_1m FROM applications
    WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 minute';
  IF v_count_1m >= 10 THEN
    RAISE EXCEPTION 'rate_limit_minute' USING HINT = 'Too many applications — try again in a minute';
  END IF;

  SELECT COUNT(*) INTO v_count_1h FROM applications
    WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 hour';
  IF v_count_1h >= 50 THEN
    RAISE EXCEPTION 'rate_limit_hour' USING HINT = 'Hourly application limit reached — try again later';
  END IF;

  SELECT COUNT(*) INTO v_count_1d FROM applications
    WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 day';
  IF v_count_1d >= 200 THEN
    RAISE EXCEPTION 'rate_limit_day' USING HINT = 'Daily application limit reached — try again tomorrow';
  END IF;

  -- FOR SHARE: composes with accept_application's FOR UPDATE so an application
  -- can't be inserted against a job being accepted in the same instant.
  SELECT status, payment_status INTO v_status, v_payment_status
  FROM jobs WHERE id = p_job_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_status != 'open' THEN
    RAISE EXCEPTION 'Job is no longer accepting applications';
  END IF;

  -- ADDED 2026-09-06 -- the funding gate. Read under the same FOR SHARE lock
  -- as the status, so it cannot be raced by a refund landing mid-apply.
  -- Deliberately worded for the helper, not the poster: the job's funding
  -- state is not the helper's business beyond "you cannot take this yet".
  IF NOT public.job_payment_is_funded(v_payment_status) THEN
    RAISE EXCEPTION 'This job is not accepting applications yet'
      USING HINT = 'The poster has not completed checkout, so there is no payment held for this job.';
  END IF;

  IF EXISTS (SELECT 1 FROM jobs WHERE id = p_job_id AND customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Cannot apply to your own job';
  END IF;
  SELECT COUNT(*) INTO v_existing
  FROM applications WHERE job_id = p_job_id AND helper_id = auth.uid();
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Already applied to this job';
  END IF;

  INSERT INTO applications (job_id, helper_id, message, status)
  VALUES (p_job_id, auth.uid(), p_message, 'pending')
  RETURNING id INTO v_app_id;

  RETURN v_app_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_to_job(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_to_job(uuid, text) TO authenticated;
