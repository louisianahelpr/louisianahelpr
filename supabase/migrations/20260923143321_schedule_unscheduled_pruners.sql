-- Q167: two prune functions existed but nothing ever called them.
--
-- MEASURED (prod, 2026-09-23): cleanup_stripe_webhook_events() and
-- cleanup_observability_tables() had no cron.job, trigger, function, client or
-- edge caller, while stripe-webhook, stripe-idv-webhook and
-- verification-webhook comment that events "prune at 30 days". Live: 9
-- stripe_webhook_events rows older than 30 days (oldest 2026-07-08) and 221
-- analytics_events rows older than 90 days (oldest 2026-05-03).
--
-- This schedules both daily, each with a cron_work_expectations row so a
-- stopped pruner is itself an alert (cronLivenessCoverage.test.ts).
-- cleanup_observability_tables() also deletes error_logs older than 30 days,
-- the same window sweep_old_error_logs already applies, so the overlap is a
-- no-op rather than a second retention rule.
--
-- cron_catchup_policy: cronCatchUpPolicy.test.ts reads the NEWEST migration
-- that seeds the table as the whole policy, so the Q30 rows
-- (20260923133021) are restated verbatim with the two new jobs appended.
--
-- Replay-safe: guarded on the functions existing, ON CONFLICT on the
-- expectation rows, and cron.schedule upserts by job name.

DO $do$
BEGIN
  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    EXECUTE $pol$
INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason) VALUES
  ('ops-daily-digest',                true,  interval '20 hours', 'Slack digest of the last 24h of ops alerts; writes only its own delivery receipt. A late digest is the Q30 case itself: 09-22 went 38h with none.'),
  ('sweep-daily-job-digest',          true,  interval '6 hours',  'In-app "New jobs in <parish>" digest; its own NOT EXISTS skips anyone digested in the last 23h, so it cannot double-send. Capped at 6h because a late run shifts the next day''s by that 23h dedupe.'),
  ('daily-match-digest',              true,  interval '20 hours', 'Drains the match-digest queue and deletes what it sent (idempotent within a day, per its header), so a late run sends only what is still queued.'),
  ('push-token-health',               true,  interval '20 hours', 'Monitor (Q82): counts push tokens and writes at most one error_logs row per UTC day. Read-only otherwise.'),
  ('marketing-token-health',          true,  interval '20 hours', 'Monitor: checks the Meta token and that the publish queue drains; reads and alerts only.'),
  ('money-reconciliation',            true,  interval '20 hours', 'STRICTLY READ-ONLY by design (header of supabase/functions/money-reconciliation/index.ts): selects and Stripe paymentIntents.retrieve only. Reports money drift, never moves money.'),
  ('detect-suspicious-user-patterns', true,  interval '20 hours', 'Inserts a fraud_flags row only when no unresolved flag of that type exists for the user; its windows are relative to now(). Re-running is idempotent.'),
  ('sweep-old-email-send-log',        true,  interval '20 hours', 'Age-based TTL delete: a late run deletes exactly what the next run would. Idempotent.'),
  ('sweep-old-notifications',         true,  interval '20 hours', 'Age-based TTL delete of old notifications. Idempotent.'),
  ('sweep-old-error-logs',            true,  interval '20 hours', 'Age-based TTL delete of old error_logs. Idempotent.'),
  ('prune-cron-run-details',          true,  interval '20 hours', 'Deletes cron.job_run_details older than 7 days; the catch-up reads only the latest slot. Idempotent.'),
  ('prune-cron-run-log',              true,  interval '20 hours', 'Age-based prune of cron_run_log. Idempotent.'),
  ('prune-edge-rate-limit-log',       true,  interval '20 hours', 'Age-based prune of the edge rate-limit log. Idempotent.'),
  ('cleanup-notifications',           true,  interval '20 hours', 'Deletes READ notifications older than 30 days (age-based). Idempotent.'),
  ('stalled-completion-reminder',     true,  interval '6 hours',  'User nudge with its own per-job ledger (first_sent_at / second_sent_at / escalated_at, upsert ignoreDuplicates): a stage is never sent twice. 6h cap keeps it inside daytime.'),
  ('expiring-jobs-push',              true,  interval '6 hours',  'User push with its own expiring_notif_sent flag (per its header): never notifies a job twice. 6h cap keeps it inside daytime and before the jobs expire.'),
  ('review-nag-cron',                 true,  interval '6 hours',  'User nudge with its own dedupe count per user and job inside WINDOW_HOURS, failing closed (unreadable count = already nagged). 6h cap keeps it inside daytime.'),
  ('engagement-automations',          true,  interval '6 hours',  'Lifecycle emails spaced by last_drip_at / last_approval_email_at, which it stamps on send: a late run cannot send a step twice. 6h cap keeps it inside daytime.'),
  ('charge-recurring-visits',         false, interval '1 hour',   'CHARGES CARDS for recurring visits. Money is never auto-rerun: a person checks what the missed day should have charged.'),
  ('expire-subscriptions',            false, interval '1 hour',   'Ends paid entitlements (one-time passes, lapsed tiers). Changes what a paying user has; a person decides.'),
  ('subscription-reconciliation',     false, interval '1 hour',   'REPAIRS tier state from Stripe (its header: "why this one repairs"). An automated entitlement writer is not re-run blind; a person decides.'),
  ('cleanup-abandoned-accounts',      false, interval '1 hour',   'DELETES accounts. Destructive; never re-run automatically.'),
  ('weekly-helper-report',            false, interval '1 hour',   'Weekly earnings email to every Helpr with no send-dedupe of its own (none in supabase/functions/weekly-helper-report). A person decides whether a late weekly email is wanted.'),
  ('cleanup-stripe-webhook-events',   true,  interval '20 hours', 'Q167: deletes stripe_webhook_events processed over 30 days ago; the window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('cleanup-observability-tables',    true,  interval '20 hours', 'Q167: deletes analytics_events over 90 days and error_logs over 30; relative windows, idempotent, so a late run is the same prune.')
ON CONFLICT (jobname) DO UPDATE
  SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
      reason = EXCLUDED.reason, updated_at = now();
    $pol$;
  END IF;
END
$do$;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
    VALUES ('cleanup-stripe-webhook-events', interval '30 hours',
            'Q167: daily prune of stripe_webhook_events processed over 30 days ago.'),
           ('cleanup-observability-tables', interval '30 hours',
            'Q167: daily prune of analytics_events over 90 days (and error_logs over 30).')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF to_regprocedure('public.cleanup_stripe_webhook_events()') IS NOT NULL THEN
      PERFORM cron.schedule('cleanup-stripe-webhook-events', '25 4 * * *',
                            'SELECT public.cleanup_stripe_webhook_events();');
    END IF;
    IF to_regprocedure('public.cleanup_observability_tables()') IS NOT NULL THEN
      PERFORM cron.schedule('cleanup-observability-tables', '35 4 * * *',
                            'SELECT public.cleanup_observability_tables();');
    END IF;
  END IF;
END
$do$;
