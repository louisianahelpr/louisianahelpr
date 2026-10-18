-- Q1996 BEFORE THE FLIP (lh-money-escrow review of slice 3a, #2): a poster
-- cannot change recurrence_days on a job that carries the poster-fee stamp
-- (jobs.poster_fee_flat_cents, 20261017230824).
--
-- Before: enforce_series_columns_client_lock refused a recurrence_days change
-- only once a Helpr was hired, so a poster could PATCH a paid one-off (priced
-- 5% + 70c once at checkout) into a series until someone was hired. Restated
-- verbatim from 20260927012806 (= live pg_get_functiondef, read 2026-10-18)
-- plus the one new check. Definer RPCs and the service role still pass.
-- Replay-safe: CREATE OR REPLACE + DROP/CREATE TRIGGER.

CREATE OR REPLACE FUNCTION public.enforce_series_columns_client_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  -- Authz review MEDIUM: on a split series the parent's helper_id can be null
  -- while other Helprs hold dates, and they agreed to this schedule too. Read
  -- as the caller: only the poster can UPDATE a parent (RLS), and a poster is
  -- always a party under the holds' read policy, so the read sees every hold.
  v_hired boolean;
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

  v_hired := OLD.helper_id IS NOT NULL
             OR (OLD.recurrence_days IS NOT NULL AND OLD.parent_job_id IS NULL
                 AND EXISTS (SELECT 1 FROM public.series_visit_holds h WHERE h.parent_job_id = OLD.id));

  -- Q1996 (lh-money-escrow review of slice 3a, #2): a job carrying the
  -- poster-fee stamp was priced at checkout as what it was then (a one-off or
  -- a series). Turning it into a series, or a series into a one-off, would
  -- move it onto a schedule its checkout never priced: charge-recurring-visits
  -- would charge the visits without their fee and the visit insert would hit
  -- jobs_poster_fee_model_consistent AFTER the card was charged. The stamp is
  -- written when the checkout opens (create-payment escrow), so this holds for
  -- an open checkout as well as a funded job, hired or not.
  IF NEW.recurrence_days IS DISTINCT FROM OLD.recurrence_days
     AND OLD.poster_fee_flat_cents IS NOT NULL THEN
    RAISE EXCEPTION 'fee_locked: a job priced at checkout cannot become a series or stop being one (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Cancel the job and post a new one with the new days.';
  END IF;
  IF NEW.parent_job_id IS DISTINCT FROM OLD.parent_job_id THEN
    RAISE EXCEPTION 'series_locked: jobs.parent_job_id is set only by the recurring-visit scheduler (job_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.recurrence_days IS DISTINCT FROM OLD.recurrence_days AND v_hired THEN
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
  -- One person / split: the terms Helprs applied under. Fixed once anyone is
  -- hired on the series.
  IF NEW.series_split_ok IS DISTINCT FROM OLD.series_split_ok
     AND (v_hired OR OLD.recurring_helper_id IS NOT NULL) THEN
    RAISE EXCEPTION 'series_locked: one-person or split days cannot change after a Helpr is hired (job_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  -- A hired series parent: every column the visit dates are computed from is
  -- the schedule the Helpr agreed to.
  IF OLD.recurrence_days IS NOT NULL AND OLD.parent_job_id IS NULL AND v_hired
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

DROP TRIGGER IF EXISTS trg_enforce_series_columns_client_lock ON public.jobs;
CREATE TRIGGER trg_enforce_series_columns_client_lock
  BEFORE INSERT OR UPDATE OF parent_job_id, recurrence_days, recurrence_weeks, date_needed, start_time, recurrence_end_date, series_ended_on, series_split_ok ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_series_columns_client_lock();
