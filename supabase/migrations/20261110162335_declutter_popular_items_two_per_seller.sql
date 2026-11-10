-- D018 (landing design audit 11-10, finding D018): the landing's "Popular on Declutter" grid could be filled by ONE
-- seller (8 of 8 cards from the same person), so it read as one garage sale, not a neighborhood. Now each seller's
-- items are ranked among their own, and only a seller's best TWO compete for the first places, taken round by round:
-- every seller's best item first (best-ranked seller first), then every seller's second; a seller's third and later
-- items come after every seller's first two. Nothing is dropped: with too few sellers to fill the grid, the rest is
-- filled from their other items in the same order as before.
-- Measured on prod 11-10 (read-only SQL): the live, priced, photographed, non-seed, not-hidden listings come from 1
-- seller (242 items), so today the grid is unchanged; the cap takes effect as soon as a second seller lists.
--
-- Everything else is exactly 20261110054539 (same filters, signals, tie-breaks, columns, limit clamp, grants). The
-- old order is computed ONCE (overall_rank) and both the per-seller rank and the final order read it, so the two can
-- never disagree. Still never returns a seller, a count or a viewer. The order lets a caller guess that a later item
-- shares a seller with an earlier one; the item page already names each listing's seller to a guest, so that tells
-- nothing new (code-review 11-10, note 8).
--
-- Proof: src/test/pglite/declutterPopularItemsTwoPerSeller.pglite.mjs (both migrations in order, this one 3x; red on the
-- old definition; it re-checks the eligibility and signal rules on THIS body).
-- REPLAY-SAFETY: CREATE OR REPLACE of a function 20261110054539 created; REVOKE/GRANT restated.
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
       AND NOT public.is_test_member(w.user_id)
     GROUP BY w.item_id
  ),
  offers AS (
    SELECT o.item_id, count(DISTINCT o.buyer_id) AS n
      FROM public.declutter_offers o
      JOIN shown s ON s.id = o.item_id
     WHERE NOT o.is_seed
       AND o.buyer_id <> s.seller_id
       AND NOT public.is_test_member(o.buyer_id)
     GROUP BY o.item_id
  ),
  views AS (
    -- Members' views count in full; signed-out views (any device id a caller makes up) count at most 10 per item,
    -- so a script cannot buy the top spot with guest views (lh-authz-rls review 11-09, finding 1).
    SELECT v.item_id,
           count(DISTINCT v.viewer_id) + least(count(DISTINCT v.device_id) FILTER (WHERE v.viewer_id IS NULL), 10) AS n
      FROM public.declutter_item_views v
      JOIN shown s ON s.id = v.item_id
     WHERE v.created_at > now() - interval '30 days'
       AND (v.viewer_id IS NULL OR (v.viewer_id <> s.seller_id AND NOT public.is_test_member(v.viewer_id)))
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
  ),
  ranked AS (
    SELECT s.*,
           row_number() OVER (ORDER BY 3 * coalesce(sv.n, 0) + 3 * coalesce(ov.n, 0) + coalesce(vw.n, 0) DESC,
                                       coalesce(cs.n, 0) DESC,
                                       s.live_at DESC NULLS LAST,
                                       s.id) AS overall_rank
      FROM shown s
      LEFT JOIN saves sv ON sv.item_id = s.id
      LEFT JOIN offers ov ON ov.item_id = s.id
      LEFT JOIN views vw ON vw.item_id = s.id
      LEFT JOIN category_sales cs ON cs.category = s.category
  ),
  per_seller AS (
    SELECT r.*, row_number() OVER (PARTITION BY r.seller_id ORDER BY r.overall_rank) AS seller_rank
      FROM ranked r
  )
  SELECT p.id, p.title, p.category, p.condition_stars, p.porch_ok, p.price_cents, p.current_price_cents, p.area_label,
         p.live_at,
         (SELECT ph.storage_path FROM public.declutter_item_photos ph
           WHERE ph.item_id = p.id ORDER BY ph.position, ph.id LIMIT 1) AS photo_path
    FROM per_seller p
   ORDER BY least(p.seller_rank, 3),
            p.overall_rank
   LIMIT greatest(1, least(coalesce(p_limit, 8), 24));
$fn$;

REVOKE ALL ON FUNCTION public.declutter_popular_items(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_popular_items(integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_popular_items(integer) IS
  'Owner 11-09: the landing''s Declutter preview, most saved/offered/viewed live listings first (category sales, then '
  'newest, break ties); D018 11-10: a seller''s best two first, their others after every seller''s two. Guest-visible, '
  'priced, photographed listings only; the card columns and cover photo path, never a count or a seller.';
