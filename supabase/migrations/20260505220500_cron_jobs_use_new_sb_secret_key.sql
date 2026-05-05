-- All 12 pg_cron jobs were reading vault.legacy_service_role_key (the old
-- eyJ JWT, 219 chars) and sending it as Bearer when invoking edge
-- functions. Each function's internal auth check compares the Bearer to
-- the SECRET_KEY env var (set 2026-05-05 to the new sb_secret_*, 41
-- chars). Mismatch → every cron tick 401s.
--
-- Logs from before this migration showed:
--   POST | 401 | https://.../functions/v1/auto-release-payment   (every 30 min)
--   POST | 401 | https://.../functions/v1/auto-expire-jobs       (every hour)
--   POST | 401 | https://.../functions/v1/void-cancelled-payments (every hour)
--   POST | 401 | https://.../functions/v1/auto-resolve-disputes   (every 6 hours)
--   POST | 500 | https://.../functions/v1/process-email-queue     (every 5 min)
--     ^ separate issue: missing RESEND_API_KEY env var, fixed in commit 04919851
--
-- Fix: switch the cron commands to read vault.service_role_key (the new
-- sb_secret_*, also written 2026-05-05 by cowork) instead. Then cron
-- Bearer matches SECRET_KEY env var → auth passes → cron work runs.
--
-- After Disable Legacy is clicked + verified working, the
-- legacy_service_role_key vault entry can be removed
-- (currently nothing else references it).
--
-- Direct UPDATE on cron.job is denied for the postgres role; using
-- cron.alter_job() instead — the official pg_cron API for mutating jobs.

DO $$
DECLARE
  job_record RECORD;
  new_command TEXT;
BEGIN
  FOR job_record IN
    SELECT jobid, command
    FROM cron.job
    WHERE position('legacy_service_role_key' in command) > 0
  LOOP
    new_command := replace(job_record.command, 'legacy_service_role_key', 'service_role_key');
    PERFORM cron.alter_job(
      job_id := job_record.jobid,
      command := new_command
    );
  END LOOP;
END $$;
