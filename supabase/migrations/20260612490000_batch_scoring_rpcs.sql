-- Batch scoring RPCs for PostedJobsTab "Recommended" sort.
-- All three take a list of helper user IDs and return one row per helper
-- that has any qualifying data (results are joined against 0 if missing).

-- 1. Repeat-hire %: share of unique customers who hired a helper more than once.
CREATE OR REPLACE FUNCTION get_helper_repeat_hire_percents(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, repeat_hire_percent numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH customer_counts AS (
    SELECT helper_id, customer_id, COUNT(*) AS jobs_together
    FROM jobs
    WHERE helper_id = ANY(p_user_ids)
      AND status = 'completed'
    GROUP BY helper_id, customer_id
  ),
  helper_stats AS (
    SELECT
      helper_id,
      COUNT(*) AS total_unique_customers,
      COUNT(*) FILTER (WHERE jobs_together > 1) AS repeat_customers
    FROM customer_counts
    GROUP BY helper_id
    HAVING COUNT(*) >= 3
  )
  SELECT
    helper_id AS user_id,
    ROUND(100.0 * repeat_customers / NULLIF(total_unique_customers, 0)) AS repeat_hire_percent
  FROM helper_stats;
$$;
GRANT EXECUTE ON FUNCTION get_helper_repeat_hire_percents(uuid[]) TO authenticated;

-- 2. On-time arrival %: how often the helper arrived within 10 min of scheduled start.
--    Only counts completed jobs where helper_arrived_at is recorded.
--    Minimum 5 qualifying rows to return a result.
CREATE OR REPLACE FUNCTION get_helper_on_time_percents(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, on_time_percent numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH timing_rows AS (
    SELECT
      helper_id,
      helper_arrived_at,
      (date_needed + COALESCE(start_time, '00:00:00'::time))::timestamp AS scheduled_start
    FROM jobs
    WHERE helper_id = ANY(p_user_ids)
      AND status = 'completed'
      AND helper_arrived_at IS NOT NULL
      AND date_needed IS NOT NULL
  ),
  helper_stats AS (
    SELECT
      helper_id,
      COUNT(*) AS total_with_timing,
      COUNT(*) FILTER (
        WHERE helper_arrived_at::timestamp - scheduled_start <= INTERVAL '10 minutes'
      ) AS on_time_count
    FROM timing_rows
    GROUP BY helper_id
    HAVING COUNT(*) >= 5
  )
  SELECT
    helper_id AS user_id,
    ROUND(100.0 * on_time_count / NULLIF(total_with_timing, 0)) AS on_time_percent
  FROM helper_stats;
$$;
GRANT EXECUTE ON FUNCTION get_helper_on_time_percents(uuid[]) TO authenticated;

-- 3. Distance from job to each helper (km). Uses profiles.latitude/longitude
--    (added by the trust-graph migration). Returns only helpers with location data.
CREATE OR REPLACE FUNCTION get_helper_distances_from_job(
  p_job_id uuid,
  p_user_ids uuid[]
)
RETURNS TABLE(user_id uuid, distance_km numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.user_id,
    ROUND((
      6371 * acos(LEAST(1.0, GREATEST(-1.0,
        cos(radians(j.latitude)) * cos(radians(p.latitude)) *
        cos(radians(p.longitude) - radians(j.longitude)) +
        sin(radians(j.latitude)) * sin(radians(p.latitude))
      )))
    )::numeric, 1) AS distance_km
  FROM profiles p
  JOIN jobs j ON j.id = p_job_id
  WHERE p.user_id = ANY(p_user_ids)
    AND p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION get_helper_distances_from_job(uuid, uuid[]) TO authenticated;
