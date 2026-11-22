-- Deep audit 11-22 #56 (owner rule: a listing with offers turned off never mentions offers): declutter_item_demand
-- counted different buyers' offers in the last 7 days whatever the listing's accepts_offers, so a seller who turned
-- offers off after 2 offers kept "2 offers this week" on the item page (DemandLine) and the "In demand" tag on Browse
-- (isInDemand), on a listing with no offer button. offers_week is now 0 while accepts_offers is false. The body is
-- restated verbatim from 20261120121830 apart from the lines marked CHANGED 20261122134941; the signature, return
-- type, SECURITY DEFINER, search_path, grants and comment are unchanged (no permission change).
-- REPLAY-SAFE: CREATE OR REPLACE with the unchanged signature and return type; grants restated as they were.
-- Proof: src/test/pglite/declutterItemDemand.pglite.mjs (applied 3x after every earlier definition).

CREATE OR REPLACE FUNCTION public.declutter_item_demand(p_item_ids uuid[])
RETURNS TABLE(item_id uuid, saves integer, offers_week integer, views_today integer, sale_pct integer, sale_ends_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_today timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Chicago')) AT TIME ZONE 'America/Chicago';
  v_ids uuid[];
BEGIN
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_item_ids) > 200 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023', HINT = 'Ask about at most 200 items at a time.';
  END IF;
  IF v_uid IS NULL THEN
    IF NOT public.declutter_open_to_guests() THEN
      RETURN;
    END IF;
    SELECT array_agg(i.id) INTO v_ids
      FROM public.declutter_items i
     WHERE i.id = ANY (p_item_ids)
       AND i.status IN ('live', 'reserved')
       AND NOT i.seller_hidden
       AND NOT i.is_seed;
  ELSE
    SELECT array_agg(i.id) INTO v_ids
      FROM public.declutter_items i
     WHERE i.id = ANY (p_item_ids)
       AND i.status IN ('live', 'reserved')
       AND (
         i.seller_id = v_uid
         OR (
           (SELECT public.feature_enabled_for('declutter'))
           AND NOT i.seller_hidden
           AND (NOT i.is_seed OR NOT (SELECT public.seed_hidden_in_discovery()))
           AND NOT (i.seller_id = ANY (COALESCE((SELECT public.declutter_my_block_partners()), '{}'::uuid[])))
         )
       );
  END IF;
  IF v_ids IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT i.id,
           (SELECT count(*)::integer FROM public.declutter_watchlist w
             WHERE w.item_id = i.id AND w.user_id <> i.seller_id),
           -- CHANGED 20261122134941 (deep audit 11-22 #56): a listing with offers turned off never reports offers.
           CASE WHEN i.accepts_offers THEN
           (SELECT count(DISTINCT o.buyer_id)::integer FROM public.declutter_offers o
             WHERE o.item_id = i.id AND o.created_at > now() - interval '7 days'
               AND NOT EXISTS (SELECT 1 FROM public.profiles bp WHERE bp.user_id = o.buyer_id AND bp.is_seed)
               AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = o.buyer_id))
           ELSE 0 END,
           -- CHANGED 20261120121830: both columns are uuid (was viewer_id::text vs a uuid device_id, 42804).
           (SELECT count(DISTINCT COALESCE(v.viewer_id, v.device_id))::integer FROM public.declutter_item_views v
             WHERE v.item_id = i.id AND v.created_at >= v_today
               AND (v.viewer_id IS NULL OR v.viewer_id <> i.seller_id)
               AND NOT EXISTS (SELECT 1 FROM public.profiles vp WHERE vp.user_id = v.viewer_id AND vp.is_seed)
               AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = v.viewer_id)),
           -- CHANGED 20261120014036: the running shop sale, only while this listing's price is its sale price.
           s.percent_off::integer,
           s.ends_at
      FROM public.declutter_items i
      LEFT JOIN LATERAL (
        SELECT ss.percent_off, ss.ends_at
          FROM public.declutter_shop_sale_items x
          JOIN public.declutter_shop_sales ss ON ss.id = x.sale_id AND ss.status = 'on'
         WHERE x.item_id = i.id AND x.restored_at IS NULL AND x.sale_cents = i.current_price_cents
         LIMIT 1
      ) s ON true
     WHERE i.id = ANY (v_ids);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_demand(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_item_demand(uuid[]) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_item_demand(uuid[]) IS
  'Declutter top 5 #3/#4 (owner 11-19): saves, offers this week, views today and the running shop sale per visible item; numbers only.';
