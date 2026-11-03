-- Q2390 packet 19 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for six owner actions with no edge function reach that still raised
-- P0002:
--   declutter_helpr_remove_listing_photo (Helpr removes a draft photo; raise before the DELETE)
--   shops_confirm_pickup                 (buyer confirms pickup; raise before shop_complete_handover)
--   declutter_set_item_seller_delivery   (seller turns delivery on/off; raise before the write)
--   shops_remove_item_photo              (2 raises: before the DELETE, and when the DELETE
--                                         returned no row; the raise rolls the call back)
--   shops_withdraw_item                  (raise before any write)
--   shops_close_my_shop                  (raise when the DELETE found no shop: nothing written)
-- No SQL function calls any of them, no edge function reaches them, and the
-- app maps their refusals by message (rpcErrorCopy, sellerDeliveryErrors), not
-- by SQLSTATE. None creates an order, moves money or calls pg_net itself.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   declutter_helpr_remove_listing_photo   20261101034159 835eb7ea221af75c48b8ee3e5bdc0a1c
--   shops_confirm_pickup                   20261018211820 48e985ddd09557d3f3f2a155438144e7
--   declutter_set_item_seller_delivery     20261027153244 6b514a59dbf33f283d6501f46a9d78ae
--   shops_remove_item_photo                20261017061157 4fd9ade3e4197b89e7d5d9281a39bf3d
--   shops_withdraw_item                    20261017061157 580c317469d3ddb3dd1e488ea8db7feb
--   shops_close_my_shop                    20261017061157 f493bf7ca571b85cf3e3dde4887aa7a2
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (7 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.declutter_helpr_remove_listing_photo(p_photo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_item uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT item_id INTO v_item FROM public.declutter_item_photos WHERE id = p_photo_id;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'PT404';
  END IF;
  PERFORM public.declutter_list_for_seller_draft(v_item);
  DELETE FROM public.declutter_item_photos WHERE id = p_photo_id AND item_id = v_item;
  UPDATE public.declutter_items SET updated_at = now() WHERE id = v_item;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_helpr_remove_listing_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_helpr_remove_listing_photo(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_confirm_pickup(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  RETURN public.shop_complete_handover(o.id, 'buyer');
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_confirm_pickup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_confirm_pickup(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_item_seller_delivery(p_item_id uuid, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_seller_delivery');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_item_id IS NULL OR p_on IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_on THEN
    DELETE FROM public.declutter_item_no_seller_delivery WHERE item_id = p_item_id;
  ELSE
    INSERT INTO public.declutter_item_no_seller_delivery (item_id, seller_id) VALUES (p_item_id, v_uid)
    ON CONFLICT (item_id) DO NOTHING;
  END IF;
  RETURN p_on;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_item_seller_delivery(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_item_seller_delivery(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_remove_item_photo(p_photo_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item_id uuid;
  v_item public.shop_items%ROWTYPE;
  v_path text;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT item_id INTO v_item_id FROM public.shop_item_photos WHERE id = p_photo_id AND owner_id = v_uid;
  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_item := public.shops_lock_own_item(v_item_id, v_uid);
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.shop_item_photos WHERE id = p_photo_id AND owner_id = v_uid
  RETURNING storage_path INTO v_path;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'PT404';
  END IF;
  UPDATE public.shop_items SET updated_at = now() WHERE id = v_item_id;
  RETURN v_path;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_remove_item_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_remove_item_photo(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_withdraw_item(p_item_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.shop_items%ROWTYPE;
  v_paths text[];
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM public.shop_items WHERE id = p_item_id AND owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status = 'withdrawn' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(storage_path ORDER BY position), ARRAY[]::text[]) INTO v_paths
    FROM public.shop_item_photos WHERE item_id = p_item_id;
  IF v_item.status = 'draft' THEN
    DELETE FROM public.shop_items WHERE id = p_item_id;
  ELSE
    DELETE FROM public.shop_item_photos WHERE item_id = p_item_id;
    UPDATE public.shop_items SET status = 'withdrawn', live_at = NULL, updated_at = now() WHERE id = p_item_id;
  END IF;
  RETURN v_paths;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_withdraw_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_withdraw_item(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_close_my_shop()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_paths text[];
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Review finding 1 (slice 1): a shop an admin hid cannot be closed and
  -- reopened clean (that would undo L75). Account deletion still cascades it away.
  IF EXISTS (SELECT 1 FROM public.shops WHERE owner_id = v_uid AND hidden_at IS NOT NULL) THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501',
      HINT = 'Louisiana Helpr hid this shop. Contact support.';
  END IF;
  SELECT COALESCE(array_agg(p), '{}') INTO v_paths FROM (
    SELECT ph.storage_path AS p FROM public.shop_photos ph WHERE ph.owner_id = v_uid
    UNION ALL
    SELECT ip.storage_path FROM public.shop_item_photos ip WHERE ip.owner_id = v_uid) x;
  DELETE FROM public.shops WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_paths;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_close_my_shop() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_close_my_shop() TO authenticated, service_role;

