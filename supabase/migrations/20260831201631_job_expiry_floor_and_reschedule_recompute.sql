-- A funded job must never be born already expired, and moving a job's date
-- must never leave its listing expiry behind.
--
-- H1: jobs.expires_at is computed CLIENT-SIDE in
-- src/pages/postjob/jobSubmitHelpers.ts (computeExpiresAt) as
-- `${date_needed}T${start_time}` in the browser's local zone. The post wizard
-- only validated the DATE ("Date cannot be in the past", midnight-to-midnight),
-- so picking TODAY with a start time earlier than the current clock produced
-- expires_at < created_at. The row is INSERTed BEFORE create-payment runs, so
-- the poster is then charged for a listing that `expires_at > NOW()` already
-- excludes from the feed (useDashboardData) and the map (get_open_jobs_for_map)
-- — invisible to every helper, and reading "Expired" on the poster's own card
-- minutes after paying. A client-side guard alone cannot cover this: the INSERT
-- is a plain PostgREST write, so the floor has to live in the database.
--
-- H2: EditJobDialog updates date_needed/start_time and never recomputes
-- expires_at, so a job rescheduled 08-31 -> 09-03 keeps its 08-31 expiry and
-- stays invisible with no in-app recovery. Recompute server-side on the same
-- rule, so every client (and any future one) inherits it.
--
-- Rule, in one place:
--   scheduled  = date_needed + coalesce(start_time, 23:59:59), read in
--                America/Chicago (Louisiana is Central; matches what the
--                browser computed for an in-state poster).
--   expires_at = greatest(scheduled, now() + MIN_LISTING_WINDOW)
-- MIN_LISTING_WINDOW is 1 hour: a job whose start has already passed still
-- gets an hour of visibility rather than none, which is strictly better than
-- charging for a listing nobody can ever see. Same constant mirrored in
-- src/lib/jobExpiry.ts.

-- Derives the listing expiry from a job's schedule. Kept as its own function
-- so the trigger and any future backfill read one definition.
CREATE OR REPLACE FUNCTION public.job_expires_at_for_schedule(
  p_date_needed date,
  p_start_time time without time zone
)
RETURNS timestamptz
LANGUAGE sql
-- STABLE, not IMMUTABLE: the result depends on the server's time-zone
-- database. Nothing indexes this, so STABLE costs nothing and claims less.
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_date_needed IS NULL THEN NULL
    ELSE (p_date_needed + COALESCE(p_start_time, time '23:59:59'))
           AT TIME ZONE 'America/Chicago'
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_job_expiry_floor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- Minimum window a listing stays visible. Mirrors MIN_LISTING_WINDOW_MS in
  -- src/lib/jobExpiry.ts.
  v_floor CONSTANT timestamptz := now() + interval '1 hour';
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A job may not be created already expired. Only lifts an expiry that is
    -- already in the past — a normal future-dated job is untouched.
    IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= now() THEN
      NEW.expires_at := v_floor;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE. Two distinct cases, deliberately narrow so no sweep or cron that
  -- merely touches an already-expired row gets its expiry silently revived.

  -- (a) The schedule moved and the writer left expires_at alone -> the expiry
  --     is now stale. Recompute it from the new schedule. This is the H2 fix,
  --     and it is what makes a reschedule un-expire a job. Cannot fire on a
  --     helper's UPDATE: date_needed / start_time are not in the helper column
  --     whitelist (20260703161000), so a helper can never move a schedule.
  IF (NEW.date_needed IS DISTINCT FROM OLD.date_needed
      OR NEW.start_time IS DISTINCT FROM OLD.start_time)
     AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at THEN
    NEW.expires_at := public.job_expires_at_for_schedule(NEW.date_needed, NEW.start_time);
  END IF;

  -- (b) Whoever just WROTE expires_at wrote one that is already past. Floor it,
  --     same as on insert. Gated on the value actually changing, so a row whose
  --     expiry legitimately lapsed long ago (auto-expire-jobs flipping status,
  --     any other sweep) keeps its historical expires_at untouched.
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at
     AND NEW.expires_at IS NOT NULL
     AND NEW.expires_at <= now() THEN
    NEW.expires_at := v_floor;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_expiry_floor ON public.jobs;
CREATE TRIGGER trg_job_expiry_floor
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_job_expiry_floor();

COMMENT ON FUNCTION public.enforce_job_expiry_floor() IS
  'Guarantees jobs.expires_at is never in the past at creation, and recomputes it when date_needed/start_time move without the writer updating it. See migration 20260831201631.';

-- ───────────────────────────────────────────────────────────────────────────
-- Backfill: jobs already sitting in the H1/H2 state — open, funded, and
-- expired — get their expiry re-derived from the schedule they actually
-- carry. Only touches rows whose OWN date has not passed, so nothing genuinely
-- stale is resurrected; a job whose date_needed is in the past is correctly
-- expired and is left alone (auto-expire-jobs owns those).
--
-- Runs with the trigger installed; branch (b) does not fire because the
-- recomputed value is in the future for every row the WHERE clause selects.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fixed integer;
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.jobs j
  SET expires_at = public.job_expires_at_for_schedule(j.date_needed, j.start_time)
  WHERE j.status = 'open'
    AND j.helper_id IS NULL
    AND j.expires_at IS NOT NULL
    AND j.expires_at <= now()
    AND j.date_needed IS NOT NULL
    AND public.job_expires_at_for_schedule(j.date_needed, j.start_time) > now();

  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE 'job expiry backfill: re-derived expires_at on % job(s)', v_fixed;
END;
$$;
