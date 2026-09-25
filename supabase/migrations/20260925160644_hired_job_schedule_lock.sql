-- A committed job's date and start time are not client-writable.
--
-- Money audit 2026-09-25 (lh-money-escrow, HIGH-2, PGlite + code read, NOT
-- reproduced live): date_needed and start_time stayed poster-writable after a
-- hire and even after a cancel, on one-off jobs, crew jobs and recurring child
-- visits. 20260925052841 locked only a hired SERIES PARENT.
--   - a $100 job with a confirmed Helpr ~10h out: moving the date +3 days
--     before cancelling drops the late-cancel fee from $25 to $0
--     (poster_cancel_job prices from the live columns);
--   - patching a CANCELLED job's date lets void-cancelled-payments re-price it
--     (computeCancellationFee reads the live columns): the refund grows by $25
--     and the Helpr loses $22.
--
-- Now date_needed and start_time are refused for client roles once ANY of:
-- a Helpr is on the job (helper_id), a crew member is on it
-- (group_job_helpers), it is a recurring visit (parent_job_id), or it is
-- cancelled. A committed job's date or time changes only when the other
-- person accepts a change request (owner decision Q407(8), the next
-- migration's request_job_schedule_change / respond_job_schedule_change,
-- which are SECURITY DEFINER and pass this lock).
--
-- enforce_series_columns_client_lock is restated from its newest definition
-- (20260925052841) with that block added; everything else is verbatim.

-- Is anyone on this job's crew? SECURITY DEFINER so the lock (which runs as
-- the client) does not depend on the client's RLS view of the roster. It
-- answers only about a job the CALLER posted or is hired on (or in a server
-- context), and false otherwise: the lock needs nothing more, and anyone else
-- could otherwise probe any job's crew (review LOW-2).
CREATE OR REPLACE FUNCTION public.job_has_crew(p_job uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_found boolean := false;
BEGIN
  IF to_regclass('public.group_job_helpers') IS NULL THEN
    RETURN false;
  END IF;
  IF NOT public.is_server_context()
     AND NOT EXISTS (SELECT 1 FROM public.jobs j
                      WHERE j.id = p_job
                        AND (SELECT auth.uid()) IN (j.customer_id, j.helper_id)) THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = $1)'
     INTO v_found
    USING p_job;
  RETURN COALESCE(v_found, false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.job_has_crew(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_has_crew(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_series_columns_client_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  -- A definer RPC (current_user = its owner), service_role, or postgres.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.parent_job_id IS NOT NULL THEN
      RAISE EXCEPTION 'series_locked: jobs.parent_job_id is set only by the recurring-visit scheduler'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.series_ended_on IS NOT NULL THEN
      RAISE EXCEPTION 'series_locked: jobs.series_ended_on is set only by end_recurring_series'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_job_id IS DISTINCT FROM OLD.parent_job_id THEN
    RAISE EXCEPTION 'series_locked: jobs.parent_job_id is set only by the recurring-visit scheduler (job_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.recurrence_days IS DISTINCT FROM OLD.recurrence_days AND OLD.helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'series_locked: the visit schedule cannot change after a Helpr is hired (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Cancel the series and post a new one with the new days.';
  END IF;
  IF NEW.series_ended_on IS DISTINCT FROM OLD.series_ended_on THEN
    RAISE EXCEPTION 'series_locked: jobs.series_ended_on is set only by end_recurring_series (job_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  -- HIGH-2 (money audit 2026-09-25): a committed or cancelled job's date and
  -- start time price its cancellation fee and its refund. Once a Helpr or a
  -- crew is on it, it is a recurring visit, or it is cancelled, they change
  -- only through an accepted change request (a definer RPC).
  IF (NEW.date_needed IS DISTINCT FROM OLD.date_needed OR NEW.start_time IS DISTINCT FROM OLD.start_time)
     AND (OLD.helper_id IS NOT NULL
          OR OLD.parent_job_id IS NOT NULL
          OR OLD.status::text = 'cancelled'
          OR public.job_has_crew(OLD.id)) THEN
    RAISE EXCEPTION 'schedule_locked: the date and start time of a booked or cancelled job cannot be edited (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Ask for a new date or time; it changes when the other person accepts.';
  END IF;
  -- A hired series parent: every column the visit dates are computed from is
  -- the schedule the Helpr agreed to.
  IF OLD.recurrence_days IS NOT NULL AND OLD.parent_job_id IS NULL AND OLD.helper_id IS NOT NULL
     AND (NEW.recurrence_weeks IS DISTINCT FROM OLD.recurrence_weeks
          OR NEW.date_needed IS DISTINCT FROM OLD.date_needed
          OR NEW.start_time IS DISTINCT FROM OLD.start_time
          OR NEW.recurrence_end_date IS DISTINCT FROM OLD.recurrence_end_date) THEN
    RAISE EXCEPTION 'series_locked: the visit schedule cannot change after a Helpr is hired (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'End the series and post a new one with the new schedule.';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_series_columns_client_lock() FROM PUBLIC, anon, authenticated;

-- Same trigger (date_needed and start_time are already in its column list).
DROP TRIGGER IF EXISTS trg_enforce_series_columns_client_lock ON public.jobs;
CREATE TRIGGER trg_enforce_series_columns_client_lock
  BEFORE INSERT OR UPDATE OF parent_job_id, recurrence_days, recurrence_weeks, date_needed, start_time, recurrence_end_date, series_ended_on ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_series_columns_client_lock();
