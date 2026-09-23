-- Q224 (bus CJ-003): four per-user activity tables grew forever.
--
-- job_views, profile_views, notification_logs and login_history had no
-- age-based DELETE anywhere (no migration, no edge function); the only removal
-- was purge_user_data() at account deletion, and the Q167 pruners
-- (20260923143321) skip all four. login_history holds an IP address and user
-- agent per sign-in, notification_logs holds recipient email addresses and
-- subjects: personal data kept with no end date.
--
-- prune_old_activity_logs() runs daily. RETENTION, AND WHY EACH IS SAFE —
-- every reader of each table was read (src/, supabase/functions/, every
-- migration) and its window is inside the retention:
--
--   job_views      90 days (first_viewed_at). No reader in src/, edge
--                  functions or any SQL function today (20260901011102 calls
--                  the views "not a demand signal yet"). 90 days covers a
--                  job's whole open life several times over.
--   profile_views  90 days (viewed_at, a timestamp WITHOUT time zone written
--                  with LOCALTIMESTAMP, so it is compared with LOCALTIMESTAMP).
--                  Its one reader, get_monthly_profile_view_count
--                  (20260825170000), looks back 30 days; 90 is three times that.
--   notification_logs 180 days (created_at). Readers: the admin Notification
--                  Logs screen (newest first) and the monitors, whose widest
--                  window is 14 days (check_push_token_health 7d/14d,
--                  check_seed_boundary_health 24h). 180 days keeps two
--                  quarters of delivery history for support questions ("did
--                  you ever email me about X") and chargeback/dispute evidence
--                  timelines, and ends the retention of addresses and subjects.
--   login_history  180 days (created_at), EXCEPT each user's newest row, which
--                  is always kept. Readers: SecurityTab (recent sessions),
--                  useAdminUserSummaries (latest 500 across a page of users)
--                  and get_user_last_active (max(created_at) per user, the
--                  "last active" badge). Keeping the newest row means a user
--                  dormant for over 180 days still shows their real last
--                  sign-in rather than none; everything older than 180 days
--                  besides it (old IPs, old devices) goes.
--
-- Deletes are age-only and relative to now(), so a run is idempotent and a
-- late run deletes exactly what an on-time one would have: it is catch-up-safe
-- (cron_catchup_policy row below). cronCatchUpPolicy.test.ts reads the NEWEST
-- migration that seeds cron_catchup_policy as the whole policy, so every row of
-- 20260923145117 is restated verbatim with this job appended. A stop is seen by
-- sweep_dead_crons through the cron_work_expectations row
-- (cronLivenessCoverage.test.ts).
--
-- Replay-safe: CREATE OR REPLACE / IF NOT EXISTS, each table guarded by
-- to_regclass inside the function, ON CONFLICT upserts, cron.schedule upserts
-- by name. Applied 3x in PGlite (src/test/pglite/pruneOldActivityLogs.pglite.mjs).

-- Retention deletes range over the timestamp; the existing indexes on these
-- tables lead with a user or job id, so without these each run is a seq scan.
DO $do$
BEGIN
  IF to_regclass('public.job_views') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS job_views_first_viewed_at_idx ON public.job_views (first_viewed_at);
  END IF;
  IF to_regclass('public.profile_views') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS profile_views_viewed_at_only_idx ON public.profile_views (viewed_at);
  END IF;
  IF to_regclass('public.notification_logs') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS notification_logs_created_at_idx ON public.notification_logs (created_at);
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.prune_old_activity_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_job_views     int := 0;
  v_profile_views int := 0;
  v_notif_logs    int := 0;
  v_logins        int := 0;
BEGIN
  IF to_regclass('public.job_views') IS NOT NULL THEN
    WITH del AS (
      DELETE FROM public.job_views WHERE first_viewed_at < now() - interval '90 days' RETURNING 1
    ) SELECT count(*) INTO v_job_views FROM del;
  END IF;

  IF to_regclass('public.profile_views') IS NOT NULL THEN
    WITH del AS (
      DELETE FROM public.profile_views WHERE viewed_at < LOCALTIMESTAMP - interval '90 days' RETURNING 1
    ) SELECT count(*) INTO v_profile_views FROM del;
  END IF;

  IF to_regclass('public.notification_logs') IS NOT NULL THEN
    WITH del AS (
      DELETE FROM public.notification_logs WHERE created_at < now() - interval '180 days' RETURNING 1
    ) SELECT count(*) INTO v_notif_logs FROM del;
  END IF;

  IF to_regclass('public.login_history') IS NOT NULL THEN
    WITH del AS (
      DELETE FROM public.login_history lh
       WHERE lh.created_at < now() - interval '180 days'
         AND EXISTS (SELECT 1 FROM public.login_history newer
                      WHERE newer.user_id = lh.user_id
                        AND newer.created_at > lh.created_at)
      RETURNING 1
    ) SELECT count(*) INTO v_logins FROM del;
  END IF;

  RETURN jsonb_build_object(
    'job_views', v_job_views,
    'profile_views', v_profile_views,
    'notification_logs', v_notif_logs,
    'login_history', v_logins);
END;
$fn$;

REVOKE ALL ON FUNCTION public.prune_old_activity_logs() FROM PUBLIC, anon, authenticated;

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
  ('prune-old-activity-logs',         true,  interval '20 hours', 'Q224: age-based delete of job_views/profile_views (90d), notification_logs (180d) and login_history (180d, newest row per user kept); windows are relative to now(), so a late run deletes exactly what an on-time one would have.')
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
    VALUES ('prune-old-activity-logs', interval '30 hours',
            'Q224: daily age-based prune of job_views, profile_views, notification_logs and login_history.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('prune-old-activity-logs', '45 4 * * *',
                          'SELECT public.prune_old_activity_logs();');
  END IF;
END
$do$;
