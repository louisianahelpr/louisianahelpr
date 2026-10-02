-- Q736: request_job_schedule_change refuses a proposed start that overlaps
-- another booking the hired Helpr already holds (raises schedule_change_clash).
-- One pending request per job was already enforced (unique index
-- job_schedule_change_one_pending + replace-on-ask); this restates the body
-- from 20260927012807 verbatim apart from the clash check and the
-- estimated_hours column it reads.

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
  IF v_job.status::text <> 'accepted' OR v_job.helper_id IS NULL OR v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'schedule_change_not_booked';
  END IF;

  v_starts_at := (v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF now() >= v_starts_at THEN
    RAISE EXCEPTION 'schedule_change_too_late';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'schedule_change_invalid';
  END IF;
  v_new_at := (p_date + COALESCE(p_start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF v_new_at <= now() THEN
    RAISE EXCEPTION 'schedule_change_in_past';
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
       AND o.status::text IN ('accepted', 'in_progress')
       AND o.helper_completed_at IS NULL
       AND (o.helper_id = v_job.helper_id
            OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                        WHERE g.job_id = o.id AND g.helper_id = v_job.helper_id
                          AND g.status = 'accepted'))
       AND (p_date + p_start_time, p_date + p_start_time + make_interval(mins => round(COALESCE(v_job.estimated_hours, 1) * 60)::int))
           OVERLAPS
           (o.date_needed + o.start_time, o.date_needed + o.start_time + make_interval(mins => round(COALESCE(o.estimated_hours, 1) * 60)::int))
  ) THEN
    RAISE EXCEPTION 'schedule_change_clash';
  END IF;

  v_other := CASE WHEN v_uid = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END;

  UPDATE public.job_schedule_change_requests r
     SET status = CASE WHEN r.expires_at <= now() THEN 'expired' ELSE 'replaced' END,
         decided_at = now()
   WHERE r.job_id = v_job.id AND r.status = 'pending';
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  INSERT INTO public.job_schedule_change_requests
    (job_id, requested_by, responder_id, old_date, old_start_time, new_date, new_start_time, expires_at)
  VALUES
    (v_job.id, v_uid, v_other, v_job.date_needed, v_job.start_time, p_date, p_start_time, v_starts_at)
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_other, v_job.id,
    'New date or time requested',
    format('%s asked to move "%s" to %s%s. Nothing changes unless you accept.%s',
           CASE WHEN v_uid = v_job.customer_id THEN 'The person who posted it' ELSE 'The Helpr doing it' END,
           COALESCE(v_job.title, 'your job'),
           to_char(p_date, 'FMDy FMMon FMDD'),
           CASE WHEN p_start_time IS NULL THEN '' ELSE ' at ' || to_char(p_start_time, 'FMHH12:MI AM') END,
           CASE WHEN v_replaced > 0 THEN ' This replaces their earlier request.' ELSE '' END),
    'job_updates',
    CASE WHEN v_other = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
  );

  RETURN jsonb_build_object('request_id', v_id, 'expires_at', v_starts_at, 'replaced', v_replaced);
END;
$fn$;

REVOKE ALL ON FUNCTION public.request_job_schedule_change(uuid, date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_job_schedule_change(uuid, date, time) TO authenticated, service_role;
