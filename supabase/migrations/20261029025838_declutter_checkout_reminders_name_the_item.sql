-- Declutter checkout reminders name the item and open Buying (whole-app audit 2026-10-28, Declutter notices;
-- lead's item 3 for builder 9).
--
-- WHAT WAS WRONG: the 48-hour checkout's two reminders, "Check out within 24 hours" ("You have an item waiting in
-- your cart...") and "2 hours left to check out" ("Check out in the next 2 hours..."), did not say WHICH item, so a
-- buyer with two lines could not tell them apart (and suppress_exact_duplicate_notification drops a second
-- word-for-word notice inside 10 minutes). They, and the sweep's four other buyer notices ("The seller cancelled",
-- "This sale was cancelled", "Sale ended, no strike" to the buyer, "Checkout closed"), linked the retired
-- /declutter?view=cart, which the client only guesses into a tab (src/lib/declutter/tabs.ts oldDeclutterView).
--
-- WHAT THIS DOES, and nothing else: each reminder names its item ("<title>" is waiting in your cart... / Check out
-- "<title>" in the next 2 hours...; the old words when the line has no item), and the sweep's six buyer links become
-- /declutter?tab=buying. Its seller links were already /declutter?tab=selling. No amount, status, strike, timing or
-- order changes.
--
-- RESTATED FROM THE NEWEST DEFINITION: 20261028235249_declutter_handover_talk.sql (the talk-aware sweep), verbatim
-- but for the lines above; src/test/declutterCheckoutRemindersNameTheItem.test.ts proves the two bodies differ in
-- exactly those lines. Grants restated as they are (service_role only).
-- REPLAY-SAFE: CREATE OR REPLACE. Proof (3x, red without this migration, red on planted defects):
-- src/test/pglite/declutterCheckoutReminders.pglite.mjs.
CREATE OR REPLACE FUNCTION public.declutter_deadline_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_expired integer := 0;
  v_r24 integer := 0;
  v_r2 integer := 0;
  v_missed integer := 0;
  v_unstruck integer := 0;
  v_talked integer := 0;
  r record;
  v_line record;
BEGIN
  FOR r IN
    UPDATE public.declutter_offers o
       SET status = 'expired', closed_at = now(), updated_at = now()
     WHERE o.status = 'open' AND o.respond_by <= now()
    RETURNING o.id, o.buyer_id, o.seller_id, o.awaiting, o.item_id
  LOOP
    v_expired := v_expired + 1;
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'expire');
    PERFORM public.declutter_notify(r.buyer_id, 'expired', 'Offer expired',
      CASE WHEN r.awaiting = 'seller' THEN 'The seller did not answer your offer within 48 hours, so it closed. Nothing was charged.'
           ELSE 'You did not answer the counteroffer within 48 hours, so it closed.' END,
      '/declutter/item/' || r.item_id::text, r.seller_id);
    PERFORM public.declutter_notify(r.seller_id, 'expired', 'Offer expired',
      CASE WHEN r.awaiting = 'seller' THEN 'You did not answer an offer within 48 hours, so it closed.'
           ELSE 'The buyer did not answer your counteroffer within 48 hours, so it closed.' END,
      '/declutter?tab=selling', r.buyer_id);
  END LOOP;

  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_24h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_24h_at IS NULL
       AND c.checkout_by > now() + interval '2 hours'
       AND c.checkout_by <= now() + interval '24 hours'
       -- 20261028235249: not while the buyer and seller are talking the handover through.
       AND NOT public.declutter_pair_talking(c.buyer_id, c.seller_id)
    RETURNING c.buyer_id, (SELECT i.title FROM public.declutter_items i WHERE i.id = c.item_id) AS title
  LOOP
    v_r24 := v_r24 + 1;
    -- 20261029025838: the reminder names its item and opens the buyer's own tab.
    PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Check out within 24 hours',
      CASE WHEN r.title IS NULL THEN 'You have an item waiting in your cart. Check out within 24 hours or you get a strike.'
           ELSE format('"%s" is waiting in your cart. Check out within 24 hours or you get a strike.', r.title) END,
      '/declutter?tab=buying');
  END LOOP;
  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_2h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_2h_at IS NULL
       AND c.checkout_by > now() AND c.checkout_by <= now() + interval '2 hours'
       -- 20261028235249: not while the buyer and seller are talking the handover through.
       AND NOT public.declutter_pair_talking(c.buyer_id, c.seller_id)
    RETURNING c.buyer_id, (SELECT i.title FROM public.declutter_items i WHERE i.id = c.item_id) AS title
  LOOP
    v_r2 := v_r2 + 1;
    -- 20261029025838: the reminder names its item and opens the buyer's own tab.
    PERFORM public.declutter_notify(r.buyer_id, 'payment', '2 hours left to check out',
      CASE WHEN r.title IS NULL THEN 'Check out in the next 2 hours or you get a strike and the item goes back up for sale.'
           ELSE format('Check out "%s" in the next 2 hours or you get a strike and it goes back up for sale.', r.title) END,
      '/declutter?tab=buying');
  END LOOP;

  -- Missed checkouts. Lock order items -> orders -> lines, one line at a time.
  FOR r IN
    SELECT c.id, c.item_id
      FROM public.declutter_cart_items c
     WHERE c.status = 'in_cart' AND c.checkout_by <= now()
     ORDER BY c.item_id
  LOOP
    PERFORM 1 FROM public.declutter_items i WHERE i.id = r.item_id FOR UPDATE;
    SELECT c.*, i.title INTO v_line
      FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.id = r.id;
    IF v_line.status <> 'in_cart' THEN CONTINUE; END IF;
    -- Grace: a payable order gets 1 h past the deadline (its Stripe page lives
    -- at most 30 min, so by then it can no longer be paid; B45).
    IF v_line.order_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.declutter_orders o
                    WHERE o.id = v_line.order_id AND o.status = 'awaiting_payment'
                      AND v_line.checkout_by > now() - interval '1 hour') THEN
      CONTINUE;
    END IF;
    BEGIN
      -- Who stopped this checkout? A seller who blocked the buyer backed out
      -- (row 19: seller strike); a seller who can no longer sell ends it with
      -- no strike for the buyer; otherwise the buyer missed it (rows 7, 59).
      -- user_blocks is read directly: are_users_blocked() answers only for
      -- parties or server context.
      IF EXISTS (SELECT 1 FROM public.user_blocks b
                  WHERE b.blocker_id = v_line.seller_id AND b.blocked_id = v_line.buyer_id) THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'seller_blocked', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
         WHERE id = v_line.item_id AND status = 'reserved';
        PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'The seller cancelled',
          format('The seller cancelled the sale of "%s". You were not charged and you get no strike.', v_line.title),
          '/declutter?tab=buying', v_line.seller_id);
        PERFORM public.declutter_give_strike(v_line.seller_id, 'seller', 'cancelled_after_offers', v_line.item_id,
          format('You blocked the buyer of "%s" after the sale, which cancels it.', v_line.title), v_line.id);
      ELSIF public.declutter_seller_out(v_line.seller_id) THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'seller_out', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        UPDATE public.declutter_items SET status = 'ended', updated_at = now()
         WHERE id = v_line.item_id AND status = 'reserved';
        PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'This sale was cancelled',
          format('"%s" can''t be sold right now, so the sale is cancelled. You were not charged and you get no strike.', v_line.title),
          '/declutter?tab=buying');
      -- 20261028235249 (owner 2026-10-28, Q2462 #3730): the two talked about the handover and no way that always
      -- works was shared, so the buyer could not check out: the sale ends with no strike for anyone.
      ELSIF public.declutter_pair_needs_talk(v_line.buyer_id, v_line.seller_id)
            AND EXISTS (SELECT 1 FROM public.declutter_handover_talks t
                         WHERE t.buyer_id = v_line.buyer_id AND t.seller_id = v_line.seller_id
                           AND t.opened_at >= v_line.created_at) THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'not_payable', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        IF FOUND THEN
          v_talked := v_talked + 1;
          UPDATE public.declutter_items SET status = 'live', updated_at = now()
           WHERE id = v_line.item_id AND status = 'reserved';
          PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'Sale ended, no strike',
            format('You and the seller didn''t find a way to hand over "%s", so the sale ended. You were not charged and nobody gets a strike.', v_line.title),
            '/declutter?tab=buying', v_line.seller_id);
          PERFORM public.declutter_notify(v_line.seller_id, 'declutter_sales', 'Sale ended, no strike',
            format('You and the buyer didn''t find a way to hand over "%s", so the sale ended and it is back up for sale. Nobody gets a strike.', v_line.title),
            '/declutter?tab=selling', v_line.buyer_id);
        END IF;
      ELSE
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'missed_checkout', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        IF FOUND THEN
          v_missed := v_missed + 1;
          -- Back on sale (rows 13/59).
          UPDATE public.declutter_items SET status = 'live', updated_at = now()
           WHERE id = v_line.item_id AND status = 'reserved';
          IF public.feature_enabled_for_user('declutter', v_line.buyer_id) THEN
            PERFORM public.declutter_give_strike(v_line.buyer_id, 'buyer', 'missed_checkout', v_line.item_id,
              format('You did not check out "%s" within 48 hours.', v_line.title), v_line.id);
          ELSE
            -- Row 62: the switch was turned off for this buyer mid-sale.
            v_unstruck := v_unstruck + 1;
            PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'Checkout closed',
              format('Checkout for "%s" closed. You were not charged and you get no strike.', v_line.title),
              '/declutter?tab=buying', v_line.seller_id);
          END IF;
          PERFORM public.declutter_notify(v_line.seller_id, 'new_offers', 'Buyer did not check out',
            format('The buyer did not pay for "%s" in time, so it is back up for sale.', v_line.title), '/declutter?tab=selling', v_line.buyer_id);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad line never stops every other missed checkout; it is retried
      -- on the next run (the line is still in_cart) and filed where ops reads it.
      PERFORM public.log_cron_defect('declutter_deadline_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;

  -- 20261028235249: talks past their 72 hours close (after the lines above were judged with them).
  UPDATE public.declutter_handover_talks SET closed_at = now()
   WHERE closed_at IS NULL AND expires_at <= now();

  RETURN jsonb_build_object('offers_expired', v_expired, 'reminded_24h', v_r24,
                            'reminded_2h', v_r2, 'checkouts_missed', v_missed, 'missed_without_strike', v_unstruck,
                            'ended_after_talk', v_talked);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_deadline_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_deadline_sweep() TO service_role;
