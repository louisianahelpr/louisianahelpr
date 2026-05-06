-- No-show detection: 30 minutes past a scheduled job start, if status
-- is still 'accepted' (helper hasn't tapped Start), nudge both parties.
-- Most cases are "helper forgot to tap Start" — gentle prompts unblock
-- the workflow without punishing either side. Genuine no-shows leave a
-- trail (no_show_alert_sent_at + status still 'accepted' an hour later)
-- that admins can review.
--
-- Salvaged idea from the deleted job-lifecycle-automations.ts edge
-- function. DB-native for the same reasons as job-start-reminders:
-- idempotent, no coordinator state, no retry logic needed.
--
-- Why not auto-cancel:
--   We never want a sweep to take money or close a job without a human
--   in the loop. The signal here is "something's off" — the resolution
--   path stays manual (customer marks no-show in app, or helper taps
--   Start late, or admin intervenes).

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS no_show_alert_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS jobs_no_show_pending_idx
  ON public.jobs (date_needed, start_time)
  WHERE no_show_alert_sent_at IS NULL
    AND status = 'accepted'
    AND helper_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sweep_no_show_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
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
          format('"%s" was scheduled to start 30 minutes ago. Tap Start when you arrive, or message the customer if you''re delayed.', rec.title),
          format('/jobs/%s', rec.id),
          false
        );

      UPDATE public.jobs
      SET no_show_alert_sent_at = NOW()
      WHERE id = rec.id;

      total_pushed := total_pushed + 2;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'sweep_no_show_alerts: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN total_pushed;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_no_show_alerts() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('sweep-no-show-alerts');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'sweep-no-show-alerts',
  '*/5 * * * *',
  $cron$SELECT public.sweep_no_show_alerts();$cron$
);
