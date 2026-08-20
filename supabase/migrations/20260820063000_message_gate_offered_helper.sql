-- can_message_in_job(): let an OFFERED or ASSIGNED helper open the thread.
--
-- Owner rule (2026-08-19, verbatim): "they should not be able to message job
-- posters until they are offered the job or the poster messages them first."
-- Explicitly decided: merely APPLYING to a job does NOT earn messaging rights,
-- and existing threads are NOT retroactively closed.
--
-- The function already had the poster branch and the poster-messaged-first
-- branch. What it never had was the OFFER branch — verified against the live
-- database, not just the repo. So a helper who had been offered a job, or who
-- had already been assigned to it (jobs.helper_id), still could not send the
-- first message. `messages` INSERT is gated on this function
-- ("Users can send messages" WITH CHECK), so the effect was a helper unable to
-- ask a single question about a job they were actively working.
--
-- Adding the offer branch only WIDENS access, and only to the two people the
-- job already names. It does not loosen the applicant rule: `applications` is
-- deliberately not referenced here, so a pending applicant still cannot message.
CREATE OR REPLACE FUNCTION public.can_message_in_job(_job_id uuid, _sender uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    -- 1. The poster of the job.
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = _job_id AND j.customer_id = _sender
    )
    -- 2. The helper this job is offered to, or already assigned to.
    --    NULL-safe: `= _sender` is never true when the column is NULL, so an
    --    un-offered, un-assigned job matches nobody here.
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = _job_id
        AND (j.offered_to_helper_id = _sender OR j.helper_id = _sender)
    )
    -- 3. The poster messaged THIS sender first.
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      JOIN public.jobs j ON j.id = m.job_id
      WHERE m.job_id = _job_id
        AND m.sender_id = j.customer_id
        AND m.receiver_id = _sender
    );
$function$;

-- Keep the hardening from 20260819060000: anon must never hold EXECUTE.
-- Guarded so a from-scratch replay cannot abort here.
DO $$
BEGIN
  IF to_regprocedure('public.can_message_in_job(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.can_message_in_job(uuid, uuid) FROM anon';
  END IF;
END $$;
