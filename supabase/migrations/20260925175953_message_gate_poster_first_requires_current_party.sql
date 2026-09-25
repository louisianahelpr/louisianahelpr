-- Q410: can_message_in_job branch 4 ("the poster messaged THIS sender first")
-- had no membership or status check, so it never ended.
--
-- Once a poster had messaged someone on a job, that person could keep posting
-- on the job for as long as the job was open, even after
--   * being removed from a crew: the group_job_helpers row is DELETEd (poster
--     while staffing, or the member via helper_cancel_booking) and
--     sync_job_after_roster_departure turns their application accepted ->
--     rejected, which drops them out of branch 3 but not out of branch 4; or
--   * having their application rejected.
-- The poster-first rule (20260608000000) exists so an APPLICANT waits for the
-- poster to open the conversation. It was never meant to outlive the
-- application.
--
-- Fix: branch 4 now also requires the sender to hold a CURRENT application on
-- the job (status pending or accepted). Everyone else a job thread has is
-- already a party through its own branch, unchanged:
--   branch 1  the poster;
--   branch 2  the hired Helpr (jobs.helper_id) or the offered Helpr
--             (jobs.offered_to_helper_id);
--   branch 3  a current crew member: a group_job_helpers row exists. Group jobs
--             carry helper_id NULL from 20260925154606 (a crew has no lead), so
--             this branch is the whole crew; a removed member has no row.
-- So "still a party" = branch 1, 2 or 3, or branch 4 with a live application.
--
-- The post-completion 24h window (branch 0, job_messaging_closes_at, including
-- the cancelled arm from 20260919220233) is untouched and still ANDed in front
-- of every branch: current parties keep 24h after completion, nobody posts
-- after it, and a cancelled job's thread is closed at once. The window never
-- ADMITS anyone who is not a party; it only closes the thread for those who are.
--
-- Built from the NEWEST definition, 20260914201350_messaging_lockout_24h_after_completion.sql
-- (no later migration redefines can_message_in_job: 20260919220233 changed only
-- job_messaging_closes_at, and 20260925154606_group_crew_has_no_lead.sql names
-- this function in a comment only). Branches 0-3 verbatim; branch 4 gains the
-- application condition. Grants restated from the same file:
-- {postgres, service_role} only; the two policies reach it through
-- can_send_message_in_job / can_send_message_to_in_job, which read auth.uid().
--
-- Not checked live (no read access to prod from this lane): the shape above is
-- read from the migrations. Verify after deploy with pg_get_functiondef and
-- pg_proc.proacl (docs/OPEN.md Q410).
--
-- Replay-safe: CREATE OR REPLACE, idempotent grants, and skipped (NOTICE) when
-- any object the body reads is absent.

DO $q410$
BEGIN
  IF to_regclass('public.jobs') IS NULL
     OR to_regclass('public.messages') IS NULL
     OR to_regclass('public.group_job_helpers') IS NULL
     OR to_regclass('public.applications') IS NULL
     OR to_regprocedure('public.job_messaging_closes_at(uuid)') IS NULL THEN
    RAISE NOTICE 'jobs / messages / group_job_helpers / applications / job_messaging_closes_at absent: Q410 skipped';
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.can_message_in_job(_job_id uuid, _sender uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    -- 0. Lockout: 24h after completion nobody on the job may post a new
    --    message. COALESCE(..., true): a job that is not completed has no
    --    closing time and stays open.
    COALESCE(public.job_messaging_closes_at(_job_id) > now(), true)
    AND (
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
      -- 3. A member of this job's group roster (the whole crew: a group job's
      --    helper_id is NULL). Removal deletes the row.
      OR EXISTS (
        SELECT 1 FROM public.group_job_helpers g
        WHERE g.job_id = _job_id AND g.helper_id = _sender
      )
      -- 4. The poster messaged THIS sender first, AND the sender still holds a
      --    live application on the job (Q410). A rejected applicant, or a crew
      --    member removed from the roster (application -> rejected), no longer
      --    passes.
      OR (
        EXISTS (
          SELECT 1
          FROM public.messages m
          JOIN public.jobs j ON j.id = m.job_id
          WHERE m.job_id = _job_id
            AND m.sender_id = j.customer_id
            AND m.receiver_id = _sender
        )
        AND EXISTS (
          SELECT 1 FROM public.applications a
          WHERE a.job_id = _job_id
            AND a.helper_id = _sender
            AND a.status IN ('pending', 'accepted')
        )
      )
    );
$function$
$fn$;

  -- Internal: no client role may call it with an arbitrary sender id. Roles
  -- named: FROM PUBLIC alone leaves anon's own grant in place.
  REVOKE ALL ON FUNCTION public.can_message_in_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.can_message_in_job(uuid, uuid) TO service_role;
END
$q410$;
