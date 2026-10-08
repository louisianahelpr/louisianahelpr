-- Owner, 2026-10-08 (pop-up: "At least 2 hours"): a job posted at 1:37 PM for
-- a 2:00 PM start showed "34 minutes left" at 2:03, because the listing floor
-- (enforce_job_expiry_floor / computeJobExpiresAt) kept every new listing up
-- for an hour even past its start (job 28f8cff5).
--
-- A signed-in poster's new job must now START at least 2 hours out (2 h is when
-- "I'm On My Way" unlocks, so a job posted any later cannot run its own day),
-- and its listing never outlives its start. Post a Job refuses the same thing
-- first (src/lib/jobExpiry.ts isScheduleTooSoon); this is the backstop.
--
-- Not judged here: server-context inserts (series visits the cron creates,
-- edge functions) and rows posted by is_seed test accounts (the nightly
-- journeys post 4-100 minutes out to run the whole day in one pass;
-- profiles.is_seed is not user-writable, prevent_self_escalation).
-- No start time ("any time that day") counts as 11:59 PM, the listing's own
-- end-of-day rule. Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.refuse_short_notice_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_start timestamptz;
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
  -- The listing closes at the start, never after it.
  IF NEW.expires_at IS NULL OR NEW.expires_at > v_start THEN
    NEW.expires_at := v_start;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.refuse_short_notice_job() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_short_notice ON public.jobs;
CREATE TRIGGER trg_jobs_short_notice
  BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.refuse_short_notice_job();
