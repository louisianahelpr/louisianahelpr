-- Shipping tracking notices (Q2259; docs/specs/shipping-draft.md 4.2 "Helpr sends every shipping notice itself"):
-- the buyer and the seller hear when USPS has the parcel, when it is delivered, and when delivery hits a problem.
--
-- Before: easypost-webhook (S4) moved shipments.tracking_status forward and nothing told either person. Member
-- emails and phones are never sent to EasyPost (4.2), so EasyPost's own notices cannot fire either: a buyer learned
-- their item had shipped or arrived only by opening the order. A delivered parcel starts the 2-day window in which a
-- problem can be reported (S5: 24 h to the auto handover, then the 24 h refund window), so the buyer must be told.
--
-- Now: trg_shipments_tracking_notices (AFTER UPDATE OF tracking_status, accepted_at on shipments) sends, once per
-- change, through declutter_notify (never fails the webhook's write; a lost notice is logged by log_cron_defect):
--   * the first acceptance scan (accepted_at set from NULL, not yet delivered): buyer "Your item shipped",
--     seller "USPS has your package" ("UPS" on a UPS Ground label, in every notice);
--   * delivered (tracking_status becomes 'delivered'): buyer "Your item was delivered" (check it, report a problem
--     within 2 days), seller "Your package was delivered";
--   * a problem scan ('return_to_sender', 'failure'): both "Delivery problem";
--   * 'available_for_pickup': buyer "Your item is waiting for pickup".
-- The webhook writes compare-and-set and forward-only (nextTracking), so one scan is one row change and one notice.
-- declutter_notice_about(order) lets declutter_notify_strict name the item; every call passes the Declutter kind
-- itself (declutter_pickups), so declutter_notice_type needs no restatement. A test-mode (is_seed) counterpart
-- never notifies a real member (declutter_notify_strict, Q137).
-- No money moves. Shipments rows exist only for testers while declutter_shipping is testers-only.
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS; REVOKE ... FROM PUBLIC, anon, authenticated.
-- Proof: src/test/pglite/shippingTrackingNotices.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

CREATE OR REPLACE FUNCTION public.declutter_ship_tracking_notices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_buyer uuid;
  v_seller uuid;
  -- A UPS Ground label says UPS (5732ce9ed2 did the same on the order card).
  v_carrier text := CASE WHEN NEW.service LIKE 'ups%' THEN 'UPS' ELSE 'USPS' END;
BEGIN
  IF NEW.declutter_order_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT o.buyer_id, o.seller_id INTO v_buyer, v_seller FROM public.declutter_orders o WHERE o.id = NEW.declutter_order_id;
  IF v_buyer IS NULL AND v_seller IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM public.declutter_notice_about(NEW.declutter_order_id);

  IF NEW.tracking_status = 'delivered' AND OLD.tracking_status IS DISTINCT FROM 'delivered' THEN
    PERFORM public.declutter_notify(v_buyer, 'declutter_pickups', 'Your item was delivered',
      format('%s delivered it. Check it over: if something is wrong, report a problem on your order within 2 days.', v_carrier),
      '/declutter?tab=buying', v_seller);
    PERFORM public.declutter_notice_about(NEW.declutter_order_id);
    PERFORM public.declutter_notify(v_seller, 'declutter_pickups', 'Your package was delivered',
      format('%s delivered it to your buyer. You are paid once the 2-day window for problems ends.', v_carrier),
      '/declutter?tab=selling', v_buyer);
  ELSIF NEW.tracking_status IN ('return_to_sender', 'failure')
        AND OLD.tracking_status IS DISTINCT FROM NEW.tracking_status THEN
    PERFORM public.declutter_notify(v_buyer, 'declutter_pickups', 'Delivery problem',
      CASE WHEN NEW.tracking_status = 'return_to_sender'
           THEN format('%s is sending your package back to the seller. Open your order to see what happens next.', v_carrier)
           ELSE format('%s reported a problem delivering your package. Open your order to see what happens next.', v_carrier) END,
      '/declutter?tab=buying', v_seller);
    PERFORM public.declutter_notice_about(NEW.declutter_order_id);
    PERFORM public.declutter_notify(v_seller, 'declutter_pickups', 'Delivery problem',
      CASE WHEN NEW.tracking_status = 'return_to_sender'
           THEN format('%s is sending your package back to you. Open the sale to see what happens next.', v_carrier)
           ELSE format('%s reported a problem delivering your package. Open the sale to see what happens next.', v_carrier) END,
      '/declutter?tab=selling', v_buyer);
  ELSIF NEW.tracking_status = 'available_for_pickup' AND OLD.tracking_status IS DISTINCT FROM 'available_for_pickup' THEN
    PERFORM public.declutter_notify(v_buyer, 'declutter_pickups', 'Your item is waiting for pickup',
      format('%s is holding your package for you to pick up. Tap Track on your order to see where, and bring an ID.', v_carrier),
      '/declutter?tab=buying', v_seller);
  ELSIF OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL THEN
    PERFORM public.declutter_notify(v_buyer, 'declutter_pickups', 'Your item shipped',
      format('%s has your package. Track it on your order.', v_carrier),
      '/declutter?tab=buying', v_seller);
    PERFORM public.declutter_notice_about(NEW.declutter_order_id);
    PERFORM public.declutter_notify(v_seller, 'declutter_pickups', format('%s has your package', v_carrier),
      format('%s scanned your package. We will tell you when it is delivered.', v_carrier),
      '/declutter?tab=selling', v_buyer);
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_tracking_notices() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shipments_tracking_notices ON public.shipments;
CREATE TRIGGER trg_shipments_tracking_notices AFTER UPDATE OF tracking_status, accepted_at ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.declutter_ship_tracking_notices();
