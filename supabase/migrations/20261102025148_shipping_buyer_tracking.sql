-- SHIPPING: the buyer's tracking (docs/specs/shipping-draft.md section 6; Q2259; B134).
-- 20261102023246 gave the seller their label view. The buyer of a shipped order needs to see where it is: the
-- tracking number, the carrier's status, the seller's Ship-by deadline, and whether the seller has packed it.
-- shipments is service-role only (S1), so the buyer reads it through one definer RPC:
--   declutter_my_ship_tracking(order): the order's BUYER only (the seller, anyone else, a non-ship order or no order:
--   the same 'order_not_found', so nothing tells an outsider an order exists), switch declutter_shipping on. The
--   tracking number and Ship-by only once the label is bought AND the hold captured (the buyer has paid), as on the
--   seller's view: before that, and after a void, there is nothing to track. Never the label file (the seller prints
--   it), the label cost, or the ship-to address.
-- No ban gate: a restricted buyer must still be able to see where an order they paid for is.
-- SECURITY DEFINER with a pinned search_path; revoked from PUBLIC and anon; granted to authenticated (it checks
-- auth.uid() itself). Replay-safe: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.declutter_my_ship_tracking(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  o record;
  s record;
  v_ready boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter_shipping');
  SELECT d.id, d.buyer_id, d.handover, d.status, d.paid_at, d.ship_capture INTO o
    FROM public.declutter_orders d WHERE d.id = p_order_id;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid OR o.handover IS DISTINCT FROM 'ship' THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT sh.label_state, sh.tracking_code, sh.tracking_status, sh.service, sh.packed_at, sh.accepted_at,
         sh.delivered_at INTO s
    FROM public.shipments sh WHERE sh.declutter_order_id = o.id;
  v_ready := FOUND AND s.label_state = 'bought' AND o.ship_capture = 'captured';
  RETURN jsonb_build_object(
    'order_status', o.status,
    'ready', v_ready,
    'tracking_code', CASE WHEN v_ready THEN s.tracking_code END,
    'tracking_status', CASE WHEN v_ready THEN s.tracking_status END,
    'service', s.service,
    'ship_by', CASE WHEN v_ready THEN public.declutter_ship_by(o.paid_at) END,
    'packed_at', CASE WHEN v_ready THEN s.packed_at END,
    'accepted_at', CASE WHEN v_ready THEN s.accepted_at END,
    'delivered_at', CASE WHEN v_ready THEN s.delivered_at END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_ship_tracking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_ship_tracking(uuid) TO authenticated, service_role;
