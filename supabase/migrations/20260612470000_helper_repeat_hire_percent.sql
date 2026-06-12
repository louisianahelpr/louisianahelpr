-- Computes the repeat-hire % for a single helper:
-- % of unique customers who hired them MORE THAN ONCE.
-- E.g. if 3 of 8 unique customers came back = 37%.
-- Returns NULL when they have 0 completed jobs (no data).
CREATE OR REPLACE FUNCTION get_user_repeat_hire_percent(p_user_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH customer_counts AS (
    SELECT customer_id, COUNT(*) AS jobs_together
    FROM jobs
    WHERE helper_id = p_user_id
      AND status = 'completed'
    GROUP BY customer_id
  )
  SELECT CASE
    WHEN COUNT(*) = 0 THEN NULL
    ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE jobs_together > 1) / COUNT(*))
  END
  FROM customer_counts;
$$;
GRANT EXECUTE ON FUNCTION get_user_repeat_hire_percent(uuid) TO authenticated, anon;
