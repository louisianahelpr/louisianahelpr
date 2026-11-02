-- Shipping S6 part 2c (Q2259; docs/specs/shipping-draft.md 5.3 row "seller_backed_out / ship_never_shipped": "voided;
-- a rejected void = seller debt"): when EasyPost rejects the void of a label on an order that was refunded on the
-- SELLER (seller_backed_out, the never-shipped sweep of 20261102045035 among them), the spent postage becomes the
-- seller's fee debt, paid from their next Declutter payout like every other fee debt (declutter_consume_fee_debt).
--
-- Before: the label worker recorded void_rejected and paged ops "seller debt, Shipping S6 part 2"; nothing booked it,
-- so the platform absorbed the label. The ledger could not hold such a debt until 20261102043018 (source key).
--
-- Now: an AFTER UPDATE trigger on shipments, when label_state becomes 'void_rejected', books ONE debt
-- (source_kind 'ship_void_rejected', source_ref = the shipment id, amount = label_cost_cents) when ALL hold:
--   * the shipment belongs to a Declutter order whose seller still exists;
--   * the order was refunded and its refund row's reason is seller-fault ('seller_backed_out', 'seller_no_show',
--     'not_as_described'), the same set declutter_close_paid_order treats as the seller's fault;
--   * label_cost_cents > 0.
-- A label whose order closed because the card hold was lost (never charged; declutter_ship_hold_released) is NOT the
-- seller's fault and books nothing (the platform keeps that cost, as before). ON CONFLICT (source_kind, source_ref)
-- DO NOTHING: never twice. The seller is told in the app. Errors are never swallowed: a failed insert fails the
-- worker's write, which is retried (the row stays void_requested).
-- Service role writes shipments; the trigger function is not callable by members.
-- Proof: src/test/pglite/shippingVoidRejectedSellerDebt.pglite.mjs. REPLAY-SAFETY: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.declutter_ship_void_rejected_debt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_seller uuid;
  v_title text;
  v_id uuid;
BEGIN
  IF NEW.label_state <> 'void_rejected' OR OLD.label_state = 'void_rejected' OR NEW.declutter_order_id IS NULL
     OR COALESCE(NEW.label_cost_cents, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  SELECT o.seller_id INTO v_seller FROM public.declutter_orders o
   WHERE o.id = NEW.declutter_order_id AND o.status = 'refunded'
     AND EXISTS (SELECT 1 FROM public.declutter_refunds d WHERE d.order_id = o.id
                  AND d.reason IN ('seller_backed_out', 'seller_no_show', 'not_as_described'));
  IF v_seller IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_seller) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.declutter_seller_fee_debts (seller_id, source_kind, source_ref, amount_cents, remaining_cents)
  VALUES (v_seller, 'ship_void_rejected', NEW.id, NEW.label_cost_cents, NEW.label_cost_cents)
  ON CONFLICT (source_kind, source_ref) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    SELECT i.title INTO v_title FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.order_id = NEW.declutter_order_id ORDER BY c.id LIMIT 1;
    PERFORM public.declutter_notify(v_seller, 'info', 'Shipping label added to what you owe',
      format('The shipping label for %s could not be cancelled after the sale was called off, so its $%s comes out of your next Declutter payout.',
             COALESCE('"' || v_title || '"', 'your sale'), to_char(NEW.label_cost_cents / 100.0, 'FM999999990.00')),
      '/declutter?tab=selling');
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_void_rejected_debt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shipments_void_rejected_debt ON public.shipments;
CREATE TRIGGER trg_shipments_void_rejected_debt AFTER UPDATE OF label_state ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.declutter_ship_void_rejected_debt();
