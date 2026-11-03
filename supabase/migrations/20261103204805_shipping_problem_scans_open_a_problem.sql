-- Shipping problem scans open a problem on the order (Q2259; docs/specs/shipping-draft.md 7: "Return-to-sender,
-- available-for-pickup and failure scans go to a problem state").
--
-- Before: a 'return_to_sender' or 'failure' tracking scan sent the buyer and the seller a "Delivery problem" notice
-- (20261103201840) and nothing else. No declutter_problems row was opened, so no admin was told, and the order sat in
-- 'paid' until the lost sweep (20261103203204) refunded it 10 days after acceptance on 'ship_lost', with no look at
-- whether the parcel was really lost or was on its way back to the seller.
--
-- Now: trg_shipments_problem_scan (AFTER UPDATE OF tracking_status on shipments) opens ONE system problem
-- (reporter_side 'system', reason 'not_received', no reporter) on a paid 'ship' order the first time the shipment
-- reaches 'return_to_sender' or 'failure', and tells every admin (test data never reaches an admin, 20261030150104).
-- That is the existing problem flow: every shipping sweep (pay on delivered, never shipped, lost) skips an order with
-- an open problem, so the money stays held, and the admin decides it in declutter_admin_decide_problem (refund as
-- nobody's fault books the spent label on the seller through declutter_ship_no_fault_label, decision 6; or pay the
-- seller). The buyer and seller notices stay those of 20261103201840.
--   * Not on 'available_for_pickup': a parcel waiting at the post office is not a problem yet (lead, 11-03, M3).
--   * Not when a problem is already open (one open problem per order, declutter_problems_one_open; a buyer's own
--     report stands), not on an order that is no longer 'paid' (refunded, handed over), not on a pickup order.
--   * The order is locked first (declutter_lock_order, as the sweeps do), so a sweep closing it at the same moment
--     either finishes before (and the order is no longer 'paid' here) or waits for the problem and then skips it.
--   * An error here fails the webhook's tracking write, which EasyPost retries: a problem scan is never dropped
--     silently while the payout could still be released.
-- No money moves here: a problem only holds the payout until an admin decides.
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS; REVOKE ... FROM PUBLIC, anon, authenticated.
-- Proof: src/test/pglite/shippingProblemScans.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

CREATE OR REPLACE FUNCTION public.declutter_ship_problem_scan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  a record;
  v_problem uuid;
  v_carrier text := CASE WHEN NEW.service LIKE 'ups%' THEN 'UPS' ELSE 'USPS' END;
BEGIN
  IF NEW.declutter_order_id IS NULL
     OR NEW.tracking_status IS NULL
     OR NEW.tracking_status NOT IN ('return_to_sender', 'failure')
     OR OLD.tracking_status IS NOT DISTINCT FROM NEW.tracking_status THEN
    RETURN NEW;
  END IF;
  -- The same lock order as every sweep (items, then the order), so the two never deadlock.
  o := public.declutter_lock_order(NEW.declutter_order_id);
  IF o.status <> 'paid' OR o.handover IS DISTINCT FROM 'ship' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths, is_seed)
  VALUES (o.id, NULL, 'system', 'not_received',
          CASE WHEN NEW.tracking_status = 'return_to_sender'
               THEN format('%s is sending this package back to the seller (tracking %s). The money is held. Decide who gets it.',
                           v_carrier, COALESCE(NEW.tracking_code, 'not recorded'))
               ELSE format('%s reported it could not deliver this package (tracking %s). The money is held. Decide who gets it.',
                           v_carrier, COALESCE(NEW.tracking_code, 'not recorded')) END,
          '{}', COALESCE(o.is_seed, false))
  ON CONFLICT (order_id) WHERE status = 'open' DO NOTHING
  RETURNING id INTO v_problem;
  IF v_problem IS NULL THEN
    RETURN NEW;
  END IF;
  -- Test stuff never reaches an admin (owner 2026-10-30; 20261030150104).
  IF NOT (COALESCE(o.is_seed, false) OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter delivery problem',
        format('%s reported a problem delivering a shipped Declutter sale. The money is held until you decide it.', v_carrier),
        '/admin');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_problem_scan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shipments_problem_scan ON public.shipments;
CREATE TRIGGER trg_shipments_problem_scan AFTER UPDATE OF tracking_status ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.declutter_ship_problem_scan();
