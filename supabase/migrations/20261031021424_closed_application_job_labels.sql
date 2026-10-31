-- JOBS-12: a Helpr's Not picked tab was a list of nameless rows. Once a job closes to them, jobs' SELECT policies and
-- get_jobs_for_my_applications hide its row, so the card has no title or date.
--
-- This returns only the title and date of a job the caller applied to: words they saw when they applied. No address,
-- poster, price or status. A job with no row left returns nothing and the card keeps its plain line. Read-only.
-- Replay-safe (CREATE OR REPLACE). Proof: src/test/pglite/closedApplicationJobLabels.pglite.mjs

CREATE OR REPLACE FUNCTION public.get_closed_application_job_labels()
 RETURNS TABLE(job_id uuid, title text, date_needed date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT j.id, j.title, j.date_needed
    FROM public.jobs j
   WHERE EXISTS (
           SELECT 1 FROM public.applications a
            WHERE a.job_id = j.id AND a.helper_id = v_uid
         );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_closed_application_job_labels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_closed_application_job_labels() TO authenticated, service_role;
