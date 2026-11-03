-- Shipping S6 (Q2259; docs/specs/shipping-draft.md 5.3): a refund on the SELLER of a shipped order books the spent
-- label as the seller's debt, as the admin no-fault (20261102055653) and lost-parcel (20261103203204) refunds do.
--
-- Before (PGlite-measured, src/test/pglite/shippingSellerFaultLabelDebt.pglite.mjs with NEW_MIGRATION=skip):
--   * a refund after the 24 h auto handover (declutter_refund_after_handover) as not_as_described (5.3 row
--     "ship_damaged / not as described": spent = seller debt), seller_no_show (the seller agreed the buyer never got
--     it) or admin_no_fault while the seller is out (recorded as seller_out) booked NO label debt;
--   * the same reasons before the handover (declutter_close_paid_order) booked none for a scanned label, and a
--     seller_backed_out / seller_out close left an unscanned TEST label bought (never sent to be voided), so the
--     5.3 "voided; a rejected void = seller debt" row never ran for them.
-- Now: declutter_ship_no_fault_label (trigger on declutter_refunds insert; its name is kept, the trigger exists)
-- acts on those reasons too: a used label is ONE ship_label debt, an unscanned test label is sent to be voided (a
-- live one is paged), and declutter_ship_void_rejected_debt also counts seller_out. The buyer-side reasons
-- (admin_buyer_fault, buyer_cancelled, refund_request_full/part, buyer_no_show) are unchanged: no seller label debt.
-- The never-shipped sweep voids its label before it closes the order, so the trigger finds void_requested and books
-- nothing there (no double).
--
-- Restated, everything else verbatim (prod prosrc md5, read-only SELECT 11-03 ~3:20 PM CT):
--   declutter_ship_no_fault_label      newest 20261103203204 (not on prod yet; its body with 'ship_lost' taken out
--                                      = 20261102055653 = prod 01518c414c428196e68b84a092fcb3dc)
--   declutter_ship_void_rejected_debt  newest 20261102055653 = prod 1e5a85b6fb98e1efcf9617d249dbd96b
-- LAND ORDER: AFTER 20261103203204 (shipping lost sweep, same branch).
-- REPLAY-SAFETY: CREATE OR REPLACE and REVOKE only; the triggers are unchanged. Neither function is callable by members.

CREATE OR REPLACE FUNCTION public.declutter_ship_no_fault_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_seller uuid;
  v_label record;
  v_kind text;
  v_title text;
  v_id uuid;
BEGIN
  -- CHANGED (20261103211330): the seller-fault reasons join (spec 5.3: a spent label is the seller's on not_as_described,
  -- seller_no_show, seller_backed_out; seller_out is admin_no_fault while the seller can no longer sell, Q1928 gap 3).
  IF NEW.reason IS NULL OR NEW.reason NOT IN ('admin_no_fault', 'ship_lost', 'not_as_described', 'seller_no_show',
                                              'seller_backed_out', 'seller_out') OR NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT o.seller_id INTO v_seller FROM public.declutter_orders o WHERE o.id = NEW.order_id AND o.handover = 'ship';
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT s.id, s.label_state, s.label_mode, s.accepted_at, s.delivered_at, s.label_cost_cents INTO v_label
    FROM public.shipments s WHERE s.declutter_order_id = NEW.order_id FOR UPDATE;
  IF v_label.id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT i.title INTO v_title FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
   WHERE c.order_id = NEW.order_id ORDER BY c.id LIMIT 1;
  IF v_label.label_state = 'bought' AND v_label.accepted_at IS NULL AND v_label.delivered_at IS NULL THEN
    IF v_label.label_mode = 'test' THEN
      UPDATE public.shipments SET label_state = 'void_requested', last_error = NULL, next_attempt_at = now()
       WHERE id = v_label.id AND label_state = 'bought' AND accepted_at IS NULL AND delivered_at IS NULL;
      IF v_seller IS NOT NULL THEN
        PERFORM public.declutter_notify(v_seller, 'info', 'Don''t ship it',
          format('The sale of %s was called off, so its shipping label is being cancelled. Don''t put it in the mail.',
                 COALESCE('"' || v_title || '"', 'your item')),
          '/declutter?tab=selling');
      END IF;
    ELSE
      PERFORM public.log_cron_defect('declutter_ship_no_fault_label-live-void', NEW.order_id::text,
        format('order %s was refunded with no one at fault; its LIVE label must be voided by hand (a rejected void is the seller''s debt)', NEW.order_id));
    END IF;
    RETURN NEW;
  END IF;
  v_kind := CASE WHEN v_label.label_state = 'bought' THEN 'ship_label'
                 WHEN v_label.label_state = 'void_rejected' THEN 'ship_void_rejected' END;
  IF v_kind IS NULL OR COALESCE(v_label.label_cost_cents, 0) <= 0 OR v_seller IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_seller) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.declutter_seller_fee_debts (seller_id, source_kind, source_ref, amount_cents, remaining_cents)
  VALUES (v_seller, v_kind, v_label.id, v_label.label_cost_cents, v_label.label_cost_cents)
  ON CONFLICT (source_kind, source_ref) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    PERFORM public.declutter_notify(v_seller, 'info', 'Shipping label added to what you owe',
      format('The shipping label for %s was already used when the buyer was refunded, so its $%s comes out of your next Declutter payout.',
             COALESCE('"' || v_title || '"', 'your sale'), to_char(v_label.label_cost_cents / 100.0, 'FM999999990.00')),
      '/declutter?tab=selling');
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_no_fault_label() FROM PUBLIC, anon, authenticated;

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
                  -- CHANGED (20261103211330): seller_out (admin_no_fault while the seller is out) joins.
                  AND d.reason IN ('seller_backed_out', 'seller_no_show', 'not_as_described', 'admin_no_fault', 'seller_out'));
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
