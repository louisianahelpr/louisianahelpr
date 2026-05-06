-- Cleanup: stale 'one-shot-test-auto-expire' cron was running every
-- minute (* * * * *), hammering the auto-expire-jobs edge function
-- ~43k times/month for no product value. The proper auto-expire-jobs
-- cron runs hourly (0 * * * *) and is the only one we need.
--
-- Origin: best guess is a manual one-off scheduled during testing
-- months ago that never got cleaned up. The schedule + name are
-- giveaways. No app code references it.

DO $$
BEGIN
  PERFORM cron.unschedule('one-shot-test-auto-expire');
EXCEPTION WHEN OTHERS THEN
  -- Already gone, that's fine.
  NULL;
END;
$$;
