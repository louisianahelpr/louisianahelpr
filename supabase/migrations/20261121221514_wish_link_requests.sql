-- Gift lists: the "links to create" queue (owner 2026-11-21: "people can put in the wish list or family can send each
-- other wish lists, we see the list, create the links if we don't have it, and send - they buy with our link";
-- "someone can just type in ideas ... and we find a link or closest match").
--
-- A gift added to a person's list from any store (a pasted link we do not carry, or typed words with no guide pick
-- chosen) becomes one row here. We see it in Admin -> Wish list links, grouped by list, in the person's own words, and
-- paste our affiliate link; from then on every list showing that gift (the shopper's planner and every list they
-- share) uses our link.
--   * wish_link_requests: kind link|idea, the person's words (1..120), the pasted link (https, a public host, 500 max;
--     never fetched here), its page key (host + path, or amazon:<ASIN>), the list it came from (the planner's own
--     opaque person id + the person's first name, 40 max), our link once made, status open|filled|dismissed, is_seed.
--     NO account id, email or address is stored. RLS on, no policy, no table privilege for anon/authenticated:
--     read and written only by the functions below.
--   * wish_link_request_add(kind, words, url, list_key, list_name, p_test) -> {id, link}   anon + authenticated.
--     An Amazon /dp/<ASIN>?tag=louisianahelpr-20 link is ours already: saved filled. A link whose page we already
--     linked (any list) comes back filled with that link at once. The same gift on the same list again returns the
--     row it already has (not a dismissed one). The words are never a link, web address or phone number (they show on
--     shared lists). Rate limit first: gift_wish_list_save's hits table, its own bucket per account and address
--     together, 30 per 10 minutes and 120 per hour; overall only a 20000-an-hour storage brake.
--   * wish_link_requests_get(ids uuid[]) -> [{id, status, link}]   anon + authenticated. 1..300 ids (random uuids,
--     known only to the device that made them and to lists it shared). Never the words, link pasted or list name.
--   * admin_wish_link_requests() -> rows (admin only; test rows left out), admin_wish_link_request_fill(id, url) and
--     admin_wish_link_request_dismiss(id) (admin only, each writes an admin_audit_log row). Filling a link also fills
--     every other open row for the same page.
--   * gift_wish_lists_share: RESTATED FROM THE NEWEST CREATE (20261121204723_gift_wish_lists_share.sql), plus a third
--     ref kind {"r": <request id>}, each request once per list; a request that no longer exists is left out.
--   * gift_wish_list_get: RESTATED FROM THE NEWEST CREATE (20261121204723_gift_wish_lists_share.sql), each {"r"} ref
--     read back as {"r", "w": the words, "h": our link once made, else null, "d": true when we dismissed it}. A
--     request deleted since is left out.
--     The pasted link itself never shows on a shared list (it could be anyone's link): only our link does.
--   * gift_wish_list_prune: RESTATED FROM THE NEWEST CREATE (20261120062130_gift_wish_lists.sql), plus requests older
--     than 180 days.
--
-- MONEY: none (affiliate links only). REPLAY-SAFE: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, REVOKE/GRANT.
-- Proof: src/test/pglite/wishLinkRequests.pglite.mjs (applied 3x).

CREATE TABLE IF NOT EXISTS public.wish_link_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('link', 'idea')),
  words text NOT NULL CHECK (length(words) BETWEEN 1 AND 120),
  url text CHECK (url IS NULL OR (url ~ '^https://' AND length(url) <= 500)),
  url_key text CHECK (url_key IS NULL OR length(url_key) <= 600),
  list_key text NOT NULL CHECK (list_key ~ '^[a-z0-9]{1,16}$'),
  list_name text NOT NULL CHECK (length(list_name) BETWEEN 1 AND 40),
  affiliate_url text CHECK (affiliate_url IS NULL OR (affiliate_url ~ '^https://' AND length(affiliate_url) <= 500)),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'dismissed')),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  filled_at timestamptz,
  CHECK ((kind = 'link') = (url IS NOT NULL)),
  CHECK ((status = 'filled') = (affiliate_url IS NOT NULL))
);
COMMENT ON TABLE public.wish_link_requests IS
  'Gift lists'' links to create (20261121221514): a pasted shop link or typed idea, in the person''s words, and our affiliate link once an admin adds it. No account id, email or address. Read/written only via the wish_link_* functions.';
CREATE INDEX IF NOT EXISTS wish_link_requests_url_key_idx ON public.wish_link_requests (url_key) WHERE url_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS wish_link_requests_list_idx ON public.wish_link_requests (list_key, created_at);
CREATE INDEX IF NOT EXISTS wish_link_requests_created_idx ON public.wish_link_requests (created_at);
ALTER TABLE public.wish_link_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wish_link_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.wish_link_requests TO service_role;

-- Every public table keeps the unconfirmed-email gate (Q807; db-smoke).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- A pasted link's page key: amazon:<ASIN> for an Amazon product, else host (no www.) + path, lower case, no query.
CREATE OR REPLACE FUNCTION public.wish_link_url_key(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN lower(p_url) ~ '^https://(www\.|smile\.)?amazon\.com/' AND p_url ~ '/(dp|gp/product|gp/aw/d)/[A-Z0-9]{10}([/?#]|$)'
      THEN 'amazon:' || substring(p_url FROM '/(?:dp|gp/product|gp/aw/d)/([A-Z0-9]{10})(?:[/?#]|$)')
    ELSE left(regexp_replace(lower(regexp_replace(split_part(split_part(p_url, '#', 1), '?', 1), '^https://(www\.)?', '')), '/+$', ''), 600)
  END
$fn$;
REVOKE ALL ON FUNCTION public.wish_link_url_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wish_link_url_key(text) TO service_role;

-- An https link to a public host: letters-only top-level domain (so never a bare IP), no user name, no port, no space,
-- never localhost or a private name.
CREATE OR REPLACE FUNCTION public.wish_link_url_ok(p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_url IS NOT NULL
     AND length(p_url) <= 500
     AND p_url ~ '^https://([A-Za-z0-9-]+\.)+[A-Za-z]{2,}(/[^[:space:]]*)?$'
     AND lower(split_part(substring(p_url FROM 9), '/', 1)) !~ '\.(local|internal|test|localhost|lan|home|corp)$'
$fn$;
REVOKE ALL ON FUNCTION public.wish_link_url_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wish_link_url_ok(text) TO service_role;

CREATE OR REPLACE FUNCTION public.wish_link_request_add(
  p_kind text, p_words text, p_url text, p_list_key text, p_list_name text, p_test boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Chicago'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_words text;
  v_list_name text;
  v_url text;
  v_key text;
  v_link text;
  v_status text := 'open';
  v_row public.wish_link_requests;
  v_headers jsonb;
  v_addr text;
  v_origin text;
  v_bucket text;
  v_seed boolean;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('link', 'idea') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  -- The words show on our page (a shared list) and to us: control, zero-width and direction characters stripped first.
  v_words := btrim(regexp_replace(COALESCE(p_words, ''), '[[:cntrl:]\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]', '', 'g'));
  -- Never a link, a web address or a phone number (the list-name rule of gift_wish_lists_share; lh-authz-rls review).
  IF length(v_words) NOT BETWEEN 1 AND 120
     OR v_words ~* '(https?:|www\.|\.[a-z]{2,}/|\m[a-z0-9-]+\.[a-z]{2,}\M)'
     OR regexp_replace(v_words, '[\s().+-]', '', 'g') ~ '[0-9]{7,}' THEN
    RAISE EXCEPTION 'invalid_words' USING ERRCODE = '22023';
  END IF;
  v_list_name := btrim(regexp_replace(COALESCE(p_list_name, ''), '[[:cntrl:]\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]', '', 'g'));
  v_list_name := left(COALESCE(NULLIF(v_list_name, ''), 'Someone'), 40);
  IF p_list_key IS NULL OR p_list_key !~ '^[a-z0-9]{1,16}$' THEN
    RAISE EXCEPTION 'invalid_list' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'link' THEN
    v_url := btrim(p_url);
    IF NOT public.wish_link_url_ok(v_url) THEN
      RAISE EXCEPTION 'invalid_url' USING ERRCODE = '22023';
    END IF;
    v_key := public.wish_link_url_key(v_url);
  ELSIF p_url IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_url' USING ERRCODE = '22023';
  END IF;

  -- Rate limit (before anything is looked up; lh-authz-rls review): gift_wish_list_save's hits table, this function's
  -- own bucket, per account AND address together (the LAST x-forwarded-for entry): 30 per 10 minutes and 120 per hour.
  -- No low overall cap (a few abusers could switch it off for every family): only a storage brake far above any season.
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;
  v_addr := nullif(btrim(reverse(split_part(reverse(COALESCE(v_headers->>'x-forwarded-for', '')), ',', 1))), '');
  v_origin := lower(COALESCE(v_headers->>'origin', ''));
  v_bucket := md5('wish-link:' || COALESCE('u:' || v_uid::text, '') || '|a:' || COALESCE(v_addr, 'no-address') || ':' || current_date::text);
  DELETE FROM public.gift_wish_list_hits WHERE hit_at < now() - interval '1 day';
  IF (SELECT count(*) FROM public.gift_wish_list_hits WHERE bucket = v_bucket AND hit_at > now() - interval '10 minutes') >= 30
     OR (SELECT count(*) FROM public.gift_wish_list_hits WHERE bucket = v_bucket AND hit_at > now() - interval '1 hour') >= 120 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.wish_link_requests WHERE created_at > now() - interval '1 hour') >= 20000 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.gift_wish_list_hits (bucket, snapshot) VALUES (v_bucket, false);

  -- The same gift on the same list again: the row it already has (never a dismissed one: a re-add asks again).
  SELECT * INTO v_row FROM public.wish_link_requests r
   WHERE r.list_key = p_list_key
     AND r.status <> 'dismissed'
     AND ((p_kind = 'link' AND r.url_key = v_key) OR (p_kind = 'idea' AND r.kind = 'idea' AND lower(r.words) = lower(v_words)))
   ORDER BY r.created_at
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_row.id, 'link', CASE WHEN v_row.status = 'filled' THEN v_row.affiliate_url END);
  END IF;

  IF p_kind = 'link' THEN
    IF v_url ~ '^https://www\.amazon\.com/dp/[A-Z0-9]{10}\?tag=louisianahelpr-20$' THEN
      -- Our own Amazon link (the app rewrites every Amazon product link to it): nothing to make.
      v_link := v_url;
    ELSE
      -- A page we already linked for anyone: that link, at once.
      SELECT r.affiliate_url INTO v_link FROM public.wish_link_requests r
       WHERE r.url_key = v_key AND r.status = 'filled'
       ORDER BY r.filled_at DESC NULLS LAST
       LIMIT 1;
    END IF;
    IF v_link IS NOT NULL THEN v_status := 'filled'; END IF;
  END IF;

  v_seed := COALESCE(p_test, false)
            OR v_origin ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$'
            OR (v_uid IS NOT NULL AND public.is_test_member(v_uid));
  INSERT INTO public.wish_link_requests (kind, words, url, url_key, list_key, list_name, affiliate_url, status, is_seed, filled_at)
  VALUES (p_kind, v_words, v_url, v_key, p_list_key, v_list_name, v_link, v_status, v_seed,
          CASE WHEN v_link IS NOT NULL THEN now() END)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('id', v_row.id, 'link', v_row.affiliate_url);
END;
$fn$;
REVOKE ALL ON FUNCTION public.wish_link_request_add(text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wish_link_request_add(text, text, text, text, text, boolean) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.wish_link_requests_get(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'invalid_ids' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status,
                                        'link', CASE WHEN r.status = 'filled' THEN r.affiliate_url END))
      FROM public.wish_link_requests r
     WHERE r.id = ANY (p_ids)), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.wish_link_requests_get(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wish_link_requests_get(uuid[]) TO anon, authenticated, service_role;

-- ── Admin: the queue, fill with our link, dismiss. ─────────────────────────────────────────────────────────────
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
            'list_name', r.list_name, 'status', r.status, 'affiliate_url', r.affiliate_url, 'created_at', r.created_at)
            ORDER BY (r.status = 'open') DESC, r.created_at DESC)
     FROM (SELECT * FROM public.wish_link_requests x
            WHERE NOT x.is_seed
            ORDER BY (x.status = 'open') DESC, x.created_at DESC LIMIT 500) r), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_wish_link_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_wish_link_requests() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_wish_link_request_fill(p_id uuid, p_url text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_url text := btrim(p_url);
  v_row public.wish_link_requests;
  v_also int := 0;
BEGIN
  IF NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.wish_link_url_ok(v_url) THEN
    RAISE EXCEPTION 'invalid_url' USING ERRCODE = '22023';
  END IF;
  UPDATE public.wish_link_requests
     SET status = 'filled', affiliate_url = v_url, filled_at = now()
   WHERE id = p_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'PT404'; END IF;
  -- The same page on every other list that is still waiting gets the same link.
  IF v_row.url_key IS NOT NULL THEN
    UPDATE public.wish_link_requests
       SET status = 'filled', affiliate_url = v_url, filled_at = now()
     WHERE url_key = v_row.url_key AND id <> p_id AND status = 'open';
    GET DIAGNOSTICS v_also = ROW_COUNT;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES ((SELECT auth.uid()), 'wish_link_fill', 'wish_link_request', p_id::text,
          jsonb_build_object('affiliate_url', v_url, 'also_filled', v_also));
  RETURN jsonb_build_object('id', p_id, 'also_filled', v_also);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_wish_link_request_fill(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_wish_link_request_fill(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_wish_link_request_dismiss(p_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.wish_link_requests SET status = 'dismissed', affiliate_url = NULL, filled_at = NULL WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'PT404'; END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES ((SELECT auth.uid()), 'wish_link_dismiss', 'wish_link_request', p_id::text, '{}'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_wish_link_request_dismiss(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_wish_link_request_dismiss(uuid) TO authenticated, service_role;

-- RESTATED FROM THE NEWEST CREATE (20261121204723_gift_wish_lists_share.sql), plus {"r": <request id>} refs.
CREATE OR REPLACE FUNCTION public.gift_wish_lists_share(p_lists jsonb, p_test boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
-- The rate-limit bucket's day (current_date) is Louisiana's day, as gift_wish_list_save's.
SET "TimeZone" TO 'America/Chicago'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_list jsonb;
  v_name text;
  v_items jsonb;
  v_out jsonb := '[]'::jsonb;
  v_headers jsonb;
  v_addr text;
  v_origin text;
  v_bucket text;
  v_code text;
  v_seed boolean;
  v_try int := 0;
  v_limit int;
  v_total int := 0;
BEGIN
  IF p_lists IS NULL OR jsonb_typeof(p_lists) <> 'array' OR jsonb_array_length(p_lists) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;
  FOR v_list IN SELECT e FROM jsonb_array_elements(p_lists) AS t(e) LOOP
    -- Every list is exactly {"n": <name>, "items": [<ref>, ...]}; anything else refuses the whole share.
    IF jsonb_typeof(v_list) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_list)) <> 2
       OR jsonb_typeof(v_list->'n') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_list->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_list->'items') > 100 THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;
    -- Every ref is exactly {"g": <guide slug>, "i": <item id>} (gift_wish_list_save's own rule), or exactly
    -- {"r": <request id>} for a gift from any store (20261121221514). A request that no longer exists (pruned after 180
    -- days) is left out below, never refusing the whole share (lh-silent-failure review).
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_list->'items') AS t(e)
       WHERE jsonb_typeof(e) <> 'object'
          OR NOT (
               ((SELECT count(*) FROM jsonb_object_keys(e)) = 2
                AND jsonb_typeof(e->'g') IS NOT DISTINCT FROM 'string'
                AND jsonb_typeof(e->'i') IS NOT DISTINCT FROM 'string'
                AND COALESCE((e->>'g') ~ '^[a-z0-9-]{1,80}$', false)
                AND COALESCE((e->>'i') ~ '^[a-z0-9]{1,16}$', false))
            OR ((SELECT count(*) FROM jsonb_object_keys(e)) = 1
                AND jsonb_typeof(e->'r') IS NOT DISTINCT FROM 'string'
                AND COALESCE((e->>'r') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)))
    ) THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;
    -- The list's name shows on our page: control, zero-width and direction-changing characters are stripped first.
    v_name := btrim(regexp_replace(v_list->>'n', '[[:cntrl:]\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]', '', 'g'));
    v_name := COALESCE(NULLIF(v_name, ''), 'Someone');
    IF length(v_name) > 40
       OR v_name ~* '(https?:|www\.|\.[a-z]{2,}/|\m[a-z0-9-]+\.[a-z]{2,}\M)'
       OR regexp_replace(v_name, '[\s().+-]', '', 'g') ~ '[0-9]{7,}' THEN
      RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
    END IF;
    -- Each item id (or request) once per list (the first one wins), in the list's order.
    SELECT COALESCE(jsonb_agg(CASE WHEN x.r IS NOT NULL THEN jsonb_build_object('r', x.r)
                                   ELSE jsonb_build_object('g', x.g, 'i', x.i) END ORDER BY x.n), '[]'::jsonb)
      INTO v_items
      FROM (
        SELECT DISTINCT ON (COALESCE(e->>'i', 'r:' || (e->>'r'))) e->>'g' AS g, e->>'i' AS i, e->>'r' AS r, n
          FROM jsonb_array_elements(v_list->'items') WITH ORDINALITY AS t(e, n)
         WHERE NOT (e ? 'r') OR EXISTS (SELECT 1 FROM public.wish_link_requests q WHERE q.id::text = e->>'r')
         ORDER BY COALESCE(e->>'i', 'r:' || (e->>'r')), n
      ) x;
    -- At most 300 gifts across every list (lh-authz-rls review: keeps a share near a wish list's size).
    v_total := v_total + jsonb_array_length(v_items);
    IF v_total > 300 THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;
    -- A list with no gift is left out of the share.
    IF jsonb_array_length(v_items) > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('n', v_name, 'items', v_items));
    END IF;
  END LOOP;
  IF jsonb_array_length(v_out) = 0 THEN
    RAISE EXCEPTION 'empty_list' USING ERRCODE = '22023';
  END IF;
  -- Refused in plain words before the column's CHECK would refuse it with a raw error.
  IF pg_column_size(v_out) > 32768 THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;

  -- Rate limit: gift_wish_list_save's bucket and hits table (one budget for both), the LAST x-forwarded-for entry.
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;
  v_addr := nullif(btrim(reverse(split_part(reverse(COALESCE(v_headers->>'x-forwarded-for', '')), ',', 1))), '');
  v_origin := lower(COALESCE(v_headers->>'origin', ''));
  v_bucket := md5('gift-wish:' || COALESCE('u:' || v_uid::text, 'a:' || v_addr, 'no-address') || ':' || current_date::text);
  DELETE FROM public.gift_wish_list_hits WHERE hit_at < now() - interval '1 day';
  -- 10 per 10 minutes for everyone (a share is a snapshot, signed in or not, and counts toward the overall cap, so an
  -- account gets no more than an address; lh-authz-rls review).
  v_limit := 10;
  IF (SELECT count(*) FROM public.gift_wish_list_hits WHERE bucket = v_bucket AND hit_at > now() - interval '10 minutes') >= v_limit THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  -- Every share is a snapshot, so every share counts toward the overall hourly snapshot cap.
  IF (SELECT count(*) FROM public.gift_wish_list_hits WHERE snapshot AND hit_at > now() - interval '1 hour') >= 2000 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.gift_wish_list_hits (bucket, snapshot) VALUES (v_bucket, true);

  v_seed := COALESCE(p_test, false)
            OR v_origin ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$'
            OR (v_uid IS NOT NULL AND public.is_test_member(v_uid));
  LOOP
    v_try := v_try + 1;
    v_code := public.gift_wish_list_new_code();
    BEGIN
      -- A snapshot, never the account's row: user_id NULL, so it is pruned with every snapshot after 90 days.
      INSERT INTO public.gift_wish_lists (code, name, items, lists, user_id, is_seed)
      VALUES (v_code, 'Gift lists', '[]'::jsonb, v_out, NULL, v_seed);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- A code collision (1 in 16^12): try another code, a few times.
      IF v_try >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_lists_share(jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_lists_share(jsonb, boolean) TO anon, authenticated, service_role;

-- RESTATED FROM THE NEWEST CREATE (20261121204723_gift_wish_lists_share.sql), each {"r"} ref read back with the
-- person's words and our link once made (never the link they pasted); a request deleted since is left out.
CREATE OR REPLACE FUNCTION public.gift_wish_list_get(p_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object('name', w.name, 'items', w.items, 'updated_at', w.updated_at)
         || CASE WHEN w.lists IS NOT NULL THEN jsonb_build_object('lists', (
              SELECT COALESCE(jsonb_agg(jsonb_build_object('n', l.e->'n', 'items', (
                       SELECT COALESCE(jsonb_agg(
                                CASE WHEN it.e ? 'r'
                                     THEN jsonb_build_object('r', it.e->>'r', 'w', q.words,
                                                             'h', CASE WHEN q.status = 'filled' THEN q.affiliate_url END,
                                                             'd', q.status = 'dismissed')
                                     ELSE it.e END ORDER BY it.n), '[]'::jsonb)
                         FROM jsonb_array_elements(l.e->'items') WITH ORDINALITY AS it(e, n)
                         LEFT JOIN public.wish_link_requests q ON it.e ? 'r' AND q.id::text = it.e->>'r'
                        WHERE NOT (it.e ? 'r') OR q.id IS NOT NULL)) ORDER BY l.n), '[]'::jsonb)
                FROM jsonb_array_elements(w.lists) WITH ORDINALITY AS l(e, n))) ELSE '{}'::jsonb END
    FROM public.gift_wish_lists w
   WHERE w.code = lower(btrim(p_code))
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_list_get(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_list_get(text) TO anon, authenticated, service_role;

-- RESTATED FROM THE NEWEST CREATE (20261120062130_gift_wish_lists.sql), plus link requests older than 180 days (a
-- device keeps the last link it read for each of its gifts).
CREATE OR REPLACE FUNCTION public.gift_wish_list_prune()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n int;
  v_r int;
BEGIN
  DELETE FROM public.gift_wish_lists w WHERE w.user_id IS NULL AND w.created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.wish_link_requests r WHERE r.created_at < now() - interval '180 days';
  GET DIAGNOSTICS v_r = ROW_COUNT;
  RETURN jsonb_build_object('pruned', v_n, 'link_requests_pruned', v_r);
END;
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_list_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_list_prune() TO service_role;
