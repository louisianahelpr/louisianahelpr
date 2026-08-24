-- Schedule `charge-recurring-visits` — the migration that turns Repeats on.
--
-- The code has been finished and waiting for a while: the day picker, the
-- schema, the standing-helper model, and the edge function itself, which is
-- deployed and ACTIVE on prod. What was missing was exactly two things — a cron
-- schedule and the `RECURRING_ENABLED` flag — and 20260821020000 (the migration
-- that unscheduled the WITHDRAWN `spawn-recurring-jobs` path) left an
-- instruction for whoever came back to it:
--
--   "The correct place to schedule it is the SAME migration that flips
--    RECURRING_ENABLED, so the charge path and the feature can never be out of
--    step again — which is the failure this migration exists to clean up."
--
-- The flag is a TypeScript constant, not SQL, so "the same migration" is
-- honoured as the same COMMIT: this file and the flip land together. Owner
-- approved 2026-08-23.
--
-- WHAT DOES *NOT* GET RESCHEDULED: `spawn-recurring-jobs`. That is the withdrawn
-- path — it copied a job's descriptive fields onto a new open row with no
-- payment attached, so a helper could work a visit the poster was never charged
-- for. It stays unscheduled, and this migration deliberately does not touch it.
-- `charge-recurring-visits` inverts the ordering: the PaymentIntent succeeds
-- FIRST and the job row is inserted after, so an unfunded visit cannot exist.
--
-- 06:00 UTC — around midnight Central. It funds three days ahead
-- (FUND_LEAD_DAYS), so a declined card surfaces with a full working day of
-- slack before the helpr is expecting to show up, and it does not collide with
-- the 04:00 and 09:00 daily sweeps.
--
-- Replay-safe: unschedule-if-present, then schedule. `cron.unschedule` throws
-- when the job does not exist, so it is guarded rather than wrapped in a
-- swallow-everything handler that would also hide a real failure.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping charge-recurring-visits schedule';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'charge-recurring-visits') THEN
    PERFORM cron.unschedule('charge-recurring-visits');
  END IF;

  PERFORM cron.schedule(
    'charge-recurring-visits',
    '0 6 * * *',
    $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
               || '/functions/v1/charge-recurring-visits',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
END $$;
