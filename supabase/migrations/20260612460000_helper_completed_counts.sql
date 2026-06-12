-- Batch-fetch completed job counts for a list of helpers.
-- Used by PostedJobsTab to feed the completedJobs dimension in
-- scoreApplicant — improves "Recommended" sort accuracy.
CREATE OR REPLACE FUNCTION get_helper_completed_counts(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, completed_jobs bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT j.helper_id, COUNT(*)::bigint
  FROM jobs j
  WHERE j.helper_id = ANY(p_user_ids)
    AND j.status = 'completed'
  GROUP BY j.helper_id;
$$;
GRANT EXECUTE ON FUNCTION get_helper_completed_counts(uuid[]) TO authenticated;
