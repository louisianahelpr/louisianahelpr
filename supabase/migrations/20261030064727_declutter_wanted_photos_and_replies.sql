-- Declutter Wanted hub (owner 2026-10-30, via the lead; plan approved by the lead the same day):
--   1. PHOTOS on a Wanted post: optional, at most 3, like a quick listing. Stored as paths on the post
--      (declutter_wanted.photo_paths) so export_my_data, which exports declutter_wanted with to_jsonb(t), carries them
--      with no restate. Objects live in the public job-photos bucket under the poster's own folder:
--      <uid>/wanted/<wanted_id>/<file>. The bucket's existing INSERT policy already lets a member upload under
--      <uid>/; the app strips EXIF and location before upload (cleanListingPhoto, as for listings).
--      declutter_add_wanted_photo / declutter_remove_wanted_photo mirror declutter_add_item_photo (prod md5
--      4850dc97..., read 2026-10-30): owner only, the path is the caller's own folder for THIS post, the object is
--      really there, uploaded by the caller, an image, 1 byte to 15 MB.
--      A new DELETE policy lets the owner remove their own UNATTACHED Wanted photo objects (as for listings).
--   2. REPLIES on your own posts: a reply is a declutter_offers row tagged wanted_id (20261021031757). Neither
--      declutter_my_offers nor declutter_my_wanted returned them, so the poster had no list of "which seller, which
--      listing, what price". declutter_my_wanted gains `replies` (caller's own posts only, as today) and
--      `photo_paths`.
--   3. declutter_wanted_browse gains `photo_path` (the post's first photo) for "Wanted near you" cards. Same
--      exclusions, still never an address, coordinates or a user id.
-- Restated VERBATIM from prod's effective bodies (pg_get_functiondef, read 2026-10-30), plus only the additions above:
--   declutter_my_wanted      prosrc md5 a094d741534a000432f3aabae2b17422
--   declutter_wanted_browse  prosrc md5 a7fc1c15ac89b9792954a6f8c378aff0
-- A new RETURNS TABLE needs DROP + CREATE; grants restated as live (authenticated, service_role; never anon).
-- Replay-safe: IF [NOT] EXISTS everywhere, DROP ... IF EXISTS before each CREATE.

ALTER TABLE public.declutter_wanted ADD COLUMN IF NOT EXISTS photo_paths text[] NOT NULL DEFAULT '{}'::text[];
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_wanted_photo_paths_max3') THEN
    ALTER TABLE public.declutter_wanted
      ADD CONSTRAINT declutter_wanted_photo_paths_max3 CHECK (cardinality(photo_paths) <= 3);
  END IF;
END
$do$;
COMMENT ON COLUMN public.declutter_wanted.photo_paths IS
  'Owner 2026-10-30: up to 3 photos of what the poster is looking for, job-photos paths <uid>/wanted/<wanted_id>/<file>. Written only by declutter_add_wanted_photo / declutter_remove_wanted_photo.';

-- 1a. Add one photo to your own open Wanted post.
CREATE OR REPLACE FUNCTION public.declutter_add_wanted_photo(p_wanted_id uuid, p_storage_path text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_w public.declutter_wanted%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT * INTO v_w FROM public.declutter_wanted WHERE id = p_wanted_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_w.status <> 'open' OR v_w.expires_at <= now() THEN
    RAISE EXCEPTION 'wanted_not_open' USING ERRCODE = '22023';
  END IF;
  -- The path is the caller's own folder for THIS post, and the object is really there, uploaded by the caller.
  IF p_storage_path IS NULL
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_storage_path, '/', 2) IS DISTINCT FROM 'wanted'
     OR split_part(p_storage_path, '/', 3) IS DISTINCT FROM p_wanted_id::text
     OR split_part(p_storage_path, '/', 4) = ''
     OR split_part(p_storage_path, '/', 5) <> ''
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          -- Images only: job-photos also takes video, and a video keeps its GPS atoms (the app's re-encode strips
          -- images only).
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF p_storage_path = ANY (v_w.photo_paths) THEN
    RETURN cardinality(v_w.photo_paths);
  END IF;
  IF cardinality(v_w.photo_paths) >= 3 THEN
    RAISE EXCEPTION 'wanted_too_many_photos' USING ERRCODE = '22023', HINT = 'A Wanted post has at most 3 photos.';
  END IF;

  UPDATE public.declutter_wanted SET photo_paths = photo_paths || p_storage_path WHERE id = p_wanted_id;
  RETURN cardinality(v_w.photo_paths) + 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_add_wanted_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_add_wanted_photo(uuid, text) TO authenticated, service_role;

-- 1b. Take one photo off your own Wanted post (any status). The app then deletes the object (policy below).
CREATE OR REPLACE FUNCTION public.declutter_remove_wanted_photo(p_wanted_id uuid, p_storage_path text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_w public.declutter_wanted%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_w FROM public.declutter_wanted WHERE id = p_wanted_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.declutter_wanted SET photo_paths = array_remove(photo_paths, p_storage_path) WHERE id = p_wanted_id;
  RETURN cardinality(array_remove(v_w.photo_paths, p_storage_path));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_remove_wanted_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_remove_wanted_photo(uuid, text) TO authenticated, service_role;

-- 1c. The owner deletes their own Wanted photo objects once no post holds them (as for listing photos).
DROP POLICY IF EXISTS "Owners delete own unattached wanted photos" ON storage.objects;
CREATE POLICY "Owners delete own unattached wanted photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[2] = 'wanted'
    AND NOT EXISTS (SELECT 1 FROM public.declutter_wanted w WHERE objects.name = ANY (w.photo_paths))
  );

-- 2. Your own Wanted posts, now with their photos and the replies sellers sent (restated from prod a094d741...).
DROP FUNCTION IF EXISTS public.declutter_my_wanted();
CREATE FUNCTION public.declutter_my_wanted()
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
                               'created_at', o.created_at)
                             ORDER BY o.created_at DESC, o.id)
                       FROM public.declutter_offers o
                       JOIN public.declutter_items i ON i.id = o.item_id
                       LEFT JOIN public.profiles sp ON sp.user_id = o.seller_id
                      WHERE o.wanted_id = w.id
                        AND o.buyer_id = v_uid
                        AND NOT public.are_users_blocked(v_uid, o.seller_id)), '[]'::jsonb)
      FROM public.declutter_wanted w
     WHERE w.user_id = v_uid
     ORDER BY (w.status = 'open' AND w.expires_at > now()) DESC, w.created_at DESC
     LIMIT 50;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_my_wanted() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_wanted() TO authenticated, service_role;

-- 3. Wanted near you, now with each post's first photo (restated from prod a7fc1c15...).
DROP FUNCTION IF EXISTS public.declutter_wanted_browse(numeric, numeric);
CREATE FUNCTION public.declutter_wanted_browse(p_lat numeric, p_lng numeric)
 RETURNS TABLE(id uuid, what text, category text, max_price_cents integer, poster_name text, miles integer, expires_at timestamp with time zone, replied boolean, photo_path text)
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
           w.photo_paths[1]
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

-- 4. "I have this" (audit W6 + W7, 2026-10-30): restated from prod's effective body (pg_get_functiondef, prosrc md5
--    5acdb38a97da13191ef4544dc7eb41fa, read 2026-10-30), with only these two changes:
--    W6: the listing must be inside the post's distance. A 25-mile post took a 50-mile listing while the sheet said
--        ~2 mi (the sheet measures the seller's browse point, not the listing). Same measure as the match alerts
--        (declutter_wanted_pairs: declutter_miles(post area, listing area) <= radius_miles). Checked only AFTER the
--        one-answer wanted_not_found gate, so it says nothing about private, blocked or hidden posts.
--    W7: any listing that is for sale now can answer, not only sale_mode 'offers' (the only other mode, 'auction', has
--        no logic and no rows; a Buy-only listing could already answer, since the answer is the seller's own counter).
--        The sale_mode_unavailable refusal is removed from this function only.
CREATE OR REPLACE FUNCTION public.declutter_wanted_reply(p_wanted_id uuid, p_item_id uuid, p_amount_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  SELECT it.id, it.seller_id, it.status, it.sale_mode, it.current_price_cents, it.title, it.is_seed,
         it.area_lat, it.area_lng INTO i
    FROM public.declutter_items it WHERE it.id = p_item_id AND it.seller_id = v_uid FOR UPDATE;
  IF i.id IS NULL OR i.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id FOR UPDATE;
  -- One answer for every post you may not reply to: no oracle for private, blocked or hidden posts.
  IF w.id IS NULL OR NOT w.public OR w.status <> 'open' OR w.expires_at <= now() OR w.user_id = v_uid
     OR public.are_users_blocked(v_uid, w.user_id)
     OR public.declutter_member_out(w.user_id)
     OR public.member_under_18(w.user_id)
     OR public.declutter_seller_hidden(w.user_id)
     OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())) THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF i.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'Only a listing that is for sale now can answer.';
  END IF;
  IF i.is_seed IS TRUE AND public.seed_hidden_for(w.user_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- W6: inside the post's distance, measured listing to post (as the match alerts do). IS NOT TRUE: a NULL distance
  -- refuses, never skips the RAISE.
  IF (public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng) <= w.radius_miles) IS NOT TRUE THEN
    RAISE EXCEPTION 'listing_too_far' USING ERRCODE = '22023',
      HINT = 'This listing is farther away than the buyer will travel.';
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
  -- At most 5 answers a day per POST (lead ruling on review N1, 10-21): a per-poster refusal would tell a seller that
  -- two posts share one poster. With at most 10 open posts a poster, that still bounds every later notice the offer
  -- paths send (expiry, voided, closed); the per-poster bound is the silent alert cap below.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_post_answers:' || w.id::text));
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.wanted_id = w.id AND o.created_at > now() - interval '24 hours') >= 5 THEN
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
  -- At most 5 "match" alerts a day per poster (this one included), silently: later answers still arrive as offers,
  -- and nothing the seller sees depends on it.
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.buyer_id = w.user_id AND o.wanted_id IS NOT NULL AND o.created_at > now() - interval '24 hours') <= 5 THEN
    PERFORM public.declutter_notify(w.user_id, 'new_offers', 'A seller has a match',
      format('A seller near you has "%s" for $%s, at or under your Wanted price. Accept, counter or decline within 48 hours.',
             i.title, to_char(p_amount_cents / 100.0, 'FM999990.00')),
      '/declutter?view=offers', v_uid);
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_wanted_reply(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_reply(uuid, uuid, integer) TO authenticated, service_role;
