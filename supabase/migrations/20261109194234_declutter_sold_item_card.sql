-- F061 (UI audit 11-09; lead rule 11-09): a sold Declutter item's page shows what it was.
--
-- The problem: a link to a sold item (shared to Facebook, in a notice, saved) opened a yellow notice, one button and a
-- blank page. The item itself cannot be read once it is not for sale: declutter_items' RLS and
-- declutter_item_link_visible (20261027194426) answer live and reserved items only.
--
-- The rule (lead 11-09): ONLY an item that really sold (status 'sold' or 'completed') may show its title and its
-- cover photo, greyed, with "Sold". A withdrawn, removed, rejected, ended, sold-elsewhere, paused, draft or pending
-- item shows NOTHING of the listing (a seller who pulled it, or an admin who removed it, should not have it shown);
-- neither does a sold item that was EVER reported (a reports row, reported_type 'declutter_item', any status: an admin
-- cannot take down a sold item, declutter_admin_take_down_item refuses it, so a report is the line; lh-authz-rls
-- review 11-09), a sold item whose seller is out (seller_hidden), a test item while test data is hidden, or any item
-- while Declutter is switched off. Every such case is the same NULL, so the call is no oracle for which it was.
--
-- What it adds, nothing else changes for live items:
--   * declutter_item_sold_visible(item id): internal, the one rule above (no grant to anon or authenticated).
--   * declutter_sold_item_card(item id): anon-callable. Only the title and the cover photo's ID (the same two things
--     the share card already shows for a live item). Never the price, town, seller, description or storage path.
--   * declutter_public_photo_path(photo id) restated: also the COVER photo (lowest position) of a sold-visible item,
--     so shop-photo kind=declutter can draw it. Any other photo of a sold item stays NULL. service_role only, as before.
--
-- REPLAY-SAFETY: CREATE OR REPLACE throughout; the tables and helpers read exist from earlier migrations
-- (public.reports from the base schema; 20261014193955 items and photos, 20261021142959 seller_hidden, 20261020033623 is_seed,
-- 20261007033530 seed_hidden_in_discovery, 20261012031120 feature_switches, 20261027194426 link_visible).

CREATE OR REPLACE FUNCTION public.declutter_item_sold_visible(p_item_id uuid)
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
       SELECT i.status IN ('sold', 'completed')
          AND NOT i.seller_hidden
          AND (NOT i.is_seed OR NOT public.seed_hidden_in_discovery())
          AND NOT EXISTS (SELECT 1 FROM public.reports r
                           WHERE r.reported_type = 'declutter_item' AND r.reported_id = i.id)
         FROM public.declutter_items i
        WHERE i.id = p_item_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_sold_visible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_item_sold_visible(uuid) TO service_role;
COMMENT ON FUNCTION public.declutter_item_sold_visible(uuid) IS
  'F061: may a sold item''s page show what it was? Status sold or completed only, never reported, seller not out, no '
  'test item while seeds are hidden, Declutter not switched off. Internal; read by declutter_sold_item_card and the '
  'photo path.';

CREATE OR REPLACE FUNCTION public.declutter_sold_item_card(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_title text;
BEGIN
  IF p_item_id IS NULL OR NOT public.declutter_item_sold_visible(p_item_id) THEN
    RETURN NULL;
  END IF;
  SELECT i.title INTO v_title FROM public.declutter_items i WHERE i.id = p_item_id;
  RETURN jsonb_build_object(
    'title', v_title,
    'photo_id', (SELECT ph.id FROM public.declutter_item_photos ph
                  WHERE ph.item_id = p_item_id ORDER BY ph.position, ph.id LIMIT 1));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_sold_item_card(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.declutter_sold_item_card(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_sold_item_card(uuid) IS
  'F061: a SOLD Declutter item''s title and cover photo id, for its page''s greyed "Sold" card (anon included). NULL '
  'for every other item (withdrawn, removed, rejected, hidden, test, switched off, no such id).';

CREATE OR REPLACE FUNCTION public.declutter_public_photo_path(p_photo_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT ph.storage_path FROM public.declutter_item_photos ph
   WHERE ph.id = p_photo_id
     AND (public.declutter_item_link_visible(ph.item_id)
          OR (public.declutter_item_sold_visible(ph.item_id)
              AND ph.id = (SELECT c.id FROM public.declutter_item_photos c
                            WHERE c.item_id = ph.item_id ORDER BY c.position, c.id LIMIT 1)));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_public_photo_path(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_public_photo_path(uuid) TO service_role;
COMMENT ON FUNCTION public.declutter_public_photo_path(uuid) IS
  'Q2426 + F061: the storage path of one photo on a link-visible Declutter item, or the cover photo of a sold-visible '
  'one, for the shop-photo edge function only (kind=declutter). NULL otherwise.';
