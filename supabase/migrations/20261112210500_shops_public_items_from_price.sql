-- Shops audit 2 (11-12) S2-038 (Builder 1): signed-out visitors saw an item with options at a flat "$18" (its lowest
-- option's price) while members saw "From $18"; the $28 option made the flat price wrong. shops_public_shop is restated
-- VERBATIM from 20261112195345 (newest) plus one item field: has_options (the item has option lists). No option names,
-- choices or per-option prices are added (the signed-in shops_item_variants read stays members-only).
-- Client: PublicShopView's ShopItemsGrid says "From $18" for an item with has_options.
-- MONEY: none. AUTHZ: lh-authz-rls (anon-callable definer gains one boolean per live item of a link-visible shop).
-- REPLAY-SAFE: CREATE OR REPLACE; REVOKE/GRANT/COMMENT restated as before.
-- Proof: src/test/pglite/shopsPublicItemsFromPrice.pglite.mjs (3x; NEW_MIGRATION=skip red).

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
    -- NEW (S044): a PAUSED shop that is otherwise link-visible (the switch is on, not hidden, not a hidden test
    -- shop, the owner in good standing) answers its name and paused = true, nothing else, so a guest with a
    -- shared link reads "<Shop> is paused for now" instead of "not found". Every other refusal stays NULL.
    IF p_shop_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.feature_switches f
                    WHERE f.key = 'shops' AND f.audience IN ('testers', 'everyone'))
       AND public.shop_state_ok(p_shop_id) THEN
      SELECT * INTO v_s FROM public.shops WHERE id = p_shop_id AND paused;
      IF FOUND THEN
        RETURN jsonb_build_object('id', v_s.id, 'name', v_s.name, 'paused', true);
      END IF;
    END IF;
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
                        -- NEW (S2-038): the item has option lists, so price_cents is its lowest option ("From $18").
                        'has_options', cardinality(i.option_names) > 0,
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
  'pin, SoS number, hidden reason or pickup address. NULL for any shop shop_link_visible refuses, except a paused shop '
  'that is otherwise visible: {id, name, paused: true} only (S044).';
