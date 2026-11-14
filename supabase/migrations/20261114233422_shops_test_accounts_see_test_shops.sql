-- Shops: an enrolled TEST ACCOUNT sees a test (is_seed) shop while the launch
-- switch hides seed data from everyone else, the same way jobs already work
-- (seed_hidden_for, 20261007033530 / 20261101160649). Owner-approved test shop
-- for the live Stripe-TEST order and the Q1957 hide/unhide smoke (lead
-- 2026-11-14, owner "set up the test shop in stripe test").
--
-- WHY: shop_state_ok (20261019042744) hides an is_seed shop whenever
-- seed_jobs_hidden_publicly() is true, for EVERY viewer, and
-- shops_save_my_shop + shop_rows_seed_from_owner make every shop a test account
-- opens is_seed. So a test shop was visible to its owner only:
-- shops_order_terms / shops_request_order answered shop_not_found to the test
-- buyer, and no Stripe-TEST Shops order could ever be placed on prod.
--
-- WHAT CHANGES: shop_visible_to(shop, viewer) gains ONE branch. Besides "the
-- viewer owns it" and "it is publicly visible", a shop is visible to a viewer
-- for whom seed_hidden_for(viewer) is false (an enrolled test account:
-- profiles.is_seed AND public.test_accounts, and not a store review account)
-- when every OTHER part of the public rule still holds:
--   * the 'shops' switch is on for that viewer (feature_enabled_for_user),
--   * an admin has not hidden the shop (hidden_at IS NULL; Q1957 hide still hides),
--   * the owner is in good standing (not banned, under 3 Shops strikes).
-- Only the seed clause of shop_state_ok is skipped, and only for a viewer the
-- launch switch does not hide seed rows from. A real member, a store review
-- account, a seed account with no enrolment and a NULL viewer see exactly what
-- they saw before. With the launch switch off, seed_hidden_for is false for
-- everyone and shop_state_ok already shows seed shops, so nothing changes then.
--
-- NOT CHANGED: shop_state_ok, shop_publicly_visible and shop_link_visible (the
-- signed-out link page, the shop-photo edge function, the shops/shop_items
-- REST policies) keep hiding test shops from every viewer; seed_jobs_hidden_publicly
-- is untouched. Grants are unchanged (CREATE OR REPLACE keeps the ACL; restated
-- below): shop_visible_to stays service_role only, called inside the definer RPCs.
--
-- REPLAY-SAFE: CREATE OR REPLACE; every function it reads exists from earlier
-- migrations (20261017061155, 20261019042744, 20261101160649, 20261101154236,
-- 20261018164444).
CREATE OR REPLACE FUNCTION public.shop_visible_to(p_shop_id uuid, p_viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT s.owner_id = p_viewer
        OR public.shop_publicly_visible(s.id)
        OR (p_viewer IS NOT NULL
            AND NOT public.seed_hidden_for(p_viewer)
            AND public.feature_enabled_for_user('shops', p_viewer)
            AND s.hidden_at IS NULL
            AND public.shop_owner_in_good_standing(s.owner_id))
      FROM public.shops s WHERE s.id = p_shop_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.shop_visible_to(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_visible_to(uuid, uuid) TO service_role;
