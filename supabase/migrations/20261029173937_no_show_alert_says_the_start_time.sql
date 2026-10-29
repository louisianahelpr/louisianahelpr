-- THE NO-SHOW ALERT SAYS THE START TIME, "Helpr", AND NO NO-SHOW BUTTON THAT ISN'T THERE (audit 2026-10-29 A2-C40).
--
-- What was broken (AA9 chunk 1a, the 15:27 notification): sweep_no_show_alerts (newest body
-- 20260927012241_group_crew_reminders_and_counts.sql) told the poster '"<job>" was scheduled to start 30
-- minutes ago. If your helpr hasn't arrived, you can mark this as a no-show in the app.' Three faults:
--   * "30 minutes ago": the sweep runs every 15 minutes (20260914174329) over starts 30 minutes to 6 hours
--     back, so the alert lands 30 to 45 minutes after the start, or later.
--   * lowercase "helpr" in the title and the message.
--   * the poster's No-Show control lives only on an in_progress card (InProgressStep), and this alert fires
--     only for a job still 'accepted' (and, for a crew, before everyone arrived), so it pointed at a button
--     the app did not show yet.
--
-- The fix, copy only (lead decision 2026-10-29): every message names the scheduled start ("was scheduled to
-- start at 3:00 PM"), "Helpr" is capitalized, and the poster is told to message the Helpr from the job
-- instead of a No-Show the app does not offer yet. The rows chosen, the links, the once-only stamp, the
-- error logging and the return value are the newest body verbatim; the only other change is selecting
-- j.start_time so the copy can name it.
--
-- Replay-safe: CREATE OR REPLACE of a function that exists since 20260506200000; grants restated as
-- 20260927012241 left them (a cron function: nobody calls it directly).

CREATE OR REPLACE FUNCTION public.sweep_no_show_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.sweep_no_show_alerts() FROM PUBLIC, anon, authenticated;
