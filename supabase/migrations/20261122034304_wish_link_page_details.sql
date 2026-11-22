-- Gift lists: a pasted shop link's title, photo and price in Admin -> Wish list links (gift lists lane, 2026-11-21:
-- "the server fetch of a pasted link's title, photo and price for the link queue").
--
-- The queue (20261121221514_wish_link_requests.sql) shows each gift in the shopper's own words and the link they pasted;
-- to make our affiliate link the admin had to open every page to see what it was. Now an admin's "Get shop details"
-- (edge function wish-link-pages, admin only) reads the waiting pages of a fixed list of shops (never Amazon, never a
-- short or affiliate link; the str-ical-sync SSRF gate on every hop) and stores what each page says.
--   * wish_link_requests: page_title (1..200), page_image (an https link that passes wish_link_url_ok), page_price
--     (USD, 0 < price < 100000, to the cent), page_status ok|none|skipped|blocked|failed, page_checked_at. Shown to the
--     admin only: never to shoppers, never on a shared list (a price read off a page once is not a price we show).
--   * wish_link_pages_due(p_limit) -> [{id, url}]   service role only. Open link rows not checked yet, one per page key,
--     oldest first, never an Amazon page and never a test row; 1..20.
--   * wish_link_page_save(p_id, p_status, p_title, p_image, p_price) -> rows stamped   service role only. Stores the
--     outcome on that row and every other unchecked row for the same page; title/photo/price only with ok|none, and
--     each one cleaned or dropped (never trusted from the page; an "ok" with nothing kept is stored as "none").
--     Zero when the row is gone.
--   * admin_wish_link_requests: RESTATED FROM THE NEWEST CREATE (20261121221514_wish_link_requests.sql), plus the five
--     page_* fields.
--
-- MONEY: none (affiliate links only). No new table (the email gate already covers wish_link_requests). REPLAY-SAFE:
-- ADD COLUMN IF NOT EXISTS, constraints added only when missing, CREATE OR REPLACE, REVOKE/GRANT by role name.
-- Proof: src/test/pglite/wishLinkPageDetails.pglite.mjs (applied 3x).

ALTER TABLE public.wish_link_requests
  ADD COLUMN IF NOT EXISTS page_title text,
  ADD COLUMN IF NOT EXISTS page_image text,
  ADD COLUMN IF NOT EXISTS page_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS page_status text,
  ADD COLUMN IF NOT EXISTS page_checked_at timestamptz;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wish_link_requests_page_check'
                   AND conrelid = 'public.wish_link_requests'::regclass) THEN
    ALTER TABLE public.wish_link_requests ADD CONSTRAINT wish_link_requests_page_check CHECK (
      (page_title IS NULL OR length(page_title) BETWEEN 1 AND 200)
      AND (page_image IS NULL OR (page_image ~ '^https://' AND length(page_image) <= 500))
      AND (page_price IS NULL OR (page_price > 0 AND page_price < 100000))
      AND (page_status IS NULL OR page_status IN ('ok', 'none', 'skipped', 'blocked', 'failed'))
      AND ((page_status IS NULL) = (page_checked_at IS NULL))
      AND (page_status IN ('ok', 'none') OR (page_title IS NULL AND page_image IS NULL AND page_price IS NULL))
    );
  END IF;
END
$do$;
CREATE INDEX IF NOT EXISTS wish_link_requests_page_due_idx ON public.wish_link_requests (created_at)
  WHERE kind = 'link' AND status = 'open' AND page_checked_at IS NULL;

-- ── The edge function's two calls (service role only). ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wish_link_pages_due(p_limit integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = '22023';
  END IF;
  -- One row per page (the save stamps the others), oldest first; never Amazon (never read), never a test row.
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'url', d.url) ORDER BY d.created_at)
    FROM (SELECT o.id, o.url, o.created_at
            FROM (SELECT DISTINCT ON (r.url_key) r.id, r.url, r.created_at
                    FROM public.wish_link_requests r
                   WHERE r.kind = 'link' AND r.status = 'open' AND r.page_checked_at IS NULL AND NOT r.is_seed
                     AND r.url IS NOT NULL AND r.url_key IS NOT NULL AND r.url_key NOT LIKE 'amazon:%'
                     AND public.wish_link_url_ok(r.url)
                   ORDER BY r.url_key, r.created_at) o
           ORDER BY o.created_at
           LIMIT p_limit) d), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.wish_link_pages_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wish_link_pages_due(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.wish_link_page_save(
  p_id uuid, p_status text, p_title text, p_image text, p_price numeric)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_key text;
  v_title text;
  v_image text;
  v_price numeric;
  v_status text;
  v_n integer;
BEGIN
  IF p_id IS NULL OR p_status IS NULL OR p_status NOT IN ('ok', 'none', 'skipped', 'blocked', 'failed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  SELECT url_key INTO v_key FROM public.wish_link_requests WHERE id = p_id AND kind = 'link';
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  IF p_status IN ('ok', 'none') THEN
    -- Never trusted from the page: control, zero-width and direction characters dropped, 200 max; an https photo link
    -- to a public host (wish_link_url_ok); a positive USD amount under $100,000.
    v_title := left(btrim(regexp_replace(regexp_replace(COALESCE(p_title, ''),
                 '[[:cntrl:]\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]', '', 'g'), '\s+', ' ', 'g')), 200);
    v_title := NULLIF(v_title, '');
    v_image := CASE WHEN p_image IS NOT NULL AND public.wish_link_url_ok(p_image) THEN p_image END;
    -- Rounded first, then checked (lh-authz-rls review: 99999.995 rounded past the column's limit and threw).
    v_price := round(p_price, 2);
    v_price := CASE WHEN v_price > 0 AND v_price < 100000 THEN v_price END;
  END IF;
  -- A page whose every value was dropped has nothing to show (lh-silent-failure review: it read "ok" with nothing).
  v_status := CASE WHEN p_status = 'ok' AND v_title IS NULL AND v_image IS NULL AND v_price IS NULL THEN 'none' ELSE p_status END;
  UPDATE public.wish_link_requests
     SET page_status = v_status, page_checked_at = now(), page_title = v_title, page_image = v_image, page_price = v_price
   WHERE kind = 'link' AND (id = p_id OR (url_key = v_key AND page_checked_at IS NULL));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.wish_link_page_save(uuid, text, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wish_link_page_save(uuid, text, text, text, numeric) TO service_role;

-- ── Admin: the queue, now with what each page says. RESTATED FROM 20261121221514_wish_link_requests.sql. ──────────
CREATE OR REPLACE FUNCTION public.admin_wish_link_requests()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- Test data never shows to the owner: is_seed rows are left out. Open first, newest first, 500 at most.
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', r.id, 'kind', r.kind, 'words', r.words, 'url', r.url, 'list_key', r.list_key,
            'list_name', r.list_name, 'status', r.status, 'affiliate_url', r.affiliate_url, 'created_at', r.created_at,
            'page_title', r.page_title, 'page_image', r.page_image, 'page_price', r.page_price,
            'page_status', r.page_status, 'page_checked_at', r.page_checked_at)
            ORDER BY (r.status = 'open') DESC, r.created_at DESC)
     FROM (SELECT * FROM public.wish_link_requests x
            WHERE NOT x.is_seed
            ORDER BY (x.status = 'open') DESC, x.created_at DESC LIMIT 500) r), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_wish_link_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_wish_link_requests() TO authenticated, service_role;
