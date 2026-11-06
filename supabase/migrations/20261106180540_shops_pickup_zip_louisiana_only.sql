-- Shops: the pickup address takes Louisiana ZIP codes only (money; lh-money-escrow
-- 11-06 on ready/b4-shops-h8-at-buyer found the same loose rule in the service address).
--
-- What was broken: shop_pickup_addresses.postal_code and shops_save_my_pickup_address
-- (20261018210400, restated 20261103052255) accepted '^7[01][0-9]{3}$'. That lets in
-- 71500-71999 (Arkansas: 715-719, e.g. 71601 Pine Bluff) and the unassigned 702xx and
-- 709xx ranges. A pickup sale is taxed where the buyer takes it (tax memo Q3), so an
-- Arkansas pickup address would have been taxed as Louisiana.
--
-- The fix: the same rule as src/lib/shipping/policy.ts isLouisianaZip, the
-- shipments.ship_to CHECK and supabase/functions/_shared/easypostRates.ts LA_ZIP:
-- USPS areas 700-701, 703-708, 710-714, i.e. '^(70[013-8]|71[0-4])[0-9]{2}$'.
-- The CHECK is swapped (prod held 0 rows on 2026-11-06, measured, so the new CHECK
-- cannot fail there) and the save RPC is restated from its newest body
-- (20261103052255) with only the ZIP test changed.
--
-- REPLAY-SAFETY: DROP CONSTRAINT IF EXISTS + ADD; CREATE OR REPLACE.

ALTER TABLE public.shop_pickup_addresses DROP CONSTRAINT IF EXISTS shop_pickup_addresses_postal_code_check;
ALTER TABLE public.shop_pickup_addresses DROP CONSTRAINT IF EXISTS shop_pickup_addresses_postal_code_louisiana;
ALTER TABLE public.shop_pickup_addresses
  ADD CONSTRAINT shop_pickup_addresses_postal_code_louisiana CHECK (postal_code ~ '^(70[013-8]|71[0-4])[0-9]{2}$');

CREATE OR REPLACE FUNCTION public.shops_save_my_pickup_address(
  p_line1 text, p_line2 text, p_city text, p_postal_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid;
  v_shop uuid;
BEGIN
  -- The same gates as M1's shops_set_cancel_policy: the switch, not banned,
  -- an eligible shop owner (shops_assert_owner_eligible raises its own codes).
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT s.id INTO v_shop FROM public.shops s WHERE s.owner_id = v_uid;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 3 AND 120
     OR (p_line2 IS NOT NULL AND btrim(p_line2) <> '' AND char_length(btrim(p_line2)) > 120)
     OR p_city IS NULL OR char_length(btrim(p_city)) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'invalid_pickup_address' USING ERRCODE = '22023';
  END IF;
  -- Louisiana only: USPS areas 700-701, 703-708, 710-714 (702 and 709 are unassigned,
  -- 715-719 are Arkansas).
  IF p_postal_code IS NULL OR btrim(p_postal_code) !~ '^(70[013-8]|71[0-4])[0-9]{2}$' THEN
    RAISE EXCEPTION 'pickup_address_not_in_louisiana' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shop_pickup_addresses (shop_id, owner_id, line1, line2, city, postal_code)
  VALUES (v_shop, v_uid, btrim(p_line1), NULLIF(btrim(coalesce(p_line2, '')), ''), btrim(p_city), btrim(p_postal_code))
  ON CONFLICT (shop_id) DO UPDATE
    SET line1 = EXCLUDED.line1, line2 = EXCLUDED.line2, city = EXCLUDED.city, postal_code = EXCLUDED.postal_code;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_save_my_pickup_address(p_line1 text, p_line2 text, p_city text, p_postal_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_save_my_pickup_address(p_line1 text, p_line2 text, p_city text, p_postal_code text) TO authenticated, service_role;
