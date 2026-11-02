-- Shipping S6 part 2f (Q2259; docs/specs/shipping-draft.md 5.3 row "Admin no-fault": "everything back; spent = seller
-- debt (decision 6: a lost/broken parcel is the seller's)"). TEST MODE ONLY: declutter_shipping stays testers; ship
-- orders exist only for testers.
--
-- What was broken: an admin's no-fault decision on a shipped order (reason 'admin_no_fault', policy keep_card_fee)
-- refunds the buyer everything, shipping included, but nothing happened to the label:
--   * a label already handed to the carrier (or delivered) was paid by the platform; nothing booked it on the seller;
--   * a label not yet scanned was never sent to be voided, so its postage was lost too, and a rejected void was not
--     the seller's debt (the 2c trigger, 20261102045553, knows only the seller-fault reasons).
-- Two paths write an admin_no_fault refund: declutter_close_paid_order (before the handover) and
-- declutter_refund_after_handover (after it; a shipped order is handed over once delivered, 20261102013630). Both go
-- through declutter_record_refund, which writes ONE declutter_refunds row per payment. So the rule lives in one
-- AFTER INSERT trigger on declutter_refunds (reason 'admin_no_fault', a ship order), and neither big function is
-- restated:
--   1. label bought and scanned or delivered (spent): ONE seller fee debt, source_kind 'ship_label', source_ref = the
--      shipment id, amount = label_cost_cents, paid from the seller's next Declutter payout (declutter_consume_fee_debt).
--   2. label bought and not scanned: a TEST label is sent to be voided (bought -> void_requested, the same
--      compare-and-set as 2d); a LIVE label is paged (log_cron_defect), never voided by itself. The seller is told not
--      to ship it.
--   3. label already void_rejected: the same debt under 'ship_void_rejected' (the 2c key, so never twice).
--   4. voided, void_requested, claimed, failed, no label: nothing now.
--   5. The 2c trigger's reason list gains 'admin_no_fault', so a rejected void after step 2 is the seller's debt.
-- The buyer's refund is unchanged (everything back, as today). Debts are booked only for a seller who still exists and
-- a label cost above 0; ON CONFLICT (source_kind, source_ref) DO NOTHING. The seller is told in the app, with 2c's
-- words. Errors are never swallowed: a failed insert fails the refund write.
-- Service role only; the trigger functions are not callable by members.
-- Proof: src/test/pglite/shippingAdminNoFaultLabelDebt.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red; planted
-- defects; Supabase's default execute grant emulated). REPLAY-SAFETY: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

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
  IF NEW.reason IS DISTINCT FROM 'admin_no_fault' OR NEW.order_id IS NULL THEN
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
          '/declutter?view=sales');
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
      '/declutter?view=mine');
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_no_fault_label() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_declutter_refunds_ship_no_fault_label ON public.declutter_refunds;
CREATE TRIGGER trg_declutter_refunds_ship_no_fault_label AFTER INSERT ON public.declutter_refunds
  FOR EACH ROW EXECUTE FUNCTION public.declutter_ship_no_fault_label();

-- 2c restated (20261102045553); only the reason list changes: 'admin_no_fault' joins the seller-fault reasons, so a
-- void rejected after a no-fault refund is the seller's debt (decision 6).
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
                  AND d.reason IN ('seller_backed_out', 'seller_no_show', 'not_as_described', 'admin_no_fault'));
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
      '/declutter?view=mine');
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_void_rejected_debt() FROM PUBLIC, anon, authenticated;
