-- Q768 (docs/OPEN.md; owner decision 2026-09-27, pop-up: "Import as drafts").
--
-- str-ical-sync used to INSERT a jobs row for every guest checkout, unpaid,
-- which no Helpr can see and the host has no way to fund (Q767 removed Fund &
-- Publish). It now records the checkout in str_processed_events with job_id
-- NULL and tells the host; the host opens it in Post a Job
-- (/post-job?turnover=<event id>), which pre-fills the cleaning job, and pays
-- like any new post.
--
-- This function is the one write the host makes on that row: once their post
-- is created, point the turnover at it, so Post a Job knows it is already
-- posted. str_processed_events has no UPDATE policy (the sync writes it with
-- the service role), so the write goes through this definer function, which
-- checks that the caller owns BOTH the turnover's calendar and the job, and
-- links only a turnover that is not linked yet. Returns true when it linked.
--
-- Replay-safe: CREATE OR REPLACE, grants restated.

CREATE OR REPLACE FUNCTION public.link_str_turnover_job(p_event_id uuid, p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_rows integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  -- FOR SHARE: the ownership read decides the write (race-class rule).
  IF NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.customer_id = v_uid FOR SHARE) THEN
    RAISE EXCEPTION 'not your job' USING ERRCODE = '42501';
  END IF;
  UPDATE public.str_processed_events e
     SET job_id = p_job_id
   WHERE e.id = p_event_id
     AND e.job_id IS NULL
     AND EXISTS (SELECT 1 FROM public.str_calendar_connections c
                  WHERE c.id = e.connection_id AND c.user_id = v_uid);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;

REVOKE ALL ON FUNCTION public.link_str_turnover_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_str_turnover_job(uuid, uuid) TO authenticated, service_role;
