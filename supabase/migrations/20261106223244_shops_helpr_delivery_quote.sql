-- Shops Helpr delivery, slice 2 (Builder 5, 11-06): the buyer sees the Helpr delivery price BEFORE ordering.
--
-- WHAT: shop_helpr_delivery_quote(shop, drop-off lat, lng), service role only. shop-checkout's 'helpr_quote' action
--   geocodes the typed drop-off on the server and calls it. It answers the miles and the price exactly as
--   shop_set_order_helpr_delivery (20261106194913) will freeze them at order time: road miles from the shop's
--   private pickup point (saved with the address, shop_set_pickup_point) to the drop-off by declutter_road_miles,
--   at least 1, at most 50, priced by declutter_delivery_price_cents(miles, '{small}') = Declutter's $6 + $1.50/mi.
--   Same refusals in the same words: shop_no_helpr_delivery, delivery_outside_louisiana, delivery_too_far.
-- ROAD MILES, Declutter's way (Q1930, 20261104105545 / 20261104113516): when no Apple-routed row less than 180 days
--   old exists for the exact (pickup point, drop-off) pair and routing is not paused (declutter_route_health), the
--   answer carries route = {o_lat, o_lng, d_lat, d_lng}: the edge asks Apple /v1/etas for that pair, upserts it into
--   declutter_route_miles under that exact key, and asks again. declutter_road_miles then reads the routed miles.
--   The pickup point goes ONLY to the service-role edge, never to a member (the edge never returns it).
-- MONEY: yes (the price a buyer is shown and then charged). AUTHZ: one new service-role function.
-- REPLAY-SAFE: CREATE OR REPLACE; grants by role name. Reads only objects of earlier migrations.
-- Proof: src/test/pglite/shopsHelprDeliveryQuote.pglite.mjs (3x; NEW_MIGRATION=skip red).

CREATE OR REPLACE FUNCTION public.shop_helpr_delivery_quote(p_shop_id uuid, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  s public.shops;
  a public.shop_pickup_addresses;
  v_miles integer;
  v_route jsonb := NULL;
BEGIN
  SELECT * INTO s FROM public.shops WHERE id = p_shop_id;
  SELECT * INTO a FROM public.shop_pickup_addresses WHERE shop_id = p_shop_id;
  IF s.id IS NULL OR NOT s.helpr_delivery OR a.lat IS NULL THEN
    RAISE EXCEPTION 'shop_no_helpr_delivery' USING ERRCODE = '55000',
      HINT = 'This shop does not offer Helpr delivery. Choose pickup.';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 28 AND 34 OR p_lng NOT BETWEEN -95 AND -88 THEN
    RAISE EXCEPTION 'delivery_outside_louisiana' USING ERRCODE = '22023', HINT = 'Shops deliver in Louisiana only.';
  END IF;
  -- The same measure shop_set_order_helpr_delivery freezes.
  v_miles := greatest(1, public.declutter_road_miles(a.lat, a.lng, p_lat, p_lng));
  IF v_miles IS NULL OR v_miles > 50 THEN
    RAISE EXCEPTION 'delivery_too_far' USING ERRCODE = '22023',
      HINT = 'A Helpr delivers within 50 miles of the shop. Choose pickup.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_route_miles r
                  WHERE r.o_lat = a.lat AND r.o_lng = a.lng AND r.d_lat = p_lat AND r.d_lng = p_lng
                    AND r.routed_at > now() - interval '180 days')
     AND NOT EXISTS (SELECT 1 FROM public.declutter_route_health h WHERE h.miss_until > now()) THEN
    v_route := jsonb_build_object('o_lat', a.lat, 'o_lng', a.lng, 'd_lat', p_lat, 'd_lng', p_lng);
  END IF;
  RETURN jsonb_build_object('delivery_miles', v_miles,
                            'delivery_cents', public.declutter_delivery_price_cents(v_miles, ARRAY['small']),
                            'route', v_route);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_helpr_delivery_quote(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_helpr_delivery_quote(uuid, numeric, numeric) TO service_role;
