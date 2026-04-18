-- Top parishes by recent activity for the admin dashboard widget
CREATE OR REPLACE FUNCTION public.get_parish_activity(p_limit integer DEFAULT 5)
RETURNS TABLE(
  parish text,
  active_jobs integer,
  completed_jobs_30d integer,
  revenue_30d numeric,
  helper_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH job_stats AS (
    SELECT
      COALESCE(j.parish, 'Unknown') AS parish,
      COUNT(*) FILTER (WHERE j.status IN ('open','accepted','in_progress'))::int AS active_jobs,
      COUNT(*) FILTER (
        WHERE j.status = 'completed'
          AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days'
      )::int AS completed_jobs_30d,
      COALESCE(SUM(
        CASE
          WHEN j.status = 'completed'
            AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days'
          THEN COALESCE(j.platform_fee_amount, 0) + COALESCE(j.customer_fee_amount, 0)
          ELSE 0
        END
      ), 0)::numeric(10,2) AS revenue_30d
    FROM public.jobs j
    WHERE j.parish IS NOT NULL
    GROUP BY COALESCE(j.parish, 'Unknown')
  ),
  helper_stats AS (
    SELECT p.parish, COUNT(*)::int AS helper_count
    FROM public.profiles p
    WHERE p.role = 'helper' AND p.parish IS NOT NULL
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
    GROUP BY p.parish
  )
  SELECT
    js.parish,
    js.active_jobs,
    js.completed_jobs_30d,
    js.revenue_30d,
    COALESCE(hs.helper_count, 0) AS helper_count
  FROM job_stats js
  LEFT JOIN helper_stats hs ON hs.parish = js.parish
  WHERE (js.active_jobs + js.completed_jobs_30d) > 0
  ORDER BY (js.active_jobs * 2 + js.completed_jobs_30d) DESC, js.revenue_30d DESC
  LIMIT p_limit;
$$;