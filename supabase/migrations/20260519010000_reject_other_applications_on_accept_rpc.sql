-- Helper-side accept path needs to reject other pending applicants on the same
-- job, but RLS on applications.UPDATE only permits the customer. The direct
-- UPDATE the client was issuing was RLS-filtered to zero rows, leaving other
-- applicants stuck in "pending" indefinitely. This SECURITY DEFINER RPC lets
-- the accepted helper close out the other applications atomically while still
-- gating on caller identity.
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
    SELECT 1 FROM applications
    WHERE id = p_accepted_application_id
      AND job_id = p_job_id
      AND helper_id = v_caller
      AND status IN ('accepted', 'pending')
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
