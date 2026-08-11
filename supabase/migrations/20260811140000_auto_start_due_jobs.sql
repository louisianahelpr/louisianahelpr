-- Auto-start booked jobs once their scheduled time arrives.
--
-- The gap this closes: nothing moved a job from `accepted` to `in_progress`
-- on its own. Only two paths did it, and both need a human — the helper
-- setting a tracking status (on my way / arrived / working), or the poster
-- tapping start. None of the six existing crons touch this transition.
--
-- So a job booked for Tuesday 9am, where both people simply show up and do
-- the work without opening the app, stayed `accepted` forever. It never
-- reached `completed`, which means ESCROW NEVER RELEASED: the 48-hour
-- auto-release clock only starts after a completion confirmation that never
-- came. A money path that depends on someone remembering to tap a button.
--
-- Implemented as plain SQL on pg_cron rather than an edge function on a
-- timer. There is no external side effect to make — it is one UPDATE — and
-- the existing notify_poster_on_status_change trigger already fires on
-- `in_progress`, so the poster is told for free. It also sidesteps the
-- Bearer/SECRET_KEY mismatch class of bug that 401'd five cron-invoked
-- functions in May (see 20260505220500).

-- ── The sweeper ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_start_due_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  started integer;
BEGIN
  WITH due AS (
    UPDATE public.jobs j
       SET status = 'in_progress'::job_status
     WHERE j.status = 'accepted'::job_status
       -- Truly BOOKED, not merely offered. `accepted` covers two different
       -- moments: helpr chosen but not yet confirmed, and both sides locked
       -- in. Auto-starting the former would start a job nobody agreed to.
       AND j.helper_id IS NOT NULL
       AND j.helper_confirmed_at IS NOT NULL
       -- A flexible-schedule job has no meaningful start moment, so there is
       -- nothing to trigger on. Those stay manual.
       AND COALESCE(j.is_flexible_schedule, false) = false
       -- date_needed is a DATE and start_time a naive TIME; both are local
       -- wall-clock. Helpr is Louisiana-only, so they are interpreted in
       -- America/Chicago and converted to an absolute instant. Comparing
       -- them against now() without this would be wrong by the UTC offset —
       -- jobs would start 5-6 hours early.
       AND ((j.date_needed + COALESCE(j.start_time, '00:00'::time))
              AT TIME ZONE 'America/Chicago') <= now()
       -- Backstop: never retro-start something long past. Without this the
       -- FIRST run would flip every stale booking in the table at once,
       -- firing a notification per job and dragging abandoned work into the
       -- live lifecycle. A job more than 7 days past its start was not
       -- "about to happen" — it needs a human.
       AND ((j.date_needed + COALESCE(j.start_time, '00:00'::time))
              AT TIME ZONE 'America/Chicago') > now() - interval '7 days'
    RETURNING 1
  )
  SELECT count(*) INTO started FROM due;
  RETURN started;
END;
$$;

-- Deliberately NOT granted to `authenticated` or `anon`. This mutates job
-- state on the money path and is only ever invoked by pg_cron (which runs as
-- the table owner). REVOKE is explicit rather than relying on the default so
-- the intent survives a future default-privileges change.
REVOKE ALL ON FUNCTION public.auto_start_due_jobs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_start_due_jobs() FROM anon;
REVOKE ALL ON FUNCTION public.auto_start_due_jobs() FROM authenticated;

-- ── Schedule ────────────────────────────────────────────────────────
-- Every 15 minutes. Finer granularity buys nothing — a job starting up to
-- 15 minutes "late" is invisible next to a job that never started at all —
-- and it keeps the tick count modest (~2.9k/month).
--
-- Unschedule-then-schedule so a re-run replaces cleanly rather than
-- erroring on a duplicate name, keeping the migration replay-safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('auto-start-due-jobs')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-start-due-jobs');
    PERFORM cron.schedule(
      'auto-start-due-jobs',
      '*/15 * * * *',
      $cron$ SELECT public.auto_start_due_jobs(); $cron$
    );
  END IF;
END
$$;
