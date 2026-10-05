-- Q1373: every HTTP cron waits 90s for its answer, not 30s.
--
-- MEASURED (prod, 2026-10-05): arrival-confirm-reminder's 12:24Z run took
-- 60,446ms (function_edge_logs execution_time_ms) and answered 200, a clean
-- run. The API gateway logged no request from it between 12:24:00 and
-- 12:25:04 (edge_logs), and the 12:14Z run took 341ms: the time went to the
-- platform, not to our query. pg_net gave up at 30,000ms, so the sweep filed
-- a "Cron HTTP timeout" for a run that succeeded. Same shape as the
-- 2026-09-25 17:34Z stall (42,840ms, see _shared/boundedFetch.ts). Both fit
-- inside 90s, which backfill-job-geocode already uses (20260830102806).
-- A longer wait loses nothing: pg_net never cancels the function, it only
-- decides whether we learn the real answer.
--
-- Replay-safe: only rewrites a command that still says exactly
-- `timeout_milliseconds := 30000`; a second run finds none.
DO $$
DECLARE
  j record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed: skipping HTTP cron timeout rewrite';
    RETURN;
  END IF;

  FOR j IN
    SELECT jobid, command FROM cron.job
     WHERE command LIKE '%net.http_post(%'
       AND command ~ 'timeout_milliseconds\s*:=\s*30000\M'
  LOOP
    PERFORM cron.alter_job(
      j.jobid,
      command := regexp_replace(j.command, 'timeout_milliseconds\s*:=\s*30000\M', 'timeout_milliseconds := 90000', 'g')
    );
  END LOOP;
END $$;
