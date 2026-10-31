-- LEAD-POST-SLOW (a), owner 2026-10-31: "nothing slow for users, under 2 s". A new listing's photos start uploading
-- the moment they are added, not on Post. A photo's object must sit in the seller's folder for THAT item
-- (<seller>/declutter/<item_id>/..., declutter_add_item_photo), and a new listing has no item until Post, so the
-- app picks the new item's id itself when the first photo is added, uploads into that folder at once, and Post
-- makes the item with that id (declutter_create_item_with_id), then only attaches the photos already there.
--
-- declutter_create_item_with_id is declutter_create_item (newest CREATE: 20261027170717, every listing rule) with
-- the id given. The id is only ever a NEW row's: an id already used (by anyone) is refused ('item_id_taken'), never
-- reused, so it can't reach another seller's listing. It acts for auth.uid() only. declutter_create_item keeps its
-- signature and rules and now makes its item through the new function with a fresh id, so the two can't drift.
-- Replay-safe: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.declutter_create_item_with_id(
  p_item_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_condition_stars integer,
  p_delivery_size text,
  p_price_cents integer,
  p_floor_price_cents integer,
  p_area_label text,
  p_pickup_address text,
  p_pickup_lat numeric,
  p_pickup_lng numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'item_id_taken' USING ERRCODE = '22023';
  END IF;
  -- Free (20261027170717, owner 2026-10-27): price 0 and a 0 floor (no drops, offers or hint).
  IF p_price_cents = 0 THEN
    IF COALESCE(p_floor_price_cents, 0) <> 0 THEN
      RAISE EXCEPTION 'invalid_floor_price' USING ERRCODE = '22023', HINT = 'A free item has no lowest price.';
    END IF;
    p_floor_price_cents := 0;
  ELSIF p_price_cents IS NULL OR p_floor_price_cents IS NULL
     OR p_floor_price_cents < 100 OR p_floor_price_cents > p_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price'
      USING ERRCODE = '22023', HINT = 'The lowest price must be at least $1 and no more than the price.';
  END IF;
  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL THEN
    RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
  END IF;
  IF public.declutter_area_label_problem(p_area_label, p_pickup_address) IS NOT NULL THEN
    RAISE EXCEPTION 'area_looks_like_address'
      USING ERRCODE = '22023', HINT = 'Use your neighborhood or town, not a street address.';
  END IF;

  BEGIN
    INSERT INTO public.declutter_items (
      id, seller_id, sale_mode, status, title, description, category, condition_stars,
      delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng)
    VALUES (
      p_item_id, v_uid, 'offers', 'draft', btrim(p_title), COALESCE(btrim(p_description), ''), p_category,
      p_condition_stars, p_delivery_size, p_price_cents, p_price_cents, btrim(p_area_label),
      round(p_pickup_lat, 2), round(p_pickup_lng, 2))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'item_id_taken' USING ERRCODE = '22023';
  END;

  INSERT INTO public.declutter_item_private (item_id, seller_id, floor_price_cents, pickup_address, pickup_lat, pickup_lng)
  VALUES (v_id, v_uid, p_floor_price_cents, btrim(p_pickup_address), p_pickup_lat, p_pickup_lng);

  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_create_item_with_id(uuid, text, text, text, integer, text, integer, integer, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_create_item_with_id(uuid, text, text, text, integer, text, integer, integer, text, text, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_create_item(
  p_title text,
  p_description text,
  p_category text,
  p_condition_stars integer,
  p_delivery_size text,
  p_price_cents integer,
  p_floor_price_cents integer,
  p_area_label text,
  p_pickup_address text,
  p_pickup_lat numeric,
  p_pickup_lng numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());
  -- The gates above are restated here so this client-callable RPC names them in its own body (the Q281 class check
  -- and the live Q1284 rule read the RPC's body, not a helper's). Every rule (price, place, and the same gates
  -- again) is checked in declutter_create_item_with_id, for auth.uid().
  RETURN public.declutter_create_item_with_id(
    gen_random_uuid(), p_title, p_description, p_category, p_condition_stars, p_delivery_size,
    p_price_cents, p_floor_price_cents, p_area_label, p_pickup_address, p_pickup_lat, p_pickup_lng);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_create_item(text, text, text, integer, text, integer, integer, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_create_item(text, text, text, integer, text, integer, integer, text, text, numeric, numeric) TO authenticated, service_role;
