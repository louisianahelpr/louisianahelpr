-- The missing writer that silently killed every recurring series
-- (2026-08-24, owner asked "is recurring set up?" — the answer was almost).
--
-- charge-recurring-visits funds visit N+1 only for parents with
-- recurring_helper_id set ("we never charge for a visit nobody is committed
-- to"). But NOTHING ever wrote that column: not accept_application, not
-- respond_to_direct_offer, not the client (verified against live pg_proc —
-- zero writers, zero non-null rows). So a poster could pick Mon/Wed/Fri for
-- six weeks, fund visit #1, hire someone — and visits 2..N would never be
-- funded or created. No error anywhere; the series just… stopped.
--
-- FIX, at the data layer so every hire path present and future is covered:
-- when a helper COMMITS to a recurring parent (their helper_confirmed_at
-- stamp lands — the moment the cron's own comment calls commitment), the
-- parent records them as the series helper. And when that committed helper
-- un-commits (helper_id cleared by cancel/decline/expiry), the series
-- PAUSES (recurring_helper_id clears) rather than keep charging the poster
-- for visits with a helper who quit; it resumes when someone new commits.

CREATE OR REPLACE FUNCTION public.stamp_recurring_series_helper()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Commitment lands → series helper recorded (parents only).
  IF NEW.recurrence_days IS NOT NULL
     AND NEW.parent_job_id IS NULL
     AND NEW.helper_confirmed_at IS NOT NULL
     AND OLD.helper_confirmed_at IS NULL
     AND NEW.helper_id IS NOT NULL
     AND NEW.recurring_helper_id IS NULL THEN
    NEW.recurring_helper_id := NEW.helper_id;
  END IF;

  -- The committed series helper leaves → the series pauses.
  IF OLD.recurring_helper_id IS NOT NULL
     AND OLD.helper_id = OLD.recurring_helper_id
     AND NEW.helper_id IS NULL THEN
    NEW.recurring_helper_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_recurring_series_helper ON public.jobs;
CREATE TRIGGER trg_stamp_recurring_series_helper
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_recurring_series_helper();
