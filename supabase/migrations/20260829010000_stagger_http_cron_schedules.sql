-- Give every HTTP cron its own minute.
--
-- 16 of the 18 net.http_post crons could fire at minute 0: fourteen sit on
-- `0 <hour> * * *`, auto-release-payment's `*/30` lands on :00, and
-- process-email-queue's `*/5` does too. Measured at 05:00 on 2026-08-26, four
-- responses came back stamped with the identical timestamp 05:00:00.212006.
--
-- Two costs, one of which is already paid:
--
-- 1. Attribution. sweep_cron_http_failures() had to guess which cron a response
--    belonged to by start-time proximity, and with a four-way tie it guessed
--    wrong three times out of four — crediting auto-release-payment,
--    void-cancelled-payments and process-email-queue responses all to
--    auto-expire-jobs. 20260828030000 fixed that by having each function name
--    itself in its body, so this migration is no longer load-bearing for
--    attribution. It still matters for anything that CANNOT self-report: a
--    502 from the gateway, an auth rejection, or a function that never reaches
--    its own return statement. Those fall back to proximity, and proximity is
--    only trustworthy if the minutes are unique.
--
-- 2. A thundering herd. Sixteen edge functions cold-starting in the same second
--    contend for the same pool, and pg_net gives up at 5 seconds. The one
--    pg_net timeout observed so far was process-email-queue — a `*/5` job whose
--    ticks collide with everything else's :00.
--
-- Only the SCHEDULE changes. cron.alter_job leaves each job's command, database
-- and owner untouched, which is why this is done with alter_job rather than
-- re-running cron.schedule with a re-typed command — a re-typed command is how
-- a working money cron gets broken by a migration meant to be cosmetic.
--
-- Minute map (nothing shares a minute with anything it can co-fire with):
--
--   :00        auto-expire-jobs                (hourly)
--   :03/5      process-email-queue             (every 5 min, 12/hr preserved)
--   :05,:35    auto-release-payment            (was */30 → :00,:30)
--   :07        auto-tip-charge                 (unchanged)
--   :10        void-cancelled-payments         (was :00)
--   :21 */6    auto-resolve-disputes           (was :00)
--   :41 */6    saved-helper-availability-push  (was :00)
--   06:06 charge-recurring-visits      08:09 expire-subscriptions
--   08:20 money-reconciliation (kept)  09:11 cleanup-abandoned-accounts
--   09:16 cleanup-notifications        13:12 daily-match-digest
--   14:14 expiring-jobs-push           14:19 weekly-helper-report (Mon)
--   15:15 payment-confirm-reminder     16:22 engagement-automations
--   16:26 review-nag-cron
--
-- No job moves by more than 41 minutes and none changes frequency, so no
-- business behaviour shifts: the daily jobs still run once on the same day and
-- process-email-queue still runs every five minutes.

DO $$
DECLARE
  v_target  record;
  v_jobid   bigint;
  v_moved   int := 0;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      ('auto-release-payment',           '5,35 * * * *'),
      ('process-email-queue',            '3-58/5 * * * *'),
      ('void-cancelled-payments',        '10 * * * *'),
      ('auto-resolve-disputes',          '21 */6 * * *'),
      ('saved-helper-availability-push', '41 */6 * * *'),
      ('charge-recurring-visits',        '6 6 * * *'),
      ('expire-subscriptions',           '9 8 * * *'),
      ('cleanup-abandoned-accounts',     '11 9 * * *'),
      ('cleanup-notifications',          '16 9 * * *'),
      ('daily-match-digest',             '12 13 * * *'),
      ('expiring-jobs-push',             '14 14 * * *'),
      ('weekly-helper-report',           '19 14 * * 1'),
      ('payment-confirm-reminder',       '15 15 * * *'),
      ('engagement-automations',         '22 16 * * *'),
      ('review-nag-cron',                '26 16 * * *')
    ) AS t(jobname, schedule)
  LOOP
    -- Replay-safe: on a from-scratch rebuild the jobs are created by their own
    -- migrations, and any that has not been created yet is simply skipped
    -- rather than aborting the run.
    SELECT j.jobid INTO v_jobid FROM cron.job j WHERE j.jobname = v_target.jobname;
    IF v_jobid IS NULL THEN
      RAISE NOTICE 'stagger: % not scheduled here, skipping', v_target.jobname;
      CONTINUE;
    END IF;

    PERFORM cron.alter_job(job_id := v_jobid, schedule := v_target.schedule);
    v_moved := v_moved + 1;
  END LOOP;

  RAISE NOTICE 'stagger: re-scheduled % HTTP cron(s)', v_moved;
END;
$$;
