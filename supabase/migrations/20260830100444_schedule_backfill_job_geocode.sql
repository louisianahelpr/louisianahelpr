-- Schedule `backfill-job-geocode` — backstop for jobs.latitude/longitude.
--
-- The owner asked to delete the "N of M Mapped" badge on the Browse map
-- ("delete it, they should all be mapped") rather than surface the gap.
-- Investigation found the gap is real and ongoing, not a one-time backfill
-- need: useJobSubmit.ts geocodes via Nominatim client-side, best-effort,
-- capped at 2.5s so a slow lookup never stalls checkout — any job whose
-- lookup is slow, rate-limited, or fails silently loses its coords for
-- good. There is no DB trigger and no retry.
--
-- This cron re-geocodes open jobs still missing coords a few times a day.
-- Runs off-peak-adjacent hours, offset from the other sweeps already
-- scheduled at :00 (see 20260829010000_stagger_http_cron_schedules.sql).
--
-- Replay-safe: unschedule-if-present, then schedule.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping backfill-job-geocode schedule';
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
        body := '{}'::jsonb
      );
    $cron$
  );
END $$;
