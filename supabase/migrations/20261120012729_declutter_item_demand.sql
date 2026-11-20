-- Declutter top 5, #3 (owner 11-19, "Do all 5", after the Vinted/Depop audit): "IN DEMAND" on listings. The item page
-- says "8 people saved this", "3 offers this week", "12 views today", and a Browse card wears an "In demand" tag, each
-- only past a threshold (src/lib/declutter/sellerTools.ts DEMAND_MIN), so small numbers never show. Real counts only.
--
-- declutter_item_demand(p_item_ids) -> (item_id, saves, offers_week, views_today), for at most 200 items:
--   saves        members who saved it (declutter_watchlist), never the seller's own heart;
--   offers_week  different buyers who made or got an offer on it in the last 7 days (declutter_offers.created_at);
--   views_today  different people or devices who opened it since midnight Louisiana time (declutter_item_views).
-- A test account's or seed profile's offer or view is not counted (owner rule: test data never shows; a test buyer's
-- offers would be a made-up "in demand"). Only numbers, never who.
-- Visibility: exactly declutter_item_save_counts' rules (20261107232700): a guest sees the anon policy's items, a member
-- the members' policy's listings plus their own; an item the caller cannot see is left out, like one with no demand.
-- Granted to anon and authenticated (guests land on Browse and item pages from Facebook). Read after the cards paint.
-- REPLAY-SAFE: CREATE OR REPLACE; grants restated. Proof: src/test/pglite/declutterItemDemand.pglite.mjs (applied 3x).
CREATE OR REPLACE FUNCTION public.declutter_item_demand(p_item_ids uuid[])
RETURNS TABLE(item_id uuid, saves integer, offers_week integer, views_today integer)
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
  -- The items the caller can see (declutter_item_save_counts' rules, restated).
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
           (SELECT count(DISTINCT o.buyer_id)::integer FROM public.declutter_offers o
             WHERE o.item_id = i.id AND o.created_at > now() - interval '7 days'
               AND NOT EXISTS (SELECT 1 FROM public.profiles bp WHERE bp.user_id = o.buyer_id AND bp.is_seed)
               AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = o.buyer_id)),
           (SELECT count(DISTINCT COALESCE(v.viewer_id::text, v.device_id))::integer FROM public.declutter_item_views v
             WHERE v.item_id = i.id AND v.created_at >= v_today
               AND (v.viewer_id IS NULL OR v.viewer_id <> i.seller_id)
               AND NOT EXISTS (SELECT 1 FROM public.profiles vp WHERE vp.user_id = v.viewer_id AND vp.is_seed)
               AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = v.viewer_id))
      FROM public.declutter_items i
     WHERE i.id = ANY (v_ids);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_demand(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_item_demand(uuid[]) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_item_demand(uuid[]) IS
  'Declutter top 5 #3 (owner 11-19): saves, offers this week and views today per visible item; numbers only, test people not counted.';
