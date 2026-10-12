-- Q1692 (lh-silent-failure review of Q1592, 2026-10-12): Admin Health's fill
-- rate still counted test jobs. Q1592 made every other Health number test-free;
-- get_fill_rate_stats (only definition 20260612230000; live prosrc md5
-- bf958fb1..., equal, measured 2026-10-12) read every job.
--
-- Restated with only these changes:
--   - a test job (jobs.is_seed) is not counted;
--   - an application from a test account (profiles.is_seed) does not make a
--     real job "filled", nor set its time to first application;
--   - same area, small (owner rule: fix the follow-up in the same branch): it
--     answered any signed-in account (EXECUTE for authenticated, no check);
--     it now answers admins only. Anyone else gets the empty summary row, which
--     the only caller (src/components/admin/adminHealth/useFillRate.ts, the
--     admin Health screen) already renders as zeros.
--
-- Replay-safe: CREATE OR REPLACE; search_path pinned in the header (it was
-- pinned by ALTER in 20260618140000); grants restated as live
-- (authenticated + service_role; REVOKE FROM PUBLIC, anon).
-- Proof: src/test/pglite/fillRateLeavesTestJobsOut.pglite.mjs. Guard: the
-- Q1592 block of src/components/admin/adminusers/adminUsersHideTestAccounts.test.ts.

CREATE OR REPLACE FUNCTION public.get_fill_rate_stats(p_days integer DEFAULT 30)
RETURNS TABLE(
  total_jobs bigint,
  filled_jobs bigint,
  fill_rate_pct numeric,
  median_minutes_to_first_app numeric,
  parish text,
  parish_fill_rate_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH job_stats AS (
    SELECT
      j.id,
      j.parish,
      j.created_at,
      MIN(ja.created_at) as first_app_at,
      COUNT(ja.id) as app_count
    FROM jobs j
    LEFT JOIN applications ja ON ja.job_id = j.id
      AND ja.created_at <= j.created_at + interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM profiles hp WHERE hp.user_id = ja.helper_id AND hp.is_seed IS TRUE)
    WHERE j.created_at >= now() - (p_days || ' days')::interval
      AND j.status != 'cancelled'
      AND NOT COALESCE(j.is_seed, false)
      AND public.has_role((SELECT auth.uid()), 'admin')
    GROUP BY j.id, j.parish, j.created_at
  ),
  overall AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE app_count > 0) as filled,
      ROUND(100.0 * COUNT(*) FILTER (WHERE app_count > 0) / NULLIF(COUNT(*), 0), 1) as rate,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (first_app_at - created_at)) / 60
      ) FILTER (WHERE first_app_at IS NOT NULL) as median_mins
    FROM job_stats
  )
  SELECT
    overall.total,
    overall.filled,
    overall.rate,
    ROUND(overall.median_mins::numeric, 0),
    NULL::text,
    NULL::numeric
  FROM overall
  UNION ALL
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE app_count > 0),
    ROUND(100.0 * COUNT(*) FILTER (WHERE app_count > 0) / NULLIF(COUNT(*), 0), 1),
    NULL,
    parish,
    ROUND(100.0 * COUNT(*) FILTER (WHERE app_count > 0) / NULLIF(COUNT(*), 0), 1)
  FROM job_stats
  GROUP BY parish
  ORDER BY 1 DESC NULLS FIRST;
$$;

REVOKE ALL ON FUNCTION public.get_fill_rate_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fill_rate_stats(integer) TO authenticated, service_role;
