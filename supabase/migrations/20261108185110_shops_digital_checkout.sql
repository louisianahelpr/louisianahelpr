-- Shops DIGITAL DOWNLOADS, slice 2: buying one (owner 11-08; slice 1 is 20261108182917_shops_digital_downloads).
--
-- The money path reuses the Shops order machinery as far as it fits, so refunds, captures, the card-fee record, the
-- tax commit at capture and the payout sender are the reviewed ones:
--   1. shops_request_digital_order(item), AS THE BUYER (shop-checkout 'buy_digital'): one live digital item, quantity
--      1, the same buyer rules as shops_request_order (switch, ban, strikes, 18+, the hourly cap, the shop visible,
--      paused or not selling, never your own), plus "already bought" (a paid order for it that is not refunded). The
--      row is a normal shop_orders row (is_digital = true, ready_date = today, no delivery), so the existing INSERT
--      triggers apply unchanged: the buyer's ID check at their first purchase (20261105174853) and the one-time $2
--      setup fee frozen on it (20261105181603). Same buyer fee as every Shops order (5% + 70c, the CHECK).
--   2. The page is a card HOLD like every Shops page (capture_method manual). stripe-webhook, for a digital session,
--      calls shop_digital_mark_paid (the amount and setup-fee checks of shop_mark_order_held, then straight to
--      'accepted': nobody has to accept a download) and captures at once with the existing captureShopHold. A capture
--      that does not answer is retried by declutter-money (shop_captures_due reads 'accepted' orders, unchanged).
--   3. shop_order_captured (restated): a digital order's buyer is told the download is ready (in the app and by email,
--      a link to Shops > My orders, never a file link), the shop is told of the sale. From that moment shop_digital_download_path (restated from slice 1) lets the buyer download.
--   4. 72 hours after the capture with no problem reported, shop_handover_sweep (restated) finishes the order with
--      shop_complete_handover(order, 'auto') (restated: still the one writer of a finished order and its payout):
--      handed_over, the seller's card-fee debt first, then one shop_payouts row due now, sent by the existing shop
--      payout sender. The sweep's "did you get it" nudges, and its 48-hour finish after a shop's tap, skip downloads.
--   5. shops_report_digital_problem(order, reason, note), AS THE BUYER, within those 72 hours: only "the file is
--      broken" or "not as described" (lead default). It opens the order's problem (shop_handovers.problem_at), which
--      already holds the payout (shop_payouts_due) and the 72-hour finish, and the admin decides with the existing
--      shops_admin_refund_order (it refunds an 'accepted' charged order). A refund sets the order 'refunded', which
--      ends the download.
--   6. shop_day_count (restated): a download never takes one of the shop's daily order slots.
--   7. Money review 11-08: "already bought" counts an order marked paid but not captured yet (no double charge); the
--      card page's billing state and ZIP must be the ones the tax was figured at, or the hold goes back
--      (shop_digital_mark_paid p_billing_matches, compared in stripe-webhook); a chargeback opened or lost stops the
--      download and a won one gives it back (shop_digital_dispute_event, called from the dispute handlers).
-- Lead defaults kept: payout 72 h after payment unless a problem is open; refunds only broken / not as described.
-- Tax: the page is priced at the buyer's billing address (shop-checkout), digital product codes in salesTax.ts.
-- MONEY + AUTHZ: needs lh-money-escrow and lh-authz-rls. Shops stays behind its switch (testers).
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsDigitalCheckout.pglite.mjs.

-- 1. The buyer asks for one download.
CREATE OR REPLACE FUNCTION public.shops_request_digital_order(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  s public.shops;
  v_item public.shop_items;
  v_unit integer;
  v_order uuid;
  v_old_session text;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501',
      HINT = 'This account is suspended or banned. See /account-banned for details.';
  END IF;
  IF public.shop_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'shop_strikes_blocked' USING ERRCODE = '42501',
      HINT = 'You have 3 Shops strikes. Shops opens again when one expires.';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to order from Shops.';
  END IF;
  IF (SELECT count(*) FROM public.shop_orders x WHERE x.buyer_id = v_uid AND x.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'too_many_order_requests' USING ERRCODE = '54000',
      HINT = 'You have started a lot of orders in the last hour. Wait a while and try again.';
  END IF;
  SELECT * INTO v_item FROM public.shop_items WHERE id = p_item_id;
  IF NOT FOUND OR v_item.kind <> 'digital' OR v_item.status <> 'live' THEN
    RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '55000', HINT = 'This download is no longer listed.';
  END IF;
  SELECT * INTO s FROM public.shops WHERE id = v_item.shop_id FOR SHARE;
  IF NOT FOUND OR NOT public.shop_visible_to(s.id, v_uid) OR public.are_users_blocked(v_uid, s.owner_id) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF s.owner_id = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023', HINT = 'You cannot order from your own shop.';
  END IF;
  IF s.paused THEN
    RAISE EXCEPTION 'shop_paused' USING ERRCODE = '55000', HINT = 'This shop is taking a break and is not taking new orders.';
  END IF;
  IF NOT s.offers_selling OR public.shop_owner_sell_block_reason(s.owner_id) IS NOT NULL THEN
    RAISE EXCEPTION 'shop_not_selling' USING ERRCODE = '55000', HINT = 'This shop is not taking orders right now.';
  END IF;
  -- Bought once, kept: a paid order for this download that is not refunded already gives it.
  -- An order marked paid but not captured yet counts too (review 11-08): buying again in that gap would charge twice.
  IF EXISTS (SELECT 1 FROM public.shop_orders o JOIN public.shop_order_lines l ON l.order_id = o.id
              WHERE o.buyer_id = v_uid AND o.is_digital AND l.item_id = v_item.id
                AND o.status IN ('accepted', 'handed_over')) THEN
    RAISE EXCEPTION 'already_bought' USING ERRCODE = '22023', HINT = 'You already bought this. It is in Shops > My orders.';
  END IF;
  -- At least one checked file (publishing required one; a file removed since is never sold as nothing).
  IF NOT EXISTS (SELECT 1 FROM public.shop_item_files f WHERE f.item_id = v_item.id AND f.checked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '55000', HINT = 'This download is not ready right now.';
  END IF;

  -- Asking again before paying replaces the unpaid page (shop-checkout expires it), as shops_request_order does.
  UPDATE public.shop_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
   WHERE buyer_id = v_uid AND seller_id = s.owner_id AND status = 'awaiting_hold'
  RETURNING stripe_checkout_session_id INTO v_old_session;

  v_unit := v_item.price_cents;
  INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, ready_date, cancel_policy, note,
                                  items_cents, premium_cents, tax_cents, total_cents, is_digital)
  VALUES (v_uid, s.owner_id, s.id, public.shop_local_today(), s.cancel_policy, '',
          v_unit, public.declutter_buyer_fee_cents(v_unit), 0, v_unit + public.declutter_buyer_fee_cents(v_unit), true)
  RETURNING id INTO v_order;
  INSERT INTO public.shop_order_lines (order_id, item_id, title, kind, unit_cents, quantity, line_cents, is_seed)
  VALUES (v_order, v_item.id, v_item.title, 'digital', v_unit, 1, v_unit,
          (SELECT o.is_seed FROM public.shop_orders o WHERE o.id = v_order));
  RETURN jsonb_build_object('order_id', v_order, 'items_cents', v_unit,
    'premium_cents', public.declutter_buyer_fee_cents(v_unit), 'superseded_session_id', v_old_session);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_request_digital_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_request_digital_order(uuid) TO authenticated, service_role;

-- 2. The page was paid (a hold): the checks of shop_mark_order_held (20261106180902), then 'accepted' at once.
--    Service role only (stripe-webhook). Answers 'accepted' / 'already_accepted' (capture next) or 'cancel_hold'.
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
    AND p_amount_total IS NOT DISTINCT FROM o.items_cents + o.premium_cents + p_tax_cents + o.setup_fee_cents;
  IF p_tax_cents IS NULL OR p_tax_cents < 0 OR o.delivery_cents <> 0
     OR (NOT v_fee_charged AND p_amount_total IS DISTINCT FROM o.items_cents + o.premium_cents + p_tax_cents) THEN
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
         total_cents = p_amount_total - CASE WHEN v_fee_charged THEN o.setup_fee_cents ELSE 0 END,
         setup_fee_state = CASE WHEN v_fee_charged THEN 'claimed' WHEN o.setup_fee_cents > 0 THEN 'not_charged' ELSE NULL END,
         held_at = now(), accept_by = now(), accepted_at = now()
   WHERE id = o.id;
  RETURN jsonb_build_object('result', 'accepted', 'order_id', o.id, 'captured', false, 'capture_attempts', 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_digital_mark_paid(text, text, integer, integer, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_digital_mark_paid(text, text, integer, integer, boolean, boolean) TO service_role;

-- 2b. A chargeback on a download's charge (review 11-08): stripe-webhook calls this from charge.dispute.created
--     ('opened', a real chargeback, not an inquiry) and charge.dispute.closed ('lost' / 'won'). Opened or lost: the
--     download stops (shop_digital_access_ok reads digital_access_revoked_at). Won: it comes back. Any other payment:
--     'not_digital', nothing changes. A refund made in Stripe by hand needs nothing here: shop_record_hand_refund
--     writes shop_hand_refunds (and moves the order to refunded), which shop_digital_access_ok already reads.
CREATE OR REPLACE FUNCTION public.shop_digital_dispute_event(p_payment_intent_id text, p_event text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  IF p_event IS NULL OR p_event NOT IN ('opened', 'lost', 'won') THEN
    RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.shop_orders
   WHERE stripe_payment_intent_id = p_payment_intent_id AND is_digital FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_digital';
  END IF;
  IF p_event = 'won' THEN
    UPDATE public.shop_orders SET digital_access_revoked_at = NULL WHERE id = o.id;
    RETURN 'restored';
  END IF;
  UPDATE public.shop_orders SET digital_access_revoked_at = COALESCE(digital_access_revoked_at, now()) WHERE id = o.id;
  RETURN 'revoked';
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_digital_dispute_event(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_digital_dispute_event(text, text) TO service_role;

-- 4. RESTATED from 20261106194913_shops_helpr_delivery.sql: shop_complete_handover stays the ONE writer of a finished
--    order and its payout (src/test/shopsHandoverPayout.test.ts); a download is finished by the sweep ('auto') only
--    72 hours after its charge, or by an admin, and its buyer gets no pickup notice.
CREATE OR REPLACE FUNCTION public.shop_complete_handover(p_order_id uuid, p_how text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_debt integer;
  v_payout uuid;
BEGIN
  -- Never 'shop': the shop cannot complete its own order (owner 2026-10-18 ~21:00Z).
  IF p_how IS NULL OR p_how NOT IN ('buyer', 'auto', 'admin') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'This order is not charged yet, so it cannot be handed over.';
  END IF;
  -- CHANGED (digital, owner 11-08): a download is final 72 hours after its charge (the sweep, 'auto'), or by an admin.
  -- The buyer's "I got it" and the shop's taps do not apply to a file.
  IF o.is_digital AND p_how = 'buyer' THEN
    RAISE EXCEPTION 'digital_no_pickup' USING ERRCODE = '55000', HINT = 'A download has no pickup to confirm.';
  END IF;
  IF o.is_digital AND p_how = 'auto' AND o.captured_at + interval '72 hours' > now() THEN
    RAISE EXCEPTION 'too_soon' USING ERRCODE = '55000', HINT = 'A download is paid out 72 hours after the sale.';
  END IF;
  IF p_how <> 'admin' AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this order. Louisiana Helpr decides before anyone is paid.';
  END IF;
  INSERT INTO public.shop_handovers (order_id) VALUES (o.id) ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.shop_handovers SET confirmed_at = now(), confirmed_how = p_how WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.shop_orders
     SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  -- Delivery (20261106180902, 20261106194913): the shop is paid its items, and its own delivery fee only when IT
  -- delivered (shop_delivers); a Helpr's pay comes from helpr_task_payouts. shop_payouts.items_cents carries what
  -- the shop is owed, so shop_payouts_amount (amount = items - debt) is unchanged.
  -- The seller's card-fee debt (Declutter and Shops share one ledger) comes out first.
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' || o.id::text, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END));
  INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at)
  VALUES (o.id, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END), v_debt, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt,
          CASE WHEN (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END,
          now())
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The clock finishing an order is not a pickup anybody saw: say so (money review of 201265b4c).
  PERFORM public.declutter_notify(o.seller_id, 'payment', CASE WHEN o.is_digital THEN 'Download sale final' WHEN p_how = 'buyer' THEN 'Order picked up' ELSE 'Order finished' END,
    CASE
      WHEN (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt = 0 THEN
        format('This order paid off the $%s card fee you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format('Set up payouts in Settings to get your $%s. We send it as soon as you do.', to_char(((o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt) / 100.0, 'FM999990.00'))
      WHEN v_debt > 0 THEN
        format('$%s is on its way to your payout account ($%s card fee you owed was taken out).',
               to_char(((o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt) / 100.0, 'FM999990.00'), to_char(v_debt / 100.0, 'FM999990.00'))
      ELSE format('$%s is on its way to your payout account.', to_char(((o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/shops/dashboard', o.buyer_id);
  -- CHANGED (digital): the buyer already has the download (told at the charge); nothing more to say.
  IF o.is_digital THEN
    RETURN jsonb_build_object('result', 'handed_over', 'order_id', o.id, 'payout_id', v_payout, 'by', p_how);
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', CASE WHEN p_how = 'buyer' THEN 'Enjoy your order' ELSE 'Order finished' END,
    CASE p_how
      WHEN 'buyer' THEN 'The pickup is done and the order is final. Thank you for buying local.'
      -- H5: the clock only runs after the shop said it was handed over (or left out with a photo).
      WHEN 'auto' THEN 'Nobody reported a problem in the 48 hours after the shop said your order was handed over, so the order is final and the shop is paid.'
      ELSE 'Louisiana Helpr finished this order, and the shop is paid.'
    END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'handed_over', 'order_id', o.id, 'payout_id', v_payout, 'by', p_how);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shop_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_complete_handover(uuid, text) TO service_role;

-- 5. The buyer says the file is broken or not as described, within the 72 hours. The payout waits for an admin.
CREATE OR REPLACE FUNCTION public.shops_report_digital_problem(p_order_id uuid, p_reason text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  a record;
  v_note text := btrim(COALESCE(p_note, ''));
  v_leak text;
  v_label text;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_label := CASE p_reason WHEN 'broken' THEN 'The file is broken or will not open'
                           WHEN 'not_as_described' THEN 'The file is not what the listing described' END;
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say what is wrong, in under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_note);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid OR NOT o.is_digital THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL OR o.captured_at + interval '72 hours' <= now() THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000',
      HINT = 'A problem with a download can be reported in the 72 hours after you buy it. After that, contact support.';
  END IF;
  INSERT INTO public.shop_handovers (order_id, problem_at, problem_note) VALUES (o.id, now(), v_label || ': ' || v_note)
  ON CONFLICT (order_id) DO UPDATE SET problem_at = COALESCE(public.shop_handovers.problem_at, now()),
                                       problem_note = COALESCE(public.shop_handovers.problem_note, EXCLUDED.problem_note);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Problem reported with a download',
    v_label || '. Louisiana Helpr will look at it before anyone is paid. You can add your side on the order.',
    '/shops/dashboard', o.buyer_id);
  -- Every admin is told; test data never reaches one (owner rule).
  IF NOT (public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops download problem reported',
        'A buyer says a paid Shops download is broken or not as described. The shop''s payout is held until you decide it.', '/admin');
    END LOOP;
  END IF;
  RETURN jsonb_build_object('result', 'reported', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_report_digital_problem(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_report_digital_problem(uuid, text, text) TO authenticated, service_role;

-- The buyer's own download list: the files of every download they may download now (names only, never a path).
CREATE OR REPLACE FUNCTION public.shops_my_digital_files(p_order_id uuid)
RETURNS TABLE (file_id uuid, file_name text, ext text, byte_size bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT f.id, f.file_name, f.ext, f.byte_size
    FROM public.shop_orders o
    JOIN public.shop_order_lines l ON l.order_id = o.id AND l.kind = 'digital'
    JOIN public.shop_item_files f ON f.item_id = l.item_id AND f.checked_at IS NOT NULL
   WHERE o.id = p_order_id
     AND public.shop_digital_access_ok(o.id, (SELECT auth.uid()))
   ORDER BY f.position;
$fn$;
REVOKE ALL ON FUNCTION public.shops_my_digital_files(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_digital_files(uuid) TO authenticated, service_role;

-- RESTATED from 20261018164442_shops_orders_checkout.sql (only the digital line changes).
CREATE OR REPLACE FUNCTION public.shop_day_count(p_seller uuid, p_day date, p_statuses text[])
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT count(*)::integer FROM public.shop_orders
   WHERE seller_id = p_seller AND ready_date = p_day AND status = ANY (p_statuses)
     -- CHANGED (digital): a download takes no order day's slot.
     AND NOT is_digital;
$fn$;
REVOKE ALL ON FUNCTION public.shop_day_count(uuid, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_day_count(uuid, date, text[]) TO service_role;


-- RESTATED from 20261106194913_shops_helpr_delivery.sql (only the digital notice is new).
CREATE OR REPLACE FUNCTION public.shop_order_captured(p_order_id uuid, p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_home_food integer;
  v_fee integer;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.captured_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_captured', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' THEN
    RAISE EXCEPTION 'order_not_accepted' USING ERRCODE = '55000';
  END IF;
  -- H4-fee: what the card paid on top of the sale (0 unless this order holds the account's fee).
  v_fee := CASE WHEN o.setup_fee_state = 'claimed' THEN o.setup_fee_cents ELSE 0 END;
  UPDATE public.shop_orders
     SET captured_at = now(), capture_last_error = NULL,
         card_fee_cents = least(o.total_cents, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents + v_fee)))
   WHERE id = o.id;
  -- L8: the app counts its own home-food sales (once per order: source_ref UNIQUE).
  SELECT COALESCE(sum(line_cents), 0)::integer INTO v_home_food FROM public.shop_order_lines
   WHERE order_id = o.id AND kind = 'home_food';
  IF v_home_food > 0 THEN
    INSERT INTO public.shop_cottage_sales (owner_id, source_ref, amount_cents, is_seed)
    VALUES (o.seller_id, o.id, v_home_food, o.is_seed)
    ON CONFLICT (source_ref) DO NOTHING;
  END IF;
  -- CHANGED (digital): a download is ready the moment it is paid; the buyer is told so, and the shop is told of the
  -- sale (shop_digital_mark_paid already sent nothing: the charge is what makes it a sale).
  IF o.is_digital THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your download is ready',
      format('You paid $%s%s. Open Shops > My orders and tap Download. It stays there for as long as you have an account.',
             to_char((o.total_cents + v_fee) / 100.0, 'FM999999990.00'),
             CASE WHEN v_fee > 0
               THEN format(', including the one-time $%s account setup fee (charged once per account)', to_char(v_fee / 100.0, 'FM999990.00'))
               ELSE '' END),
      '/shops/orders', o.seller_id);
    -- And an email (lead default): a link into the app or site, never a file link. send-notification-email reads the
    -- buyer's payments email switch and refuses test and seed recipients (send_notice_email, 20261108160000).
    PERFORM public.send_notice_email(o.buyer_id, 'Your download is ready',
      'Your download is paid for and ready. Open Shops > My orders and tap Download. It stays there for as long as you have an account.',
      'payment', '/shops/orders', NULL);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'You sold a download',
      'A buyer bought one of your downloads. You are paid 72 hours after the sale unless the buyer reports a problem with the file.',
      '/shops/dashboard', o.buyer_id);
    RETURN jsonb_build_object('result', 'captured', 'order_id', o.id, 'digital', true);
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order accepted',
    format('The shop accepted your order for %s and your card was charged $%s%s.', to_char(o.ready_date, 'FMMonth FMDD'),
           to_char((o.total_cents + v_fee) / 100.0, 'FM999999990.00'),
           CASE WHEN v_fee > 0
             THEN format(', including the one-time $%s account setup fee (charged once per account)', to_char(v_fee / 100.0, 'FM999990.00'))
             ELSE '' END),
    '/shops/orders', o.seller_id);
  -- Helpr delivery (20261106194913): the charged order gets its Helpr task now.
  IF o.fulfillment = 'helpr_delivers' THEN
    PERFORM public.shop_delivery_open_task(o.id);
  END IF;
  RETURN jsonb_build_object('result', 'captured', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_captured(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_captured(uuid, integer) TO service_role;


-- RESTATED from 20261105190034_shops_handover_notes.sql (the digital finish and the digital exclusion are new).
CREATE OR REPLACE FUNCTION public.shop_handover_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  a record;
  v_auto integer := 0;
  v_nudged integer := 0;
  v_to_admin integer := 0;
  v_test boolean;
BEGIN
  -- (a) The shop said it is done and the buyer said nothing for 48 hours: the shop is paid. In person: the
  -- "Handed over" tap. Left out: the ready photo, counted from the later of the photo and the ready date's start.
  -- CHANGED (digital, owner 11-08): a download paid 72 hours ago with no problem reported is final and its shop is
  -- paid; a shop's "handed over" tap never shortens those 72 hours. A download has no handover row until it is
  -- finished, so the join is a LEFT JOIN (a made order still needs the shop's tap, which needs the row).
  FOR r IN
    SELECT o.id FROM public.shop_orders o
      LEFT JOIN public.shop_handovers h ON h.order_id = o.id
     WHERE o.status = 'accepted' AND o.captured_at IS NOT NULL
       AND h.problem_at IS NULL AND h.confirmed_at IS NULL
       AND ((NOT o.is_digital
             AND ((o.handover_mode = 'in_person' AND h.shop_confirmed_at IS NOT NULL
             AND h.shop_confirmed_at + interval '48 hours' <= now())
         OR (o.handover_mode = 'porch' AND h.ready_photo_path IS NOT NULL
             AND greatest(h.ready_at, (o.ready_date::timestamp AT TIME ZONE 'America/Chicago')) + interval '48 hours' <= now())))
         OR (o.is_digital AND o.captured_at + interval '72 hours' <= now()))
     ORDER BY o.ready_date, o.id LIMIT 200
  LOOP
    BEGIN
      -- shop_complete_handover re-reads the row under its lock and refuses an open problem.
      IF (public.shop_complete_handover(r.id, 'auto') ->> 'result') = 'handed_over' THEN
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; it is logged and retried next run.
      PERFORM public.log_cron_defect('shop_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (b) Nobody has said anything 24 hours after the ready date: the money stays held. Both sides are nudged, then
  -- weekly; at 60 days every admin is told once. No money moves here.
  FOR r IN
    SELECT o.id, o.buyer_id, o.seller_id, o.handover_mode, o.ready_date, o.is_seed,
           h.held_nudged_at, h.held_admin_at,
           ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') AS held_from
      FROM public.shop_orders o
      LEFT JOIN public.shop_handovers h ON h.order_id = o.id
     WHERE o.status = 'accepted' AND o.captured_at IS NOT NULL
       AND h.problem_at IS NULL AND h.confirmed_at IS NULL
       AND ((o.handover_mode = 'in_person' AND h.shop_confirmed_at IS NULL)
         OR (o.handover_mode = 'porch' AND h.ready_photo_path IS NULL))
       -- CHANGED (digital): nobody hands a download over, so nobody is nudged about it.
       AND NOT o.is_digital
       AND ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') + interval '24 hours' <= now()
       AND (h.held_nudged_at IS NULL OR h.held_nudged_at + interval '7 days' <= now()
            OR (h.held_admin_at IS NULL
                AND ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') + interval '60 days' <= now()))
       -- Owner rule: test data never reaches a member or admin.
       AND o.is_seed IS NOT TRUE
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id IN (o.buyer_id, o.seller_id))
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id IN (o.buyer_id, o.seller_id) AND pr.is_seed)
     ORDER BY o.ready_date, o.id LIMIT 200
  LOOP
    BEGIN
      INSERT INTO public.shop_handovers (order_id) VALUES (r.id) ON CONFLICT (order_id) DO NOTHING;
      IF r.held_admin_at IS NULL AND r.held_from + interval '60 days' <= now() THEN
        -- H5 review note: like Declutter's system problem (20261102084222), the order gets an open problem, so it
        -- sits in admin > Shops orders' problems with the reason, and no tap pays or refunds it until an admin decides.
        UPDATE public.shop_handovers
           SET held_admin_at = now(), held_nudged_at = now(),
               problem_at = COALESCE(problem_at, now()),
               problem_note = COALESCE(problem_note,
                 'Nobody has said anything about this handover for 60 days, so the money is still held. Neither side confirmed it or reported a problem. Decide who gets the money.')
         WHERE order_id = r.id;
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until Louisiana Helpr decides. You can add your side on the order.',
          '/shops/orders', r.seller_id);
        PERFORM public.declutter_notify(r.seller_id, 'payment', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until Louisiana Helpr decides. You can add your side on the order.',
          '/shops/dashboard', r.buyer_id);
        v_test := public.is_test_subject(r.buyer_id) OR public.is_test_subject(r.seller_id);
        IF NOT v_test THEN
          FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
            PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops order held 60 days',
              'Nobody has confirmed a paid Shops handover for 60 days. The money is held until you decide it: pay the shop or refund the buyer.', '/admin');
          END LOOP;
        END IF;
        v_to_admin := v_to_admin + 1;
      ELSE
        UPDATE public.shop_handovers SET held_nudged_at = now() WHERE order_id = r.id;
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Did you get your order?',
          'If you have it, tap "I got it" on the order in Shops. If not, report it there. Your money stays held until one of you says.',
          '/shops/orders', r.seller_id);
        PERFORM public.declutter_notify(r.seller_id, 'payment', 'Did the buyer get this order?',
          CASE WHEN r.handover_mode = 'porch'
            THEN 'If it''s out, take the ready photo on the order. You aren''t paid until one of you says.'
            ELSE 'If they have it, tap "Handed over" on the order. You aren''t paid until one of you says.' END,
          '/shops/dashboard', r.buyer_id);
        v_nudged := v_nudged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('auto_handed_over', v_auto, 'held_nudged', v_nudged, 'held_to_admin', v_to_admin);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_handover_sweep() TO service_role;


-- RESTATED from 20261103073509_shop_checkout_reach_not_found_is_404.sql (only the digital refusal is new).
CREATE OR REPLACE FUNCTION public.shop_lock_open_charged_order(p_order_id uuid, p_allow_problem boolean)
RETURNS public.shop_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status IN ('handed_over') THEN
    RAISE EXCEPTION 'order_final' USING ERRCODE = '55000', HINT = 'This order was picked up and is final.';
  END IF;
  IF o.status <> 'accepted' THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000', HINT = 'This order is already closed.';
  END IF;
  IF o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'The card is still being charged. Try again in a few minutes.';
  END IF;
  -- A refund made by hand in Stripe stands on this order (section 13): nobody refunds or
  -- pays from it automatically; an admin decides through the held-for-review tools.
  IF public.shop_order_unaccounted_hand_refund(o.id) THEN
    RAISE EXCEPTION 'refunded_in_stripe' USING ERRCODE = '55000',
      HINT = 'This order was refunded in Stripe. Louisiana Helpr decides it.';
  END IF;
  -- CHANGED (digital, owner 11-08): a download is delivered the moment it is paid, so no member cancel, shop cancel or
  -- no-show refunds it. The only way back is a problem report (broken / not as described) that an admin decides; the
  -- admin's refund (shops_admin_refund_order) is the one caller that passes p_allow_problem = true.
  IF o.is_digital AND NOT COALESCE(p_allow_problem, false) THEN
    RAISE EXCEPTION 'digital_not_cancellable' USING ERRCODE = '55000',
      HINT = 'A download cannot be cancelled. If the file is broken or not as described, report a problem on the order.';
  END IF;
  IF NOT COALESCE(p_allow_problem, false)
     AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this order. Louisiana Helpr decides it.';
  END IF;
  RETURN o;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shop_lock_open_charged_order(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_lock_open_charged_order(uuid, boolean) TO service_role;
