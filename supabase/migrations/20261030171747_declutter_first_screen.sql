-- /declutter's first screen in ONE read (lead's plan, 2026-10-30). Signed-in /declutter waits on about six separate
-- reads, each with its own browser preflight, before the first photo: switches, live items, photos, price-drop
-- columns, bundle sellers, watchlist. This returns them together.
--
-- NEW function, nothing restated. It grants nothing new:
--   SECURITY INVOKER + STABLE: the caller's own table grants and row policies decide, exactly as for the reads it
--   replaces. declutter_items' SELECT policy on prod (read 2026-10-30) already hides seed items in discovery, hidden
--   sellers, and anything the 'declutter' switch does not open, so no filter for those is repeated or weakened here.
--   Column list: the same names src/lib/declutter/api.ts reads (ITEM_COLUMNS + DROP_COLUMNS), all granted to
--   authenticated on prod (information_schema.column_privileges, 2026-10-30). No floor or private column is named,
--   and a column the caller was not granted would fail the read rather than return.
--   declutter_bundle_sellers and feature_switches_for_me are called as themselves, under their own rules. Bundle
--   sellers raises while the switch is off, so it is only asked once the switch reads on.
--
-- The client must keep today's reads as the fallback until this reaches prod (PGRST202).
--
-- THE CAP (lead's condition): 24 cards, not 500. The grids are 2 across on a phone (about 3 rows on screen) and at most
-- 5 across on a desktop (DeclutterSkeletons.tsx; 4 rows at 1440p), so 24 fills every screen we measure; 24 also divides
-- by 2, 3 and 4, so no last row sits half full while the rest load. 'more' says there were others, and then the client
-- still runs today's 500 read. A capped answer can't serve search, filters or the count: rows are filtered client-side.
-- THE ORDER: Browse sorts closest first in the browser, from the profile's position. So the 24 are the 24 NEAREST to
-- that same position ('near', the same formula as src/lib/declutter/distance.ts), newest first on a tie as a stable sort
-- of today's newest-first read gives. No position on file: newest. The client shows them ahead of the full list only
-- when its own origin equals 'near', so the first cards are exactly the top of the final list and nothing reorders.
-- The caller's own listings are left out, as Browse and Free both drop them: they would use up the 24.
--
-- REPLAY-SAFETY: CREATE OR REPLACE; grants restated. Returns jsonb, so scripts/ci/null-arg-validators.sql (boolean
-- functions) does not list it.
CREATE OR REPLACE FUNCTION public.declutter_first_screen(p_switch_keys text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_cap constant integer := 24;
  v_me uuid := (SELECT auth.uid());
  v_switches jsonb;
  v_lat double precision;
  v_lng double precision;
  v_rows jsonb[];
  v_items jsonb;
  v_ids uuid[];
  v_sellers uuid[];
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_switches := public.feature_switches_for_me(COALESCE(p_switch_keys, '{}'::text[]));

  -- The profile's own position; both or neither, as deriveFallbackLocation reads it.
  SELECT p.latitude::double precision, p.longitude::double precision INTO v_lat, v_lng
    FROM public.profiles p
   WHERE p.user_id = v_me AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL;

  SELECT array_agg(to_jsonb(t) ORDER BY t.miles NULLS LAST, t.live_at DESC) INTO v_rows
    FROM (
      SELECT i.id, i.seller_id, i.status, i.title, i.description, i.category, i.condition_stars, i.delivery_size,
             i.price_cents, i.current_price_cents, i.area_label, i.area_lat, i.area_lng, i.created_at, i.live_at,
             i.porch_ok, i.accepts_offers, i.sale_mode, i.last_price_drop_on, i.drop_pct,
             CASE WHEN v_lat IS NOT NULL THEN
               2 * 3958.8 * asin(least(1, sqrt(
                 sin(radians(COALESCE(i.area_lat, 0)::double precision - v_lat) / 2) ^ 2
                 + cos(radians(v_lat)) * cos(radians(COALESCE(i.area_lat, 0)::double precision))
                   * sin(radians(COALESCE(i.area_lng, 0)::double precision - v_lng) / 2) ^ 2)))
             END AS miles
        FROM public.declutter_items i
       WHERE i.status IN ('live', 'reserved') AND i.seller_id IS DISTINCT FROM v_me
       ORDER BY miles NULLS LAST, i.live_at DESC
       LIMIT v_cap + 1
    ) t;

  SELECT COALESCE(jsonb_agg(r.v - 'miles' ORDER BY r.n), '[]'::jsonb),
         array_agg((r.v ->> 'id')::uuid),
         array_agg(DISTINCT (r.v ->> 'seller_id')::uuid) FILTER (WHERE r.v ->> 'seller_id' IS NOT NULL)
    INTO v_items, v_ids, v_sellers
    FROM unnest(v_rows) WITH ORDINALITY AS r(v, n)
   WHERE r.n <= v_cap;

  RETURN jsonb_build_object(
    'switches', v_switches,
    'items', v_items,
    'more', COALESCE(cardinality(v_rows), 0) > v_cap,
    'near', CASE WHEN v_lat IS NOT NULL THEN jsonb_build_object('lat', v_lat, 'lng', v_lng) END,
    'photos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'item_id', p.item_id, 'storage_path', p.storage_path, 'position', p.position)
                       ORDER BY p.position)
        FROM public.declutter_item_photos p
       WHERE p.item_id = ANY (COALESCE(v_ids, '{}'::uuid[]))
    ), '[]'::jsonb),
    'watching', COALESCE((
      SELECT jsonb_agg(w.item_id) FROM public.declutter_watchlist w WHERE w.user_id = v_me
    ), '[]'::jsonb),
    'bundle_sellers', CASE
      WHEN COALESCE(v_switches ->> 'declutter', 'false') = 'true' AND COALESCE(cardinality(v_sellers), 0) > 0
        THEN to_jsonb(public.declutter_bundle_sellers(v_sellers))
      ELSE '[]'::jsonb
    END
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_first_screen(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_first_screen(text[]) TO authenticated, service_role;
