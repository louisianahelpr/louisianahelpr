-- Q2390 packet 8: "not found" answers HTTP 404, not 500, for seventeen small
-- member-callable functions (shop settings, Declutter wanted posts, questions,
-- porch days, a Homes unit). None moves money or deletes rows.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-02, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   shops_set_handover_mode            20261018211820 199a74b1349cc26daa1bd2c3a654728f
--   shops_confirm_cottage_year         20261017061157 0d99644b22b2190610bc78f48e5a8585
--   shops_set_paused                   20261017061155 89f2f76521fc2b3b9ec3b8e7faf1e34c
--   shops_set_daily_order_cap          20261017061157 81f56badbfb9bd0ec7f332fee9168fa2
--   shops_set_ready_tap_cancel         20261019015018 1bfddd83b22711810dbae674cec88ac1
--   shops_set_cancel_policy            20261018164442 cf23cbd402364e7555d4d30076d24e2d
--   declutter_set_wanted_public        20261021031757 206fb267cb1a068d52a3b443437814f7
--   declutter_answer_question          20261014193955 6b4e0db785c9a3a7fec9ccd41e56cc8a
--   declutter_remove_wanted_photo      20261030064727 62fd878b861a48c6f4ae1faa639c5ac3
--   declutter_close_wanted             20261016053541 532d093c339fd89e51753ab868ee7cf0
--   declutter_reopen_listing           20261028180400 65b3639f8967d32f6bf708e255471a7e
--   declutter_delivery_open_times      20261027153244 022e2e3b17130103cc5e2e3c43eaff09
--   declutter_remove_wanted            20261030221255 57abac8e8cde88fdc4fda164d8d9075f
--   declutter_free_requests_for_item   20261101174857 2f9c74e0e2cd0f64f144d1c5f39a4bbc
--   declutter_set_porch_ok             20261017055504 e12c3470033775d775a5f7d3c6d88bc1
--   declutter_porch_days               20261030164712 e9a967add53550c1773587cb0cef3c78
--   rentals_add_unit                   20261017205605 5f30b4ea92a71a980dd28aee86adef86
-- The ONLY change is one not-found ERRCODE 'P0002' -> 'PT404' in each. Messages
-- and control flow are unchanged. Grants restated as on prod (proacl: postgres,
-- authenticated, service_role).

CREATE OR REPLACE FUNCTION public.shops_set_handover_mode(p_mode text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  IF p_mode IS NULL OR p_mode NOT IN ('porch', 'in_person') THEN
    RAISE EXCEPTION 'invalid_handover_mode' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops SET handover_mode = p_mode, updated_at = now() WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN p_mode;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_set_handover_mode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_handover_mode(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_confirm_cottage_year()
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_year smallint := public.shop_cottage_year();
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  IF NOT EXISTS (SELECT 1 FROM public.shops WHERE owner_id = v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO public.shop_cottage_confirmations (owner_id, limit_year) VALUES (v_uid, v_year)
  ON CONFLICT (owner_id, limit_year) DO NOTHING;
  RETURN v_year;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_confirm_cottage_year() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_confirm_cottage_year() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_set_paused(p_paused boolean)
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
  IF p_paused IS NULL THEN
    RAISE EXCEPTION 'invalid_paused' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops SET paused = p_paused, updated_at = now() WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN p_paused;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_set_paused(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_paused(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_set_daily_order_cap(p_cap integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  IF p_cap IS NOT NULL AND p_cap NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_daily_cap' USING ERRCODE = '22023', HINT = 'Between 1 and 200 orders a day.';
  END IF;
  UPDATE public.shops SET daily_order_cap = p_cap, updated_at = now() WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN p_cap;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_set_daily_order_cap(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_daily_order_cap(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_set_ready_tap_cancel(p_choice text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  IF p_choice IS NULL OR p_choice NOT IN ('ends_at_tap', 'from_day_before', 'never_shortens') THEN
    RAISE EXCEPTION 'invalid_ready_tap_cancel' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops SET ready_tap_cancel = p_choice, updated_at = now() WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN p_choice;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_set_ready_tap_cancel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_ready_tap_cancel(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_set_cancel_policy(p_policy text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  IF p_policy IS NULL OR p_policy NOT IN ('until_24h_before_ready', 'until_accept', 'until_handover') THEN
    RAISE EXCEPTION 'invalid_cancel_policy' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops SET cancel_policy = p_policy, updated_at = now() WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN p_policy;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_set_cancel_policy(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_cancel_policy(text) TO authenticated, service_role;

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
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN COALESCE(p_public, false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_wanted_public(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_wanted_public(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_answer_question(p_question_id uuid, p_answer text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_at timestamptz;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  UPDATE public.declutter_questions q
     SET answer = btrim(p_answer), answered_at = now()
    FROM public.declutter_items i
   WHERE q.id = p_question_id
     AND i.id = q.item_id
     AND i.seller_id = v_uid
     AND q.removed_at IS NULL
  RETURNING q.answered_at INTO v_at;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'question_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_at;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_answer_question(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_question(uuid, text) TO authenticated, service_role;

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
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  UPDATE public.declutter_wanted SET photo_paths = array_remove(photo_paths, p_storage_path) WHERE id = p_wanted_id;
  RETURN cardinality(array_remove(v_w.photo_paths, p_storage_path));
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_remove_wanted_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_remove_wanted_photo(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_close_wanted(p_wanted_id uuid)
RETURNS text
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
  -- A banned member's posts already match nothing (declutter_member_out).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  UPDATE public.declutter_wanted
     SET status = 'closed', closed_at = COALESCE(closed_at, now())
   WHERE id = p_wanted_id AND user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN 'closed';
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_close_wanted(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_close_wanted(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_reopen_listing(p_item_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status <> 'withdrawn' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  UPDATE public.declutter_items SET status = 'draft', updated_at = now() WHERE id = p_item_id;
  RETURN 'draft';
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_reopen_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_reopen_listing(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_delivery_open_times(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'seller_delivery' THEN
    RAISE EXCEPTION 'not_a_seller_delivery' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object(
    'slot_minutes', (public.declutter_seller_delivery_rules() ->> 'slot_minutes')::integer,
    'slots', to_jsonb(ARRAY(SELECT s FROM public.declutter_delivery_open_slots(o.seller_id, o.id) s)));
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_delivery_open_times(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_open_times(uuid) TO authenticated, service_role;

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
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'PT404';
  END IF;
  UPDATE public.declutter_wanted
     SET status = 'closed', closed_at = COALESCE(closed_at, now()), removed_at = now(), photo_paths = '{}'
   WHERE id = p_wanted_id;
  RETURN v_paths;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_remove_wanted(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_remove_wanted(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_free_requests_for_item(p_item_id uuid)
 RETURNS TABLE(request_id uuid, requester_id uuid, display_name text, avg_rating numeric, review_count integer, created_at timestamptz, pickup_at timestamptz)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN QUERY
    SELECT r.id, r.requester_id, public.member_display_name(p.full_name, 'A neighbor'),
           s.avg_rating, s.review_count, r.created_at, r.pickup_at
      FROM public.declutter_free_requests r
      LEFT JOIN public.profiles p ON p.user_id = r.requester_id
      LEFT JOIN LATERAL (SELECT g.avg_rating, g.review_count FROM public.get_public_profile_stats(ARRAY[r.requester_id]) g LIMIT 1) s ON true
     WHERE r.item_id = p_item_id AND r.status = 'open'
       AND NOT public.are_users_blocked(v_uid, r.requester_id)
     ORDER BY r.created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_free_requests_for_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_free_requests_for_item(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_porch_ok(p_item_id uuid, p_porch_ok boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());
  IF p_porch_ok IS NULL THEN
    RAISE EXCEPTION 'invalid_porch_choice' USING ERRCODE = '22023';
  END IF;

  SELECT i.status INTO v_status FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  UPDATE public.declutter_items SET porch_ok = p_porch_ok, updated_at = now()
   WHERE id = p_item_id AND seller_id = v_uid;
  RETURN p_porch_ok;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_porch_ok(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_porch_ok(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_porch_days(p_order_id uuid)
RETURNS SETOF date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.id IS NULL OR public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT d::date
      FROM generate_series(v_today, v_today + 7, interval '1 day') d
     WHERE (d::date::timestamp AT TIME ZONE 'America/Chicago') < o.paid_at + interval '7 days'
       AND public.declutter_order_is_porch_day(o.id, extract(dow FROM d::date)::smallint)
     ORDER BY 1;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_porch_days(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_days(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_add_unit(p_property_id uuid, p_label text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  PERFORM 1 FROM public.rental_properties WHERE id = p_property_id AND owner_id = v_uid FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF (SELECT count(*) FROM public.rental_units WHERE property_id = p_property_id) >= 200 THEN
    RAISE EXCEPTION 'too_many_units' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rental_units (property_id, owner_id, label)
  VALUES (p_property_id, v_uid, btrim(p_label))
  ON CONFLICT (property_id, label) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'unit_exists' USING ERRCODE = '22023';
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_add_unit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_add_unit(uuid, text) TO authenticated, service_role;

