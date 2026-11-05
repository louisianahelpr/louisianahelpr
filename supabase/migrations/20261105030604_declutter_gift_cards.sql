-- Q2106 (lead decisions 11-04 ~7:10 AM): a buyer pays a Declutter order with ONE gift card, the jobs shape.
--   * The gift ledger learns Declutter orders: gift_cards.declutter_order_id (reserved or redeemed for that order) and
--     split_for_declutter_order_id (a leftover split off when the gift was applied to that order); declutter_orders
--     gains gift_cents (what the gift pays toward the order, 0 with no gift) and gift_card_id.
--   * redeem_gift_card_for_declutter_order(p_credit_id, p_order_id, p_user_id, p_retired_session): the jobs rules
--     (named recipient, paid, not expired, sent/available or reserved for this order, no card page open but the one the
--     caller retired). The gift pays min(order price, gift); the order price is total_cents + setup_fee_cents, what the
--     card page would charge. A leftover is split off as a child and the gift is LOWERED to what it pays (the Q1728
--     no-doubling rule: a put-back returns the lowered gift, the child is already the buyer's). A card remainder of
--     1-49 cents is refused with a sentence before anything changes (Stripe's 0.50 USD minimum). Covered in full: the
--     gift is redeemed and the order is paid at once through declutter_mark_order_paid's gift-paid step (no payment
--     intent, 0 card cents), in the same transaction. Otherwise the gift is reserved and declutter-checkout opens a
--     card page for the remainder only.
--   * declutter_mark_order_paid: restated VERBATIM from its newest definition, 20261103173111_declutter_late_payment_
--     buyer_block, with the CHANGED (Q2106) lines: the gift-paid step (never records a refund: any answer but 'paid'
--     raises, so the redeem rolls back), the card pays total + setup - gift_cents, the card fee is the card's share.
--     An order with no gift (gift_cents 0) takes exactly the old path.
--   * One trigger puts the gift where the order goes, so no close path needs its own put-back (the seven-path problem
--     of 20261103221953): an order leaving 'awaiting_payment' for 'paid' redeems its reserved gift; for anything else
--     (expired by the sweep, retired, superseded, closed as not payable) the reserved gift goes back to 'sent'.
-- NOT YET (Q2106 steps 3-5; nothing calls the RPC until they land, it is service_role only): declutter-checkout passing
-- gift_card_id and charging the remainder, declutter-money paying the gift share from the platform balance, and refunds
-- of a paid order's gift share back to the gift balance (Q1806 order).
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS. Grants service_role only.
-- Proof: src/test/pglite/declutterGiftCards.pglite.mjs (NEW_MIGRATION=skip red).

ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS declutter_order_id uuid;
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS split_for_declutter_order_id uuid;
COMMENT ON COLUMN public.gift_cards.declutter_order_id IS
  'The Declutter order this gift is reserved or redeemed for (Q2106). No FK, as job_id: a deleted order must not erase the trail.';
COMMENT ON COLUMN public.gift_cards.split_for_declutter_order_id IS
  'Set on a leftover split off when its parent was applied to this Declutter order (Q2106). The parent''s amount was lowered by it.';
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS gift_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS gift_card_id uuid;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_orders_gift_cents_check') THEN
    ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_gift_cents_check CHECK (gift_cents >= 0);
  END IF;
END
$do$;
COMMENT ON COLUMN public.declutter_orders.gift_cents IS
  'What the buyer''s gift card pays toward this order (Q2106); the card pays total_cents + setup_fee_cents - gift_cents.';

CREATE OR REPLACE FUNCTION public.declutter_mark_order_paid(p_order_id uuid, p_payment_intent_id text, p_amount_cents integer,
  p_paid_at timestamptz, p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_lines integer;
  v_live integer;
  v_deadline timestamptz;
  v_refund uuid;
  v_reason text;
  v_found boolean;
  r record;
  v_void record;
  v_cant boolean;
  v_items_ok boolean;
  v_pickup text;
  -- CHANGED (Q2106): a call with NO payment intent and 0 cents is the gift-paid step: redeem_gift_card_for_declutter_order
  -- calls it, in its own transaction, once the buyer's gift card covers the whole order. It never records a refund (no
  -- card money moved): any answer but 'paid' raises, so the redeem rolls back and the gift is untouched.
  v_gift_only boolean := p_payment_intent_id IS NULL;
BEGIN
  IF (v_gift_only AND p_amount_cents IS DISTINCT FROM 0)
     OR (NOT v_gift_only AND (p_payment_intent_id !~ '^pi_' OR p_amount_cents IS NULL OR p_amount_cents <= 0))
     OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;

  -- Lock order: items -> order -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  v_found := FOUND;
  -- A payment already answered with a refund keeps that answer (replays).
  SELECT r2.id INTO v_refund FROM public.declutter_refunds r2 WHERE r2.stripe_payment_intent_id = p_payment_intent_id;
  IF v_refund IS NOT NULL THEN
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  -- CHANGED (Q2106): the gift-paid step only ever pays an open order whose whole price its redeemed gift covers.
  IF v_gift_only AND (NOT v_found OR o.status <> 'awaiting_payment'
      OR o.gift_cents IS DISTINCT FROM o.total_cents + o.setup_fee_cents
      OR NOT EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.id = o.gift_card_id AND g.declutter_order_id = o.id
                        AND g.status = 'redeemed')) THEN
    RAISE EXCEPTION 'gift_payment_not_payable' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_found THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(NULL, p_payment_intent_id, 'order_missing', p_amount_cents, p_card_fee_cents));
  END IF;
  -- 141d: a replayed payment event for a HANDED-OVER sale is the same payment, never a new one to refund
  -- (before this it fell through to 'order_closed' and refunded the whole sale while the seller was paid).
  IF o.status IN ('paid', 'refunded', 'handed_over') THEN
    IF o.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id THEN
      RETURN jsonb_build_object('result', 'already_paid');
    END IF;
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'duplicate_payment', p_amount_cents, p_card_fee_cents));
  END IF;
  -- Q2352: the page charged the sale plus the one-time setup fee frozen on the order, or the sale alone: a page
  -- opened by a declutter-checkout that did not know the fee yet (the migration deploys before the edge,
  -- functions-deploy.yml waits for db-deploy; lh-money-escrow review of the Q2352 branch #1). Then the fee was
  -- not charged: it is marked so, nothing is claimed, and the account pays it at its next first-time step.
  -- CHANGED (Q2106): the card pays what the order's gift card did not (o.gift_cents, 0 with no gift). The
  -- setup-fee-not-known page predates gift cards at checkout, so it is only ever an order with no gift.
  IF p_amount_cents + o.gift_cents IS DISTINCT FROM o.total_cents + o.setup_fee_cents
     AND NOT (o.setup_fee_cents > 0 AND o.gift_cents = 0 AND p_amount_cents = o.total_cents) THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'amount_mismatch', p_amount_cents, p_card_fee_cents));
  END IF;
  IF o.setup_fee_cents > 0 AND o.gift_cents = 0 AND p_amount_cents = o.total_cents AND o.setup_fee_state IS NULL THEN
    UPDATE public.declutter_orders SET setup_fee_state = 'not_charged' WHERE id = p_order_id;
  END IF;
  PERFORM 1 FROM public.declutter_cart_items c WHERE c.order_id = p_order_id ORDER BY c.item_id FOR UPDATE;
  SELECT min(c.checkout_by) INTO v_deadline FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Read once (lh-money-escrow review of 1da32feffe #3): can the seller sell.
  v_cant := public.declutter_seller_out(o.seller_id);

  IF o.status = 'superseded' THEN
    -- B40 (lh-money-escrow review 3b #2): the app expires the old page BEFORE
    -- a restarted checkout can replace it, and refuses to replace a page that
    -- was already paid, so a payment on an order the BUYER restarted means
    -- they went around the app: their own doing, the card fee is kept. A page
    -- that Stripe itself timed out ('session_expired') cannot take a payment;
    -- if one lands anyway, that is ours.
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id,
        CASE WHEN o.close_reason = 'superseded' THEN 'buyer_restarted_checkout' ELSE 'superseded' END,
        p_amount_cents, p_card_fee_cents));
  END IF;

  IF o.status = 'expired' THEN
    IF o.close_reason IN ('seller_cancelled', 'seller_blocked') THEN
      -- Row 60: the seller backed out of a sale the buyer paid for. Paid before
      -- the cancel, or after it on a page the cancel should have closed (the
      -- app expires it; a seller who cancels around the app leaves it open):
      -- either way the seller caused it and pays the card fee (lh-money-escrow
      -- review 3b #5).
      v_reason := 'seller_backed_out';
    ELSIF o.close_reason = 'seller_out' THEN
      -- Owner 2026-10-17 (answer 7): the deadline sweep closed this checkout
      -- because the seller could no longer sell (banned, suspended, 3 Declutter
      -- strikes, an under-18 birthday or flagged business-like), and the buyer
      -- paid anyway: every cent back, and the card fee is the SELLER's debt.
      v_reason := 'seller_out';
    ELSIF o.close_reason = 'missed_checkout' AND v_deadline IS NOT NULL
          AND p_paid_at <= v_deadline + interval '1 hour' THEN
      -- B41: paid in time, recorded late. The strike goes. BUY-1: the sale no
      -- longer stands; the hold was released, so the payment is refunded in full.
      UPDATE public.declutter_strikes s
         SET removed_at = now()
       WHERE s.cart_line_id IN (SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
         AND s.reason = 'missed_checkout' AND s.removed_at IS NULL;
      SELECT count(*), count(*) FILTER (WHERE c.status = 'missed') INTO v_lines, v_live
        FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
      -- The items part apart from the blocks part (lh-money-escrow review of
      -- 905501cb2 #1): whether the seller being out is the one thing that
      -- stops the sale is judged on the items alone, as path (c) does.
      v_items_ok := v_lines > 0 AND v_live = v_lines
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                         WHERE c.order_id = p_order_id AND i.status NOT IN ('live', 'paused'))
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_cart_items c2 ON c2.item_id = c.item_id AND c2.id <> c.id
                         WHERE c.order_id = p_order_id AND c2.status IN ('in_cart', 'paid'));
      -- BUY-1 (lead 10-31): the hold was already released (the item went back on sale and the offers it closed
      -- reopened), so the sale is never brought back. The strike still goes (paid in time). The buyer's notice is
      -- sent below, once the reason is known (CHANGED, Q1926 buyer half).
      -- Owner 2026-10-17 (answer 7): when the seller being out is the ONLY
      -- thing that stops the sale, the seller (not us) owes the card fee; the
      -- buyer still gets every cent. Anything else is ours.
      -- CHANGED (Q1926): a SELLER who blocked the buyer backed out, as on an open checkout (path c): the reason is
      -- seller_backed_out (the seller owes the card fee), not order_closed (we paid it). Like seller_out, only when
      -- the items alone would still let the sale stand; if they went to someone else the block stopped nothing.
      v_reason := CASE WHEN v_items_ok AND EXISTS (SELECT 1 FROM public.user_blocks b
                                                    WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                       THEN 'seller_backed_out'
                       WHEN v_items_ok AND v_cant THEN 'seller_out'
                       -- CHANGED (Q1926 buyer half, owner 2026-11-03): a BUYER who blocked the seller ended the sale
                       -- themselves, as on an open checkout (path c): buyer_cancelled, the card fee is kept.
                       WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                     WHERE b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)
                       THEN 'buyer_cancelled'
                       ELSE 'order_closed' END;
      -- CHANGED (Q1926 buyer half): "every cent" only when every cent comes back.
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your strike was removed',
        CASE WHEN v_reason = 'buyer_cancelled'
             THEN 'You paid in time, so the missed-checkout strike is gone. The hold on the item had already ended, so your payment is coming back to your card, minus what your card company charged, because you blocked the seller.'
             ELSE 'You paid in time, so the missed-checkout strike is gone. The hold on the item had already ended, so every cent is coming back to your card.' END,
        '/declutter?view=cart', o.seller_id);
      v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
      IF v_reason = 'seller_out' THEN
        PERFORM public.declutter_seller_out_fee_notice(v_refund);
      END IF;
      RETURN public.declutter_refund_answer(v_refund);
    ELSE
      v_reason := 'order_closed';
    END IF;
    IF v_reason IS NOT NULL THEN
      v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
      IF v_reason = 'seller_out' THEN
        PERFORM public.declutter_seller_out_fee_notice(v_refund);
      END IF;
      RETURN public.declutter_refund_answer(v_refund);
    END IF;
  END IF;

  IF o.status <> 'awaiting_payment' THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'order_closed', p_amount_cents, p_card_fee_cents));
  END IF;
  SELECT count(*), count(*) FILTER (WHERE c.status = 'in_cart') INTO v_lines, v_live
    FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Every line must still be in the cart, every item still reserved, and the
  -- seller still able to sell to this buyer.
  v_items_ok := v_lines > 0 AND v_live = v_lines
     AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                      WHERE c.order_id = p_order_id AND i.status <> 'reserved');
  IF NOT v_items_ok
     OR v_cant
     OR EXISTS (SELECT 1 FROM public.user_blocks b
                 WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                    OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)) THEN
    -- CHANGED (Q2106): no card money moved on the gift-paid step, so nothing is refunded: refuse, and the redeem
    -- rolls back (the buyer keeps the gift and the order stays as it was).
    IF v_gift_only THEN
      RAISE EXCEPTION 'gift_payment_not_payable' USING ERRCODE = 'P0001';
    END IF;
    -- Who made it unpayable decides who bears the card fee (lh-authz-rls
    -- review 3b #1): a seller who blocked the buyer backed out (row 60); a
    -- BUYER who blocked the seller cancelled it themselves, so the card fee is
    -- kept (owner: never absorb a fee; otherwise blocking would be a free way to
    -- make us pay it); anything else is ours.
    v_reason := CASE WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                     THEN 'seller_backed_out'
                     -- Owner 2026-10-17 (answer 7): a seller who can no longer
                     -- sell owes the card fee and the buyer gets every cent,
                     -- even if the buyer also blocked them; only when the
                     -- sale was otherwise still whole.
                     WHEN v_cant AND v_items_ok THEN 'seller_out'
                     WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)
                     THEN 'buyer_cancelled'
                     ELSE 'order_closed' END;
    UPDATE public.declutter_orders SET status = 'expired', close_reason = 'not_payable', closed_at = now() WHERE id = p_order_id;
    UPDATE public.declutter_cart_items SET order_id = NULL WHERE order_id = p_order_id AND status = 'in_cart';
    v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
    IF v_reason = 'seller_out' THEN
      PERFORM public.declutter_seller_out_fee_notice(v_refund);
    END IF;
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  UPDATE public.declutter_orders
     SET status = 'paid', paid_at = now(), stripe_paid_at = p_paid_at, stripe_payment_intent_id = p_payment_intent_id,
         -- CHANGED (Q2106): the card fee is the card's share only: none on a gift-paid order, and on a mixed order the
         -- estimate is of what the card paid. An order with no gift is exactly as before.
         card_fee_cents = CASE WHEN v_gift_only THEN 0
                               WHEN o.gift_cents > 0 THEN least(p_amount_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(p_amount_cents))))
                               ELSE least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents)))) END
   WHERE id = p_order_id AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = p_order_id AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now()
     WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  -- B110 (owner 11-01): the pickup time the buyer chose at checkout is booked now, exactly as declutter_book_pickup's
  -- 'booked' branch (a 30-minute booking at the start, and the handover code), when it is still ahead and inside the
  -- 7-day deadline. One already past (a late payment) is not booked: the buyer picks a time after paying, as before.
  IF o.handover IN ('porch', 'pickup_home', 'meetup') AND o.pickup_slot_start IS NOT NULL
     AND o.pickup_slot_start > now() AND o.pickup_slot_start + interval '30 minutes' <= now() + interval '7 days' THEN
    INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
    VALUES (o.id, o.buyer_id, o.seller_id, o.pickup_slot_start, o.pickup_slot_start + interval '30 minutes')
    ON CONFLICT (order_id) DO NOTHING;
    INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
    ON CONFLICT (order_id) DO NOTHING;
    v_pickup := public.declutter_pickup_time_words(o.id);
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
    -- CHANGED (Q2106): what the buyer paid in all, the gift card's share included (p_amount_cents is the card's).
    format('You paid %s for %s. %s', public.declutter_price_text(p_amount_cents + o.gift_cents), public.declutter_order_items_named(p_order_id),
           public.declutter_paid_next_step(p_order_id)),
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
    format('The buyer paid %s for %s. %sYou get paid after the handover.', public.declutter_price_text(o.items_cents),
           public.declutter_order_items_named(p_order_id), COALESCE(v_pickup || ' ', '')),
    '/declutter?view=selling', o.buyer_id);
  PERFORM public.declutter_claim_setup_fee(p_order_id);
  RETURN jsonb_build_object('result', 'paid');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.redeem_gift_card_for_declutter_order(p_credit_id uuid, p_order_id uuid, p_user_id uuid,
  p_retired_session text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o                  record;
  v_credit           record;
  v_cost_cents       integer;
  v_credit_cents     integer;
  v_applied_cents    integer;
  v_leftover_cents   integer;
  v_difference_cents integer;
  v_paid             jsonb;
BEGIN
  IF p_credit_id IS NULL OR p_order_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_credit_id, p_order_id and p_user_id are required' USING ERRCODE = '22023';
  END IF;
  -- Lock order: items -> order (declutter_mark_order_paid's), then the credit (the jobs order: what is paid for first).
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT id, buyer_id, status, total_cents, setup_fee_cents, gift_cents, gift_card_id, stripe_checkout_session_id
    INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF o.buyer_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'This is not your order' USING ERRCODE = '42501';
  END IF;
  IF o.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'This order can no longer be paid' USING ERRCODE = 'P0001';
  END IF;
  -- A card page opened for this order, other than the one the caller just closed, may still be paid: applying the
  -- gift now could charge the buyer twice (the jobs Q975 race 15 rule).
  IF o.stripe_checkout_session_id IS NOT NULL AND o.stripe_checkout_session_id IS DISTINCT FROM p_retired_session THEN
    RAISE EXCEPTION 'A card payment for this order is already open. Finish it or wait a moment, then use the gift.' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, donor_id, recipient_id, recipient_email, amount, status, payment_status, category, message,
         job_id, declutter_order_id, expires_at
    INTO v_credit FROM public.gift_cards WHERE id = p_credit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_credit.recipient_id IS NULL OR v_credit.recipient_id <> p_user_id THEN
    RAISE EXCEPTION 'This gift is not yours to redeem' USING ERRCODE = '42501';
  END IF;
  IF v_credit.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'This gift has not been funded yet' USING ERRCODE = 'P0001';
  END IF;
  IF v_credit.expires_at IS NOT NULL AND v_credit.expires_at < now() THEN
    RAISE EXCEPTION 'This gift has expired' USING ERRCODE = 'P0001';
  END IF;
  IF v_credit.status = 'reserved' THEN
    IF v_credit.declutter_order_id IS DISTINCT FROM p_order_id OR v_credit.job_id IS NOT NULL THEN
      RAISE EXCEPTION 'This gift is set aside for something else' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_credit.status NOT IN ('sent', 'available') THEN
    RAISE EXCEPTION 'This gift is no longer available' USING ERRCODE = 'P0001';
  END IF;

  v_cost_cents       := o.total_cents + o.setup_fee_cents;
  v_credit_cents     := round(v_credit.amount * 100)::int;
  v_applied_cents    := least(v_cost_cents, v_credit_cents);
  v_leftover_cents   := v_credit_cents - v_applied_cents;
  v_difference_cents := v_cost_cents - v_applied_cents;
  IF v_cost_cents <= 0 OR v_applied_cents <= 0 THEN
    RAISE EXCEPTION 'This gift has nothing left to spend' USING ERRCODE = 'P0001';
  END IF;
  -- Stripe refuses a card charge under 0.50 USD: refuse BEFORE anything is reserved (the jobs Q1213 rule).
  IF v_difference_cents > 0 AND v_difference_cents < 50 THEN
    RAISE EXCEPTION 'Your gift covers all but $%.% of this order, and a card payment has to be at least $0.50. Add or remove an item so the gift covers all of it, or leaves at least $0.50 to pay by card.',
      v_difference_cents / 100, lpad((v_difference_cents % 100)::text, 2, '0')
      USING ERRCODE = 'P0001';
  END IF;

  -- Another gift set aside for this order with no page open (a page that never opened): back to the buyer first.
  -- It was lowered when it was applied and its leftover is already the buyer's, so 'sent' at its amount conserves value.
  IF o.gift_card_id IS NOT NULL AND o.gift_card_id <> p_credit_id THEN
    UPDATE public.gift_cards SET status = 'sent', declutter_order_id = NULL
     WHERE id = o.gift_card_id AND status = 'reserved' AND declutter_order_id = p_order_id;
  END IF;

  -- The gift is lowered to what it pays; the leftover is split off now as the buyer's own child gift.
  UPDATE public.gift_cards
     SET status = CASE WHEN v_difference_cents = 0 THEN 'redeemed' ELSE 'reserved' END,
         redeemed_at = CASE WHEN v_difference_cents = 0 THEN now() ELSE redeemed_at END,
         declutter_order_id = p_order_id, amount = v_applied_cents::numeric / 100
   WHERE id = p_credit_id;
  IF v_leftover_cents > 0 THEN
    INSERT INTO public.gift_cards (donor_id, recipient_id, recipient_email, amount, status, payment_status, category,
                                   message, parent_credit_id, split_for_declutter_order_id)
    VALUES (v_credit.donor_id, v_credit.recipient_id, v_credit.recipient_email, v_leftover_cents::numeric / 100,
            'sent', 'paid', v_credit.category, v_credit.message, p_credit_id, p_order_id);
  END IF;
  UPDATE public.declutter_orders SET gift_cents = v_applied_cents, gift_card_id = p_credit_id,
         stripe_checkout_session_id = CASE WHEN stripe_checkout_session_id IS NOT DISTINCT FROM p_retired_session
                                           THEN NULL ELSE stripe_checkout_session_id END
   WHERE id = p_order_id;

  IF v_difference_cents > 0 THEN
    RETURN jsonb_build_object('outcome', 'needs_payment', 'difference_cents', v_difference_cents,
      'applied_cents', v_applied_cents, 'leftover_cents', v_leftover_cents);
  END IF;
  -- Covered in full: paid now, no card page. Any answer but 'paid' raised inside (the whole redeem rolls back).
  v_paid := public.declutter_mark_order_paid(p_order_id, NULL, 0, now(), 0);
  RETURN jsonb_build_object('outcome', 'settled', 'applied_cents', v_applied_cents, 'leftover_cents', v_leftover_cents,
    'paid', v_paid);
END;
$fn$;
REVOKE ALL ON FUNCTION public.redeem_gift_card_for_declutter_order(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_gift_card_for_declutter_order(uuid, uuid, uuid, text) TO service_role;

-- The gift follows the order: paid -> the reserved gift is redeemed; closed any other way -> it goes back to 'sent'.
CREATE OR REPLACE FUNCTION public.declutter_order_gift_follows_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status = 'paid' THEN
    UPDATE public.gift_cards SET status = 'redeemed', redeemed_at = now()
     WHERE id = NEW.gift_card_id AND declutter_order_id = NEW.id AND status = 'reserved';
  ELSE
    UPDATE public.gift_cards SET status = 'sent', declutter_order_id = NULL
     WHERE id = NEW.gift_card_id AND declutter_order_id = NEW.id AND status = 'reserved';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_gift_follows_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS declutter_order_gift_follows_status ON public.declutter_orders;
CREATE TRIGGER declutter_order_gift_follows_status
  AFTER UPDATE OF status ON public.declutter_orders
  FOR EACH ROW
  WHEN (OLD.status = 'awaiting_payment' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.gift_card_id IS NOT NULL)
  EXECUTE FUNCTION public.declutter_order_gift_follows_status();

-- Q2106 S3 (Builder 3, 11-04 night; lead rules 9:4x PM): a refund of a gift-paid share goes back to the gift card
-- balance, never to a card, idempotent by a refund key; a split order refunds proportionally.
--   * gift_cards.restored_from_declutter_order_id + restored_declutter_refund_key (partial UNIQUE): each give-back is
--     one 'sent' child of the order's gift, minted once per key. Its payment_status is INHERITED (a gift whose
--     donation was refunded gives back an unspendable child, as restore_gift_card_for_job).
--   * declutter_order_gift_net_cents(order): gift_cents less what was given back. The payout queues and declutter-
--     money's giftCovers use it (20261105032500), so a restored gift is never also paid out from the platform.
--   * declutter_refund_gift_split(order, refund_cents): the gift's proportional share of a refund, rounded down
--     (the card's share takes the odd cent: the gift is never over-restored), all of it on a gift-only order,
--     never more than the gift's net.
--   * restore_gift_card_for_declutter_order(order, key, cents): capped at the net, 'already_restored' on a repeat key.
-- NOT YET: the callers (declutter_record_refund's split and declutter-money's refund step). A refund after a payout
-- went out stays held for admin by the existing refunds_due gates (no claw-back).
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS restored_from_declutter_order_id uuid;
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS restored_declutter_refund_key text;
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_restored_declutter_refund_key_key
  ON public.gift_cards (restored_declutter_refund_key) WHERE restored_declutter_refund_key IS NOT NULL;
COMMENT ON COLUMN public.gift_cards.restored_declutter_refund_key IS
  'Q2106: the refund this child gives back to the gift balance (one child per key). No FK, as job_id.';

CREATE OR REPLACE FUNCTION public.declutter_order_gift_net_cents(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT greatest(0, o.gift_cents - COALESCE((SELECT sum(round(g.amount * 100))::integer FROM public.gift_cards g
                                                WHERE g.restored_from_declutter_order_id = o.id), 0))
    FROM public.declutter_orders o WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_gift_net_cents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_order_gift_net_cents(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_gift_split(p_order_id uuid, p_refund_cents integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_refund_cents IS NULL OR p_refund_cents <= 0 OR o.gift_cents <= 0 THEN 0
              WHEN o.stripe_payment_intent_id IS NULL THEN least(p_refund_cents, public.declutter_order_gift_net_cents(o.id))
              ELSE least(public.declutter_order_gift_net_cents(o.id),
                         floor(p_refund_cents::numeric * o.gift_cents / (o.total_cents + o.setup_fee_cents))::integer) END
    FROM public.declutter_orders o WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_gift_split(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_gift_split(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.restore_gift_card_for_declutter_order(p_order_id uuid, p_refund_key text, p_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  v_credit record;
  v_existing record;
  v_cents integer;
  v_new uuid;
BEGIN
  IF p_order_id IS NULL OR p_refund_key IS NULL OR p_refund_key = '' THEN
    RAISE EXCEPTION 'p_order_id and p_refund_key are required' USING ERRCODE = '22023';
  END IF;
  SELECT id, gift_card_id, gift_cents INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'order_not_found');
  END IF;
  SELECT id, amount INTO v_existing FROM public.gift_cards WHERE restored_declutter_refund_key = p_refund_key;
  IF FOUND THEN
    RETURN jsonb_build_object('outcome', 'already_restored', 'credit_id', v_existing.id,
                              'restore_cents', round(v_existing.amount * 100)::integer);
  END IF;
  SELECT id, donor_id, recipient_id, recipient_email, category, message, occasion, design_id, expires_at, payment_status
    INTO v_credit FROM public.gift_cards
   WHERE id = o.gift_card_id AND declutter_order_id = p_order_id AND status = 'redeemed' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_credit');
  END IF;
  v_cents := least(greatest(COALESCE(p_cents, 0), 0), public.declutter_order_gift_net_cents(p_order_id));
  IF v_cents <= 0 THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_restore', 'credit_id', v_credit.id, 'restore_cents', 0);
  END IF;
  INSERT INTO public.gift_cards (donor_id, recipient_id, recipient_email, amount, status, payment_status, category,
                                 message, occasion, design_id, parent_credit_id, restored_from_declutter_order_id,
                                 restored_declutter_refund_key, expires_at)
  VALUES (v_credit.donor_id, v_credit.recipient_id, v_credit.recipient_email, v_cents::numeric / 100, 'sent',
          COALESCE(v_credit.payment_status, 'paid'), v_credit.category, v_credit.message, v_credit.occasion,
          v_credit.design_id, v_credit.id, p_order_id, p_refund_key,
          greatest(COALESCE(v_credit.expires_at, now() + interval '90 days'), now() + interval '90 days'))
  RETURNING id INTO v_new;
  RETURN jsonb_build_object('outcome', 'restored', 'credit_id', v_new, 'parent_credit_id', v_credit.id,
                            'restore_cents', v_cents, 'payment_status', COALESCE(v_credit.payment_status, 'paid'));
END;
$fn$;
REVOKE ALL ON FUNCTION public.restore_gift_card_for_declutter_order(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_gift_card_for_declutter_order(uuid, text, integer) TO service_role;
