-- Day-before confirmation reminders (owner, 2026-08-24 transition audit:
-- "the transition most likely to silently stall" — the Still-on? card only
-- existed in-app, so a helper who didn't open the app never saw it and got
-- no-showed on paper).
--
-- Mirrors sweep_job_start_reminders (20260506190000): pg_cron + idempotent
-- SQL, sent-at columns as the duplicate guard, 5-minute cadence riding the
-- same scheduler.
--
-- Two passes per job:
--   1. WINDOW OPEN (start within 24h): ping each party that hasn't answered
--      the day-before question — helper without helper_dayof_confirmed_at
--      (with the accept-inside-the-window grace the client uses), poster
--      without poster_confirmed_at.
--   2. T-12h POSTER ALERT: if the HELPER still hasn't answered with 12h to
--      go, tell the poster now — while there's still time to rebook.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS dayof_confirm_reminder_sent_at timestamptz;
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS dayof_unanswered_poster_alert_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.sweep_dayof_confirm_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
  v_start timestamptz;
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
        INSERT INTO public.notifications (user_id, type, title, message, link, read)
        VALUES (rec.helper_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on. One tap keeps your spot.', rec.title),
                '/my-jobs?filter=offered', false);
        total_pushed := total_pushed + 1;
      END IF;
      IF rec.poster_confirmed_at IS NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read)
        VALUES (rec.customer_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on so your Helpr knows it''s a go.', rec.title),
                '/my-posts?filter=offered', false);
        total_pushed := total_pushed + 1;
      END IF;
      UPDATE public.jobs SET dayof_confirm_reminder_sent_at = NOW() WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'sweep_dayof_confirm_reminders p1: job % failed: %', rec.id, SQLERRM;
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
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (rec.customer_id, 'warning', 'Your Helpr hasn''t confirmed yet',
              format('"%s" starts in under 12 hours and your Helpr hasn''t confirmed they''re still on. Message them — or line up a backup while there''s time.', rec.title),
              '/my-posts?filter=offered', false);
      UPDATE public.jobs SET dayof_unanswered_poster_alert_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'sweep_dayof_confirm_reminders p2: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  RETURN total_pushed;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_dayof_confirm_reminders() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('sweep-dayof-confirm-reminders');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'sweep-dayof-confirm-reminders',
  '*/5 * * * *',
  $$SELECT public.sweep_dayof_confirm_reminders()$$
);
