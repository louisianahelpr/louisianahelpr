-- F-MONEY-01: retire the legacy parallel payout cron.
--
-- The canonical escrow payout path is auto-release-payment -> release-payout
-- (idempotent, jobid 14). A second cron, 'process-scheduled-payouts', releases
-- payouts on its own schedule against the same jobs -- a double-release race
-- with no shared idempotency guard. Retire it so there is exactly one writer.
--
-- Replay-safe: cron.unschedule(name) errors if the job is absent, so guard on
-- its existence in cron.job. Also guard on the pg_cron extension being present
-- (a from-scratch rebuild may run before pg_cron is installed).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-payouts')
  THEN
    PERFORM cron.unschedule('process-scheduled-payouts');
  END IF;
END;
$$;
