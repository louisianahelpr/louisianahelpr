-- Q2390 packet 20 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for five functions that still raised P0002:
--   shops_set_follow                 (follow a shop; raise before the INSERT; unfollow never raises)
--   declutter_set_watch              (watch an item; raise before the INSERT; unwatch never raises)
--   shops_record_item_ai_check       (service_role; declutter-ai-draft records a shop item verdict;
--                                     raise after SELECT ... FOR UPDATE, before the UPDATE)
--   declutter_wanted_hold_photos     (service_role; holds Wanted photos; raise before its UPDATE/INSERT)
--   declutter_record_wanted_ai_check (service_role; declutter-ai-draft records a Wanted verdict;
--                                     raise before any write and before it calls
--                                     declutter_wanted_hold_photos, its only SQL caller)
-- declutter-ai-draft reads only the message of these two refusals (500
-- ai_unavailable, or 409 for ai_check_stale), never the SQLSTATE, so it needs no
-- map change. The app maps the member-facing ones by message (rpcErrorCopy,
-- lifecycleErrors). None creates an order, moves money or calls pg_net itself.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   shops_set_follow                       20261017061155 959b77e73e6210a8ff22b5becfd8e1b3
--   declutter_set_watch                    20261020033623 e6fd5b36f2a562f57ad62e7e5ea42a1b
--   shops_record_item_ai_check             20261017061157 e6a303a3cca75ec50d9bc153d218a651
--   declutter_wanted_hold_photos           20261030225143 1770a10134085fbd27a9042de3e12fd6
--   declutter_record_wanted_ai_check       20261030225143 f1e52ed65a2d79b9579220370ac48847
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (5 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.shops_set_follow(p_shop_id uuid, p_follow boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_follow IS NULL THEN
    RAISE EXCEPTION 'invalid_follow' USING ERRCODE = '22023';
  END IF;
  -- Unfollow needs no visibility: a member can always drop their own follow,
  -- even once the shop is hidden or its owner banned (review finding 1). It
  -- deletes only the caller's own row and answers the same either way.
  IF NOT p_follow THEN
    DELETE FROM public.shop_follows WHERE user_id = v_uid AND shop_id = p_shop_id;
    RETURN false;
  END IF;
  IF NOT public.shop_visible_to(p_shop_id, v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop_id AND s.owner_id = v_uid) THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shop_follows (user_id, shop_id) VALUES (v_uid, p_shop_id)
  ON CONFLICT (user_id, shop_id) DO NOTHING;
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_set_follow(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_follow(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_watch(p_item_id uuid, p_watch boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_seller uuid;
  v_seed boolean;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(false);
  v_uid := (SELECT auth.uid());

  IF p_watch IS NOT TRUE THEN
    DELETE FROM public.declutter_watchlist WHERE user_id = v_uid AND item_id = p_item_id;
    RETURN 'not_watching';
  END IF;
  SELECT seller_id, is_seed INTO v_seller, v_seed FROM public.declutter_items
   WHERE id = p_item_id AND status IN ('live', 'reserved');
  -- A member the seller blocked (or who blocked the seller) does not see
  -- the item to act on it; nor does a real member a test listing.
  IF NOT FOUND OR public.are_users_blocked(v_seller, v_uid)
     OR (v_seed AND public.seed_hidden_for(v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.declutter_watchlist (user_id, item_id) VALUES (v_uid, p_item_id)
  ON CONFLICT (user_id, item_id) DO NOTHING;
  RETURN 'watching';
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_set_watch(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_watch(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_record_item_ai_check(
  p_item_id uuid,
  p_owner_id uuid,
  p_judged_photo_ids uuid[],
  p_judged_kind text,
  p_judged_subtype text,
  p_judged_title text,
  p_judged_description text,
  p_flag_reason text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_item public.shop_items%ROWTYPE;
  v_current uuid[];
  v_at timestamptz := now();
BEGIN
  SELECT * INTO v_item FROM public.shop_items
   WHERE id = p_item_id AND owner_id = p_owner_id AND status = 'draft' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_current
    FROM public.shop_item_photos WHERE item_id = p_item_id;
  IF v_current IS DISTINCT FROM (SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(p_judged_photo_ids) AS x)
     OR v_item.kind IS DISTINCT FROM p_judged_kind
     OR v_item.subtype IS DISTINCT FROM p_judged_subtype
     OR v_item.title IS DISTINCT FROM p_judged_title
     OR v_item.description IS DISTINCT FROM p_judged_description THEN
    RAISE EXCEPTION 'ai_check_stale' USING ERRCODE = '40001';
  END IF;
  UPDATE public.shop_item_private
     SET ai_checked_at = v_at,
         ai_flag_reason = NULLIF(left(btrim(COALESCE(p_flag_reason, '')), 300), ''),
         updated_at = v_at
   WHERE item_id = p_item_id;
  RETURN v_at;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_wanted_hold_photos(p_wanted_id uuid, p_paths text[], p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  w public.declutter_wanted%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  UPDATE public.declutter_wanted d
     SET photos_held = d.photos_held || ARRAY(
       SELECT p.path FROM unnest(d.photo_paths) AS p(path)
        WHERE NOT p.path = ANY (d.photos_cleared) AND NOT p.path = ANY (d.photos_held)
          AND (p_paths IS NULL OR p.path = ANY (p_paths)))
   WHERE d.id = p_wanted_id;
  IF w.is_seed IS NOT TRUE AND NOT EXISTS (
       SELECT 1 FROM public.reports r
        WHERE r.reported_type = 'declutter_wanted' AND r.reported_id = p_wanted_id AND r.reporter_id IS NULL
          AND r.status IN ('pending', 'new', 'investigating')) THEN
    INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason, description, status)
    VALUES (NULL, 'declutter_wanted', p_wanted_id, 'Automatic photo check', left(btrim(COALESCE(p_reason, '')), 300), 'pending');
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_wanted_hold_photos(uuid, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_hold_photos(uuid, text[], text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_record_wanted_ai_check(p_wanted_id uuid, p_user_id uuid, p_judged_paths text[], p_flag_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_flag text := NULLIF(left(btrim(COALESCE(p_flag_reason, '')), 300), '');
BEGIN
  PERFORM 1 FROM public.declutter_wanted
    WHERE id = p_wanted_id AND user_id = p_user_id AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_flag IS NOT NULL THEN
    PERFORM public.declutter_wanted_hold_photos(p_wanted_id, COALESCE(p_judged_paths, ARRAY[]::text[]), v_flag);
    RETURN 'held';
  END IF;
  UPDATE public.declutter_wanted d
     SET photos_cleared = d.photos_cleared || ARRAY(
       SELECT p.path FROM unnest(d.photo_paths) AS p(path)
        WHERE p.path = ANY (COALESCE(p_judged_paths, ARRAY[]::text[]))
          AND NOT p.path = ANY (d.photos_cleared) AND NOT p.path = ANY (d.photos_held))
   WHERE d.id = p_wanted_id;
  RETURN 'cleared';
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_record_wanted_ai_check(uuid, uuid, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_wanted_ai_check(uuid, uuid, text[], text) TO service_role;

