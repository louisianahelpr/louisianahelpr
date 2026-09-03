-- cron.job_run_details is half the database and nothing has ever deleted from it.
--
-- MEASURED IN PROD:
--     cron.job_run_details   78 MB, 316,348 rows, oldest 2026-05-04
--     whole database        153 MB
--     share                  51.2%
--     free-tier cap         500 MB
--
-- pg_cron appends one row per job execution forever. This project runs ~20
-- scheduled functions, several per minute, so the table has grown every minute
-- since the day cron was enabled and has never been pruned. Half the storage
-- on this plan is a log of jobs that already finished.
--
-- NOT URGENT, AND SAYING SO MATTERS: at ~0.64 MB/day the cap is over a year
-- away. This is not a fire. It is worth fixing now because an unbounded table
-- is a slow leak that nobody notices until it is the thing standing between you
-- and a launch, and because the fix is eleven lines.
--
-- WHY SEVEN DAYS. The only consumer is the app's own dead-cron detector,
-- `sweep_silent_cron_failures()`, which looks back SIX HOURS. Seven days is
-- twenty-eight times its window — enough to investigate a weekend outage on
-- Monday, and still 99% smaller than what is there. Deliberately not one day:
-- the point of a run log is to be readable after the fact by a person who was
-- not watching.
--
-- pg_cron owns this table, so this schedules a job rather than adding a trigger:
-- DELETE + the extension's own scheduler is the supported route, and a trigger
-- on a system-extension table is not.
--
-- The initial prune is deliberately NOT run inside this migration. Deleting
-- ~310,000 rows in one statement takes a long lock on a table every scheduled
-- job writes to, during a deploy. The scheduled job does it on its own next
-- tick, off the deploy path.
--
-- Replay-safe: `cron.schedule` upserts by job name.

SELECT cron.schedule(
  'prune-cron-run-details',
  '17 4 * * *',                       -- daily, off the busy minute-boundaries
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$
);

COMMENT ON EXTENSION pg_cron IS
  'Scheduled jobs. NOTE: cron.job_run_details grows one row per execution and '
  'pg_cron never prunes it — it reached 78 MB / 316k rows / 51% of this database '
  'before prune-cron-run-details was added on 2026-09-03. Retention is 7 days, '
  'which is 28x the 6-hour window sweep_silent_cron_failures() actually reads.';
