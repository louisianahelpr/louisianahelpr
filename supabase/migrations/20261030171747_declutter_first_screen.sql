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
  v_me uuid := (SELECT auth.uid());
  v_switches jsonb;
  v_items jsonb;
  v_ids uuid[];
  v_sellers uuid[];
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_switches := public.feature_switches_for_me(COALESCE(p_switch_keys, '{}'::text[]));

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.live_at DESC), '[]'::jsonb),
         array_agg(t.id),
         (array_agg(DISTINCT t.seller_id))[1:200]
    INTO v_items, v_ids, v_sellers
    FROM (
      SELECT i.id, i.seller_id, i.status, i.title, i.description, i.category, i.condition_stars, i.delivery_size,
             i.price_cents, i.current_price_cents, i.area_label, i.area_lat, i.area_lng, i.created_at, i.live_at,
             i.porch_ok, i.accepts_offers, i.sale_mode, i.last_price_drop_on, i.drop_pct
        FROM public.declutter_items i
       WHERE i.status IN ('live', 'reserved')
       ORDER BY i.live_at DESC
       LIMIT 500
    ) t;

  RETURN jsonb_build_object(
    'switches', v_switches,
    'items', v_items,
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
