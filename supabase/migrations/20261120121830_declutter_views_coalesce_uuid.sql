-- FIX (real member, 2026-11-20 12:03Z, Sentry JAVASCRIPT-5T/5V, Postgres 42804 "COALESCE types text and uuid cannot be
-- matched"): declutter_item_demand (20261120014036) and declutter_selling_home (20261120012050) counted unique viewers
-- with COALESCE(v.viewer_id::text, v.device_id), but declutter_item_views.device_id is uuid (20261105163501; prod
-- information_schema reads uuid for both columns), so every call that reached the views count failed with HTTP 400:
-- the item page's demand line and the whole Selling home. The PGlite proofs used a text device_id stand-in and missed it.
-- Both columns are uuid, so the count is now COALESCE(v.viewer_id, v.device_id): one uuid per person or device, the
-- same distinct count the functions meant. Bodies are restated verbatim from those migrations apart from the lines
-- marked CHANGED 20261120121830; signatures, SECURITY DEFINER, search_path, grants and comments are unchanged.
-- REPLAY-SAFE: CREATE OR REPLACE with unchanged signatures and return types; grants restated.
-- Proof: src/test/pglite/declutterViewsCoalesceUuid.pglite.mjs (the real table CREATE from 20261105163501, applied 3x).

CREATE OR REPLACE FUNCTION public.declutter_selling_home()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_week jsonb;
  v_last jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'sales', count(*) FILTER (WHERE o.paid_at > v_now - interval '7 days'),
           'earnings_cents', COALESCE(sum(o.items_cents - o.bundle_discount_cents) FILTER (WHERE o.paid_at > v_now - interval '7 days'), 0)),
         jsonb_build_object(
           'sales', count(*) FILTER (WHERE o.paid_at <= v_now - interval '7 days'),
           'earnings_cents', COALESCE(sum(o.items_cents - o.bundle_discount_cents) FILTER (WHERE o.paid_at <= v_now - interval '7 days'), 0))
    INTO v_week, v_last
    FROM public.declutter_orders o
   WHERE o.seller_id = v_uid
     AND o.status IN ('paid', 'handed_over')
     AND o.paid_at > v_now - interval '14 days';

  v_week := v_week || (
    SELECT jsonb_build_object(
             -- CHANGED 20261120121830: both columns are uuid (was viewer_id::text vs a uuid device_id, 42804).
             'views', count(DISTINCT (v.item_id, COALESCE(v.viewer_id, v.device_id))) FILTER (WHERE v.created_at > v_now - interval '7 days'))
      FROM public.declutter_item_views v
      JOIN public.declutter_items i ON i.id = v.item_id
     WHERE i.seller_id = v_uid
       AND v.created_at > v_now - interval '14 days');
  v_last := v_last || (
    SELECT jsonb_build_object(
             -- CHANGED 20261120121830: both columns are uuid (was viewer_id::text vs a uuid device_id, 42804).
             'views', count(DISTINCT (v.item_id, COALESCE(v.viewer_id, v.device_id))) FILTER (WHERE v.created_at <= v_now - interval '7 days'))
      FROM public.declutter_item_views v
      JOIN public.declutter_items i ON i.id = v.item_id
     WHERE i.seller_id = v_uid
       AND v.created_at > v_now - interval '14 days');

  v_week := v_week || (
    SELECT jsonb_build_object('saves', count(*) FILTER (WHERE w.created_at > v_now - interval '7 days'))
      FROM public.declutter_watchlist w
      JOIN public.declutter_items i ON i.id = w.item_id
     WHERE i.seller_id = v_uid AND w.user_id <> v_uid AND w.created_at > v_now - interval '14 days');
  v_last := v_last || (
    SELECT jsonb_build_object('saves', count(*) FILTER (WHERE w.created_at <= v_now - interval '7 days'))
      FROM public.declutter_watchlist w
      JOIN public.declutter_items i ON i.id = w.item_id
     WHERE i.seller_id = v_uid AND w.user_id <> v_uid AND w.created_at > v_now - interval '14 days');

  RETURN jsonb_build_object(
    'week', v_week,
    'last_week', v_last,
    'todo', jsonb_build_object(
      'to_relist', (SELECT count(*) FROM public.declutter_items i WHERE i.seller_id = v_uid AND i.status = 'paused'),
      'price_drops', (
        SELECT count(*)
          FROM public.declutter_items i
          JOIN public.declutter_item_private p ON p.item_id = i.id
         WHERE i.seller_id = v_uid
           AND i.status = 'live'
           AND i.current_price_cents > 0
           AND i.live_at IS NOT NULL
           AND i.live_at + interval '14 days' <= v_now
           AND NOT (i.sale_mode = 'offers' AND i.drop_pct > 0 AND NOT COALESCE(p.drops_stopped, false))),
      'savers_to_offer', (
        SELECT count(*)
          FROM public.declutter_items i
         WHERE i.seller_id = v_uid
           AND i.status = 'live'
           AND i.current_price_cents >= 200
           AND EXISTS (SELECT 1 FROM public.declutter_watchlist w WHERE w.item_id = i.id AND w.user_id <> v_uid)
           AND NOT EXISTS (SELECT 1 FROM public.declutter_saver_offer_sends s
                            WHERE s.item_id = i.id AND s.created_at > v_now - interval '24 hours'))),
    'live_count', (SELECT count(*) FROM public.declutter_items i WHERE i.seller_id = v_uid AND i.status = 'live'),
    'live_value_cents', (SELECT COALESCE(sum(i.current_price_cents), 0) FROM public.declutter_items i
                          WHERE i.seller_id = v_uid AND i.status = 'live'));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_selling_home() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_selling_home() TO authenticated, service_role;
COMMENT ON FUNCTION public.declutter_selling_home() IS
  'Declutter top 5 #2 (owner 11-19): the caller''s own Selling home: to-do counts and the last 7 days vs the 7 before.';

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
           (SELECT count(DISTINCT o.buyer_id)::integer FROM public.declutter_offers o
             WHERE o.item_id = i.id AND o.created_at > now() - interval '7 days'
               AND NOT EXISTS (SELECT 1 FROM public.profiles bp WHERE bp.user_id = o.buyer_id AND bp.is_seed)
               AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = o.buyer_id)),
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
