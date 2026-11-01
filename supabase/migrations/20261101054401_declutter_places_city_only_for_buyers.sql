-- Declutter pickup places: buyers see the CITY only, never the place's label (owner 2026-10-31 11:42 PM,
-- OWNER-DECISIONS "Declutter item page layout": "Pickup places show the CITY only, never the place's label (not
-- 'Home · New Iberia', just 'New Iberia')").
--
-- WHAT WAS WRONG: the item page hid the label in the browser only (PickupPlacesHoursList cityOnly,
-- LEAD-ITEM-PAGE-LAYOUT); the server still RETURNED it to every buyer, so anyone reading the API saw "Home",
-- "Mom's house", etc. Three reads hand a place to someone other than its seller:
--   1. declutter_item_pickup_places (item page; newest 20261031145652),
--   2. declutter_seller_porch_places (the buyer's place picker in the cart; newest 20261031145652),
--   3. declutter_order_place (the order's frozen place; newest 20261031004529).
-- Each now returns label = NULL unless the caller is the seller (the seller still sees their own labels). Same
-- signatures and columns, so older app builds keep working (they show the city instead). Nothing else changes:
-- the address still opens only after payment (declutter_order_place / declutter_item_address, unchanged).
--
-- Every other buyer-facing read was checked and never names a place label: browse cards, search, share cards
-- (api/share.ts) and /u profile listings read declutter_items.area_label (the listing's town); guests never reach
-- these three (none is granted to anon). declutter_my_porch_places is the seller's own list.
--
-- RESTATED VERBATIM from the newest CREATE on origin/main except the one label column in each. REPLAY-SAFE:
-- CREATE OR REPLACE with unchanged signatures; grants restated. Proof:
-- src/test/pglite/declutterPlacesCityOnly.pglite.mjs (applied 3x; --before red).

-- 1. The item page.
CREATE OR REPLACE FUNCTION public.declutter_item_pickup_places(p_item_id uuid)
RETURNS TABLE (label text, area text, weekdays smallint[], windows jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_seller uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT i.seller_id INTO v_seller FROM public.declutter_items i
   WHERE i.id = p_item_id
     AND ((i.status IN ('live', 'reserved') AND NOT i.seller_hidden) OR i.seller_id = v_uid);
  IF v_seller IS NULL OR (v_seller <> v_uid AND public.are_users_blocked(v_seller, v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- An out seller's places are never shown to anyone else (as declutter_seller_porch_places).
  IF v_seller <> v_uid AND public.declutter_seller_out(v_seller) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT CASE WHEN v_seller = v_uid THEN pl.label END, pl.area, pl.weekdays,
           coalesce(pl.windows, public.declutter_place_windows_fill(NULL, pl.seller_id, pl.weekdays))
      FROM public.declutter_porch_places pl
     WHERE pl.seller_id = v_seller
     ORDER BY pl.position;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_pickup_places(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_item_pickup_places(uuid) TO authenticated, service_role;

-- 2. The buyer's place picker.
CREATE OR REPLACE FUNCTION public.declutter_seller_porch_places(p_seller_id uuid)
RETURNS TABLE (id uuid, label text, area text, weekdays smallint[], chosen boolean, windows jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := public.declutter_assert_member(false);
  IF p_seller_id IS NULL OR cardinality(public.declutter_my_cart_lines(v_uid, p_seller_id)) = 0
     OR public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT pl.id, CASE WHEN pl.seller_id = v_uid THEN pl.label END, pl.area, pl.weekdays,
           EXISTS (SELECT 1 FROM public.declutter_porch_place_choices ch
                    WHERE ch.buyer_id = v_uid AND ch.seller_id = p_seller_id AND ch.place_id = pl.id),
           coalesce(pl.windows, public.declutter_place_windows_fill(NULL, pl.seller_id, pl.weekdays))
      FROM public.declutter_porch_places pl
     WHERE pl.seller_id = p_seller_id
     ORDER BY pl.position;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_porch_places(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_porch_places(uuid) TO authenticated, service_role;

-- 3. The order's frozen place: the seller sees the label, the buyer the city.
CREATE OR REPLACE FUNCTION public.declutter_order_place(p_order_id uuid)
 RETURNS TABLE(label text, area text, address text, lat numeric, lng numeric, weekdays smallint[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_open boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF o.id IS NULL OR v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- CHANGED (lead 10-30): closed on a held sale, for the buyer.
  v_open := v_side = 'seller' OR o.status IN ('paid', 'handed_over');
  v_open := v_open AND (v_side = 'seller' OR NOT public.declutter_held_address_closed(o.id));
  RETURN QUERY
    SELECT CASE WHEN v_side = 'seller' THEN pp.label END, pp.area,
           CASE WHEN v_open THEN pp.address END,
           CASE WHEN v_open THEN pp.lat::numeric END,
           CASE WHEN v_open THEN pp.lng::numeric END,
           pp.weekdays
      FROM public.declutter_order_porch_places pp
     WHERE pp.order_id = o.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_order_place(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_place(uuid) TO authenticated, service_role;
