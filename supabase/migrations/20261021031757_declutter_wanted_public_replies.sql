-- Board 117 / Q2267 (owner approved 2026-10-21; lead-approved design, 10 points): sellers can reply "I have this"
-- to a Wanted post, privacy first.
--  1. OPT-IN per post, never retroactive: declutter_wanted.public NOT NULL DEFAULT false. Every existing post stays
--     private (it was posted under "Only you see your post"). declutter_create_wanted gains p_public DEFAULT false
--     (the form sends true by default, owner 10-21, beside the plain line saying what sellers see); the poster can
--     turn it off (declutter_set_wanted_public).
--  2. WHO READS: signed-in members, through declutter_wanted_browse only (SECURITY DEFINER, both switches). The
--     table grant and its "poster reads own" policy are unchanged: nobody reads another member's row directly.
--  3. WHAT THEY SEE: the words (plain letters only, W8, and the contact-leak trigger), category, "up to", the poster
--     as First L., and the distance in whole miles from the post's point SNAPPED to 0.1 degree (a few miles), so
--     probing many points cannot narrow the poster's area below that grid. Never area_lat/lng, an address or a user id.
--  4. EXCLUDED: your own posts, either-way blocks, posters who are out (banned, strikes) or hidden, private, closed
--     or expired posts, and test (is_seed) posts from members the seed switch hides them from.
--  5. A REPLY IS AN OFFER, no free text: declutter_wanted_reply(post, your LIVE offers-mode listing, price) with the
--     price at most the Wanted max and at most the listing's price now. It inserts a declutter_offers row
--     seller -> poster awaiting the BUYER (the poster), tagged with wanted_id; the existing offer card, accept
--     (card required, least(offer, price now)) and the 48-hour checkout run unchanged.
--  6. LIMITS: one reply per (post, seller) (unique index), 10 replies a day per seller, at most 5 answers a day
--     reaching one poster, the selling gates (declutter_assert_member(true), declutter_seller_out), the post locked
--     FOR UPDATE and re-checked; only a listing with no open offer can answer (no oracle on who the poster is).
--  7. NOTIFY: the poster gets "A seller has a match" for each (at most 5 a day by point 6).
--  8. Members lose the direct table read of declutter_offers / declutter_offer_events (review blocker #1).
-- Restated (prod prosrc md5 = 20261016053541's bodies, measured 2026-10-21): declutter_create_wanted
-- 7345066c676c6458b4ae97bf0434a056, declutter_my_wanted c1916e3b0cb3cf0262484816b5454b3b (adds `public`).
-- New signatures need DROP + CREATE; grants restated as live (authenticated, service_role; never anon).
-- Replay-safe: IF [NOT] EXISTS everywhere, CREATE OR REPLACE.

ALTER TABLE public.declutter_wanted ADD COLUMN IF NOT EXISTS public boolean NOT NULL DEFAULT false;
ALTER TABLE public.declutter_offers ADD COLUMN IF NOT EXISTS wanted_id uuid;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_offers_wanted_id_fkey') THEN
    ALTER TABLE public.declutter_offers
      ADD CONSTRAINT declutter_offers_wanted_id_fkey FOREIGN KEY (wanted_id) REFERENCES public.declutter_wanted(id) ON DELETE SET NULL;
  END IF;
END
$do$;
-- lh-authz-rls review of Q2267 #1 (blocker): members could read declutter_offers / declutter_offer_events rows
-- directly (table SELECT + "the two sides read"), which would hand a seller the poster's user id from one reply. No
-- app or edge code reads either table directly (checked 2026-10-21; every read goes through declutter_my_offers and
-- the other definer RPCs, which return no counterparty id), so members lose the table read. Replay-safe.
REVOKE SELECT ON public.declutter_offers FROM anon, authenticated;
REVOKE SELECT ON public.declutter_offer_events FROM anon, authenticated;
-- The two "the two sides read" SELECT policies stay on purpose: with RLS on and no grant they let nothing through, and
-- should a table read ever be granted again they keep it to the offer's two sides (re-review note, 2026-10-21).

CREATE UNIQUE INDEX IF NOT EXISTS declutter_offers_one_reply_per_wanted ON public.declutter_offers (wanted_id, seller_id) WHERE wanted_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS declutter_offers_wanted_replies_by_seller ON public.declutter_offers (seller_id, created_at) WHERE wanted_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS declutter_wanted_public_open_idx ON public.declutter_wanted (expires_at) WHERE status = 'open' AND public;

DROP FUNCTION IF EXISTS public.declutter_create_wanted(text, text, integer, integer, numeric, numeric);
CREATE OR REPLACE FUNCTION public.declutter_create_wanted(
  p_what text,
  p_category text,
  p_max_price_cents integer,
  p_radius_miles integer,
  p_lat numeric,
  p_lng numeric,
  p_public boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
  v_what text := btrim(regexp_replace(COALESCE(p_what, ''), '\s+', ' ', 'g'));
  v_told integer := 0;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Row 53: a wanted post is a buying intent, so the under-18 rule applies.
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  -- W8: plain words only (ASCII letters, digits, spaces and . , ' & ( ) / -),
  -- no web address (a dot between letters), no phone number spelled out in
  -- digits (7 or more) or in words (4 number words in a row), and at least
  -- one searchable word.
  IF char_length(v_what) NOT BETWEEN 3 AND 60
     OR v_what !~ '^[A-Za-z0-9 .,''&()/-]+$'
     OR v_what ~ '[A-Za-z]\.[A-Za-z]'
     OR char_length(regexp_replace(v_what, '[^0-9]', '', 'g')) >= 7
     OR lower(v_what) ~ '(\m(zero|oh|one|two|three|four|five|six|seven|eight|nine)\M[^a-z0-9]*){4,}'
     OR numnode(plainto_tsquery('english', v_what)) = 0 THEN
    RAISE EXCEPTION 'invalid_wanted_text'
      USING ERRCODE = '22023', HINT = 'Say what you want in 3 to 60 letters, like "crib" or "oak dresser".';
  END IF;
  IF p_category IS NULL OR p_category !~ '^[a-z][a-z0-9_]{1,39}$' THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  -- Whole dollars only (re-review note 7: cents are a free channel to a seller).
  IF p_max_price_cents IS NULL OR p_max_price_cents NOT BETWEEN 100 AND 100000 OR p_max_price_cents % 100 <> 0 THEN
    RAISE EXCEPTION 'invalid_max_price'
      USING ERRCODE = '22023', HINT = 'Your highest price must be whole dollars between $1 and $1,000.';
  END IF;
  IF p_radius_miles IS NULL OR p_radius_miles NOT IN (5, 10, 25, 50) THEN
    RAISE EXCEPTION 'invalid_radius' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'wanted_area_unknown' USING ERRCODE = '22023';
  END IF;

  -- W7: one poster at a time (their own key only), so parallel calls cannot
  -- all pass the caps.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_post:' || v_uid::text));
  IF (SELECT count(*) FROM public.declutter_wanted w
       WHERE w.user_id = v_uid AND w.created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'wanted_rate_limited'
      USING ERRCODE = '42501', HINT = 'You can post up to 5 wanted items a day.';
  END IF;
  IF (SELECT count(*) FROM public.declutter_wanted w
       WHERE w.user_id = v_uid AND w.status = 'open' AND w.expires_at > now()) >= 10 THEN
    RAISE EXCEPTION 'wanted_open_limit'
      USING ERRCODE = '42501', HINT = 'You have 10 open wanted posts. Close one to post another.';
  END IF;

  -- Q2267: sellers near the poster may see it and reply only when the poster chose so (never by default here).
  INSERT INTO public.declutter_wanted (user_id, what, category, max_price_cents, radius_miles, area_lat, area_lng, public)
  VALUES (v_uid, v_what, p_category, p_max_price_cents, p_radius_miles::smallint, round(p_lat, 2), round(p_lng, 2), COALESCE(p_public, false))
  RETURNING id INTO v_id;

  FOR r IN SELECT * FROM public.declutter_wanted_pairs(NULL, v_id, false) LOOP
    v_told := v_told + public.declutter_wanted_record_match(r.wanted_id, r.item_id, v_told < 20, false);
  END LOOP;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_create_wanted(text, text, integer, integer, numeric, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_create_wanted(text, text, integer, integer, numeric, numeric, boolean) TO authenticated, service_role;

-- The poster turns replies on or off for one of their own open posts.
CREATE OR REPLACE FUNCTION public.declutter_set_wanted_public(p_wanted_id uuid, p_public boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  UPDATE public.declutter_wanted SET public = COALESCE(p_public, false)
   WHERE id = p_wanted_id AND user_id = v_uid AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN COALESCE(p_public, false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_wanted_public(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_wanted_public(uuid, boolean) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.declutter_my_wanted();
CREATE OR REPLACE FUNCTION public.declutter_my_wanted()
RETURNS TABLE(id uuid, what text, category text, max_price_cents integer, radius_miles integer,
              status text, expires_at timestamptz, created_at timestamptz, matches jsonb, public boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT w.id, w.what, w.category, w.max_price_cents, w.radius_miles::integer,
           CASE WHEN w.status = 'open' AND w.expires_at <= now() THEN 'expired' ELSE w.status END,
           w.expires_at, w.created_at,
           CASE WHEN w.status = 'open' AND w.expires_at > now() THEN
             COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'price_cents', i.current_price_cents)
                                        ORDER BY i.current_price_cents, i.id)
                         FROM public.declutter_wanted_pairs(NULL, w.id, true) p
                         JOIN public.declutter_items i ON i.id = p.item_id
                        WHERE i.current_price_cents <= w.max_price_cents
                          AND NOT public.declutter_seller_hidden(i.seller_id)), '[]'::jsonb)
           ELSE '[]'::jsonb END,
           w.public
      FROM public.declutter_wanted w
     WHERE w.user_id = v_uid
     ORDER BY (w.status = 'open' AND w.expires_at > now()) DESC, w.created_at DESC
     LIMIT 50;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_wanted() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_wanted() TO authenticated, service_role;

-- First L. from a profile name, "A neighbor" without one (the shape of the app's formatName).
CREATE OR REPLACE FUNCTION public.declutter_first_l(p_full_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN NULLIF(btrim(p_full_name), '') IS NULL THEN 'A neighbor'
    WHEN position(' ' IN btrim(p_full_name)) = 0 THEN btrim(p_full_name)
    ELSE split_part(btrim(p_full_name), ' ', 1) || ' ' || left(regexp_replace(btrim(p_full_name), '^.*\s', ''), 1) || '.'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_first_l(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_first_l(text) TO authenticated, service_role;

-- Whole miles between the reader's point and a post's point SNAPPED to 0.1 degree (never the stored point itself).
CREATE OR REPLACE FUNCTION public.declutter_wanted_snap_miles(p_lat numeric, p_lng numeric, w_lat numeric, w_lng numeric)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT greatest(1, round(2 * 3958.8 * asin(least(1, sqrt(
           power(sin(radians((round(w_lat, 1) - p_lat) / 2)), 2)
           + cos(radians(p_lat)) * cos(radians(round(w_lat, 1))) * power(sin(radians((round(w_lng, 1) - p_lng) / 2)), 2)))))::integer);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_snap_miles(numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_snap_miles(numeric, numeric, numeric, numeric) TO authenticated, service_role;

-- Design points 2-4: public Wanted posts near the reader. No user id, no coordinates.
CREATE OR REPLACE FUNCTION public.declutter_wanted_browse(p_lat numeric, p_lng numeric)
RETURNS TABLE(id uuid, what text, category text, max_price_cents integer, poster_name text, miles integer, expires_at timestamptz, replied boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_lat numeric := round(p_lat, 2);
  v_lng numeric := round(p_lng, 2);
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- The same member gates as posting and replying (row 53: under 18 never reads adults' posts) (review #4).
  PERFORM public.declutter_assert_member(true);
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'wanted_area_unknown' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT w.id, w.what, w.category, w.max_price_cents, public.declutter_first_l(pr.full_name),
           public.declutter_wanted_snap_miles(v_lat, v_lng, w.area_lat, w.area_lng),
           w.expires_at,
           EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.wanted_id = w.id AND o.seller_id = v_uid)
      FROM public.declutter_wanted w
      LEFT JOIN public.profiles pr ON pr.user_id = w.user_id
     WHERE w.public
       AND w.status = 'open'
       AND w.expires_at > now()
       AND w.user_id <> v_uid
       AND pr.anonymized_at IS NULL
       AND NOT public.are_users_blocked(v_uid, w.user_id)
       AND NOT public.declutter_member_out(w.user_id)
       AND NOT public.declutter_seller_hidden(w.user_id)
       AND (w.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
       AND public.declutter_wanted_snap_miles(v_lat, v_lng, w.area_lat, w.area_lng) <= w.radius_miles
     ORDER BY 6, w.created_at DESC
     LIMIT 50;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_browse(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_browse(numeric, numeric) TO authenticated, service_role;

-- Design points 5-7: "I have this" = an offer from one of your live listings, awaiting the poster.
CREATE OR REPLACE FUNCTION public.declutter_wanted_reply(p_wanted_id uuid, p_item_id uuid, p_amount_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  w public.declutter_wanted;
  i record;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF public.declutter_seller_out(v_uid) THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Item first, then the post (the offer paths lock item -> offer; nothing else locks a post then an item).
  SELECT it.id, it.seller_id, it.status, it.sale_mode, it.current_price_cents, it.title, it.is_seed INTO i
    FROM public.declutter_items it WHERE it.id = p_item_id FOR UPDATE;
  IF i.id IS NULL OR i.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id FOR UPDATE;
  -- One answer for every post you may not reply to: no oracle for private, blocked or hidden posts.
  IF w.id IS NULL OR NOT w.public OR w.status <> 'open' OR w.expires_at <= now() OR w.user_id = v_uid
     OR public.are_users_blocked(v_uid, w.user_id)
     OR public.declutter_member_out(w.user_id)
     OR public.declutter_seller_hidden(w.user_id)
     OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())) THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF i.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'Only a listing that is for sale now can answer.';
  END IF;
  IF i.sale_mode <> 'offers' THEN
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;
  IF i.is_seed IS TRUE AND public.seed_hidden_for(w.user_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents > least(w.max_price_cents, i.current_price_cents) THEN
    RAISE EXCEPTION 'invalid_reply_amount' USING ERRCODE = '22023',
      HINT = 'Your price is at most their Wanted price and at most your listing''s price.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.wanted_id = w.id AND o.seller_id = v_uid) THEN
    RAISE EXCEPTION 'already_replied' USING ERRCODE = '23505', HINT = 'You already answered this Wanted post.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_reply:' || v_uid::text));
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.seller_id = v_uid AND o.wanted_id IS NOT NULL AND o.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'reply_rate_limited' USING ERRCODE = '54000', HINT = 'You can answer 10 Wanted posts a day.';
  END IF;
  -- Only a listing with no open offer can answer: the answer then depends on the seller's own listing only, never on
  -- WHO the poster is (an "already open between you two" refusal named the poster: review #2).
  IF EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.item_id = i.id AND o.status = 'open') THEN
    RAISE EXCEPTION 'listing_has_open_offer' USING ERRCODE = '55000', HINT = 'This listing has an open offer. Answer with another listing, or after it closes.';
  END IF;
  -- At most 5 answers a day reach one poster (review #3): that bounds the match alert AND every later notice the
  -- offer paths send (expiry, voided, closed), which are not quieted per kind.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_inbox:' || w.user_id::text));
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.buyer_id = w.user_id AND o.wanted_id IS NOT NULL AND o.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'wanted_busy' USING ERRCODE = '54000', HINT = 'This post has enough answers for today. Try tomorrow.';
  END IF;
  -- The Wanted post is the poster's opening ask; the answer is the seller's counter to it (counter_count 1, a
  -- 'counter' event), so the existing offer wording ("You did not answer the counteroffer within 48 hours",
  -- "The buyer did not answer your counteroffer") is true for it.
  INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, counter_count, wanted_id)
  VALUES (i.id, w.user_id, v_uid, p_amount_cents, 'buyer', now() + interval '48 hours', 1, w.id)
  RETURNING id INTO v_id;
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
  VALUES (v_id, 'seller', 'counter', p_amount_cents);
  PERFORM public.declutter_notify(w.user_id, 'new_offers', 'A seller has a match',
    format('A seller near you has "%s" for $%s, at or under your Wanted price. Accept, counter or decline within 48 hours.',
           i.title, to_char(p_amount_cents / 100.0, 'FM999990.00')),
    '/declutter?view=offers', v_uid);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_reply(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_reply(uuid, uuid, integer) TO authenticated, service_role;
