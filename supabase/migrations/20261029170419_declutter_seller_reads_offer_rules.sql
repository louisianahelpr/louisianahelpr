-- Smart offers (d): the seller reads back their own "Accept offers automatically" switch (owner 2026-10-29;
-- builder 33, on top of 20261029162620_declutter_smart_offers). declutter_seller_item_private gains auto_offers.
--
-- A RETURNS TABLE shape cannot change with CREATE OR REPLACE, so the function is dropped and created again with
-- the same body as its NEWEST definition (20261015042253_declutter_slice4_handover_payout) plus the one column;
-- callers that read the four old columns are unchanged. Grants restated by role name.
--
-- Replay-safe: DROP FUNCTION IF EXISTS + CREATE; the column it reads is added by 20261029162620 (ADD COLUMN IF NOT
-- EXISTS), which sorts before this file.

DROP FUNCTION IF EXISTS public.declutter_seller_item_private(uuid);
CREATE FUNCTION public.declutter_seller_item_private(p_item_id uuid)
RETURNS TABLE(floor_price_cents integer, pickup_address text, pickup_lat numeric, pickup_lng numeric, auto_offers boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.declutter_in_agreed_sale(p_item_id, (SELECT auth.uid())) THEN
    PERFORM public.require_feature('declutter');
  END IF;
  RETURN QUERY
    SELECT p.floor_price_cents, p.pickup_address, p.pickup_lat, p.pickup_lng, p.auto_offers
      FROM public.declutter_item_private p
     WHERE p.item_id = p_item_id
       AND p.seller_id = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_item_private(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_item_private(uuid) TO authenticated, service_role;
