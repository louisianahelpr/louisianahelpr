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
--     account's while seed data is hidden, while the 'shops' switch is not
--     OFF for everyone (a global kill: it answers the same for every shop).
--     The not-hidden / seed / standing part is shop_state_ok, the ONE helper
--     shop_publicly_visible (members) now reads too, so the two rules cannot
--     drift (lead /code-review #4).
--     It deliberately does NOT ask whether the OWNER has the switch
--     (feature_enabled_for_user): that answer differs per owner while Shops is
--     testers-only, so a NULL-vs-shop reply would tell anyone with a shop id
--     whether its owner is a tester or admin (lead /code-review #5). A shop
--     row exists only once its owner opened it through shops_save_my_shop, which
--     require_feature('shops') gates, so the owner had the switch then;
--   * name, about, category (label too: shop_categories is members-only),
--     area label (never an address), parishes served, storefront flag, what it
--     offers, badges, hours, logo/cover/gallery photos, and the LIVE items
--     (only while the shop sells) with their photos;
--   * NOT the owner's person rating: shop_owner_rating reads
--     get_public_profile_stats for the owner, and matching its exact
--     rating + count against public profile stats would point at the person
--     behind the shop (lead /code-review #10). A shop-level rating comes with
--     shop reviews (Q2207);
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
-- hidden, paused, Shops switched off) is the same NULL, so the call is no
-- oracle for which of those it was.
--
-- Search engines: the page is noindex until the switch opens to everyone
-- (api/share.ts + vercel.json X-Robots-Tag), not a robots.txt Disallow, which
-- would also block the link-preview fetch.
--
-- REPLAY-SAFETY: every function and table it reads exists from earlier
-- migrations (20261017061155, 20261017061157, 20261012031120, 20260901035245);
-- SQL bodies are validated at CREATE, so shop_state_ok is created before the
-- two functions that call it; CREATE OR REPLACE throughout.

-- The shop-state rule every viewer shares: not hidden by an admin, no test
-- shop while the launch switch hides seed data, owner in good standing. One
-- definition, read by shop_publicly_visible (members, 20261017061155's rule,
-- now through here) and shop_link_visible (anyone with the link).
CREATE OR REPLACE FUNCTION public.shop_state_ok(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT s.hidden_at IS NULL
       AND NOT (s.is_seed AND public.seed_jobs_hidden_publicly())
       AND public.shop_owner_in_good_standing(s.owner_id)
      FROM public.shops s WHERE s.id = p_shop_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.shop_state_ok(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_state_ok(uuid) TO service_role;
COMMENT ON FUNCTION public.shop_state_ok(uuid) IS
  'Shops: the shop-state rule every viewer shares (not hidden, no test shop while seeds are hidden, owner in good '
  'standing). Internal; read by shop_publicly_visible and shop_link_visible so the two never drift.';

-- Members: unchanged rule (the viewer's own 'shops' switch, then the shared
-- state), now through shop_state_ok. Grants restated as 20261017061155 set them.
CREATE OR REPLACE FUNCTION public.shop_publicly_visible(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT public.feature_enabled_for('shops')
     AND public.shop_state_ok(p_shop_id);
$fn$;
REVOKE ALL ON FUNCTION public.shop_publicly_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_publicly_visible(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shop_link_visible(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_shop_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.feature_switches f
                  WHERE f.key = 'shops' AND f.audience IN ('testers', 'everyone'))
     AND public.shop_state_ok(p_shop_id)
     AND COALESCE((SELECT NOT s.paused FROM public.shops s WHERE s.id = p_shop_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.shop_link_visible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_link_visible(uuid) TO service_role;
COMMENT ON FUNCTION public.shop_link_visible(uuid) IS
  'SH2b: may anyone with the link see this shop? shop_state_ok, not paused, and Shops not switched off for everyone. '
  'Never asks the owner''s own switch (a per-owner answer would be a tester oracle). Internal; read by shops_public_shop.';

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
