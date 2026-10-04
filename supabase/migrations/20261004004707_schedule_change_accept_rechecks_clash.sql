-- Q925: respond_job_schedule_change re-checks schedule_change_clash when the
-- other party ACCEPTS. Only the request path (20261002060514) refused a start
-- that overlaps the Helpr's other booked jobs, and that is an unlocked read:
-- a hire landing elsewhere while the request sat pending (or in the same
-- instant) let the accept double-book the Helpr. Restated from its EFFECTIVE
-- definition (20260927012807_job_schedule_change_requests.sql; no
-- pg_get_functiondef rewrite touches it) verbatim apart from reading
-- estimated_hours and the clash check in the accept branch.

CREATE OR REPLACE FUNCTION public.respond_job_schedule_change(p_request_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
  v_job record;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  -- Job first, then the request: the same order request_job_schedule_change
  -- takes (job FOR UPDATE, then the pending row).
  SELECT r.job_id INTO v_req FROM public.job_schedule_change_requests r WHERE r.id = p_request_id;
  IF v_req.job_id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.date_needed, j.start_time,
         j.estimated_hours
    INTO v_job
    FROM public.jobs j
   WHERE j.id = v_req.job_id
   FOR UPDATE;
  SELECT r.* INTO v_req FROM public.job_schedule_change_requests r WHERE r.id = p_request_id FOR UPDATE;

  -- Only the party the request is addressed to, and only while they are still
  -- that party on the job.
  IF v_uid IS DISTINCT FROM v_req.responder_id
     OR v_uid IS DISTINCT FROM (CASE WHEN v_req.requested_by = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('status', v_req.status);
  END IF;

  -- Expired (unanswered by the original start), or the job moved on since it
  -- was asked: nothing changes.
  IF now() >= v_req.expires_at
     OR v_job.status::text <> 'accepted'
     OR v_job.date_needed IS DISTINCT FROM v_req.old_date
     OR v_job.start_time IS DISTINCT FROM v_req.old_start_time THEN
    UPDATE public.job_schedule_change_requests SET status = 'expired', decided_at = now() WHERE id = v_req.id;
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF p_accept THEN
    -- The new start must still be ahead.
    IF ((v_req.new_date + COALESCE(v_req.new_start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago') <= now() THEN
      UPDATE public.job_schedule_change_requests SET status = 'expired', decided_at = now() WHERE id = v_req.id;
      RETURN jsonb_build_object('status', 'expired');
    END IF;

    -- Q925: the same clash check request_job_schedule_change runs, again at
    -- accept time. The request-time check is an unlocked read, and the Helpr
    -- can have been hired elsewhere in the days the request sat pending, so
    -- accepting could double-book them. Runs under the subject job's FOR
    -- UPDATE above and takes FOR SHARE on the overlapping bookings, so a
    -- cancel or completion of one waits for this accept instead of racing it.
    -- The request stays pending when refused: the responder can decline it.
    -- A time-less new start ("any time that day") is flexible and never clashes.
    IF v_req.new_start_time IS NOT NULL THEN
      PERFORM 1
        FROM public.jobs o
       WHERE o.id <> v_job.id
         AND o.date_needed = v_req.new_date
         AND o.start_time IS NOT NULL
         AND o.status::text IN ('accepted', 'in_progress')
         AND o.helper_completed_at IS NULL
         AND (o.helper_id = v_job.helper_id
              OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                          WHERE g.job_id = o.id AND g.helper_id = v_job.helper_id
                            AND g.status = 'accepted'))
         AND (v_req.new_date + v_req.new_start_time, v_req.new_date + v_req.new_start_time + make_interval(mins => round(COALESCE(v_job.estimated_hours, 1) * 60)::int))
             OVERLAPS
             (o.date_needed + o.start_time, o.date_needed + o.start_time + make_interval(mins => round(COALESCE(o.estimated_hours, 1) * 60)::int))
         FOR SHARE OF o;
      IF FOUND THEN
        RAISE EXCEPTION 'schedule_change_clash';
      END IF;
    END IF;

    PERFORM set_config('app.schedule_change_rpc', '1', true);
    UPDATE public.jobs
       SET date_needed = v_req.new_date,
           start_time = v_req.new_start_time,
           -- The day-of machinery runs fresh for the new day (as a reopened
           -- job does, helper_cancel_booking).
           dayof_confirm_reminder_sent_at = NULL,
           dayof_unanswered_poster_alert_sent_at = NULL,
           start_reminder_sent_at = NULL
     WHERE id = v_job.id;
    PERFORM set_config('app.schedule_change_rpc', '0', true);
    v_status := 'accepted';
  ELSE
    v_status := 'declined';
  END IF;

  UPDATE public.job_schedule_change_requests SET status = v_status, decided_at = now() WHERE id = v_req.id;

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_req.requested_by, v_job.id,
    CASE WHEN v_status = 'accepted' THEN 'New date or time accepted' ELSE 'New date or time declined' END,
    CASE WHEN v_status = 'accepted'
         THEN format('"%s" is now on %s%s.', COALESCE(v_job.title, 'Your job'),
                     to_char(v_req.new_date, 'FMDy FMMon FMDD'),
                     CASE WHEN v_req.new_start_time IS NULL THEN '' ELSE ' at ' || to_char(v_req.new_start_time, 'FMHH12:MI AM') END)
         ELSE format('"%s" stays on %s%s. The usual cancellation rules apply if either of you cancels.', COALESCE(v_job.title, 'Your job'),
                     to_char(v_req.old_date, 'FMDy FMMon FMDD'),
                     CASE WHEN v_req.old_start_time IS NULL THEN '' ELSE ' at ' || to_char(v_req.old_start_time, 'FMHH12:MI AM') END)
    END,
    'job_updates',
    CASE WHEN v_req.requested_by = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
  );

  RETURN jsonb_build_object('status', v_status);
END;
$fn$;

REVOKE ALL ON FUNCTION public.respond_job_schedule_change(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_job_schedule_change(uuid, boolean) TO authenticated, service_role;
