-- Shops audit 11-12 S043: Browse search runs on the server and matches item titles.
--
-- Search filtered only the shops already loaded on the screen, by name, category and area, so a shop past the
-- loaded page could never be found and an item ("king cake") never found its shop. shops_browse gains p_query:
-- every word of it must appear in the shop's name, its category label or its area, or in the title of one of the
-- shop's LIVE items, only while the shop page lists them (status = 'live', the shop offers selling and is not
-- paused: a paused shop's page shows only its name, S044). Matching is plain lowercase
-- substring (strpos, no LIKE pattern, so % and _ are just characters), at most 6 words of an 80-character query.
-- Everything else is restated verbatim from 20261017061155 (visibility through shop_visible_to, the 2-decimal
-- pins, the order, the 60-row cap and p_offset paging).
--
-- Adding a parameter changes the signature, so the 6-argument form is dropped (two overloads would make PostgREST
-- calls without p_query ambiguous) and the grants are restated for the 7-argument form. Old clients that never
-- send p_query resolve to the new form through its DEFAULT.
--
-- Speed: one query, no per-row round trips. The item-title test is a semi-join per shop that reads the new partial
-- covering index shop_items_live_title_idx (shop_id) INCLUDE (title) WHERE status = 'live' (index-only), and it
-- runs only when a query is given.

CREATE INDEX IF NOT EXISTS shop_items_live_title_idx ON public.shop_items (shop_id) INCLUDE (title) WHERE status = 'live';

DROP FUNCTION IF EXISTS public.shops_browse(numeric, numeric, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.shops_browse(
  p_lat numeric,
  p_lng numeric,
  p_category text DEFAULT NULL,
  p_group text DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0,
  p_query text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  category text,
  area_label text,
  pin_lat numeric,
  pin_lng numeric,
  paused boolean,
  miles numeric,
  rating numeric,
  review_count integer,
  badges jsonb,
  logo_path text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_words text[];
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- S043: the search words, lowercased, at most 6 of an 80-character query; none means no search.
  SELECT array_agg(w) INTO v_words
    FROM (SELECT DISTINCT w
            FROM regexp_split_to_table(lower(left(btrim(COALESCE(p_query, '')), 80)), '\s+') AS w
           WHERE w <> ''
           LIMIT 6) q;
  RETURN QUERY
  SELECT s.id, s.name, s.category, s.area_label,
         -- The list never needs a storefront's exact pin: always 2 decimals.
         round(s.pin_lat, 2), round(s.pin_lng, 2), s.paused,
         CASE WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL
              ELSE round((3958.8 * 2 * asin(sqrt(
                     power(sin(radians((s.pin_lat - p_lat) / 2)), 2)
                     + cos(radians(p_lat)) * cos(radians(s.pin_lat))
                       * power(sin(radians((s.pin_lng - p_lng) / 2)), 2))))::numeric, 1)
         END AS miles,
         r.rating, COALESCE(r.review_count, 0),
         public.shop_badges(s.id),
         (SELECT ph.storage_path FROM public.shop_photos ph WHERE ph.shop_id = s.id AND ph.photo_kind = 'logo' LIMIT 1)
    FROM public.shops s
    JOIN public.shop_categories c ON c.slug = s.category
    LEFT JOIN LATERAL public.shop_owner_rating(s.owner_id) r ON true
   WHERE public.shop_visible_to(s.id, v_uid)
     AND (p_category IS NULL OR s.category = p_category)
     AND (p_group IS NULL OR c.group_slug = p_group)
     AND (v_words IS NULL OR NOT EXISTS (
           SELECT 1 FROM unnest(v_words) AS qw(w)
            WHERE strpos(lower(COALESCE(s.name, '') || ' ' || COALESCE(c.label, '') || ' ' || COALESCE(s.area_label, '')), qw.w) = 0
              AND NOT EXISTS (SELECT 1 FROM public.shop_items i
                               WHERE s.offers_selling AND NOT s.paused
                                 AND i.shop_id = s.id AND i.status = 'live' AND strpos(lower(i.title), qw.w) > 0)))
   ORDER BY 8 ASC NULLS LAST, r.rating DESC NULLS LAST, s.created_at DESC, s.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 60)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_browse(numeric, numeric, text, text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_browse(numeric, numeric, text, text, integer, integer, text) TO authenticated, service_role;
