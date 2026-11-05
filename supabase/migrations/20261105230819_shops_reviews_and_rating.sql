-- Shops H9 (audit ~/.lh-shots/audit-1105-shops.md, 2026-11-05; spec L46, L69, L70; also NOT-LAUNCHED Q2207): shop
-- reviews and a shop rating. Shops stays behind its switch (testers).
-- Before: there was no shop review table. shop_owner_rating read the owner's PERSON rating (jobs + Declutter,
-- get_public_profile_stats), so a new shop borrowed its owner's job rating, browse sorted by a number that wasn't about
-- the shop, and the public page showed no rating at all (Q2207: a person's exact rating can name the person behind a
-- home shop).
--
-- What this adds (the declutter_reviews shape, 20261015042253 / 20261021023530, keyed by a shop order):
--   1. shop_reviews: one per order and side ('buyer' reviews the shop, 'shop' reviews the buyer), 1-5 stars, an
--      optional comment (the contact-leak filter, 1,000 characters). RLS on, no member grant: the RPCs are the way in.
--   2. shops_leave_review(order, stars, comment): either side of a handed-over order (handed_over_at set), once.
--   3. shop_review_public(review): the one blind rule every reader shares: not removed, and the order was handed over
--      14+ days ago or both sides have reviewed; a test review stays out while test data is hidden.
--   4. shop_review_rating(shop): the SHOP's rating from its buyers' public reviews only. The average is returned only
--      at 3 or more reviews (audit H9); below that it is NULL and the count is given.
--   5. shop_owner_rating(owner) RESTATED (from 20261017061155): now the owner's shop's shop_review_rating, never the
--      person rating. shops_get_shop and shops_browse read it unchanged, so the full page, the browse card and the
--      "nearest first, then rating" sort (L69) now use the shop's own rating.
--   6. shops_public_shop RESTATED (from 20261019042744, verbatim plus 'rating' and 'review_count'): the shop-level
--      rating only, at 3 or more reviews, so it is never the owner's person rating (Q2207).
--   7. shops_shop_reviews(shop): members read a shop's public buyer reviews (stars, comment, date; no person ids).
--   8. shops_my_order_review(order): the caller's side of one order: may they review, and their own review if any.
-- Reviews are never hidden for being negative (16 CFR 465.7, spec L70): removed_at is set only by the same report
-- rules as every review.
-- NOT HERE: shop reviews in the owner's PERSON rating (get_public_profile_stats; L46 "one reputation per person")
-- and a report type for a shop review; each is its own slice (NOT-LAUNCHED H9 note).
-- MONEY: none. AUTHZ: one table, four member RPCs, one anon read (lh-authz-rls).
-- REPLAY-SAFE: CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsReviews.pglite.mjs (3x, Supabase's default anon grant emulated).

-- 1. The reviews.
CREATE TABLE IF NOT EXISTS public.shop_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewee_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewer_side text NOT NULL CHECK (reviewer_side IN ('buyer', 'shop')),
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  is_seed boolean NOT NULL DEFAULT false,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_reviews_once UNIQUE (order_id, reviewer_side)
);
CREATE INDEX IF NOT EXISTS shop_reviews_shop_idx ON public.shop_reviews (shop_id, reviewer_side);
CREATE INDEX IF NOT EXISTS shop_reviews_reviewee_idx ON public.shop_reviews (reviewee_id);
CREATE INDEX IF NOT EXISTS shop_reviews_reviewer_idx ON public.shop_reviews (reviewer_id);
ALTER TABLE public.shop_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_reviews TO service_role;

-- Q807: writes from an unconfirmed email are refused on every public table (the gate's own statement trigger).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- 3. The blind rule, for every reader (no caller in it: the reviewer's own copy is read by shops_my_order_review).
CREATE OR REPLACE FUNCTION public.shop_review_public(p_review_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT r.removed_at IS NULL
       AND (o.handed_over_at <= now() - interval '14 days'
            OR (SELECT count(*) FROM public.shop_reviews r2 WHERE r2.order_id = r.order_id) = 2)
       AND NOT (r.is_seed AND public.seed_jobs_hidden_publicly())
      FROM public.shop_reviews r JOIN public.shop_orders o ON o.id = r.order_id
     WHERE r.id = p_review_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.shop_review_public(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_review_public(uuid) TO service_role;

-- 4. The shop's rating: its buyers' public reviews; the average only at 3 or more.
CREATE OR REPLACE FUNCTION public.shop_review_rating(p_shop_id uuid)
RETURNS TABLE (rating numeric, review_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN count(*) >= 3 THEN round(avg(r.stars)::numeric, 1) END, count(*)::integer
    FROM public.shop_reviews r
   WHERE r.shop_id = p_shop_id AND r.reviewer_side = 'buyer' AND public.shop_review_public(r.id);
$fn$;
REVOKE ALL ON FUNCTION public.shop_review_rating(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_review_rating(uuid) TO service_role;

-- 5. RESTATED from 20261017061155: the owner's shop's own rating, never the person rating.
CREATE OR REPLACE FUNCTION public.shop_owner_rating(p_owner_id uuid)
RETURNS TABLE (rating numeric, review_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- CHANGED (Shops H9): was get_public_profile_stats(owner) (the person's job + Declutter rating). One shop per owner
  -- (shops.owner_id UNIQUE); no shop reads as no rating.
  SELECT rr.rating, COALESCE(rr.review_count, 0)
    FROM public.shops s
    CROSS JOIN LATERAL public.shop_review_rating(s.id) rr
   WHERE s.owner_id = p_owner_id;
$fn$;
REVOKE ALL ON FUNCTION public.shop_owner_rating(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owner_rating(uuid) TO service_role;

-- 2. Leave a review: either side of a handed-over order, once.
CREATE OR REPLACE FUNCTION public.shops_leave_review(p_order_id uuid, p_stars integer, p_comment text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders%ROWTYPE;
  v_owner uuid;
  v_side text;
  v_comment text := NULLIF(btrim(COALESCE(p_comment, '')), '');
  v_id uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF FOUND THEN
    SELECT owner_id INTO v_owner FROM public.shops WHERE id = o.shop_id;
  END IF;
  v_side := CASE WHEN o.id IS NULL OR v_owner IS NULL THEN NULL
                 WHEN o.buyer_id = v_uid THEN 'buyer'
                 WHEN v_owner = v_uid THEN 'shop' END;
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.handed_over_at IS NULL THEN
    RAISE EXCEPTION 'not_handed_over' USING ERRCODE = '55000', HINT = 'Reviews open after the handover.';
  END IF;
  IF p_stars IS NULL OR p_stars NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid_stars' USING ERRCODE = '22023';
  END IF;
  IF v_comment IS NOT NULL AND char_length(v_comment) > 1000 THEN
    RAISE EXCEPTION 'comment_too_long' USING ERRCODE = '22023';
  END IF;
  IF v_comment IS NOT NULL AND public.contact_leak_reason(v_comment) IS NOT NULL THEN
    RAISE EXCEPTION 'review_contact_info' USING ERRCODE = '23514',
      HINT = 'Reviews cannot include phone numbers, emails or links.';
  END IF;
  INSERT INTO public.shop_reviews (order_id, shop_id, reviewer_id, reviewee_id, reviewer_side, stars, comment, is_seed)
  VALUES (o.id, o.shop_id, v_uid, CASE WHEN v_side = 'buyer' THEN v_owner ELSE o.buyer_id END, v_side, p_stars, v_comment,
          COALESCE(o.is_seed, false))
  ON CONFLICT (order_id, reviewer_side) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'already_reviewed' USING ERRCODE = '23505';
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_leave_review(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_leave_review(uuid, integer, text) TO authenticated, service_role;

-- 7. A shop's public buyer reviews, for members (no ids of people or orders).
CREATE OR REPLACE FUNCTION public.shops_shop_reviews(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_rating numeric;
  v_count integer;
BEGIN
  PERFORM public.require_feature('shops');
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.shop_state_ok(p_shop_id) THEN
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

-- 8. The caller's side of one order: whether they may review it, and their own review.
CREATE OR REPLACE FUNCTION public.shops_my_order_review(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders%ROWTYPE;
  v_owner uuid;
  v_side text;
  r public.shop_reviews%ROWTYPE;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  IF FOUND THEN
    SELECT owner_id INTO v_owner FROM public.shops WHERE id = o.shop_id;
  END IF;
  v_side := CASE WHEN o.id IS NULL OR v_owner IS NULL THEN NULL
                 WHEN o.buyer_id = v_uid THEN 'buyer'
                 WHEN v_owner = v_uid THEN 'shop' END;
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO r FROM public.shop_reviews WHERE order_id = o.id AND reviewer_side = v_side;
  RETURN jsonb_build_object(
    'side', v_side,
    'can_review', o.handed_over_at IS NOT NULL AND r.id IS NULL,
    'mine', CASE WHEN r.id IS NULL THEN NULL
                 ELSE jsonb_build_object('stars', r.stars, 'comment', r.comment, 'created_at', r.created_at) END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_my_order_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_order_review(uuid) TO authenticated, service_role;

-- 6. RESTATED from 20261019042744 (verbatim plus the two rating keys): the public page shows the shop's own rating.
CREATE OR REPLACE FUNCTION public.shops_public_shop(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_s public.shops%ROWTYPE;
BEGIN
  IF p_shop_id IS NULL OR NOT public.shop_link_visible(p_shop_id) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_s FROM public.shops WHERE id = p_shop_id;
  RETURN jsonb_build_object(
    'id', v_s.id,
    'name', v_s.name,
    'about', v_s.about,
    'category', v_s.category,
    'category_label', (SELECT c.label FROM public.shop_categories c WHERE c.slug = v_s.category),
    'group_label', (SELECT c.group_label FROM public.shop_categories c WHERE c.slug = v_s.category),
    'parishes_served', to_jsonb(v_s.parishes_served),
    'area_label', v_s.area_label,
    'storefront', v_s.storefront,
    'offers_selling', v_s.offers_selling,
    'offers_quotes', v_s.offers_quotes,
    'badges', public.shop_badges(v_s.id),
    -- CHANGED (Shops H9, Q2207): the SHOP's own rating from its buyers' reviews, only at 3 or more reviews
    -- (shop_review_rating returns no average below that), never the owner's person rating.
    'rating', (SELECT rr.rating FROM public.shop_review_rating(v_s.id) rr),
    'review_count', (SELECT CASE WHEN rr.rating IS NULL THEN 0 ELSE rr.review_count END FROM public.shop_review_rating(v_s.id) rr),
    'hours', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'weekday', h.weekday, 'opens', to_char(h.opens_local, 'HH24:MI'), 'closes', to_char(h.closes_local, 'HH24:MI'))
               ORDER BY h.weekday, h.opens_local) FROM public.shop_hours h WHERE h.shop_id = v_s.id), '[]'::jsonb),
    'photos', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', ph.id, 'kind', ph.photo_kind, 'position', ph.position)
               ORDER BY ph.photo_kind, ph.position) FROM public.shop_photos ph WHERE ph.shop_id = v_s.id), '[]'::jsonb),
    'items', CASE WHEN v_s.offers_selling THEN COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                        'id', i.id,
                        'kind', i.kind,
                        'subtype', i.subtype,
                        'status', 'live',
                        'title', i.title,
                        'description', i.description,
                        'price_cents', i.price_cents,
                        'lead_time_days', i.lead_time_days,
                        'stock_count', i.stock_count,
                        'home_kitchen', i.kind = 'home_food',
                        'photos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ph.id, 'position', ph.position)
                                                     ORDER BY ph.position)
                                              FROM public.shop_item_photos ph WHERE ph.item_id = i.id), '[]'::jsonb))
                      ORDER BY i.live_at DESC NULLS FIRST, i.created_at DESC, i.id)
                 FROM public.shop_items i
                WHERE i.shop_id = v_s.id AND i.status = 'live'), '[]'::jsonb)
             ELSE '[]'::jsonb END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_public_shop(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shops_public_shop(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.shops_public_shop(uuid) IS
  'SH2b: the public shop page for anyone with the link (anon included): only what the page shows, never the owner id, '
  'pin, SoS number, hidden reason or pickup address. NULL for any shop shop_link_visible refuses.';
