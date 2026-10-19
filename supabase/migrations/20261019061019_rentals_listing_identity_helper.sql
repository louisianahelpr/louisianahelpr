-- Homes listings: the two listing gates read the ONE identity rule.
--
-- rentals_save_listing and rentals_set_listing_status (20261019043000) refused with
-- identity_not_verified unless profiles.idv_status = 'verified' (Stripe Identity
-- only). Every identity gate now calls public.is_identity_verified(uuid)
-- (20261019051407: Stripe Identity, which an admin approval of a landlord ID
-- photo also sets, OR the Stripe Connect verdict), the rule src/test/rentalsIdentityGateUsesHelper.test.ts
-- enforces. Each body is 20261019043000's VERBATIM with only that one IF changed.
-- Proof: src/test/pglite/rentalsListings.pglite.mjs (IDENTITY_MIGRATION=skip is RED).
--
-- Replay-safe: CREATE OR REPLACE of the same signatures; is_identity_verified
-- exists from 20261019051407, which always runs first. Grants restated exactly
-- as 20261019043000 sets them.

CREATE OR REPLACE FUNCTION public.rentals_save_listing(p_listing_id uuid, p_unit_id uuid, p_fields jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_unit public.rental_units%ROWTYPE;
  v_prop_status text;
  v_l public.rental_listings%ROWTYPE;
  v_flags text[];
  v_id uuid;
  v_bad text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF NOT public.is_identity_verified(v_uid) THEN
    RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';
  END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'bad_listing' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_fields) AS k
   WHERE k NOT IN ('headline', 'description', 'rent_cents', 'rent_frequency', 'deposit_cents', 'beds', 'baths', 'sq_ft',
                   'available_on', 'lease_months_min', 'lease_months_max', 'pets', 'pet_rules', 'parking',
                   'utilities_included', 'accepts_vouchers', 'accessibility')
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'bad_listing' USING ERRCODE = '22023', DETAIL = v_bad;
  END IF;

  IF p_listing_id IS NULL THEN
    SELECT * INTO v_unit FROM public.rental_units WHERE id = p_unit_id AND owner_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    v_l := public.rentals_lock_own_listing(p_listing_id, v_uid);
    IF v_l.status = 'removed' THEN
      RAISE EXCEPTION 'listing_not_editable' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_unit FROM public.rental_units WHERE id = v_l.unit_id;
  END IF;
  SELECT ownership_status INTO v_prop_status FROM public.rental_properties WHERE id = v_unit.property_id AND owner_id = v_uid;
  IF v_prop_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'ownership_not_approved' USING ERRCODE = '42501';
  END IF;

  v_flags := public.rentals_listing_wording_flags(
    concat_ws(' ', p_fields ->> 'headline', p_fields ->> 'description', p_fields ->> 'pet_rules'));
  -- A live listing never becomes discriminatory: an edit that adds a flagged phrase is refused.
  IF p_listing_id IS NOT NULL AND v_l.status = 'live' AND cardinality(v_flags) > 0 THEN
    RAISE EXCEPTION 'wording_flagged' USING ERRCODE = '22023', DETAIL = array_to_string(v_flags, ', ');
  END IF;

  BEGIN
    IF p_listing_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.rental_listings WHERE unit_id = v_unit.id AND status IN ('draft', 'live', 'paused')) THEN
        RAISE EXCEPTION 'unit_already_listed' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.rental_listings (
        unit_id, property_id, owner_id, headline, description, rent_cents, rent_frequency, deposit_cents, beds, baths,
        sq_ft, available_on, lease_months_min, lease_months_max, pets, pet_rules, parking, utilities_included,
        accepts_vouchers, accessibility, wording_flags)
      VALUES (
        v_unit.id, v_unit.property_id, v_uid,
        btrim(p_fields ->> 'headline'),
        COALESCE(btrim(p_fields ->> 'description'), ''),
        (p_fields ->> 'rent_cents')::integer,
        COALESCE(p_fields ->> 'rent_frequency', 'monthly'),
        (p_fields ->> 'deposit_cents')::integer,
        (p_fields ->> 'beds')::numeric,
        (p_fields ->> 'baths')::numeric,
        (p_fields ->> 'sq_ft')::integer,
        (p_fields ->> 'available_on')::date,
        (p_fields ->> 'lease_months_min')::smallint,
        (p_fields ->> 'lease_months_max')::smallint,
        COALESCE(p_fields ->> 'pets', 'ask'),
        COALESCE(btrim(p_fields ->> 'pet_rules'), ''),
        COALESCE(p_fields ->> 'parking', 'none'),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'utilities_included')), '{}'),
        COALESCE(p_fields ->> 'accepts_vouchers', 'ask'),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'accessibility')), '{}'),
        v_flags)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.rental_listings SET
        headline = btrim(p_fields ->> 'headline'),
        description = COALESCE(btrim(p_fields ->> 'description'), ''),
        rent_cents = (p_fields ->> 'rent_cents')::integer,
        rent_frequency = COALESCE(p_fields ->> 'rent_frequency', 'monthly'),
        deposit_cents = (p_fields ->> 'deposit_cents')::integer,
        beds = (p_fields ->> 'beds')::numeric,
        baths = (p_fields ->> 'baths')::numeric,
        sq_ft = (p_fields ->> 'sq_ft')::integer,
        available_on = (p_fields ->> 'available_on')::date,
        lease_months_min = (p_fields ->> 'lease_months_min')::smallint,
        lease_months_max = (p_fields ->> 'lease_months_max')::smallint,
        pets = COALESCE(p_fields ->> 'pets', 'ask'),
        pet_rules = COALESCE(btrim(p_fields ->> 'pet_rules'), ''),
        parking = COALESCE(p_fields ->> 'parking', 'none'),
        utilities_included = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'utilities_included')), '{}'),
        accepts_vouchers = COALESCE(p_fields ->> 'accepts_vouchers', 'ask'),
        accessibility = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'accessibility')), '{}'),
        wording_flags = v_flags,
        updated_at = now()
       WHERE id = p_listing_id
      RETURNING id INTO v_id;
    END IF;
  EXCEPTION
    WHEN check_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range
         OR invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'bad_listing' USING ERRCODE = '22023';
    WHEN unique_violation THEN
      RAISE EXCEPTION 'unit_already_listed' USING ERRCODE = '22023';
  END;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_save_listing(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_save_listing(uuid, uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_set_listing_status(p_listing_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_l public.rental_listings%ROWTYPE;
  v_photos integer;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF p_status IS NULL OR p_status NOT IN ('live', 'paused', 'leased', 'removed') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
  END IF;
  v_l := public.rentals_lock_own_listing(p_listing_id, v_uid);
  IF v_l.status = 'removed' THEN
    RAISE EXCEPTION 'listing_not_editable' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'live' THEN
    -- A rented listing stays rented (lh-authz-rls review of 390bbc7a9 #3): the
    -- unit is listed again with a NEW listing, so the one-open-listing rule
    -- never surfaces as a raw unique violation.
    IF v_l.status = 'leased' THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_identity_verified(v_uid) THEN
      RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rental_properties rp
                    WHERE rp.id = v_l.property_id AND rp.owner_id = v_uid AND rp.ownership_status = 'approved') THEN
      RAISE EXCEPTION 'ownership_not_approved' USING ERRCODE = '42501';
    END IF;
    -- The check is re-run on the stored text (the phrase list may have grown since the last save).
    IF cardinality(public.rentals_listing_wording_flags(concat_ws(' ', v_l.headline, v_l.description, v_l.pet_rules))) > 0 THEN
      RAISE EXCEPTION 'wording_flagged' USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_photos FROM public.rental_listing_photos WHERE listing_id = p_listing_id;
    IF v_photos < 5 THEN
      RAISE EXCEPTION 'too_few_photos' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings
       SET status = 'live', published_at = COALESCE(published_at, now()), expires_at = now() + interval '30 days',
           updated_at = now()
     WHERE id = p_listing_id;
  ELSIF p_status = 'paused' THEN
    IF v_l.status <> 'live' THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings SET status = 'paused', updated_at = now() WHERE id = p_listing_id;
  ELSIF p_status = 'leased' THEN
    IF v_l.status NOT IN ('live', 'paused') THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings SET status = 'leased', updated_at = now() WHERE id = p_listing_id;
  ELSE
    UPDATE public.rental_listings SET status = 'removed', updated_at = now() WHERE id = p_listing_id;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_listing_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_listing_status(uuid, text) TO authenticated, service_role;
