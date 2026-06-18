-- Impact stats RPC — public transparency page
-- Returns platform-wide aggregate metrics (jobs, earnings, helpers, parishes).
-- SECURITY DEFINER + STABLE so anon can call it without touching row-level data.

CREATE OR REPLACE FUNCTION get_platform_impact_stats()
RETURNS TABLE(
  total_jobs_completed bigint,
  total_earnings_circulated numeric,
  total_helpers_active bigint,
  total_parishes_served bigint,
  total_posters bigint,
  avg_response_minutes numeric,
  jobs_this_month bigint,
  earnings_this_month numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    COUNT(*) FILTER (WHERE status = 'completed'),
    COALESCE(SUM(budget) FILTER (WHERE status = 'completed'), 0),
    COUNT(DISTINCT helper_id) FILTER (WHERE helper_id IS NOT NULL AND status = 'completed'),
    COUNT(DISTINCT location) FILTER (WHERE status = 'completed' AND location IS NOT NULL),
    COUNT(DISTINCT customer_id),
    ROUND(AVG(
      EXTRACT(EPOCH FROM (
        SELECT MIN(ja.created_at) FROM applications ja WHERE ja.job_id = jobs.id
      ) - jobs.created_at) / 60
    ) FILTER (WHERE status != 'open'), 0),
    COUNT(*) FILTER (WHERE status = 'completed' AND created_at >= date_trunc('month', now())),
    COALESCE(SUM(budget) FILTER (WHERE status = 'completed' AND created_at >= date_trunc('month', now())), 0)
  FROM jobs;
$$;

GRANT EXECUTE ON FUNCTION get_platform_impact_stats() TO anon, authenticated;
