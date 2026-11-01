-- Helpr delivery price: $6 + $1.50 a mile (owner 2026-11-01, 11:50 AM, via the lead; was $10 + $2). Size add-ons
-- stay: large +$20, extra large +$40. Examples: 5 road miles, small = 600 + 750 = $13.50; 10 miles, large =
-- 600 + 1500 + 2000 = $41.
--
-- What follows the price, unchanged: the Helpr's pay is the order's delivery_cents (declutter_order_paid_task in
-- 20261030164712 calls helpr_task_create(..., NEW.delivery_cents, ...)), and their take-home is that pay less jobs'
-- flat 5% + 70c (helpr_task_fee_cents), rounded down to the dollar, so the split is the same on the new price.
--
-- Restated from the NEWEST definitions:
--   declutter_delivery_price_cents  20261017055505_declutter_helpr_delivery (only definition)
--   declutter_delivery_compute      20261030164712_declutter_porch_places (its base/per-mile breakdown columns)
-- The two CHECKs that held the old $10 floor are re-added with the new floor, $7.50 (1 road mile, small):
--   declutter_orders_delivery                         from 20261027153244_declutter_seller_delivery
--   declutter_order_deliveries' delivery_cents check  from 20261017055505 (inline, unnamed)
-- ACK-REASON: each CHECK is dropped only to be re-added in the same block with a LOWER floor; every existing row
--   (delivery_cents >= 1000) satisfies it.
-- ACK-DATA-LOSS: none; no column, table or row is dropped.
-- Replay-safe: CREATE OR REPLACE; DROP CONSTRAINT IF EXISTS then ADD. Proof: src/test/pglite/declutterDeliveryPrice1101.pglite.mjs.

CREATE OR REPLACE FUNCTION public.declutter_delivery_price_cents(p_miles integer, p_sizes text[])
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT 600 + 150 * greatest(COALESCE(p_miles, 1), 1)
         + COALESCE((SELECT sum(CASE s WHEN 'large' THEN 2000 WHEN 'xl' THEN 4000 ELSE 0 END)::integer
                       FROM unnest(COALESCE(p_sizes, '{}'::text[])) s), 0);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_price_cents(integer, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_price_cents(integer, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_delivery_compute(p_buyer uuid, p_seller uuid, p_lines uuid[])
RETURNS TABLE (road_miles integer, size text, delivery_cents integer, base_cents integer, per_mile_cents integer,
               size_cents integer, pickup_address text, pickup_lat numeric, pickup_lng numeric, dropoff_address text,
               dropoff_area text, dropoff_lat numeric, dropoff_lng numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  d public.declutter_delivery_dropoffs;
  v_sizes text[];
  v_addr text;
  v_lat numeric;
  v_lng numeric;
  v_far integer;
  v_miles integer;
  v_place public.declutter_porch_places%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.declutter_delivery_dropoffs x WHERE x.buyer_id = p_buyer AND x.seller_id = p_seller;
  IF NOT FOUND OR d.geocoded_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'delivery_address_needed' USING ERRCODE = '22023',
      HINT = 'Enter the address to deliver to.';
  END IF;
  -- D-NEW14 (20261030164712): a seller with saved porch places is picked up from the place the buyer chose.
  IF EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller) THEN
    SELECT pl.* INTO v_place
      FROM public.declutter_porch_place_choices ch
      JOIN public.declutter_porch_places pl ON pl.id = ch.place_id
     WHERE ch.buyer_id = p_buyer AND ch.seller_id = p_seller AND pl.seller_id = p_seller;
    IF v_place.id IS NULL THEN
      RAISE EXCEPTION 'porch_place_needed' USING ERRCODE = '22023',
        HINT = 'Pick which of the seller''s pickup places the Helpr picks up from.';
    END IF;
  END IF;
  SELECT array_agg(i.delivery_size ORDER BY c.id),
         (array_agg(p.pickup_address ORDER BY c.id))[1],
         (array_agg(p.pickup_lat ORDER BY c.id))[1],
         (array_agg(p.pickup_lng ORDER BY c.id))[1]
    INTO v_sizes, v_addr, v_lat, v_lng
    FROM public.declutter_cart_items c
    JOIN public.declutter_items i ON i.id = c.item_id
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.buyer_id = p_buyer AND c.seller_id = p_seller
     AND (CASE WHEN p_lines IS NULL THEN c.status = 'in_cart' AND c.checkout_by > now() ELSE c.id = ANY (p_lines) END);
  IF v_sizes IS NULL OR cardinality(v_sizes) = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000';
  END IF;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    RAISE EXCEPTION 'delivery_unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_place.id IS NOT NULL THEN
    -- D-NEW14: one place is one pickup stop.
    v_addr := v_place.address;
    v_lat := v_place.lat;
    v_lng := v_place.lng;
  ELSE
  -- B61: one pickup stop. Every item within 200 m of the first one's address.
  SELECT max(public.helpr_task_distance_m(v_lat, v_lng, p.pickup_lat, p.pickup_lng)) INTO v_far
    FROM public.declutter_cart_items c
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.buyer_id = p_buyer AND c.seller_id = p_seller
     AND (CASE WHEN p_lines IS NULL THEN c.status = 'in_cart' AND c.checkout_by > now() ELSE c.id = ANY (p_lines) END);
  IF v_far IS NULL OR v_far > 200 THEN
    RAISE EXCEPTION 'delivery_one_address' USING ERRCODE = '22023',
      HINT = 'These items are at different addresses, so they can''t be delivered together. Choose pickup.';
  END IF;
  END IF;
  -- Priced from the ROUNDED pickup point (2 decimals, ~1 km), never the exact
  -- one: the buyer chooses the drop-off, so a price measured from the exact
  -- point would let a buyer with an unpaid cart line trilaterate the seller's
  -- home by quoting chosen addresses (lh-authz-rls review #2, 2026-10-16; row
  -- 27). The error is at most about a mile, about $2.
  v_miles := public.declutter_road_miles(round(v_lat, 2), round(v_lng, 2), d.lat, d.lng);
  RETURN QUERY SELECT v_miles,
    CASE WHEN 'xl' = ANY (v_sizes) THEN 'xl' WHEN 'large' = ANY (v_sizes) THEN 'large' ELSE 'small' END,
    public.declutter_delivery_price_cents(v_miles, v_sizes),
    600, 150 * v_miles, public.declutter_delivery_price_cents(v_miles, v_sizes) - 600 - 150 * v_miles,
    v_addr, v_lat, v_lng, d.address, d.area_label, d.lat, d.lng;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_compute(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_compute(uuid, uuid, uuid[]) TO service_role;


DO $do$
BEGIN
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_delivery;
  -- A Helpr delivery carries its fee (>= $7.50 now); a seller delivery a whole-dollar rate: 0 when
  -- free, else inside the rules' $5-$150 (declutter_seller_delivery_rules; lh-money-escrow note 5).
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_delivery
    CHECK (delivery_cents >= 0 AND (handover <> 'delivery' OR delivery_cents >= 750)
           AND (handover <> 'seller_delivery'
                OR (delivery_cents % 100 = 0 AND (delivery_cents = 0 OR delivery_cents BETWEEN 500 AND 15000))));
  ALTER TABLE public.declutter_order_deliveries DROP CONSTRAINT IF EXISTS declutter_order_deliveries_delivery_cents_check;
  ALTER TABLE public.declutter_order_deliveries ADD CONSTRAINT declutter_order_deliveries_delivery_cents_check
    CHECK (delivery_cents >= 750);
END
$do$;
