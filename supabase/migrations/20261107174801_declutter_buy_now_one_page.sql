-- OWNER 11-07 (replaces the 10-28 two-page choice, audit #21 option C): Declutter Buy now uses ONE Stripe page.
--
-- What was broken: Buy now with no saved card first sent the buyer to Stripe's card-saving page (declutter-card,
-- mode=setup) and only then to the pay page (declutter-checkout). The only real buyer so far (11-05) saved a card on
-- page one, thought he had bought, never opened page two, and the 30-minute hold ran out.
--
-- What this changes (SQL half; the pay page itself is declutter-checkout and stripe-webhook):
--   1. declutter_lock_buyable_item gains a 3-argument form (p_need_card). The card rule is unchanged for every
--      existing caller: the 2-argument form (make_offer, request_bundle, answer_bundle) calls it with true, so an
--      offer or a bundle request still needs a saved card (they are charged later, off the page).
--   2. declutter_buy_now calls it with false: Buy now holds the item with no saved card and goes straight to the
--      pay page, which saves the card for later offers (setup_future_usage; stripe-webhook stores it with
--      declutter_save_card). Restated from its newest CREATE (20261027170717_declutter_free_section.sql); the only
--      change is the lock call.
--   3. A reminder ~10 minutes before a Buy now hold ends: declutter_buy_now_last_call_sweep, once per buyer and
--      seller per hold (claim column declutter_cart_items.reminded_last_call_at, written in the same block as the
--      notice, so a notice that cannot be written leaves the claim empty and the next run retries). It rides the
--      existing 10-minute 'declutter-book-by-reminders' job through sweep_deadline_reminders (restated from its
--      newest CREATE, 20261102011547_free_asks_close_when_their_time_passes.sql, adding one block), so no new cron
--      job. The window is "the hold ends 2 to 12 minutes from now": with a run every 10 minutes every 30-minute
--      hold is reminded exactly once, between 2 and 12 minutes before it ends. Never a seed item, and never when
--      either side's profile is a seed (test) account: test orders never notify real people.
--
-- The 2-argument lock is defined FIRST and the 3-argument one LAST on purpose: the guards that read "the newest
-- definition of declutter_lock_buyable_item" key by name and take the last CREATE, which must be the full body.
--
-- MONEY: no amount, fee, refund or payout changes; who may hold an item is unchanged except the card rule for Buy
-- now. AUTHZ: the lock and the sweep are service_role only; declutter_buy_now keeps its grants.
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, grants by role name.
-- Proof: src/test/pglite/declutterBuyNowOnePage.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

ALTER TABLE public.declutter_cart_items ADD COLUMN IF NOT EXISTS reminded_last_call_at timestamptz;

-- The 2-argument form every existing caller uses: the card is still required.
CREATE OR REPLACE FUNCTION public.declutter_lock_buyable_item(p_item_id uuid, p_buyer uuid, OUT o_seller_id uuid, OUT o_price_cents integer, OUT o_title text)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  SELECT l.o_seller_id, l.o_price_cents, l.o_title INTO o_seller_id, o_price_cents, o_title
    FROM public.declutter_lock_buyable_item(p_item_id, p_buyer, true) l;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_lock_buyable_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_lock_buyable_item(uuid, uuid) TO service_role;

-- declutter_buy_now: restated from 20261027170717_declutter_free_section.sql; only the lock call changed (no card).
CREATE OR REPLACE FUNCTION public.declutter_buy_now(p_item_id uuid, p_expected_price_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  -- Owner 11-07: Buy now needs no saved card; its one pay page saves the card (setup_future_usage).
  SELECT * INTO v_item FROM public.declutter_lock_buyable_item(p_item_id, v_uid, false);
  -- The buyer agreed to the price they SAW; a drop since only helps them.
  -- A free item is claimed through declutter_claim_free (its own limit and no card), never bought.
  IF v_item.o_price_cents = 0 THEN
    RAISE EXCEPTION 'free_item_claim_it' USING ERRCODE = '22023', HINT = 'This item is free. Tap Get it free.';
  END IF;
  IF p_expected_price_cents IS NULL OR v_item.o_price_cents > p_expected_price_cents THEN
    RAISE EXCEPTION 'price_changed' USING ERRCODE = '55000', HINT = 'The price changed. Check it and try again.';
  END IF;
  RETURN public.declutter_take_item(p_item_id, v_uid, v_item.o_price_cents, 'buy', NULL);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_buy_now(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_buy_now(uuid, integer) TO authenticated, service_role;

-- The reminder before a Buy now hold ends (owner 11-07). Service role only (cron).
CREATE OR REPLACE FUNCTION public.declutter_buy_now_last_call_sweep(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_sent integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT c.buyer_id, c.seller_id,
           array_agg(c.id ORDER BY c.checkout_by, c.id) AS ids,
           min(c.checkout_by) AS ends_at,
           count(*) AS n,
           (array_agg(i.title ORDER BY c.checkout_by, c.id))[1] AS title
      FROM public.declutter_cart_items c
      JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.status = 'in_cart' AND c.source = 'buy' AND c.price_cents > 0
       AND c.reminded_last_call_at IS NULL
       AND c.checkout_by > p_now + interval '2 minutes'
       AND c.checkout_by <= p_now + interval '12 minutes'
       -- Test orders never notify anyone real: no seed item, no seed account on either side.
       AND NOT COALESCE(i.is_seed, false)
       AND NOT COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = c.buyer_id), false)
       AND NOT COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = c.seller_id), false)
     GROUP BY c.buyer_id, c.seller_id
  LOOP
    -- The claim and the notice share this block: a notice that cannot be written undoes the claim (the block's
    -- savepoint), it is logged, and the next run sends it. The other buyers go on.
    BEGIN
      UPDATE public.declutter_cart_items
         SET reminded_last_call_at = p_now
       WHERE id = ANY (r.ids) AND status = 'in_cart' AND reminded_last_call_at IS NULL;
      IF FOUND THEN
        PERFORM public.declutter_notice_ref(r.ids[1]);
        PERFORM public.declutter_notify_strict(r.buyer_id, 'declutter_sales', 'Pay soon to keep your item',
          format('%s %s held for you until %s. Pay by then or it goes back up for sale. Your card is charged only when you pay.',
                 CASE WHEN r.title IS NULL THEN 'Your item'
                      WHEN r.n > 1 THEN format('"%s" and %s more', r.title, r.n - 1)
                      ELSE format('"%s"', r.title) END,
                 CASE WHEN r.n > 1 THEN 'are' ELSE 'is' END,
                 to_char(r.ends_at AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM')),
          '/declutter?tab=buying', r.seller_id);
        v_sent := v_sent + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_buy_now_last_call_sweep', r.buyer_id::text || ':' || r.seller_id::text, SQLERRM);
    END;
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_buy_now_last_call_sweep(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_buy_now_last_call_sweep(timestamptz) TO service_role;

-- sweep_deadline_reminders: restated from 20261102011547_free_asks_close_when_their_time_passes.sql; the
-- buy_now_last_call block is new.
CREATE OR REPLACE FUNCTION public.sweep_deadline_reminders(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_book_by integer;
  v_needs_you integer;
  v_free_asks integer;
  v_last_call integer;
  v_failed text[] := ARRAY[]::text[];
BEGIN
  BEGIN
    v_book_by := public.declutter_book_by_reminder_sweep(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_failed := array_append(v_failed, 'book_by');
    PERFORM public.log_cron_defect('sweep_deadline_reminders', 'declutter_book_by_reminder_sweep', SQLERRM, NULL);
  END;
  BEGIN
    v_needs_you := public.sweep_needs_you_reminders(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_failed := array_append(v_failed, 'needs_you');
    PERFORM public.log_cron_defect('sweep_deadline_reminders', 'sweep_needs_you_reminders', SQLERRM, NULL);
  END;
  -- A3-57: free asks whose time passed close with a notice; the giver is reminded before the earliest asked time.
  BEGIN
    v_free_asks := public.sweep_declutter_free_asks(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_failed := array_append(v_failed, 'free_asks');
    PERFORM public.log_cron_defect('sweep_deadline_reminders', 'sweep_declutter_free_asks', SQLERRM, NULL);
  END;
  -- Owner 11-07: the reminder ~10 minutes before a Buy now hold ends.
  BEGIN
    v_last_call := public.declutter_buy_now_last_call_sweep(p_now);
  EXCEPTION WHEN OTHERS THEN
    v_failed := array_append(v_failed, 'buy_now_last_call');
    PERFORM public.log_cron_defect('sweep_deadline_reminders', 'declutter_buy_now_last_call_sweep', SQLERRM, NULL);
  END;
  RETURN jsonb_build_object('book_by', v_book_by, 'needs_you', v_needs_you, 'free_asks', v_free_asks,
                            'buy_now_last_call', v_last_call)
         || CASE WHEN cardinality(v_failed) > 0 THEN jsonb_build_object('failed', to_jsonb(v_failed)) ELSE '{}'::jsonb END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_deadline_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_deadline_reminders(timestamptz) TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    UPDATE public.cron_work_expectations
       SET note = 'B117 (lead 11-01, A3-18/19): a paid Declutter pickup with no time booked reminds the buyer 24 h and 2 h before book_by (paid + 7 days). A3-85 (owner 11-01): an open Declutter offer or refund step reminds the member who must answer, about 12 h and 2 h before its deadline (2 a day per item, none 8:50 PM-8 AM). A3-57: free asks close when their time passes. Owner 11-07: a Buy now hold reminds the buyer once, 2 to 12 minutes before it ends.'
     WHERE jobname = 'declutter-book-by-reminders';
  END IF;
END
$do$;

-- The full lock, LAST (see the header). Restated from 20261103112014_money_records_and_buy_lock_not_found_is_404.sql;
-- the only change is p_need_card around the card rule.
CREATE OR REPLACE FUNCTION public.declutter_lock_buyable_item(p_item_id uuid, p_buyer uuid, p_need_card boolean, OUT o_seller_id uuid, OUT o_price_cents integer, OUT o_title text)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_mode text;
  v_seed boolean;
BEGIN
  SELECT i.seller_id, i.current_price_cents, i.title, i.status, i.sale_mode, i.is_seed
    INTO o_seller_id, o_price_cents, o_title, v_status, v_mode, v_seed
    FROM public.declutter_items i
   WHERE i.id = p_item_id
   FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('live', 'reserved')
     OR public.are_users_blocked(o_seller_id, p_buyer)
     OR public.declutter_seller_out(o_seller_id)
     OR (v_seed AND public.seed_hidden_for(p_buyer)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o_seller_id = p_buyer THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  IF v_mode <> 'offers' THEN
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available'
      USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;
  -- Owner 11-07: only Buy now passes false (its pay page saves the card). NULL counts as true (fail closed).
  IF p_need_card IS DISTINCT FROM false
     AND NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = p_buyer) THEN
    RAISE EXCEPTION 'card_required'
      USING ERRCODE = '42501', HINT = 'Save a card first. It is never charged until you check out.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_lock_buyable_item(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_lock_buyable_item(uuid, uuid, boolean) TO service_role;
