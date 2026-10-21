-- Board 66/172, slice 3 (PLAN-66-172, owner default 6: "Poster may withdraw a pending time request: yes"; one rule
-- for both sides, never role-based): whoever asked to move a booked job can take the request back while it is
-- still pending. Before this there was no way out but to wait for an answer or for it to lapse at the start.
--
-- 1. job_schedule_change_requests.status gains 'withdrawn' (a wider CHECK; no row changes).
-- 2. withdraw_job_schedule_change(p_request_id): only the person who asked, only while pending, only while they are
--    still that party on the job; marks it withdrawn and tells the other person in role-neutral words. Same lock
--    order as respond_job_schedule_change (the job FOR UPDATE, then the request), so a withdraw and an answer
--    racing on one request take turns: whichever runs second sees it is no longer pending and changes nothing.
-- The responder's "Suggest another time" needs no server change: request_job_schedule_change already replaces the
-- pending request and tells the other side "This replaces their earlier request".
-- Proof: node src/test/pglite/withdrawJobScheduleChange.pglite.mjs (red without the file, 3x apply).

ALTER TABLE public.job_schedule_change_requests DROP CONSTRAINT IF EXISTS job_schedule_change_requests_status_check;
ALTER TABLE public.job_schedule_change_requests ADD CONSTRAINT job_schedule_change_requests_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'replaced', 'withdrawn'));

CREATE OR REPLACE FUNCTION public.withdraw_job_schedule_change(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
  v_job record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  SELECT r.job_id INTO v_req FROM public.job_schedule_change_requests r WHERE r.id = p_request_id;
  IF v_req.job_id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.date_needed, j.start_time
    INTO v_job
    FROM public.jobs j
   WHERE j.id = v_req.job_id
   FOR UPDATE;
  SELECT r.* INTO v_req FROM public.job_schedule_change_requests r WHERE r.id = p_request_id FOR UPDATE;

  -- Only the person who asked, and only while they are still that party on the job.
  IF v_uid IS DISTINCT FROM v_req.requested_by
     OR (v_uid IS DISTINCT FROM v_job.customer_id AND v_uid IS DISTINCT FROM v_job.helper_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('status', v_req.status);
  END IF;
  -- A request that can no longer be answered (lapsed at the start, the job cancelled or moved, or the person it
  -- asked is no longer on the job) is closed as expired, telling nobody: the other side may not be on the job any
  -- more, and "it stays on <date>" would not be true (lh-authz-rls review M1).
  IF now() >= v_req.expires_at
     OR v_job.status::text <> 'accepted'
     OR v_job.date_needed IS DISTINCT FROM v_req.old_date
     OR v_job.start_time IS DISTINCT FROM v_req.old_start_time
     OR v_req.responder_id IS DISTINCT FROM
        (CASE WHEN v_uid = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END) THEN
    UPDATE public.job_schedule_change_requests SET status = 'expired', decided_at = now() WHERE id = v_req.id;
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  UPDATE public.job_schedule_change_requests SET status = 'withdrawn', decided_at = now() WHERE id = v_req.id;

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_req.responder_id, v_job.id,
    'Date or time request withdrawn',
    format('%s took back their request to move "%s". It stays on %s%s.',
           CASE WHEN v_uid = v_job.customer_id THEN 'The person who posted it' ELSE 'The Helpr doing it' END,
           COALESCE(v_job.title, 'your job'),
           to_char(v_req.old_date, 'FMDy FMMon FMDD'),
           CASE WHEN v_req.old_start_time IS NULL THEN '' ELSE ' at ' || to_char(v_req.old_start_time, 'FMHH12:MI AM') END),
    'job_updates',
    CASE WHEN v_req.responder_id = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
  );

  RETURN jsonb_build_object('status', 'withdrawn');
END;
$fn$;

REVOKE ALL ON FUNCTION public.withdraw_job_schedule_change(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_job_schedule_change(uuid) TO authenticated, service_role;
