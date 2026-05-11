-- Notifications TTL sweeper.
--
-- The notifications table grows unbounded — every push, every job
-- application, every status change, every chat message (now, post-
-- 20260506420000) inserts a row. For active users this is hundreds
-- per month. Without TTL, the table will be in the millions within
-- a year, slowing every read + write (especially the per-user fetch
-- in NotificationPanel + the realtime subscription's filter scan).
--
-- Retention rules:
--   - READ notifications older than 30 days → delete (user has seen
--     them; the in-app history isn't a long-term archive)
--   - UNREAD notifications older than 90 days → delete (probably
--     user-abandoned; keeping them past a quarter is just noise)
--
-- Why two windows: deleting a 31-day-old unread notification could
-- silently bury a "Your account is approved!" message someone is
-- about to come back and see. 90 days is generous enough that this
-- is unlikely.
--
-- Daily cron at 03:30 UTC (low traffic, after most US bedtimes).
--
-- Idempotent: just deletes; safe to run multiple times.

CREATE OR REPLACE FUNCTION public.sweep_old_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted_count integer := 0;
  read_deleted integer := 0;
  unread_deleted integer := 0;
BEGIN
  -- READ notifications older than 30 days
  DELETE FROM public.notifications
  WHERE read = true
    AND created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS read_deleted = ROW_COUNT;

  -- UNREAD notifications older than 90 days (user-abandoned)
  DELETE FROM public.notifications
  WHERE read = false
    AND created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS unread_deleted = ROW_COUNT;

  deleted_count := read_deleted + unread_deleted;

  -- Optional: log to error_logs at info severity so admins can verify
  -- the sweeper is running and how much it's clearing. Skipped if
  -- nothing was deleted to keep the log clean.
  IF deleted_count > 0 THEN
    INSERT INTO public.error_logs (message, severity, tags)
    VALUES (
      format('sweep_old_notifications: deleted %s rows (%s read, %s unread)',
        deleted_count, read_deleted, unread_deleted),
      'info',
      jsonb_build_object('source', 'sweep_old_notifications')
    );
  END IF;

  RETURN deleted_count;
EXCEPTION
  -- error_logs may not exist or may not have the expected shape in
  -- some schema histories — never let logging failure mask the cleanup.
  WHEN OTHERS THEN
    RAISE WARNING 'sweep_old_notifications: completed deletes but logging failed: %', SQLERRM;
    RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_old_notifications() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sweep_old_notifications() IS
'Daily TTL sweep for the notifications table. Deletes READ rows >30d and UNREAD rows >90d. Returns total rows deleted. Idempotent.';

-- Daily cron at 03:30 UTC = 22:30 CST (after most US bedtimes).
-- Use the same DO block pattern as other migrations to make this
-- safe to re-run (cron.schedule fails if the job name already exists).
DO $$
BEGIN
  PERFORM cron.unschedule('sweep-old-notifications');
EXCEPTION WHEN OTHERS THEN
  -- Job didn't exist; that's fine
  NULL;
END $$;

SELECT cron.schedule(
  'sweep-old-notifications',
  '30 3 * * *',
  $cron$SELECT public.sweep_old_notifications();$cron$
);
