-- Hardening from the fixture round (2026-08-24): the series-helper stamp
-- fired on UPDATE only, so a jobs row INSERTED already-confirmed (no real
-- flow does this today — but seeds, imports, and future paths can) skipped
-- the stamp and the funding cron would silently ignore the series. Same
-- TG_OP branching the accepted_at stamp already uses.
CREATE OR REPLACE FUNCTION public.stamp_recurring_series_helper()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.recurrence_days IS NOT NULL
     AND NEW.parent_job_id IS NULL
     AND NEW.helper_confirmed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL)
     AND NEW.helper_id IS NOT NULL
     AND NEW.recurring_helper_id IS NULL THEN
    NEW.recurring_helper_id := NEW.helper_id;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.recurring_helper_id IS NOT NULL
     AND OLD.helper_id = OLD.recurring_helper_id
     AND NEW.helper_id IS NULL THEN
    NEW.recurring_helper_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_recurring_series_helper ON public.jobs;
CREATE TRIGGER trg_stamp_recurring_series_helper
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_recurring_series_helper();
