-- Q357: authenticated holds table-level INSERT/UPDATE on jobs, so a poster
-- could PATCH recurrence_days onto a job whose helper was already hired
-- (charge-recurring-visits would then book that helper for visits they never
-- agreed to) or point parent_job_id at any series. Measured on prod
-- 2026-09-24 with a rolled-back probe: both UPDATEs hit 1 row on an
-- in_progress seed job.
--
-- Only charge-recurring-visits (service_role) creates child visits, so a
-- client never sets parent_job_id. A client sets recurrence_days when it
-- posts the job, and may not change it once a helper is hired.
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
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_series_columns_client_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_series_columns_client_lock ON public.jobs;
CREATE TRIGGER trg_enforce_series_columns_client_lock
  BEFORE INSERT OR UPDATE OF parent_job_id, recurrence_days ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_series_columns_client_lock();
