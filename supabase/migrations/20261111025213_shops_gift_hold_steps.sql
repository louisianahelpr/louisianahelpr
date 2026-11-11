-- Q2105 step 2 (Builder 2, 11-10): the two Shops hold steps learn the gift card.
-- The problem: shop-checkout now applies a gift (redeem_gift_card_for_shop_order, 20261111015126) and opens the card
-- page for what is left only. Both hold steps checked the page's amount against the whole price (items + fee +
-- delivery + tax, + the setup fee) and then rewrote total_cents = the page's amount - the setup fee. With a gift:
--   * every gift order's page would read as amount_mismatch and its hold would go back (no gift order could ever
--     go through), and
--   * had the check passed, total_cents would be written short by gift_cents, so the order's total CHECK
--     (total_cents = items + premium + tax + delivery, 20261106180902) and the gift CHECK (gift_cents <=
--     total_cents + setup_fee_cents, 20261111015126) would break.
-- The fix: the page's amount PLUS the order's gift_cents is what is checked and what total_cents is written from
-- (gift_cents is 0 on every order without a gift, so those are unchanged). And because the gift was sized on the tax
-- shop-checkout calculated and wrote on the order, a gift order whose page names any other tax does not add up
-- (amount_mismatch, the hold goes back, the trigger puts the gift back).
-- Restated verbatim from their newest CREATEs, with only those edits:
--   * shop_mark_order_held: 20261108184654_shops_preorders.sql (6a);
--   * shop_digital_mark_paid: 20261108185110_shops_digital_checkout.sql (2). shop-checkout's buy_digital path takes
--     no gift yet, so a download's gift_cents stays 0; the add-back keeps the two steps alike.
-- MONEY: lh-money-escrow. Replay-safe: CREATE OR REPLACE only; gift_cents exists from 20261111015126 (earlier).
-- Proof: src/test/pglite/shopsGiftHoldSteps.pglite.mjs (NEW_MIGRATION=skip red).

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
REVOKE ALL ON FUNCTION public.shop_mark_order_held(text, text, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_mark_order_held(text, text, integer, integer, boolean) TO service_role;


CREATE OR REPLACE FUNCTION public.shop_digital_mark_paid(p_session_id text, p_payment_intent_id text,
  p_amount_total integer, p_tax_cents integer, p_livemode boolean, p_billing_matches boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_fee_charged boolean;
  v_won boolean;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE stripe_checkout_session_id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'order_missing');
  END IF;
  IF NOT o.is_digital THEN
    RAISE EXCEPTION 'not_digital' USING ERRCODE = '22023';
  END IF;
  IF o.status IN ('accepted', 'handed_over', 'refunded', 'partially_refunded') AND o.stripe_payment_intent_id = p_payment_intent_id THEN
    RETURN jsonb_build_object('result', 'already_accepted', 'order_id', o.id, 'captured', o.captured_at IS NOT NULL,
                              'capture_attempts', o.capture_attempts);
  END IF;
  IF o.status <> 'awaiting_hold' THEN
    IF o.stripe_payment_intent_id IS NULL AND o.status IN ('declined', 'expired', 'cancelled', 'superseded') THEN
      UPDATE public.shop_orders SET stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
       WHERE id = o.id;
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order already closed',
        'This order had already closed when your payment went through, so nothing was charged and the hold on your card is released.',
        '/shops/orders', o.seller_id);
    END IF;
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'order_closed', 'order_id', o.id);
  END IF;
  -- Review 11-08: the tax was figured at the billing address the buyer typed in the app; the card that paid must
  -- carry that address (stripe-webhook compares the page's billing state and ZIP with the ones the tax used). If not,
  -- nothing is charged: the hold goes back and the buyer buys again, so the address that pays is the one taxed.
  IF p_billing_matches IS NOT TRUE THEN
    UPDATE public.shop_orders SET status = 'expired', close_reason = 'amount_mismatch', closed_at = now(),
                                  stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
     WHERE id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Please buy again',
      'The card''s billing address was not the address you typed for the sales tax, so nothing was charged and the hold on your card is released. Buy again and type the card''s billing address.',
      '/shops/' || o.shop_id::text, o.seller_id);
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'billing_address_mismatch', 'order_id', o.id);
  END IF;
  -- The page carries items + fee + tax (+ the frozen setup fee). No delivery on a download.
  v_fee_charged := o.setup_fee_cents > 0 AND p_tax_cents IS NOT NULL
    AND p_amount_total + o.gift_cents IS NOT DISTINCT FROM o.items_cents + o.premium_cents + p_tax_cents + o.setup_fee_cents;
  -- Q2105 step 2: the gift was sized on the tax shop-checkout worked out and wrote (tax_cents); a page that
  -- names any other tax does not add up.
  IF (o.gift_cents > 0 AND p_tax_cents IS DISTINCT FROM o.tax_cents)
     OR p_tax_cents IS NULL OR p_tax_cents < 0 OR o.delivery_cents <> 0
     OR (NOT v_fee_charged AND p_amount_total + o.gift_cents IS DISTINCT FROM o.items_cents + o.premium_cents + p_tax_cents) THEN
    UPDATE public.shop_orders SET status = 'expired', close_reason = 'amount_mismatch', closed_at = now(),
                                  stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode
     WHERE id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order could not go through',
      'Something did not add up with the payment for this download, so nothing was charged and the hold on your card is released. Please try again.',
      '/shops/orders', o.seller_id);
    RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'amount_mismatch', 'order_id', o.id);
  END IF;
  -- H4-fee: the one-winner claim, exactly as shop_mark_order_held.
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
      PERFORM public.declutter_notify(o.buyer_id, 'info', 'Please buy again',
        'You already paid the one-time account setup fee, so this page should not have included it. Nothing was charged and the hold on your card is released. Buy again and the fee will not be on it.',
        '/shops/' || o.shop_id::text, o.seller_id);
      RETURN jsonb_build_object('result', 'cancel_hold', 'reason', 'setup_fee_paid_elsewhere', 'order_id', o.id);
    END IF;
  END IF;
  -- Held and accepted in one step (shop_orders_accept_window wants held_at and accept_by together).
  UPDATE public.shop_orders
     SET status = 'accepted', stripe_payment_intent_id = p_payment_intent_id, payment_livemode = p_livemode,
         tax_cents = p_tax_cents,
         total_cents = p_amount_total + o.gift_cents - CASE WHEN v_fee_charged THEN o.setup_fee_cents ELSE 0 END,
         setup_fee_state = CASE WHEN v_fee_charged THEN 'claimed' WHEN o.setup_fee_cents > 0 THEN 'not_charged' ELSE NULL END,
         held_at = now(), accept_by = now(), accepted_at = now()
   WHERE id = o.id;
  RETURN jsonb_build_object('result', 'accepted', 'order_id', o.id, 'captured', false, 'capture_attempts', 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_digital_mark_paid(text, text, integer, integer, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_digital_mark_paid(text, text, integer, integer, boolean, boolean) TO service_role;
