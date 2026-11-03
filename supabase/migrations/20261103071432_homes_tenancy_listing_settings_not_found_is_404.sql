-- Q2390 packet 16 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for six Homes member actions:
--   rentals_end_tenancy             (landlord ends a tenancy: UPDATE ... IF NOT FOUND raise)
--   rentals_set_auto_approve        (landlord's repair auto-approve limit, a setting; no money moves)
--   rentals_approve_request         (landlord approves a repair request, then notifies)
--   rentals_set_forwarding_address  (tenant's deposit forwarding address)
--   rentals_set_saved_home          (member saves / unsaves a listing; the unsave DELETE path returns before the raise)
--   rentals_remove_listing_photo    (owner removes a listing photo; the raise fires before the DELETE)
-- In each, the not-found raise fires before any write, or right after an
-- UPDATE that matched no row (the raise rolls back nothing). None creates an
-- order, moves money or calls pg_net; no edge function calls them, and no SQL
-- function calls them. EXECUTE to authenticated and service_role, as on prod.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   rentals_end_tenancy                    20261017205605 889f8abf03688f5c71770a03dd72190a
--   rentals_set_auto_approve               20261017205605 a924b792fa9a7902ee35529ee1edb0fb
--   rentals_approve_request                20261017205605 b1c9cc029e5bd1106f7fc1eba58b0ab2
--   rentals_set_forwarding_address         20261019082216 bb8d510f191c8dfaa7f2cc490449d217
--   rentals_set_saved_home                 20261019185722 a30a396bd67fc6419077d27abf38eda0
--   rentals_remove_listing_photo           20261019061241 4f65672eb7285d24ba6bfb32cb586b87
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (6 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.rentals_end_tenancy(p_tenancy_id uuid)
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
  UPDATE public.rental_tenancies
     SET status = CASE WHEN status = 'invited' THEN 'revoked' ELSE 'ended' END, ended_at = now()
   WHERE id = p_tenancy_id AND status IN ('invited', 'active')
     AND (landlord_id = v_uid OR tenant_id = v_uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_end_tenancy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_end_tenancy(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_set_auto_approve(p_property_id uuid, p_limit_cents integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF p_limit_cents IS NOT NULL AND (p_limit_cents < 100 OR p_limit_cents > 1000000) THEN
    RAISE EXCEPTION 'bad_limit' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_properties SET auto_approve_limit_cents = p_limit_cents, updated_at = now()
   WHERE id = p_property_id AND owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'PT404';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_set_auto_approve(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_auto_approve(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_approve_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_tenant uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  UPDATE public.maintenance_requests SET status = 'approved', decided_at = now(), updated_at = now()
   WHERE id = p_request_id AND landlord_id = v_uid AND status = 'submitted'
  RETURNING tenant_id INTO v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  PERFORM public.rentals_notify(v_tenant, 'Request approved',
    'Your landlord approved your maintenance request. You''ll hear when a Helpr is booked.',
    '/rentals/requests/' || p_request_id::text, false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_approve_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_approve_request(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_set_forwarding_address(p_tenancy_id uuid, p_address text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_addr text := btrim(regexp_replace(coalesce(p_address, ''), '\s+', ' ', 'g'));
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  -- The tenant of a live or ended tenancy (the address matters most after move-out).
  IF NOT FOUND OR v_t.tenant_id IS DISTINCT FROM v_uid OR v_t.status NOT IN ('active', 'ended') THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF char_length(v_addr) NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'bad_address' USING ERRCODE = '22023';
  END IF;
  -- Before the deposit is recorded too: the row is made without an amount (lead review #10).
  INSERT INTO public.rental_deposits AS d (tenancy_id, forwarding_address)
  VALUES (p_tenancy_id, v_addr)
  ON CONFLICT (tenancy_id) DO UPDATE SET forwarding_address = EXCLUDED.forwarding_address, updated_at = now()
   WHERE d.settled_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deposit_settled' USING ERRCODE = '22023';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_set_forwarding_address(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_forwarding_address(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_set_saved_home(p_listing_id uuid, p_saved boolean)
RETURNS boolean
LANGUAGE plpgsql
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
  IF p_saved IS NOT TRUE THEN
    DELETE FROM public.saved_homes WHERE user_id = v_uid AND listing_id = p_listing_id;
    RETURN false;
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_listing_id IS NULL OR NOT public.rentals_listing_visible(p_listing_id) THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rental_listings l WHERE l.id = p_listing_id AND l.owner_id = v_uid) THEN
    RAISE EXCEPTION 'own_listing' USING ERRCODE = '22023';
  END IF;
  -- One member's saves are counted under one lock, so two saves at once never pass 100.
  PERFORM pg_advisory_xact_lock(hashtext('saved_homes:' || v_uid::text));
  IF NOT EXISTS (SELECT 1 FROM public.saved_homes WHERE user_id = v_uid AND listing_id = p_listing_id)
     AND (SELECT count(*) FROM public.saved_homes WHERE user_id = v_uid) >= 100 THEN
    RAISE EXCEPTION 'too_many_saved_homes' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.saved_homes (user_id, listing_id) VALUES (v_uid, p_listing_id)
  ON CONFLICT (user_id, listing_id) DO NOTHING;
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_set_saved_home(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_saved_home(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_remove_listing_photo(p_photo_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_listing uuid;
  v_l public.rental_listings%ROWTYPE;
  v_path text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT listing_id INTO v_listing FROM public.rental_listing_photos WHERE id = p_photo_id AND owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_l := public.rentals_lock_own_listing(v_listing, v_uid);
  -- A sold listing is final: its photos stay as they were (20261019061241).
  IF v_l.status = 'sold' THEN
    RAISE EXCEPTION 'listing_not_editable' USING ERRCODE = '22023';
  END IF;
  -- A live listing keeps at least 5 photos (Q11): pause it first to go below.
  IF v_l.status = 'live' AND (SELECT count(*) FROM public.rental_listing_photos WHERE listing_id = v_listing) <= 5 THEN
    RAISE EXCEPTION 'too_few_photos' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.rental_listing_photos WHERE id = p_photo_id AND owner_id = v_uid RETURNING storage_path INTO v_path;
  UPDATE public.rental_listings SET updated_at = now() WHERE id = v_listing;
  RETURN v_path;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_remove_listing_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_remove_listing_photo(uuid) TO authenticated, service_role;

