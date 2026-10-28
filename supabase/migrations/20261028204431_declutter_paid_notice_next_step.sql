-- The buyer's paid notice tells the truth about what comes next (deep audit 2026-10-28, #26).
--
-- WHAT WAS WRONG: "Payment received: You paid $30. Next: pick up your items at the time you chose." (and its
-- late-payment twin, and the free claim's "Next: pick it up at the time you chose.") arrive before any time is
-- chosen. A pickup (home, porch, meetup) is booked only AFTER payment (declutter_book_pickup refuses an order
-- that is not paid), so at that moment no booking exists; a Helpr delivery has no time until a Helpr takes it.
-- Measured on prod 2026-10-28 (read-only): 2 notices carry the text, and 0 of those buyers had any booking when
-- it was sent.
--
-- WHAT THIS DOES:
--   * declutter_paid_next_step(order) says what is true for the order when the notice is written:
--       a Helpr delivery           -> "Next: we're finding a Helpr to bring it to your door. We'll tell you when one takes it."
--       a seller delivery, booked  -> "Next: the seller delivers at the time you chose."  (the time was chosen at checkout)
--       a seller delivery, no time -> "Next: pick a new delivery time in Buying."  (its slot was taken meanwhile)
--       a pickup already booked    -> "Next: pick up your items at the time you chose."  (only where a booking exists)
--       a pickup, no booking       -> "Next: choose your pickup time in Buying."
--     The seller-delivery row is read after the status trigger (trg_declutter_orders_seller_delivery, AFTER UPDATE
--     FOR EACH ROW) has booked it or sent it to needs_time, so the notice agrees with "Delivery booked" / "Pick a
--     new delivery time".
--   * declutter_mark_order_paid: both "Payment received" messages end with that step instead of the fixed line.
--   * declutter_checkout_free: "Next: choose when to pick it up." (a free order is always a pickup, never booked yet).
--
-- Bodies restated from their newest definitions, equal to prod's pg_get_functiondef bodies (read 2026-10-28):
-- declutter_mark_order_paid (20261028171944), declutter_checkout_free (20261027170717). Only the lines named
-- above change. No money moves differently: copy only.
-- REPLAY-SAFETY: CREATE OR REPLACE throughout; every object it reads exists on prod and in every earlier world.
-- Proof: src/test/pglite/declutterPaidNoticeNextStep.pglite.mjs (applied 3x; RED on prod's bodies and on planted
-- defects). Guard: src/test/declutterPaidNoticeNextStep.test.ts.

CREATE OR REPLACE FUNCTION public.declutter_paid_next_step(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN o.handover = 'delivery' THEN
      'Next: we''re finding a Helpr to bring it to your door. We''ll tell you when one takes it.'
    WHEN o.handover = 'seller_delivery' THEN
      CASE WHEN EXISTS (SELECT 1 FROM public.declutter_seller_deliveries d
                         WHERE d.order_id = o.id AND d.status = 'booked' AND d.slot_start IS NOT NULL)
           THEN 'Next: the seller delivers at the time you chose.'
           ELSE 'Next: pick a new delivery time in Buying.' END
    WHEN EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
      'Next: pick up your items at the time you chose.'
    ELSE 'Next: choose your pickup time in Buying.'
  END
  FROM public.declutter_orders o
  WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_paid_next_step(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_paid_next_step(uuid) TO service_role;

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
  v_honour boolean := false;
  v_found boolean;
  r record;
  v_void record;
  v_cant boolean;
  v_items_ok boolean;
  v_sale_ok boolean;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' OR p_amount_cents IS NULL OR p_amount_cents <= 0
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
  IF p_amount_cents IS DISTINCT FROM o.total_cents + o.setup_fee_cents
     AND NOT (o.setup_fee_cents > 0 AND p_amount_cents = o.total_cents) THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'amount_mismatch', p_amount_cents, p_card_fee_cents));
  END IF;
  IF o.setup_fee_cents > 0 AND p_amount_cents = o.total_cents AND o.setup_fee_state IS NULL THEN
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
      -- B41: paid in time, recorded late. The strike goes; the sale stands if
      -- every item is still unsold and the seller can still sell to them.
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
      v_sale_ok := v_items_ok
        AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                         WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                            OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id));
      v_honour := v_sale_ok AND NOT v_cant;
      IF NOT v_honour THEN
        PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your strike was removed',
          'You paid in time, so the missed-checkout strike is gone. The item is no longer available, so every cent is coming back to your card.',
          '/declutter?view=cart', o.seller_id);
        -- Owner 2026-10-17 (answer 7): when the seller being out is the ONLY
        -- thing that stops the sale, the seller (not us) owes the card fee; the
        -- buyer still gets every cent. An item that went elsewhere is ours.
        -- As in path (c): a seller who is out wins over a BUYER who blocked
        -- them; a seller who blocked the buyer is left as before (filed in docs/OPEN.md).
        v_reason := CASE WHEN v_items_ok AND v_cant
                               AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                                                WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                         THEN 'seller_out' ELSE 'sold_elsewhere' END;
        v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
        IF v_reason = 'seller_out' THEN
          PERFORM public.declutter_seller_out_fee_notice(v_refund);
        END IF;
        RETURN public.declutter_refund_answer(v_refund);
      END IF;
      -- Straight to PAID (lh-money-escrow review 3b #1: never back through
      -- 'awaiting_payment', which a newer open order for the same pair would
      -- refuse on declutter_orders_one_awaiting). Each item comes off sale
      -- again; its open offers close and their buyers are told.
      FOR r IN SELECT c.item_id, i.title FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                WHERE c.order_id = p_order_id ORDER BY c.item_id LOOP
        UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = r.item_id AND status IN ('live', 'paused');
        FOR v_void IN
          UPDATE public.declutter_offers SET status = 'voided', closed_at = now(), updated_at = now()
           WHERE item_id = r.item_id AND status = 'open'
          RETURNING id, buyer_id
        LOOP
          INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (v_void.id, 'system', 'void');
          PERFORM public.declutter_notify(v_void.buyer_id, 'new_offers', 'Item no longer available',
            format('"%s" went to another buyer, so your offer is closed. Nothing was charged.', r.title),
            '/declutter/item/' || r.item_id::text, o.seller_id);
        END LOOP;
      END LOOP;
      UPDATE public.declutter_cart_items SET status = 'paid', closed_at = now()
       WHERE order_id = p_order_id AND status = 'missed';
      UPDATE public.declutter_orders
         SET status = 'paid', close_reason = NULL, closed_at = NULL, paid_at = now(), stripe_paid_at = p_paid_at,
             stripe_payment_intent_id = p_payment_intent_id,
             card_fee_cents = least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents))))
       WHERE id = p_order_id AND status = 'expired';
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
        format('You paid %s in time, so the sale stands and there is no strike. %s',
               public.declutter_price_text(p_amount_cents), public.declutter_paid_next_step(p_order_id)),
        '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
        format('The buyer paid for %s of your items in time after all, so the sale stands. You get paid when the buyer has them.',
               public.declutter_price_text(o.items_cents)),
        '/declutter?view=selling', o.buyer_id);
      PERFORM public.declutter_claim_setup_fee(p_order_id);
      RETURN jsonb_build_object('result', 'paid');
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
         card_fee_cents = least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents))))
   WHERE id = p_order_id AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = p_order_id AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now()
     WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
    format('You paid %s. %s', public.declutter_price_text(p_amount_cents), public.declutter_paid_next_step(p_order_id)),
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
    format('The buyer paid for %s of your items. You get paid when the buyer has them.', public.declutter_price_text(o.items_cents)),
    '/declutter?view=selling', o.buyer_id);
  PERFORM public.declutter_claim_setup_fee(p_order_id);
  RETURN jsonb_build_object('result', 'paid');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_checkout_free(p_seller_id uuid, p_handover text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_taker text;
  v_n integer;
  v_items integer;
  v_lines uuid[];
  v_existing record;
  v_order uuid;
  r record;
BEGIN
  -- Row 62: no require_feature (a claim is a sale already agreed), the same as declutter_start_checkout.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  -- Free pickups at launch: at the seller's home or from the porch. Delivery costs money, so not for a $0 order.
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Free items are picked up: from the porch or at the seller''s home.';
  END IF;
  -- Lock order as checkout: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.stripe_checkout_session_id INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now();
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  IF v_items <> 0 THEN
    RAISE EXCEPTION 'not_free_order' USING ERRCODE = '22023', HINT = 'Some of these items have a price. Check out to pay for them.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked to meet at their home for this item. Choose pickup at the seller''s home.';
  END IF;
  -- An order still open on a payment page (the cart once held a paid line) is never replaced here:
  -- that page could still be paid. The buyer finishes or leaves it first (it closes in 31 minutes).
  IF v_existing.id IS NOT NULL AND v_existing.stripe_checkout_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'checkout_page_open' USING ERRCODE = '55000',
      HINT = 'A payment page for this seller is still open. Close it, then try again in a few minutes.';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
  END IF;
  -- The order: $0 everywhere, paid_with 'free' (fee rule 'free' from the trigger), never a Stripe page,
  -- no setup fee. It is paid-equivalent at once: the existing handover RPCs take it from here.
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents, paid_with)
  VALUES (v_uid, p_seller_id, p_handover, 0, 0, 0, 0, 0, 0, 'free')
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order WHERE c.id = ANY (v_lines);
  UPDATE public.declutter_orders SET status = 'paid', paid_at = now(), card_fee_cents = 0
   WHERE id = v_order AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = v_order AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now() WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  PERFORM public.declutter_notify(v_uid, 'payment', 'It''s yours',
    'Your free item is set. Next: choose when to pick it up. Nothing was charged.',
    '/declutter?view=cart', p_seller_id);
  SELECT public.member_display_name(p.full_name, 'Someone') INTO v_taker FROM public.profiles p WHERE p.user_id = v_uid;
  PERFORM public.declutter_notify(p_seller_id, 'payment', 'Free item claimed',
    COALESCE(v_taker, 'Someone') || ' is picking up your free item. Nothing to pay and nothing to set up.',
    '/declutter?view=offers', v_uid);
  RETURN v_order;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_checkout_free(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_checkout_free(uuid, text) TO authenticated, service_role;
