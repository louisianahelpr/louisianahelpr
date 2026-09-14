-- Slow the five busiest in-database sweeps to every 15 minutes (owner, 2026-09-14).
--
-- Prod runs on the free tier's t4g.nano. On 2026-09-13 its disk-IO allowance ran
-- out (Infrastructure page: Disk IO 100%, CPU 80%) and the database was down for
-- over a day. The nightly prod test workflows were the main load and are paused,
-- but these five jobs alone ran ~1,700 times a day. The owner chose to trade
-- up to ~15 minutes of notification latency for that headroom.
--
-- Checked against the live function bodies before choosing 15 minutes: every one
-- dedupes on its own *_sent_at / push_fanned_out_at column and scans a window
-- wider than 15 minutes, so a slower cadence delays a notification but never
-- skips or double-sends one:
--   sweep_job_start_reminders       start within the next 35 min
--   sweep_no_show_alerts            started 30 min – 6 h ago
--   sweep_dayof_confirm_reminders   start within 24 h / 12 h
--   sweep_release_last_chance       helper completed 22–24 h ago
--   sweep_pending_broadcast_fan_outs  pending_push_fan_out_at <= now()
--
-- Only the SCHEDULE changes (cron.alter_job), never the command, same as
-- 20260829010000. Minutes are offset so none of the five co-fire with each other
-- or with the hourly :00 / :05 / :10 / :20 jobs. Replay-safe: a missing job is
-- skipped, and alter_job to the same schedule is a no-op.
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT j.jobid, v.sched
    FROM (VALUES
      ('sweep-pending-broadcast-fan-outs', '1,16,31,46 * * * *'),
      ('sweep-job-start-reminders',        '2,17,32,47 * * * *'),
      ('sweep-dayof-confirm-reminders',    '4,19,34,49 * * * *'),
      ('sweep-release-last-chance',        '8,23,38,53 * * * *'),
      ('sweep-no-show-alerts',             '12,27,42,57 * * * *')
    ) AS v(name, sched)
    JOIN cron.job j ON j.jobname = v.name
  LOOP
    PERFORM cron.alter_job(job_id := r.jobid, schedule := r.sched);
  END LOOP;
END
$$;
