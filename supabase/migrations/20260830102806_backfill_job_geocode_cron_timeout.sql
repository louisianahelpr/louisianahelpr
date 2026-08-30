-- Fix pg_net's default timeout for the backfill-job-geocode cron.
--
-- Verified live after 20260830100444 deployed: the migration, the edge
-- function, and the cron schedule all landed correctly, and a manual
-- trigger of the exact net.http_post the cron runs proved the function
-- executes end-to-end (5 open jobs went from null to real coordinates).
--
-- But net.http_post with no `timeout_milliseconds` defaults to 5000ms, and
-- this function is not a fast DB-only sweep like its cron siblings — it
-- serially geocodes up to MAX_JOBS_PER_RUN (30) candidates through
-- Nominatim at ~1.1s apart by design (fair-use rate limit), so a run with
-- any real backlog structurally takes well over 5s. The manual trigger's
-- own net._http_response row confirmed this: "Timeout of 5000 ms reached."
--
-- 20260828010000_cron_http_failure_watcher.sql already treats a pg_net
-- timeout as a non-paging warning rather than a hard failure — it exists
-- for exactly this shape of thing — so nothing was ever going to page. But
-- that tolerance was designed for occasional cold-start overruns on crons
-- that normally finish in time, not a cron that overruns on every single
-- run with a backlog. Left alone, every scheduled run logs a "timeout"
-- warning into error_logs, which erodes the one signal the watcher exists
-- to preserve. Bumping the timeout to comfortably cover the worst case
-- (30 candidates x ~1.1s sleep + request latency, well under 90s) lets a
-- normal run finish cleanly and reserves the warning for genuine
-- slowness.
--
-- Replay-safe: unschedule-if-present, then schedule.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping backfill-job-geocode timeout fix';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'backfill-job-geocode') THEN
    PERFORM cron.unschedule('backfill-job-geocode');
  END IF;

  PERFORM cron.schedule(
    'backfill-job-geocode',
    '17 */4 * * *',
    $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
               || '/functions/v1/backfill-job-geocode',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 90000
      );
    $cron$
  );
END $$;
