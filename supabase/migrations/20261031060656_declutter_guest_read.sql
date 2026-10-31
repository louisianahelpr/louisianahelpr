-- BUY-16 (audit 10-30, High), server slice: guests can read live Declutter listings.
-- Owner 10-30 (OWNER-DECISIONS "Declutter buying"): "Guests see Declutter Browse and item pages; sign up to buy or
-- offer; no seller full name or address." Before this, anon held no grant on declutter_items or
-- declutter_item_photos at all, so every shared listing (and "Post to Facebook") hit the login wall.
--
-- What a guest may read, and only while the declutter switch is set to everyone (a testers-only Declutter stays
-- members-only, as spec B11 asked "while the switch is not 'everyone'"):
--   1. declutter_items: live and reserved rows, never a hidden seller's, never test data (is_seed), and only the
--      columns the item page and Browse print (the same list as src/lib/declutter/api.ts ITEM_COLUMNS, plus
--      handovers, and the price-drop columns a member buyer reads: DROP_COLUMNS sale_mode, last_price_drop_on,
--      drop_pct, drops_stopped; without them the item page's drop read is refused and reported on every guest visit). No address is on this table: area_label is the city, area_lat/area_lng are
--      numeric(5,2)/(6,2), about 1 km (20261014193955).
--   2. declutter_item_photos: the photo rows of an item the guest can read (the files sit in the public bucket
--      already; the rows say which files belong to which item).
-- Nothing else: no write, no RPC beyond the one stable check below, no seller name (the seller card stays members-only).
--
-- REPLAY-SAFETY: CREATE OR REPLACE; DROP POLICY IF EXISTS + CREATE POLICY; GRANTs restated.

CREATE OR REPLACE FUNCTION public.declutter_open_to_guests()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.feature_switches s WHERE s.key = 'declutter' AND s.audience = 'everyone');
$fn$;
REVOKE ALL ON FUNCTION public.declutter_open_to_guests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_open_to_guests() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_open_to_guests() IS
  'BUY-16: true while the declutter switch is set to everyone. Guests read live listings only then.';

GRANT SELECT (id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents,
              current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers,
              drops_stopped, handovers, sale_mode, last_price_drop_on, drop_pct)
  ON public.declutter_items TO anon;

DROP POLICY IF EXISTS "declutter items: guests read live" ON public.declutter_items;
CREATE POLICY "declutter items: guests read live" ON public.declutter_items
  FOR SELECT TO anon
  USING (
    status IN ('live', 'reserved')
    AND (SELECT public.declutter_open_to_guests())
    AND NOT seller_hidden
    AND NOT is_seed
  );

GRANT SELECT (id, item_id, storage_path, position, created_at) ON public.declutter_item_photos TO anon;

DROP POLICY IF EXISTS "declutter photos: guests read with their item" ON public.declutter_item_photos;
CREATE POLICY "declutter photos: guests read with their item" ON public.declutter_item_photos
  FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = declutter_item_photos.item_id));
