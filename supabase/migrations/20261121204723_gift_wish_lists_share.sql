-- Gift guides: share every person's gift list in one link (owner 2026-11-21: "they should also be able to share all
-- lists"; the per-person lists: "save items per person ... add/remove stuff as they are browsing the guides").
--
-- The gift planner keeps a list per person on the device (and, signed in, in gift_planner_plans, private). Sharing
-- reuses the wish list's link machinery: /gift-guides/list/<code>, one public.gift_wish_lists row, read by
-- gift_wish_list_get. A row can now also hold LISTS: [{"n": <list name, e.g. "Mom">, "items": [<ref>, ...]}, ...],
-- each ref exactly {"g": <guide slug>, "i": <item id>} as in the single wish list. No budget, no "bought" marks, no
-- prices, no email, no account id: the page finds each gift (photo, price, Shop link) in its guide by the ref.
--   * gift_wish_lists_share(p_lists, p_test) -> code   anon + authenticated. ALWAYS a new snapshot (user_id NULL),
--     signed in or not (an account's one synced row is its wish list, untouched). Snapshots are never changed after
--     they are made and gift_wish_list_prune deletes them after 90 days, as every snapshot. 1..50 lists, each 0..100
--     refs (validated as gift_wish_list_save validates them), each list's name stripped of control/invisible/direction
--     characters, 1..40 characters (empty: 'Someone'), never a link or a 7+ digit run (it shows on our page). Lists
--     with no gift are left out; nothing to share at all raises empty_list; at most 300 gifts across the lists. The rate
--     limit uses gift_wish_list_save's bucket and hits table (the two share one budget): 10 shares per address or
--     account per 10 minutes, and the overall 2000-snapshots-an-hour cap. is_seed by the same rule (p_test, a localhost origin, a test member).
--   * gift_wish_list_get(p_code): RESTATED FROM THE NEWEST CREATE (20261120062130_gift_wish_lists.sql) verbatim, plus
--     'lists' in its answer when the row has them. A row without lists (every link made before this) reads exactly as
--     before: name, items, updated_at.
--
-- Access stays server-functions-only: RLS on, no policy, no table privilege for anon/authenticated (unchanged).
-- MONEY: none. REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, REVOKE/GRANT.
-- Proof: src/test/pglite/giftWishListsShare.pglite.mjs (applied 3x).

ALTER TABLE public.gift_wish_lists ADD COLUMN IF NOT EXISTS lists jsonb
  CHECK (lists IS NULL OR (jsonb_typeof(lists) = 'array' AND jsonb_array_length(lists) BETWEEN 1 AND 50 AND pg_column_size(lists) <= 32768));
COMMENT ON COLUMN public.gift_wish_lists.lists IS
  'Shared gift lists (20261121204723): [{n: list name, items: [{g, i}]}], set only by gift_wish_lists_share on a snapshot. Never a budget, price or bought mark.';

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
    -- Every ref is exactly {"g": <guide slug>, "i": <item id>} (gift_wish_list_save's own rule).
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_list->'items') AS t(e)
       WHERE jsonb_typeof(e) <> 'object'
          OR (SELECT count(*) FROM jsonb_object_keys(e)) <> 2
          OR jsonb_typeof(e->'g') IS DISTINCT FROM 'string'
          OR jsonb_typeof(e->'i') IS DISTINCT FROM 'string'
          OR NOT COALESCE((e->>'g') ~ '^[a-z0-9-]{1,80}$', false)
          OR NOT COALESCE((e->>'i') ~ '^[a-z0-9]{1,16}$', false)
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
    -- Each item id once per list (the first one wins), in the list's order.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('g', x.g, 'i', x.i) ORDER BY x.n), '[]'::jsonb)
      INTO v_items
      FROM (
        SELECT DISTINCT ON (e->>'i') e->>'g' AS g, e->>'i' AS i, n
          FROM jsonb_array_elements(v_list->'items') WITH ORDINALITY AS t(e, n)
         ORDER BY e->>'i', n
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

-- RESTATED FROM THE NEWEST CREATE (20261120062130_gift_wish_lists.sql) verbatim, plus 'lists' when the row has them.
CREATE OR REPLACE FUNCTION public.gift_wish_list_get(p_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT jsonb_build_object('name', w.name, 'items', w.items, 'updated_at', w.updated_at)
         || CASE WHEN w.lists IS NOT NULL THEN jsonb_build_object('lists', w.lists) ELSE '{}'::jsonb END
    FROM public.gift_wish_lists w
   WHERE w.code = lower(btrim(p_code))
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_list_get(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_list_get(text) TO anon, authenticated, service_role;
