-- Q1930 (Builder 103/104 11-04): the exact (origin, drop-off) pairs a buyer's delivery quote from one
-- seller passes to declutter_road_miles, so declutter-checkout can route them with Apple (/v1/etas) and store each in
-- declutter_route_miles (20261104105545) right after the drop-off is geocoded. The origins are rounded to 2 dp exactly
-- as the callers round them (20261102030012: the seller's porch places when any, else each in-cart line's pickup
-- point; 20261101175628 / 20261030164712 the same rounding); the drop-off is passed unrounded, as they pass d.lat/d.lng.
-- service_role only: it reads private pickup points. New object only. Replay-safe: CREATE OR REPLACE.
-- At most 40 pairs; a pair routed within 180 days is left out (no repeat Apple call). The caller is
-- supabase/functions/_shared/appleRoutes.ts storeRoutedMiles, run in the background after the quote is answered.
-- Failure memory (lead review 11-04): declutter_route_health holds ONE row; declutter_route_outage(p_minutes) sets its
-- miss_until after an Apple miss, and until then declutter_route_pairs answers no pairs, so an outage does not make
-- every quote ask Apple again. declutter_delivery_quotes_shown: see its own note below. PROOF: src/test/pglite/declutterRoutePairs.pglite.mjs.
CREATE TABLE IF NOT EXISTS public.declutter_route_health (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  miss_until timestamptz,
  misses integer NOT NULL DEFAULT 0 CHECK (misses >= 0),
  last_miss_at timestamptz
);
ALTER TABLE public.declutter_route_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_route_health FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_route_health TO service_role;

-- The Helpr delivery price last SHOWN to a buyer for one seller's cart (lead final review 11-04): every installed app
-- before this sends no expected price for 'delivery', so with routed miles landing after the quote, checkout compares
-- the price it is about to freeze with this one and refuses a different one (delivery_rate_changed). Written by the
-- delivery quote (declutter-checkout, service role) each time it answers; one row per buyer and seller (the drop-off
-- has the same key as declutter_delivery_dropoffs, 20261017055505). Nobody else reads or writes it.
CREATE TABLE IF NOT EXISTS public.declutter_delivery_quotes_shown (
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delivery_cents integer NOT NULL CHECK (delivery_cents >= 0),
  quoted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_id, seller_id)
);
CREATE INDEX IF NOT EXISTS declutter_delivery_quotes_shown_seller_idx ON public.declutter_delivery_quotes_shown (seller_id);
ALTER TABLE public.declutter_delivery_quotes_shown ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_delivery_quotes_shown FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_delivery_quotes_shown TO service_role;

-- Records one shown price, but never over a NEWER one (lead approval note 11-04): two quotes answering out of order
-- keep the later quote's price. p_at is when the quote was read.
CREATE OR REPLACE FUNCTION public.declutter_record_quote_shown(p_buyer uuid, p_seller uuid, p_cents integer, p_at timestamptz)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  INSERT INTO public.declutter_delivery_quotes_shown AS t (buyer_id, seller_id, delivery_cents, quoted_at)
  VALUES (p_buyer, p_seller, p_cents, coalesce(p_at, now()))
  ON CONFLICT (buyer_id, seller_id) DO UPDATE SET delivery_cents = excluded.delivery_cents, quoted_at = excluded.quoted_at
   WHERE excluded.quoted_at >= t.quoted_at;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_record_quote_shown(uuid, uuid, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_quote_shown(uuid, uuid, integer, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_route_outage(p_minutes integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  INSERT INTO public.declutter_route_health AS h (id, miss_until, misses, last_miss_at)
  VALUES (true, now() + make_interval(mins => least(greatest(coalesce(p_minutes, 10), 1), 60)), 1, now())
  ON CONFLICT (id) DO UPDATE SET miss_until = excluded.miss_until, misses = h.misses + 1, last_miss_at = now();
$fn$;
REVOKE ALL ON FUNCTION public.declutter_route_outage(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_route_outage(integer) TO service_role;

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
   WHERE NOT EXISTS (SELECT 1 FROM public.declutter_route_health h WHERE h.miss_until > now())
     AND NOT EXISTS (SELECT 1 FROM public.declutter_route_miles r
                      WHERE r.o_lat = o.lat AND r.o_lng = o.lng AND r.d_lat = d.lat AND r.d_lng = d.lng
                        AND r.routed_at > now() - interval '180 days')
   LIMIT 40;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_route_pairs(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_route_pairs(uuid, uuid) TO service_role;
