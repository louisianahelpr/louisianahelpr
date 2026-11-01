-- Declutter Browse's capped first answer never showed for a member whose profile holds a ZIP and no position (the
-- signup default; measured 2026-11-01 as the customer test account: ZIP 70501, no latitude/longitude).
--
-- declutter_first_screen (newest: 20261031020705) sorted from the profile's own latitude/longitude, else newest
-- first, and said near = null. The browser, for that same member, measures miles from the ZIP's parish centre
-- (useDeclutterOrigin -> deriveFallbackLocation -> getParishCentroid). Browse shows the capped cards ahead of the full
-- read ONLY when they are the top of its own list (previewIsTopOfList), and null vs a parish point is never that. So
-- every such member waited for the full listings read, then the photo read, before any card (B81's lab: the first
-- photo at ~8.4 s on Slow 4G).
--
-- Now, with no position on file, the answer sorts from the same parish point the browser uses (ZIP's parish first,
-- then the profile's parish) and returns it as `near`, so the two agree and the first cards come from this one read.
-- zip_parish is still sent for the browser's ZIP lookup; it now reuses the one get_parish_for_zip call. A position on
-- file, and a member with neither ZIP nor parish, are answered exactly as before. Still SECURITY INVOKER and STABLE:
-- the row policies decide what is read; the parish table is public geography, not member data.
--
-- Restated from 20261031020705 (newest on origin/main 2026-11-01); only the position block and zip_parish changed.
-- REPLAY-SAFETY: CREATE OR REPLACE of an existing function; every object it reads exists in earlier migrations.

CREATE OR REPLACE FUNCTION public.declutter_first_screen(p_switch_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cap constant integer := 24;
  v_me uuid := (SELECT auth.uid());
  v_switches jsonb;
  v_lat double precision;
  v_lng double precision;
  v_zip text;
  v_parish text;
  v_zip_parish text;
  v_has_position boolean;
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
  SELECT CASE WHEN p.longitude IS NOT NULL THEN p.latitude::double precision END,
         CASE WHEN p.latitude IS NOT NULL THEN p.longitude::double precision END,
         left(regexp_replace(COALESCE(p.zip_code, ''), '[^0-9]', '', 'g'), 5),
         p.parish
    INTO v_lat, v_lng, v_zip, v_parish
    FROM public.profiles p
   WHERE p.user_id = v_me;
  v_has_position := v_lat IS NOT NULL;

  -- B82: no position on file. The browser then measures from the ZIP's parish, else the profile's parish
  -- (deriveFallbackLocation's rungs 2 and 3), at src/lib/parishCentroids.ts's point for it (getParishCentroid: a
  -- trailing " Parish" dropped, the name matched exactly). Sort from that same point, so the capped answer is the top
  -- of the list the browser draws and Browse can show it before the full read. The table is a COPY of
  -- PARISH_CENTROIDS; src/test/declutterFirstScreenParishOrigin.test.ts holds the two equal.
  IF NOT v_has_position THEN
    IF length(v_zip) = 5 THEN
      v_zip_parish := public.get_parish_for_zip(v_zip);
    END IF;
    SELECT c.lat, c.lng INTO v_lat, v_lng
      FROM (VALUES
        ('Orleans', 29.9511, -90.0715),
        ('Jefferson', 29.9494, -90.1486),
        ('St. Tammany', 30.4218, -89.9986),
        ('East Baton Rouge', 30.4583, -91.1403),
        ('Lafayette', 30.2241, -92.0198),
        ('Caddo', 32.5776, -93.8773),
        ('Calcasieu', 30.2266, -93.2174),
        ('Ouachita', 32.4807, -92.1193),
        ('Rapides', 31.2911, -92.4451),
        ('Bossier', 32.5232, -93.6629),
        ('Tangipahoa', 30.6260, -90.4290),
        ('St. Bernard', 29.7574, -89.7892),
        ('Plaquemines', 29.4716, -89.6553),
        ('Livingston', 30.4441, -90.7301),
        ('Ascension', 30.2046, -90.9046),
        ('Iberia', 30.0085, -91.8276),
        ('Lafourche', 29.4513, -90.3085),
        ('Terrebonne', 29.5833, -90.7050),
        ('St. Charles', 29.9358, -90.3661),
        ('Vermilion', 29.8732, -92.2987),
        ('St. Landry', 30.6905, -92.0123),
        ('Acadia', 30.2775, -92.4111),
        ('Natchitoches', 31.7232, -93.0860),
        ('Webster', 32.7184, -93.3360),
        ('Beauregard', 30.6477, -93.3500),
        ('Allen', 30.6486, -92.8294),
        ('St. Mary', 29.6377, -91.4490),
        ('Pointe Coupee', 30.7088, -91.5969),
        ('St. Martin', 30.1271, -91.6021),
        ('St. James', 30.0289, -90.7929),
        ('St. John the Baptist', 30.1247, -90.4892),
        ('Washington', 30.8478, -90.0411),
        ('Avoyelles', 31.0658, -92.0061),
        ('Evangeline', 30.7349, -92.4142),
        ('Vernon', 31.1080, -93.1834),
        ('Sabine', 31.5650, -93.5520),
        ('DeSoto', 32.0596, -93.7397),
        ('Bienville', 32.3504, -92.9899),
        ('Jackson', 32.2989, -92.5595),
        ('Lincoln', 32.6053, -92.6629),
        ('Union', 32.8323, -92.3713),
        ('Morehouse', 32.8156, -91.7929),
        ('West Carroll', 32.7951, -91.4489),
        ('East Carroll', 32.7333, -91.2358),
        ('Madison', 32.3633, -91.2275),
        ('Tensas', 32.0036, -91.3433),
        ('Concordia', 31.4424, -91.6379),
        ('Catahoula', 31.6628, -91.8551),
        ('LaSalle', 31.6747, -92.1597),
        ('Grant', 31.5949, -92.5638),
        ('Winn', 31.9460, -92.6402),
        ('Caldwell', 32.0921, -92.1225),
        ('Franklin', 32.1304, -91.6749),
        ('Richland', 32.4131, -91.7654),
        ('West Baton Rouge', 30.4661, -91.3145),
        ('Iberville', 30.3164, -91.3469),
        ('West Feliciana', 30.8772, -91.4044),
        ('East Feliciana', 30.8442, -91.0429),
        ('St. Helena', 30.8175, -90.7068),
        ('Assumption', 29.9101, -91.0628),
        ('Cameron', 29.8324, -93.1700),
        ('Jefferson Davis', 30.2649, -92.8127),
        ('Red River', 32.0950, -93.3360),
        ('Claiborne', 32.8221, -92.9963)
      ) AS c(name, lat, lng)
     WHERE c.name IN (trim(regexp_replace(COALESCE(v_zip_parish, ''), '\s+Parish\s*$', '', 'i')),
                      trim(regexp_replace(COALESCE(v_parish, ''), '\s+Parish\s*$', '', 'i')))
     ORDER BY (c.name = trim(regexp_replace(COALESCE(v_zip_parish, ''), '\s+Parish\s*$', '', 'i'))) DESC
     LIMIT 1;
  END IF;

  SELECT array_agg(to_jsonb(t) ORDER BY t.miles NULLS LAST, t.live_at DESC) INTO v_rows
    FROM (
      SELECT i.id, i.seller_id, i.status, i.title, i.description, i.category, i.condition_stars, i.delivery_size,
             i.price_cents, i.current_price_cents, i.area_label, i.area_lat, i.area_lng, i.created_at, i.live_at,
             i.porch_ok, i.accepts_offers, i.sale_mode, i.last_price_drop_on, i.drop_pct, i.drops_stopped,
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
    'zip_parish', CASE WHEN NOT v_has_position AND length(v_zip) = 5
      THEN jsonb_build_object('zip', v_zip, 'parish', v_zip_parish) END,
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
$function$;

REVOKE ALL ON FUNCTION public.declutter_first_screen(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_first_screen(text[]) TO authenticated, service_role;
