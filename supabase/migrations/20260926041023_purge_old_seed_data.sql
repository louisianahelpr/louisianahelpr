-- Scheduled retention for old test data on prod (docs/OPEN.md Q65).
--
-- E2E / press / prod-audit / journeys write to prod by design (no mock mode).
-- MEASURED (prod 2026-09-26 ~04:00Z, counts by created_at age; SQL in the
-- Q65 report): is_seed jobs 379 (<1d 26, 1-7d 105, 7-30d 242, 30-90d 6),
-- seed profiles 57 (all 7-30d), messages on seed jobs or from seed senders
-- 449, notifications to seed recipients 1,266, applications 197, storage
-- objects owned by seed accounts 223 (~105 KB). What deletes any of it today:
-- sweep_old_notifications / cleanup-notifications (every user, read > 30d,
-- unread > 90d), scripts/e2e/prod-lifecycle-sweeper.mjs (only the poster's
-- "[E2E DO NOT ACCEPT]" leftovers, before each journeys / slow-network /
-- e2e-real-backend run), and the storage orphan sweep. Nothing removes seed
-- JOBS by age: 84 of them are older than 14 days and nothing will ever go.
--
-- WHAT THIS DELETES, each run, bounded to p_batch jobs (max 500):
--   jobs     is_seed, older than the window (default 14 days, floor 7), and
--            ALL of:
--            - payment_status unpaid / abandoned / cancelled (NULL = unpaid):
--              no money was ever held. escrow, payout_pending, released,
--              refunded, failed and anything else is MONEY and is never
--              deleted; those jobs are LISTED in the result (money_held).
--            - a random (v4) id. Every writer that owns a fixture on purpose
--              gives it a deterministic id (scripts/audit/prod-seed.mjs: UUID
--              v5; the a5eed000- / b0b00001- / 5eed0a10- fixtures: version
--              nibble 0), so those are never candidates.
--            - no row in a money or trust history table that must outlive the
--              job (payout_transfers, payment_refunds, tips,
--              chargeback_clawbacks, disputes, dispute_settlement_claims,
--              helper_w9_records, gift_cards (job_id, restored_from_job_id),
--              recurring_visit_releases, user_violations, user_strikes,
--              str_processed_events) and no child visit job. Such a job is
--              skipped with the table that holds it.
--            - no poster that is a real (non-seed) account.
--            The rest of its rows (applications, messages, reviews, check-ins,
--            views, queues, …) go with it by ON DELETE CASCADE; notifications
--            are unlinked (SET NULL) and then aged out below.
--   notifications of a seed recipient older than the window (up to
--            p_batch * 10 per run).
-- NEVER: profiles (the shared test accounts), auth users, storage objects (a
-- SQL delete cannot remove the bytes; the weekly storage-orphan-sweep removes
-- a job's media once the row is gone, after its own two-read / 7-day rules).
--
-- DRY RUN FIRST. The function defaults to p_dry_run = true: each candidate is
-- deleted inside a subtransaction that is then rolled back, so the dry run
-- reports exactly what a live run would delete (cascades and triggers
-- included) and what would refuse, and changes nothing. The cron runs it DRY
-- until someone writes the switch:
--     UPDATE public.platform_settings
--        SET feature_flags = feature_flags || '{"seed_purge_live": true}'::jsonb;
-- Every run, dry or live, is recorded in public.seed_purge_runs (kept 90
-- days), so the dry-run output can be read before the switch is flipped.
--
-- Guard: src/test/seedPurgeIsSafe.test.ts. PGlite: src/test/pglite/seedPurge.pglite.mjs.
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, every
-- other table reached through to_regclass, ON CONFLICT on the policy /
-- expectation rows, and cron.schedule upserts by job name.

CREATE TABLE IF NOT EXISTS public.seed_purge_runs (
  id       bigserial PRIMARY KEY,
  ran_at   timestamptz NOT NULL DEFAULT now(),
  dry_run  boolean NOT NULL,
  result   jsonb NOT NULL
);

ALTER TABLE public.seed_purge_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.seed_purge_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.seed_purge_runs_id_seq FROM PUBLIC, anon, authenticated;
-- Server-only, said out loud: the purge (postgres via cron) and service_role read it.
GRANT ALL ON TABLE public.seed_purge_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.seed_purge_runs_id_seq TO service_role;

COMMENT ON TABLE public.seed_purge_runs IS
  'One row per purge_old_seed_data() run (dry or live) with its jsonb result. Service role / postgres only (RLS on, no policy). Pruned to 90 days by the function itself.';

CREATE OR REPLACE FUNCTION public.purge_old_seed_data(
  p_dry_run    boolean  DEFAULT true,
  p_older_than interval DEFAULT interval '14 days',
  p_batch      integer  DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
DECLARE
  -- NULL is a dry run: the destructive branch needs an explicit false.
  v_dry     boolean     := p_dry_run IS DISTINCT FROM false;
  -- The window never drops under 7 days, so a typo cannot purge today's runs.
  v_cut     timestamptz := now() - greatest(coalesce(p_older_than, interval '14 days'), interval '7 days');
  v_batch   integer     := least(greatest(coalesce(p_batch, 100), 0), 500);
  -- (table, column) pairs whose rows must outlive the job they name.
  v_refs    text[]      := ARRAY[
    'public.payout_transfers:job_id', 'public.payment_refunds:job_id', 'public.tips:job_id',
    'public.chargeback_clawbacks:job_id', 'public.disputes:job_id', 'public.dispute_settlement_claims:job_id',
    'public.helper_w9_records:job_id', 'public.gift_cards:job_id', 'public.gift_cards:restored_from_job_id',
    'public.recurring_visit_releases:parent_job_id', 'public.user_violations:job_id',
    'public.user_strikes:job_id', 'public.str_processed_events:job_id', 'public.jobs:parent_job_id'
  ];
  v_ref     text;
  v_tbl     text;
  v_col     text;
  v_hit     boolean;
  v_hold    text;
  v_job     record;
  v_done    integer := 0;
  v_skipped jsonb   := '[]'::jsonb;
  v_held    jsonb;
  v_held_n  integer;
  v_left    integer;
  v_notif   integer := 0;
  v_result  jsonb;
BEGIN
  -- MONEY: listed, never deleted.
  SELECT count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status,
                  'payment_status', s.payment_status, 'created_at', s.created_at)
                  ORDER BY s.created_at) FILTER (WHERE s.rn <= 50), '[]'::jsonb)
    INTO v_held_n, v_held
    FROM (SELECT j.id, j.status, j.payment_status, j.created_at,
                 row_number() OVER (ORDER BY j.created_at) AS rn
            FROM public.jobs j
           WHERE j.is_seed
             AND j.created_at < v_cut
             AND coalesce(j.payment_status, 'unpaid') NOT IN ('unpaid', 'abandoned', 'cancelled')) s;

  FOR v_job IN
    SELECT j.id
      FROM public.jobs j
     WHERE j.is_seed
       AND j.created_at < v_cut
       AND coalesce(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'cancelled')
       AND substr(j.id::text, 15, 1) = '4'
       AND NOT EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.user_id = j.customer_id AND NOT p.is_seed)
     ORDER BY j.created_at, j.id
     LIMIT v_batch
     -- A job some other transaction holds is skipped this run, not waited on
     -- or deleted under it.
     FOR UPDATE OF j SKIP LOCKED
  LOOP
    v_hold := NULL;
    FOREACH v_ref IN ARRAY v_refs LOOP
      v_tbl := split_part(v_ref, ':', 1);
      v_col := split_part(v_ref, ':', 2);
      CONTINUE WHEN to_regclass(v_tbl) IS NULL;
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_tbl, v_col)
        INTO v_hit USING v_job.id;
      IF v_hit THEN
        v_hold := v_ref;
        EXIT;
      END IF;
    END LOOP;
    IF v_hold IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_job.id, 'held_by', v_hold);
      CONTINUE;
    END IF;

    BEGIN
      DELETE FROM public.jobs WHERE id = v_job.id AND is_seed;
      IF v_dry THEN
        RAISE EXCEPTION 'seed_purge_dry_run';
      END IF;
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'seed_purge_dry_run' THEN
        v_done := v_done + 1;
      ELSE
        v_skipped := v_skipped || jsonb_build_object('id', v_job.id, 'error', SQLSTATE || ' ' || SQLERRM);
      END IF;
    END;
  END LOOP;

  -- Eligible jobs this run did not reach (the batch bound). A live run's
  -- deletions are already gone from the count; a dry run's are not.
  SELECT greatest(count(*)::int - jsonb_array_length(v_skipped) - CASE WHEN v_dry THEN v_done ELSE 0 END, 0) INTO v_left
    FROM public.jobs j
   WHERE j.is_seed
     AND j.created_at < v_cut
     AND coalesce(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'cancelled')
     AND substr(j.id::text, 15, 1) = '4'
     AND NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.user_id = j.customer_id AND NOT p.is_seed);

  IF to_regclass('public.notifications') IS NOT NULL THEN
    IF v_dry THEN
      SELECT count(*)::int INTO v_notif
        FROM (SELECT n.id FROM public.notifications n
                JOIN public.profiles p ON p.user_id = n.user_id AND p.is_seed
               WHERE n.created_at < v_cut
               LIMIT v_batch * 10) d;
    ELSE
      DELETE FROM public.notifications
       WHERE id IN (SELECT n.id FROM public.notifications n
                      JOIN public.profiles p ON p.user_id = n.user_id AND p.is_seed
                     WHERE n.created_at < v_cut
                     ORDER BY n.created_at
                     LIMIT v_batch * 10);
      GET DIAGNOSTICS v_notif = ROW_COUNT;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'dry_run', v_dry,
    'cutoff', v_cut,
    'batch', v_batch,
    CASE WHEN v_dry THEN 'jobs_would_delete' ELSE 'jobs_deleted' END, v_done,
    'jobs_eligible_not_reached', v_left,
    'jobs_skipped', v_skipped,
    CASE WHEN v_dry THEN 'notifications_would_delete' ELSE 'notifications_deleted' END, v_notif,
    'money_held_count', v_held_n,
    'money_held', v_held
  );

  DELETE FROM public.seed_purge_runs WHERE ran_at < now() - interval '90 days';
  INSERT INTO public.seed_purge_runs (dry_run, result) VALUES (v_dry, v_result);
  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.purge_old_seed_data(boolean, interval, integer) FROM PUBLIC, anon, authenticated;

-- The cron's entry point: DRY until feature_flags.seed_purge_live is exactly true.
CREATE OR REPLACE FUNCTION public.run_seed_purge()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
DECLARE
  v_live boolean := false;
BEGIN
  IF to_regclass('public.platform_settings') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce((SELECT s.feature_flags -> 'seed_purge_live' = 'true'::jsonb
                         FROM public.platform_settings s
                        ORDER BY s.updated_at DESC NULLS LAST
                        LIMIT 1), false)
    $q$ INTO v_live;
  END IF;
  RETURN public.purge_old_seed_data(NOT coalesce(v_live, false));
END;
$fn$;

REVOKE ALL ON FUNCTION public.run_seed_purge() FROM PUBLIC, anon, authenticated;

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
  ('prune-retention-tables',          true,  interval '20 hours', 'CJ-003/CS-003: age-based deletes (login_history, notification_logs, profile_views, job_views, rate logs, W-9s over 4 years); every window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('purge-old-seed-data',             true,  interval '20 hours', 'Q65: age-based purge of is_seed test jobs (never money, never a fixture id, never profiles) and seed notifications; the window is relative to now() and every run is bounded and recorded, so a late run is the same purge.')
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
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('purge-old-seed-data', interval '30 hours',
            'Q65: daily bounded purge of old is_seed test data, dry until feature_flags.seed_purge_live = true. Each run is a row in seed_purge_runs.',
            'exempt',
            'Dry until seed_purge_live is set, and a day with no old seed data is normal. Every run, empty or not, is a seed_purge_runs row.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('purge-old-seed-data', '19 5 * * *',
                          $c$SELECT public.cron_record_work('purge-old-seed-data', to_jsonb(public.run_seed_purge()));$c$);
  END IF;
END
$do$;
