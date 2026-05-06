-- Job-start reminders: 30 minutes before a scheduled job start, push a
-- notification to both the customer and the assigned helper. Reduces
-- no-shows and gives the helper one last buffer to bail (or arm) if
-- something has come up.
--
-- Salvaged idea from the deleted job-lifecycle-automations.ts edge
-- function (see TODO.md "Salvage from..." section). Implemented as
-- pg_cron + DB function instead of an edge function so it runs without
-- coordinator state — no queue, no retry logic, just idempotent SQL.
--
-- Idempotency:
--   start_reminder_sent_at column on jobs guards against duplicate
--   reminders if the sweep runs twice on the same row.
--
-- Window:
--   Sweep finds jobs whose scheduled start falls in (NOW, NOW+35min].
--   Cron runs every 5 minutes, so a job 30min away is caught on its
--   first eligible sweep; one whose start drifts will still get a
--   reminder up to ~5min out.
--
-- Status filter:
--   Only 'accepted' jobs trigger reminders. 'in_progress' has already
--   started; 'open' has no helper assigned to remind.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS start_reminder_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS jobs_start_reminder_pending_idx
  ON public.jobs (date_needed, start_time)
  WHERE start_reminder_sent_at IS NULL
    AND status = 'accepted'
    AND helper_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sweep_job_start_reminders()
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
      RAISE NOTICE 'sweep_job_start_reminders: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN total_pushed;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_job_start_reminders() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('sweep-job-start-reminders');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'sweep-job-start-reminders',
  '*/5 * * * *',
  $cron$SELECT public.sweep_job_start_reminders();$cron$
);
