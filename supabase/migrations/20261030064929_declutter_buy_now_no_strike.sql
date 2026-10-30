-- Buy now never gives a strike for not paying (Declutter audit DB-5; owner 2026-10-30: "Buy now goes straight to
-- checkout, with no strike for backing out before paying").
--
-- BROKEN: tapping Buy now reserved the item for 48 hours and, if the buyer did not pay in time, the deadline sweep
-- gave them a missed_checkout strike. The app now takes Buy now straight to that seller's checkout; a buyer who
-- backs out there (closes the payment page and never pays) is backing out before paying, which the owner said is
-- not a strike.
--
-- FIX (a Buy now line is a cart line with source = 'buy'; an accepted offer is source = 'offer' and keeps its strike;
-- a free claim is source = 'buy' with price 0 and is already handled by DA-12 above it):
--   1. declutter_deadline_sweep: a paid-for Buy now line whose 48 hours run out goes back up for sale with no strike
--      for anyone (new counter buy_missed_without_strike); its 24 h and 2 h reminders no longer threaten a strike.
--   2. declutter_take_item: the Buy now notice says the item goes back up, not that a strike follows.
--   3. declutter_my_cart: returns each line's source, so the cart can say "No strike" for Buy now lines and keep the
--      strike words only where an accepted offer still carries one. The hold itself (48 h, reserved) is unchanged:
--      checkout needs the reserved line, and a second item from the same seller still shares the checkout.
-- Removing a Buy now line from the cart was already strike-free (declutter_remove_cart_item, 20261028221904, A2-8).
--
-- RESTATED FROM: declutter_deadline_sweep and declutter_take_item from 20261030063015_declutter_free_no_strike_for_48h
-- (B85, DA-12; not on main yet, this branch is stacked on it), which restated them from prod; prod still matches
-- what DA-12 read (md5 of pg_get_functiondef 2026-10-30: sweep aad21c03b9a82185e0138cf4d68be556, take_item
-- 9098bd282557f017f6d30b092569f470). declutter_my_cart from prod pg_get_functiondef (md5
-- 33f617afb43edbfd5651794690267663; newest in the repo: 20261028235247_declutter_handover_choices.sql). Each change
-- is marked "DB-5". Grants restated to prod's proacl (sweep and take_item: service_role only; my_cart:
-- authenticated and service_role).
-- MONEY: no amount changes; this only decides who gets a strike and what notices say.
-- REPLAY-SAFE: CREATE OR REPLACE; DROP FUNCTION IF EXISTS for my_cart, whose row type gains a column.
-- Proof: src/test/pglite/declutterBuyNowNoStrike.pglite.mjs (3x).

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
    RETURNING c.buyer_id, c.price_cents, c.source, (SELECT i.title FROM public.declutter_items i WHERE i.id = c.item_id) AS title
  LOOP
    v_r24 := v_r24 + 1;
    -- 20261029025838: the reminder names its item and opens the buyer's own tab.
    IF r.price_cents = 0 THEN
      -- DA-12: a free item has no strike to threaten.
      PERFORM public.declutter_notify(r.buyer_id, 'declutter_sales', 'Choose a pickup within 24 hours',
        CASE WHEN r.title IS NULL THEN 'Your free item is held for you. Choose how you''ll pick it up within 24 hours or it goes back up.'
             ELSE format('"%s" is held for you. Choose how you''ll pick it up within 24 hours or it goes back up.', r.title) END,
        '/declutter?tab=buying');
    ELSIF r.source = 'buy' THEN
      -- DB-5: a Buy now line has no strike to threaten either.
      PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Check out within 24 hours',
        CASE WHEN r.title IS NULL THEN 'You have an item waiting at checkout. Pay within 24 hours or it goes back up for sale.'
             ELSE format('"%s" is waiting at checkout. Pay within 24 hours or it goes back up for sale.', r.title) END,
        '/declutter?tab=buying');
    ELSE
    PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Check out within 24 hours',
      CASE WHEN r.title IS NULL THEN 'You have an item waiting in your cart. Check out within 24 hours or you get a strike.'
           ELSE format('"%s" is waiting in your cart. Check out within 24 hours or you get a strike.', r.title) END,
      '/declutter?tab=buying');
    END IF;
  END LOOP;
  FOR r IN
    UPDATE public.declutter_cart_items c SET reminded_2h_at = now()
     WHERE c.status = 'in_cart' AND c.reminded_2h_at IS NULL
       AND c.checkout_by > now() AND c.checkout_by <= now() + interval '2 hours'
       -- 20261028235249: not while the buyer and seller are talking the handover through.
       AND NOT public.declutter_pair_talking(c.buyer_id, c.seller_id)
    RETURNING c.buyer_id, c.price_cents, c.source, (SELECT i.title FROM public.declutter_items i WHERE i.id = c.item_id) AS title
  LOOP
    v_r2 := v_r2 + 1;
    -- 20261029025838: the reminder names its item and opens the buyer's own tab.
    IF r.price_cents = 0 THEN
      -- DA-12: a free item has no strike to threaten.
      PERFORM public.declutter_notify(r.buyer_id, 'declutter_sales', '2 hours left to choose a pickup',
        CASE WHEN r.title IS NULL THEN 'Choose how you''ll pick up your free item in the next 2 hours or it goes back up.'
             ELSE format('Choose how you''ll pick up "%s" in the next 2 hours or it goes back up.', r.title) END,
        '/declutter?tab=buying');
    ELSIF r.source = 'buy' THEN
      -- DB-5: a Buy now line has no strike to threaten either.
      PERFORM public.declutter_notify(r.buyer_id, 'payment', '2 hours left to check out',
        CASE WHEN r.title IS NULL THEN 'Pay in the next 2 hours or the item goes back up for sale.'
             ELSE format('Pay for "%s" in the next 2 hours or it goes back up for sale.', r.title) END,
        '/declutter?tab=buying');
    ELSE
    PERFORM public.declutter_notify(r.buyer_id, 'payment', '2 hours left to check out',
      CASE WHEN r.title IS NULL THEN 'Check out in the next 2 hours or you get a strike and the item goes back up for sale.'
           ELSE format('Check out "%s" in the next 2 hours or you get a strike and it goes back up for sale.', r.title) END,
      '/declutter?tab=buying');
    END IF;
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
          PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'Checkout closed',
            format('You didn''t pay for "%s" within 48 hours, so it went back up for sale. You were not charged and you get no strike.', v_line.title),
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
                            'ended_after_talk', v_talked, 'free_missed_without_strike', v_free_missed,
                            'buy_missed_without_strike', v_buy_missed);  -- DB-5
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_deadline_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_deadline_sweep() TO service_role;

-- The claim notice no longer threatens a strike either. declutter_take_item restated from the EFFECTIVE prod
-- definition (pg_get_functiondef 2026-10-30 00:58 CDT, md5 9098bd282557f017f6d30b092569f470). One change, marked
-- "DA-12": the free claimer's notice says the item goes back up, with no strike.
CREATE OR REPLACE FUNCTION public.declutter_take_item(p_item_id uuid, p_buyer uuid, p_price integer, p_source text, p_offer_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_seller uuid;
  v_title text;
  v_line uuid;
  v_price text := public.declutter_price_text(p_price);
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.declutter_items WHERE id = p_item_id AND is_seed)
     AND public.seed_hidden_for(p_buyer) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.declutter_items
     SET status = 'reserved', updated_at = now()
   WHERE id = p_item_id AND status = 'live'
  RETURNING seller_id, title INTO v_seller, v_title;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_available'
      USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;

  IF p_offer_id IS NOT NULL THEN
    UPDATE public.declutter_offers
       SET status = 'accepted', closed_at = now(), updated_at = now()
     WHERE id = p_offer_id AND item_id = p_item_id AND status = 'open';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'offer_not_open' USING ERRCODE = '55000';
    END IF;
  END IF;

  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item no longer available',
      format('"%s" went to another buyer, so your offer is closed. Nothing was charged.', v_title),
      '/declutter/item/' || p_item_id::text, v_seller);
  END LOOP;

  INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, offer_id, checkout_by)
  VALUES (p_item_id, p_buyer, v_seller, p_price, p_source, p_offer_id, now() + interval '48 hours')
  RETURNING id INTO v_line;

  IF p_price = 0 THEN
    -- A free claim (20261027170717): the same 48 hours, nothing to pay.
    -- DA-12: no strike for letting the 48 hours run out on a free item; it just goes back up.
    PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: pick a pickup within 48 hours',
      format('"%s" is free and held for you. Choose how you''ll pick it up within 48 hours or it goes back up. Nothing is charged.',
             v_title),
      '/declutter?view=cart', v_seller);
    PERFORM public.declutter_notify(v_seller, 'new_offers', 'Someone claimed your free item',
      format('"%s" was claimed. The buyer has 48 hours to choose a pickup.', v_title),
      '/declutter?view=selling', p_buyer);
  ELSIF p_source = 'buy' THEN
    -- DB-5 (owner 2026-10-30): Buy now goes straight to checkout; not paying is no strike, the item just goes back up.
    PERFORM public.declutter_notify(p_buyer, 'payment', 'Reserved for you: check out within 48 hours',
      format('"%s" is held for you at checkout for %s. Pay within 48 hours or it goes back up for sale. Your card is not charged until you pay.',
             v_title, v_price),
      '/declutter?view=cart', v_seller);
    PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',
      format('"%s" sold for %s. The buyer has 48 hours to check out and pay.', v_title, v_price),
      '/declutter?view=selling', p_buyer);
  ELSE
  -- Owner's wording (2026-10-28, via the lead): reserved, not paid yet.
  PERFORM public.declutter_notify(p_buyer, 'payment', 'Reserved for you: check out within 48 hours',
    format('"%s" is in your cart for %s. Check out within 48 hours or you get a strike and it goes back up for sale. Your card is not charged until you check out.',
           v_title, v_price),
    '/declutter?view=cart', v_seller);
  PERFORM public.declutter_notify(v_seller, 'new_offers', 'Sold: waiting for the buyer to pay',
    format('"%s" sold for %s. The buyer has 48 hours to check out and pay.', v_title, v_price),
    '/declutter?view=selling', p_buyer);
  END IF;
  RETURN v_line;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_take_item(uuid, uuid, integer, text, uuid) TO service_role;

-- DB-5: the cart reads each line's source ('buy' = Buy now or a free claim, 'offer' = an accepted offer), so it can
-- say which lines still carry a strike. Restated from prod (md5 33f617afb43edbfd5651794690267663); the one change is
-- the trailing source column. The row type changes, so the function is dropped first.
DROP FUNCTION IF EXISTS public.declutter_my_cart();
CREATE OR REPLACE FUNCTION public.declutter_my_cart()
 RETURNS TABLE(line_id uuid, item_id uuid, item_title text, my_side text, seller_id uuid, price_cents integer, status text, checkout_by timestamp with time zone, order_id uuid, order_status text, handover text, premium_cents integer, total_cents integer, porch_ok boolean, delivery_cents integer, delivery_task_id uuid, handovers text[], source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.item_id, COALESCE(i.title, 'An item from a former member'),
         CASE WHEN c.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         -- Q2427: a line still in the cart shows its original price (a bundle discount is applied at checkout).
         c.seller_id, CASE WHEN c.status = 'in_cart' THEN COALESCE(c.list_price_cents, c.price_cents) ELSE c.price_cents END,
         c.status, c.checkout_by, c.order_id,
         o.status, o.handover, o.premium_cents, o.total_cents,
         COALESCE(i.porch_ok, false), o.delivery_cents, od.task_id, i.handovers,
         c.source  -- DB-5
    FROM public.declutter_cart_items c
    LEFT JOIN public.declutter_items i ON i.id = c.item_id
    LEFT JOIN public.declutter_orders o ON o.id = c.order_id
    LEFT JOIN public.declutter_order_deliveries od ON od.order_id = o.id
   WHERE (c.buyer_id = v_uid OR c.seller_id = v_uid)
     AND (c.status = 'in_cart' OR c.created_at > now() - interval '30 days')
   ORDER BY (c.status = 'in_cart') DESC, c.checkout_by
   LIMIT 200;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_my_cart() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_cart() TO authenticated, service_role;
