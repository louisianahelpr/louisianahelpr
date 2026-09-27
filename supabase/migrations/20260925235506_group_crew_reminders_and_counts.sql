-- A crew's reminders, auto-start and counts (docs/OPEN.md Q408; owner rules
-- Q407: a crew has NO lead, every hired member is equal).
--
-- jobs.helper_id is NULL on every group job (20260925154606), so every cron
-- and count that finds "the booked Helpr" through it silently skips a crew.
-- Measured on the effective definitions (src/test/groupCrewReminders.test.ts
-- holds the inventory): the three reminder sweeps and auto_start_due_jobs
-- select `j.helper_id IS NOT NULL`; the completed-job counts match
-- `j.helper_id = <user>`. On a crew that meant: no "Still on for tomorrow?",
-- no "Starting soon", no no-show check for any member, the poster never told a
-- member had not confirmed, the job never auto-started, and a Helpr's crew
-- jobs missing from their completed count, parish badge and public profile.
--
-- What this installs (each restated from its EFFECTIVE definition; the single
-- paths are unchanged, the crew paths are added beside them):
--   sweep_dayof_confirm_reminders  pass 1c: every hired member who has not
--       confirmed for the day (roster helper_dayof_confirmed_at), same grace
--       as the single pass; the poster once. pass 2c: at T-12h the poster is
--       told how many members have not answered. One stamp per job, as today.
--   sweep_job_start_reminders      the poster and every member.
--   sweep_no_show_alerts           every member not yet arrived (roster
--       helper_arrived_at), and the poster once while anyone has not arrived;
--       a crew goes in_progress on its first member, so both states are read.
--   auto_start_due_jobs            a fully staffed crew ('accepted') whose
--       EVERY member confirmed starts at its start time, as a confirmed single
--       booking does. A crew with an unconfirmed member stays manual.
--   get_helper_completed_counts, get_helper_parish_badges,
--   get_public_profile_stats       a crew member's completed crew jobs count.
--
-- NOT built here (owner questions, written into Q408): an unanswered-offer
-- deadline for a crew member (expire_unanswered_offers), and what a block
-- between the poster and ONE crew member settles (block_user_and_settle).
--
-- Grants: the sweeps and auto-start stay server-only; get_helper_parish_badges
-- stays service_role; get_public_profile_stats keeps its deliberate anon
-- EXECUTE (public profiles; CREATE OR REPLACE keeps grants); the one change is
-- get_helper_completed_counts, which never revoked PUBLIC and is now
-- authenticated-only.
--
-- REPLAY-SAFETY: CREATE OR REPLACE only, grants re-stated. Applied 3x in PGlite
-- (src/test/pglite/groupCrewReminders.pglite.mjs --replay).

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
BEGIN
  -- Pass 1: window open — remind the unanswered parties.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.helper_id,
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
      -- Helper: skip when the day-of stamp exists OR the accept itself
      -- happened inside the window (same grace as JobConfirmation).
      IF rec.helper_dayof_confirmed_at IS NULL
         AND (rec.helper_confirmed_at IS NULL
              OR v_start - rec.helper_confirmed_at > INTERVAL '24 hours') THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.helper_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on. One tap keeps your spot.', rec.title),
                '/jobs?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      IF rec.poster_confirmed_at IS NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.customer_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on so your Helpr knows it''s a go.', rec.title),
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

  -- Pass 1c (Q408): a CREW. No lead (Q407), so the single pass above never
  -- matches it (helper_id IS NULL): every hired member who has not confirmed
  -- for the day is reminded on their own roster row, and the poster once.
  -- Same window, same grace (a member hired inside the window is not
  -- reminded), same one-per-job stamp. A crew still staffing ('open' with
  -- members) is booked for the members already hired.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.poster_confirmed_at,
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
      FOR v_member IN
        SELECT g.helper_id FROM public.group_job_helpers g
         WHERE g.job_id = rec.id AND g.helper_id IS NOT NULL
           AND g.helper_dayof_confirmed_at IS NULL
           AND (g.helper_confirmed_at IS NULL OR v_start - g.helper_confirmed_at > INTERVAL '24 hours')
      LOOP
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (v_member, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on. One tap keeps your spot on the crew.', rec.title),
                '/jobs?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END LOOP;
      IF rec.poster_confirmed_at IS NULL AND rec.customer_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.customer_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on so your crew knows it''s a go.', rec.title),
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

  -- Pass 2c (Q408): T-12h and a crew member still hasn't answered — tell the
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
              CASE WHEN rec.unanswered = 1 THEN 'A Helpr on your crew hasn''t confirmed yet'
                   ELSE rec.unanswered::text || ' Helprs on your crew haven''t confirmed yet' END,
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


CREATE OR REPLACE FUNCTION public.sweep_job_start_reminders()
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
      ((j.date_needed + j.start_time) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.start_reminder_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.start_time IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND ((j.date_needed + j.start_time) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '35 minutes'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES
        (
          rec.customer_id,
          'job_update',
          'Starting soon',
          format('"%s" starts in about 30 minutes. Your helpr should be on the way.', rec.title),
          format('/jobs/%s', rec.id),
          false
        ),
        (
          rec.helper_id,
          'job_update',
          'Starting soon',
          format('"%s" starts in about 30 minutes. Head out so you arrive on time.', rec.title),
          format('/jobs/%s', rec.id),
          false
        );

      UPDATE public.jobs
      SET start_reminder_sent_at = NOW()
      WHERE id = rec.id;

      total_pushed := total_pushed + 2;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_job_start_reminders', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'sweep_job_start_reminders: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  -- Q408: a CREW (no lead, helper_id NULL): the poster and every hired member.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id
    FROM public.jobs j
    WHERE j.start_reminder_sent_at IS NULL
      AND j.is_group_job IS TRUE
      AND j.status IN ('open', 'accepted')
      AND j.start_time IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id IS NOT NULL)
      AND ((j.date_needed + j.start_time) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '35 minutes'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      IF rec.customer_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.customer_id, 'job_update', 'Starting soon',
                format('"%s" starts in about 30 minutes. Your crew should be on the way.', rec.title),
                '/posts?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      FOR v_member IN
        SELECT g.helper_id FROM public.group_job_helpers g WHERE g.job_id = rec.id AND g.helper_id IS NOT NULL
      LOOP
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (v_member, 'job_update', 'Starting soon',
                format('"%s" starts in about 30 minutes. Head out so you arrive on time.', rec.title),
                '/jobs?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END LOOP;
      UPDATE public.jobs SET start_reminder_sent_at = NOW() WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_job_start_reminders', 'crew:' || rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id, 'crew', true));
      RAISE NOTICE 'sweep_job_start_reminders: crew job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_job_start_reminders', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$$;


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
      j.helper_id
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
          'Has your helpr arrived?',
          format('"%s" was scheduled to start 30 minutes ago. If your helpr hasn''t arrived, you can mark this as a no-show in the app.', rec.title),
          format('/jobs/%s', rec.id),
          false
        ),
        (
          rec.helper_id,
          'work_status',
          'Did you start this job?',
          format('"%s" was scheduled to start 30 minutes ago. Tap Start when you arrive, or message the person who posted it if you''re delayed.', rec.title),
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
  -- Q408: a CREW (no lead, helper_id NULL). Each hired member who has not
  -- arrived is asked, and the poster is asked once, only while someone on the
  -- crew has not arrived. A crew is in_progress as soon as ONE member sets
  -- out, so both states are read here.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id,
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
                format('"%s" was scheduled to start 30 minutes ago and not everyone on the crew has checked in. If someone hasn''t arrived, you can mark them as a no-show in the app.', rec.title),
                '/posts?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      FOR v_member IN
        SELECT g.helper_id FROM public.group_job_helpers g
         WHERE g.job_id = rec.id AND g.helper_id IS NOT NULL AND g.helper_arrived_at IS NULL
      LOOP
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (v_member, 'work_status', 'Did you start this job?',
                format('"%s" was scheduled to start 30 minutes ago. Tap Start when you arrive, or message the person who posted it if you''re delayed.', rec.title),
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


CREATE OR REPLACE FUNCTION public.auto_start_due_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec     record;
  started integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id
      FROM public.jobs j
     WHERE j.status = 'accepted'::job_status
       -- Truly BOOKED, not merely offered. `accepted` covers two different
       -- moments: helpr chosen but not yet confirmed, and both sides locked
       -- in. Auto-starting the former would start a job nobody agreed to.
       AND (
            (j.helper_id IS NOT NULL AND j.helper_confirmed_at IS NOT NULL)
            -- Q408: a CREW has no lead (helper_id NULL, Q407). It is booked
            -- when it is fully staffed ('accepted') and EVERY hired member has
            -- confirmed; a crew with an unconfirmed member stays manual, the
            -- same way an unconfirmed single booking does.
         OR (j.is_group_job IS TRUE
             AND EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM public.group_job_helpers g
                              WHERE g.job_id = j.id AND g.helper_id IS NOT NULL AND g.helper_confirmed_at IS NULL))
       )
       -- A flexible-schedule job has no meaningful start moment, so there is
       -- nothing to trigger on. Those stay manual.
       AND COALESCE(j.is_flexible_schedule, false) = false
       -- date_needed is a DATE and start_time a naive TIME; both are local
       -- wall-clock. Helpr is Louisiana-only, so they are interpreted in
       -- America/Chicago and converted to an absolute instant.
       AND ((j.date_needed + COALESCE(j.start_time, '00:00'::time))
              AT TIME ZONE 'America/Chicago') <= now()
       -- Backstop: never retro-start something long past.
       AND ((j.date_needed + COALESCE(j.start_time, '00:00'::time))
              AT TIME ZONE 'America/Chicago') > now() - interval '7 days'
     ORDER BY (j.date_needed + COALESCE(j.start_time, '00:00'::time))
  LOOP
    BEGIN
      UPDATE public.jobs j
         SET status = 'in_progress'::job_status
       WHERE j.id = rec.id
         AND j.status = 'accepted'::job_status;

      IF FOUND THEN
        started := started + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'auto_start_due_jobs', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'auto_start_due_jobs: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  RETURN started;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'auto_start_due_jobs', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'started_before_failure', started));
  RETURN started;
END;
$$;


CREATE OR REPLACE FUNCTION public.get_helper_completed_counts(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, completed_jobs bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- A job counts for the Helpr who did it: the single Helpr (jobs.helper_id)
  -- or, on a crew (no lead, Q407), every member on its roster (Q408). A user
  -- with none is absent, as before.
  SELECT u.id, COUNT(DISTINCT j.id)::bigint
  FROM unnest(p_user_ids) AS u(id)
  JOIN public.jobs j
    ON j.status = 'completed'
   AND (j.helper_id = u.id
        OR (j.is_group_job IS TRUE AND EXISTS (
              SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = u.id)))
  GROUP BY u.id;
$$;

CREATE OR REPLACE FUNCTION public.get_helper_parish_badges(_user_id uuid)
 RETURNS TABLE(home_parish text, is_verified_local boolean, is_top_helper_in_parish boolean, parish_completed_jobs integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT user_id, parish FROM public.profiles WHERE user_id = _user_id LIMIT 1
  ),
  parish_jobs AS (
    SELECT COUNT(*)::int AS n
    FROM public.jobs j, p
    WHERE (j.helper_id = _user_id
           -- Q408: a crew member's completed crew jobs count too (no lead, Q407).
           OR (j.is_group_job IS TRUE AND EXISTS (
                 SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = _user_id)))
      AND j.status = 'completed'
      AND j.parish = p.parish
  ),
  top10 AS (
    SELECT 1
    FROM public.get_top_helpers_by_parish((SELECT parish FROM p), 10) t
    WHERE t.user_id = _user_id
  )
  SELECT
    p.parish AS home_parish,
    (p.parish IS NOT NULL AND COALESCE((SELECT n FROM parish_jobs), 0) >= 3) AS is_verified_local,
    EXISTS (SELECT 1 FROM top10) AS is_top_helper_in_parish,
    COALESCE((SELECT n FROM parish_jobs), 0) AS parish_completed_jobs
  FROM p;
$function$;


CREATE OR REPLACE FUNCTION public.get_public_profile_stats(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, review_count integer, avg_rating numeric, poster_review_count integer, poster_avg_rating numeric, completed_jobs_as_helper integer, completed_jobs_total integer, posted_jobs_total integer, jobs_total integer, cancelled_jobs integer, cancellation_rate numeric, on_time_sample integer, on_time_rate numeric, revision_sample integer, revision_rate numeric, repeat_client_sample integer, repeat_hire_percent numeric, is_id_verified boolean, has_stripe_account boolean, is_background_checked boolean, has_pending_credentials boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT p.user_id, p.stripe_identity_verified, p.idv_status,
           p.stripe_account_id, p.background_check_status
    FROM public.profiles p
    WHERE (p.user_id = ANY(p_user_ids) OR p.id = ANY(p_user_ids))
      AND (
        -- Public gate, character-for-character the one get_safe_profiles uses.
        (
          p.email_verified
          AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
        )
        -- …or it is your own row. Your own preview must not lie to you while
        -- your email is unverified, which is the same reason the client keeps a
        -- self-select fallback next to get_safe_profiles.
        OR p.user_id = auth.uid()
      )
  ),
  -- Reviews this person RECEIVED that are genuinely public: published, past
  -- the anti-retaliation reveal, and not attached to a job that ended up
  -- cancelled. That last clause is the one the client used to express as
  -- `jobs!inner(status)` — a join through a table no visitor can read, which
  -- is why it silently returned zero reviews for everyone. It is a real guard,
  -- not a no-op: the status machine in 20260504152414 allows
  -- completed -> disputed -> cancelled, so an admin resolving a
  -- post-completion dispute for the poster leaves a live review on a cancelled
  -- job. Enforced here, where `jobs` is readable, instead of there.
  visible_reviews AS (
    SELECT t.user_id, r.rating, (j.customer_id = t.user_id) AS as_poster
    FROM target t
    JOIN public.reviews r ON r.reviewee_id = t.user_id
    JOIN public.jobs j ON j.id = r.job_id
    WHERE r.status = 'published'
      AND r.feedback_visible_at IS NOT NULL
      AND r.feedback_visible_at <= now()
      AND j.status <> 'cancelled'
  ),
  review_agg AS (
    SELECT
      t.user_id,
      COUNT(v.rating)::integer AS review_count,
      ROUND(AVG(v.rating)::numeric, 2) AS avg_rating,
      COUNT(v.rating) FILTER (WHERE v.as_poster)::integer AS poster_review_count,
      ROUND(AVG(v.rating) FILTER (WHERE v.as_poster)::numeric, 2) AS poster_avg_rating
    FROM target t
    LEFT JOIN visible_reviews v ON v.user_id = t.user_id
    GROUP BY t.user_id
  ),
  -- Job counts. `jobs_total` / `cancelled_jobs` deliberately span BOTH sides
  -- of the marketplace, matching the combined denominator the profile card has
  -- always shown ("Cancelled · 3 of 12 jobs").
  job_agg AS (
    SELECT
      t.user_id,
      -- The Helpr side: the single Helpr, or (Q408) a crew member, who is joined
      -- below through the roster and is never the job's poster.
      COUNT(*) FILTER (WHERE j.customer_id IS DISTINCT FROM t.user_id AND j.status = 'completed')::integer AS completed_as_helper,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed')::integer AS completed_total,
      COUNT(*) FILTER (WHERE j.customer_id = t.user_id)::integer AS posted_total,
      COUNT(*)::integer AS jobs_total,
      COUNT(*) FILTER (WHERE j.status = 'cancelled')::integer AS cancelled_jobs
    FROM target t
    LEFT JOIN public.jobs j
      ON j.customer_id = t.user_id OR j.helper_id = t.user_id
      -- Q408: a crew has no lead (Q407), so a crew member's jobs are found
      -- through the roster.
      OR (j.is_group_job IS TRUE AND EXISTS (
            SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = t.user_id))
    GROUP BY t.user_id
  ),
  -- Timing, over this person's ENTIRE completed helper history. The client
  -- version capped its sample at the 50 most recent rows purely because that
  -- was one page of a `select`; there is no reason to throw away the rest here.
  timing AS (
    SELECT
      t.user_id,
      j.revision_count,
      j.helper_arrived_at,
      -- date_needed + start_time are wall-clock LOUISIANA time, not UTC. The
      -- client built this comparison with `new Date("YYYY-MM-DDTHH:MM:SS")`,
      -- which resolves in the VIEWER's timezone — so the same helper was
      -- "on time" in Baton Rouge and five hours late in London. Pin the zone.
      ((j.date_needed::date + COALESCE(j.start_time::text, '00:00')::time)
        AT TIME ZONE 'America/Chicago') AS scheduled_at
    FROM target t
    JOIN public.jobs j ON j.helper_id = t.user_id AND j.status = 'completed'
  ),
  timing_agg AS (
    SELECT
      t.user_id,
      COUNT(ti.revision_count)::integer AS revision_sample,
      COUNT(*) FILTER (WHERE COALESCE(ti.revision_count, 0) > 0)::integer AS revised,
      COUNT(*) FILTER (WHERE ti.helper_arrived_at IS NOT NULL AND ti.scheduled_at IS NOT NULL)::integer AS on_time_sample,
      -- 10-minute grace, carried over verbatim: "on time" is a humane window,
      -- not a stopwatch.
      COUNT(*) FILTER (
        WHERE ti.helper_arrived_at IS NOT NULL
          AND ti.scheduled_at IS NOT NULL
          AND ti.helper_arrived_at <= ti.scheduled_at + interval '10 minutes'
      )::integer AS on_time_hits
    FROM target t
    LEFT JOIN timing ti ON ti.user_id = t.user_id
    GROUP BY t.user_id
  ),
  -- Repeat hire: share of this helper's distinct completed-job clients who
  -- came back. Same arithmetic as get_user_repeat_hire_percent (20260612470000),
  -- now with a sample size attached so the caller can refuse to publish it.
  repeat_clients AS (
    SELECT t.user_id, j.customer_id, COUNT(*) AS jobs_together
    FROM target t
    JOIN public.jobs j ON j.helper_id = t.user_id AND j.status = 'completed'
    GROUP BY t.user_id, j.customer_id
  ),
  repeat_agg AS (
    SELECT
      t.user_id,
      COUNT(rc.customer_id)::integer AS client_sample,
      COUNT(rc.customer_id) FILTER (WHERE rc.jobs_together > 1)::integer AS returning_clients
    FROM target t
    LEFT JOIN repeat_clients rc ON rc.user_id = t.user_id
    GROUP BY t.user_id
  ),
  cred_agg AS (
    SELECT t.user_id,
           EXISTS (
             SELECT 1 FROM public.helper_credentials hc
             WHERE hc.user_id = t.user_id AND hc.status = 'submitted'
           ) AS has_pending
    FROM target t
  )
  SELECT
    t.user_id,
    ra.review_count,
    -- NULL, never 0.0, when there is nothing to average. A zero average is a
    -- terrible review; "no reviews" is not.
    CASE WHEN ra.review_count > 0 THEN ra.avg_rating END,
    ra.poster_review_count,
    -- 3 poster reviews minimum — the floor the card already applied.
    CASE WHEN ra.poster_review_count >= 3 THEN ra.poster_avg_rating END,
    ja.completed_as_helper,
    ja.completed_total,
    ja.posted_total,
    ja.jobs_total,
    ja.cancelled_jobs,
    CASE WHEN ja.jobs_total >= 5
      THEN ROUND(100.0 * ja.cancelled_jobs / ja.jobs_total, 1) END,
    ta.on_time_sample,
    CASE WHEN ta.on_time_sample >= 5
      THEN ROUND(100.0 * ta.on_time_hits / ta.on_time_sample, 1) END,
    ta.revision_sample,
    CASE WHEN ta.revision_sample >= 5
      THEN ROUND(100.0 * ta.revised / ta.revision_sample, 1) END,
    rpa.client_sample,
    -- The 100%-from-one-client fix. 0% here is a genuine measurement across at
    -- least three clients and is published as such.
    CASE WHEN rpa.client_sample >= 3
      THEN ROUND(100.0 * rpa.returning_clients / rpa.client_sample) END,
    -- THE identity verdict. Was `(t.stripe_identity_verified IS TRUE)` — the
    -- Connect verdict alone, false for 3 of the 4 idv-verified people.
    public.identity_is_verified(t.idv_status, t.stripe_identity_verified),
    (t.stripe_account_id IS NOT NULL),
    (t.background_check_status = 'verified'),
    ca.has_pending
  FROM target t
  JOIN review_agg ra ON ra.user_id = t.user_id
  JOIN job_agg    ja ON ja.user_id = t.user_id
  JOIN timing_agg ta ON ta.user_id = t.user_id
  JOIN repeat_agg rpa ON rpa.user_id = t.user_id
  JOIN cred_agg   ca ON ca.user_id = t.user_id;
$function$;


REVOKE ALL ON FUNCTION public.sweep_dayof_confirm_reminders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_job_start_reminders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_no_show_alerts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_start_due_jobs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_helper_completed_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_completed_counts(uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_helper_parish_badges(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_helper_parish_badges(uuid) TO service_role;
