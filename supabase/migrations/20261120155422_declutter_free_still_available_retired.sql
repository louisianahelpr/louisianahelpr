-- RETIRE THE FREE-LISTING "STILL AVAILABLE?" ASK (owner, 2026-11-20, with a screenshot of 4 pushes at once:
-- "If it's still listed in the app it's still for sale no need to send this out").
--
-- What it was (20261030232231): cron 'declutter-free-still-available' (daily 15:51 UTC) ran
-- declutter_free_still_available_sweep(), which sent every seller of a free listing up 14 days a bell + push
-- 'Is "<item>" still available?' / "Let neighbors know. Tap to say it's still there, or that it's gone." every 14 days,
-- unasked. The notice opened a sheet (src/components/declutter/DeclutterStillAvailable.tsx) whose "Still available"
-- answer was declutter_free_still_available(uuid).
--
-- What this does:
--   1. Unschedules the cron and deletes its cron_work_expectations and cron_catchup_policy rows (the
--      20261018035944 retire pattern), then restates the whole catch-up set without it (cronCatchUpPolicy reads the
--      newest seeding migration as the whole policy).
--   2. Drops the sweep and the "Still available" answer RPC, and the asks table only they used. Nothing else reads
--      them. The app no longer shows the sheet.
--   What stays: "It's gone" is declutter_mark_sold_elsewhere, the seller's own action from the listing; untouched.
--
-- No money moves. Replay-safe: the unschedule is guarded by an EXISTS on cron.job, the DELETEs are keyed by jobname,
-- DROP ... IF EXISTS, the policy restatement is ON CONFLICT. Guard: src/test/declutterFreeStillAvailable.test.ts.

DO $do$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'declutter-free-still-available') THEN
    PERFORM cron.unschedule('declutter-free-still-available');
  END IF;

  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    DELETE FROM public.cron_work_expectations WHERE jobname IN ('declutter-free-still-available');
  END IF;

  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    DELETE FROM public.cron_catchup_policy WHERE jobname IN ('declutter-free-still-available');
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.declutter_free_still_available_sweep();
DROP FUNCTION IF EXISTS public.declutter_free_still_available(uuid);
-- DESTRUCTIVE-DDL-ACK: DROP TABLE public.declutter_free_still_asks
-- ACK-REASON: Only the retired still-available sweep and its answer RPC (both dropped above) ever read or wrote it.
-- ACK-DATA-LOSS: 11 rows on prod (2026-11-20): per free listing, when its seller was last asked and last answered.
DROP TABLE IF EXISTS public.declutter_free_still_asks;
-- The dropped table is listed so a PGRST205 naming it is read as a stale build, never noise or a real missing table
-- (20260925234342; src/test/retiredRelationReadsAreNotNoise.test.ts). No app build ever read it (no client privilege).
INSERT INTO public.retired_client_relations (relation, retired_by) VALUES
  ('declutter_free_still_asks', '20261120155422')
ON CONFLICT DO NOTHING;

-- Q30 catch-up policy: the newest migration that seeds cron_catchup_policy restates the whole set.
-- 20261120062130's rows verbatim, minus declutter-free-still-available (retired above).
DO $do$
BEGIN
  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    -- Restates the whole policy set (the guard reads the newest seeding migration).
INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason) VALUES
  ('ops-daily-digest',                true,  interval '20 hours', 'Slack digest of the last 24h of ops alerts; writes only its own delivery receipt. A late digest is the Q30 case itself: 09-22 went 38h with none.'),
  ('sweep-daily-job-digest',          true,  interval '6 hours',  'In-app "New jobs in <parish>" digest; its own NOT EXISTS skips anyone digested in the last 23h, so it cannot double-send. Capped at 6h because a late run shifts the next day''s by that 23h dedupe.'),
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
  ('purge-old-seed-data',             true,  interval '20 hours', 'Q65: age-based purge of is_seed test jobs (never money, never a fixture id, never profiles) and seed notifications; the window is relative to now() and every run is bounded and recorded, so a late run is the same purge.'),
  ('unfilled-series-visit-reminders', false, interval '1 hour',   'Tells a poster an empty series visit is TOMORROW (20261012195747). The text is relative to the run''s own day, so a late run past midnight would name the wrong day; its own once-per-visit ledger already stops a double send. Not re-run late.'),
  ('declutter-price-drops',           false, interval '1 hour',   'Declutter evening price drop (20261014210518): once per Louisiana day; a missed evening is simply skipped and the next evening drops 5% as usual. Not re-run late: a late run past midnight would spend the NEXT day''s drop.'),
  ('listing-photo-purge', false, interval '1 hour', 'Homes listing photo purge (20261019071203): deletes taken-down listings'' photos through the Storage API. Deletion is never re-run late; the next daily run deletes whatever is due.'),
  ('rentals-rent-sweep', false, interval '1 hour', 'Homes rent tracker (20261019073106): writes due rent rows, late fees and reminders. Not re-run late: the next daily run writes every missed rent row and fee itself (idempotent, from the first due date); only a missed reminder is skipped.'),
  ('rentals-deposit-sweep', false, interval '1 hour', 'Homes deposit tracker (20261019082216): deposit-return reminders by stage. Not re-run late: the next daily run sends the stage that is due (once each).'),
  ('job-match-roundups',              true,  interval '6 hours',  'Sends one "more jobs near you" email per member whose matches waited; it claims the batch (waiting -> 0) before sending, so a late run sends only what is still waiting and never twice. Capped at 6h so a very late run does not land in the evening.'),
  ('declutter-haul-away',             false, interval '1 hour',   'Declutter haul-away sweep (20261027165903): the "Haul-away is open" notice (once per listing, by its mark), a declined card''s haul-away job to abandoned, and the put-back-on-sale of a haul-away that never went ahead after 7 days. Not re-run late: the next daily run does everything that was due.'),
  ('declutter-price-nudge',           false, interval '1 hour',   'Declutter "drop the price?" nudge (20261030141656): one notice per unsold listing per 14 days, by its own mark. Not re-run late: the next daily run sends whatever is due.'),
  ('declutter-move-reminders',        false, interval '1 hour',   'Moving-sale reminders (20261030221156): the day-before notice says "tomorrow", so a late run past midnight would name the wrong day; the day-after notice looks back 3 days, so the next daily run sends it. Once each, by its own mark. Not re-run late.'),
  ('new-member-daily-summary',       false, interval '1 hour',   'One admin notice naming who joined since the last run (20261031152136). Not re-run late: the queue keeps everyone not yet summarized, so the next day''s run names them.'),
  ('gift-wish-list-prune',           true,  interval '20 hours', 'Gift guides wish list snapshot cleanup (20261120062130): deletes signed-out snapshots older than 90 days; a late run deletes the same rows, a repeat finds none. Safe to catch up.')
    ON CONFLICT (jobname) DO UPDATE
      SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
          reason = EXCLUDED.reason, updated_at = now();
  END IF;
END
$do$;
