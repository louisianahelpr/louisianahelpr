-- Shipping S3 follow-up (Q2259; Builder 114, 11-01). TEST MODE ONLY: declutter_shipping stays testers.
--
-- What was broken: a shipped order's page is a card HOLD. When the hold arrives for an order that no longer takes
-- it (closed, wrong amount, a second page), declutter_mark_order_paid records a 'pending' refund row, as it does for
-- a captured payment, and the webhook cancels the hold (nothing was ever taken). The refund row stayed 'pending', so
-- declutter-money's refund step (declutter_refunds_due: pending and 2 minutes old) would try to refund a cancelled
-- PaymentIntent up to 12 times, failing each time and paging ops, and the order's refund reads as owed forever.
--
-- The fix: declutter_ship_hold_refund_released(payment intent), called by the webhook once the hold is cancelled
-- (and again on a redelivery that finds the hold already cancelled). It closes that payment's refund row as
-- 'settled_by_hand' with settled_by_hand_cents 0 and a note saying no money was captured, so no refund is ever
-- tried. Only a row that is still 'pending' or 'failed', whose order is a 'ship' order or is gone (order_missing),
-- and never one of an order that is 'paid' (a taken payment). service_role only. Replay answers 'already'.
--
-- REPLAY-SAFETY: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.declutter_ship_hold_refund_released(p_payment_intent_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_handover text;
  v_status text;
BEGIN
  SELECT d.id, d.order_id, d.status INTO r FROM public.declutter_refunds d
   WHERE d.stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;
  IF r.status = 'settled_by_hand' THEN
    RETURN 'already';
  END IF;
  IF r.status NOT IN ('pending', 'failed') THEN
    RETURN 'refused';
  END IF;
  IF r.order_id IS NOT NULL THEN
    SELECT o.handover, o.status INTO v_handover, v_status FROM public.declutter_orders o WHERE o.id = r.order_id;
    IF v_handover IS DISTINCT FROM 'ship' OR (v_status = 'paid' AND EXISTS (
         SELECT 1 FROM public.declutter_orders o WHERE o.id = r.order_id AND o.stripe_payment_intent_id = p_payment_intent_id)) THEN
      RETURN 'refused';
    END IF;
  END IF;
  UPDATE public.declutter_refunds
     SET status = 'settled_by_hand', settled_by_hand_ref = p_payment_intent_id, settled_by_hand_cents = 0,
         settled_by_hand_note = 'Shipping: the card hold was released, so nothing was captured and nothing is owed back.'
   WHERE id = r.id;
  RETURN 'closed';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_hold_refund_released(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_ship_hold_refund_released(text) TO service_role;
