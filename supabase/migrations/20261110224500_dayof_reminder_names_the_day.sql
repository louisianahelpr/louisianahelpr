-- F477 (whole-app audit 11-10, Worker 6): the "Still on for tomorrow?" day-of reminder (push, and email notice-03
-- through jobs_notice_email_type) said '"<job>" starts soon' with no day or time, so the member could not tell whether
-- "tomorrow" was the right day. All four bodies (the Helpr, the poster, each crew member, the crew's poster) now name
-- the job's own day and time in the house style, '"<job>" starts Wed, Nov 11 at 9:00 AM — tap to confirm ...'
-- (continue_day_label on jobs.date_needed + start_time, the Central wall clock the job was posted with), or the day
-- alone ('starts Wed, Nov 11') when the job has no start time (the sweep's window assumes 9:00 AM for those, which the
-- member never chose, so it is not said). The title, type, link, who is reminded, the window, the grace, the stamps,
-- pass 2 / 2c and the error handling are unchanged (sweep_confirm_reminders_and_repost keys on the title). Body:
-- the newest repo definition (20261110205345) with only those lines changed. Replay-safe: CREATE OR REPLACE keeps
-- the grants (20260927012241). MONEY: none. AUTHZ: none.
-- Proof: src/test/dayofReminderNamesTheDay.test.ts (reads the newest definition).

CREATE OR REPLACE FUNCTION public.sweep_dayof_confirm_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
  v_start timestamptz;
  v_member uuid;
  -- F477 (audit 11-10 W6): the job's day and time in the house style ("Wed, Nov 11 at 9:00 AM"), or the day alone when no time was set.
  v_when text;
BEGIN
  -- Pass 1: window open — remind the unanswered parties.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.helper_id, j.date_needed, j.start_time,
           j.helper_confirmed_at, j.helper_dayof_confirmed_at, j.poster_confirmed_at,
           ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.dayof_confirm_reminder_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      v_start := rec.scheduled_start;
      v_when := CASE WHEN rec.start_time IS NULL THEN to_char(rec.date_needed, 'FMDy, FMMon FMDD')
                     ELSE public.continue_day_label(rec.date_needed, rec.start_time) END;
      -- Helper: skip when the day-of stamp exists OR the accept itself
      -- happened inside the window (same grace as JobConfirmation).
      IF rec.helper_dayof_confirmed_at IS NULL
         AND (rec.helper_confirmed_at IS NULL
              OR v_start - rec.helper_confirmed_at > INTERVAL '24 hours') THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.helper_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts %s — tap to confirm you''re still on. One tap keeps your spot.', rec.title, v_when),
                '/jobs?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      IF rec.poster_confirmed_at IS NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.customer_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts %s — tap to confirm you''re still on so your Helpr knows it''s a go.', rec.title, v_when),
                '/posts?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      UPDATE public.jobs SET dayof_confirm_reminder_sent_at = NOW() WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p1:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', 1, 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p1: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  -- Pass 1c (Q728): a CREW. No lead (Q407), so the single pass above never
  -- matches it (helper_id IS NULL): every hired member who has not confirmed
  -- for the day is reminded on their own roster row, and the poster once.
  -- Same window, same grace (a member hired inside the window is not
  -- reminded), same one-per-job stamp. A crew still staffing ('open' with
  -- members) is booked for the members already hired.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.poster_confirmed_at, j.date_needed, j.start_time,
           ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.dayof_confirm_reminder_sent_at IS NULL
      AND j.is_group_job IS TRUE
      AND j.status IN ('open', 'accepted')
      AND j.date_needed IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id IS NOT NULL)
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      v_start := rec.scheduled_start;
      v_when := CASE WHEN rec.start_time IS NULL THEN to_char(rec.date_needed, 'FMDy, FMMon FMDD')
                     ELSE public.continue_day_label(rec.date_needed, rec.start_time) END;
      FOR v_member IN
        SELECT g.helper_id FROM public.group_job_helpers g
         WHERE g.job_id = rec.id AND g.helper_id IS NOT NULL
           AND g.helper_dayof_confirmed_at IS NULL
           AND (g.helper_confirmed_at IS NULL OR v_start - g.helper_confirmed_at > INTERVAL '24 hours')
      LOOP
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (v_member, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts %s — tap to confirm you''re still on. One tap keeps your spot on the crew.', rec.title, v_when),
                '/jobs?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END LOOP;
      IF rec.poster_confirmed_at IS NULL AND rec.customer_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.customer_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts %s — tap to confirm you''re still on so your crew knows it''s a go.', rec.title, v_when),
                '/posts?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      UPDATE public.jobs SET dayof_confirm_reminder_sent_at = NOW() WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p1c:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', '1c', 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p1c: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  -- Pass 2: T-12h and the helper still hasn't answered — alert the poster.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id,
           ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.dayof_unanswered_poster_alert_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND j.helper_dayof_confirmed_at IS NULL
      AND (j.helper_confirmed_at IS NULL
           OR ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') - j.helper_confirmed_at > INTERVAL '24 hours')
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '12 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
      VALUES (rec.customer_id, 'warning', 'Your Helpr hasn''t confirmed yet',
              format('"%s" starts in under 12 hours and your Helpr hasn''t confirmed they''re still on. Message them — or line up a backup while there''s time.', rec.title),
              '/posts?job=' || rec.id::text, false, rec.id);
      UPDATE public.jobs SET dayof_unanswered_poster_alert_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p2:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', 2, 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p2: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  -- Pass 2c (Q728): T-12h and a crew member still hasn't answered — tell the
  -- poster once, with how many.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id,
           (SELECT count(*) FROM public.group_job_helpers g
             WHERE g.job_id = j.id AND g.helper_id IS NOT NULL
               AND g.helper_dayof_confirmed_at IS NULL
               AND (g.helper_confirmed_at IS NULL
                    OR ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') - g.helper_confirmed_at > INTERVAL '24 hours')
           )::int AS unanswered
    FROM public.jobs j
    WHERE j.dayof_unanswered_poster_alert_sent_at IS NULL
      AND j.is_group_job IS TRUE
      AND j.status IN ('open', 'accepted')
      AND j.date_needed IS NOT NULL
      AND j.customer_id IS NOT NULL
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '12 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    CONTINUE WHEN rec.unanswered = 0;
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
      VALUES (rec.customer_id, 'warning',
              CASE WHEN rec.unanswered = 1 THEN 'A crew Helpr hasn''t confirmed yet'
                   ELSE rec.unanswered::text || ' crew Helprs haven''t confirmed yet' END,
              format('"%s" starts in under 12 hours and not everyone on the crew has confirmed they''re still on. Message them — or line up a backup while there''s time.', rec.title),
              '/posts?job=' || rec.id::text, false, rec.id);
      UPDATE public.jobs SET dayof_unanswered_poster_alert_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p2c:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', '2c', 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p2c: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_dayof_confirm_reminders', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$function$;
