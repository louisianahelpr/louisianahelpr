-- Q2491 (lead decision 2026-11-01 8:51 PM): a seller with saved pickup places has the seller-delivery range measured
-- from their saved place NEAREST the buyer's drop-off, not from the listing's own address.
--
-- declutter_seller_delivery_check measured from each item's own pickup point (declutter_item_private), so a seller who
-- keeps things at one of their saved places (declutter_porch_places, D-NEW14) had the range worked out from the
-- listing's address. Now:
--   * seller HAS saved places: the distance is the smallest road-miles estimate from any of their places to the
--     drop-off (declutter_road_miles from the place's point rounded to 2 decimals, as before: ~1 km, so a buyer quoting
--     chosen addresses can't trilaterate a home). The items' own points are not read, so an item with no point of its
--     own no longer blocks delivery from a seller who has places.
--   * seller has NO saved places: unchanged (every item's own point, the farthest one decides).
-- The signature and the columns returned are unchanged, so every caller (declutter_start_checkout and the checkout
-- page readers) is untouched. Seller delivery has no pickup stop, so nothing is frozen on the order.
--
-- RESTATED FROM (newest CREATE, checked 2026-11-01 on origin/main and wip/b132-open): declutter_seller_delivery_check
-- from 20261027211754_declutter_bundle_discount.sql. Changed: one DECLARE (v_has_places) and the distance block (marked
-- Q2491). Nothing else. MONEY: no amount, fee or status changes; the rate is worked out exactly as before.
-- REPLAY-SAFE: CREATE OR REPLACE; REVOKE/GRANT restated.
-- Proof: src/test/pglite/declutterSellerDeliveryNearestPlace.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

CREATE OR REPLACE FUNCTION public.declutter_seller_delivery_check(p_buyer uuid, p_seller uuid, p_lines uuid[])
RETURNS TABLE (reason text, rate_cents integer, radius_miles integer, dropoff_address text, dropoff_area text,
               dropoff_lat numeric, dropoff_lng numeric, base_rate_cents integer, free_over_cents integer, items_cents integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  s public.declutter_seller_delivery;
  d public.declutter_delivery_dropoffs;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_far integer;
  v_unplaced boolean;
  v_items integer;
  v_rate integer;
  v_has_places boolean;
BEGIN
  SELECT * INTO s FROM public.declutter_seller_delivery x WHERE x.seller_id = p_seller;
  -- A setting outside the rules (a rate the caps no longer allow) offers nothing; $0 is free delivery.
  IF NOT FOUND OR NOT s.enabled
     OR NOT (s.rate_cents = (v_rules ->> 'free_rate_cents')::integer
             OR s.rate_cents BETWEEN (v_rules ->> 'rate_min_cents')::integer AND (v_rules ->> 'rate_max_cents')::integer) THEN
    RETURN QUERY SELECT 'seller_not_delivering'::text, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::numeric, NULL::numeric,
                        NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  -- The order's items total from this seller, before fees: every line of the one order (owner 2026-10-27).
  -- Q2427: at the bundle prices (each paid line N% off when 2+, never below its floor), as checkout charges.
  SELECT COALESCE(sum(t.target_cents), 0)::integer INTO v_items FROM public.declutter_bundle_targets(p_seller, p_lines) t;
  v_rate := public.declutter_seller_delivery_rate_cents(s.rate_cents, s.free_over_cents, v_items);
  IF p_lines IS NULL OR cardinality(p_lines) = 0 OR EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_item_no_seller_delivery n ON n.item_id = c.item_id
        WHERE c.id = ANY (p_lines)) THEN
    RETURN QUERY SELECT 'item_not_deliverable'::text, v_rate, s.radius_miles, NULL::text, NULL::text, NULL::numeric, NULL::numeric,
                        s.rate_cents, s.free_over_cents, v_items;
    RETURN;
  END IF;
  SELECT * INTO d FROM public.declutter_delivery_dropoffs x WHERE x.buyer_id = p_buyer AND x.seller_id = p_seller;
  IF NOT FOUND OR d.geocoded_at < now() - interval '24 hours' THEN
    RETURN QUERY SELECT 'address_needed'::text, v_rate, s.radius_miles, NULL::text, NULL::text, NULL::numeric, NULL::numeric,
                        s.rate_cents, s.free_over_cents, v_items;
    RETURN;
  END IF;
  -- Q2491: a seller with saved pickup places is measured from the place nearest the drop-off; else every item's own
  -- point, the farthest deciding (as before). Rounded points either way.
  v_has_places := EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller);
  IF v_has_places THEN
    SELECT false, min(public.declutter_road_miles(round(pl.lat, 2), round(pl.lng, 2), d.lat, d.lng))
      INTO v_unplaced, v_far
      FROM public.declutter_porch_places pl
     WHERE pl.seller_id = p_seller;
  ELSE
  SELECT bool_or(p.pickup_lat IS NULL OR p.pickup_lng IS NULL),
         max(public.declutter_road_miles(round(p.pickup_lat, 2), round(p.pickup_lng, 2), d.lat, d.lng))
    INTO v_unplaced, v_far
    FROM public.declutter_cart_items c
    LEFT JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.id = ANY (p_lines);
  END IF;
  IF v_unplaced IS NOT FALSE OR v_far IS NULL THEN
    RETURN QUERY SELECT 'item_not_deliverable'::text, v_rate, s.radius_miles, NULL::text, d.area_label, NULL::numeric, NULL::numeric,
                        s.rate_cents, s.free_over_cents, v_items;
    RETURN;
  END IF;
  IF v_far > s.radius_miles THEN
    RETURN QUERY SELECT 'out_of_range'::text, v_rate, s.radius_miles, NULL::text, d.area_label, NULL::numeric, NULL::numeric,
                        s.rate_cents, s.free_over_cents, v_items;
    RETURN;
  END IF;
  RETURN QUERY SELECT NULL::text, v_rate, s.radius_miles, d.address, d.area_label, d.lat, d.lng,
                      s.rate_cents, s.free_over_cents, v_items;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_delivery_check(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivery_check(uuid, uuid, uuid[]) TO service_role;
