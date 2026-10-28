-- Two reads of a seller's pickup windows (lead 2026-10-28, for Broken #2 and #58: a buyer choosing, and the
-- people on an order seeing, when the seller is around). declutter_pickup_windows is readable only by its own
-- seller (RLS "seller reads own"), so a buyer or Helpr could not see them.
--
--   declutter_item_pickup_windows(item): any signed-in member, for a listing that is live or reserved; the
--     weekday and the from/to times only (no address, no seller id, no item fields). Behind 'declutter'.
--   declutter_order_pickup_windows(order): the same rows plus latest_pickup_at (the 7-day pickup deadline,
--     paid_at + 7 days), for the order's buyer once it is paid, its seller, or the Helpr assigned to its
--     delivery; anyone else gets item_not_found (no oracle on whether the order exists). Behind 'declutter'.
-- Read-only, STABLE SECURITY DEFINER, search_path pinned; REVOKE FROM PUBLIC, anon; GRANT authenticated.
-- Proof: src/test/pglite/declutterPickupWindowReads.pglite.mjs (applied 3x).
-- REPLAY-SAFETY: CREATE OR REPLACE (new functions).

CREATE OR REPLACE FUNCTION public.declutter_item_pickup_windows(p_item_id uuid)
RETURNS TABLE(weekday smallint, starts time, ends time)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_seller uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT i.seller_id INTO v_seller FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.status IN ('live', 'reserved') AND NOT i.seller_hidden;
  IF v_seller IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT w.weekday, w.starts_local, w.ends_local
      FROM public.declutter_pickup_windows w
     WHERE w.seller_id = v_seller
     ORDER BY w.weekday, w.starts_local;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_pickup_windows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_item_pickup_windows(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_order_pickup_windows(p_order_id uuid)
RETURNS TABLE(weekday smallint, starts time, ends time, latest_pickup_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.id IS NULL
     OR NOT (
          (o.buyer_id = v_uid AND o.status = 'paid')
       OR o.seller_id = v_uid
       OR EXISTS (SELECT 1 FROM public.helpr_tasks t
                   WHERE t.source_kind = 'declutter_delivery' AND t.source_id = o.id AND t.helpr_id = v_uid
                     AND t.status IN ('accepted', 'picked_up', 'delivered', 'confirmed'))) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT w.weekday, w.starts_local, w.ends_local, o.paid_at + interval '7 days'
      FROM public.declutter_pickup_windows w
     WHERE w.seller_id = o.seller_id
     ORDER BY w.weekday, w.starts_local;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_pickup_windows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_pickup_windows(uuid) TO authenticated, service_role;
