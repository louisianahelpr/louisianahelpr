-- Owner bug 11-03: a job with an OPEN continue day (job_continue_days status 'set', closed_at null) is dated by that
-- day wherever the server decides "late / overdue". Two functions read only jobs.date_needed:
--
-- 1. admin_stalled_job_queue: an escalated stalled job that has since been given a set day to come back still showed
--    its passed first date, so Admin -> Stalled Jobs said "2d 6h past the scheduled end" (stalledQueue.ts
--    hoursStuck reads the date_needed / start_time this returns). It now returns the open set day's date and start
--    time for a job in progress (the tracker's jobOnContinueDay rule), and the job's own otherwise; and a job whose
--    open SET day is today or still ahead (Central) is LEFT OUT (not stalled; lead 11-03), so the rail badge does not
--    count it. Same signature, same admin-only rows, same order.
--    Prod before (11-03, read by Builder 72): md5(prosrc) ffb4fd348571c202683cb23aa3074743,
--    md5(pg_get_functiondef) 1acf89ecf76e2217c23467ef890b34e9. Restated from that functiondef.
--
-- 2. sweep_no_show_alerts, CREW branch: it takes open/accepted/in_progress crews, so a continuing crew whose first-day
--    alert never went out could be asked "Has your crew arrived?" about the passed first day. It now skips a crew job
--    with an open set continue day. The solo branch is unchanged (accepted only: a continuing job is in progress).
--    Prod before: md5(prosrc) ff47bcf9071e36f17405aa779c790a2a, md5(pg_get_functiondef) dfda3bd99946bc41033ad8c2183717de.
--    Restated verbatim from that functiondef plus the one NOT EXISTS.
--
-- Replay-safe (CREATE OR REPLACE, same signatures). Grants restated as on prod's intent: admin RPC to authenticated
-- (non-admins get no rows), the sweep to service_role only. PGlite: src/test/pglite/continuingJobServerDates.pglite.mjs.

CREATE OR REPLACE FUNCTION public.admin_stalled_job_queue(p_include_resolved boolean DEFAULT false)
 RETURNS TABLE(job_id uuid, title text, customer_id uuid, helper_id uuid, budget numeric, date_needed date, start_time time without time zone, estimated_hours numeric, status text, payment_status text, first_sent_at timestamp with time zone, second_sent_at timestamp with time zone, escalated_at timestamp with time zone, resolved_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    n.job_id,
    j.title,
    j.customer_id,
    j.helper_id,
    j.budget,
    -- Owner bug 11-03: a job in progress with an open SET continue day is dated by that day.
    coalesce(c.new_date, j.date_needed),
    CASE WHEN c.new_date IS NOT NULL THEN c.new_start_time ELSE j.start_time END,
    j.estimated_hours,
    j.status::text,
    j.payment_status::text,
    n.first_sent_at,
    n.second_sent_at,
    n.escalated_at,
    n.resolved_at
  FROM public.job_completion_nudges n
  JOIN public.jobs j ON j.id = n.job_id
  LEFT JOIN LATERAL (
    SELECT d.new_date, d.new_start_time
      FROM public.job_continue_days d
     WHERE d.job_id = j.id AND d.status = 'set' AND d.closed_at IS NULL AND j.status = 'in_progress'
     ORDER BY d.created_at DESC
     LIMIT 1
  ) c ON true
  WHERE n.escalated_at IS NOT NULL
    -- Server-side authorization: non-admins get no rows, not an error.
    AND public.has_role(auth.uid(), 'admin')
    AND (coalesce(p_include_resolved, false) OR n.resolved_at IS NULL)
    -- Owner bug 11-03 (lead): a job whose open SET day is today or still ahead (Central) is not stalled. It is left
    -- out of the queue and its rail badge; it comes back once that day passes without the job finishing.
    AND NOT (c.new_date IS NOT NULL AND c.new_date >= (now() AT TIME ZONE 'America/Chicago')::date)
  ORDER BY n.escalated_at ASC, n.job_id ASC;
$function$;

CREATE OR REPLACE FUNCTION public.sweep_no_show_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
  v_member uuid;
BEGIN
  FOR rec IN
    SELECT
      j.id,
      j.title,
      j.customer_id,
      j.helper_id,
      j.start_time
    FROM public.jobs j
    WHERE j.no_show_alert_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.start_time IS NOT NULL
      AND j.date_needed IS NOT NULL
      -- Scheduled start was at least 30 min ago and at most 6 hours ago.
      -- The 6-hour cap stops the sweep from re-alerting on stale rows
      -- whose helpers genuinely abandoned them — those become an admin
      -- triage problem, not a notification spam loop.
      AND ((j.date_needed + j.start_time) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() - INTERVAL '6 hours' AND NOW() - INTERVAL '30 minutes'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES
        (
          rec.customer_id,
          'job_update',
          'Has your Helpr arrived?',
          format('"%s" was scheduled to start at %s. If your Helpr hasn''t arrived, message them from the job.', rec.title, to_char(rec.start_time, 'FMHH12:MI AM')),
          format('/jobs/%s', rec.id),
          false
        ),
        (
          rec.helper_id,
          'work_status',
          'Did you start this job?',
          format('"%s" was scheduled to start at %s. Tap Start when you arrive, or message the person who posted it if you''re delayed.', rec.title, to_char(rec.start_time, 'FMHH12:MI AM')),
          format('/jobs/%s', rec.id),
          false
        );

      UPDATE public.jobs
      SET no_show_alert_sent_at = NOW()
      WHERE id = rec.id;

      total_pushed := total_pushed + 2;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_no_show_alerts', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'sweep_no_show_alerts: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  -- Q728: a CREW (no lead, helper_id NULL). Each hired member who has not
  -- arrived is asked, and the poster is asked once, only while someone on the
  -- crew has not arrived. A crew is in_progress as soon as ONE member sets
  -- out, so both states are read here.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.start_time,
           (SELECT count(*) FROM public.group_job_helpers g
             WHERE g.job_id = j.id AND g.helper_id IS NOT NULL AND g.helper_arrived_at IS NULL)::int AS not_arrived
    FROM public.jobs j
    WHERE j.no_show_alert_sent_at IS NULL
      AND j.is_group_job IS TRUE
      AND j.status IN ('open', 'accepted', 'in_progress')
      AND j.start_time IS NOT NULL
      AND j.date_needed IS NOT NULL
      -- Owner bug 11-03: a crew job with an open SET continue day is not asked about its passed first day.
      AND NOT EXISTS (SELECT 1 FROM public.job_continue_days d
                       WHERE d.job_id = j.id AND d.status = 'set' AND d.closed_at IS NULL)
      AND ((j.date_needed + j.start_time) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() - INTERVAL '6 hours' AND NOW() - INTERVAL '30 minutes'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    CONTINUE WHEN rec.not_arrived = 0;
    BEGIN
      IF rec.customer_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.customer_id, 'job_update', 'Has your crew arrived?',
                format('"%s" was scheduled to start at %s and not everyone on the crew has checked in. If someone hasn''t arrived, message them from the job.', rec.title, to_char(rec.start_time, 'FMHH12:MI AM')),
                '/posts?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      FOR v_member IN
        SELECT g.helper_id FROM public.group_job_helpers g
         WHERE g.job_id = rec.id AND g.helper_id IS NOT NULL AND g.helper_arrived_at IS NULL
      LOOP
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (v_member, 'work_status', 'Did you start this job?',
                format('"%s" was scheduled to start at %s. Tap Start when you arrive, or message the person who posted it if you''re delayed.', rec.title, to_char(rec.start_time, 'FMHH12:MI AM')),
                '/jobs?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END LOOP;
      UPDATE public.jobs SET no_show_alert_sent_at = NOW() WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_no_show_alerts', 'crew:' || rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id, 'crew', true));
      RAISE NOTICE 'sweep_no_show_alerts: crew job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_no_show_alerts', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$function$;

-- Grants as on prod (proacl measured 11-03): the admin queue to authenticated + service_role, the sweep to
-- service_role only. CREATE OR REPLACE keeps them; restated so a replay on a fresh database ends the same.
REVOKE ALL ON FUNCTION public.admin_stalled_job_queue(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_stalled_job_queue(boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sweep_no_show_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_no_show_alerts() TO service_role;
