-- Fill rate: jobs that got at least 1 application within 24h, with per-parish breakdown.
-- Replay-safe: CREATE OR REPLACE means re-running from scratch is fine.
CREATE OR REPLACE FUNCTION get_fill_rate_stats(p_days integer DEFAULT 30)
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
    WHERE j.created_at >= now() - (p_days || ' days')::interval
      AND j.status != 'cancelled'
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

GRANT EXECUTE ON FUNCTION get_fill_rate_stats TO authenticated;
