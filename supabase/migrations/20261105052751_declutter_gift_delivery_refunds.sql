-- Q2106 S3b step 4 part 2 (Builder 3, 11-04; lead-approved S3b plan 9:4x PM): a Declutter delivery-fee or shipping
-- refund row (declutter_delivery_refunds) says how much of it goes back to the buyer's GIFT balance, the same way
-- declutter_refunds does since 20261105042758.
--
-- What was broken on a gift-paid order:
--   * declutter_delivery_refund (no_helpr / delivery_not_done; newest 20261027153244) raised no_delivery_fee when the
--     order had no payment intent, so a gift-only order whose Helpr delivery never happened kept its delivery fee.
--   * declutter_ship_refund_after_void (ship_void_refunded; newest 20261102051521) RETURNed NULL for a NULL payment
--     intent, so a gift-only shipped order never got its held-back shipping back; and it matched the buyer-fault
--     refund row by payment intent, which a gift-only row does not have.
--   * Both wrote the WHOLE fee as a card refund, so on a gift+card order the cron asked Stripe to refund more of the
--     card charge than the card's share, and the gift share never went back to the gift balance.
-- The fix (the declutter_refunds rules, unchanged in meaning):
--   1. declutter_delivery_refunds.gift_refund_cents (0..refund_cents). refund_cents stays the TOTAL given back, so
--      every existing CHECK holds. The payment intent may be NULL only when all of it goes to the gift balance
--      (order_id is already NOT NULL UNIQUE here, so one row per order still holds).
--   2. Both writers split the fee with declutter_refund_gift_split (the order's NET gift, proportional on a mixed
--      order, all of it on a gift-only order), and accept a gift-only order (NULL payment intent, gift_cents > 0).
--   3. declutter_delivery_refunds_due returns refund_cents = the CARD part (decided here in SQL, as refundsKeepTheCardFee
--      requires) plus gift_refund_cents. declutter-money restores the gift share FIRST under the row's own key
--      ('declutter_delivery_refund:'||id: a retry answers already_restored, never a second credit), then refunds the
--      card part; a gift-only row never reaches Stripe.
--   4. declutter_order_refunds_recorded_cents (what went back on the CARD charge; feeds wholeCharge) counts only the
--      card part of a delivery refund row too.
--   5. The ship-void buyer notice names the gift balance for the gift share, and so does declutter_close_paid_order's
--      refund notice (step 5, below).
-- Service role only (grants unchanged). Proof: src/test/pglite/declutterGiftDeliveryRefunds.pglite.mjs (applied 3x;
-- NEW_MIGRATION=skip is red). REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS, CREATE OR REPLACE,
-- DROP FUNCTION IF EXISTS for the one return-type change.

ALTER TABLE public.declutter_delivery_refunds ADD COLUMN IF NOT EXISTS gift_refund_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.declutter_delivery_refunds DROP CONSTRAINT IF EXISTS declutter_delivery_refunds_gift_share;
ALTER TABLE public.declutter_delivery_refunds ADD CONSTRAINT declutter_delivery_refunds_gift_share
  CHECK (gift_refund_cents >= 0 AND gift_refund_cents <= refund_cents);

ALTER TABLE public.declutter_delivery_refunds ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;

ALTER TABLE public.declutter_delivery_refunds DROP CONSTRAINT IF EXISTS declutter_delivery_refunds_gift_only_no_card;
ALTER TABLE public.declutter_delivery_refunds ADD CONSTRAINT declutter_delivery_refunds_gift_only_no_card
  CHECK (stripe_payment_intent_id IS NOT NULL OR gift_refund_cents = refund_cents);

-- Restated from its newest definition (20261027153244_declutter_seller_delivery); the changes are marked CHANGED.
CREATE OR REPLACE FUNCTION public.declutter_delivery_refund(p_order_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_id uuid;
  v_gift integer;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  -- CHANGED (Q2106 S3b): a gift-only order (no payment intent, a gift share) gets its delivery fee back too.
  IF o.delivery_cents <= 0 OR (o.stripe_payment_intent_id IS NULL AND COALESCE(o.gift_cents, 0) <= 0)
     OR o.handover = 'seller_delivery' THEN
    RAISE EXCEPTION 'no_delivery_fee' USING ERRCODE = '55000';
  END IF;
  -- CHANGED (Q2106 S3b): the gift share of the fee goes back to the gift balance, the rest to the card.
  v_gift := COALESCE(public.declutter_refund_gift_split(o.id, o.delivery_cents), 0);
  INSERT INTO public.declutter_delivery_refunds (order_id, stripe_payment_intent_id, reason, refund_cents, gift_refund_cents)
  VALUES (o.id, o.stripe_payment_intent_id, p_reason, o.delivery_cents, v_gift)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.declutter_delivery_refunds WHERE order_id = o.id;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_refund(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_refund(uuid, text) TO service_role;

-- Restated from its newest definition (20261102051521_shipping_refund_after_void); the changes are marked CHANGED.
CREATE OR REPLACE FUNCTION public.declutter_ship_refund_after_void(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_id uuid;
  v_gift integer;
  v_card integer;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  -- CHANGED (Q2106 S3b): a gift-only order has no payment intent; its buyer-fault refund row is matched by
  -- IS NOT DISTINCT FROM (both NULL), never skipped.
  IF o.id IS NULL OR o.handover IS DISTINCT FROM 'ship' OR o.status IS DISTINCT FROM 'refunded' OR o.shipping_cents <= 0
     OR (o.stripe_payment_intent_id IS NULL AND COALESCE(o.gift_cents, 0) <= 0)
     OR NOT EXISTS (SELECT 1 FROM public.shipments s WHERE s.declutter_order_id = o.id AND s.label_state = 'voided')
     OR NOT EXISTS (SELECT 1 FROM public.declutter_refunds d
                     WHERE d.order_id = o.id AND d.stripe_payment_intent_id IS NOT DISTINCT FROM o.stripe_payment_intent_id
                       AND d.reason IN ('buyer_no_show', 'admin_buyer_fault', 'buyer_cancelled', 'buyer_restarted_checkout')
                       AND d.paid_cents <= o.total_cents - o.shipping_cents) THEN
    RETURN NULL;
  END IF;
  -- CHANGED (Q2106 S3b): the gift share of the shipping goes back to the gift balance, the rest to the card.
  v_gift := COALESCE(public.declutter_refund_gift_split(o.id, o.shipping_cents), 0);
  v_card := o.shipping_cents - v_gift;
  INSERT INTO public.declutter_delivery_refunds (order_id, stripe_payment_intent_id, reason, refund_cents, gift_refund_cents)
  VALUES (o.id, o.stripe_payment_intent_id, 'ship_void_refunded', o.shipping_cents, v_gift)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    -- CHANGED (Q2106 S3b): the notice names where each part goes.
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Shipping refund on its way',
      CASE WHEN v_gift <= 0 THEN
             format('The shipping label was cancelled, so the $%s you paid for shipping is coming back to your card.',
                    to_char(o.shipping_cents / 100.0, 'FM999990.00'))
           WHEN v_card <= 0 THEN
             format('The shipping label was cancelled, so the $%s you paid for shipping is going back to your gift balance.',
                    to_char(o.shipping_cents / 100.0, 'FM999990.00'))
           ELSE
             format('The shipping label was cancelled, so the $%s you paid for shipping is coming back: $%s to your card and $%s to your gift balance.',
                    to_char(o.shipping_cents / 100.0, 'FM999990.00'), to_char(v_card / 100.0, 'FM999990.00'),
                    to_char(v_gift / 100.0, 'FM999990.00')) END,
      '/declutter?tab=buying', o.seller_id);
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_refund_after_void(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_ship_refund_after_void(uuid) TO service_role;

-- Restated from its newest definition (20261017055505_declutter_helpr_delivery); the changes are marked CHANGED. The
-- return type changes, so the function is dropped first (inside this one migration).
DROP FUNCTION IF EXISTS public.declutter_delivery_refunds_due(integer);
CREATE OR REPLACE FUNCTION public.declutter_delivery_refunds_due(p_limit integer)
RETURNS TABLE (delivery_refund_id uuid, reason text, order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text,
               refund_cents integer, attempts integer, checkout_session_id text, gift_refund_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- CHANGED (Q2106 S3b): refund_cents here is the CARD part (what Stripe refunds), decided here in SQL, never in the
  -- edge function; gift_refund_cents is the part that goes back to the gift balance. Their sum is the row's total.
  SELECT d.id, d.reason, d.order_id, o.buyer_id, o.seller_id, d.stripe_payment_intent_id,
         d.refund_cents - d.gift_refund_cents, d.attempts,
         o.stripe_checkout_session_id, d.gift_refund_cents
    FROM public.declutter_delivery_refunds d
    JOIN public.declutter_orders o ON o.id = d.order_id
   WHERE d.status IN ('pending', 'failed') AND d.next_attempt_at <= now() AND d.attempts < 12
   ORDER BY d.created_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_refunds_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_refunds_due(integer) TO service_role;

-- Restated from its newest definition (20261105042758_declutter_gift_refund_rows); the one change is marked CHANGED.
CREATE OR REPLACE FUNCTION public.declutter_order_refunds_recorded_cents(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- CHANGED (Q2106 S3b): the card part of each refund row only.
  SELECT (COALESCE((SELECT sum(r.refund_cents - r.gift_refund_cents) FROM public.declutter_refunds r
                     WHERE r.order_id = o.id AND r.stripe_payment_intent_id = o.stripe_payment_intent_id
                       AND r.status = 'succeeded'), 0)
        -- CHANGED (Q2106 S3b step 4 part 2): a delivery/shipping refund row counts its card part only too.
        + COALESCE((SELECT sum(d.refund_cents - d.gift_refund_cents) FROM public.declutter_delivery_refunds d
                     WHERE d.order_id = o.id AND d.stripe_payment_intent_id = o.stripe_payment_intent_id
                       AND d.status = 'succeeded'), 0)
        -- Q2352: a setup fee sent back because the account had paid it elsewhere.
        + CASE WHEN o.setup_fee_state = 'refunded' THEN o.setup_fee_cents ELSE 0 END)::integer
    FROM public.declutter_orders o WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_refunds_recorded_cents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_order_refunds_recorded_cents(uuid) TO service_role;

-- Q2106 S3b step 5: declutter_close_paid_order's buyer notice said every refund "is coming back to your card". On a
-- gift-paid order the refund row's gift share goes back to the gift balance (declutter-money restores it first), so the
-- notice now names it. declutter_refund_notice_names_gift(refund row, text) returns the text unchanged for a card-only
-- refund; with a gift share it says "coming back to you" and adds "$X goes back to your gift balance and $Y to your
-- card" (or "It all goes back to your gift balance ($X)."). declutter_close_paid_order is restated from its newest
-- definition (20261103203204_shipping_lost_sweep); the one change (the wrap) is marked CHANGED (Q2106 S3b step 5).
CREATE OR REPLACE FUNCTION public.declutter_refund_notice_names_gift(p_refund_id uuid, p_text text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_gift integer;
  v_total integer;
BEGIN
  SELECT d.gift_refund_cents, d.refund_cents INTO v_gift, v_total FROM public.declutter_refunds d WHERE d.id = p_refund_id;
  IF p_text IS NULL OR COALESCE(v_gift, 0) <= 0 THEN
    RETURN p_text;
  END IF;
  RETURN replace(p_text, 'is coming back to your card', 'is coming back to you')
    || CASE WHEN v_gift >= v_total
            THEN format(' It all goes back to your gift balance ($%s).', to_char(v_gift / 100.0, 'FM999990.00'))
            ELSE format(' $%s goes back to your gift balance and $%s to your card.',
                        to_char(v_gift / 100.0, 'FM999990.00'), to_char((v_total - v_gift) / 100.0, 'FM999990.00')) END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_notice_names_gift(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_notice_names_gift(uuid, text) TO service_role;

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
  v_seller_fault boolean := p_reason IN ('seller_no_show', 'not_as_described', 'seller_backed_out', 'ship_lost');
  r record;
  v_struck boolean := false;
  v_task public.helpr_tasks;
  v_reserved integer;
  -- Shipping S6 2d: the shipping held back from a buyer-fault refund until the label is voided.
  v_ship integer := 0;
  v_label record;
  -- CHANGED (Q1928 gap 3): the reason the refund is recorded under.
  v_fee_reason text := p_reason;
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
  -- CHANGED (Q1928 gap 3, lead 11-02): a seller who can no longer sell (declutter_seller_out: banned, suspended, 3
  -- strikes, under 18, flagged business-like) when a paid sale is closed as the buyer's no-show or nobody's fault owes
  -- the card fee, as at payment (owner answer 7): the refund is recorded as seller_out, so the buyer gets every cent
  -- (less a Helpr's delivery reserve) and the fee is the seller's debt. Strikes and the item's status are unchanged.
  IF p_reason IN ('buyer_no_show', 'admin_no_fault') AND public.declutter_seller_out(o.seller_id) THEN
    v_fee_reason := 'seller_out';
  END IF;
  -- CHANGED (Shipping S6 2d, spec 5.3 / section 11 fix 5): a buyer-fault close of a shipped order whose label was bought
  -- refunds everything else now and the SHIPPING only once the label is voided (declutter_ship_refund_after_void). A
  -- seller-fault close still refunds everything now (a rejected void is the seller's debt: 20261102045553).
  IF v_fee_reason IN ('buyer_no_show', 'admin_buyer_fault', 'buyer_cancelled', 'buyer_restarted_checkout') THEN  -- CHANGED (Q1928 gap 3)
    v_ship := COALESCE(public.declutter_shipping_reserved_cents(o.id), 0);
  END IF;
  -- CHANGED (Q1935, restored: 2d was restated from a base before 20261102040952): the card fee prorated to the part
  -- refunded. CHANGED (Q1928 gap 3): recorded under v_fee_reason.
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, v_fee_reason, o.total_cents - v_reserved - v_ship,
    public.declutter_card_fee_left(o.card_fee_cents, o.total_cents, v_reserved));
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
  -- CHANGED (Q2106 S3b step 5): the text is unchanged; declutter_refund_notice_names_gift names the gift balance
  -- for the refund row's gift share (a card-only refund's text comes back as is).
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way', public.declutter_refund_notice_names_gift(v_refund,
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
         -- CHANGED (Q1928 gap 3): an out seller's close gives every cent back (less a Helpr's delivery reserve).
         WHEN v_fee_reason = 'seller_out'
         THEN format('$%s is coming back to your card.', to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault') AND v_ship > 0
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card. The $%s for shipping comes back once the shipping label is cancelled.'
                          ELSE 'The item price, $%s, is coming back to your card. The $%s for shipping comes back once the shipping label is cancelled.' END,
                     to_char((o.total_cents - v_reserved - v_ship - o.premium_cents) / 100.0, 'FM999990.00'), to_char(v_ship / 100.0, 'FM999990.00'))
         -- CHANGED (A3-72): a seller delivery nobody set a time for in 7 days: everything back.
         WHEN p_reason = 'delivery_never_booked'
         THEN format('No delivery time was picked within 7 days, so the order is cancelled. All $%s is coming back to your card.',
                     to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault')
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card.'
                          ELSE 'The item price, $%s, is coming back to your card.' END,
                     to_char((o.total_cents - v_reserved - o.premium_cents) / 100.0, 'FM999990.00'))
         WHEN v_ship > 0
         THEN format('Your refund is on its way. The $%s for shipping comes back once the shipping label is cancelled.', to_char(v_ship / 100.0, 'FM999990.00'))
         ELSE 'Your refund is on its way.' END),
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Sale cancelled',
    CASE WHEN v_seller_fault THEN 'This sale was cancelled and the buyer refunded.'
         -- S6 2d: a shipped sale cancelled before the parcel left: the label is cancelled, so nothing goes in the mail.
         WHEN v_ship > 0 THEN 'This sale was cancelled and the buyer refunded. Don''t ship it: its label is being cancelled. Your item is back on sale.'
         -- CHANGED (A3-72)
         WHEN p_reason = 'delivery_never_booked'
         THEN 'No delivery time was picked within 7 days, so this sale was cancelled and the buyer refunded. Your item is back on sale.'
         ELSE 'This sale was cancelled and the buyer refunded. Your item is back on sale.' END,
    '/declutter?view=sales', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) TO service_role;
