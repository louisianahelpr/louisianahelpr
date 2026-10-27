-- Q2426 (owner 2026-10-27): share a Declutter item to Facebook with a good link card.
--
-- The problem: /declutter/item/:id had no link-preview card. Every shared item previewed in Facebook, iMessage
-- and WhatsApp as the generic Helpr homepage card ("Louisiana's local partner"), so a seller posting an item in a
-- local Facebook group showed no photo, no title, no price and no town. The item tables are member-only (anon has
-- no grant), so api/share.ts, which reads with the anon key, could not build one.
--
-- This adds the two reads the card needs, the same shape the Shops link card uses (20261019042744):
--   * declutter_public_item_card(item id): anon-callable. Only what the card shows: the title, the price now
--     (0 is "Free"), the town (area_label, the coarse area buyers already see; never the pickup address) and the
--     cover photo's ID. Never the seller's id, the description (free text a seller may type an address into),
--     the floor price, the pickup address or the photo's storage path (it starts with the seller's user id).
--   * declutter_public_photo_path(photo id): service_role only, for the shop-photo edge function's kind=declutter
--     (it turns the id into the image without ever saying the path).
-- Both answer only while the item is buyable on the page: live or reserved, not hidden because its seller is out,
-- no test item while the seed switch hides test data, and the 'declutter' switch not off (testers or everyone,
-- never the caller's own switch: a per-person answer would tell a stranger who is a tester; the Shops rule).
-- Any other item (sold, withdrawn, draft, removed, no such id) is the same NULL, so the call is no oracle for
-- which of those it was. No table grant to anon changes.
--
-- Search engines: the item page is sign-in only, so the card says noindex (api/share.ts) and vercel.json sends
-- X-Robots-Tag: noindex on /declutter/item/*; robots.txt keeps the path fetchable (the preview needs the fetch).
--
-- REPLAY-SAFETY: CREATE OR REPLACE throughout; every table and function read exists from earlier migrations
-- (20261014193955 items and photos, 20261021142959 seller_hidden, 20261020033623 is_seed,
-- 20261007033530 seed_hidden_in_discovery, 20261012031120 feature_switches).

-- The one visibility rule both reads share, so they never drift.
CREATE OR REPLACE FUNCTION public.declutter_item_link_visible(p_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_item_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.feature_switches f
                  WHERE f.key = 'declutter' AND f.audience IN ('testers', 'everyone'))
     AND COALESCE((
       SELECT i.status IN ('live', 'reserved')
          AND NOT i.seller_hidden
          AND (NOT i.is_seed OR NOT public.seed_hidden_in_discovery())
         FROM public.declutter_items i
        WHERE i.id = p_item_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_link_visible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_item_link_visible(uuid) TO service_role;
COMMENT ON FUNCTION public.declutter_item_link_visible(uuid) IS
  'Q2426: may a link card show this Declutter item? Live or reserved, seller not out, no test item while seeds are '
  'hidden, Declutter not switched off. Never asks the caller''s own switch. Internal; read by the two card reads.';

CREATE OR REPLACE FUNCTION public.declutter_public_item_card(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_i public.declutter_items%ROWTYPE;
BEGIN
  IF p_item_id IS NULL OR NOT public.declutter_item_link_visible(p_item_id) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_i FROM public.declutter_items WHERE id = p_item_id;
  RETURN jsonb_build_object(
    'title', v_i.title,
    'price_cents', v_i.current_price_cents,
    'area_label', v_i.area_label,
    'photo_id', (SELECT ph.id FROM public.declutter_item_photos ph
                  WHERE ph.item_id = v_i.id ORDER BY ph.position LIMIT 1));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_public_item_card(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.declutter_public_item_card(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_public_item_card(uuid) IS
  'Q2426: the link card for a shared Declutter item (anon included): title, price now, town, cover photo id. Never '
  'the seller id, description, floor, pickup address or storage path. NULL for any item the card may not show.';

CREATE OR REPLACE FUNCTION public.declutter_public_photo_path(p_photo_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT ph.storage_path FROM public.declutter_item_photos ph
   WHERE ph.id = p_photo_id AND public.declutter_item_link_visible(ph.item_id);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_public_photo_path(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_public_photo_path(uuid) TO service_role;
COMMENT ON FUNCTION public.declutter_public_photo_path(uuid) IS
  'Q2426: the storage path of one photo on a link-visible Declutter item, for the shop-photo edge function only '
  '(kind=declutter). NULL otherwise.';
