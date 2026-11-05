-- Shops caps (audit ~/.lh-shots/audit-1105-shops.md M15 + OWNER ANSWERS 11-05 #5):
--
-- 1. The home-food yearly limit follows the law: $100,000. La. R.S. 40:4.9(B) as amended by Act 801 of the 2026
--    Regular Session (HB 403): "This Section does not apply to any preparer of low-risk foods made at a home for sale,
--    whose gross annual sales equal one hundred thousand dollars or more." (enrolled act,
--    https://www.legis.la.gov/Legis/ViewDocument.aspx?d=1481239, read 2026-11-05). Résumé digest: "New law increases the
--    gross annual sales limit for this exemption from $30,000 to $100,000 ... Effective August 1, 2026."
--    (https://legis.la.gov/legis/ViewDocument.aspx?d=1484775, read 2026-11-05). Only the row still at the old $30,000
--    moves, so a value set by hand is never overwritten. The 80% warning stays.
-- 2. The item price cap rises from $1,000 to $5,000 (owner 11-05, "RAISE the item price cap (to $5,000) for
--    catering/big orders"): the shop_items and shop_order_lines CHECKs (names read on prod 2026-11-05) and
--    shops_check_item_fields, restated from its newest CREATE (20261017061157_shops_items.sql; only the price line).
-- Replay-safe: UPDATE ... WHERE the old value, DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsCaps.pglite.mjs. Guard: src/test/shopsCaps.test.ts.

UPDATE public.shop_cottage_settings
   SET cap_cents = 10000000,
       note = 'La. R.S. 40:4.9(B) as amended by Act 801 of 2026 (HB 403): $100,000 of home-made sales a year, effective August 1, 2026 (enrolled act and resume digest on legis.la.gov, read 2026-11-05).',
       updated_at = now()
 WHERE id AND cap_cents = 3000000;

ALTER TABLE public.shop_items DROP CONSTRAINT IF EXISTS shop_items_price_cents_check;
ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_price_cents_check CHECK (price_cents BETWEEN 100 AND 500000);
ALTER TABLE public.shop_order_lines DROP CONSTRAINT IF EXISTS shop_order_lines_unit_cents_check;
ALTER TABLE public.shop_order_lines ADD CONSTRAINT shop_order_lines_unit_cents_check CHECK (unit_cents BETWEEN 100 AND 500000);

CREATE OR REPLACE FUNCTION public.shops_check_item_fields(
  p_kind text, p_subtype text, p_title text, p_description text, p_price_cents integer,
  p_lead_time_days integer, p_stock_count integer)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_kind = 'rental' THEN
    -- Reserved for the rentals slice (S5, the Shops rentals item in docs/OPEN.md).
    RAISE EXCEPTION 'rental_not_available' USING ERRCODE = '22023',
      HINT = 'Renting things out is coming later.';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('made', 'home_food', 'farm') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF p_subtype IS NULL OR NOT EXISTS (SELECT 1 FROM public.shop_item_subtypes s WHERE s.slug = p_subtype AND s.kind = p_kind) THEN
    RAISE EXCEPTION 'invalid_subtype' USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 3 AND 80 THEN
    RAISE EXCEPTION 'invalid_title' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(p_description, '')) > 2000 THEN
    RAISE EXCEPTION 'description_too_long' USING ERRCODE = '22023';
  END IF;
  -- Owner 11-05 (answer 5): up to $5,000 an item, for catering and big orders.
  IF p_price_cents IS NULL OR p_price_cents NOT BETWEEN 100 AND 500000 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023', HINT = 'Set a price from $1 to $5,000.';
  END IF;
  IF p_lead_time_days IS NULL OR p_lead_time_days NOT BETWEEN 0 AND 60 THEN
    RAISE EXCEPTION 'invalid_lead_time' USING ERRCODE = '22023';
  END IF;
  IF p_stock_count IS NOT NULL AND p_stock_count NOT BETWEEN 0 AND 9999 THEN
    RAISE EXCEPTION 'invalid_stock' USING ERRCODE = '22023';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_check_item_fields(text, text, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_check_item_fields(text, text, text, text, integer, integer, integer) TO service_role;
