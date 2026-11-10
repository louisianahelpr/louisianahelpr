-- Owner 11-09 (10:55 PM): the landing's Declutter preview shows POPULAR items, the kind that sell easily, "not just the
-- random stuff I listed" (it read the newest live listings, live_at desc).
--
-- declutter_popular_items(p_limit): up to p_limit (1..24) live listings for the landing's "Shop Declutter" grid, best
-- first, ONE call (the card's columns plus its cover photo's storage path). Ranked by real signals, recency breaks ties:
--   1. score = 3 x members who saved it (declutter_watchlist) + 3 x buyers who made an offer (declutter_offers, not
--      seed) + people who opened its page in the last 30 days (declutter_item_views, one per viewer or device).
--      Saves, offers and views by the seller themself or by a test account (public.test_accounts) never count.
--   2. then how many real orders (paid or handed over, not seed) its CATEGORY has had: the categories that sell best.
--   3. then the newest (live_at desc).
-- Measured on prod 11-09 ~11:50 PM (read-only SQL): 254 live non-seed listings, all with a photo, 242 priced; 16 of them
-- have page views, 1 has a save, 0 have offers, and there are 0 real paid or handed-over orders, so today the score
-- orders the viewed and saved items first and recency fills the rest; the category term takes over as sales come in.
--
-- Only listings a GUEST may see (exactly the anon row policy "declutter items: guests read live", live only: the
-- landing never shows a reserved item): Declutter open to guests, status live, seller not hidden, not seed. Plus a price
-- (current_price_cents > 0, no Free items) and at least one photo. The same answer for a member (a subset of what
-- their own policy shows), so the call never depends on the caller and is no oracle.
-- Returns only what the anon column grant already shows on declutter_items and declutter_item_photos (the card's
-- columns and the cover photo's storage path, which the landing read before this). Never a count, a seller, a viewer
-- or a saver. SECURITY DEFINER only to count rows the caller's own policies hide (saves, offers, views, orders).
--
-- Proof: src/test/pglite/declutterPopularItems.pglite.mjs (applied 3x, every rule switched on and off).
-- REPLAY-SAFETY: CREATE OR REPLACE; REVOKE/GRANT restated. Every table and helper read exists from earlier migrations
-- (20261014193955 items, photos, watchlist, offers; the cart and order tables; 20261021142959 seller_hidden;
-- 20261020033623 is_seed; 20261012031120 test_accounts; the item-views migration; declutter_open_to_guests()).
CREATE OR REPLACE FUNCTION public.declutter_popular_items(p_limit integer DEFAULT 8)
RETURNS TABLE(
  id uuid,
  title text,
  category text,
  condition_stars smallint,
  porch_ok boolean,
  price_cents integer,
  current_price_cents integer,
  area_label text,
  live_at timestamptz,
  photo_path text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH shown AS (
    SELECT i.*
      FROM public.declutter_items i
     WHERE public.declutter_open_to_guests()
       AND i.status = 'live'
       AND NOT i.seller_hidden
       AND NOT i.is_seed
       AND i.current_price_cents > 0
       AND EXISTS (SELECT 1 FROM public.declutter_item_photos p WHERE p.item_id = i.id)
  ),
  saves AS (
    SELECT w.item_id, count(DISTINCT w.user_id) AS n
      FROM public.declutter_watchlist w
      JOIN shown s ON s.id = w.item_id
     WHERE w.user_id <> s.seller_id
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = w.user_id)
     GROUP BY w.item_id
  ),
  offers AS (
    SELECT o.item_id, count(DISTINCT o.buyer_id) AS n
      FROM public.declutter_offers o
      JOIN shown s ON s.id = o.item_id
     WHERE NOT o.is_seed
       AND o.buyer_id <> s.seller_id
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = o.buyer_id)
     GROUP BY o.item_id
  ),
  views AS (
    SELECT v.item_id, count(DISTINCT coalesce(v.viewer_id, v.device_id)) AS n
      FROM public.declutter_item_views v
      JOIN shown s ON s.id = v.item_id
     WHERE v.created_at > now() - interval '30 days'
       AND (v.viewer_id IS NULL OR v.viewer_id <> s.seller_id)
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = v.viewer_id)
     GROUP BY v.item_id
  ),
  category_sales AS (
    SELECT i.category, count(DISTINCT o.id) AS n
      FROM public.declutter_orders o
      JOIN public.declutter_cart_items c ON c.order_id = o.id
      JOIN public.declutter_items i ON i.id = c.item_id
     WHERE o.status IN ('paid', 'handed_over')
       AND NOT o.is_seed
       AND NOT i.is_seed
     GROUP BY i.category
  )
  SELECT s.id, s.title, s.category, s.condition_stars, s.porch_ok, s.price_cents, s.current_price_cents, s.area_label,
         s.live_at,
         (SELECT p.storage_path FROM public.declutter_item_photos p
           WHERE p.item_id = s.id ORDER BY p.position, p.id LIMIT 1) AS photo_path
    FROM shown s
    LEFT JOIN saves sv ON sv.item_id = s.id
    LEFT JOIN offers ov ON ov.item_id = s.id
    LEFT JOIN views vw ON vw.item_id = s.id
    LEFT JOIN category_sales cs ON cs.category = s.category
   ORDER BY 3 * coalesce(sv.n, 0) + 3 * coalesce(ov.n, 0) + coalesce(vw.n, 0) DESC,
            coalesce(cs.n, 0) DESC,
            s.live_at DESC NULLS LAST,
            s.id
   LIMIT greatest(1, least(coalesce(p_limit, 8), 24));
$fn$;

REVOKE ALL ON FUNCTION public.declutter_popular_items(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_popular_items(integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_popular_items(integer) IS
  'Owner 11-09: the landing''s Declutter preview, most saved/offered/viewed live listings first (category sales, then '
  'newest, break ties). Guest-visible, priced, photographed listings only; the card columns and cover photo path, never a count.';
