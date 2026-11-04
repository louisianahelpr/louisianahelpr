-- Q1930 (WIP, Builder 103 11-04; NOT reviewed): the exact (origin, drop-off) pairs a buyer's delivery quote from one
-- seller passes to declutter_road_miles, so declutter-checkout can route them with Apple (/v1/etas) and store each in
-- declutter_route_miles (20261104105545) right after the drop-off is geocoded. The origins are rounded to 2 dp exactly
-- as the callers round them (20261102030012: the seller's porch places when any, else each in-cart line's pickup
-- point; 20261101175628 / 20261030164712 the same rounding); the drop-off is passed unrounded, as they pass d.lat/d.lng.
-- service_role only: it reads private pickup points. New object only. Replay-safe: CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.declutter_route_pairs(p_buyer uuid, p_seller uuid)
RETURNS TABLE (o_lat numeric, o_lng numeric, d_lat numeric, d_lng numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH d AS (
    SELECT x.lat, x.lng FROM public.declutter_delivery_dropoffs x
     WHERE x.buyer_id = p_buyer AND x.seller_id = p_seller AND x.lat IS NOT NULL AND x.lng IS NOT NULL
  ), o AS (
    SELECT round(pl.lat, 2) AS lat, round(pl.lng, 2) AS lng FROM public.declutter_porch_places pl
     WHERE pl.seller_id = p_seller
    UNION
    SELECT round(p.pickup_lat, 2), round(p.pickup_lng, 2)
      FROM public.declutter_cart_items c
      JOIN public.declutter_item_private p ON p.item_id = c.item_id
     WHERE c.buyer_id = p_buyer AND c.seller_id = p_seller AND c.status = 'in_cart'
       AND p.pickup_lat IS NOT NULL AND p.pickup_lng IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.declutter_porch_places pl2 WHERE pl2.seller_id = p_seller)
  )
  SELECT DISTINCT o.lat, o.lng, d.lat, d.lng FROM o CROSS JOIN d
   WHERE NOT EXISTS (SELECT 1 FROM public.declutter_route_miles r
                      WHERE r.o_lat = o.lat AND r.o_lng = o.lng AND r.d_lat = d.lat AND r.d_lng = d.lng
                        AND r.routed_at > now() - interval '180 days')
   LIMIT 40;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_route_pairs(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_route_pairs(uuid, uuid) TO service_role;
