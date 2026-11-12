-- S045 (Shops audit 11-12, Low): a custom order request the shop never answers stayed 'requested' forever (even past
-- the buyer's wanted date) and kept one of the buyer's 3 open asks at that shop; a quote past its 7 days lapsed
-- silently (only stored as 'expired' when someone next opened the list, and nobody was told).
--
--   1. A new closed status 'lapsed' = the shop never answered. Status CHECK and quote_shape restated from
--      20261106202917 with 'lapsed' beside 'declined' / 'withdrawn' (no quote fields required).
--   2. shop_custom_request_sweep() (service_role; called by declutter-money every 10 minutes, as shop_preorder_sweep):
--      - 'requested' past its wanted date (Louisiana day) or 7 days after it was sent -> 'lapsed', closed_at now();
--        the buyer is told "the shop didn't answer in time; you can ask again" and the shop "it ended". The 3-per-shop
--        count (shops_send_custom_request: status IN ('requested','quoted')) no longer holds it.
--      - 'quoted' at or past expires_at -> 'expired', closed_at = expires_at (as shops_my_custom_requests stores it);
--        the buyer is told the price ended.
--      No notice across a block (as shops_decline_custom_request); the other side is passed to declutter_notify so its
--      seed guard keeps test data from a real member (lh-authz-rls notes).
--      Each row is closed once (the UPDATE ... RETURNING picks only rows still open), so a rerun never re-notifies.
-- No money moves (a request or a quote holds no card). AUTHZ: one service_role function (lh-authz-rls). REPLAY-SAFE:
-- constraints dropped and re-added in a DO block, CREATE OR REPLACE, grants restated.
-- Proof: src/test/pglite/shopsCustomRequestLapse.pglite.mjs (3x; NEW_MIGRATION=skip red).

DO $do$
BEGIN
  ALTER TABLE public.shop_custom_requests DROP CONSTRAINT IF EXISTS shop_custom_requests_status_check;
  ALTER TABLE public.shop_custom_requests ADD CONSTRAINT shop_custom_requests_status_check
    CHECK (status IN ('requested', 'quoted', 'declined', 'withdrawn', 'expired', 'accepted', 'lapsed'));
  ALTER TABLE public.shop_custom_requests DROP CONSTRAINT IF EXISTS shop_custom_requests_quote_shape;
  ALTER TABLE public.shop_custom_requests ADD CONSTRAINT shop_custom_requests_quote_shape CHECK (
    (status = 'requested' AND quote_cents IS NULL AND quoted_at IS NULL AND expires_at IS NULL)
    OR (status IN ('quoted', 'expired', 'accepted') AND quote_cents IS NOT NULL AND quoted_at IS NOT NULL
        AND expires_at = quoted_at + interval '7 days')
    OR status IN ('declined', 'withdrawn', 'lapsed'));
END
$do$;

CREATE OR REPLACE FUNCTION public.shop_custom_request_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  s public.shops;
  v_lapsed integer := 0;
  v_expired integer := 0;
BEGIN
  FOR r IN
    UPDATE public.shop_custom_requests c
       SET status = 'lapsed', closed_at = now(), updated_at = now()
     WHERE c.status = 'requested'
       AND (c.created_at <= now() - interval '7 days'
            OR (c.wanted_date IS NOT NULL AND c.wanted_date < public.shop_local_today()))
    RETURNING c.id, c.buyer_id, c.shop_id
  LOOP
    v_lapsed := v_lapsed + 1;
    SELECT * INTO s FROM public.shops WHERE id = r.shop_id;
    -- As shops_decline_custom_request (20261106212437): no notice across a block. The other side is passed, so
    -- declutter_notify's seed guard keeps test data from reaching a real member.
    CONTINUE WHEN s.id IS NULL OR public.are_users_blocked(r.buyer_id, s.owner_id);
    PERFORM public.declutter_notify(r.buyer_id, 'info', 'Custom order request ended',
      format('%s didn''t answer your custom order request in time, so it ended. You can send a new one.', s.name),
      '/shops/orders', s.owner_id);
    PERFORM public.declutter_notify(s.owner_id, 'info', 'Custom order request ended',
      'A buyer''s custom order request ended because it wasn''t answered in time. There is nothing to do.',
      '/shops/dashboard', r.buyer_id);
  END LOOP;
  FOR r IN
    UPDATE public.shop_custom_requests c
       SET status = 'expired', closed_at = c.expires_at, updated_at = now()
     WHERE c.status = 'quoted' AND c.expires_at <= now()
    RETURNING c.id, c.buyer_id, c.shop_id
  LOOP
    v_expired := v_expired + 1;
    SELECT * INTO s FROM public.shops WHERE id = r.shop_id;
    CONTINUE WHEN s.id IS NULL OR public.are_users_blocked(r.buyer_id, s.owner_id);
    PERFORM public.declutter_notify(r.buyer_id, 'info', 'Custom order price ended',
      format('The price from %s for your custom order ended after 7 days. You can ask the shop again.', s.name),
      '/shops/orders', s.owner_id);
  END LOOP;
  RETURN jsonb_build_object('lapsed', v_lapsed, 'expired', v_expired);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_custom_request_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_custom_request_sweep() TO service_role;
