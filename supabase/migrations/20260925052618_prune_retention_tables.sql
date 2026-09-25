-- Age-based retention for the append-only tables that had none (CJ-003, Q224)
-- and for W-9 records (CS-003, Q370; owner MQ15/18 2026-09-24: keep a W-9 for
-- 4 years after signing, then delete it automatically, whether or not the
-- Helpr's account still exists).
--
-- MEASURED (prod, 2026-09-25): no function deletes by age from job_views,
-- profile_views, application_rate_log or profile_search_rate_log; the only
-- deleter of notification_logs and login_history is purge_user_data (per-user
-- account deletion); nothing deletes from helper_w9_records at all.
--
-- Windows, each at least as long as the longest read of the table:
--   login_history           365 days, but each user's NEWEST row is kept:
--                           get_user_last_active() is MAX(created_at) per user
--                           ("Active N ago" on profiles and conversations).
--   notification_logs       180 days (readers look back 24h / 7 days:
--                           check_push_token_health, ops_alert_condition).
--   profile_views           180 days (write-only: record_profile_view; no
--                           reader). viewed_at is timestamp WITHOUT time zone,
--                           defaulting to LOCALTIMESTAMP, so it is compared
--                           with LOCALTIMESTAMP.
--   job_views               365 days (get_job_view_counts, the poster's
--                           per-job view count on their posted jobs).
--   application_rate_log    7 days (rpc_check_application_rate windows are
--                           1 minute / 1 hour / 1 day).
--   profile_search_rate_log 7 days (search_profiles_by_name windows are
--                           1 minute / 1 day).
--   helper_w9_records       4 years after signed_at.
--
-- Scheduled daily as 'prune-retention-tables' with a liveness expectation
-- (cronLivenessCoverage.test.ts) and a catch-up policy row. The windows are
-- relative to now(), so a late run deletes exactly what an on-time one would.
--
-- cronCatchUpPolicy.test.ts reads the NEWEST migration that seeds
-- cron_catchup_policy as the whole policy, so every row of 20260923145117 is
-- restated verbatim with the new job appended.
--
-- Guard: src/test/appendOnlyTablesHaveRetention.test.ts.
-- PGlite: src/test/pglite/pruneRetentionTables.pglite.mjs.
--
-- Replay-safe: CREATE OR REPLACE, every table reference guarded by
-- to_regclass, ON CONFLICT on the policy/expectation rows, and cron.schedule
-- upserts by job name.

CREATE OR REPLACE FUNCTION public.prune_retention_tables()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_n   bigint;
BEGIN
  IF to_regclass('public.login_history') IS NOT NULL THEN
    DELETE FROM public.login_history lh
     WHERE lh.created_at < now() - interval '365 days'
       AND (lh.user_id IS NULL
            OR EXISTS (SELECT 1 FROM public.login_history n
                        WHERE n.user_id = lh.user_id
                          AND n.created_at > lh.created_at));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('login_history', v_n);
  END IF;

  IF to_regclass('public.notification_logs') IS NOT NULL THEN
    DELETE FROM public.notification_logs
     WHERE created_at < now() - interval '180 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('notification_logs', v_n);
  END IF;

  IF to_regclass('public.profile_views') IS NOT NULL THEN
    DELETE FROM public.profile_views
     WHERE viewed_at < LOCALTIMESTAMP - interval '180 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('profile_views', v_n);
  END IF;

  IF to_regclass('public.job_views') IS NOT NULL THEN
    DELETE FROM public.job_views
     WHERE first_viewed_at < now() - interval '365 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('job_views', v_n);
  END IF;

  IF to_regclass('public.application_rate_log') IS NOT NULL THEN
    DELETE FROM public.application_rate_log
     WHERE created_at < now() - interval '7 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('application_rate_log', v_n);
  END IF;

  IF to_regclass('public.profile_search_rate_log') IS NOT NULL THEN
    DELETE FROM public.profile_search_rate_log
     WHERE created_at < now() - interval '7 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('profile_search_rate_log', v_n);
  END IF;

  IF to_regclass('public.helper_w9_records') IS NOT NULL THEN
    DELETE FROM public.helper_w9_records
     WHERE signed_at < now() - interval '4 years';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('helper_w9_records', v_n);
  END IF;

  RETURN v_out;
END;
$fn$;

REVOKE ALL ON FUNCTION public.prune_retention_tables() FROM PUBLIC, anon, authenticated;

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
  ('weekly-helper-report',            true,  interval '6 hours',  'Q188: weekly in-app report now skips any helper who already has one from the last 6 days (supabase/functions/weekly-helper-report, tested in src/test/edge/weekly-helper-report.test.ts), so a late run cannot send twice. 6h cap keeps it inside daytime.'),
  ('cleanup-stripe-webhook-events',   true,  interval '20 hours', 'Q167: deletes stripe_webhook_events processed over 30 days ago; the window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('cleanup-observability-tables',    true,  interval '20 hours', 'Q167: deletes analytics_events over 90 days and error_logs over 30; relative windows, idempotent, so a late run is the same prune.'),
  ('prune-retention-tables',          true,  interval '20 hours', 'CJ-003/CS-003: age-based deletes (login_history, notification_logs, profile_views, job_views, rate logs, W-9s over 4 years); every window is relative to now(), so a late run deletes exactly what an on-time one would have.')
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
    VALUES ('prune-retention-tables', interval '30 hours',
            'CJ-003/CS-003: daily age-based prune of the append-only tables and of W-9 records over 4 years old.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('prune-retention-tables', '41 4 * * *',
                          'SELECT public.prune_retention_tables();');
  END IF;
END
$do$;
