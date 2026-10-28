-- The seven sale notices name the item in their own words, and the buyer is told they can tip the delivery
-- Helpr (Declutter audits 2026-10-28: A3-8 and A2-18).
--
-- WHAT WAS WRONG: "Payment received", "Buyer paid", "Helpr pickup booked", "Picked up", "Delivered", "Handover
-- done" and "Enjoy your item" never said which item. 20261028191646 (the notice writer names the item) now puts
-- "Lamp: " in front of a Declutter notice that does not name its order's first item; this migration words the
-- seven sale notices themselves, so they read as sentences ('You paid $30 for "Lamp".') and the prefix, finding
-- the item already named, adds nothing. After a Helpr delivery nothing told the buyer they could tip the Helpr.
--
-- WHAT THIS DOES:
--   * declutter_order_items_named(order): "Lamp" / "Lamp" and "Chair" / "Lamp" and 2 more items (the order's own
--     lines in the order they were added, the order 20261028191646 reads; "your item" if none are left). Always
--     mid-sentence, so the fallback reads right.
--   * declutter_delivery_tip_open(order): the conditions helpr_task_tip_start checks (a confirmed delivery with a
--     Helpr who is not the buyer, not blocked, and paid or with pay still waiting). "Enjoy your item" adds
--     "You can add a tip for your Helpr in Buying." only when it is true.
--   * The seven notices name the item. Changed wording: "The buyer paid for $30 of your items. You get paid when
--     the buyer has them." is "The buyer paid $30 for "Lamp". You get paid after the handover." (the old "them"
--     cannot follow one named item); "Handover done" and "Enjoy your item" start "The handover of "Lamp" is done"
--     (the buyer's "Enjoy your item" never says "you got it": an admin can close a sale the buyer disputes).
--     "Your free item has a new home. Thank you for giving it away." is "Thank you for giving away "Chair". It has
--     a new home." Everything else in each message is unchanged.
--
-- Bodies restated from their EFFECTIVE definitions (rewrites included): declutter_mark_order_paid (20261028204431,
-- #26), declutter_complete_handover (20261027170717 as rewritten by 20261027172503; equal to prod's
-- pg_get_functiondef, read 2026-10-28), declutter_delivery_on_task_event (20261028200440: prod's body with the
-- seller's links to Selling). Only the notice lines named above change. Copy only: no reason, amount, fee or
-- payout moves.
-- REPLAY-SAFETY: CREATE OR REPLACE throughout; every object read exists on prod and in every earlier world.
-- Proof: src/test/pglite/declutterSaleNoticesNameInline.pglite.mjs. Guard: src/test/declutterSaleNoticesNameInline.test.ts.

-- The items of an order, named for a notice: "Lamp" / "Lamp" and "Chair" / "Lamp" and 2 more items. Titles in
-- the order's own lines, in the order they were added: the order 20261028191646's declutter_notice_names_item
-- reads, so its "Lamp: ..." prefix finds the same first title already in the message and adds nothing. Never
-- empty: an order with no lines left reads "your item".
CREATE OR REPLACE FUNCTION public.declutter_order_items_named(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE count(*)
           WHEN 0 THEN 'your item'
           WHEN 1 THEN format('"%s"', (array_agg(i.title ORDER BY c.created_at, c.id))[1])
           WHEN 2 THEN format('"%s" and "%s"', (array_agg(i.title ORDER BY c.created_at, c.id))[1], (array_agg(i.title ORDER BY c.created_at, c.id))[2])
           ELSE format('"%s" and %s more items', (array_agg(i.title ORDER BY c.created_at, c.id))[1], count(*) - 1)
         END
    FROM public.declutter_cart_items c
    JOIN public.declutter_items i ON i.id = c.item_id
   WHERE c.order_id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_items_named(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_order_items_named(uuid) TO service_role;

-- Can this order's buyer add a tip for its delivery Helpr right now? The conditions helpr_task_tip_start
-- (20261028014848) checks after the caller's own checks: the delivery is done (confirmed), it has a Helpr who is
-- not the buyer and not blocked either way, and a Helpr with no payout account still has delivery pay waiting
-- (the tip is held with it). The notice says "add a tip" only when this is true.
CREATE OR REPLACE FUNCTION public.declutter_delivery_tip_open(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.declutter_orders o
      JOIN public.declutter_order_deliveries od ON od.order_id = o.id
      JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE o.id = p_order_id
       AND o.handover = 'delivery'
       AND t.status = 'confirmed'
       AND t.customer_id = o.buyer_id
       AND t.helpr_id IS NOT NULL AND t.helpr_id <> o.buyer_id
       AND NOT public.are_users_blocked(o.buyer_id, t.helpr_id)
       AND (EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL)
            OR EXISTS (SELECT 1 FROM public.helpr_task_payouts p
                        WHERE p.task_id = t.id AND p.status IN ('pending', 'failed', 'held_for_review'))));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_tip_open(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_tip_open(uuid) TO service_role;


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
        format('You paid %s for %s in time, so the sale stands and there is no strike. %s',
               public.declutter_price_text(p_amount_cents), public.declutter_order_items_named(p_order_id),
               public.declutter_paid_next_step(p_order_id)),
        '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
        format('The buyer paid %s for %s in time after all, so the sale stands. You get paid after the handover.',
               public.declutter_price_text(o.items_cents), public.declutter_order_items_named(p_order_id)),
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
    format('You paid %s for %s. %s', public.declutter_price_text(p_amount_cents), public.declutter_order_items_named(p_order_id),
           public.declutter_paid_next_step(p_order_id)),
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
    format('The buyer paid %s for %s. You get paid after the handover.', public.declutter_price_text(o.items_cents),
           public.declutter_order_items_named(p_order_id)),
    '/declutter?view=selling', o.buyer_id);
  PERFORM public.declutter_claim_setup_fee(p_order_id);
  RETURN jsonb_build_object('result', 'paid');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_complete_handover(p_order_id uuid, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_debt integer;
  v_payout uuid;
  v_task public.helpr_tasks;
  v_task_out jsonb;
  v_rate integer;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Louisiana Helpr decides before anyone is paid.';
  END IF;
  -- Slice 5: a delivery.
  IF o.handover = 'delivery' THEN
    SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE od.order_id = o.id FOR UPDATE OF t;
    IF v_task.status IN ('picked_up', 'delivered') THEN
      v_task_out := public.helpr_task_confirm(v_task.id,
        CASE p_by WHEN 'code' THEN 'code' WHEN 'buyer' THEN 'customer' WHEN 'admin' THEN 'admin' ELSE 'auto' END, NULL);
    ELSIF v_task.status = 'confirmed' OR (p_by = 'admin' AND v_task.status = 'failed') THEN
      -- Already confirmed, or the damage decision (row 43) that failed the
      -- task itself and refunds the whole order on its own: nothing more here.
      NULL;
    ELSIF p_by = 'admin' AND (v_task.id IS NULL OR v_task.status IN ('open', 'accepted')) THEN
      IF v_task.id IS NOT NULL THEN
        PERFORM public.helpr_task_close(v_task.id, 'cancelled', 'The sale was decided without a delivery');
      END IF;
      PERFORM public.declutter_delivery_refund(o.id, 'delivery_not_done');
    ELSE
      RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000',
        HINT = 'The Helpr has not picked the item up yet.';
    END IF;
  END IF;
  -- Seller delivery: the rate is the seller's, paid with the items.
  v_rate := CASE WHEN o.handover = 'seller_delivery' THEN o.delivery_cents ELSE 0 END;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.declutter_handovers SET confirmed_at = now(), confirmed_by = p_by WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.declutter_orders SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'paid';
  UPDATE public.declutter_items SET status = 'completed', updated_at = now()
   WHERE id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'paid')
     AND status = 'sold';
  -- A free claim (20261027170717): no money is owed either way, so no payout row and no payout words.
  IF o.paid_with = 'free' THEN
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
      format('Thank you for giving away %s. It has a new home.', public.declutter_order_items_named(o.id)),
      '/declutter?view=selling', o.buyer_id);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
      format('The handover of %s is done. Leave the giver a review.', public.declutter_order_items_named(o.id)),
      '/declutter?view=cart', o.seller_id);
    RETURN jsonb_build_object('result', 'handed_over', 'payout_id', NULL, 'by', p_by, 'free', true);
  END IF;
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents + v_rate);
  INSERT INTO public.declutter_payouts (order_id, seller_id, items_cents, delivery_cents, debt_cents, amount_cents, status)
  VALUES (o.id, o.seller_id, o.items_cents, v_rate, v_debt, o.items_cents + v_rate - v_debt,
          CASE WHEN o.items_cents + v_rate - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The words depend on what is due and whether the seller can be paid (lh-money-escrow review 2.1).
  -- 141d: the payout waits until the sale is final, 24 hours after the handover (an admin's decision is final at once).
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
    format('The handover of %s is done. ', public.declutter_order_items_named(o.id)) ||
    CASE
      WHEN o.items_cents + v_rate - v_debt = 0 THEN
        format('This sale paid off the $%s you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format(CASE WHEN p_by = 'admin' THEN 'Set up payouts in Settings to get your $%s. We send it as soon as you do.'
                    ELSE 'Set up payouts in Settings to get your $%s. We send it once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.' END,
               to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
      WHEN p_by = 'admin' THEN format('$%s is on its way to your payout account.', to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
      ELSE format('We send your $%s once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.',
                  to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/declutter?view=selling', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
    format('The handover of %s is done', public.declutter_order_items_named(o.id)) ||
    CASE WHEN p_by = 'admin' THEN ' and the sale is final. Leave the seller a review.'
         ELSE '. If something is wrong with it, you can ask the seller for a refund within 24 hours. Leave the seller a review.' END
    || CASE WHEN public.declutter_delivery_tip_open(o.id) THEN ' You can add a tip for your Helpr in Buying.' ELSE '' END,
    '/declutter?view=cart', o.seller_id);
  RETURN jsonb_build_object('result', 'handed_over', 'payout_id', v_payout, 'by', p_by)
         || CASE WHEN v_task_out IS NOT NULL THEN jsonb_build_object('helpr_payout_id', v_task_out->'helpr_payout_id') ELSE '{}'::jsonb END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_complete_handover(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_delivery_on_task_event(p_order_id uuid, p_task uuid, p_event text, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  t public.helpr_tasks;
  v_out jsonb;
  v_refund uuid;
  v_problem uuid;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF p_event = 'accepted' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'A Helpr took your delivery',
      format('Pickup from the seller is %s. They leave it at your door with a photo.',
             to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
      '/declutter?view=cart', t.helpr_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Helpr pickup booked',
      format('A Helpr picks up %s %s. Have it ready.', public.declutter_order_items_named(o.id),
             to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
      '/declutter?tab=selling', t.helpr_id);
  ELSIF p_event = 'released' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Finding another Helpr',
      'Your Helpr can''t make it. Your delivery is back up for another Helpr.', '/declutter?view=cart', NULL);
    PERFORM public.declutter_notify(o.seller_id, 'info', 'Pickup time cancelled',
      'The Helpr can''t make it. You''ll be told the new pickup time.', '/declutter?tab=selling', NULL);
  ELSIF p_event = 'picked_up' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your item is on its way',
      'The Helpr picked up your item. They leave it at your door with a photo; tap "I got it" when you have it.', '/declutter?view=cart', t.helpr_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Picked up',
      format('The Helpr picked up %s. You''re paid when the buyer has it.', public.declutter_order_items_named(o.id)),
      '/declutter?tab=selling', t.helpr_id);
  ELSIF p_event = 'delivered' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Delivered',
      format('The Helpr left %s at the drop-off address. Tap "I got it", or report a problem within 24 hours.',
             public.declutter_order_items_named(o.id)),
      '/declutter?view=cart', t.helpr_id);
  ELSIF p_event = 'confirmed' THEN
    -- The handover IS the delivery: the seller is paid (and the Helpr, below).
    v_out := public.declutter_complete_handover(o.id,
      CASE p_by WHEN 'code' THEN 'code' WHEN 'customer' THEN 'buyer' WHEN 'admin' THEN 'admin' ELSE 'auto' END);
    RETURN v_out;
  ELSIF p_event = 'unfilled' THEN
    -- Row 40: no Helpr in 48 h. The delivery fee goes back in full; the order
    -- becomes a pickup at the seller's home; the 7-day clock keeps running.
    IF o.status = 'paid' AND o.handover = 'delivery' THEN
      v_refund := public.declutter_delivery_refund(o.id, 'no_helpr');
      -- B76: a Helpr who backed out or never came late in the week can leave
      -- the buyer too little time to book a pickup, and the handover sweep
      -- would then close it as the BUYER's no-show (strike, fee kept). With
      -- under 48 h to the 7-day deadline the sale is closed instead as no one's
      -- fault: the delivery fee back in full (above), the rest under the
      -- no-fault policy (row 100: the card fee is kept), no strike, the item
      -- back on sale.
      IF o.paid_at + interval '7 days' < now() + interval '48 hours' THEN
        PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your delivery fell through',
          'No Helpr could deliver in time, so this sale is cancelled. What you paid for delivery comes back in full, and most of the rest of your payment.',
          '/declutter?view=cart', o.seller_id);
        v_out := public.declutter_close_paid_order(o.id, 'admin_no_fault', NULL, NULL, NULL);
        RETURN jsonb_build_object('result', 'unfilled', 'delivery_refund_id', v_refund, 'closed', v_out);
      END IF;
      UPDATE public.declutter_orders SET handover = 'pickup_home' WHERE id = o.id AND status = 'paid';
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'No Helpr took your delivery',
        format('The $%s you paid for delivery is coming back to your card. Book a time to pick up at the seller''s home before your 7-day deadline.',
               to_char(o.delivery_cents / 100.0, 'FM999990.00')),
        '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'The buyer will pick it up',
        'No Helpr took this delivery, so the buyer will book a pickup at your home.', '/declutter?tab=selling', o.buyer_id);
    END IF;
    RETURN jsonb_build_object('result', 'unfilled', 'delivery_refund_id', v_refund);
  ELSIF p_event = 'pickup_no_show' THEN
    -- B67 (revised 2026-10-16 after lh-authz-rls #3): the Helpr's report, with
    -- a photo at the pickup point, opens a problem on the order. The money
    -- waits (the problem holds it; the task stays taken, so the Helpr is not
    -- counted a no-show) and an admin decides: a seller no-show = refund the
    -- buyer, the seller's fault (row 19: everything back, card fee to the
    -- seller's debt, a strike); or pay the seller (the delivery fee goes
    -- back, B70).
    -- The Helpr's photo goes on the problem so the admin sees the evidence
    -- (lh-silent-failure re-review #1); p_by carries "<metres> m|<photo path>".
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths, is_seed)
    VALUES (o.id, t.helpr_id, 'helpr', 'no_show',
            format('The Helpr says the seller wasn''t there for the pickup at %s. Their photo at the pickup address (%s m away) is on the delivery.',
                   to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD FMHH12:MI AM'), COALESCE(split_part(p_by, '|', 1), '?')),
            CASE WHEN NULLIF(split_part(p_by, '|', 2), '') IS NULL THEN '{}'::text[] ELSE ARRAY[split_part(p_by, '|', 2)] END,
            o.is_seed)
    RETURNING id INTO v_problem;
    PERFORM public.declutter_notify(o.seller_id, 'info', 'The Helpr couldn''t pick up',
      'The Helpr says you weren''t there for the pickup. Louisiana Helpr will look at it and decide; the money waits until then.',
      '/declutter?tab=selling', t.helpr_id);
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Your delivery is on hold',
      'The Helpr couldn''t pick up your item from the seller. Louisiana Helpr will look at it and decide; you''ll be told.',
      '/declutter?view=cart', t.helpr_id);
    RETURN jsonb_build_object('result', 'reported', 'problem_id', v_problem);
  END IF;
  RETURN jsonb_build_object('result', p_event);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_on_task_event(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_on_task_event(uuid, uuid, text, text) TO service_role;
