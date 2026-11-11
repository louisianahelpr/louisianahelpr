-- A shop owner's own page said "We couldn't load the reviews. This shop isn't available." with a Try again button
-- whenever their shop was not public yet (Builder 1 Shops pass, 2026-11-10, prod, helper-e2e on its own shop
-- bde3a7ed: shops_get_shop answered 200 with mine=true, and shops_shop_reviews answered 404 shop_not_found).
--
-- Cause: shops_shop_reviews (20261105230819) let a caller through only when shop_state_ok(shop) was true, while
-- shops_get_shop and shops_browse let the owner through as well (shop_visible_to: the owner, or a shop anyone may
-- see). The owner was allowed to open the page and then refused one of its sections.
--
-- Fix: the same door as the page. shops_shop_reviews now asks shop_visible_to(shop, caller), which for anyone but
-- the owner is exactly what it asked before (shop_publicly_visible = the 'shops' switch for the caller AND
-- shop_state_ok; require_feature already refused a caller without the switch). The owner reads their own shop's
-- reviews; which reviews show is unchanged (buyer side, shop_review_public), so the owner sees only what the public
-- would. No other change to the body, the grants or the return shape.
--
-- REPLAY-SAFETY: CREATE OR REPLACE over a function 20261105230819 defines; shop_visible_to is from 20261017061155.
-- Proof: src/test/pglite/shopsReviewsOwnerSeesOwn.pglite.mjs (applied 3x).

CREATE OR REPLACE FUNCTION public.shops_shop_reviews(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rating numeric;
  v_count integer;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.shop_visible_to(p_shop_id, v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT rr.rating, rr.review_count INTO v_rating, v_count FROM public.shop_review_rating(p_shop_id) rr;
  RETURN jsonb_build_object(
    'rating', v_rating,
    'review_count', COALESCE(v_count, 0),
    'reviews', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'stars', x.stars, 'comment', x.comment, 'created_at', x.created_at)
                       ORDER BY x.created_at DESC, x.id)
        FROM (SELECT r.id, r.stars, r.comment, r.created_at FROM public.shop_reviews r
               WHERE r.shop_id = p_shop_id AND r.reviewer_side = 'buyer' AND public.shop_review_public(r.id)
               ORDER BY r.created_at DESC, r.id LIMIT 100) x), '[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_shop_reviews(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_shop_reviews(uuid) TO authenticated, service_role;
