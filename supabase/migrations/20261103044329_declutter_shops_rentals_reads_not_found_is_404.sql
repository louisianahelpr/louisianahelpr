-- Q2390 packet 6: "not found" answers HTTP 404, not 500, for eleven small
-- member-callable functions (eight read-only, three that only set a status).
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-02, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod):
--   declutter_my_item_review         ec5be4675d912f0ed65c6c61610b9fb7 (20261014200728)
--   declutter_withdraw_free_request  4126eafbf6fb4234c88ca4e8d86ae8d3 (20261030064021)
--   rentals_withdraw_request         1f61124cea3086f5f184eff7dc46d5f8 (20261017205605)
--   declutter_seller_item_private    8b17c1754d9d5d1485aa22229de869aa (20261029170419; CREATE OR REPLACE here)
--   shops_my_item_review             0acd4317bc54434d5ef63544610ee6a9 (20261017061157)
--   declutter_keep_up_state          d723851f576c290733d140e80f317bd2 (20261029154323)
--   declutter_listing_manage_state   4608beca21677d9b5bc3803a94e00182 (20261020064354)
--   declutter_remove_my_meetup_spot  762f1c4ded0c1b90b70376f1cda2ab23 (20261101194608)
--   declutter_auto_free_state        f1630c25de8392ac3c2c8ff5edee549c (20261030030408)
--   declutter_auto_free_days_state   009a977e30257b185ff6a014fc51bb22 (20261030030408)
--   rentals_my_listing_photos        c7bb3f377ea0a0d3f5125b67d4f25a62 (20261019071203)
-- The ONLY change is one not-found ERRCODE 'P0002' -> 'PT404' in each. Messages
-- and control flow are unchanged. Grants restated as on prod (proacl: postgres,
-- authenticated, service_role).

CREATE OR REPLACE FUNCTION public.declutter_my_item_review(p_item_id uuid)
RETURNS TABLE(review_note text, ai_flagged boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  RETURN QUERY
    SELECT p.review_note, (p.ai_flag_reason IS NOT NULL)
      FROM public.declutter_item_private p
     WHERE p.item_id = p_item_id
       AND p.seller_id = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_my_item_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_item_review(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_withdraw_free_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.declutter_free_requests SET status = 'withdrawn', closed_at = now()
   WHERE id = p_request_id AND requester_id = v_uid AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_withdraw_free_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_free_request(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_withdraw_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.maintenance_requests SET status = 'withdrawn', decided_at = now(), updated_at = now()
   WHERE id = p_request_id AND tenant_id = v_uid AND status = 'submitted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_withdraw_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_withdraw_request(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_seller_item_private(p_item_id uuid)
RETURNS TABLE(floor_price_cents integer, pickup_address text, pickup_lat numeric, pickup_lng numeric, auto_offers boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.declutter_in_agreed_sale(p_item_id, (SELECT auth.uid())) THEN
    PERFORM public.require_feature('declutter');
  END IF;
  RETURN QUERY
    SELECT p.floor_price_cents, p.pickup_address, p.pickup_lat, p.pickup_lng, p.auto_offers
      FROM public.declutter_item_private p
     WHERE p.item_id = p_item_id
       AND p.seller_id = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_seller_item_private(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_item_private(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_my_item_review(p_item_id uuid)
RETURNS TABLE(review_note text, ai_checked boolean, ai_flagged boolean, text_flagged boolean, attested boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('shops');
  RETURN QUERY
    SELECT p.review_note, (p.ai_checked_at IS NOT NULL), (p.ai_flag_reason IS NOT NULL), (p.text_flag_reason IS NOT NULL),
           EXISTS (SELECT 1 FROM public.shop_item_attestations a WHERE a.item_id = p.item_id)
      FROM public.shop_item_private p
     WHERE p.item_id = p_item_id
       AND p.owner_id = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_my_item_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_item_review(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_keep_up_state(p_item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_on boolean;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT p.keep_up_until_sold INTO v_on
    FROM public.declutter_item_private p JOIN public.declutter_items i ON i.id = p.item_id
   WHERE p.item_id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_on;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_keep_up_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_keep_up_state(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_listing_manage_state(p_item_id uuid)
RETURNS TABLE(floor_price_cents integer, drops_stopped boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN QUERY
    SELECT p.floor_price_cents, p.drops_stopped
      FROM public.declutter_item_private p
     WHERE p.item_id = p_item_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_listing_manage_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_listing_manage_state(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_remove_my_meetup_spot(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  UPDATE public.declutter_meetup_spots s SET active = false, updated_at = now()
   WHERE s.id = p_id AND s.seller_id = v_uid AND s.active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meetup_spot_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_remove_my_meetup_spot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_remove_my_meetup_spot(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_auto_free_state(p_item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_on boolean;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT p.auto_free_days IS NOT NULL INTO v_on
    FROM public.declutter_item_private p JOIN public.declutter_items i ON i.id = p.item_id
   WHERE p.item_id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_on;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_auto_free_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_auto_free_state(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_auto_free_days_state(p_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_days integer;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT p.auto_free_days INTO v_days
    FROM public.declutter_item_private p JOIN public.declutter_items i ON i.id = p.item_id
   WHERE p.item_id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_days; -- NULL = Never
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_auto_free_days_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_auto_free_days_state(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_my_listing_photos(p_listing_id uuid)
RETURNS TABLE (id uuid, "position" smallint, ref text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rental_listings l WHERE l.id = p_listing_id AND l.owner_id = v_uid) THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN QUERY
  SELECT ph.id, ph.position, public.rentals_photo_ref(ph.id, 'o')
    FROM public.rental_listing_photos ph
   WHERE ph.listing_id = p_listing_id
   ORDER BY ph.position;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_my_listing_photos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_my_listing_photos(uuid) TO authenticated, service_role;

