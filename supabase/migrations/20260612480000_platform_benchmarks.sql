-- Platform-wide benchmark stats for HelperAnalytics comparison cards.
-- Returns the last-90-day application acceptance rate and the overall
-- average review rating across all published reviews.
-- STABLE + SECURITY DEFINER: returns aggregate stats only, no row-level data.
CREATE OR REPLACE FUNCTION get_platform_benchmarks()
RETURNS TABLE(
  avg_application_success_rate integer,
  avg_helper_rating numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(
      (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'accepted') / NULLIF(COUNT(*), 0))::integer
       FROM applications WHERE created_at > now() - INTERVAL '90 days'),
      32
    ),
    COALESCE(
      (SELECT ROUND(AVG(rating)::numeric, 1)
       FROM reviews WHERE status = 'published'),
      4.2
    );
$$;

GRANT EXECUTE ON FUNCTION get_platform_benchmarks() TO authenticated, anon;
