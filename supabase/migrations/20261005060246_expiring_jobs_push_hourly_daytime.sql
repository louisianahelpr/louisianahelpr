-- Q994: expiring-jobs-push warns a short-lead listing.
--
-- WHAT WAS BROKEN. expiring-jobs-push (cron job 40) ran once a day, at 14:14
-- UTC, and warns a poster whose open job expires within 24 hours. A listing
-- posted after 14:14 that expires before the next day's 14:14 run was never
-- in any run's window while it was open: the poster of exactly the job most
-- at risk (a short lead time) never heard it was about to lapse. Measured on
-- prod 2026-10-05: cron.job schedule '14 14 * * *', active.
--
-- THE FIX. Run it every hour of the Louisiana day: '14 13-23,0-2 * * *' is
-- 13:14 through 02:14 UTC, i.e. 8:14am-9:14pm CDT (7:14am-8:14pm CST). It
-- stays out of the night on purpose: the push is a nudge, not an alarm, and
-- the old 9am-Central slot was chosen for the same reason. The function is
-- idempotent per job (expiring_notif_sent), so twelve runs a day notify each
-- job at most once, at the first run inside its last 24 hours. Longest gap
-- between runs: 02:14 -> 13:14, 11 hours.
--
-- Registries that follow the schedule:
--   * cron_work_expectations.expected_max_gap 30h -> 12h (the longest gap plus
--     an hour; cronLivenessCoverage).
--   * cron_catchup_policy: the catch-up re-runs missed DAILY/WEEKLY slots only
--     (cron_catchup_last_slot parses 'M H * * *' / 'M H * * D'); an hourly job
--     needs none, its next hour is the catch-up. Its row is deleted, and the
--     policy below restates every other row of 20260926041023 verbatim (26 rows)
--     (cronCatchUpPolicy.test.ts reads the NEWEST seed as the whole policy).
--   * cron_catchup_schedules re-snapshots itself from cron.job on the next
--     run_missed_cron_catch_up (it compares schedule text).
--
-- Only the SCHEDULE changes: cron.alter_job leaves command, database and owner
-- untouched (as 20260928000013_spread_top_of_hour_cron_starts).
-- Guard: src/test/expiringJobsPushCadence.test.ts.
--
-- Replay-safe: every table guarded by to_regclass, the job skipped when it is
-- not scheduled here, the policy upserted, and re-running sets the same values.

DO $$
DECLARE
  v_target record;
  v_jobid  bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'Q994: pg_cron not installed here, skipping';
    RETURN;
  END IF;

  FOR v_target IN
    SELECT * FROM (VALUES
      ('expiring-jobs-push', '14 13-23,0-2 * * *')
    ) AS t(jobname, schedule)
  LOOP
    v_jobid := NULL;
    SELECT j.jobid INTO v_jobid FROM cron.job j WHERE j.jobname = v_target.jobname;
    IF v_jobid IS NULL THEN
      RAISE NOTICE 'Q994: % not scheduled here, skipping', v_target.jobname;
      CONTINUE;
    END IF;
    PERFORM cron.alter_job(job_id := v_jobid, schedule := v_target.schedule);
  END LOOP;
END;
$$;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
    VALUES ('expiring-jobs-push', interval '12 hours',
            'Q994: hourly through the Louisiana day, longest gap 11h (02:14 to 13:14 UTC). Notifies by INSERT into notifications.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;
END
$do$;

DO $do$
BEGIN
  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    DELETE FROM public.cron_catchup_policy WHERE jobname = 'expiring-jobs-push';
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
  ('review-nag-cron',                 true,  interval '6 hours',  'User nudge with its own dedupe count per user and job inside WINDOW_HOURS, failing closed (unreadable count = already nagged). 6h cap keeps it inside daytime.'),
  ('engagement-automations',          true,  interval '6 hours',  'Lifecycle emails spaced by last_drip_at / last_approval_email_at, which it stamps on send: a late run cannot send a step twice. 6h cap keeps it inside daytime.'),
  ('charge-recurring-visits',         false, interval '1 hour',   'CHARGES CARDS for recurring visits. Money is never auto-rerun: a person checks what the missed day should have charged.'),
  ('expire-subscriptions',            false, interval '1 hour',   'Ends paid entitlements (one-time passes, lapsed tiers). Changes what a paying user has; a person decides.'),
  ('subscription-reconciliation',     false, interval '1 hour',   'REPAIRS tier state from Stripe (its header: "why this one repairs"). An automated entitlement writer is not re-run blind; a person decides.'),
  ('cleanup-abandoned-accounts',      false, interval '1 hour',   'DELETES accounts. Destructive; never re-run automatically.'),
  ('weekly-helper-report',            true,  interval '6 hours',  'Q188: weekly in-app report now skips any helper who already has one from the last 6 days (supabase/functions/weekly-helper-report, tested in src/test/edge/weekly-helper-report.test.ts), so a late run cannot send twice. 6h cap keeps it inside daytime.'),
  ('cleanup-stripe-webhook-events',   true,  interval '20 hours', 'Q167: deletes stripe_webhook_events processed over 30 days ago; the window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('cleanup-observability-tables',    true,  interval '20 hours', 'Q167: deletes analytics_events over 90 days and error_logs over 30; relative windows, idempotent, so a late run is the same prune.'),
  ('prune-retention-tables',          true,  interval '20 hours', 'CJ-003/CS-003: age-based deletes (login_history, notification_logs, profile_views, job_views, rate logs, W-9s over 4 years); every window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('purge-old-seed-data',             true,  interval '20 hours', 'Q65: age-based purge of is_seed test jobs (never money, never a fixture id, never profiles) and seed notifications; the window is relative to now() and every run is bounded and recorded, so a late run is the same purge.')
ON CONFLICT (jobname) DO UPDATE
  SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
      reason = EXCLUDED.reason, updated_at = now();
    $pol$;
  END IF;
END
$do$;
