-- Schedule the money-reconciliation alarm.
--
-- WHY: a poster who blocked their helper mid-job had the job cancelled with
-- `cancellation_fee: 0` written from the client. Escrow settled correctly
-- because `void-cancelled-payments` RECOMPUTES the fee instead of reading the
-- stored column — but the persisted row then disagreed with the money that
-- actually moved, and that stored value feeds the helper's fee pill, the admin
-- late-cancel revenue figures, and the helper's reliability record. Nothing
-- surfaced the gap; it was found by reading code.
--
-- The edge function is STRICTLY READ-ONLY over the data it audits. It reports;
-- it never repairs. It is silent when clean, so any Slack message from it is a
-- real signal.
--
-- Schedule: 08:20 UTC daily. Deliberately AFTER the money crons that produce
-- the state it audits — void-cancelled-payments runs hourly, expire-subscriptions
-- at 08:00 — so a discrepancy reported here is a settled fact and not a job
-- mid-flight. It is a read-only reporter, so a missed run costs nothing but a
-- day of latency; hourly would only add noise.
--
-- Same net.http_post + vault-secret shape as every other cron-invoked edge
-- function in this project (auto-release-payment, void-cancelled-payments,
-- expire-subscriptions), so `sweep_cron_http_failures` (20260828010000) picks
-- up its non-2xx responses for free.
--
-- Replay-safe and idempotent: the unschedule is guarded, and cron.schedule
-- upserts by jobname.

DO $$
BEGIN
  PERFORM cron.unschedule('money-reconciliation');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'money-reconciliation',
  '20 8 * * *',
  $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
             || '/functions/v1/money-reconciliation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := '{}'::jsonb
    );
  $cron$
);
