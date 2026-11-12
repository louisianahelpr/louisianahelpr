-- S033 (Shops audit 11-12, Low, legal): the home-food yearly limit let an order bring sales to EXACTLY $100,000 (">").
-- La. R.S. 40:4.9(B) (Act 801 of 2026): the cottage-food exemption applies only while gross annual sales stay under
-- $100,000; it ends when they "equal $100,000 or more". So the accept and the preorder hold now refuse an order that
-- would bring the year's home-food sales to the limit or past it (">="), matching shop_cottage_cap_reached (">=").
-- shops_accept_order RESTATED from 20261106165310_shops_item_variants.sql and shop_mark_order_held RESTATED from
-- 20261112073633_shops_audit_highs.sql (newest CREATEs); only the one comparison in each changes.
-- MONEY: who can be charged (lh-money-escrow). AUTHZ: none (CREATE OR REPLACE keeps grants). REPLAY-SAFE.
-- Proof: src/test/pglite/shopsCottageLimitStrict.pglite.mjs (3x; NEW_MIGRATION=skip red).

CREATE OR REPLACE FUNCTION public.shops_accept_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_cap smallint;
  l record;
  v_block text;
  v_home_food bigint;
  v_cottage_cap bigint;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'accepted' THEN
    -- A retry after the capture step failed to answer: the edge function captures again (idempotent).
    -- Not re-checked for a block made since: the order was accepted (hired) before it, as for every hire.
    RETURN jsonb_build_object('result', 'already_accepted', 'order_id', o.id, 'captured', o.captured_at IS NOT NULL);
  END IF;
  IF o.status <> 'held' THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000', HINT = 'This order is no longer waiting for an answer.';
  END IF;
  IF now() > o.accept_by THEN
    RAISE EXCEPTION 'order_expired' USING ERRCODE = '55000', HINT = 'The 24 hours to accept have passed.';
  END IF;
  -- The maker must be able to be paid at handover (L3: payout setup) and in good standing.
  v_block := public.shop_owner_sell_block_reason(v_uid);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION '%', v_block USING ERRCODE = '42501';
  END IF;
  -- The buyer must still be able to buy from this maker (a block or a ban
  -- since the order was sent): the maker declines instead, and the hold drops.
  -- A block is refused on its own, before any write, with the code every hire
  -- RPC uses (Q345, hireRefusedAcrossBlock; its words never say who blocked).
  IF public.are_users_blocked(v_uid, o.buyer_id) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501',
      HINT = 'This order can no longer be accepted. Decline it so the buyer''s hold is released.';
  END IF;
  IF o.buyer_id IS NULL OR EXISTS (
       SELECT 1 FROM public.profiles pr
        WHERE pr.user_id = o.buyer_id
          AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
          AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now())) THEN
    RAISE EXCEPTION 'buyer_unavailable' USING ERRCODE = '55000',
      HINT = 'This order can no longer be accepted. Decline it so the buyer''s hold is released.';
  END IF;
  -- Every accept of this shop is serialized on the shop row (FOR UPDATE), so
  -- two accepts at once cannot both take the day's last slot (L22) or both
  -- fit under the home-food yearly limit (L8). Only accepted orders count now.
  SELECT daily_order_cap INTO v_cap FROM public.shops WHERE id = o.shop_id FOR UPDATE;
  -- A shop Louisiana Helpr hid takes no money (lh-authz-rls review, 2026-10-18).
  IF EXISTS (SELECT 1 FROM public.shops WHERE id = o.shop_id AND hidden_at IS NOT NULL) THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501',
      HINT = 'Louisiana Helpr hid your shop, so it cannot accept orders. Decline them so the buyers'' holds are released.';
  END IF;
  IF v_cap IS NOT NULL AND public.shop_day_count(v_uid, o.ready_date, ARRAY['accepted', 'handed_over']) >= v_cap THEN
    RAISE EXCEPTION 'day_full' USING ERRCODE = '55000', HINT = 'You already accepted your most orders for that day.';
  END IF;
  -- L8 at acceptance: sales already counted + accepted orders not yet charged
  -- + this order's home-food lines must stay within the yearly limit.
  SELECT COALESCE(sum(line_cents), 0) INTO v_home_food FROM public.shop_order_lines
   WHERE order_id = o.id AND kind = 'home_food';
  IF v_home_food > 0 THEN
    SELECT c.cap_cents INTO v_cottage_cap FROM public.shop_cottage_settings c WHERE c.id;
    IF v_cottage_cap IS NULL OR public.shop_cottage_sales_cents(v_uid)
         + (SELECT COALESCE(sum(ol.line_cents), 0) FROM public.shop_orders x
              JOIN public.shop_order_lines ol ON ol.order_id = x.id AND ol.kind = 'home_food'
             WHERE x.seller_id = v_uid AND x.status = 'accepted' AND x.captured_at IS NULL AND x.id <> o.id)
         -- S033 (Shops audit 11-12): the exemption ends when sales "equal $100,000 or more" (La. R.S. 40:4.9(B), Act 801
         -- of 2026), so an order may only bring the year's home-food sales to just under the limit, never to it.
         + v_home_food >= v_cottage_cap THEN
      RAISE EXCEPTION 'cottage_limit_reached' USING ERRCODE = '55000',
        HINT = 'Accepting this order would go over your yearly home-food sales limit. Decline it so the buyer''s hold is released.';
    END IF;
  END IF;
  -- L20: stock is taken at acceptance, items locked in id order (no deadlock between two accepts).
  FOR l IN
    SELECT ol.item_id, ol.quantity, i.stock_count, i.title
      FROM public.shop_order_lines ol JOIN public.shop_items i ON i.id = ol.item_id
     WHERE ol.order_id = o.id
     ORDER BY ol.item_id
       FOR UPDATE OF i
  LOOP
    IF l.stock_count IS NOT NULL AND l.stock_count < l.quantity THEN
      RAISE EXCEPTION 'out_of_stock' USING ERRCODE = '55000',
        HINT = format('You have %s of "%s" left; this order needs %s.', l.stock_count, l.title, l.quantity);
    END IF;
  END LOOP;
  -- Variants: each combination's own stock, locked in id order after the items.
  FOR l IN
    SELECT ol.variant_id, ol.quantity, v.stock_count, ol.title
      FROM public.shop_order_lines ol JOIN public.shop_item_variants v ON v.id = ol.variant_id
     WHERE ol.order_id = o.id
     ORDER BY ol.variant_id
       FOR UPDATE OF v
  LOOP
    IF l.stock_count IS NOT NULL AND l.stock_count < l.quantity THEN
      RAISE EXCEPTION 'out_of_stock' USING ERRCODE = '55000',
        HINT = format('You have %s of "%s" left; this order needs %s.', l.stock_count, l.title, l.quantity);
    END IF;
  END LOOP;
  UPDATE public.shop_item_variants v SET stock_count = v.stock_count - ol.quantity, updated_at = now()
    FROM public.shop_order_lines ol
   WHERE ol.order_id = o.id AND ol.variant_id = v.id AND v.stock_count IS NOT NULL;
  -- An item with variants takes its stock from them (shop_items_variant_rollup).
  UPDATE public.shop_items i SET stock_count = i.stock_count - ol.quantity, updated_at = now()
    FROM public.shop_order_lines ol
   WHERE ol.order_id = o.id AND ol.item_id = i.id AND i.stock_count IS NOT NULL AND ol.variant_id IS NULL;
  UPDATE public.shop_orders SET status = 'accepted', accepted_at = now() WHERE id = o.id;
  RETURN jsonb_build_object('result', 'accepted', 'order_id', o.id, 'captured', false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.shop_mark_order_held(p_session_id text, p_payment_intent_id text,
  p_amount_total integer, p_tax_cents integer, p_livemode boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_cap smallint;
  v_shop_name text;
  v_shop uuid;
  v_fee_charged boolean;
  v_won boolean;
  v_pre public.shop_items;
  v_pre_units integer;
  v_pre_home_food bigint;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;
  -- Lock order: the SHOP row first, then the order, the same order as
  -- shops_request_order (shop FOR SHARE, then the buyer's unpaid order), so a
  -- buyer asking again while their old page's payment lands cannot deadlock
  -- (lh-money-escrow re-review, 2026-10-18).
  SELECT shop_id INTO v_shop FROM public.shop_orders WHERE stripe_checkout_session_id = p_session_id;
  IF v_shop IS NOT NULL THEN
    PERFORM 1 FROM public.shops WHERE id = v_shop FOR UPDATE;
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE stripe_checkout_session_id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    -- No row to record the hold on: the webhook cancels it now, and a failure
    -- there throws so Stripe redelivers the event.
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'order_missing');
  END IF;
  IF o.status IN ('held', 'accepted', 'handed_over', 'refunded') AND o.stripe_payment_intent_id = p_payment_intent_id THEN
    RETURN jsonb_build_object('result', 'already_held', 'order_id', o.id);
  END IF;
  IF o.status <> 'awaiting_hold' THEN
    -- The order closed while the buyer was on the page (asked again, withdrew,
    -- or the 2-hour unpaid sweep ran before a late webhook). The hold is
    -- recorded on the closed row, so shop_holds_to_release retries the cancel
    -- if the webhook's own cancel fails, and the buyer is told.
    IF o.stripe_payment_intent_id IS NULL AND o.status IN ('declined', 'expired', 'cancelled', 'superseded') THEN
      UPDATE public.shop_orders SET stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order already closed',
        'This order had already closed when your payment went through, so nothing was charged and the hold on your card is released.',
        '/shops/orders', o.seller_id);
    END IF;
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'order_closed', 'order_id', o.id);
  END IF;
  -- Delivery (20261106180902): the page also carries the order's frozen delivery fee (0 for a pickup).
  -- H4-fee: the page carries the frozen setup fee on top of total (items + fee + tax), or, for a page opened
  -- before shop-checkout learned the fee, total alone (then nothing is claimed: not_charged).
  v_fee_charged := o.setup_fee_cents > 0 AND p_tax_cents IS NOT NULL
    AND p_amount_total + o.gift_cents IS NOT DISTINCT FROM o.items_cents + o.premium_cents + o.delivery_cents + p_tax_cents + o.setup_fee_cents;
  -- Q2105 step 2: the gift was sized on the tax shop-checkout worked out and wrote (tax_cents); a page that
  -- names any other tax does not add up.
  IF (o.gift_cents > 0 AND p_tax_cents IS DISTINCT FROM o.tax_cents)
     OR p_tax_cents IS NULL OR p_tax_cents < 0
     OR (NOT v_fee_charged AND p_amount_total + o.gift_cents IS DISTINCT FROM o.items_cents + o.premium_cents + o.delivery_cents + p_tax_cents) THEN
    UPDATE public.shop_orders SET status = 'expired', close_reason = 'amount_mismatch', closed_at = now(),
                                  stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
     WHERE id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order could not go through',
      'Something did not add up with the payment for this order, so nothing was charged and the hold on your card is released. Please order again.',
      '/shops/orders', o.seller_id);
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'amount_mismatch', 'order_id', o.id);
  END IF;
  -- The day may have filled while the buyer was on the page. The shop row is
  -- locked so two holds landing at once cannot both take the last slot.
  SELECT daily_order_cap, name INTO v_cap, v_shop_name FROM public.shops WHERE id = o.shop_id FOR UPDATE;
  -- Preorders (20261108184654): a preorder is never counted against the day (shop_day_count skips them), so its
  -- own ready-by date is never "full".
  IF o.preorder_item_id IS NULL AND v_cap IS NOT NULL
     AND public.shop_day_count(o.seller_id, o.ready_date, ARRAY['held', 'accepted', 'handed_over']) >= v_cap THEN
    UPDATE public.shop_orders SET status = 'expired', close_reason = 'day_full', closed_at = now(),
                                  stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
     WHERE id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'That day filled up',
      'Another order took the last spot that day, so nothing was charged and the hold on your card was released. Pick another day.',
      '/shops/' || o.shop_id::text, o.seller_id);
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'day_full', 'order_id', o.id);
  END IF;
  -- Preorders: the item row is locked (every preorder hold of this item queues here), then the preorder must still be
  -- open (not missed, not past its goal deadline or ready-by) and the cap must still fit this order. Otherwise the hold
  -- goes back at no cost.
  IF o.preorder_item_id IS NOT NULL THEN
    SELECT * INTO v_pre FROM public.shop_items WHERE id = o.preorder_item_id FOR UPDATE;
    v_pre_units := public.shop_preorder_units(o.preorder_item_id, false);
    IF v_pre.id IS NULL OR v_pre.preorder_ready_by IS DISTINCT FROM o.ready_date OR v_pre.preorder_goal_missed_at IS NOT NULL
       OR v_pre.preorder_ready_by < public.shop_local_today()
       OR (v_pre.preorder_goal_by IS NOT NULL AND v_pre.preorder_goal_by < public.shop_local_today())
       OR (v_pre.preorder_cap IS NOT NULL
           AND v_pre_units + (SELECT COALESCE(sum(l.quantity), 0)::integer FROM public.shop_order_lines l WHERE l.order_id = o.id) > v_pre.preorder_cap) THEN
      UPDATE public.shop_orders SET status = 'expired', close_reason = 'order_closed', closed_at = now(),
                                    stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Preorder closed',
        'This preorder filled up or closed while you were paying, so nothing was charged and the hold on your card is released.',
        '/shops/' || o.shop_id::text, o.seller_id);
      RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'preorder_closed', 'order_id', o.id);
    END IF;
    -- Q345: a block between the buyer and the shop since the preorder was asked for: never accepted (accepting it is
    -- the shop's yes), the hold goes back at no cost, and the words say nothing of who blocked whom. A refusal, not a
    -- RAISE: this runs in the webhook, where the hold must still be released (hireRefusedAcrossBlock: CANCEL_HOLD_HIRES).
    IF public.are_users_blocked(o.buyer_id, o.seller_id) THEN
      UPDATE public.shop_orders SET status = 'expired', close_reason = 'order_closed', closed_at = now(),
                                    stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Preorder closed',
        'This preorder can''t go through, so nothing was charged and the hold on your card is released.',
        '/shops/orders', o.seller_id);
      RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'order_closed', 'order_id', o.id);
    END IF;
    -- S003 (Shops audit 11-12, High): the hold IS the shop's yes for a preorder, so it runs shops_accept_order's
    -- checks here: the shop not hidden, the owner able to sell (shop_owner_sell_block_reason), the buyer not banned,
    -- and the home-food yearly limit with THIS order in it (sales so far + accepted orders not yet charged + this
    -- order's home-food lines <= the cap; the shop row is locked above, so two holds cannot both fit). Any miss: the
    -- hold goes back at no cost, in words that never say which check failed.
    SELECT COALESCE(sum(l.line_cents), 0) INTO v_pre_home_food FROM public.shop_order_lines l
     WHERE l.order_id = o.id AND l.kind = 'home_food';
    IF EXISTS (SELECT 1 FROM public.shops s WHERE s.id = o.shop_id AND s.hidden_at IS NOT NULL)
       OR public.shop_owner_sell_block_reason(o.seller_id) IS NOT NULL
       OR o.buyer_id IS NULL
       OR EXISTS (SELECT 1 FROM public.profiles pr
                   WHERE pr.user_id = o.buyer_id
                     AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                     AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
       OR (v_pre_home_food > 0 AND (
             (SELECT c.cap_cents FROM public.shop_cottage_settings c WHERE c.id) IS NULL
             OR public.shop_cottage_sales_cents(o.seller_id)
                + (SELECT COALESCE(sum(ol.line_cents), 0) FROM public.shop_orders x
                     JOIN public.shop_order_lines ol ON ol.order_id = x.id AND ol.kind = 'home_food'
                    WHERE x.seller_id = o.seller_id AND x.status = 'accepted' AND x.captured_at IS NULL AND x.id <> o.id)
                -- S033: "equal $100,000 or more" ends the exemption, so reaching the limit is refused too.
                + v_pre_home_food >= (SELECT c.cap_cents FROM public.shop_cottage_settings c WHERE c.id))) THEN
      UPDATE public.shop_orders SET status = 'expired', close_reason = 'order_closed', closed_at = now(),
                                    stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Preorder closed',
        'This preorder can''t go through, so nothing was charged and the hold on your card is released.',
        '/shops/orders', o.seller_id);
      RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'order_closed', 'order_id', o.id);
    END IF;
  END IF;
  -- H4-fee: the one-winner claim. Lost (the account paid the fee elsewhere while the buyer was on the page): the hold
  -- goes back at no cost and the buyer orders again without it, so the fee is never charged twice.
  IF v_fee_charged THEN
    UPDATE public.profiles
       SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()
     WHERE user_id = o.buyer_id AND onboarding_fee_paid IS NOT TRUE
    RETURNING onboarding_fee_paid INTO v_won;
    IF v_won IS NOT TRUE THEN
      UPDATE public.shop_orders SET status = 'expired', close_reason = 'amount_mismatch', closed_at = now(),
                                    setup_fee_state = 'paid_elsewhere',
                                    stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Please order again',
        'You already paid the one-time account setup fee, so this order''s page should not have included it. Nothing was charged and the hold on your card is released. Order again and the fee will not be on it.',
        '/shops/' || o.shop_id::text, o.seller_id);
      RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'setup_fee_paid_elsewhere', 'order_id', o.id);
    END IF;
  END IF;
  UPDATE public.shop_orders
     SET status = 'held', stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode,
         tax_cents = p_tax_cents,
         -- H4-fee: total_cents stays the sale; the fee lives in setup_fee_cents.
         total_cents = p_amount_total + o.gift_cents - CASE WHEN v_fee_charged THEN o.setup_fee_cents ELSE 0 END,
         setup_fee_state = CASE WHEN v_fee_charged THEN 'claimed' WHEN o.setup_fee_cents > 0 THEN 'not_charged' ELSE NULL END,
         held_at = now(), accept_by = now() + interval '24 hours'
   WHERE id = o.id;
  -- Preorders: the shop said yes when it opened the preorder, so the order is accepted at once and the webhook captures
  -- it right away (shop_captures_due picks up a capture that did not answer): the buyer pays in full at order (owner
  -- 11-08).
  IF o.preorder_item_id IS NOT NULL THEN
    UPDATE public.shop_orders SET status = 'accepted', accepted_at = now() WHERE id = o.id;
    PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'New preorder',
      format('A new preorder for "%s" came in, ready by %s.', v_pre.title, to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
    RETURN jsonb_build_object('result', 'held', 'order_id', o.id, 'preorder', true);
  END IF;
  PERFORM public.declutter_notify(o.seller_id, 'new_offers', 'New order',
    format('A new order for %s is waiting. Accept or decline it within 24 hours, or it drops.', to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order sent',
    format('Your card is held, not charged. %s has 24 hours to accept; you are charged only if they do.', COALESCE(v_shop_name, 'The shop')),
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'held', 'order_id', o.id);
END;
$fn$;
