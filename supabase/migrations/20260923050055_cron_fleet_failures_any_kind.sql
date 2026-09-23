-- A burst of scheduled-job failures of ANY kind pages, not only startup timeouts.
--
-- 2026-09-22 19:00 UTC: 18 pg_cron jobs failed in one hour with "connection
-- failed" (extend-boosts-hourly, auto-expire-jobs, auto-release-payment,
-- sweep-pending-broadcast-fan-outs, ...). NOTHING alerted (checked error_logs
-- 19:00-21:00: no cron row about it). sweep_cron_startup_failures only matched
-- return_message LIKE '%startup timeout%' — the 09-22 morning outage's exact
-- wording — and cron-dead needs one job to fail three runs in a row. A
-- fleet-wide burst of one-off failures fell between the two. (Q33,
-- docs/OPEN.md.)
--
-- Same function, same schedule, same 'cron-startup-timeout' source (the ops
-- alert ledger's close rule for it — a successful run since last_seen — still
-- holds), same floor and window dedupe. What changes: any failed run counts,
-- and the page names which kinds of failure it saw, so "could not START" is no
-- longer claimed about a job that started and lost its connection.

CREATE OR REPLACE FUNCTION public.sweep_cron_startup_failures()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- A single stray failure is background noise (0-15/day across the week
  -- before the 09-22 incident). Three inside the window is not.
  v_window   CONSTANT interval := interval '20 minutes';
  v_floor    CONSTANT int := 3;
  v_failed   int := 0;
  v_startup  int := 0;
  v_jobs     text[];
  v_kinds    text[];
  v_since    timestamptz;
  v_last     timestamptz;
BEGIN
  -- pg_cron may not be installed (a from-scratch replay, PGlite). Nothing to
  -- look at is not a defect to report.
  IF to_regclass('cron.job_run_details') IS NULL
     OR to_regclass('public.error_logs') IS NULL THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'cron.job_run_details not present');
  END IF;

  -- Any run that ended badly. 'running'/'starting' are in flight, not failed.
  SELECT count(*),
         count(*) FILTER (WHERE d.return_message LIKE '%startup timeout%'),
         array_agg(DISTINCT j.jobname),
         array_agg(DISTINCT left(COALESCE(d.return_message, d.status), 60)),
         min(d.start_time)
    INTO v_failed, v_startup, v_jobs, v_kinds, v_since
    FROM cron.job_run_details d
    LEFT JOIN cron.job j ON j.jobid = d.jobid
   WHERE d.start_time > now() - v_window
     AND d.status = 'failed';

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
  -- send_ops_daily_digest() — which is itself a cron. A cron outage must not
  -- be reported by a cron-delivered digest.
  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES (
    'fatal',
    CASE WHEN v_startup = v_failed THEN
      format('pg_cron could not START %s scheduled run(s) in the last %s — "job startup timeout". These jobs did not run late, they did not run at all, and nothing retries them. Affected: %s.',
             v_failed, v_window, array_to_string(v_jobs[1:8], ', ') ||
               CASE WHEN array_length(v_jobs, 1) > 8 THEN format(' and %s more', array_length(v_jobs, 1) - 8) ELSE '' END)
    ELSE
      format('%s scheduled run(s) FAILED in the last %s across %s job(s) (%s of them startup timeouts). Failures: %s. Nothing retries a failed run. Affected: %s.',
             v_failed, v_window, array_length(v_jobs, 1), v_startup,
             array_to_string(v_kinds[1:4], ' | '),
             array_to_string(v_jobs[1:8], ', ') ||
               CASE WHEN array_length(v_jobs, 1) > 8 THEN format(' and %s more', array_length(v_jobs, 1) - 8) ELSE '' END)
    END,
    jsonb_build_object('source', 'cron-startup-timeout', 'area', 'cron'),
    jsonb_build_object('failed_runs',      v_failed,
                       'startup_timeouts', v_startup,
                       'window',           v_window::text,
                       'since',            v_since,
                       'kinds',            to_jsonb(v_kinds),
                       'jobs',             to_jsonb(v_jobs)));

  RETURN jsonb_build_object('checked', true, 'failed', v_failed, 'reported', true,
                            'jobs', to_jsonb(v_jobs), 'kinds', to_jsonb(v_kinds));
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_cron_startup_failures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_cron_startup_failures() TO service_role;
