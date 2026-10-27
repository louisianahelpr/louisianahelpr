-- DECLUTTER HAUL-AWAY: THE DAILY SWEEP (docs/specs/declutter-haul-away.md H1,
-- "Not built in this slice"; the condition the declutter_haul_away switch
-- waits on before it goes to everyone).
--
-- WHAT WAS MISSING. Haul-away (20261017070827) shipped without two things:
--   1. Nobody told the seller. A listing that reached 14 days unsold (H1) was
--      only offered for a haul-away if the seller happened to open My
--      listings.
--   2. A haul-away that was never paid kept its items OFF SALE ('ended')
--      until the seller tapped "Put back on sale" (lh-money-escrow review
--      2026-10-16 #3; re-review 2026-10-17 finding 4). Worse, a job left
--      'failed' (declined card) after its checkout ran out could not be
--      deleted by its poster at all (the jobs DELETE policy, 20260903055308,
--      allows only unpaid-with-no-session or 'abandoned'), and
--      void-cancelled-payments abandons only 'unpaid' jobs, so those items
--      stayed off sale for good and My listings said the job could not be
--      removed (lh-money-escrow re-review 2026-10-16 #1, lh-authz-rls
--      re-review A(b)).
--
-- WHAT THIS ADDS: public.declutter_haul_away_sweep(), run once a day by the
-- cron 'declutter-haul-away' at 15:21 UTC (10:21 AM CDT / 9:21 AM CST,
-- Louisiana daytime). Service role only. Three parts, each item or job in its
-- own sub-block (a failure is logged through log_cron_defect and the rest of
-- the run goes on):
--
--   A. THE NOTICE. Every listing that is for sale ('live') and has reached 14
--      days unsold by the SAME rule My listings and declutter_link_haul_away
--      use (COALESCE(live_at, submitted_at, created_at) + 14 days, no sale in
--      progress: not in a cart 'in_cart'/'paid', not linked to a haul-away)
--      gets ONE notice to its seller, ever: the item is claimed in
--      public.declutter_haul_away_notices (primary key item_id, the
--      notified-at mark) in the same sub-block that writes the notice, so a
--      listing is told once and never again the next day. One notice per
--      seller per run names the item, or counts the items. Only sellers for
--      whom BOTH switches are on (feature_enabled_for_user 'declutter' and
--      'declutter_haul_away': testers today) and who are not out of
--      Declutter (declutter_member_out: banned, or 3 strikes) are told; an
--      item whose seller is not told is NOT marked, so the switch going to
--      everyone tells them then. The bell row goes through declutter_notify
--      (type 'info', as the haul-away's "Back on sale" notice); push follows
--      the normal pipeline (fan_out_push_on_notification applies the
--      member's push and work-status switches, as for every declutter_notify
--      caller). p_other is the seller: the notice is about their own listing,
--      so no test account ever reaches a real one.
--
--   B. A DECLINED CARD'S HAUL-AWAY JOB GOES TO 'abandoned'. A job linked to a
--      haul-away that is open, 'failed', with no checkout session, never
--      funded (no stripe_payment_intent_id: create-payment's success path is
--      the only writer of it, so a declined card never set one), holding no
--      gift card ('reserved' or 'redeemed'), and untouched for a day (a
--      Checkout Session lives at most 24 hours) becomes 'abandoned', exactly
--      what void-cancelled-payments does to an 'unpaid' job whose session
--      Stripe expired. The write repeats every condition in its WHERE, so a
--      job a retry re-opened meanwhile matches nothing. After it the poster's
--      own DELETE policy allows deleting the job (My listings' "Put back on
--      sale" works) and part C may put its items back.
--
--   C. ITEMS COME BACK ON SALE. A link at least 7 days old (updated_at, the
--      time it was made or re-pointed) is undone when its job holds nothing:
--      declutter_haul_job_hold says 'none' (job deleted, or cancelled with no
--      money kept), or 'job_open' for a job that is 'abandoned' (Stripe said
--      its checkout is dead, or part B above), untouched for a day, never
--      funded (no stripe_payment_intent_id) and holding no gift card. The
--      undo is declutter_cancel_haul_away's, under the same lock order (item,
--      then job, then link row): the link goes; an item the haul-away took
--      off sale goes back to 'live' only with the 3-12 photos a listing needs,
--      else it stays off sale and the seller is told how to put it back; an
--      item that was already off sale stays so. The abandoned job itself is
--      left as it is (nothing here deletes or cancels a job).
--      Why an 'abandoned' job's items may come back although the job is still
--      open: such a job can be paid again only through Post a Job's retry of
--      that same job, and that retry links the items again FIRST
--      (useJobSubmit, "A Declutter haul-away links again first"): an item
--      back on sale is taken off sale again, and an item sold meanwhile is
--      refused there, so the unpaid job is removed and never paid for it.
--      An 'unpaid' job with no session is left alone (void-cancelled-payments
--      decides when it is abandoned: it waits while a gift is reserved).
--
-- Bounded: at most 500 sellers' notices, 200 jobs and 500 links a run; the
-- next day takes the rest. SET lock_timeout '1s': a lock wait fails as a
-- caught 55P03 (lock_not_available) in that one sub-block, counted as
-- skipped_locked and left for the next day (a member paying at that moment
-- is not a defect, so it never reaches log_cron_defect); never a hung run.
--
-- Part C reads its candidates through public.declutter_haul_away_sweep_candidates
-- (a lock-free read that decides nothing; section 2 says why). Service role only.
--
-- Returns jsonb {notified_sellers, notified_items, jobs_abandoned,
-- links_undone, items_back_on_sale, skipped_locked, errors} for cron_record_work.
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, cron.schedule
-- by name (replaces), ON CONFLICT DO UPDATE; grants restated by role name.
-- Applied 3x in PGlite by src/test/pglite/declutterHaulAwaySweep.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 1. The notified-at mark. One row per listing ever told; no client privilege.
CREATE TABLE IF NOT EXISTS public.declutter_haul_away_notices (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.declutter_haul_away_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_haul_away_notices FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_haul_away_notices TO service_role;
-- Q807: refuse writes from a session whose email is unconfirmed (every public table).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
COMMENT ON TABLE public.declutter_haul_away_notices IS
  'Declutter haul-away: which listings were told "Haul-away is open" (once each, ever). '
  'Written only by declutter_haul_away_sweep (cron declutter-haul-away). No client privilege.';

-- ---------------------------------------------------------------------------
-- 2. Part C's candidates: links 7+ days old whose job looks like it holds
--    nothing. A plain read with no lock, on purpose: taking the job or link
--    locks here would take them BEFORE the item's, the reverse of the order
--    declutter_link_haul_away and declutter_cancel_haul_away use. It decides
--    nothing: the sweep locks the item, then the job (declutter_haul_job_hold,
--    FOR UPDATE), then the link row, and re-checks every condition under those
--    locks. Filtering here keeps finished hauls (linked forever) from filling
--    the 500 a run takes. Service role only.
CREATE OR REPLACE FUNCTION public.declutter_haul_away_sweep_candidates(p_limit integer)
RETURNS TABLE(item_id uuid)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT h.item_id
    FROM public.declutter_haul_aways h
    LEFT JOIN public.jobs j ON j.id = h.job_id
   WHERE h.updated_at <= now() - interval '7 days'
     AND (j.id IS NULL
          OR j.status = 'cancelled'
          OR (j.status = 'open' AND j.payment_status = 'abandoned' AND j.updated_at <= now() - interval '1 day'
              AND j.stripe_payment_intent_id IS NULL))
   ORDER BY h.item_id
   LIMIT p_limit;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_haul_away_sweep_candidates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_haul_away_sweep_candidates(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The sweep.
CREATE OR REPLACE FUNCTION public.declutter_haul_away_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET lock_timeout TO '1s'
AS $fn$
DECLARE
  r record;
  v_ids uuid[];
  v_n integer;
  v_title text;
  v_status text;
  v_seller uuid;
  v_hold text;
  v_pay text;
  v_job_touched timestamptz;
  v_pi text;
  v_photos integer;
  v_link public.declutter_haul_aways%ROWTYPE;
  v_sellers integer := 0;
  v_items integer := 0;
  v_abandoned integer := 0;
  v_undone integer := 0;
  v_back integer := 0;
  v_errors integer := 0;
  v_locked integer := 0;
BEGIN
  -- A. One notice per seller for the listings that reached 14 days unsold.
  FOR r IN
    SELECT i.seller_id, array_agg(i.id ORDER BY i.id) AS ids
      FROM public.declutter_items i
     WHERE i.status = 'live'
       AND COALESCE(i.live_at, i.submitted_at, i.created_at) + interval '14 days' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_haul_away_notices n WHERE n.item_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_haul_aways h WHERE h.item_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                        WHERE c.item_id = i.id AND c.status IN ('in_cart', 'paid'))
       AND public.feature_enabled_for_user('declutter', i.seller_id)
       AND public.feature_enabled_for_user('declutter_haul_away', i.seller_id)
       AND NOT public.declutter_member_out(i.seller_id)
     GROUP BY i.seller_id
     ORDER BY i.seller_id
     LIMIT 500
  LOOP
    BEGIN
      -- Claim first: an item another run already marked is never told twice.
      WITH claimed AS (
        INSERT INTO public.declutter_haul_away_notices (item_id)
        SELECT x FROM unnest(r.ids) x
        ON CONFLICT (item_id) DO NOTHING
        RETURNING item_id
      )
      SELECT array_agg(item_id ORDER BY item_id) INTO v_ids FROM claimed;
      v_n := COALESCE(cardinality(v_ids), 0);
      IF v_n > 0 THEN
        IF v_n = 1 THEN
          SELECT i.title INTO v_title FROM public.declutter_items i WHERE i.id = v_ids[1];
          PERFORM public.declutter_notify(r.seller_id, 'info', 'Haul-away is open',
            format('"%s" hasn''t sold in 2 weeks. You can book a Helpr to take it to donation or the dump from My listings.', v_title),
            '/declutter?view=mine', r.seller_id);
        ELSE
          PERFORM public.declutter_notify(r.seller_id, 'info', 'Haul-away is open',
            format('%s of your items haven''t sold in 2 weeks. You can book a Helpr to take them to donation or the dump from My listings.', v_n),
            '/declutter?view=mine', r.seller_id);
        END IF;
        v_sellers := v_sellers + 1;
        v_items := v_items + v_n;
      END IF;
    EXCEPTION WHEN lock_not_available THEN
      v_locked := v_locked + 1;
    WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_haul_away_sweep', r.seller_id::text,
        format('haul-away notice for seller %s failed: %s (%s)', r.seller_id, SQLERRM, SQLSTATE));
    END;
  END LOOP;

  -- B. A declined card's haul-away job whose checkout is gone: 'failed' -> 'abandoned'.
  FOR r IN
    SELECT j.id, COALESCE(j.is_seed, false) AS is_seed
      FROM public.jobs j
     WHERE j.status = 'open'
       AND j.payment_status = 'failed'
       AND j.stripe_session_id IS NULL
       AND j.stripe_payment_intent_id IS NULL
       AND j.updated_at <= now() - interval '1 day'
       AND EXISTS (SELECT 1 FROM public.declutter_haul_aways h WHERE h.job_id = j.id)
     ORDER BY j.id
     LIMIT 200
     -- The rows it is about to update (race-class guard); one a payment
     -- holds right now is left for the next day.
     FOR UPDATE OF j SKIP LOCKED
  LOOP
    BEGIN
      UPDATE public.jobs j
         SET payment_status = 'abandoned'
       WHERE j.id = r.id
         AND j.status = 'open'
         AND j.payment_status = 'failed'
         AND j.stripe_session_id IS NULL
         AND j.stripe_payment_intent_id IS NULL
         AND j.updated_at <= now() - interval '1 day'
         AND NOT EXISTS (SELECT 1 FROM public.gift_cards g
                          WHERE g.job_id = j.id AND g.status IN ('reserved', 'redeemed'));
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_abandoned := v_abandoned + v_n;
    EXCEPTION WHEN lock_not_available THEN
      v_locked := v_locked + 1;
    WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_haul_away_sweep' || CASE WHEN r.is_seed THEN '-seed' ELSE '' END,
        r.id::text, format('could not mark haul-away job %s abandoned: %s (%s)', r.id, SQLERRM, SQLSTATE));
    END;
  END LOOP;

  -- C. Links at least 7 days old whose job holds nothing: the items come back.
  FOR r IN
    SELECT c.item_id FROM public.declutter_haul_away_sweep_candidates(500) c
  LOOP
    BEGIN
      -- Lock order: item, then job (the hold rule locks it), then link row,
      -- as declutter_link_haul_away and declutter_cancel_haul_away take them.
      SELECT i.status, i.seller_id, i.title INTO v_status, v_seller, v_title
        FROM public.declutter_items i WHERE i.id = r.item_id FOR UPDATE;
      SELECT * INTO v_link FROM public.declutter_haul_aways h WHERE h.item_id = r.item_id;
      IF NOT FOUND OR v_link.updated_at > now() - interval '7 days' THEN
        CONTINUE;  -- undone, re-pointed or re-made meanwhile
      END IF;
      v_hold := public.declutter_haul_job_hold(v_link.job_id);
      IF v_hold = 'job_open' THEN
        -- Part B's money guards too (lh-money-escrow review 2026-10-27 #2): an
        -- 'abandoned' job is never funded today, but the webhooks would fund one.
        SELECT j.payment_status, j.updated_at, j.stripe_payment_intent_id INTO v_pay, v_job_touched, v_pi
          FROM public.jobs j WHERE j.id = v_link.job_id FOR UPDATE;  -- already locked by the hold rule
        IF v_pay IS DISTINCT FROM 'abandoned' OR v_job_touched > now() - interval '1 day' OR v_pi IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.gift_cards g
                       WHERE g.job_id = v_link.job_id AND g.status IN ('reserved', 'redeemed')) THEN
          CONTINUE;
        END IF;
      ELSIF v_hold <> 'none' THEN
        CONTINUE;  -- paying, booked, hauled, job_stuck: the haul-away stands
      END IF;
      PERFORM 1 FROM public.declutter_haul_aways h WHERE h.item_id = r.item_id FOR UPDATE;
      DELETE FROM public.declutter_haul_aways WHERE item_id = r.item_id AND job_id IS NOT DISTINCT FROM v_link.job_id;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;
      v_undone := v_undone + 1;
      IF v_status = 'ended' AND v_link.prior_status = 'live' THEN
        SELECT count(*) INTO v_photos FROM public.declutter_item_photos ph WHERE ph.item_id = r.item_id;
        IF v_photos BETWEEN 3 AND 12 THEN
          UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = r.item_id;
          v_back := v_back + 1;
          PERFORM public.declutter_notify(v_seller, 'info', 'Back on sale',
            format('Your haul-away for "%s" didn''t go ahead, so it is back on sale. If it is gone, take it down in My listings.', v_title),
            '/declutter?view=mine', v_seller);
        ELSE
          PERFORM public.declutter_notify(v_seller, 'info', 'Haul-away not booked',
            format('Your haul-away for "%s" didn''t go ahead. It stays off sale until it has 3 to 12 photos: add them in My listings to put it back on sale.', v_title),
            '/declutter?view=mine', v_seller);
        END IF;
      END IF;
    EXCEPTION WHEN lock_not_available THEN
      v_locked := v_locked + 1;
    WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_haul_away_sweep', r.item_id::text,
        format('could not put haul-away item %s back on sale: %s (%s)', r.item_id, SQLERRM, SQLSTATE));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'notified_sellers', v_sellers, 'notified_items', v_items, 'jobs_abandoned', v_abandoned,
    'links_undone', v_undone, 'items_back_on_sale', v_back, 'skipped_locked', v_locked, 'errors', v_errors);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_haul_away_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_haul_away_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The cron: daily, Louisiana morning. Registered with the dead-cron monitor.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-haul-away', interval '26 hours',
            'Declutter haul-away, daily at 15:21 UTC: tells a seller once when a listing reaches 14 days unsold, marks a declined card''s haul-away job abandoned, and puts items of a haul-away that never went ahead back on sale after 7 days.',
            'exempt',
            'While Declutter is testers-only or no listing is 14 days old, a run that changes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- 15:21 UTC = 10:21 AM CDT / 9:21 AM CST.
    PERFORM cron.schedule('declutter-haul-away', '21 15 * * *',
      $c$SELECT public.cron_record_work('declutter-haul-away', to_jsonb(public.declutter_haul_away_sweep()));$c$);
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 5. Q30 catch-up policy: the newest migration that seeds cron_catchup_policy
--    restates the whole set (cronCatchUpPolicy reads it as the policy).
--    20261025182522's rows verbatim, plus the daily declutter-haul-away job,
--    which is NOT re-run late: its next daily run does everything that was due.
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
  ('declutter-haul-away',             false, interval '1 hour',   'Declutter haul-away sweep (20261027165903): the "Haul-away is open" notice (once per listing, by its mark), a declined card''s haul-away job to abandoned, and the put-back-on-sale of a haul-away that never went ahead after 7 days. Not re-run late: the next daily run does everything that was due.')
    ON CONFLICT (jobname) DO UPDATE
      SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
          reason = EXCLUDED.reason, updated_at = now();
  END IF;
END
$do$;
