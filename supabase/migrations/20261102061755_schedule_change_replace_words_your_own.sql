-- Q2297 (docs/OPEN.md; lh-authz-rls review L1 of ready/builder2h-jobs-15, 2026-10-21): when the person asked to move
-- a job answers with "Suggest another time", request_job_schedule_change replaces the ORIGINAL asker's pending request
-- and tells that asker "This replaces their earlier request", but the replaced request was their own. Now the notice
-- says "This replaces your earlier request." when the replaced row was requested by the person being told (v_other),
-- and "their" otherwise (the same person asking again).
--
-- Restated VERBATIM from its newest definition (20261021102943_refund_requests.sql, section 6b) with only:
--   + v_replaced_theirs, counted from the pending rows requested_by = v_other just before the UPDATE closes them;
--   + the notice's last clause picks "your" / "their" from it.
-- Every raise code, the v_finish (come back and finish) path and the return shape are unchanged.
-- Replay-safe: CREATE OR REPLACE with the same signature; grants restated (anon and PUBLIC revoked by name).

CREATE OR REPLACE FUNCTION public.request_job_schedule_change(p_job_id uuid, p_date date, p_start_time time)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_other uuid;
  v_starts_at timestamptz;
  v_new_at timestamptz;
  v_id uuid;
  v_replaced int;
  v_replaced_theirs int;
  v_finish boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.date_needed, j.start_time,
         j.parent_job_id, j.recurrence_days, j.is_group_job, j.helper_completed_at,
         j.estimated_hours
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_uid IS DISTINCT FROM v_job.customer_id AND v_uid IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.parent_job_id IS NOT NULL OR v_job.recurrence_days IS NOT NULL OR COALESCE(v_job.is_group_job, false) THEN
    RAISE EXCEPTION 'schedule_change_not_one_time';
  END IF;
  -- Q2326: the Helpr answering a live refund request on this job with "Come
  -- back and finish" (rpc_answer_refund_request sets the flag just around
  -- this call). Never a direct call: without the flag nothing changes here.
  v_finish := COALESCE(current_setting('app.refund_finish_rpc', true), '') = '1'
    AND v_job.status::text = 'in_progress'
    AND v_job.helper_id IS NOT NULL
    AND v_uid IS NOT DISTINCT FROM v_job.helper_id
    AND EXISTS (SELECT 1 FROM public.refund_requests rr
                 WHERE rr.job_id = v_job.id
                   AND rr.status = 'open'
                   AND rr.responder_id = v_uid
                   AND rr.answer_by > now());
  IF NOT v_finish AND (v_job.status::text <> 'accepted' OR v_job.helper_id IS NULL OR v_job.helper_completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'schedule_change_not_booked';
  END IF;

  v_starts_at := (v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF NOT v_finish AND now() >= v_starts_at THEN
    RAISE EXCEPTION 'schedule_change_too_late';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'schedule_change_invalid';
  END IF;
  v_new_at := (p_date + COALESCE(p_start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF v_new_at <= now() THEN
    RAISE EXCEPTION 'schedule_change_in_past';
  END IF;
  -- At least an hour out (owner, 2026-10-08): a request for a start minutes
  -- away was accepted 19 s after that start and expired with nobody told
  -- (request 1f6349c9). An hour leaves the other person time to answer.
  IF v_new_at < now() + interval '1 hour' THEN
    RAISE EXCEPTION 'schedule_change_too_soon';
  END IF;
  IF p_date = v_job.date_needed AND p_start_time IS NOT DISTINCT FROM v_job.start_time THEN
    RAISE EXCEPTION 'schedule_change_same';
  END IF;

  -- Q736: the new start must not overlap another booking the Helpr already
  -- holds (their own hire, or a crew seat), ending at start + estimated_hours
  -- (1 hour when unset). A time-less side ("any time that day") is flexible
  -- and never clashes.
  IF p_start_time IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.jobs o
     WHERE o.id <> v_job.id
       AND o.date_needed = p_date
       AND o.start_time IS NOT NULL
       -- Q1676: the same booking rule as helpr_booking_clashes (20261012171958):
       -- their own hire while accepted / in progress and not yet marked done,
       -- OR a crew seat they hold (accepted, not marked done on their own row)
       -- on a crew job that is open (still filling), accepted or in progress.
       AND ((o.helper_id = v_job.helper_id
             AND o.status::text IN ('accepted', 'in_progress')
             AND o.helper_completed_at IS NULL)
            OR (o.status::text IN ('open', 'accepted', 'in_progress')
                AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                             WHERE g.job_id = o.id AND g.helper_id = v_job.helper_id
                               AND g.status = 'accepted'
                               AND g.helper_completed_at IS NULL)))
       AND (p_date + p_start_time, p_date + p_start_time + make_interval(mins => round(COALESCE(v_job.estimated_hours, 1) * 60)::int))
           OVERLAPS
           (o.date_needed + o.start_time, o.date_needed + o.start_time + make_interval(mins => round(COALESCE(o.estimated_hours, 1) * 60)::int))
  ) THEN
    RAISE EXCEPTION 'schedule_change_clash';
  END IF;

  v_other := CASE WHEN v_uid = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END;

  -- Q2297: the pending request this one replaces may be the OTHER person's own (they asked, and this caller answers
  -- with "Suggest another time"). Counted before the UPDATE closes it, so the notice says "your earlier request".
  SELECT count(*) INTO v_replaced_theirs
    FROM public.job_schedule_change_requests r
   WHERE r.job_id = v_job.id AND r.status = 'pending' AND r.requested_by = v_other;

  UPDATE public.job_schedule_change_requests r
     SET status = CASE WHEN r.expires_at <= now() THEN 'expired' ELSE 'replaced' END,
         decided_at = now()
   WHERE r.job_id = v_job.id AND r.status = 'pending';
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  -- Q2326: a come-back offer on a job under way lapses at the proposed new
  -- start at the latest (the original one has passed); every other request at
  -- the original. The poster has 1 day to answer it (owner, 2026-10-21; the
  -- reviews first set 2), never longer, whatever new time was proposed.
  IF v_finish THEN
    v_starts_at := LEAST(v_new_at, now() + interval '1 day');
  END IF;

  INSERT INTO public.job_schedule_change_requests
    (job_id, requested_by, responder_id, old_date, old_start_time, new_date, new_start_time, expires_at)
  VALUES
    (v_job.id, v_uid, v_other, v_job.date_needed, v_job.start_time, p_date, p_start_time, v_starts_at)
  RETURNING id INTO v_id;

  -- A come-back offer is announced by the refund answer itself (one notice).
  IF NOT v_finish THEN
  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_other, v_job.id,
    'New date or time requested',
    format('%s asked to move "%s" to %s%s. Nothing changes unless you accept.%s',
           CASE WHEN v_uid = v_job.customer_id THEN 'The person who posted it' ELSE 'The Helpr doing it' END,
           COALESCE(v_job.title, 'your job'),
           to_char(p_date, 'FMDy FMMon FMDD'),
           CASE WHEN p_start_time IS NULL THEN '' ELSE ' at ' || to_char(p_start_time, 'FMHH12:MI AM') END,
           CASE WHEN v_replaced = 0 THEN ''
                WHEN v_replaced_theirs > 0 THEN ' This replaces your earlier request.'
                ELSE ' This replaces their earlier request.' END),
    'job_updates',
    CASE WHEN v_other = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
  );
  END IF;

  RETURN jsonb_build_object('request_id', v_id, 'expires_at', v_starts_at, 'replaced', v_replaced);
END;
$fn$;

REVOKE ALL ON FUNCTION public.request_job_schedule_change(uuid, date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_job_schedule_change(uuid, date, time) TO authenticated, service_role;
