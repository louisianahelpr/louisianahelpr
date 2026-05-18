-- Atomic poster-side application accept — closes a double-booking race.
--
-- Before this, accepting an applicant was two unguarded client updates
-- (applications + jobs) with no row lock and no status check. A poster
-- with the applicant list open in two tabs/devices could accept two
-- different helpers for the same single-helper job: the second jobs
-- update silently overwrote helper_id, but BOTH applications stayed
-- "accepted", so two helpers each saw "you were picked".
--
-- accept_application() takes a row lock on the job, verifies the caller
-- owns it and it is still "open", then assigns the helper + accepts the
-- application in one transaction. Concurrent callers serialize on the
-- FOR UPDATE lock; whichever runs second finds the job no longer "open"
-- and is rejected with a clear error the client can show.

CREATE OR REPLACE FUNCTION public.accept_application(
  p_application_id uuid,
  p_deadline timestamptz,
  p_offer_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job_id uuid;
  v_helper_id uuid;
  v_app_status text;
  v_job_status text;
  v_job_customer uuid;
BEGIN
  -- Resolve the application and the job it belongs to. The job is
  -- derived from the application itself, so a poster can only ever
  -- accept against a job that application actually belongs to.
  SELECT a.job_id, a.helper_id, a.status
    INTO v_job_id, v_helper_id, v_app_status
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Lock the job row — concurrent accepts serialize here.
  SELECT j.status, j.customer_id
    INTO v_job_status, v_job_customer
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- Authorize: only the job's poster may accept an applicant.
  IF v_job_customer IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Race guard: the job must still be open. The second of two
  -- concurrent accepts hits this and is rejected.
  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_app_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;

  UPDATE public.applications
     SET status = 'accepted',
         offer_message = COALESCE(p_offer_message, offer_message)
   WHERE id = p_application_id;

  UPDATE public.jobs
     SET status = 'accepted',
         helper_id = v_helper_id,
         response_deadline = p_deadline
   WHERE id = v_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_application(uuid, timestamptz, text) TO authenticated;
