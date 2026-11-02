-- Shipping S6 part 2b (Q2259; docs/specs/shipping-draft.md 5.3 row "seller_backed_out / ship_never_shipped", section 6
-- "missing [the ship-by deadline] = seller backs out"): a paid shipped order the seller never handed to USPS by its
-- ship-by deadline is cancelled, the buyer gets everything back, the label is voided and the seller gets a strike.
--
-- Before: nothing acted on ship_by (declutter_ship_by, 3 business days after payment). A seller who never shipped left
-- the order 'paid' forever: the buyer's money stayed captured, the item stayed sold, and the label stayed bought.
--
-- Now: declutter_ship_sweep (restated from 20261102013630; its delivered branch is unchanged) also closes, under the
-- order lock, every order where ALL hold:
--   * 'paid', handover 'ship', ship_capture 'captured' (a held or released hold has its own close,
--     declutter_ship_hold_released; nothing captured, nothing to refund);
--   * its shipment is 'bought' with NO acceptance scan (accepted_at NULL), and now() >= declutter_ship_by(paid_at);
--   * no problem is open on the order (an open problem is the admin's to decide).
-- What it does, in this order:
--   1. a TEST-mode label is moved bought -> void_requested (the same compare-and-set as the edge's requestShipVoid;
--      the label worker then voids it, and a rejected void is the seller's debt, part 2c). A LIVE label is left alone and
--      paged (log_cron_defect): requestShipVoid never voids live labels by itself either.
--   2. declutter_close_paid_order(o, 'seller_backed_out', 'seller', 'item_gone_after_sale', ...): the existing
--      seller-fault close. Refund = total - declutter_delivery_reserved_cents (0 for a ship order), so the buyer gets
--      items + fee + shipping + tax back now; fee policy full_seller_pays_fee (the card fee is the seller's debt);
--      items withdrawn; one seller strike; both sides told. No new refund reason: 'seller_backed_out' is the 5.3
--      table's own row for this, and its policy is already pinned (refundsKeepTheCardFee).
-- One bad order never stops the rest (log_cron_defect, retried next run).
--
-- Switch: shipping is testers-only; ship orders exist only for testers; service_role only (cron), no require_feature.
-- Proof: src/test/pglite/shippingNeverShippedSweep.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red; planted defects).
-- REPLAY-SAFETY: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.declutter_ship_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  o public.declutter_orders;
  v_done integer := 0;
  v_never integer := 0;
  v_mode text;
BEGIN
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.shipments s ON s.declutter_order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'ship' AND o2.ship_capture = 'captured'
       AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL
       AND s.delivered_at + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover = 'ship' AND o.ship_capture = 'captured'
         AND EXISTS (SELECT 1 FROM public.shipments s
                      WHERE s.declutter_order_id = o.id AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL
                        AND s.delivered_at + interval '24 hours' <= now())
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_done := v_done + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_ship_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;

  -- S6 2b: never shipped by ship-by.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.shipments s ON s.declutter_order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'ship' AND o2.ship_capture = 'captured'
       AND s.label_state = 'bought' AND s.accepted_at IS NULL
       AND now() >= public.declutter_ship_by(o2.paid_at)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      SELECT s.label_mode INTO v_mode FROM public.shipments s
       WHERE s.declutter_order_id = o.id AND s.label_state = 'bought' AND s.accepted_at IS NULL
       FOR UPDATE;
      IF FOUND AND o.status = 'paid' AND o.handover = 'ship' AND o.ship_capture = 'captured'
         AND now() >= public.declutter_ship_by(o.paid_at)
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
        IF v_mode = 'test' THEN
          UPDATE public.shipments SET label_state = 'void_requested', last_error = NULL, next_attempt_at = now()
           WHERE declutter_order_id = o.id AND label_state = 'bought' AND accepted_at IS NULL;
        ELSE
          PERFORM public.log_cron_defect('declutter_ship_sweep-live-void', o.id::text,
            format('order %s was never shipped by its ship-by and was refunded; its LIVE label must be voided by hand', o.id));
        END IF;
        PERFORM public.declutter_close_paid_order(o.id, 'seller_backed_out', 'seller', 'item_gone_after_sale',
          'You did not ship a paid Declutter order by its ship-by date. The buyer got everything back, shipping included; the card fee comes out of your next Declutter payout.');
        v_never := v_never + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_ship_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('delivered_handed_over', v_done, 'never_shipped_closed', v_never);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_ship_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_ship_sweep() TO service_role;
