-- Q2390 packet 21 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for four seller actions that still raised P0002:
--   declutter_free_still_available (seller says a free item is still there; raise before the upsert)
--   shops_set_hours                (shop owner saves hours; raise after the shop row lock, before the
--                                   DELETE/INSERT of shop_hours)
--   declutter_relist_listing       (paused listing back to live; raise before the UPDATE)
--   declutter_set_listing_drops    (price drops on/off; raise 1 before any write, raise 2 when the
--                                   private-row UPDATE found no row: the raise rolls it back)
-- declutter_set_listing_drops is also reached through declutter_manage
-- (manager mode, 20261101181005), whose EXCEPTION block re-raises with a bare
-- RAISE, so the SQLSTATE passes through unchanged and the call rolls back. No
-- edge function reaches any of them; the app maps their refusals by message
-- (rpcErrorCopy, lifecycleErrors). None creates an order, moves money or calls
-- pg_net itself.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   declutter_free_still_available         20261030232231 532705f447b808345abcc26719b10731
--   shops_set_hours                        20261017061155 73f2062dbd5d1b84119001c3d803b3d9
--   declutter_relist_listing               20261027163240 2b4ea527b825a22744df961c258bd7b2
--   declutter_set_listing_drops            20261031020705 1ef6eb8b1fe3772dd0556742a5096a89
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (5 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.declutter_free_still_available(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  -- Not the selling gate, as declutter_withdraw_item: a banned
  -- caller is refused, while an under-18 or struck member may still answer about their own listing.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status <> 'live' OR v_item.current_price_cents <> 0 THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.declutter_free_still_asks AS a (item_id, answered_at) VALUES (p_item_id, now())
    ON CONFLICT (item_id) DO UPDATE SET answered_at = now();
  RETURN 'still_available';
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_free_still_available(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_free_still_available(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_set_hours(p_hours jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_shop uuid;
  v_n integer;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT id INTO v_shop FROM public.shops WHERE owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'array' OR jsonb_array_length(p_hours) > 21 THEN
    RAISE EXCEPTION 'invalid_hours' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.shop_hours WHERE shop_id = v_shop;
  BEGIN
    INSERT INTO public.shop_hours (shop_id, weekday, opens_local, closes_local)
    SELECT v_shop, (e ->> 'weekday')::smallint, (e ->> 'opens')::time, (e ->> 'closes')::time
      FROM jsonb_array_elements(p_hours) e;
  EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation
             OR unique_violation OR invalid_datetime_format OR datetime_field_overflow
             OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_hours' USING ERRCODE = '22023',
      HINT = 'Each time needs a day, and an opening time before its closing time.';
  END;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.shops SET updated_at = now() WHERE id = v_shop;
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_set_hours(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_hours(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_relist_listing(p_item_id uuid)
 RETURNS text
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

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status <> 'paused' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  -- Publish's own checks (authz review 7): a pickup time on file. (No payout
  -- setup: owner 2026-10-27, list first, set up at first sale.)
  IF NOT EXISTS (SELECT 1 FROM public.declutter_pickup_windows w WHERE w.seller_id = v_uid) THEN
    RAISE EXCEPTION 'pickup_windows_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = p_item_id;
  RETURN 'live';
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_relist_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_relist_listing(uuid) TO authenticated, service_role;

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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
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

