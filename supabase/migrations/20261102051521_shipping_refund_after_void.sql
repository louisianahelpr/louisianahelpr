-- Shipping S6 part 2d (Q2259; docs/specs/shipping-draft.md 5.3 row "Buyer cancels / admin buyer-fault": "items + fee
-- now; SHIPPING only when the void refund succeeds", section 11 fix 3 and fix 5). TEST MODE ONLY: declutter_shipping
-- stays testers; ship orders exist only for testers.
--
-- What was broken: a shipped order's total holds its shipping, but no refund split it out.
--   * A buyer-fault close (admin_buyer_fault from an admin's decision; buyer_no_show) went to declutter_record_refund's
--     keep_buyer_fee check, which knows items + fee + tax + delivery only, so it raised refund_amount_unknown: the
--     admin could not decide the problem at all.
--   * Any other buyer-side close (keep_card_fee) refunded the shipping at once, though the label was bought and its
--     void can be rejected (the platform would pay the label).
-- The fix:
--   1. declutter_shipping_reserved_cents(order) (like declutter_delivery_reserved_cents): the order's shipping_cents
--      when it is a ship order whose label was bought (bought / void_requested / voided / void_rejected), else 0.
--   2. declutter_close_paid_order (restated from 20261101000817; only the marked parts change): for a buyer-fault reason
--      (buyer_no_show, admin_buyer_fault, buyer_cancelled, buyer_restarted_checkout) the refund is total - delivery
--      reserved - shipping reserved. A test label not yet scanned is sent to be voided (bought -> void_requested); a
--      live label is paged (log_cron_defect), never voided by itself; a label already voided refunds the shipping at
--      once. The notices say the shipping comes back once the label is cancelled, and tell the seller not to ship it.
--      Seller-fault and every other reason are unchanged (everything back now).
--   3. declutter_record_refund (restated from 20261031231150; only the keep_buyer_fee amount check changes): the whole
--      paid order now also counts shipping - shipping reserved.
--   4. declutter_ship_refund_after_void(order) + an AFTER UPDATE trigger on shipments: when a label becomes 'voided' on
--      an order refunded for a buyer-fault reason whose refund left the shipping out, ONE shipping refund row is
--      written in declutter_delivery_refunds (reason 'ship_void_refunded', refund_cents = shipping_cents; order_id is
--      UNIQUE there, and a ship order has no Helpr delivery). declutter-money's delivery-refund loop sends it (amount =
--      refund_cents, its own idempotency key) and declutter_order_refunds_recorded_cents already counts it (fix 17).
--      The buyer is told. A void_rejected label writes nothing: the buyer keeps no shipping.
--   The reason CHECK of declutter_delivery_refunds gains 'ship_void_refunded' (prod name read 11-01:
--   declutter_delivery_refunds_reason_check).
-- Service role only. Proof: src/test/pglite/shippingRefundAfterVoid.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red;
-- planted defects; Supabase's default execute grant emulated). REPLAY-SAFETY: CREATE OR REPLACE, DROP ... IF EXISTS.

ALTER TABLE public.declutter_delivery_refunds DROP CONSTRAINT IF EXISTS declutter_delivery_refunds_reason_check;
ALTER TABLE public.declutter_delivery_refunds ADD CONSTRAINT declutter_delivery_refunds_reason_check
  CHECK (reason IN ('no_helpr', 'delivery_not_done', 'ship_void_refunded'));

CREATE OR REPLACE FUNCTION public.declutter_shipping_reserved_cents(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN o.handover IS DISTINCT FROM 'ship' OR o.shipping_cents <= 0 THEN 0
    WHEN EXISTS (SELECT 1 FROM public.shipments s WHERE s.declutter_order_id = o.id
                  AND s.label_state IN ('bought', 'void_requested', 'voided', 'void_rejected')) THEN o.shipping_cents
    ELSE 0 END
    FROM public.declutter_orders o WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_shipping_reserved_cents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_shipping_reserved_cents(uuid) TO service_role;

-- The held-back shipping goes back once the label is voided. Exactly once (order_id UNIQUE); only for an order
-- refunded for a buyer-fault reason whose refund left the shipping out.
CREATE OR REPLACE FUNCTION public.declutter_ship_refund_after_void(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_id uuid;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.id IS NULL OR o.handover IS DISTINCT FROM 'ship' OR o.status IS DISTINCT FROM 'refunded' OR o.shipping_cents <= 0
     OR o.stripe_payment_intent_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.shipments s WHERE s.declutter_order_id = o.id AND s.label_state = 'voided')
     OR NOT EXISTS (SELECT 1 FROM public.declutter_refunds d
                     WHERE d.order_id = o.id AND d.stripe_payment_intent_id = o.stripe_payment_intent_id
                       AND d.reason IN ('buyer_no_show', 'admin_buyer_fault', 'buyer_cancelled', 'buyer_restarted_checkout')
                       AND d.paid_cents <= o.total_cents - o.shipping_cents) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.declutter_delivery_refunds (order_id, stripe_payment_intent_id, reason, refund_cents)
  VALUES (o.id, o.stripe_payment_intent_id, 'ship_void_refunded', o.shipping_cents)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Shipping refund on its way',
      format('The shipping label was cancelled, so the $%s you paid for shipping is coming back to your card.',
             to_char(o.shipping_cents / 100.0, 'FM999990.00')),
      '/declutter?tab=buying', o.seller_id);
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_refund_after_void(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_ship_refund_after_void(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_ship_voided_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.label_state = 'voided' AND OLD.label_state IS DISTINCT FROM 'voided' AND NEW.declutter_order_id IS NOT NULL THEN
    PERFORM public.declutter_ship_refund_after_void(NEW.declutter_order_id);
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_voided_refund() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shipments_voided_refund ON public.shipments;
CREATE TRIGGER trg_shipments_voided_refund AFTER UPDATE OF label_state ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.declutter_ship_voided_refund();

CREATE OR REPLACE FUNCTION public.declutter_record_refund(p_order_id uuid, p_payment_intent_id text, p_reason text,
  p_paid_cents integer, p_card_fee_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
  v_policy text;
  v_fee integer;
  v_kept integer := 0;
  v_seller uuid;
  v_order record;
BEGIN
  SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  v_policy := CASE WHEN p_reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described', 'helpr_fault') THEN 'full_seller_pays_fee'
                   WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault', 'refund_request_full') THEN 'keep_card_fee'
                   WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                   WHEN p_reason = 'refund_request_part' THEN 'agreed_part'
                   ELSE 'full_platform_absorbs' END;
  IF v_policy = 'agreed_part' THEN
    -- Only the offered amount is right for a part refund; this function cannot know it.
    RAISE EXCEPTION 'refund_amount_unknown' USING ERRCODE = '55000';
  END IF;
  v_fee := least(p_paid_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(p_paid_cents))));
  IF v_policy = 'keep_card_fee' THEN
    -- A refund is never zero: at least 1 cent goes back.
    v_fee := least(v_fee, p_paid_cents - 1);
  ELSIF v_policy = 'keep_buyer_fee' THEN
    -- CHANGED (Shipping S6 2d): a shipped order's shipping is in its total; a bought label's shipping is split out of
    -- this refund (declutter_shipping_reserved_cents) and goes back on its own once the label is voided.
    SELECT o.items_cents, o.premium_cents, o.tax_cents, o.delivery_cents, o.shipping_cents INTO v_order
      FROM public.declutter_orders o WHERE o.id = p_order_id;
    IF v_order.premium_cents IS NULL OR v_order.premium_cents <= 0
       OR p_paid_cents IS DISTINCT FROM v_order.items_cents + v_order.premium_cents + v_order.tax_cents
                                        + v_order.delivery_cents - public.declutter_delivery_reserved_cents(p_order_id)
                                        + v_order.shipping_cents - public.declutter_shipping_reserved_cents(p_order_id) THEN
      -- Only a whole paid order can keep its fee; anything else is a bug, never a guess.
      RAISE EXCEPTION 'refund_amount_unknown' USING ERRCODE = '55000';
    END IF;
    v_kept := v_order.premium_cents;
  END IF;
  INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents,
                                        kept_cents, refund_cents)
  VALUES (p_order_id, p_payment_intent_id, p_reason, v_policy, p_paid_cents, v_fee, v_kept,
          CASE WHEN v_policy = 'keep_card_fee' THEN p_paid_cents - v_fee
               WHEN v_policy = 'keep_buyer_fee' THEN p_paid_cents - v_kept
               ELSE p_paid_cents END)
  ON CONFLICT (stripe_payment_intent_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
    RETURN v_id;
  END IF;
  IF v_policy = 'full_seller_pays_fee' AND v_fee > 0 THEN
    SELECT o.seller_id INTO v_seller FROM public.declutter_orders o WHERE o.id = p_order_id;
    -- CHANGED (BUY-36): on the Helpr's fault the Helpr owes it (owner 10-30), out of their next delivery or Declutter payout.
    IF p_reason = 'helpr_fault' THEN
      SELECT t.helpr_id INTO v_seller FROM public.helpr_tasks t WHERE t.source_kind = 'declutter_delivery' AND t.source_id = p_order_id;
    END IF;
    IF v_seller IS NOT NULL THEN
      INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents)
      VALUES (v_seller, v_id, v_fee, v_fee)
      ON CONFLICT (refund_id) DO NOTHING;
      -- D2-6 (audit 1b #6): the seller is told when a refund leaves them owing money, and where it comes from.
      -- In words, never a fee name (the owner's rule: members see no fee words); the amount is what they owe.
      -- CHANGED (BUY-30): the notice names the item (no other party is passed, so the writer could not) and
      -- opens Selling by its tab address.
      IF FOUND THEN
        PERFORM public.declutter_notify(v_seller, 'declutter_refunds', 'You owe from a refund',
          -- BUY-36 (CHANGED): a Helpr's own fault comes out of their next payout, and opens their deliveries.
          CASE WHEN p_reason = 'helpr_fault'
               THEN format('This refund on %s leaves you owing $%s. It comes out of your next Declutter payout.',
                           public.declutter_order_items_named(p_order_id), to_char(v_fee / 100.0, 'FM999990.00'))
               ELSE format('This refund on %s leaves you owing $%s. It comes out of your next Declutter sale''s payout.',
                           public.declutter_order_items_named(p_order_id), to_char(v_fee / 100.0, 'FM999990.00')) END,
          CASE WHEN p_reason = 'helpr_fault' THEN '/declutter?tab=deliver' ELSE '/declutter?tab=selling' END, NULL);
      END IF;
    END IF;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_close_paid_order(p_order_id uuid, p_reason text, p_strike_side text,
  p_strike_reason text, p_why text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_refund uuid;
  v_seller_fault boolean := p_reason IN ('seller_no_show', 'not_as_described', 'seller_backed_out');
  r record;
  v_struck boolean := false;
  v_task public.helpr_tasks;
  v_reserved integer;
  -- Shipping S6 2d: the shipping held back from a buyer-fault refund until the label is voided.
  v_ship integer := 0;
  v_label record;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  -- A free claim (20261027170717) has no payment to refund: it closes, the strike rules still apply.
  IF o.status IS NOT DISTINCT FROM 'paid' AND o.paid_with = 'free' THEN
    UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
    FOR r IN
      UPDATE public.declutter_cart_items c
         SET status = CASE WHEN v_seller_fault THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
       WHERE c.order_id = o.id AND c.status = 'paid'
      RETURNING c.item_id, c.id
    LOOP
      UPDATE public.declutter_items SET status = CASE WHEN v_seller_fault THEN 'withdrawn' ELSE 'live' END, updated_at = now()
       WHERE id = r.item_id AND status = 'sold';
      IF p_strike_side IS NOT NULL AND NOT v_struck THEN
        -- The callers' words speak of refunds and card fees; a free pickup has neither.
        PERFORM public.declutter_give_strike(CASE WHEN p_strike_side = 'seller' THEN o.seller_id ELSE o.buyer_id END,
          p_strike_side, p_strike_reason, r.item_id,
          CASE WHEN p_strike_side = 'seller' THEN 'You did not show up for a booked free Declutter pickup.'
               ELSE 'You missed a booked free Declutter pickup.' END, r.id);
        v_struck := true;
      END IF;
    END LOOP;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Free pickup cancelled',
      'This free pickup was cancelled. Nothing was charged.', '/declutter?view=cart', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Free pickup cancelled',
      CASE WHEN v_seller_fault THEN 'This free pickup was cancelled.'
           ELSE 'This free pickup was cancelled. Your item is back up.' END,
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'cancelled', 'free', true);
  END IF;
  IF o.status IS DISTINCT FROM 'paid' OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = o.id) THEN
    RAISE EXCEPTION 'already_paid_out' USING ERRCODE = '55000';
  END IF;
  -- Slice 5: the order's Helpr task.
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF t;
  IF v_task.id IS NOT NULL THEN
    IF v_task.status IN ('picked_up', 'delivered') THEN
      PERFORM public.helpr_task_confirm(v_task.id, 'admin', NULL);
    ELSIF v_task.status IN ('open', 'accepted') THEN
      PERFORM public.helpr_task_close(v_task.id, 'cancelled', p_reason);
    END IF;
  END IF;
  v_reserved := public.declutter_delivery_reserved_cents(o.id);
  -- CHANGED (Shipping S6 2d, spec 5.3 / section 11 fix 5): a buyer-fault close of a shipped order whose label was bought
  -- refunds everything else now and the SHIPPING only once the label is voided (declutter_ship_refund_after_void). A
  -- seller-fault close still refunds everything now (a rejected void is the seller's debt: 20261102045553).
  IF p_reason IN ('buyer_no_show', 'admin_buyer_fault', 'buyer_cancelled', 'buyer_restarted_checkout') THEN
    v_ship := COALESCE(public.declutter_shipping_reserved_cents(o.id), 0);
  END IF;
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents - v_reserved - v_ship, o.card_fee_cents);
  UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
  FOR r IN
    UPDATE public.declutter_cart_items c
       SET status = CASE WHEN v_seller_fault THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
     WHERE c.order_id = o.id AND c.status = 'paid'
    RETURNING c.item_id, c.id
  LOOP
    UPDATE public.declutter_items SET status = CASE WHEN v_seller_fault THEN 'withdrawn' ELSE 'live' END, updated_at = now()
     WHERE id = r.item_id AND status = 'sold';
    -- One strike per order, recorded against its first line.
    IF p_strike_side IS NOT NULL AND NOT v_struck THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_strike_side = 'seller' THEN o.seller_id ELSE o.buyer_id END,
        p_strike_side, p_strike_reason, r.item_id, p_why, r.id);
      v_struck := true;
    END IF;
  END LOOP;
  -- S6 2d: the held-back shipping. A test label not yet handed to the carrier is sent to be voided (the label worker
  -- voids it; the same compare-and-set as requestShipVoid); a live one is paged, never voided by itself. A label
  -- already voided gives the shipping back at once. A rejected void or a parcel already scanned: the buyer keeps no
  -- shipping (spec 5.3).
  IF v_ship > 0 THEN
    SELECT s.id, s.label_state, s.label_mode, s.accepted_at INTO v_label
      FROM public.shipments s WHERE s.declutter_order_id = o.id FOR UPDATE;
    IF v_label.label_state = 'bought' AND v_label.accepted_at IS NULL THEN
      IF v_label.label_mode = 'test' THEN
        UPDATE public.shipments SET label_state = 'void_requested', last_error = NULL, next_attempt_at = now()
         WHERE id = v_label.id AND label_state = 'bought' AND accepted_at IS NULL;
      ELSE
        PERFORM public.log_cron_defect('declutter_close_paid_order-live-void', o.id::text,
          format('order %s was cancelled on the buyer (%s); its LIVE label must be voided by hand, then the shipping refunded', o.id, p_reason));
      END IF;
    ELSIF v_label.label_state = 'voided' THEN
      PERFORM public.declutter_ship_refund_after_void(o.id);
    END IF;
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    CASE WHEN v_seller_fault AND v_reserved > 0
         THEN format('$%s is coming back to your card. What you paid for delivery went to the Helpr who made the trip.',
                     to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN v_seller_fault
         THEN format('All $%s is coming back to your card.', to_char(o.total_cents / 100.0, 'FM999990.00'))
         -- CHANGED (LEAD-ADMIN-HELPR-FAULT): the Helpr's fault refunds everything, delivery included (the task failed,
         -- so nothing is reserved); it said "The card fee is not refunded".
         WHEN p_reason = 'helpr_fault'
         THEN format('All $%s is coming back to your card, delivery included.', to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         -- S6 2d: the shipping is said apart: it comes back once the label is cancelled.
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault') AND v_ship > 0
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card. The $%s for shipping comes back once the shipping label is cancelled.'
                          ELSE 'The item price, $%s, is coming back to your card. The $%s for shipping comes back once the shipping label is cancelled.' END,
                     to_char((o.total_cents - v_reserved - v_ship - o.premium_cents) / 100.0, 'FM999990.00'), to_char(v_ship / 100.0, 'FM999990.00'))
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault')
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card.'
                          ELSE 'The item price, $%s, is coming back to your card.' END,
                     to_char((o.total_cents - v_reserved - o.premium_cents) / 100.0, 'FM999990.00'))
         WHEN v_ship > 0
         THEN format('Your refund is on its way. The $%s for shipping comes back once the shipping label is cancelled.', to_char(v_ship / 100.0, 'FM999990.00'))
         ELSE 'Your refund is on its way.' END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Sale cancelled',
    CASE WHEN v_seller_fault THEN 'This sale was cancelled and the buyer refunded.'
         -- S6 2d: a shipped sale cancelled before the parcel left: the label is cancelled, so nothing goes in the mail.
         WHEN v_ship > 0 THEN 'This sale was cancelled and the buyer refunded. Don''t ship it: its label is being cancelled. Your item is back on sale.'
         ELSE 'This sale was cancelled and the buyer refunded. Your item is back on sale.' END,
    '/declutter?view=sales', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) TO service_role;
