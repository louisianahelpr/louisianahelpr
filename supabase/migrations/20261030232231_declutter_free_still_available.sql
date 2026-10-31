-- Free listings (owner's choice, via the lead 2026-10-30): a free listing keeps "Keep it up", and its seller is asked
-- whether the item is still there, so a neighbor doesn't drive over for something already gone.
--
-- WHO IS ASKED: a live free listing (current_price_cents = 0) up 14 days since it went live, since the last ask or since
-- the seller last said "Still available", whichever is latest. At most once per listing per 14 days. An unanswered ask
-- comes round again 14 days later and changes nothing on its own: a listing never ends because nobody answered.
-- NEVER: test data (an is_seed listing, a test_accounts seller, an is_seed profile), a member whose Declutter switch is
-- off or who is out, a seller who turned off the Declutter "Listings" notice (no bell row either), or a listing in a cart.
-- THE ANSWER: "Still available" is declutter_free_still_available below. "It's gone" is the existing
-- declutter_mark_sold_elsewhere: it ends the listing, closes open offers and, through its trigger, open free asks.
--
-- WHAT IT READS (prod fncmgoasalhdgfwzhsqa, 2026-10-30): declutter_items.status, current_price_cents, live_at, is_seed;
-- notification_preferences.declutter_listings; notification_type_pref_map maps the type to that column. No money moves.
-- New objects only, except the whole cron_catchup_policy set, which the newest seeding migration must restate
-- (cronCatchUpPolicy): 20261030221156's rows verbatim plus this job.
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, cron.schedule by name, ON CONFLICT.
-- Proof: src/test/pglite/declutterFreeStillAvailable.pglite.mjs (applied 3x). Guard: src/test/declutterFreeStillAvailable.test.ts.

-- ---------------------------------------------------------------------------
-- 1. The told-at and answered-at marks, one row per listing. No client privilege.
CREATE TABLE IF NOT EXISTS public.declutter_free_still_asks (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  asked_at timestamptz,
  answered_at timestamptz
);
ALTER TABLE public.declutter_free_still_asks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_free_still_asks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_free_still_asks TO service_role;
-- Q807: refuse writes from a session whose email is unconfirmed (every public table).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
COMMENT ON TABLE public.declutter_free_still_asks IS
  'When a free listing''s seller was last asked "still available?" and last said yes. Written only by '
  'declutter_free_still_available_sweep and declutter_free_still_available. No client privilege.';

-- ---------------------------------------------------------------------------
-- 2. "Still available": the seller's own live free listing only. The next ask comes 14 days from now.
CREATE OR REPLACE FUNCTION public.declutter_free_still_available(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  -- Not the selling gate, as declutter_withdraw_item: a banned
  -- caller is refused, while an under-18 or struck member may still answer about their own listing.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status <> 'live' OR v_item.current_price_cents <> 0 THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.declutter_free_still_asks AS a (item_id, answered_at) VALUES (p_item_id, now())
    ON CONFLICT (item_id) DO UPDATE SET answered_at = now();
  RETURN 'still_available';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_free_still_available(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_free_still_available(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The sweep.
CREATE OR REPLACE FUNCTION public.declutter_free_still_available_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET lock_timeout TO '1s'
AS $fn$
DECLARE
  r record;
  v_claimed uuid;
  v_told integer := 0;
  v_errors integer := 0;
  v_locked integer := 0;
BEGIN
  FOR r IN
    SELECT i.id, i.seller_id, i.title
      FROM public.declutter_items i
     WHERE i.status = 'live'
       AND i.current_price_cents = 0
       AND NOT COALESCE(i.is_seed, false)
       -- Owner rule: test stuff never shows.
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = i.seller_id)
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = i.seller_id AND pr.is_seed)
       AND i.live_at IS NOT NULL
       AND i.live_at + interval '14 days' <= now()
       -- The member's own choice: "Listings" off means this notice isn't written at all.
       AND COALESCE((SELECT np.declutter_listings FROM public.notification_preferences np WHERE np.user_id = i.seller_id), true)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                        WHERE c.item_id = i.id AND c.status IN ('in_cart', 'paid'))
       AND NOT EXISTS (SELECT 1 FROM public.declutter_free_still_asks a
                        WHERE a.item_id = i.id
                          AND GREATEST(a.asked_at, a.answered_at) > now() - interval '14 days')
       AND public.feature_enabled_for_user('declutter', i.seller_id)
       AND NOT public.declutter_member_out(i.seller_id)
     ORDER BY i.id
     LIMIT 500
  LOOP
    BEGIN
      -- Claim first: a listing another run asked about in the last 14 days is never asked twice.
      v_claimed := NULL;
      INSERT INTO public.declutter_free_still_asks AS a (item_id, asked_at) VALUES (r.id, now())
        ON CONFLICT (item_id) DO UPDATE SET asked_at = now()
        WHERE GREATEST(a.asked_at, a.answered_at) IS NULL
           OR GREATEST(a.asked_at, a.answered_at) <= now() - interval '14 days'
        RETURNING a.item_id INTO v_claimed;
      CONTINUE WHEN v_claimed IS NULL;
      PERFORM public.declutter_notify(r.seller_id, 'declutter_listings',
        format('Is "%s" still available?', r.title),
        'Let neighbors know. Tap to say it''s still there, or that it''s gone.',
        '/declutter?tab=selling&still=' || r.id::text, r.seller_id);
      v_told := v_told + 1;
    EXCEPTION WHEN lock_not_available THEN
      v_locked := v_locked + 1;
    WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_free_still_available_sweep', r.id::text,
        format('still-available ask for listing %s failed: %s (%s)', r.id, SQLERRM, SQLSTATE));
    END;
  END LOOP;
  RETURN jsonb_build_object('told', v_told, 'skipped_locked', v_locked, 'errors', v_errors);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_free_still_available_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_free_still_available_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The cron: daily, Louisiana morning. Registered with the dead-cron monitor.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-free-still-available', interval '26 hours',
            'Declutter free listing "still available?" notice, daily at 15:51 UTC: asks a seller at most once per 14 days about a free listing up 14 days.',
            'exempt',
            'While no free listing is 14 days old, a run that tells nobody is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- 15:51 UTC = 10:51 AM CDT / 9:51 AM CST.
    PERFORM cron.schedule('declutter-free-still-available', '51 15 * * *',
      $c$SELECT public.cron_record_work('declutter-free-still-available', to_jsonb(public.declutter_free_still_available_sweep()));$c$);
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 5. Q30 catch-up policy: the newest migration that seeds cron_catchup_policy restates the whole set.
--    20261030221156's rows verbatim, plus declutter-free-still-available (not re-run late).
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
  ('declutter-free-still-available', false, interval '1 hour',  'Declutter free listing "still available?" notice (20261030232231): at most one per listing per 14 days, by its own told-at mark. A missed morning is simply picked up by the next daily run.')
    ON CONFLICT (jobname) DO UPDATE
      SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
          reason = EXCLUDED.reason, updated_at = now();
  END IF;
END
$do$;
