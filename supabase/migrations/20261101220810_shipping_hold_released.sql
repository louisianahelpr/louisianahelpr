-- Shipping S3 follow-up (Q2259; B113 handoff gaps 1 and 2; Builder 114, 11-01). TEST MODE ONLY: declutter_shipping
-- stays testers until the owner says.
--
-- What was broken:
--   1. A shipped order is paid by a card HOLD. When its label could not be bought, the label worker cancelled the
--      hold and set ship_capture = 'released', but the order itself stayed status 'paid': the buyer's Buying tab and
--      the seller's Selling tab still showed a live sale, its items stayed 'sold' (never back on sale), and nothing
--      told either side. Ops was paged "close it by hand".
--   2. The order's one-time account setup fee: declutter_mark_order_paid claims it when the hold is recorded
--      (profiles.onboarding_fee_paid = true, setup_fee_state 'claimed'), or marks it 'refund_due' when the account
--      had already paid it elsewhere. On a hold, nothing was taken yet, so
--        - a released hold left the account marked as having paid a fee it never paid ('claimed'), and
--        - a 'refund_due' fee could not be refunded (there is no charge to refund) and was never settled.
--
-- The fix (two service-role functions; the label worker calls them):
--   declutter_ship_hold_released(order): on a 'ship' order that is 'paid' with its hold 'held' or 'released' and
--     NO bought label: the hold is 'released', the order closes (status 'expired', close_reason 'not_payable': no
--     money moved, so never 'refunded' and never a refund row), its lines go 'removed' (no strike for anyone: the
--     label failing is nobody's fault), its sold items go back 'live', a claimed setup fee is given back to the
--     account (onboarding_fee_paid false again: it was never charged) and the order's fee state becomes
--     'not_charged'; both sides are told. Replay-safe: a second call answers 'already'.
--   declutter_ship_setup_fee_at_capture(order): the amount the worker captures. A 'refund_due' fee is simply NOT
--     captured (a smaller capture: total, without the fee) and the order's fee state becomes 'not_charged' (what
--     the order took; declutter_my_paid_cents already counts 'not_charged' as no fee). Any other state captures
--     everything that was held. Called before the capture with the same answer every time, so the capture's
--     per-order idempotency key always sends the same amount.
--
-- REPLAY-SAFETY: CREATE OR REPLACE only; nothing references a later object.

CREATE OR REPLACE FUNCTION public.declutter_ship_hold_released(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
  r record;
  v_title text;
  v_n integer := 0;
BEGIN
  SELECT d.id, d.status, d.handover, d.ship_capture, d.buyer_id, d.seller_id, d.setup_fee_cents, d.setup_fee_state,
         d.close_reason
    INTO o FROM public.declutter_orders d WHERE d.id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.handover IS DISTINCT FROM 'ship' THEN
    RETURN 'not_ship';
  END IF;
  IF o.status = 'expired' AND o.close_reason = 'not_payable' AND o.ship_capture = 'released' THEN
    RETURN 'already';
  END IF;
  IF o.status IS DISTINCT FROM 'paid' OR o.ship_capture IS NULL OR o.ship_capture NOT IN ('held', 'released') THEN
    RETURN 'not_held';
  END IF;
  -- A bought label means the money was (or is being) captured: never closed as "nothing charged".
  IF EXISTS (SELECT 1 FROM public.shipments s WHERE s.declutter_order_id = o.id AND s.label_state <> 'failed' AND s.label_state <> 'claimed') THEN
    RETURN 'label_bought';
  END IF;

  UPDATE public.declutter_orders SET ship_capture = 'released' WHERE id = o.id AND ship_capture = 'held';
  UPDATE public.shipments SET label_state = 'failed', last_error = coalesce(last_error, 'hold released')
   WHERE declutter_order_id = o.id AND label_state = 'claimed';

  -- The setup fee was never charged: the account owes it again at its next first-time step.
  IF o.setup_fee_state = 'claimed' THEN
    UPDATE public.profiles SET onboarding_fee_paid = false, onboarding_fee_charged_at = NULL
     WHERE user_id = o.buyer_id AND onboarding_fee_paid IS TRUE;
  END IF;
  UPDATE public.declutter_orders SET setup_fee_state = 'not_charged'
   WHERE id = o.id AND setup_fee_state IN ('claimed', 'refund_due');

  UPDATE public.declutter_orders SET status = 'expired', close_reason = 'not_payable', closed_at = now() WHERE id = o.id;
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'removed', closed_at = now()
     WHERE c.order_id = o.id AND c.status = 'paid'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = r.item_id AND status = 'sold';
    v_n := v_n + 1;
    IF v_title IS NULL THEN
      SELECT i.title INTO v_title FROM public.declutter_items i WHERE i.id = r.item_id;
    END IF;
  END LOOP;
  v_title := coalesce(v_title, 'your item') || CASE WHEN v_n > 1 THEN format(' and %s more', v_n - 1) ELSE '' END;

  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order cancelled: no charge',
    format('We couldn''t make the shipping label for "%s", so your order was cancelled and the hold on your card was released. You pay nothing.', v_title),
    '/declutter?tab=buying', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'declutter_sales', 'Sale cancelled: nothing to ship',
    format('We couldn''t make the shipping label for "%s", so the sale was cancelled and it is back up for sale. Don''t ship it. No strike for you.', v_title),
    '/declutter?tab=selling', o.buyer_id);
  RETURN 'closed';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_hold_released(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_ship_hold_released(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_ship_setup_fee_at_capture(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
BEGIN
  SELECT d.id, d.status, d.handover, d.ship_capture, d.total_cents, d.setup_fee_cents, d.setup_fee_state
    INTO o FROM public.declutter_orders d WHERE d.id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.handover IS DISTINCT FROM 'ship' OR o.status IS DISTINCT FROM 'paid' OR o.ship_capture IS DISTINCT FROM 'held' THEN
    RAISE EXCEPTION 'ship_not_held' USING ERRCODE = '55000';
  END IF;
  IF o.setup_fee_cents > 0 AND o.setup_fee_state = 'refund_due' THEN
    UPDATE public.declutter_orders SET setup_fee_state = 'not_charged' WHERE id = o.id;
    RETURN o.total_cents;
  END IF;
  -- not_charged here is either a page without the fee or a refund_due already settled by an earlier call: the
  -- fee was not on the page in the first case, and must not be taken in the second.
  IF o.setup_fee_cents > 0 AND o.setup_fee_state = 'claimed' THEN
    RETURN o.total_cents + o.setup_fee_cents;
  END IF;
  RETURN o.total_cents;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_setup_fee_at_capture(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_ship_setup_fee_at_capture(uuid) TO service_role;
