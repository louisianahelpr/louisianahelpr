-- "Sell it for me", option B (owner order 2026-10-19 ~21Z): a Shops category
-- for businesses that sell things for people: consignment, estate sales and
-- cleanouts. It sits in "Home services", after Window washing.
--
-- A plain upsert of ONE row, never a restatement of the whole list, so it
-- cannot remove anything another lane added. NOTE for any later migration
-- that restates the whole list and deletes unlisted slugs (the v2 pattern,
-- e.g. a categories lane): it must list 'declutter_estate_sales' too, or it
-- deletes this category and moves its shops to 'other'.
--
-- REPLAY-SAFE: the upsert sets the same values again. Guarded to a no-op on a
-- database without the table (it comes from 20261017061155_shops_profiles).
DO $do$
BEGIN
  IF to_regclass('public.shop_categories') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.shop_categories (slug, group_slug, group_label, label, position) VALUES
    ('declutter_estate_sales', 'home_services', 'Home services', 'Declutter and estate sale services', 211)
  ON CONFLICT (slug) DO UPDATE
    SET group_slug = EXCLUDED.group_slug, group_label = EXCLUDED.group_label,
        label = EXCLUDED.label, position = EXCLUDED.position;
END
$do$;
