-- SH2/SH2b: a shop page anyone with the link can look at (owner 2026-10-19).
--
-- Before this, /shops/:id was signed-in only and every shop read
-- (shops_get_shop, shops_shop_items, the shops table policy) required the
-- hidden 'shops' switch FOR THE VIEWER. A shop owner who shared their link
-- sent people to a sign-in wall, then a 404 (the switch is testers-only).
--
-- The owner's rule: anyone with the link can LOOK, no account needed; ordering
-- and messaging need an account. So this adds ONE read, shops_public_shop,
-- callable by anon, that returns exactly what the public page shows and
-- nothing else:
--   * only a shop that is not hidden by an admin, not paused, whose owner is
--     in good standing (not banned, under 3 marketplace strikes), not a test
--     account's while seed data is hidden, and whose OWNER has the 'shops'
--     switch (the viewer's switch no longer matters; the owner's does, so a
--     shop opened before its owner could use Shops is never linkable);
--   * name, about, category (label too: shop_categories is members-only),
--     area label (never an address), parishes served, storefront flag, what it
--     offers, badges, the owner's rating, hours, logo/cover/gallery photos,
--     and the LIVE items (only while the shop sells) with their photos;
--   * photos by ID only, never their storage path: the path starts with the
--     owner's user id (<uid>/shops/...), and get_safe_profiles is anon-callable,
--     so a path would name the person behind a home kitchen (lh-authz-rls
--     review, must-fix 1). The shop-photo edge function serves a photo by id
--     through shops_public_photo_path (service_role only), same visibility;
--   * NOT the owner's id, the pin, the Secretary of State number, the hidden
--     reason, follower identities, the pickup address (shop_pickup_addresses,
--     untouched), item review state or anything in shop_item_private.
-- No table grant to anon changes: the function is SECURITY DEFINER and the
-- tables stay unreadable to anon over REST. Any other answer (no such shop,
-- hidden, paused, owner switched off) is the same NULL, so the call is no
-- oracle for which of those it was.
--
-- Search engines: the page is noindex until the switch opens to everyone
-- (api/share.ts + vercel.json X-Robots-Tag), not a robots.txt Disallow, which
-- would also block the link-preview fetch.
--
-- REPLAY-SAFETY: every function it calls exists from earlier migrations
-- (20261017061155, 20261017061157, 20261012031120, 20260901035245) and is
-- resolved at call time; CREATE OR REPLACE throughout.

CREATE OR REPLACE FUNCTION public.shop_link_visible(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT s.hidden_at IS NULL
       AND NOT s.paused
       AND NOT (s.is_seed AND public.seed_jobs_hidden_publicly())
       AND public.shop_owner_in_good_standing(s.owner_id)
       AND public.feature_enabled_for_user('shops', s.owner_id)
      FROM public.shops s WHERE s.id = p_shop_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.shop_link_visible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_link_visible(uuid) TO service_role;
COMMENT ON FUNCTION public.shop_link_visible(uuid) IS
  'SH2b: may anyone with the link see this shop? Not hidden, not paused, owner in good standing and switched on, '
  'no test shop while seeds are hidden. Internal (service_role); read by shops_public_shop.';

CREATE OR REPLACE FUNCTION public.shops_public_shop(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_s public.shops%ROWTYPE;
  v_rating numeric;
  v_count integer;
BEGIN
  IF p_shop_id IS NULL OR NOT public.shop_link_visible(p_shop_id) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_s FROM public.shops WHERE id = p_shop_id;
  SELECT r.rating, r.review_count INTO v_rating, v_count FROM public.shop_owner_rating(v_s.owner_id) r;
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
    'rating', v_rating,
    'review_count', COALESCE(v_count, 0),
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

-- The storage path of ONE photo on a link-visible shop, for the shop-photo
-- edge function only (service_role): a shop photo while shop_link_visible, an
-- item photo while its item is live and its shop sells too. NULL otherwise.
CREATE OR REPLACE FUNCTION public.shops_public_photo_path(p_photo_id uuid, p_kind text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE p_kind
    WHEN 'shop' THEN (
      SELECT ph.storage_path FROM public.shop_photos ph
       WHERE ph.id = p_photo_id AND public.shop_link_visible(ph.shop_id))
    WHEN 'item' THEN (
      SELECT ph.storage_path FROM public.shop_item_photos ph
        JOIN public.shop_items i ON i.id = ph.item_id
        JOIN public.shops s ON s.id = i.shop_id
       WHERE ph.id = p_photo_id AND i.status = 'live' AND s.offers_selling
         AND public.shop_link_visible(s.id))
  END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_public_photo_path(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_public_photo_path(uuid, text) TO service_role;
COMMENT ON FUNCTION public.shops_public_photo_path(uuid, text) IS
  'SH2b: storage path of one photo on a link-visible shop, for the shop-photo edge function (service_role only). '
  'Clients never get it: the path names the owner''s user id.';
