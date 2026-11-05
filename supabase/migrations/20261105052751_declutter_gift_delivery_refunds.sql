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
--   5. The ship-void buyer notice names the gift balance for the gift share.
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
