-- Q2080: a visit time offered by a Helpr who then left the job no longer shows to the next Helpr (or the tenant).
--
-- rentals_propose_visit (newest 20261103150842) ties the offer to the JOB (maintenance_requests.visit_job_id), not to
-- the Helpr who made it. When that Helpr backs out and another is hired on the same job, the old offer (and the
-- tenant's OK of it) kept reading as current on the request screen (visit_job_id = job_id), on the new Helpr's card
-- (rentals_visit_for_job) and in rentals_confirm_visit, until the new Helpr offered a time.
--
-- Fix: when a job's helper_id changes, the offer made on that job is cleared (time, when it was offered, the OK, and
-- visit_job_id). Every reader already treats "no offer" correctly, so none is restated. The tenant is not told: the
-- offer they may have OK'd was the old Helpr's, and the new Helpr's offer notifies them as usual.

CREATE OR REPLACE FUNCTION public.rentals_clear_visit_on_helper_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.maintenance_requests
     SET visit_job_id = NULL, visit_proposed_for = NULL, visit_proposed_at = NULL, visit_confirmed_at = NULL,
         updated_at = now()
   WHERE visit_job_id = NEW.id;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_clear_visit_on_helper_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS jobs_helper_change_clears_rentals_visit ON public.jobs;
CREATE TRIGGER jobs_helper_change_clears_rentals_visit
  AFTER UPDATE OF helper_id ON public.jobs
  FOR EACH ROW
  WHEN (OLD.helper_id IS DISTINCT FROM NEW.helper_id)
  EXECUTE FUNCTION public.rentals_clear_visit_on_helper_change();
