-- Q2465 (lead decision 2026-11-01 8:51 PM): pure reminder sends use declutter_notify_strict, so a reminder that cannot
-- be written is retried on the next run instead of only logged, and the comments say so.
--
-- Since 20261028162048, declutter_notify swallows a failed insert and logs it (a notice never rolls back its sale,
-- offer or refund). That is right for a notice that REPORTS a step. For a reminder, the notice IS the step: logging it
-- and moving on marks the reminder sent though nobody got it. Pickup reminders already use the strict path
-- (declutter_pickup_remind). Now:
--   * declutter_deadline_sweep, the 24-hour and 2-hour checkout reminders: each line's reminder is sent strict inside
--     its own block. If it fails, that line's claim (reminded_24h_at / reminded_2h_at) is cleared and the failure is
--     logged (log_cron_defect), so the next run (every few minutes) tries it again; the other lines go on. The count
--     (reminded_24h / reminded_2h) counts only reminders that were written.
--   * declutter_handover_sweep (d), "Delivery coming up" before a booked seller delivery: both sends strict. They
--     already sit in the order's own block, so a failure rolls back that order's reminded_hours mark with them and the
--     next run retries; the other orders go on.
-- NOT changed, on purpose (the notices there report a step that already happened; the step itself is what rolls back
-- and retries): the missed-checkout and offer-expiry notices in declutter_deadline_sweep, the rest of
-- declutter_handover_sweep, declutter_refund_request_sweep, and the 60-day "Did you get your item?" nudges (already
-- strict through declutter_pickup_remind).
--
-- RESTATED FROM (newest CREATEs, checked 2026-11-01 on origin/main and wip/b135-open): declutter_deadline_sweep from
-- 20261101030040_declutter_buy_now_30_minutes.sql; declutter_handover_sweep from
-- 20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql. Changed only the marked (Q2465) parts.
-- MONEY: none; no amount, status or refund changes. REPLAY-SAFE: CREATE OR REPLACE; REVOKE/GRANT restated.
-- Proof: src/test/pglite/declutterRemindersRetryStrict.pglite.mjs.

CREATE OR REPLACE FUNCTION public.declutter_deadline_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expired integer := 0;
  v_r24 integer := 0;
  v_r2 integer := 0;
  v_missed integer := 0;
  v_unstruck integer := 0;
  v_talked integer := 0;
  v_free_missed integer := 0;
  v_buy_missed integer := 0;  -- DB-5
  v_reopened integer := 0;  -- BUY-1
  r record;
  v_line record;
BEGIN
  FOR r IN
    UPDATE public.declutter_offers o
       SET status = 'expired', closed_at = now(), updated_at = now()
     WHERE o.status = 'open' AND o.respond_by <= now()
    RETURNING o.id, o.buyer_id, o.seller_id, o.awaiting, o.item_id,
      (SELECT i.title FROM public.declutter_items i WHERE i.id = o.item_id) AS title
  LOOP
    v_expired := v_expired + 1;
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'expire');
    -- E2-7: both sides are told which item. The old words stay only for an offer whose item row is gone.
    PERFORM public.declutter_notify(r.buyer_id, 'expired', 'Offer expired',
      CASE WHEN r.title IS NULL THEN
             CASE WHEN r.awaiting = 'seller' THEN 'The seller did not answer your offer within 48 hours, so it closed. Nothing was charged.'
                  ELSE 'You did not answer the counteroffer within 48 hours, so it closed.' END
           WHEN r.awaiting = 'seller' THEN format('The seller did not answer your offer on "%s" within 48 hours, so it closed. Nothing was charged.', r.title)
           ELSE format('You did not answer the counteroffer on "%s" within 48 hours, so it closed.', r.title) END,
      '/declutter/item/' || r.item_id::text, r.seller_id);
    PERFORM public.declutter_notify(r.seller_id, 'expired', 'Offer expired',
      CASE WHEN r.title IS NULL THEN
             CASE WHEN r.awaiting = 'seller' THEN 'You did not answer an offer within 48 hours, so it closed.'
                  ELSE 'The buyer did not answer your counteroffer within 48 hours, so it closed.' END
           WHEN r.awaiting = 'seller' THEN format('You did not answer an offer on "%s" within 48 hours, so it closed.', r.title)
           ELSE format('The buyer did not answer your counteroffer on "%s" within 48 hours, so it closed.', r.title) END,
      '/declutter?tab=selling', r.buyer_id);
  END LOOP;

  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_24h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_24h_at IS NULL
       AND c.checkout_by > now() + interval '2 hours'
       AND c.checkout_by <= now() + interval '24 hours'
       -- BUY-1: only a hold longer than 24 hours (a free claim's 48) gets the 24-hour reminder; a 24-hour offer hold
       -- was told at the start, and a 30-minute Buy now hold has no time for it.
       AND c.checkout_by - c.created_at > interval '24 hours'
       -- 20261028235249: not while the buyer and seller are talking the handover through.
       AND NOT public.declutter_pair_talking(c.buyer_id, c.seller_id)
    RETURNING c.id, c.buyer_id, c.price_cents, c.source, (SELECT i.title FROM public.declutter_items i WHERE i.id = c.item_id) AS title
  LOOP
   -- Q2465: the reminder IS this step: sent strict; a failure clears this line's claim so the next run retries it.
   BEGIN
    -- 20261029025838: the reminder names its item and opens the buyer's own tab.
    IF r.price_cents = 0 THEN
      -- DA-12: a free item has no strike to threaten.
      PERFORM public.declutter_notify_strict(r.buyer_id, 'declutter_sales', 'Choose a pickup within 24 hours',
        CASE WHEN r.title IS NULL THEN 'Your free item is held for you. Choose how you''ll pick it up within 24 hours or it goes back up.'
             ELSE format('"%s" is held for you. Choose how you''ll pick it up within 24 hours or it goes back up.', r.title) END,
        '/declutter?tab=buying');
    ELSIF r.source = 'buy' THEN
      -- DB-5: a Buy now line has no strike to threaten either.
      PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Check out within 24 hours',
        CASE WHEN r.title IS NULL THEN 'You have an item waiting at checkout. Pay within 24 hours or it goes back up for sale.'
             ELSE format('"%s" is waiting at checkout. Pay within 24 hours or it goes back up for sale.', r.title) END,
        '/declutter?tab=buying');
    ELSE
    PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Check out within 24 hours',
      CASE WHEN r.title IS NULL THEN 'You have an item waiting in your cart. Check out within 24 hours or you get a strike.'
           ELSE format('"%s" is waiting in your cart. Check out within 24 hours or you get a strike.', r.title) END,
      '/declutter?tab=buying');
    END IF;
    v_r24 := v_r24 + 1;
   EXCEPTION WHEN OTHERS THEN
    -- The block's own savepoint undid the reminder; the claim is cleared here, outside it, so the next run sends it.
    UPDATE public.declutter_cart_items SET reminded_24h_at = NULL WHERE id = r.id;
    PERFORM public.log_cron_defect('declutter_deadline_sweep', 'reminder_24h:' || r.id::text, SQLERRM);
   END;
  END LOOP;
  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_2h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_2h_at IS NULL
       AND c.checkout_by > now() AND c.checkout_by <= now() + interval '2 hours'
       -- BUY-1: a 30-minute Buy now hold (even one checkout stretched to its Stripe page) gets no 2-hour reminder.
       AND c.checkout_by - c.created_at > interval '2 hours'
       -- 20261028235249: not while the buyer and seller are talking the handover through.
       AND NOT public.declutter_pair_talking(c.buyer_id, c.seller_id)
    RETURNING c.id, c.buyer_id, c.price_cents, c.source, (SELECT i.title FROM public.declutter_items i WHERE i.id = c.item_id) AS title
  LOOP
   -- Q2465: the reminder IS this step: sent strict; a failure clears this line's claim so the next run retries it.
   BEGIN
    -- 20261029025838: the reminder names its item and opens the buyer's own tab.
    IF r.price_cents = 0 THEN
      -- DA-12: a free item has no strike to threaten.
      PERFORM public.declutter_notify_strict(r.buyer_id, 'declutter_sales', '2 hours left to choose a pickup',
        CASE WHEN r.title IS NULL THEN 'Choose how you''ll pick up your free item in the next 2 hours or it goes back up.'
             ELSE format('Choose how you''ll pick up "%s" in the next 2 hours or it goes back up.', r.title) END,
        '/declutter?tab=buying');
    ELSIF r.source = 'buy' THEN
      -- DB-5: a Buy now line has no strike to threaten either.
      PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', '2 hours left to check out',
        CASE WHEN r.title IS NULL THEN 'Pay in the next 2 hours or the item goes back up for sale.'
             ELSE format('Pay for "%s" in the next 2 hours or it goes back up for sale.', r.title) END,
        '/declutter?tab=buying');
    ELSE
    PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', '2 hours left to check out',
      CASE WHEN r.title IS NULL THEN 'Check out in the next 2 hours or you get a strike and the item goes back up for sale.'
           ELSE format('Check out "%s" in the next 2 hours or you get a strike and it goes back up for sale.', r.title) END,
      '/declutter?tab=buying');
    END IF;
    v_r2 := v_r2 + 1;
   EXCEPTION WHEN OTHERS THEN
    -- The block's own savepoint undid the reminder; the claim is cleared here, outside it, so the next run sends it.
    UPDATE public.declutter_cart_items SET reminded_2h_at = NULL WHERE id = r.id;
    PERFORM public.log_cron_defect('declutter_deadline_sweep', 'reminder_2h:' || r.id::text, SQLERRM);
   END;
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
    -- Grace (BUY-1): starting checkout stretches the hold to its Stripe page's end
    -- (declutter_attach_checkout_session), so a payable order only gets 10 min
    -- past the deadline for Stripe's paid event to arrive. A payment that lands
    -- after the hold is released is refunded in full (declutter_mark_order_paid).
    IF v_line.order_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.declutter_orders o
                    WHERE o.id = v_line.order_id AND o.status = 'awaiting_payment'
                      AND v_line.checkout_by > now() - interval '10 minutes') THEN
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
          v_reopened := v_reopened + public.declutter_reopen_voided_offers(v_line.id);  -- BUY-1
          PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'Sale ended, no strike',
            format('You and the seller didn''t find a way to hand over "%s", so the sale ended. You were not charged and nobody gets a strike.', v_line.title),
            '/declutter?tab=buying', v_line.seller_id);
          PERFORM public.declutter_notify(v_line.seller_id, 'declutter_sales', 'Sale ended, no strike',
            format('You and the buyer didn''t find a way to hand over "%s", so the sale ended and it is back up for sale. Nobody gets a strike.', v_line.title),
            '/declutter?tab=selling', v_line.buyer_id);
        END IF;
      -- DA-12 (owner 2026-10-29): a free item whose 48 hours ran out goes back up with no strike for anyone.
      ELSIF v_line.price_cents = 0 THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'missed_checkout', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        IF FOUND THEN
          v_free_missed := v_free_missed + 1;
          UPDATE public.declutter_items SET status = 'live', updated_at = now()
           WHERE id = v_line.item_id AND status = 'reserved';
          PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'Free item went back up',
            format('You didn''t choose a pickup for "%s" within 48 hours, so it went back up. You get no strike.', v_line.title),
            '/declutter?tab=buying', v_line.seller_id);
          PERFORM public.declutter_notify(v_line.seller_id, 'declutter_sales', 'Free item is back up',
            format('The person getting "%s" didn''t choose a pickup within 48 hours, so it is back up. Nobody gets a strike.', v_line.title),
            '/declutter?tab=selling', v_line.buyer_id);
        END IF;
      -- DB-5 (owner 2026-10-30): Buy now goes straight to checkout, and backing out before paying is no strike.
      -- An accepted offer (source 'offer') still falls through to the strike below.
      ELSIF v_line.source = 'buy' THEN
        UPDATE public.declutter_orders SET status = 'expired', close_reason = 'missed_checkout', closed_at = now()
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET status = 'missed', closed_at = now()
         WHERE id = r.id AND status = 'in_cart';
        IF FOUND THEN
          v_buy_missed := v_buy_missed + 1;
          UPDATE public.declutter_items SET status = 'live', updated_at = now()
           WHERE id = v_line.item_id AND status = 'reserved';
          v_reopened := v_reopened + public.declutter_reopen_voided_offers(v_line.id);  -- BUY-1
          PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'Checkout closed',
            format('You didn''t pay for "%s" in time, so it went back up for sale. You were not charged and you get no strike.', v_line.title),
            '/declutter?tab=buying', v_line.seller_id);
          PERFORM public.declutter_notify(v_line.seller_id, 'new_offers', 'Buyer did not check out',
            format('The buyer did not pay for "%s" in time, so it is back up for sale.', v_line.title), '/declutter?tab=selling', v_line.buyer_id);
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
          v_reopened := v_reopened + public.declutter_reopen_voided_offers(v_line.id);  -- BUY-1
          IF public.feature_enabled_for_user('declutter', v_line.buyer_id) THEN
            -- BUY-1: "in time", since an accepted offer now has 24 hours (a line made before this has 48).
            PERFORM public.declutter_give_strike(v_line.buyer_id, 'buyer', 'missed_checkout', v_line.item_id,
              format('You did not check out "%s" in time.', v_line.title), v_line.id);
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
                            'ended_after_talk', v_talked, 'free_missed_without_strike', v_free_missed,
                            'buy_missed_without_strike', v_buy_missed,  -- DB-5
                            'offers_reopened', v_reopened);  -- BUY-1
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_deadline_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_deadline_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_handover_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  o public.declutter_orders;
  v_auto integer := 0;
  v_noshow integer := 0;
  v_sd_auto integer := 0;
  v_reminders integer := 0;
  v_unanswered integer := 0;
  v_nudged integer := 0;
  v_to_admin integer := 0;
  v_delivery boolean;
  v_closed boolean;
  a record;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_h integer;
BEGIN
  -- Shipping S2: a shipped order is never finished or closed here; it finishes on the USPS
  -- delivered scan + 48 h (S7), and never books a slot (declutter_bookings_not_delivery).
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery', 'ship') AND b.slot_start IS NOT NULL AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
       -- CHANGED (review of 7496d29c8b #3): a porch sale waits 24 hours from the later of the pickup time and the photo.
       AND (o2.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                               WHERE h.order_id = o2.id AND h.set_out_photo_path IS NOT NULL
                                                 AND h.set_out_at + interval '24 hours' <= now()))
       -- CHANGED (owner 10-30): never while the seller's 24 hours to answer run. A door or meeting-spot sale needs the
       -- seller's "Picked up", 24 hours old (declutter_sale_final's 24 hours follow: paid about 48 hours after it). If
       -- neither side says anything the money is held until someone does: no auto-pay, refund, strike or admin problem.
       AND NOT EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o2.id AND h.no_show_reported_at IS NOT NULL)
       AND (o2.handover = 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o2.id
                                              AND h.seller_confirmed_at + interval '24 hours' <= now()))
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery', 'ship')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL
                       AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now())
         AND NOT EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.no_show_reported_at IS NOT NULL)
         AND (o.handover = 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id
                                               AND h.seller_confirmed_at + interval '24 hours' <= now()))
         -- Porch (owner 2026-10-18): no "Left on porch" photo, no auto-pay.
         AND (o.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                                WHERE h.order_id = o.id AND h.set_out_photo_path IS NOT NULL
                                                  AND h.set_out_at + interval '24 hours' <= now())) THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; it is logged and retried next run.
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      LEFT JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery', 'ship') AND o2.paid_at + interval '7 days' <= now()
       AND (b.order_id IS NULL OR b.slot_start IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery', 'ship')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
        PERFORM public.declutter_close_paid_order(o.id, 'buyer_no_show', 'buyer', 'not_picked_up',
          'You did not pick up a paid Declutter item within 7 days. The item price was refunded.');
        v_noshow := v_noshow + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (c) Seller delivery: 24 h after the seller's "Delivered" (a photo, when left at the
  -- door) or "Handed over", unless a problem is open.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_seller_deliveries d ON d.order_id = o2.id
      JOIN public.declutter_handovers h ON h.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'seller_delivery' AND d.status = 'booked'
       AND d.delivered_at IS NOT NULL AND (d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)
       AND d.delivered_at + make_interval(hours => (v_rules ->> 'auto_confirm_hours')::integer) <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover = 'seller_delivery'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_handovers h JOIN public.declutter_seller_deliveries d ON d.order_id = h.order_id
                      WHERE h.order_id = o.id AND d.delivered_at IS NOT NULL AND (d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)
                        AND d.delivered_at + make_interval(hours => (v_rules ->> 'auto_confirm_hours')::integer) <= now()) THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_sd_auto := v_sd_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (d) Reminders before a booked delivery (24 h and 1 h, from the rules). One
  -- per run per order: the nearest one due; any earlier one not sent yet is
  -- marked sent too, so a late booking never gets "tomorrow" after "soon".
  FOR r IN
    SELECT d.order_id, d.buyer_id, d.seller_id, d.slot_start, d.dropoff_area, d.reminded_hours
      FROM public.declutter_seller_deliveries d
      JOIN public.declutter_orders o2 ON o2.id = d.order_id
     WHERE d.status = 'booked' AND o2.status = 'paid' AND d.slot_start > now()
       AND d.slot_start <= now() + make_interval(hours => (SELECT max(x::integer) FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x))
     ORDER BY d.slot_start LIMIT 500
  LOOP
    BEGIN
      -- CHANGED (20261031181404): lock the order first, as every other loop here does. The lock records this order
      -- for the notices below (declutter_notice_about), so "Delivery coming up" names THIS order's item; without it
      -- the setting still held the previous order the sweep locked (another order's item for the same pair, or none).
      -- The booking is re-read under the lock: a reminder another run already sent is not sent twice.
      o := public.declutter_lock_order(r.order_id);
      SELECT d.slot_start, d.reminded_hours INTO r.slot_start, r.reminded_hours
        FROM public.declutter_seller_deliveries d
       WHERE d.order_id = r.order_id AND d.status = 'booked' AND d.slot_start > now();
      IF o.status <> 'paid' OR NOT FOUND THEN
        v_h := NULL;
      ELSE
        SELECT min(x::integer) INTO v_h FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x
         WHERE r.slot_start <= now() + make_interval(hours => x::integer)
           AND NOT x::integer = ANY (r.reminded_hours);
      END IF;
      IF v_h IS NOT NULL THEN
        UPDATE public.declutter_seller_deliveries d
           SET reminded_hours = (SELECT array_agg(DISTINCT y ORDER BY y)
                                   FROM unnest(d.reminded_hours || ARRAY(SELECT x::integer FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x
                                                                         WHERE x::integer >= v_h)) y),
               updated_at = now()
         WHERE d.order_id = r.order_id;
        -- Q2465: strict, so a reminder that cannot be written rolls this block back (the reminded_hours mark with it)
        -- and the next run retries it.
        PERFORM public.declutter_notify_strict(r.seller_id, 'payment', 'Delivery coming up',
          format('You deliver to %s on %s.', r.dropoff_area, public.declutter_delivery_when(r.slot_start)),
          '/declutter?tab=selling', r.buyer_id);
        PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Delivery coming up',
          format('The seller delivers on %s.', public.declutter_delivery_when(r.slot_start)),
          '/declutter?view=cart', r.seller_id);
        v_reminders := v_reminders + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.order_id::text, SQLERRM);
    END;
  END LOOP;
  -- (e) CHANGED (owner 10-30): the buyer's no-show report, 24 hours on with no answer: refund + strike, as the one tap did.
  -- An open problem (the seller's answer, or either side's report) holds it; a problem taken back lets it run again.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_handovers h ON h.order_id = o2.id
     WHERE o2.status = 'paid' AND h.no_show_reported_at IS NOT NULL AND h.no_show_answer_by <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.no_show_answer_by <= now()) THEN
        PERFORM public.declutter_close_paid_order(o.id, 'seller_no_show', 'seller', 'seller_no_show',
          CASE WHEN o.handover = 'seller_delivery'
               THEN 'You did not deliver a booked Declutter order. The buyer got everything back, delivery included; the cost of that refund comes out of your next Declutter payout.'
               ELSE 'You did not show up for a booked Declutter pickup. The buyer got everything back; the cost of that refund comes out of your next Declutter payout.' END);
        v_unanswered := v_unanswered + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (f) CHANGED (lead and owner 10-30): a sale whose time has passed with nobody having said anything. The money stays
  -- held. Both are nudged 24 hours after the time, then weekly; at 60 days it goes to admin to decide, and no money moves.
  FOR r IN
    SELECT o2.id, o2.buyer_id, o2.seller_id, o2.handover, h.held_nudged_at,
           COALESCE(public.declutter_pickup_anchor(b.slot_start, b.pickup_day), d.slot_end) AS held_from
      FROM public.declutter_orders o2
      LEFT JOIN public.declutter_bookings b ON b.order_id = o2.id AND o2.handover IN ('pickup_home', 'meetup', 'porch')
      LEFT JOIN public.declutter_seller_deliveries d ON d.order_id = o2.id AND o2.handover = 'seller_delivery'
                                                     AND d.status = 'booked' AND d.delivered_at IS NULL
      LEFT JOIN public.declutter_handovers h ON h.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover IN ('pickup_home', 'meetup', 'porch', 'seller_delivery')
       AND COALESCE(public.declutter_pickup_anchor(b.slot_start, b.pickup_day), d.slot_end) + interval '24 hours' <= now()
       AND h.seller_confirmed_at IS NULL AND h.no_show_reported_at IS NULL AND h.set_out_at IS NULL
       AND (h.held_nudged_at IS NULL OR h.held_nudged_at + interval '7 days' <= now()
            OR COALESCE(public.declutter_pickup_anchor(b.slot_start, b.pickup_day), d.slot_end) + interval '60 days' <= now())
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
       -- Owner rule: test data never reaches a member or admin.
       AND o2.is_seed IS NOT TRUE
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id IN (o2.buyer_id, o2.seller_id))
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id IN (o2.buyer_id, o2.seller_id) AND pr.is_seed)
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      CONTINUE WHEN o.status <> 'paid';
      v_delivery := r.handover = 'seller_delivery';
      IF r.held_from + interval '60 days' <= now() THEN
        -- Once: if an admin's problem was ever opened here, someone has already looked.
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.reporter_side = 'system');
        INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
        VALUES (o.id, NULL, 'system', 'other',
                'Nobody has said anything about this handover for 60 days, so the money is still held. Neither side confirmed it or reported a problem. Decide who gets the money.',
                '{}');
        PERFORM public.declutter_notify(o.buyer_id, 'declutter_refunds', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until Louisiana Helpr decides. You can add your side on the order.',
          '/declutter?tab=buying', o.seller_id);
        PERFORM public.declutter_notify(o.seller_id, 'declutter_refunds', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until Louisiana Helpr decides. You can add your side on the order.',
          '/declutter?tab=selling', o.buyer_id);
        -- A cron has no caller for the gate to read, so test data is skipped here too (20261030150104's rule).
        IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
          FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
            PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter sale held 60 days',
              'Nobody has confirmed a paid handover for 60 days. The money is held until you decide it.', '/admin');
          END LOOP;
        END IF;
        v_to_admin := v_to_admin + 1;
      ELSE
        UPDATE public.declutter_handovers SET held_nudged_at = now() WHERE order_id = o.id;
        IF NOT FOUND THEN
          INSERT INTO public.declutter_handovers (order_id, code, held_nudged_at)
          VALUES (o.id, public.declutter_new_handover_code(), now());
        END IF;
        v_closed := public.declutter_held_address_closed(o.id);
        -- The member's own Pickups switch: off means none of this.
        IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = o.buyer_id AND np.declutter_pickups IS FALSE) THEN
          PERFORM public.declutter_pickup_remind(o.buyer_id,
            CASE WHEN v_delivery THEN 'Did your delivery come?' ELSE 'Did you get your item?' END,
            'If you have it, tap "I got it" in Buying. If not, report it there.'
              || CASE WHEN o.paid_with = 'free' THEN '' ELSE ' Your money stays held until one of you says.' END
              || CASE WHEN v_closed THEN ' The pickup address has closed, so ask the seller in your messages.' ELSE '' END,
            '/declutter?tab=buying', o.seller_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = o.seller_id AND np.declutter_pickups IS FALSE) THEN
          PERFORM public.declutter_pickup_remind(o.seller_id,
            CASE WHEN v_delivery THEN 'Did you make this delivery?' ELSE 'Did the buyer get this item?' END,
            CASE WHEN v_delivery THEN 'If you delivered it, mark it delivered in Selling.'
                 WHEN r.handover = 'porch' THEN 'If it''s out, post the porch photo in Selling.'
                 ELSE 'If they have it, tap "Picked up" in Selling.' END
              || CASE WHEN o.paid_with = 'free' THEN '' ELSE ' You aren''t paid until one of you says.' END,
            '/declutter?tab=selling', o.buyer_id);
        END IF;
        v_nudged := v_nudged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('auto_paid', v_auto, 'not_picked_up', v_noshow,
                            'delivery_auto_paid', v_sd_auto, 'delivery_reminders', v_reminders,
                            'no_show_unanswered', v_unanswered, 'held_nudged', v_nudged, 'held_to_admin', v_to_admin);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_handover_sweep() TO service_role;
