-- Q2408 "Any time this week" (owner: BUILD; lead 11-05): the Not picked row of a Helpr's Activity printed only the
-- window's first day, because get_closed_application_job_labels (20261031021424, JOBS-12) returns title and date_needed
-- only. This adds date_window_end (the window's last day, NULL for a one-day job), so the row prints "Any day Nov 4-10"
-- through jobDayLabel. Same caller check, same rows, same grants; the body is restated, only the column list grows.
--
-- The return type changes, so CREATE OR REPLACE cannot do it: DROP + CREATE (no other function or view depends on it).
-- Replay-safe: DROP ... IF EXISTS, then the full definition and its grants.
-- Proof: src/test/pglite/closedApplicationJobLabelsWindow.pglite.mjs (W1-W3).

DROP FUNCTION IF EXISTS public.get_closed_application_job_labels();

CREATE FUNCTION public.get_closed_application_job_labels()
 RETURNS TABLE(job_id uuid, title text, date_needed date, date_window_end date)
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
  SELECT j.id, j.title, j.date_needed, j.date_window_end
    FROM public.jobs j
   WHERE EXISTS (
           SELECT 1 FROM public.applications a
            WHERE a.job_id = j.id AND a.helper_id = v_uid
         );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_closed_application_job_labels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_closed_application_job_labels() TO authenticated, service_role;
