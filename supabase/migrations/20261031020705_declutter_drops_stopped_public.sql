-- POST-DROPFLAG: a buyer sees "Price can drop" on a listing whose seller stopped drops, until the next sweep passes it.
-- declutter_item_private.drops_stopped says so, but buyers can't read that table, so the client could learn it only by
-- seeing the sweep leave last_price_drop_on alone. Measured on prod 2026-10-30: 1 stopped row.
--
-- The new public column says only what the listing's behaviour already shows within a day: "this listing's price will
-- not drop". The stop price stays private, and so does the floor.
--
-- declutter_set_listing_drops is restated from prod's definition (pg_get_functiondef, md5
-- 691f02d2e2c7d5d32e3528fad044a6a6, read 2026-10-30): one added UPDATE, nothing else changed. It is the only writer of
-- drops_stopped on prod (a text search of every public function finds four: this one writes it;
-- declutter_set_listing_price, declutter_listing_manage_state and declutter_price_nudge_sweep only read it).
-- It already holds the item's row FOR UPDATE, so the two tables cannot disagree after it commits.
-- declutter_first_screen is restated from prod's definition (md5 743e7aee8f90196246de056a9acdfa44, read 2026-10-30):
-- one added column in the select list, so Browse's one read answers what fetchDropStates would. It stays SECURITY
-- INVOKER, so the column's grant below is what lets it read.
--
-- No member can write the new column: authenticated holds no INSERT or UPDATE on declutter_items at table or column
-- level (information_schema, 2026-10-30), and this grants none. anon holds no grant on the table (same read) and gets none.
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS; the backfill only ever writes rows that disagree; CREATE OR REPLACE; grants
-- restated. declutter_set_listing_drops stays classified in scripts/ci/null-arg-validators.sql (same signature).

ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS drops_stopped boolean NOT NULL DEFAULT false;

-- Every listing's flag from the private row, either way, so a replay repairs and never overwrites a later seller's choice
-- with anything but that seller's own current choice. An item with no private row keeps the default: nothing to mirror.
UPDATE public.declutter_items i
   SET drops_stopped = p.drops_stopped
  FROM public.declutter_item_private p
 WHERE p.item_id = i.id
   AND i.drops_stopped IS DISTINCT FROM p.drops_stopped;

GRANT SELECT (drops_stopped) ON public.declutter_items TO authenticated;

CREATE OR REPLACE FUNCTION public.declutter_set_listing_drops(p_item_id uuid, p_on boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  -- NULL makes the trigger pick a fresh stop above the floor.
  UPDATE public.declutter_item_private
     SET drop_stop_cents = CASE WHEN p_on THEN NULL ELSE greatest(v_item.current_price_cents, floor_price_cents + 1) END,
         drops_stopped = NOT p_on,
         updated_at = now()
   WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- The buyer-readable copy (POST-DROPFLAG). In this same transaction: raising above rolls both back.
  UPDATE public.declutter_items
     SET drops_stopped = NOT p_on
   WHERE id = p_item_id;
  RETURN p_on;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_set_listing_drops(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_listing_drops(uuid, boolean) TO authenticated, service_role;

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
         left(regexp_replace(COALESCE(p.zip_code, ''), '[^0-9]', '', 'g'), 5)
    INTO v_lat, v_lng, v_zip
    FROM public.profiles p
   WHERE p.user_id = v_me;

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
    'zip_parish', CASE WHEN v_lat IS NULL AND length(v_zip) = 5
      THEN jsonb_build_object('zip', v_zip, 'parish', public.get_parish_for_zip(v_zip)) END,
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
