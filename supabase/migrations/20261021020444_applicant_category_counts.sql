-- Board 188 (proof on applicants): how many jobs IN THIS JOB'S CATEGORY each applicant has completed on
-- Helpr, for the poster choosing between them ("12 pressure washing jobs on Helpr · 31 total").
--
-- Narrower than get_helper_completed_counts (any ids, any caller): this answers only the job's own
-- poster, only about people who applied to that job, and only a count. A completed job counts for the
-- Helpr who did it, exactly as get_helper_completed_counts counts it (20260927012241: the single Helpr,
-- or every member of a crew's roster, Q728), restricted to jobs whose category equals this job's.
--
-- Not the poster (or no such job): an empty result, never an error that tells a stranger the job exists.
-- SECURITY DEFINER because the poster cannot read other people's completed jobs; the WHERE pins the
-- caller to the job's customer_id and the ids to that job's applications.
-- Behind the hidden switch 'applicant_proof' (testers until the owner opens it): the RPC refuses without it.
-- Replay-safe: ON CONFLICT DO NOTHING + CREATE OR REPLACE. Grants by role name.
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('applicant_proof', 'testers', 'Board 188: each applicant''s completed jobs in this job''s category, shown to the job''s poster')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_applicant_category_counts(p_job_id uuid)
RETURNS TABLE(helper_id uuid, category_completed bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('applicant_proof');
  RETURN QUERY
  WITH job AS (
    SELECT j.id, j.category
    FROM public.jobs j
    WHERE j.id = p_job_id AND (SELECT auth.uid()) IS NOT NULL AND j.customer_id = (SELECT auth.uid())
  ),
  applicants AS (
    SELECT DISTINCT a.helper_id AS hid
    FROM public.applications a JOIN job ON a.job_id = job.id
    WHERE a.helper_id IS NOT NULL
  )
  SELECT ap.hid, COUNT(DISTINCT d.id)::bigint
  FROM applicants ap
  CROSS JOIN job
  JOIN public.jobs d
    ON d.status = 'completed'
   AND d.category = job.category
   AND (d.helper_id = ap.hid
        OR (d.is_group_job IS TRUE AND EXISTS (
              SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = d.id AND g.helper_id = ap.hid)))
  GROUP BY ap.hid;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_applicant_category_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_applicant_category_counts(uuid) TO authenticated, service_role;
