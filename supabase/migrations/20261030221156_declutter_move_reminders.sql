-- Moving sale reminders (owner 2026-10-30, via the lead: reminders only, nothing closes). A seller with listings still in
-- their moving sale gets one notice the day before the move-out date and, if listings are still live, one the day after,
-- each linking to Selling. Nothing is taken down, paused or changed.
--
-- WHAT IT READS (prod fncmgoasalhdgfwzhsqa, 2026-10-30): declutter_items.in_moving_sale, status, seller_id, is_seed;
-- declutter_item_private.move_out_on. A sale's date is max(move_out_on) over its open items, the rule
-- declutter_my_move_out_date and declutter_seller_moving_sale use. Before this, no sweep read move_out_on (measured: 6
-- functions read it, none is a sender) and no cron job's name or command mentioned moves.
--
-- ONCE: one row per seller, date and kind, claimed before the notice. A changed date is a new date, so its reminders go too.
-- THE DAY AFTER takes up to 3 days back: the cron is not re-run late, so a missed run still tells the seller on the next
-- one, and its words don't name a day. THE DAY BEFORE is exact: its words say "tomorrow".
-- CHOICES: the seller's "Listings" switch (notification_preferences.declutter_listings) off means no notice at all, bell
-- included. On, declutter_notify's type 'declutter_listings' sends it through the app's own push and email gates.
-- TEST DATA: never an is_seed listing, a test_accounts seller or an is_seed profile.
--
-- New objects only (a table, a sweep, a cron); nothing restated except the whole cron_catchup_policy set, which the
-- newest seeding migration must restate (cronCatchUpPolicy): 20261030141656's rows verbatim plus this job.
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, cron.schedule by name (replaces), ON CONFLICT.
-- Applied 3x in PGlite by src/test/pglite/declutterMoveReminders.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 1. The told mark. No client privilege.
CREATE TABLE IF NOT EXISTS public.declutter_move_reminders (
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  move_out_on date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('day_before', 'day_after')),
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, move_out_on, kind)
);
ALTER TABLE public.declutter_move_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_move_reminders FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_move_reminders TO service_role;
-- Q807: refuse writes from a session whose email is unconfirmed (every public table).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
COMMENT ON TABLE public.declutter_move_reminders IS
  'Which moving-sale reminder a seller was sent, per move-out date. Written only by declutter_move_reminder_sweep '
  '(cron declutter-move-reminders). No client privilege.';

-- ---------------------------------------------------------------------------
-- 2. The sweep.
CREATE OR REPLACE FUNCTION public.declutter_move_reminder_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET lock_timeout TO '1s'
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  r record;
  v_kind text;
  v_claimed uuid;
  v_told integer := 0;
  v_errors integer := 0;
  v_locked integer := 0;
BEGIN
  FOR r IN
    SELECT s.seller_id, s.move_out_on, s.up, s.live
      FROM (
        SELECT i.seller_id,
               max(p.move_out_on) AS move_out_on,
               count(*) FILTER (WHERE i.status IN ('live', 'paused'))::integer AS up,
               count(*) FILTER (WHERE i.status = 'live')::integer AS live
          FROM public.declutter_items i
          JOIN public.declutter_item_private p ON p.item_id = i.id
         WHERE i.in_moving_sale
           AND i.status IN ('draft', 'pending_review', 'live', 'paused', 'reserved')
           AND NOT COALESCE(i.is_seed, false)
         GROUP BY i.seller_id
      ) s
     WHERE s.move_out_on IS NOT NULL
       -- Owner rule: test stuff never shows.
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = s.seller_id)
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = s.seller_id AND pr.is_seed)
       -- The seller's own choice: Listings notices off means none of this.
       AND NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = s.seller_id AND np.declutter_listings IS FALSE)
       AND public.feature_enabled_for_user('declutter', s.seller_id)
       AND public.feature_enabled_for_user('declutter_moving_out', s.seller_id)
       AND NOT public.declutter_member_out(s.seller_id)
     ORDER BY s.seller_id
     LIMIT 500
  LOOP
    BEGIN
      v_kind := CASE
        WHEN r.move_out_on = v_today + 1 AND r.up > 0 THEN 'day_before'
        WHEN r.move_out_on BETWEEN v_today - 3 AND v_today - 1 AND r.live > 0 THEN 'day_after'
      END;
      CONTINUE WHEN v_kind IS NULL;
      -- Claim first: two runs never tell a seller twice.
      v_claimed := NULL;
      INSERT INTO public.declutter_move_reminders (seller_id, move_out_on, kind)
        VALUES (r.seller_id, r.move_out_on, v_kind)
        ON CONFLICT (seller_id, move_out_on, kind) DO NOTHING
        RETURNING seller_id INTO v_claimed;
      CONTINUE WHEN v_claimed IS NULL;
      IF v_kind = 'day_before' THEN
        PERFORM public.declutter_notify(r.seller_id, 'declutter_listings',
          'Your move is tomorrow',
          'Take down what''s left, or change the date.',
          '/declutter?tab=selling', NULL);
      ELSE
        PERFORM public.declutter_notify(r.seller_id, 'declutter_listings',
          'Your move date has passed',
          format('%s still up. Take down what''s left, or change the date.',
                 CASE WHEN r.live = 1 THEN '1 listing is' ELSE r.live || ' listings are' END),
          '/declutter?tab=selling', NULL);
      END IF;
      v_told := v_told + 1;
    EXCEPTION WHEN lock_not_available THEN
      v_locked := v_locked + 1;
    WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_move_reminder_sweep', r.seller_id::text,
        format('move reminder for seller %s failed: %s (%s)', r.seller_id, SQLERRM, SQLSTATE));
    END;
  END LOOP;
  RETURN jsonb_build_object('told', v_told, 'skipped_locked', v_locked, 'errors', v_errors);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_move_reminder_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_move_reminder_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The cron: daily, Louisiana morning. Registered with the dead-cron monitor.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-move-reminders', interval '26 hours',
            'Declutter moving-sale reminders, daily at 15:33 UTC: one notice the day before a seller''s move-out date and one after it if listings are still live. Nothing closes.',
            'exempt',
            'While no moving sale is a day from its date, a run that tells nobody is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- 15:33 UTC = 10:33 AM CDT / 9:33 AM CST.
    PERFORM cron.schedule('declutter-move-reminders', '33 15 * * *',
      $c$SELECT public.cron_record_work('declutter-move-reminders', to_jsonb(public.declutter_move_reminder_sweep()));$c$);
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 4. Q30 catch-up policy: the newest migration that seeds cron_catchup_policy restates the whole set.
--    20261030141656's rows verbatim, plus declutter-move-reminders (not re-run late).
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
  ('declutter-move-reminders',        false, interval '1 hour',   'Moving-sale reminders (20261030221156): the day-before notice says "tomorrow", so a late run past midnight would name the wrong day; the day-after notice looks back 3 days, so the next daily run sends it. Once each, by its own mark. Not re-run late.')
    ON CONFLICT (jobname) DO UPDATE
      SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
          reason = EXCLUDED.reason, updated_at = now();
  END IF;
END
$do$;
