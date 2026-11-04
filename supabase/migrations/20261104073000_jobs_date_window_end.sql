-- Q2408 (owner: BUILD) "Any time this week" on Post a job.
--
-- A job stored ONE day (date_needed). "Any time this week" needs a window: the poster picks the first day and the
-- job can be done on any day through date_window_end (at most 6 days later, so 7 days in all). date_needed stays the
-- window's FIRST day, so every reader that only knows date_needed keeps working (it reads the earliest day); readers
-- that must know the window (cards, the Helpr's pick-a-day question, open-job expiry) read date_window_end too.
-- NULL = a one-day job (every existing row).
--
-- Additive: a nullable column and a CHECK that every existing row passes (all NULL). jobs SELECT is granted per
-- column (20260915045110), so the new column is granted to authenticated here, as tax_kind was (20261102152453).

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS date_window_end date;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_date_window_end_in_a_week;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_date_window_end_in_a_week
  CHECK (
    date_window_end IS NULL
    OR (date_needed IS NOT NULL AND date_window_end > date_needed AND date_window_end <= date_needed + 6)
  );

GRANT SELECT (date_window_end) ON public.jobs TO authenticated;
DO $$
BEGIN
  IF to_regprocedure('public.sync_jobs_select_grants()') IS NOT NULL THEN
    PERFORM public.sync_jobs_select_grants();
  END IF;
END $$;

COMMENT ON COLUMN public.jobs.date_window_end IS
  'Q2408: last day of an "Any time this week" window (date_needed is the first day; at most +6). NULL = one-day job.';

-- Once the job is booked or its day moves, it is a one-day job: hiring a Helpr who picked a day in the window moves
-- date_needed to that day (accept_application_at_suggested_time, 20261023134752), and hiring one who said the
-- first day works leaves date_needed as is. Either way the window is over, so it is cleared HERE, before the CHECK
-- runs (BEFORE triggers fire before constraints), and a moved day can never trip jobs_date_window_end_in_a_week.
-- Named trg_job_date_window_clear so it fires BEFORE trg_job_expiry_floor (same-event triggers fire by name): a
-- day moved at hire then recomputes the expiry from the new day, not from the old window's end.
CREATE OR REPLACE FUNCTION public.clear_job_date_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  -- A booked (or cancelled, done...) job's day is locked (schedule_locked, 20261018024950): a window can never be
  -- added to it or moved on it, by anyone.
  IF NEW.date_window_end IS NOT NULL
     AND NEW.date_window_end IS DISTINCT FROM OLD.date_window_end
     AND OLD.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'schedule_locked: a window cannot be added to a job that is not open (job_id=%)', OLD.id
      USING ERRCODE = '22023';
  END IF;
  IF NEW.date_window_end IS NOT NULL
     AND OLD.date_window_end IS NOT NULL
     AND (NEW.date_needed IS DISTINCT FROM OLD.date_needed OR NEW.status IS DISTINCT FROM 'open') THEN
    NEW.date_window_end := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.clear_job_date_window() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_date_window_clear ON public.jobs;
CREATE TRIGGER trg_job_date_window_clear
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.clear_job_date_window();

-- The listing closes on the window's last day (newest definition of 20261008190546's function, one change).
CREATE OR REPLACE FUNCTION public.refuse_short_notice_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_start timestamptz;
  v_close timestamptz;
BEGIN
  IF NEW.date_needed IS NULL OR NEW.parent_job_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.customer_id AND p.is_seed) THEN
    RETURN NEW;
  END IF;
  v_start := (NEW.date_needed + COALESCE(NEW.start_time, '23:59'::time)) AT TIME ZONE 'America/Chicago';
  IF v_start < now() + interval '2 hours' THEN
    RAISE EXCEPTION 'job_start_too_soon' USING ERRCODE = '22023',
      HINT = 'A job needs at least 2 hours'' notice.';
  END IF;
  -- The listing closes at the start, never after it. Q2408: a window job ("Any time this week") closes at the
  -- start on the window's LAST day, so it stays up for the whole week.
  v_close := (COALESCE(NEW.date_window_end, NEW.date_needed) + COALESCE(NEW.start_time, '23:59'::time)) AT TIME ZONE 'America/Chicago';
  IF NEW.expires_at IS NULL OR NEW.expires_at > v_close THEN
    NEW.expires_at := v_close;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.refuse_short_notice_job() FROM PUBLIC, anon, authenticated;

-- A schedule change recomputes the expiry from the window's last day (newest definition of 20260831201631's
-- function, one change). The triggers themselves are unchanged.
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
  --     Q2408: a window job's listing runs to the window's last day.
  IF (NEW.date_needed IS DISTINCT FROM OLD.date_needed
      OR NEW.start_time IS DISTINCT FROM OLD.start_time
      OR NEW.date_window_end IS DISTINCT FROM OLD.date_window_end)
     AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at THEN
    NEW.expires_at := public.job_expires_at_for_schedule(COALESCE(NEW.date_window_end, NEW.date_needed), NEW.start_time);
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

