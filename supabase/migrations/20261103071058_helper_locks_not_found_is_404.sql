-- Q2390 packet 15 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for five internal lock/lookup helpers. None is callable by members
-- (EXECUTE to service_role only, as on prod); each is reached through its
-- member-facing callers, whose bodies do not change:
--   rentals_lock_own_listing        <- rentals_save_listing, rentals_add_listing_photo,
--     rentals_remove_listing_photo, rentals_set_listing_status, rentals_save_sale_listing
--   shops_lock_own_item             <- shops_update_item, shops_set_item_stock,
--     shops_add_item_photo, shops_remove_item_photo, shops_attest_item, shops_publish_item
--   declutter_list_for_seller_draft <- declutter_helpr_update_listing,
--     declutter_helpr_add_listing_photo, declutter_helpr_remove_listing_photo,
--     declutter_helpr_delete_listing
--   declutter_donation_own_items    <- declutter_donation_partners_near, declutter_choose_donation
--   rentals_lease_for_action        <- rentals_lease_send, rentals_lease_withdraw,
--     rentals_lease_discard, rentals_lease_request_changes, rentals_lease_sign
-- Each helper raises its not-found before its caller writes anything. No
-- helper moves money, creates an order or calls pg_net, and no edge function
-- that maps P0002 (declutter-checkout, shop-checkout) reaches any of them.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   rentals_lock_own_listing               20261019043000 59d2ac78b69cf3c0f3b60ed41a451571
--   shops_lock_own_item                    20261017061157 36ad60a3ad4758a45f205d7ccd43789b
--   declutter_list_for_seller_draft        20261101034159 00341bb0e50a9956619e62d4a7162ccc
--   declutter_donation_own_items           20261027222743 34f88937fce27ed645c5dd50d2f90a34
--   rentals_lease_for_action               20261019110137 95c88fdf155cf6194032d95b3bfb5eea
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (6 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.rentals_lock_own_listing(p_listing_id uuid, p_uid uuid)
RETURNS public.rental_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_l public.rental_listings%ROWTYPE;
BEGIN
  SELECT * INTO v_l FROM public.rental_listings
   WHERE id = p_listing_id AND owner_id = p_uid AND p_uid IS NOT NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_l;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_lock_own_listing(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_lock_own_listing(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.shops_lock_own_item(p_item_id uuid, p_uid uuid)
RETURNS public.shop_items
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_item public.shop_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM public.shop_items WHERE id = p_item_id AND owner_id = p_uid FOR UPDATE;
  IF NOT FOUND OR p_uid IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shops s WHERE s.id = v_item.shop_id AND s.hidden_at IS NOT NULL) THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501',
      HINT = 'Louisiana Helpr hid this shop. Contact support.';
  END IF;
  RETURN v_item;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_lock_own_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_lock_own_item(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_list_for_seller_draft(p_item_id uuid)
RETURNS public.declutter_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_job uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  SELECT l.job_id INTO v_job FROM public.declutter_listed_for_seller l
   WHERE l.item_id = p_item_id AND l.helpr_id = (SELECT auth.uid());
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  PERFORM public.declutter_list_for_seller_job(v_job);
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'item_not_a_draft' USING ERRCODE = '22023', HINT = 'This listing was already sent to the seller.';
  END IF;
  RETURN v_item;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_list_for_seller_draft(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_list_for_seller_draft(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_donation_own_items(p_uid uuid, p_item_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(COALESCE(p_item_ids, ARRAY[]::uuid[])) x WHERE x IS NOT NULL;
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF cardinality(v_ids) > (public.declutter_donation_rules() ->> 'max_items')::integer THEN
    RAISE EXCEPTION 'haul_away_too_many' USING ERRCODE = '22023';
  END IF;
  -- Someone else's item reads exactly as a missing one (no oracle).
  IF (SELECT count(*) FROM public.declutter_items i WHERE i.id = ANY (v_ids) AND i.seller_id = p_uid) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN v_ids;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_donation_own_items(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_donation_own_items(uuid, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.rentals_lease_for_action(p_lease_id uuid, p_side text, p_status text)
RETURNS public.rental_leases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_l public.rental_leases%ROWTYPE;
  v_t public.rental_tenancies%ROWTYPE;
BEGIN
  -- Lock order tenancy -> lease, the same as rentals_lease_save (no deadlock between a save and an action).
  SELECT * INTO v_t FROM public.rental_tenancies
   WHERE id = (SELECT l.tenancy_id FROM public.rental_leases l WHERE l.id = p_lease_id) FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_l FROM public.rental_leases WHERE id = p_lease_id FOR UPDATE;
  END IF;
  IF v_l.id IS NULL OR v_t.status IS DISTINCT FROM 'active'
     OR (p_side = 'landlord' AND v_t.landlord_id IS DISTINCT FROM v_uid)
     OR (p_side = 'tenant' AND v_t.tenant_id IS DISTINCT FROM v_uid)
     -- The tenant never learns a draft's id is real.
     OR (p_side = 'tenant' AND v_l.status = 'draft') THEN
    RAISE EXCEPTION 'lease_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_l.status IS DISTINCT FROM p_status THEN
    RAISE EXCEPTION 'lease_not_open' USING ERRCODE = '22023';
  END IF;
  RETURN v_l;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_lease_for_action(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_lease_for_action(uuid, text, text) TO service_role;

