-- pg_cron refused to START 457 jobs today and the alert arrived nine hours in.
--
-- ── THE INCIDENT, from cron.job_run_details ────────────────────────────────
-- `return_message = 'job startup timeout'` means pg_cron could not launch the
-- background worker at all. The job did not run late; it did not run.
--
--   2026-09-15..21   0-15 startup timeouts/day, ~1,860 successes/day
--   2026-09-22       457 startup timeouts
--
-- Hour by hour on the 22nd, with successes beside them:
--   05:00   3 failed /  73 ok
--   06:00  17       /  64
--   08:00  47       /  33
--   09:00  65       /  12
--   10:00  64       /  12
--   11:00  61       /  15
--   12:00  59       /  22
--   13:00  69       /   8
--   14:00  60       /  18
--   15:00   9       /  65      <- recovering
--   16:00+  0       /  ~80     <- recovered
--
-- Throughput fell from ~78 runs/hour to 8. EVERY daily job scheduled in that
-- window never ran: expire-subscriptions, subscription-reconciliation,
-- cleanup-abandoned-accounts, cleanup-notifications, daily-match-digest,
-- sweep-daily-job-digest, stalled-completion-reminder, expiring-jobs-push and
-- ops-daily-digest. There is NO catch-up: a missed run is simply gone until
-- the next scheduled one, tomorrow.
--
-- ── WHY NOBODY WAS TOLD FOR NINE HOURS ─────────────────────────────────────
-- Two independent reasons, and the second is the one worth keeping.
--
-- 1. DETECTION IS SLOW BY CONSTRUCTION. `sweep_dead_crons` grades a job
--    'erroring' only when "its last 3 runs all failed inside pg_cron". For an
--    hourly job that is three hours; for a daily job, three DAYS. It first
--    flagged at 14:53 — by which time the incident was already ending.
--
-- 2. THE REPORT PATH SHARED FATE WITH THE FAILURE. `cron-dead` rows are
--    written at severity 'error'. `notify_slack_on_error_log()` pages only for
--    `severity = 'fatal'` or four allow-listed sources (detect_stuck_payments,
--    auto_start_due_jobs, detect_suspicious_user_patterns,
--    rls-escalation-refused); everything else is "counted in
--    send_ops_daily_digest()". And send_ops_daily_digest IS a cron —
--    `ops-daily-digest`, 14:40 UTC — which failed today with `job startup
--    timeout` like all the rest. The channel that would have reported the
--    outage was taken out by the outage.
--
-- That is the same shape this project has been bitten by repeatedly: a signal
-- structurally incapable of going red.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
-- A detector keyed on the UNAMBIGUOUS string pg_cron itself writes, available
-- after ONE bad run rather than three, writing 'fatal' so it pages through
-- trg_error_logs_slack directly and never depends on the digest.
--
-- HONEST LIMIT, stated because it cannot be engineered away here: this sweep
-- is itself a pg_cron job, so a severe enough outage can stop it starting too.
-- It is not a watchdog outside the system. What makes it worth having anyway
-- is that the failure is PARTIAL — even in the worst hour of this incident 8
-- of ~77 runs still succeeded, and this needs exactly one of its four hourly
-- slots to land. Nine hours becomes minutes, not zero. A true outside watchdog
-- (an external uptime ping asserting cron liveness) is the follow-up, and is
-- noted in docs/OPEN.md rather than pretended at here.
--
-- Replay-safe: CREATE OR REPLACE, every reference guarded, cron re-scheduled
-- by unschedule-then-schedule, the expectation row an upsert.

CREATE OR REPLACE FUNCTION public.sweep_cron_startup_failures()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  -- One clearly-bad run is enough to look, but a single stray timeout is
  -- normal background noise (0-15/day across the week before the incident).
  -- Three inside the window is not: at the incident's quietest hour that bar
  -- was cleared in under ten minutes.
  v_window   CONSTANT interval := interval '20 minutes';
  v_floor    CONSTANT int := 3;
  v_failed   int := 0;
  v_jobs     text[];
  v_since    timestamptz;
  v_last     timestamptz;
BEGIN
  -- pg_cron may not be installed (a from-scratch replay, PGlite). Nothing to
  -- look at is not a defect to report.
  IF to_regclass('cron.job_run_details') IS NULL
     OR to_regclass('public.error_logs') IS NULL THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'cron.job_run_details not present');
  END IF;

  SELECT count(*),
         array_agg(DISTINCT j.jobname),
         min(d.start_time)
    INTO v_failed, v_jobs, v_since
    FROM cron.job_run_details d
    LEFT JOIN cron.job j ON j.jobid = d.jobid
   WHERE d.start_time > now() - v_window
     AND d.return_message LIKE '%startup timeout%';

  IF COALESCE(v_failed, 0) < v_floor THEN
    RETURN jsonb_build_object('checked', true, 'failed', COALESCE(v_failed, 0), 'reported', false);
  END IF;

  -- Deduped on the window, not on a clock: while an incident is ongoing the
  -- page repeats at most once per window rather than once per failed run
  -- (457 rows would otherwise be 457 pages). 20260914183932 records what a
  -- looping alert costs — 616 rows in three days.
  SELECT max(created_at) INTO v_last
    FROM public.error_logs
   WHERE tags ->> 'source' = 'cron-startup-timeout';

  IF v_last IS NOT NULL AND v_last > now() - v_window THEN
    RETURN jsonb_build_object('checked', true, 'failed', v_failed,
                              'reported', false, 'already_reported_at', v_last);
  END IF;

  -- 'fatal' on purpose. It is the documented general way into
  -- notify_slack_on_error_log(), and it deliberately does NOT rely on
  -- send_ops_daily_digest() — which is itself a cron and died in this very
  -- incident. A cron outage must not be reported by a cron-delivered digest.
  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES (
    'fatal',
    format('pg_cron could not START %s scheduled run(s) in the last %s — "job startup timeout". These jobs did not run late, they did not run at all, and nothing retries them. Affected: %s.',
           v_failed, v_window,
           array_to_string(v_jobs[1:8], ', ') ||
             CASE WHEN array_length(v_jobs, 1) > 8
                  THEN format(' and %s more', array_length(v_jobs, 1) - 8) ELSE '' END),
    jsonb_build_object('source', 'cron-startup-timeout', 'area', 'cron'),
    jsonb_build_object('failed_runs', v_failed,
                       'window',      v_window::text,
                       'since',       v_since,
                       'jobs',        to_jsonb(v_jobs)));

  RETURN jsonb_build_object('checked', true, 'failed', v_failed, 'reported', true,
                            'jobs', to_jsonb(v_jobs));
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_cron_startup_failures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_cron_startup_failures() TO service_role;

COMMENT ON FUNCTION public.sweep_cron_startup_failures() IS
  'Reports pg_cron "job startup timeout" runs — jobs that never started at all — within one run instead of sweep_dead_crons'' three, at severity fatal so it pages through trg_error_logs_slack and never depends on send_ops_daily_digest (itself a cron, which died in the 2026-09-22 incident). Deduped on its own window.';

-- Four times an hour on minutes nothing else uses. Needs only ONE of the four
-- to start during an incident, which is the whole design (see the limit noted
-- at the top).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping sweep-cron-startup-failures';
    RETURN;
  END IF;
  PERFORM cron.unschedule('sweep-cron-startup-failures')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-cron-startup-failures');
  PERFORM cron.schedule('sweep-cron-startup-failures', '13,25,39,55 * * * *',
    $cron$SELECT public.sweep_cron_startup_failures();$cron$);
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.cron_work_expectations (jobname, expected_max_gap)
  VALUES ('sweep-cron-startup-failures', interval '2 hours')
  ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
END;
$$;
