-- Q786 / Q317: spread the cron jobs piled on minute :00.
--
-- pg_cron runs with cron.use_background_workers = off, so every job that starts
-- in a minute opens its own Postgres connection. quota-monitor's connection
-- budget (scripts/check-db-pool-budget.mjs) reserves max(10, busiest minute of
-- cron starts over 2 days) for pg_cron. Measured on 2026-09-27 from
-- cron.job_run_details: the busiest minute was 14:00Z with 12 starts, every
-- day, and the check went red at demand 59 vs 57 usable (runs 36349151127,
-- 36351838162). At 14:00Z these all started together:
--   every minute  job-match-queue, saved-search-alert-queue
--   */15          auto-start-due-jobs, detect-stuck-payments, sweep-cron-http-failures
--   */5           db-saturation-check, error-log-throttle-check
--   hourly :00    auto-expire-jobs, extend-boosts-hourly, sweep-expired-auto-bans
--   daily 14:00   stalled-completion-reminder, sweep-daily-job-digest
-- (and 04:00Z added sweep-old-email-send-log).
--
-- Five jobs move to quiet minutes, which drops the busiest scheduled minute
-- from 12 to 8, under the check's floor of 10:
--   extend-boosts-hourly         0 * * * *   -> 56 * * * *
--   sweep-expired-auto-bans      0 * * * *   -> 52 * * * *
--   stalled-completion-reminder  0 14 * * *  -> 46 13 * * *
--   sweep-daily-job-digest       0 14 * * *  -> 56 13 * * *
--   sweep-old-email-send-log     0 4 * * *   -> 46 3 * * *
--
-- Every move is EARLIER, never later. A job moved later can run twice in the
-- window it is deployed in (once at :00, again at the new minute); a job moved
-- earlier can at worst skip that one slot. For the digest and the reminder a
-- skipped slot is the safer failure than a duplicate email.
--
-- Only the SCHEDULE changes: cron.alter_job leaves command, database and owner
-- untouched (same reasoning as 20260829010000_stagger_http_cron_schedules).
-- Guard: src/test/cronStartsSpreadAcrossMinutes.test.ts.
--
-- Replay-safe: a job not scheduled here (a from-scratch rebuild, or a job
-- created outside migrations) is skipped, and re-running sets the same values.

DO $$
DECLARE
  v_target record;
  v_jobid  bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'spread: pg_cron not installed here, skipping';
    RETURN;
  END IF;

  FOR v_target IN
    SELECT * FROM (VALUES
      ('extend-boosts-hourly',        '56 * * * *'),
      ('sweep-expired-auto-bans',     '52 * * * *'),
      ('stalled-completion-reminder', '46 13 * * *'),
      ('sweep-daily-job-digest',      '56 13 * * *'),
      ('sweep-old-email-send-log',    '46 3 * * *')
    ) AS t(jobname, schedule)
  LOOP
    v_jobid := NULL;
    SELECT j.jobid INTO v_jobid FROM cron.job j WHERE j.jobname = v_target.jobname;
    IF v_jobid IS NULL THEN
      RAISE NOTICE 'spread: % not scheduled here, skipping', v_target.jobname;
      CONTINUE;
    END IF;
    PERFORM cron.alter_job(job_id := v_jobid, schedule := v_target.schedule);
  END LOOP;
END;
$$;
