-- SECURITY P0: tighten guard on reject_other_applications_on_accept.
--
-- The original guard (migration 20260519010001) permitted callers whose
-- application was either 'accepted' OR 'pending'. That meant any helper who
-- had merely applied to a job (status='pending') could invoke this RPC and
-- reject every OTHER pending applicant, making themselves the only remaining
-- candidate — a self-elevation attack.
--
-- Fix: require status='accepted' AND verify the customer has actually
-- assigned this helper to the job (jobs.helper_id = caller). Both conditions
-- must hold; either alone is insufficient.
--
-- CREATE OR REPLACE is replay-safe. Grants are re-applied below because
-- CREATE OR REPLACE preserves the existing privilege set, but we mirror the
-- original migration's REVOKE/GRANT for safety in case this function is
-- recreated standalone in a from-scratch rebuild.
CREATE OR REPLACE FUNCTION public.reject_other_applications_on_accept(
  p_job_id uuid,
  p_accepted_application_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_is_winner boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE a.id = p_accepted_application_id
      AND a.job_id = p_job_id
      AND a.helper_id = v_caller
      AND a.status = 'accepted'
      AND j.helper_id = v_caller
  ) INTO v_caller_is_winner;

  IF NOT v_caller_is_winner THEN
    RAISE EXCEPTION 'caller is not the accepted helper for this job';
  END IF;

  UPDATE applications
  SET status = 'rejected', updated_at = now()
  WHERE job_id = p_job_id
    AND id <> p_accepted_application_id
    AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_other_applications_on_accept(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_other_applications_on_accept(uuid, uuid) TO authenticated;
