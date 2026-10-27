-- THE FAIR-PRICE HINT IGNORES $0 FREE HANDOVERS (lead 2026-10-27, from the Q2430 auto-free review, #8).
--
-- declutter_price_hint ("Similar items sold for $X-$Y near you") counted every paid-and-handed-over cart
-- line, and a FREE item's line is $0 (20261027170717: free orders are 'paid' at $0 and handed over like
-- any other). Each free handover dragged the low end of the hint toward $0, and Q2430's day-12 auto-free
-- makes many more of them. Now only lines with a price count.
--
-- Restated from its newest definition, 20261016053541_declutter_wanted_price_hint (no later migration
-- redefines it), with only that line added. Replay-safe: CREATE OR REPLACE; grants restated (REVOKE ...
-- FROM PUBLIC, anon). Proof: src/test/pglite/declutterPriceHintNoFree.pglite.mjs. Guard:
-- src/test/declutterPriceHintNoFree.test.ts.

CREATE OR REPLACE FUNCTION public.declutter_price_hint(p_category text, p_condition_stars integer, p_lat numeric, p_lng numeric)
RETURNS TABLE(low_cents integer, high_cents integer, sales integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_price_hint');
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_category IS NULL OR p_condition_stars IS NULL OR p_lat IS NULL OR p_lng IS NULL
     OR p_condition_stars NOT BETWEEN 1 AND 5 THEN
    RETURN;
  END IF;
  RETURN QUERY
    WITH sold AS (
      SELECT c.price_cents, c.seller_id, c.buyer_id, o.handed_over_at
        FROM public.declutter_cart_items c
        JOIN public.declutter_orders o ON o.id = c.order_id
        JOIN public.declutter_items i ON i.id = c.item_id
       WHERE c.status = 'paid'
         -- Q2430 review #8: a $0 free handover is not a sale price (auto-free will make more of them).
         AND c.price_cents > 0
         AND o.status = 'handed_over'
         AND o.handed_over_at > now() - interval '365 days'
         AND NOT c.is_seed AND NOT o.is_seed AND NOT i.is_seed
         AND NOT EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.user_id IN (c.seller_id, c.buyer_id) AND COALESCE(p.is_seed, false))
         AND i.category = p_category
         AND i.condition_stars = p_condition_stars
         AND public.declutter_miles(round(p_lat, 1), round(p_lng, 1), i.area_lat, i.area_lng) <= 25
         AND NOT public.declutter_member_out(c.seller_id)
         AND NOT public.declutter_member_out(c.buyer_id)
    ), one_per_pair AS (
      -- The latest sale between each pair of members, whichever way it went.
      SELECT DISTINCT ON (least(s.seller_id, s.buyer_id), greatest(s.seller_id, s.buyer_id))
             s.price_cents, s.seller_id, s.buyer_id
        FROM sold s
       ORDER BY least(s.seller_id, s.buyer_id), greatest(s.seller_id, s.buyer_id), s.handed_over_at DESC
    ), agg AS (
      SELECT count(*)::integer AS n,
             count(DISTINCT s.seller_id)::integer AS sellers,
             count(DISTINCT s.buyer_id)::integer AS buyers,
             percentile_disc(0.1) WITHIN GROUP (ORDER BY s.price_cents) AS p10,
             percentile_disc(0.9) WITHIN GROUP (ORDER BY s.price_cents) AS p90
        FROM one_per_pair s
    )
    SELECT greatest(100, (floor(a.p10 / 500.0) * 500)::integer), (ceil(a.p90 / 500.0) * 500)::integer, (a.n / 10) * 10
      FROM agg a
     WHERE a.n >= 11 AND a.sellers >= 3 AND a.buyers >= 3;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_price_hint(text, integer, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_price_hint(text, integer, numeric, numeric) TO authenticated, service_role;
