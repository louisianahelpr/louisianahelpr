-- Lifecycle solidity — two soft spots the 2026-08-24 review named, both
-- owner-approved the same day.
--
-- 1. `accepted_at`. auto-expire-jobs reopens a stale acceptance when the row
--    hasn't been WRITTEN for 24h (`updated_at`), so any incidental update —
--    an admin note, a money-status change, a backfill — resets the ghosting
--    clock. This stamps the moment a job actually entered `accepted`, and the
--    cron keys on it (edge change ships with this migration; legacy rows with
--    a NULL stamp keep the old updated_at fallback there).
--
-- 2. `helper_dayof_confirmed_at`. Accepting a job stamps
--    `helper_confirmed_at` at accept time — days early — so the day-before
--    "we ask you BOTH to confirm" card had nothing left to ask the helper and
--    the mutual gate was poster-only. The helper's day-before tap now writes
--    THIS stamp; the tracker's Confirmed step requires it (with a legacy
--    fallback for helpers whose accept already happened inside the window).
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS; trigger dropped before create; the
-- backfill only touches rows that predate the trigger.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS helper_dayof_confirmed_at timestamptz;

-- Stamp on every path into `accepted` (RPC, direct offer, admin override) —
-- one trigger instead of chasing each writer, present and future.
CREATE OR REPLACE FUNCTION public.stamp_job_accepted_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'accepted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted') THEN
    NEW.accepted_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_stamp_accepted_at ON public.jobs;
CREATE TRIGGER trg_jobs_stamp_accepted_at
  BEFORE INSERT OR UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_job_accepted_at();

-- Best-available backfill for in-flight rows: the last write is the closest
-- thing to an acceptance time we still have, and it is exactly the clock the
-- cron was already using for them.
UPDATE public.jobs SET accepted_at = updated_at
WHERE status = 'accepted' AND accepted_at IS NULL;
