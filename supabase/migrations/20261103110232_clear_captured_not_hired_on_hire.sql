-- Q2447 (lead PASS 11-03): a held card captured for an accept that was then refused is marked
-- job_card_holds.failure_code = 'captured_not_hired' (create-payment capture_hold, card-hold-sweep), and
-- void-cancelled-payments refunds a job that closes with that mark and nobody hired IN FULL, card fee
-- included (the charge happened only because of our own race; owner's own-mistake rule, 2026-10-14).
--
-- The mark must not outlive a real hire: a Helpr hired later on that same captured money (any path:
-- accept_job_offer, respond_to_direct_offer, complete_job_accept, a crew Confirm), then removed before the
-- job closed, is an ordinary cancelled job whose card fee is kept. So the mark is cleared the moment a hire
-- completes on the job, from the one place every hire path writes: jobs.helper_confirmed_at going from NULL to
-- a time, or a crew seat's group_job_helpers.helper_confirmed_at being set.
--
-- Only a 'captured_not_hired' mark is cleared (any other failure_code is left alone). No money moves here.
-- REPLAY-SAFETY: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE TRIGGER; job_card_holds and
-- group_job_helpers exist before this file (20261027185146, 20260311041556).

CREATE OR REPLACE FUNCTION public.clear_captured_not_hired_on_hire()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job uuid;
BEGIN
  IF TG_TABLE_NAME = 'jobs' THEN
    v_job := NEW.id;
  ELSE
    v_job := NEW.job_id;
  END IF;
  UPDATE public.job_card_holds
     SET failure_code = NULL,
         failure_message = NULL,
         updated_at = now()
   WHERE job_id = v_job
     AND failure_code = 'captured_not_hired';
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.clear_captured_not_hired_on_hire() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_hire_clears_captured_not_hired ON public.jobs;
CREATE TRIGGER trg_jobs_hire_clears_captured_not_hired
  AFTER UPDATE OF helper_confirmed_at ON public.jobs
  FOR EACH ROW
  WHEN (OLD.helper_confirmed_at IS NULL AND NEW.helper_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.clear_captured_not_hired_on_hire();

DROP TRIGGER IF EXISTS trg_crew_seat_hire_clears_captured_not_hired ON public.group_job_helpers;
CREATE TRIGGER trg_crew_seat_hire_clears_captured_not_hired
  AFTER INSERT OR UPDATE OF helper_confirmed_at ON public.group_job_helpers
  FOR EACH ROW
  WHEN (NEW.helper_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.clear_captured_not_hired_on_hire();
