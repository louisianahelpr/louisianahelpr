-- Q1284: get_job_view_counts answered for ANY job id. It is SECURITY DEFINER
-- (job_views is server-only since 20261004185317) and counted distinct viewers
-- for whatever ids it was handed, so any signed-in account could read another
-- poster's view counts. Its one caller (src/pages/posts/postedJobs/
-- useJobAnalytics.ts) asks only for the caller's own posted jobs, so the count
-- is now limited to jobs whose customer_id is the caller; a stranger's ids
-- return no rows (the client already renders a missing id as 0 views).
-- Body otherwise verbatim (live 2026-10-05). Grants restated.
-- Guard: the "unscoped" section of scripts/ci/definer-exec-allowlist.json
-- (check-live-privileges: a client-callable definer body that never reads the
-- caller must be listed with a reason) + src/test/jobViewCountsOwnJobsOnly.test.ts
-- + src/test/pglite/jobViewCountsOwnJobsOnly.pglite.mjs.
CREATE OR REPLACE FUNCTION public.get_job_view_counts(p_job_ids uuid[])
 RETURNS TABLE(job_id uuid, view_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jv.job_id, COUNT(DISTINCT jv.viewer_id)::bigint
  FROM job_views jv
  JOIN jobs j ON j.id = jv.job_id
  WHERE jv.job_id = ANY(p_job_ids)
    AND j.customer_id = auth.uid()
  GROUP BY jv.job_id;
$function$;

REVOKE ALL ON FUNCTION public.get_job_view_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_job_view_counts(uuid[]) TO authenticated, service_role;
