-- Declutter posting audit 10-30 (Wanted): matching that finds what the form invites people to type (#4), the seller's
-- alert opens the answer (#5), a post can be edited, posted again and removed with a reminder before it ends (#9),
-- ordinary words are allowed (#11), I have this knows which listings can answer before Send (#12), and a seller sees
-- the post's photos while a poster sees each reply's photo (#19).
-- Every restated function is the effective prod definition (pg_get_functiondef, read 2026-10-30) with only the changes
-- named beside it. Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP FUNCTION IF EXISTS.

-- ---------------------------------------------------------------------------
-- 1. Two columns. A removed post is kept (offers point at it, ON DELETE SET NULL would lose that) but leaves the hub.
ALTER TABLE public.declutter_wanted ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE public.declutter_wanted ADD COLUMN IF NOT EXISTS expiry_told_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. #11: the words rule, in one place for posting and editing. Latin letters with accents (Spanish, French and
--    Louisiana words), and " # + plus the phone's curly quotes, as well as what was allowed before. Latin only, so a
--    look-alike alphabet can't spell a link past the contact filter. Returns the problem, or NULL when the words are
--    fine. Mirrored in src/lib/declutter/wanted.ts (wantedFormProblems).
CREATE OR REPLACE FUNCTION public.declutter_wanted_text_problem(p_what text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_what IS NULL OR char_length(p_what) NOT BETWEEN 3 AND 60 THEN 'length'
    WHEN p_what !~ '^[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ0-9 .,''’&()/#+"“”-]+$' THEN 'characters'
    WHEN p_what ~ '[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ]\.[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ]' THEN 'link'
    WHEN char_length(regexp_replace(p_what, '[^0-9]', '', 'g')) >= 7 THEN 'phone'
    WHEN lower(p_what) ~ '(\m(zero|oh|one|two|three|four|five|six|seven|eight|nine)\M[^a-z0-9]*){4,}' THEN 'phone'
    WHEN numnode(plainto_tsquery('english', p_what)) = 0 THEN 'no_words'
  END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_wanted_text_problem(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_text_problem(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. #4: what a post searches for. Any meaningful word, not every word: numbers, units and price words don't count,
--    words like "kids" or "blue" count only when nothing better is there, and a word brings its synonyms.
--    Stems come from the same dictionary as the listing text, so the lists below are written as plain words.
CREATE OR REPLACE FUNCTION public.declutter_wanted_tsquery(p_what text)
 RETURNS tsquery
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_all text[] := tsvector_to_array(to_tsvector('english', COALESCE(p_what, '')));
  v_skip text[] := tsvector_to_array(to_tsvector('english',
    'inch inches ft foot feet cm mm lb lbs pound pounds oz size sized dollar dollars buck bucks less max maximum want wanted need needed looking'));
  v_soft text[] := tsvector_to_array(to_tsvector('english',
    'kid kids child children boy boys girl girls baby toddler small medium large big little old new used good nice great cheap
     white black gray grey red blue green yellow brown pink purple orange'));
  v_groups text[] := ARRAY[
    'couch sofa settee loveseat', 'bike bicycle', 'tv television', 'fridge refrigerator', 'dresser bureau',
    'stroller pram', 'rug carpet', 'drapes curtains', 'bbq barbecue grill', 'wardrobe armoire', 'mower lawnmower',
    'cellphone smartphone', 'pirogue canoe', 'crawfish crayfish'];
  v_words text[];
  v_core text[];
  v_out text[];
  g text;
  v_stems text[];
BEGIN
  SELECT array_agg(w) INTO v_words FROM unnest(v_all) w WHERE w <> ALL (v_skip) AND w !~ '^[0-9]';
  IF v_words IS NULL THEN
    RETURN plainto_tsquery('english', COALESCE(p_what, ''));
  END IF;
  SELECT array_agg(w) INTO v_core FROM unnest(v_words) w WHERE w <> ALL (v_soft);
  v_out := COALESCE(v_core, v_words);
  FOREACH g IN ARRAY v_groups LOOP
    v_stems := tsvector_to_array(to_tsvector('english', g));
    IF v_stems && v_out THEN
      v_out := v_out || v_stems;
    END IF;
  END LOOP;
  RETURN (SELECT string_agg(DISTINCT quote_literal(w), ' | ') FROM unnest(v_out) w)::tsquery;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_wanted_tsquery(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_tsquery(text) TO service_role;

-- 4. #4: category near-matches. Two categories are near when their lists overlap: the same heading in the picker
--    (src/lib/declutter/categoryIcons.ts, src/test/declutterWantedMatching.test.ts holds them equal), a few pairs
--    people really cross ("Kids bike" under Baby and kids, listed under Bikes), and Other is near everything.
CREATE OR REPLACE FUNCTION public.declutter_wanted_category_near(p_category text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_category
    WHEN 'furniture' THEN ARRAY['home', 'kids', 'yard', 'desk']
    WHEN 'appliances' THEN ARRAY['home']
    WHEN 'electronics' THEN ARRAY['home', 'desk']
    WHEN 'kitchen' THEN ARRAY['home']
    WHEN 'home_decor' THEN ARRAY['home']
    WHEN 'bedding_bath' THEN ARRAY['home']
    WHEN 'storage_organization' THEN ARRAY['home']
    WHEN 'tools' THEN ARRAY['home', 'yard', 'auto']
    WHEN 'outdoor_garden' THEN ARRAY['outdoors', 'yard']
    WHEN 'sports_outdoors' THEN ARRAY['outdoors']
    WHEN 'exercise_fitness' THEN ARRAY['outdoors']
    WHEN 'hunting_fishing' THEN ARRAY['outdoors']
    WHEN 'boats_marine' THEN ARRAY['outdoors']
    WHEN 'camping' THEN ARRAY['outdoors']
    WHEN 'bikes' THEN ARRAY['outdoors', 'kids']
    WHEN 'auto_parts' THEN ARRAY['outdoors', 'auto']
    WHEN 'baby_kids' THEN ARRAY['family', 'kids']
    WHEN 'toys_games' THEN ARRAY['family']
    WHEN 'clothing' THEN ARRAY['family']
    WHEN 'jewelry_accessories' THEN ARRAY['family']
    WHEN 'health_beauty' THEN ARRAY['family']
    WHEN 'pets' THEN ARRAY['family']
    WHEN 'office_school' THEN ARRAY['family', 'desk']
    WHEN 'books_media' THEN ARRAY['fun']
    WHEN 'crafts_hobbies' THEN ARRAY['fun']
    WHEN 'musical_instruments' THEN ARRAY['fun']
    WHEN 'collectibles_antiques' THEN ARRAY['fun']
    WHEN 'holiday_seasonal' THEN ARRAY['fun']
    WHEN 'tailgating_game_day' THEN ARRAY['fun']
    WHEN 'party_events' THEN ARRAY['fun']
    WHEN 'moving_supplies' THEN ARRAY['misc']
    WHEN 'other' THEN ARRAY['home', 'outdoors', 'family', 'fun', 'misc', 'kids', 'yard', 'desk', 'auto']
    -- A key from an older list still matches itself.
    ELSE ARRAY[COALESCE(p_category, '')]
  END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_wanted_category_near(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_category_near(text) TO service_role;

-- 5. #4: the pairs. Changed: the category join and the text match. Nothing else: the same live, seed, distance, block,
--    member and switch rules, and a removed post is status closed so it never pairs.
CREATE OR REPLACE FUNCTION public.declutter_wanted_pairs(p_item uuid, p_wanted uuid, p_with_blocked boolean)
 RETURNS TABLE(wanted_id uuid, item_id uuid, miles double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT w.id, i.id, public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng)
    FROM public.declutter_wanted w
    JOIN public.declutter_items i
      ON public.declutter_wanted_category_near(i.category) && public.declutter_wanted_category_near(w.category)
     AND i.status = 'live'
     AND i.seller_id <> w.user_id
     AND i.is_seed = w.is_seed
     -- And by the LIVE profiles too (an account marked test after it posted
     -- or listed): the Q137 rule, applied before any alert or cap.
     AND COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = w.user_id), false)
       = COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = i.seller_id), false)
   WHERE (p_item IS NOT NULL OR p_wanted IS NOT NULL)
     AND (p_item IS NULL OR i.id = p_item)
     AND (p_wanted IS NULL OR w.id = p_wanted)
     AND w.status = 'open'
     AND w.expires_at > now()
     AND public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng) <= w.radius_miles
     AND to_tsvector('english', i.title || ' ' || i.description) @@ public.declutter_wanted_tsquery(w.what)
     AND (p_with_blocked IS TRUE OR NOT EXISTS (
           SELECT 1 FROM public.user_blocks b
            WHERE (b.blocker_id = i.seller_id AND b.blocked_id = w.user_id)
               OR (b.blocker_id = w.user_id AND b.blocked_id = i.seller_id)))
     AND NOT public.declutter_seller_out(i.seller_id)
     AND NOT public.declutter_member_out(w.user_id)
     AND NOT COALESCE(public.member_under_18(w.user_id), false)
     AND public.feature_enabled_for_user('declutter', w.user_id)
     AND public.feature_enabled_for_user('declutter_wanted', w.user_id)
   ORDER BY 3, 1, 2;
$function$;

-- 6. #5: the seller's alert opens I have this on the post, with their listing picked. Changed: the seller's link only.
--    W15 stands: the words still name the seller's own listing and never repeat the poster's.
CREATE OR REPLACE FUNCTION public.declutter_wanted_record_match(p_wanted uuid, p_item uuid, p_tell_seller boolean, p_tell_poster boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  w public.declutter_wanted%ROWTYPE;
  i public.declutter_items%ROWTYPE;
  v_floor integer;
  v_n integer;
  v_sent integer := 0;
BEGIN
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted;
  SELECT * INTO i FROM public.declutter_items WHERE id = p_item;
  IF w.id IS NULL OR i.id IS NULL THEN
    RETURN 0;
  END IF;
  INSERT INTO public.declutter_wanted_matches (wanted_id, item_id) VALUES (w.id, i.id)
  ON CONFLICT (wanted_id, item_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 0; -- W6: this pair was handled before; never again.
  END IF;

  -- The seller: told when an offer at the buyer's highest price would clear
  -- their own hidden floor (W5). Only the seller ever learns of that test.
  -- W15: the alert never repeats the poster's words; it names the seller's
  -- own listing, so it cannot carry a message from a stranger.
  SELECT p.floor_price_cents INTO v_floor FROM public.declutter_item_private p WHERE p.item_id = i.id;
  IF p_tell_seller IS TRUE AND v_floor IS NOT NULL AND v_floor <= w.max_price_cents
     AND public.declutter_wanted_alert_block(i.seller_id) IS NULL
     -- W7: at most 5 wanted alerts a day per seller ...
     AND (SELECT count(*) FROM public.declutter_wanted_matches m
            JOIN public.declutter_items mi ON mi.id = m.item_id
           WHERE mi.seller_id = i.seller_id AND m.seller_notified_at > now() - interval '1 day') < 5
     -- ... and at most one per poster per seller a week.
     AND NOT EXISTS (SELECT 1 FROM public.declutter_wanted_matches m
                       JOIN public.declutter_items mi ON mi.id = m.item_id
                       JOIN public.declutter_wanted mw ON mw.id = m.wanted_id
                      WHERE mi.seller_id = i.seller_id AND mw.user_id = w.user_id
                        AND m.seller_notified_at > now() - interval '7 days') THEN
    v_n := public.declutter_wanted_notify(i.seller_id,
      'Someone near you wants one',
      'Someone near you wants an item like your "' || i.title || '" for '
        || public.declutter_money_words(w.max_price_cents) || ' or less.',
      '/declutter?tab=wanted&answer=' || w.id::text || '&item=' || i.id::text);
    IF v_n > 0 THEN
      UPDATE public.declutter_wanted_matches SET seller_notified_at = now()
       WHERE wanted_id = w.id AND item_id = i.id;
      v_sent := v_sent + 1;
    END IF;
  END IF;

  -- The poster: told when the item's price today is at or under theirs.
  IF p_tell_poster IS TRUE AND i.current_price_cents <= w.max_price_cents
     AND public.declutter_wanted_alert_block(w.user_id) IS NULL
     AND (SELECT count(*) FROM public.declutter_wanted_matches m
            JOIN public.declutter_wanted mw ON mw.id = m.wanted_id
           WHERE mw.user_id = w.user_id AND m.poster_notified_at > now() - interval '1 day') < 10 THEN
    v_n := public.declutter_wanted_notify(w.user_id,
      'A match for what you want',
      '"' || i.title || '" was just listed near you for ' || public.declutter_money_words(i.current_price_cents) || '.',
      '/declutter/item/' || i.id::text);
    IF v_n > 0 THEN
      UPDATE public.declutter_wanted_matches SET poster_notified_at = now()
       WHERE wanted_id = w.id AND item_id = i.id;
      v_sent := v_sent + 1;
    END IF;
  END IF;
  RETURN v_sent;
END;
$function$;

-- 7. #11: posting takes the wider words. Changed: the words check moved to declutter_wanted_text_problem.
CREATE OR REPLACE FUNCTION public.declutter_create_wanted(p_what text, p_category text, p_max_price_cents integer, p_radius_miles integer, p_lat numeric, p_lng numeric, p_public boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- W8, widened by #11: see declutter_wanted_text_problem.
  IF public.declutter_wanted_text_problem(v_what) IS NOT NULL THEN
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
$function$;

-- 8. #9: edit your own open post. The same checks and caps on words, category, price and distance as posting (the
--    contact filter trigger fires on UPDATE OF what), and matching runs again; pairs already handled stay silent (W6)
--    and the sellers' alert caps still hold. An answer already sent stays as sent.
CREATE OR REPLACE FUNCTION public.declutter_update_wanted(p_wanted_id uuid, p_what text, p_category text, p_max_price_cents integer, p_radius_miles integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_w public.declutter_wanted%ROWTYPE;
  v_what text := btrim(regexp_replace(COALESCE(p_what, ''), '\s+', ' ', 'g'));
  v_told integer := 0;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_w FROM public.declutter_wanted WHERE id = p_wanted_id AND user_id = v_uid AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_w.status <> 'open' OR v_w.expires_at <= now() THEN
    RAISE EXCEPTION 'wanted_not_open' USING ERRCODE = '22023';
  END IF;
  IF public.declutter_wanted_text_problem(v_what) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_wanted_text'
      USING ERRCODE = '22023', HINT = 'Say what you want in 3 to 60 letters, like "crib" or "oak dresser".';
  END IF;
  IF p_category IS NULL OR p_category !~ '^[a-z][a-z0-9_]{1,39}$' THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  IF p_max_price_cents IS NULL OR p_max_price_cents NOT BETWEEN 100 AND 100000 OR p_max_price_cents % 100 <> 0 THEN
    RAISE EXCEPTION 'invalid_max_price'
      USING ERRCODE = '22023', HINT = 'Your highest price must be whole dollars between $1 and $1,000.';
  END IF;
  IF p_radius_miles IS NULL OR p_radius_miles NOT IN (5, 10, 25, 50) THEN
    RAISE EXCEPTION 'invalid_radius' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_wanted
     SET what = v_what, category = p_category, max_price_cents = p_max_price_cents, radius_miles = p_radius_miles::smallint
   WHERE id = p_wanted_id;
  FOR r IN SELECT * FROM public.declutter_wanted_pairs(NULL, p_wanted_id, false) LOOP
    v_told := v_told + public.declutter_wanted_record_match(r.wanted_id, r.item_id, v_told < 20, false);
  END LOOP;
  RETURN p_wanted_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_update_wanted(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_update_wanted(uuid, text, text, integer, integer) TO authenticated, service_role;

-- 9. #9: post a closed or expired post again: another 30 days, under the 10-open cap. Pairs already handled stay silent.
CREATE OR REPLACE FUNCTION public.declutter_reopen_wanted(p_wanted_id uuid)
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_w public.declutter_wanted%ROWTYPE;
  v_until timestamptz := now() + interval '30 days';
  v_told integer := 0;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_post:' || v_uid::text));
  SELECT * INTO v_w FROM public.declutter_wanted WHERE id = p_wanted_id AND user_id = v_uid AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_w.status = 'open' AND v_w.expires_at > now() THEN
    RETURN v_w.expires_at;
  END IF;
  IF (SELECT count(*) FROM public.declutter_wanted w
       WHERE w.user_id = v_uid AND w.status = 'open' AND w.expires_at > now()) >= 10 THEN
    RAISE EXCEPTION 'wanted_open_limit'
      USING ERRCODE = '42501', HINT = 'You have 10 open wanted posts. Close one to post another.';
  END IF;
  UPDATE public.declutter_wanted
     SET status = 'open', closed_at = NULL, expires_at = v_until, expiry_told_at = NULL
   WHERE id = p_wanted_id;
  FOR r IN SELECT * FROM public.declutter_wanted_pairs(NULL, p_wanted_id, false) LOOP
    v_told := v_told + public.declutter_wanted_record_match(r.wanted_id, r.item_id, v_told < 20, false);
  END LOOP;
  RETURN v_until;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_reopen_wanted(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_reopen_wanted(uuid) TO authenticated, service_role;

-- 10. #9: remove your own post from your list. It closes, its photos come off it (the caller deletes the objects, which
--     the storage rule allows once no post holds them), and it can't come back. An answer already sent stays in Buying.
CREATE OR REPLACE FUNCTION public.declutter_remove_wanted(p_wanted_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_paths text[];
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT photo_paths INTO v_paths FROM public.declutter_wanted WHERE id = p_wanted_id AND user_id = v_uid AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.declutter_wanted
     SET status = 'closed', closed_at = COALESCE(closed_at, now()), removed_at = now(), photo_paths = '{}'
   WHERE id = p_wanted_id;
  RETURN v_paths;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_remove_wanted(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_remove_wanted(uuid) TO authenticated, service_role;

-- 11. #9, #19: your list leaves out removed posts, and each reply carries its listing's first photo.
CREATE OR REPLACE FUNCTION public.declutter_my_wanted()
 RETURNS TABLE(id uuid, what text, category text, max_price_cents integer, radius_miles integer, status text, expires_at timestamp with time zone, created_at timestamp with time zone, matches jsonb, public boolean, photo_paths text[], replies jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
           w.public,
           w.photo_paths,
           -- The replies to THIS post (a reply is an offer to the poster, tagged wanted_id): which seller (First L.,
           -- never an id), which listing, what price, and where the offer stands. Blocked either way: left out.
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
                               'offer_id', o.id, 'item_id', o.item_id, 'item_title', i.title,
                               'seller_name', public.member_display_name(sp.full_name),
                               'amount_cents', o.amount_cents, 'status', o.status, 'awaiting', o.awaiting,
                               'created_at', o.created_at,
                               'photo_path', (SELECT ph.storage_path FROM public.declutter_item_photos ph
                                               WHERE ph.item_id = o.item_id ORDER BY ph.position LIMIT 1))
                             ORDER BY o.created_at DESC, o.id)
                       FROM public.declutter_offers o
                       JOIN public.declutter_items i ON i.id = o.item_id
                       LEFT JOIN public.profiles sp ON sp.user_id = o.seller_id
                      WHERE o.wanted_id = w.id
                        AND o.buyer_id = v_uid
                        AND NOT public.are_users_blocked(v_uid, o.seller_id)), '[]'::jsonb)
      FROM public.declutter_wanted w
     WHERE w.user_id = v_uid
       AND w.removed_at IS NULL
     ORDER BY (w.status = 'open' AND w.expires_at > now()) DESC, w.created_at DESC
     LIMIT 50;
END;
$function$;

-- 12. #19: a seller sees all of a post's photos. The return shape grows, so the function is dropped and made again.
DROP FUNCTION IF EXISTS public.declutter_wanted_browse(numeric, numeric);
CREATE FUNCTION public.declutter_wanted_browse(p_lat numeric, p_lng numeric)
 RETURNS TABLE(id uuid, what text, category text, max_price_cents integer, poster_name text, miles integer, expires_at timestamp with time zone, replied boolean, photo_path text, photo_paths text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    SELECT w.id, w.what, w.category, w.max_price_cents, public.member_display_name(pr.full_name),
           public.declutter_wanted_snap_miles(v_lat, v_lng, w.area_lat, w.area_lng),
           w.expires_at,
           EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.wanted_id = w.id AND o.seller_id = v_uid),
           w.photo_paths[1],
           w.photo_paths
      FROM public.declutter_wanted w
      LEFT JOIN public.profiles pr ON pr.user_id = w.user_id
     WHERE w.public
       AND w.status = 'open'
       AND w.expires_at > now()
       AND w.user_id <> v_uid
       AND pr.anonymized_at IS NULL
       AND NOT public.are_users_blocked(v_uid, w.user_id)
       AND NOT public.declutter_member_out(w.user_id)
       AND NOT public.member_under_18(w.user_id)
       AND NOT public.declutter_seller_hidden(w.user_id)
       AND (w.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
       AND public.declutter_wanted_snap_miles(v_lat, v_lng, w.area_lat, w.area_lng) <= w.radius_miles
     ORDER BY 6, w.created_at DESC
     LIMIT 50;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_wanted_browse(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_browse(numeric, numeric) TO authenticated, service_role;

-- 13. #12: which of your listings can answer this post, said before Send. The same one-answer gate as
--     declutter_wanted_reply, so it is no oracle for a post you may not answer, and the same two refusals it would give.
CREATE OR REPLACE FUNCTION public.declutter_my_reply_listings(p_wanted_id uuid)
 RETURNS TABLE(id uuid, title text, current_price_cents integer, refuses text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  w public.declutter_wanted%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  SELECT * INTO w FROM public.declutter_wanted d WHERE d.id = p_wanted_id;
  IF w.id IS NULL OR NOT w.public OR w.status <> 'open' OR w.expires_at <= now() OR w.user_id = v_uid
     OR public.are_users_blocked(v_uid, w.user_id)
     OR public.declutter_member_out(w.user_id)
     OR public.member_under_18(w.user_id)
     OR public.declutter_seller_hidden(w.user_id)
     OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())) THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT i.id, i.title, i.current_price_cents,
           CASE
             WHEN (public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng) <= w.radius_miles) IS NOT TRUE THEN 'too_far'
             WHEN EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.item_id = i.id AND o.status = 'open') THEN 'open_offer'
           END
      FROM public.declutter_items i
     WHERE i.seller_id = v_uid
       AND i.status = 'live'
       AND NOT (i.is_seed IS TRUE AND public.seed_hidden_for(w.user_id))
     ORDER BY i.created_at DESC, i.id
     LIMIT 100;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_my_reply_listings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_reply_listings(uuid) TO authenticated, service_role;

-- 14. #9: a reminder 3 days before a post ends, once per post. Added to the sweep ahead of its queue; the switch-off
--     branch and the queue loop are the prod definition. One failed reminder never stops the matching.
CREATE OR REPLACE FUNCTION public.declutter_wanted_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  q record;
  e record;
  v_items integer := 0;
  v_alerts integer := 0;
  v_failed integer := 0;
BEGIN
  -- Nobody can have the feature while either switch is off: empty the queue
  -- (a listing that goes live again later is queued again).
  IF NOT EXISTS (SELECT 1 FROM public.feature_switches s
                  WHERE s.key = 'declutter_wanted' AND s.audience IN ('testers', 'everyone'))
     OR NOT EXISTS (SELECT 1 FROM public.feature_switches s
                     WHERE s.key = 'declutter' AND s.audience IN ('testers', 'everyone')) THEN
    DELETE FROM public.declutter_wanted_queue;
    RETURN jsonb_build_object('items', 0, 'alerts', 0, 'failed', 0, 'switch', 'off');
  END IF;
  FOR e IN SELECT w.id, w.user_id, w.what FROM public.declutter_wanted w
            WHERE w.status = 'open' AND w.removed_at IS NULL AND w.expiry_told_at IS NULL
              AND w.expires_at > now() AND w.expires_at <= now() + interval '3 days'
            ORDER BY w.expires_at, w.id LIMIT 200 LOOP
    BEGIN
      UPDATE public.declutter_wanted SET expiry_told_at = now() WHERE id = e.id;
      IF public.declutter_wanted_alert_block(e.user_id) IS NULL THEN
        v_alerts := v_alerts + public.declutter_wanted_notify(e.user_id,
          'Your Wanted ends soon',
          'Your Wanted for "' || e.what || '" ends within 3 days. You can post it again from the Wanted tab once it ends.',
          '/declutter?tab=wanted');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_wanted_sweep', 'expiry:' || e.id::text, SQLERRM);
    END;
  END LOOP;
  FOR q IN SELECT * FROM public.declutter_wanted_queue ORDER BY queued_at, item_id LIMIT 200 LOOP
    BEGIN
      v_alerts := v_alerts + public.declutter_wanted_match_item(q.item_id);
      DELETE FROM public.declutter_wanted_queue WHERE item_id = q.item_id;
      v_items := v_items + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      IF q.attempts + 1 >= 12 THEN
        -- Out of tries: drop the row (so a later go-live queues it afresh)
        -- and say so plainly.
        DELETE FROM public.declutter_wanted_queue WHERE item_id = q.item_id;
        PERFORM public.log_cron_defect('declutter_wanted_sweep', q.item_id::text,
          'gave up after 12 tries, no wanted alerts for this listing: ' || SQLERRM);
      ELSE
        UPDATE public.declutter_wanted_queue SET attempts = attempts + 1 WHERE item_id = q.item_id;
        PERFORM public.log_cron_defect('declutter_wanted_sweep', q.item_id::text, SQLERRM);
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('items', v_items, 'alerts', v_alerts, 'failed', v_failed);
END;
$function$;
