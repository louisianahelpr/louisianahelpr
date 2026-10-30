-- CMP-5 (lead decision 2026-10-30 05:00Z): a paid listing live 14 days with no sale and no accepted offer gets ONE
-- notice, "<item> hasn't sold yet. Drop the price?", suggesting about 15% lower (whole dollars, never below the
-- seller's lowest price or $1), linking to Selling -> Manage at Change price with that price filled in
-- (/declutter?tab=selling&manage=<id>&drop=1; src/components/declutter/DeclutterPriceNudge.tsx). At most once per
-- listing per 14 days. Never for a free item, a listing whose price drops are on, or test data (an is_seed listing,
-- a test_accounts seller or an is_seed profile).
--
-- WHAT IT READS (prod fncmgoasalhdgfwzhsqa, information_schema 2026-10-30): declutter_items.status, current_price_cents,
-- live_at, is_seed, sale_mode, drop_pct (smallint NOT NULL DEFAULT 5, 20261028160637); declutter_item_private
-- floor_price_cents, drops_stopped. "Price drops on" is the nightly drop's own rule: sale_mode 'offers', drop_pct > 0
-- and not stopped by the seller (declutter_set_listing_drops). No sale and no accepted offer: the listing is still
-- 'live' (a sale or an accepted offer reserves it), and no cart line is in_cart or paid.
--
-- New objects only (a table, a sweep, a cron); nothing restated except the whole cron_catchup_policy set, which the
-- newest seeding migration must restate (cronCatchUpPolicy): 20261027165903's rows verbatim plus this job.
-- The notice passes its own declutter_* type ('declutter_listings'), so declutter_notice_type needs no new title.
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, cron.schedule by name (replaces), ON CONFLICT.
-- Applied 3x in PGlite by src/test/pglite/declutterPriceNudgeSweep.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 1. The told-at mark: one row per listing, moved forward each time it is told. No client privilege.
CREATE TABLE IF NOT EXISTS public.declutter_price_nudges (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.declutter_price_nudges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_price_nudges FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_price_nudges TO service_role;
-- Q807: refuse writes from a session whose email is unconfirmed (every public table).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
COMMENT ON TABLE public.declutter_price_nudges IS
  'CMP-5: when a listing was last told "hasn''t sold yet. Drop the price?" (at most once per 14 days). '
  'Written only by declutter_price_nudge_sweep (cron declutter-price-nudge). No client privilege.';

-- ---------------------------------------------------------------------------
-- 2. The price to suggest: about 15% below now, whole dollars, never below the lowest price or $1. NULL when it
--    cannot go lower. The same rule as src/lib/declutter/priceNudge.ts suggestedDropCents.
CREATE OR REPLACE FUNCTION public.declutter_price_nudge_cents(p_current integer, p_floor integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN s.cents < p_current THEN s.cents END
    FROM (SELECT GREATEST((floor(p_current * 85 / 100.0 / 100) * 100)::integer,
                          GREATEST(100, (ceil(GREATEST(COALESCE(p_floor, 0), 0) / 100.0) * 100)::integer)) AS cents) s
   WHERE p_current IS NOT NULL AND p_current > 100;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_price_nudge_cents(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_price_nudge_cents(integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The sweep.
CREATE OR REPLACE FUNCTION public.declutter_price_nudge_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET lock_timeout TO '1s'
AS $fn$
DECLARE
  r record;
  v_cents integer;
  v_claimed uuid;
  v_told integer := 0;
  v_errors integer := 0;
  v_locked integer := 0;
BEGIN
  FOR r IN
    SELECT i.id, i.seller_id, i.title, i.current_price_cents, p.floor_price_cents
      FROM public.declutter_items i
      JOIN public.declutter_item_private p ON p.item_id = i.id
     WHERE i.status = 'live'
       AND i.current_price_cents > 0
       AND NOT COALESCE(i.is_seed, false)
       -- Owner rule: test stuff never shows. A test account's or a seed profile's listing is never nudged.
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = i.seller_id)
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = i.seller_id AND pr.is_seed)
       AND i.live_at IS NOT NULL
       AND i.live_at + interval '14 days' <= now()
       AND NOT (i.sale_mode = 'offers' AND i.drop_pct > 0 AND NOT COALESCE(p.drops_stopped, false))
       AND NOT EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.item_id = i.id AND o.status = 'accepted')
       AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                        WHERE c.item_id = i.id AND c.status IN ('in_cart', 'paid'))
       AND NOT EXISTS (SELECT 1 FROM public.declutter_price_nudges n
                        WHERE n.item_id = i.id AND n.notified_at > now() - interval '14 days')
       AND public.feature_enabled_for_user('declutter', i.seller_id)
       AND NOT public.declutter_member_out(i.seller_id)
     ORDER BY i.id
     LIMIT 500
  LOOP
    BEGIN
      v_cents := public.declutter_price_nudge_cents(r.current_price_cents, r.floor_price_cents);
      CONTINUE WHEN v_cents IS NULL;
      -- Claim first: a listing another run told in the last 14 days is never told twice.
      v_claimed := NULL;
      INSERT INTO public.declutter_price_nudges AS n (item_id, notified_at) VALUES (r.id, now())
        ON CONFLICT (item_id) DO UPDATE SET notified_at = now()
        WHERE n.notified_at <= now() - interval '14 days'
        RETURNING n.item_id INTO v_claimed;
      CONTINUE WHEN v_claimed IS NULL;
      PERFORM public.declutter_notify(r.seller_id, 'declutter_listings',
        format('%s hasn''t sold yet. Drop the price?', r.title),
        format('Try $%s, about 15%% less. Nothing changes until you save it.', v_cents / 100),
        '/declutter?tab=selling&manage=' || r.id::text || '&drop=1', r.seller_id);
      v_told := v_told + 1;
    EXCEPTION WHEN lock_not_available THEN
      v_locked := v_locked + 1;
    WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_price_nudge_sweep', r.id::text,
        format('price nudge for listing %s failed: %s (%s)', r.id, SQLERRM, SQLSTATE));
    END;
  END LOOP;
  RETURN jsonb_build_object('told', v_told, 'skipped_locked', v_locked, 'errors', v_errors);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_price_nudge_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_price_nudge_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The cron: daily, Louisiana morning. Registered with the dead-cron monitor.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-price-nudge', interval '26 hours',
            'Declutter "drop the price?" nudge, daily at 15:43 UTC: tells a seller once per 14 days when a priced listing with price drops off has been live 14 days unsold.',
            'exempt',
            'While no priced listing is 14 days old with drops off, a run that tells nobody is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- 15:43 UTC = 10:43 AM CDT / 9:43 AM CST.
    PERFORM cron.schedule('declutter-price-nudge', '43 15 * * *',
      $c$SELECT public.cron_record_work('declutter-price-nudge', to_jsonb(public.declutter_price_nudge_sweep()));$c$);
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 5. Q30 catch-up policy: the newest migration that seeds cron_catchup_policy restates the whole set.
--    20261027165903's rows verbatim, plus declutter-price-nudge (not re-run late).
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
  ('declutter-price-nudge',           false, interval '1 hour',   'Declutter "drop the price?" nudge (20261030141656): one notice per unsold listing per 14 days, by its own mark. Not re-run late: the next daily run sends whatever is due.')
    ON CONFLICT (jobname) DO UPDATE
      SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
          reason = EXCLUDED.reason, updated_at = now();
  END IF;
END
$do$;
