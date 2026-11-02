-- SHIPPING S6: a shipped order whose label was voided closes cleanly (Q2259; B131 handoff next-step 2; B134).
-- TEST MODE ONLY: declutter_shipping stays testers.
--
-- What was broken: when the buyer's card hold lapsed (or was cancelled) AFTER the label was bought, the worker could
-- not capture ("capture_lost"), asked EasyPost to void the label (S6 part 1, shipLabelVoid.ts), and paged ops "Close
-- the order by hand". declutter_ship_hold_released refused the order ('label_bought') because its label was neither
-- 'failed' nor 'claimed', so the order stayed 'paid' with the hold 'held': the buyer's Buying and the seller's Selling
-- still showed a live sale (the seller was still told "print the label and pack it"), the item stayed 'sold', and
-- nobody was told.
--
-- The fix (restates declutter_ship_hold_released from 20261101220810; only the label rule and the notice words change):
--   - A label 'bought' or 'void_requested' still refuses ('label_bought'): the void pass calls again after EasyPost
--     answers. A 'voided' or 'void_rejected' label no longer refuses, so the order closes exactly as a label that was
--     never bought: hold 'released', order 'expired' / 'not_payable' (no money moved: never 'refunded', no refund row),
--     lines 'removed' (no strike), items back 'live', a claimed setup fee given back.
--   - A 'captured' order is still refused ('not_held') whatever its label: money taken is never closed as "no charge".
--   - The two notices for a voided label say what happened (the payment did not go through; the label was cancelled;
--     don't ship it), not "we couldn't make the shipping label".
--   - void_rejected (spent postage) closes the same way; the void pass has already paged ops about the postage.
--   The void pass (supabase/functions/_shared/shipLabelVoid.ts) calls it after recording voided / void_rejected.
-- Service role only, as before. REPLAY-SAFETY: CREATE OR REPLACE only.

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
  v_voided boolean;
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
  -- A label still usable (bought) or still being voided (void_requested) is never closed as "nothing charged": the
  -- void pass calls again once EasyPost has answered. A voided or void_rejected label no longer blocks the close
  -- (B134): the only path that voids a label on a held order is a hold lost after the label was bought, so nothing
  -- was taken. A captured order is refused above ('not_held'), whatever its label.
  IF EXISTS (SELECT 1 FROM public.shipments s WHERE s.declutter_order_id = o.id AND s.label_state IN ('bought', 'void_requested')) THEN
    RETURN 'label_bought';
  END IF;
  v_voided := EXISTS (SELECT 1 FROM public.shipments s WHERE s.declutter_order_id = o.id AND s.label_state IN ('voided', 'void_rejected'));

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

  IF v_voided THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order cancelled: no charge',
      format('The payment for "%s" couldn''t be completed, so your order was cancelled. You pay nothing.', v_title),
      '/declutter?tab=buying', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'declutter_sales', 'Sale cancelled: don''t ship it',
      format('The buyer''s payment for "%s" didn''t go through, so the sale was cancelled, the shipping label was cancelled and it is back up for sale. Don''t ship it. No strike for you.', v_title),
      '/declutter?tab=selling', o.buyer_id);
  ELSE
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order cancelled: no charge',
      format('We couldn''t make the shipping label for "%s", so your order was cancelled and the hold on your card was released. You pay nothing.', v_title),
      '/declutter?tab=buying', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'declutter_sales', 'Sale cancelled: nothing to ship',
      format('We couldn''t make the shipping label for "%s", so the sale was cancelled and it is back up for sale. Don''t ship it. No strike for you.', v_title),
      '/declutter?tab=selling', o.buyer_id);
  END IF;
  RETURN 'closed';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_hold_released(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_ship_hold_released(uuid) TO service_role;
