-- Q1676 (docs/OPEN.md, lh-authz-rls review of Q1326, 2026-10-12): the
-- schedule-change clash checks used an older copy of the double-booking rule.
-- request_job_schedule_change (Q736) and respond_job_schedule_change (Q925)
-- each carried their own overlap query that
--   - missed a crew seat the Helpr holds while the crew is still FILLING
--     (an 'open' job with no jobs.helper_id), and
--   - ignored a crew member's own group_job_helpers.helper_completed_at
--     (a seat they already finished still counted as a booking),
-- while helpr_booking_clashes (20261012171958, the double-booking notice)
-- counts both. Both RPCs are restated here from their newest definition
-- (20261008183640; md5(prosrc) live = that file: d1c04f6e / e248d161,
-- measured 2026-10-15) with ONLY the booked-row predicate replaced by
-- helpr_booking_clashes' rule; everything else is verbatim.
--
-- Not calling helpr_booking_clashes itself: it compares bookings that are
-- already written, and these checks test a PROPOSED new date / start that is
-- not in jobs yet (respond also takes FOR SHARE on the rows it finds).
-- Past-midnight bookings (one ending after 00:00 vs one on the next date) are
-- still compared same-date only, exactly like helpr_booking_clashes: that
-- choice stays open on Q1676.
--
-- Replay-safe: CREATE OR REPLACE with the same signatures; grants restated.

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
  v_reason text;
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
    v_reason := CASE WHEN now() >= v_req.expires_at THEN 'job_started' ELSE 'job_changed' END;
    PERFORM public.notify_schedule_change_expired(v_req.id, v_reason);
    RETURN jsonb_build_object('status', 'expired', 'reason', v_reason);
  END IF;

  IF p_accept THEN
    -- The new start must still be ahead.
    IF ((v_req.new_date + COALESCE(v_req.new_start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago') <= now() THEN
      UPDATE public.job_schedule_change_requests SET status = 'expired', decided_at = now() WHERE id = v_req.id;
      PERFORM public.notify_schedule_change_expired(v_req.id, 'new_time_passed');
      RETURN jsonb_build_object('status', 'expired', 'reason', 'new_time_passed');
    END IF;

    -- Q925: the same clash check request_job_schedule_change runs, again at
    -- accept time. The request-time check is an unlocked read, and the Helpr
    -- can have been hired elsewhere in the days the request sat pending, so
    -- accepting could double-book them. Runs under the subject job's FOR
    -- UPDATE above and takes FOR SHARE on the overlapping bookings, so a
    -- cancel or completion of one waits for this accept instead of racing it.
    -- Q1262(2): a clash DECLINES the request (it can never be accepted while
    -- the Helpr is booked then) and tells whoever asked, instead of rolling
    -- back and leaving it pending with nobody told.
    -- A time-less new start ("any time that day") is flexible and never clashes.
    -- Two requests on two DIFFERENT jobs of the same Helpr, accepted at the same
    -- moment, each lock only their own job and would both pass the check (write
    -- skew; lh-authz-rls review 2026-10-04): one advisory lock per Helpr makes
    -- those accepts take turns, so the second sees the first's new slot.
    IF v_req.new_start_time IS NOT NULL THEN
      IF v_job.helper_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' || v_job.helper_id::text));
      END IF;
      PERFORM 1
        FROM public.jobs o
       WHERE o.id <> v_job.id
         AND o.date_needed = v_req.new_date
         AND o.start_time IS NOT NULL
         -- Q1676: the same booking rule as helpr_booking_clashes (see above).
         AND ((o.helper_id = v_job.helper_id
               AND o.status::text IN ('accepted', 'in_progress')
               AND o.helper_completed_at IS NULL)
              OR (o.status::text IN ('open', 'accepted', 'in_progress')
                  AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                               WHERE g.job_id = o.id AND g.helper_id = v_job.helper_id
                                 AND g.status = 'accepted'
                                 AND g.helper_completed_at IS NULL)))
         AND (v_req.new_date + v_req.new_start_time, v_req.new_date + v_req.new_start_time + make_interval(mins => round(COALESCE(v_job.estimated_hours, 1) * 60)::int))
             OVERLAPS
             (o.date_needed + o.start_time, o.date_needed + o.start_time + make_interval(mins => round(COALESCE(o.estimated_hours, 1) * 60)::int))
         FOR SHARE OF o;
      IF FOUND THEN
        UPDATE public.job_schedule_change_requests SET status = 'declined', decided_at = now() WHERE id = v_req.id;
        INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
        VALUES (
          v_req.requested_by, v_job.id,
          'New date or time not possible',
          format('"%s" stays on %s%s: the Helpr is already booked at the new time.', COALESCE(v_job.title, 'Your job'),
                 to_char(v_req.old_date, 'FMDy FMMon FMDD'),
                 CASE WHEN v_req.old_start_time IS NULL THEN '' ELSE ' at ' || to_char(v_req.old_start_time, 'FMHH12:MI AM') END),
          'job_updates',
          CASE WHEN v_req.requested_by = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
        );
        RETURN jsonb_build_object('status', 'declined', 'reason', 'schedule_change_clash');
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

REVOKE ALL ON FUNCTION public.request_job_schedule_change(uuid, date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_job_schedule_change(uuid, date, time) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.respond_job_schedule_change(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_job_schedule_change(uuid, boolean) TO authenticated, service_role;
