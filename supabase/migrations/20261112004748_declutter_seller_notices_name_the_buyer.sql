-- F356 follow-up, part 2 (owner pop-ups 11-11 ~5:00 PM "everywhere"; lead 11-11: these count): more of the seller's
-- Declutter notices about a buyer name them as first name + last initial (member_display_name, "Ann S."), as the offer
-- card (20261111223500), the offer notices (20261112003050) and the trade cards (20261112004253) do. Only the name.
--   declutter_request_bundle  Bundle request          'Ann S. wants 3 of your items ($45.00 in all). Accept all or pick
--                                                      some within 48 hours.'          (was 'A buyer wants ...')
--   declutter_deadline_sweep  Offer expired (seller)  'Ann S. did not answer your counteroffer on "Lamp" within 48 hours,
--                                                      so it closed.'                  (was 'The buyer did not ...')
--                                                     'You did not answer Ann S.'s offer on "Lamp" within 48 hours, so it
--                                                      closed.'                        (was 'You did not answer an offer ...')
--   declutter_take_item       Someone claimed your free item  'Ann S. claimed "Lamp". They have 48 hours to choose a
--                                                      pickup.'                        (was '"Lamp" was claimed. The buyer ...')
--                             Someone's buying your item (Buy now)  'Ann S. is checking out "Lamp" for $40.00. ...'
--                                                      (was 'Someone is checking out ...')
--                             Someone's buying your item (offer / cart)  '"Lamp" is held for Ann S. at $40.00. ...'
--                                                      (was '... held for the buyer at ...')
-- The TITLES are unchanged (declutter_notice_type maps notice kinds by title). Each falls back to the old words when the
-- buyer has no name (blank or gone account). A Wanted thread (declutter_offers.wanted_id set) stays anonymous: the
-- sweep's name is NULL for it, and take_item names nobody for an offer answering a Wanted post. Buyer-facing notices,
-- links, types, actors, status changes, checks and locks are unchanged. Not changed (not seller notices about a
-- named buyer move, or out of this scope): the sweep's 'Buyer did not check out', 'Sale ended, no strike' and
-- 'Free item is back up' seller notices still say "the buyer" / "the person".
--
-- Bodies VERBATIM from their newest definitions, changes marked "CHANGED 20261112004748":
--   declutter_request_bundle  20261104103528_declutter_bundle_request.sql
--   declutter_deadline_sweep  20261108195151_declutter_trades_fixes.sql
--   declutter_take_item       20261110223800_declutter_reserved_notice_names_the_deadline.sql
-- Replay-safe: CREATE OR REPLACE of the same signatures keeps their grants.
-- Proof: src/test/pglite/declutterSellerNoticesNameTheBuyer.pglite.mjs. Sensitive: authz (what one member sees of another).

CREATE OR REPLACE FUNCTION public.declutter_request_bundle(p_item_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_ids uuid[];
  v_item_id uuid;
  v_item record;
  v_seller uuid;
  v_id uuid;
  v_seed boolean := false;
  v_total integer := 0;
  v_buyer text; -- CHANGED 20261112004748: "Ann S.", the buyer as the seller's offer card shows them; NULL = no name.
BEGIN
  -- Q281 ban gate (lander 11-04): a banned account cannot ask for, or answer, a bundle (the same refusal as declutter_request_free).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter');
  v_uid := public.declutter_assert_member(false);
  -- Review 11-04 (blocker): the first-purchase ID check is the buyer's, so it runs at the ask. At the answer the
  -- seller is the caller and the gate (rightly) skips a row for someone else, so without this an unverified buyer
  -- could have up to 20 items held for them.
  PERFORM public.declutter_identity_gate(v_uid, 'identity_required_to_buy');
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_item_ids) x WHERE x IS NOT NULL;
  IF coalesce(cardinality(v_ids), 0) < 2 OR cardinality(v_ids) > 20 THEN
    RAISE EXCEPTION 'bundle_size' USING ERRCODE = '22023', HINT = 'Pick 2 to 20 items from one seller.';
  END IF;

  -- Locked in id order, so two requests over the same items never deadlock.
  FOREACH v_item_id IN ARRAY v_ids LOOP
    SELECT * INTO v_item FROM public.declutter_lock_buyable_item(v_item_id, v_uid);
    IF v_seller IS NULL THEN
      v_seller := v_item.o_seller_id;
    ELSIF v_seller <> v_item.o_seller_id THEN
      RAISE EXCEPTION 'bundle_one_seller' USING ERRCODE = '22023', HINT = 'A bundle request is for one seller''s items.';
    END IF;
    IF v_item.o_price_cents IS NULL OR v_item.o_price_cents < 100 THEN
      RAISE EXCEPTION 'bundle_free_item' USING ERRCODE = '22023', HINT = 'Free items are claimed on their own.';
    END IF;
  END LOOP;

  -- A request past its 48 hours is closed here too, so an unswept one never blocks a new ask.
  UPDATE public.declutter_bundle_requests SET status = 'expired', closed_at = now()
   WHERE buyer_id = v_uid AND seller_id = v_seller AND status = 'open' AND respond_by <= now();
  IF EXISTS (SELECT 1 FROM public.declutter_bundle_requests r
              WHERE r.buyer_id = v_uid AND r.seller_id = v_seller AND r.status = 'open') THEN
    RAISE EXCEPTION 'bundle_already_open'
      USING ERRCODE = '55000', HINT = 'You already asked this seller. Wait for their answer or take it back.';
  END IF;
  IF (SELECT count(*) FROM public.declutter_bundle_requests r
       WHERE r.buyer_id = v_uid AND r.seller_id = v_seller AND r.created_at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'bundle_rate_limited' USING ERRCODE = '54000', HINT = 'You can ask one seller 3 times a day.';
  END IF;

  SELECT bool_or(i.is_seed), sum(i.current_price_cents) INTO v_seed, v_total
    FROM public.declutter_items i WHERE i.id = ANY (v_ids);

  INSERT INTO public.declutter_bundle_requests (buyer_id, seller_id, respond_by, is_seed)
  VALUES (v_uid, v_seller, now() + interval '48 hours', coalesce(v_seed, false))
  RETURNING id INTO v_id;
  INSERT INTO public.declutter_bundle_request_items (request_id, item_id, price_cents)
  SELECT v_id, i.id, i.current_price_cents FROM public.declutter_items i WHERE i.id = ANY (v_ids);

  -- CHANGED 20261112004748 (owner 11-11): the seller's notice names the buyer, first name + last initial; the old words without a name.
  SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer FROM public.profiles bp WHERE bp.user_id = v_uid;
  PERFORM public.declutter_notify(v_seller, 'new_offers', 'Bundle request',
    format('%s wants %s of your items ($%s in all). Accept all or pick some within 48 hours.',
           COALESCE(v_buyer, 'A buyer'), cardinality(v_ids), to_char(v_total / 100.0, 'FM999990.00')),
    '/declutter?tab=selling', v_uid);
  RETURN v_id;
END;
$function$;

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
      (SELECT i.title FROM public.declutter_items i WHERE i.id = o.item_id) AS title,
      -- CHANGED 20261112004748: the buyer's "Ann S." for the seller's notice; NULL on a Wanted thread (wanted_id set) or with no name.
      CASE WHEN o.wanted_id IS NULL
           THEN (SELECT public.member_display_name(bp.full_name, NULL) FROM public.profiles bp WHERE bp.user_id = o.buyer_id) END AS buyer_name
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
           -- CHANGED 20261112004748 (owner 11-11): with a name, the seller reads who it was.
           WHEN r.awaiting = 'seller' AND r.buyer_name IS NOT NULL
             THEN format('You did not answer %s''s offer on "%s" within 48 hours, so it closed.', r.buyer_name, r.title)
           WHEN r.awaiting = 'seller' THEN format('You did not answer an offer on "%s" within 48 hours, so it closed.', r.title)
           ELSE format('%s did not answer your counteroffer on "%s" within 48 hours, so it closed.', COALESCE(r.buyer_name, 'The buyer'), r.title) END,
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
          -- CHANGED (trades #4): money offers a $0 hold voided (a trade line's) reopen; a no-op for a real free item.
          v_reopened := v_reopened + public.declutter_reopen_voided_offers(v_line.id);
          -- CHANGED (trades #2): a trade line sends no free-item notice; the whole trade ends now, told once.
          IF v_line.swap_id IS NOT NULL THEN
            PERFORM public.declutter_end_swap(v_line.swap_id, NULL);
          ELSE
          PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'Free item went back up',
            format('You didn''t choose a pickup for "%s" within 48 hours, so it went back up. You get no strike.', v_line.title),
            '/declutter?tab=buying', v_line.seller_id);
          PERFORM public.declutter_notify(v_line.seller_id, 'declutter_sales', 'Free item is back up',
            format('The person getting "%s" didn''t choose a pickup within 48 hours, so it is back up. Nobody gets a strike.', v_line.title),
            '/declutter?tab=selling', v_line.buyer_id);
          END IF;
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
  -- F481 (audit 11-10 W6): the hold's deadline, said as a clock time ("Wed, Nov 11 at 2:00 PM").
  v_by timestamptz;
  v_by_words text;
  v_buyer text; -- CHANGED 20261112004748: "Ann S." on the seller's notice; NULL with no name or for an offer answering a Wanted post.
BEGIN
  IF EXISTS (SELECT 1 FROM public.declutter_items WHERE id = p_item_id AND is_seed)
     AND public.seed_hidden_for(p_buyer) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
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

  -- BUY-1 (owner 10-31): Buy now holds 30 minutes, an accepted offer 24 hours to pay; a free claim keeps its 48 hours.
  -- The line is made BEFORE the other offers are voided, so each voided offer records the hold that voided it.
  INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, offer_id, checkout_by)
  VALUES (p_item_id, p_buyer, v_seller, p_price, p_source, p_offer_id, now() + public.declutter_hold_length(p_price, p_source))
  RETURNING id, checkout_by INTO v_line, v_by;
  v_by_words := public.continue_day_label((v_by AT TIME ZONE 'America/Chicago')::date, (v_by AT TIME ZONE 'America/Chicago')::time);

  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now(), voided_by_line = v_line
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    -- BUY-1: if this hold runs out unpaid the offer opens again (declutter_reopen_voided_offers).
    PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Item on hold for another buyer',
      format('"%s" is on hold for another buyer, so your offer is closed for now. If they don''t pay in time, it opens again. Nothing was charged.', v_title),
      '/declutter/item/' || p_item_id::text, v_seller);
  END LOOP;

  -- Q2731 (Q2268 money review 11-04): a bundle answer (declutter_answer_bundle) sends ONE notice to each side for the
  -- whole bundle, so these per-item "reserved" / "sold" notices are skipped while it takes its items (the
  -- transaction-local setting declutter.bundle_take, which only that function sets). The voided-offer notices above
  -- still go to every other buyer.
  IF coalesce(current_setting('declutter.bundle_take', true), '') <> 'on' THEN
    -- CHANGED 20261112004748 (owner 11-11 "everywhere"): the seller's notice names the buyer, except on a Wanted thread.
    IF p_offer_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_offers wo WHERE wo.id = p_offer_id AND wo.wanted_id IS NOT NULL) THEN
      SELECT public.member_display_name(bp.full_name, NULL) INTO v_buyer FROM public.profiles bp WHERE bp.user_id = p_buyer;
    END IF;
    IF p_price = 0 THEN
      -- A free claim (20261027170717): the same 48 hours, nothing to pay.
      -- DA-12: no strike for letting the 48 hours run out on a free item; it just goes back up.
      PERFORM public.declutter_notice_ref(v_line); -- Q2659
      PERFORM public.declutter_notify(p_buyer, 'payment', 'It''s yours: pick a pickup time',
        format('"%s" is free and held for you. Choose how you''ll pick it up within 48 hours or it goes back up. %s',
               v_title, public.declutter_free_hold_charge_words(p_buyer)),
        '/declutter?view=cart', v_seller);
      PERFORM public.declutter_notify(v_seller, 'new_offers', 'Someone claimed your free item',
        CASE WHEN v_buyer IS NOT NULL
          THEN format('%s claimed "%s". They have 48 hours to choose a pickup.', v_buyer, v_title)
          ELSE format('"%s" was claimed. The buyer has 48 hours to choose a pickup.', v_title) END,
        '/declutter?view=selling', p_buyer);
    ELSIF p_source = 'buy' THEN
      -- DB-5 (owner 2026-10-30): Buy now goes straight to checkout; not paying is no strike, the item just goes back up.
      PERFORM public.declutter_notice_ref(v_line); -- Q2659
      PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved: check out within 30 minutes',
        format('"%s" is held for you at checkout for %s. Pay within 30 minutes or it goes back up for sale. Your card is not charged until you pay.',
               v_title, v_price),
        '/declutter?view=cart', v_seller);
      PERFORM public.declutter_notice_ref(v_line); -- Q2659
      -- M1 (audit 11-08): not "Sold" until the payment lands; the buyer can still back out with no strike.
      PERFORM public.declutter_notify(v_seller, 'declutter_sales', 'Someone''s buying your item',
        format('%s is checking out "%s" for %s. It''s held for them for 30 minutes. We''ll tell you when they pay.',
               COALESCE(v_buyer, 'Someone'), v_title, v_price),
        '/declutter?view=selling', p_buyer);
    ELSE
    -- Owner's wording (2026-10-28, via the lead): reserved, not paid yet.
    -- B110 (owner 11-01, lead copy): an accepted offer says who accepted it and what to do next.
    PERFORM public.declutter_notice_ref(v_line); -- Q2659
    PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved for you: check out in 24 hours',
      CASE WHEN p_offer_id IS NOT NULL THEN
        format('%s accepted your %s offer for "%s". Check out by %s to keep it: choose pickup or delivery, pick a day and time, and pay. Your card is not charged until you check out. If you miss it, the item goes back up for sale and that counts as a strike.',
               COALESCE((SELECT public.member_display_name(p.full_name, 'The seller') FROM public.profiles p WHERE p.user_id = v_seller), 'The seller'),
               v_price, v_title, v_by_words)
      ELSE
      format('"%s" is in your cart for %s. Check out by %s to keep it. Your card is not charged until you check out. If you miss it, the item goes back up for sale and that counts as a strike.',
             v_title, v_price, v_by_words) END,
      '/declutter?view=cart', v_seller);
    PERFORM public.declutter_notice_ref(v_line); -- Q2659
    -- M1 (audit 11-08): not "Sold" until the payment lands.
    PERFORM public.declutter_notify(v_seller, 'declutter_sales', 'Someone''s buying your item',
      format('"%s" is held for %s at %s. They have 24 hours to check out and pay. We''ll tell you when they pay.',
             v_title, COALESCE(v_buyer, 'the buyer'), v_price),
      '/declutter?view=selling', p_buyer);
    END IF;
  END IF;
  RETURN v_line;
END;
$function$;
