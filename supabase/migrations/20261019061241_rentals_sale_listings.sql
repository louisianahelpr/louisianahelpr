-- HOMES -> BUY: homes for sale by their verified owners (Slice 2; owner
-- 2026-10-18 ~03:30Z pop-up: "BUY = for-sale-by-owner listings (verified
-- owners, no commission / no negotiating, title company / attorney closes)
-- with a FLAT listing fee (amount TBD)").
--
-- A sale listing is a row of rental_listings with kind = 'sale': the same
-- photos table, the same storage folder, the same take-down / export / purge
-- paths, the same fair-housing wording check (it applies to sales too:
-- 42 U.S.C. 3604(c)). It lists the whole PROPERTY (unit_id NULL), carries a
-- price instead of rent, and ends 'sold' instead of 'leased'.
--
-- Who may list: the same gate as Rent: ID-verified by the one rule
-- (public.is_identity_verified, 20261019051407) AND the property's ownership
-- approved by an admin.
--
-- No negotiating on our side: the app has no offers, no counter-offers and no
-- commission. Seller text that invites haggling ("OBO", "negotiable", "make
-- an offer") is flagged like a fair-housing phrase: saved as a draft, never
-- shown, until rewritten (homes_sale_wording_flags).
--
-- THE FLAT LISTING FEE (amount TBD by the owner): platform_settings
-- .homes_sale_listing_fee_cents, DEFAULT 0. There is no payment flow yet, so
-- publishing a sale listing is REFUSED ('listing_fee_not_ready') whenever the
-- fee is above 0: a fee set before checkout exists can never be skipped, and
-- is never charged by accident. At 0 nothing is charged and nothing is owed
-- (no card cost exists to absorb).
--
-- Reads: rentals_browse_listings now returns RENT only; the new
-- rentals_browse_sale_listings returns SALE only; rentals_listing (one page)
-- returns both, with kind, price, lot size and year built added (its RETURNS
-- TABLE changes, so it is dropped and created again). City + ZIP only, never
-- the street (Q12).
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, constraints dropped before they are
-- added, CREATE OR REPLACE / DROP ... IF EXISTS, grants restated by role name.
-- Proof: src/test/pglite/homesSaleListings.pglite.mjs (applied 3x).

-- ---------------------------------------------------------------------------
-- 1. The fee setting (admin-set; read only by the definer RPC below).
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS homes_sale_listing_fee_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_homes_sale_fee_nonneg;
ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_homes_sale_fee_nonneg CHECK (homes_sale_listing_fee_cents >= 0);
COMMENT ON COLUMN public.platform_settings.homes_sale_listing_fee_cents IS
  'Homes -> Buy flat listing fee in cents. 0 = free. Above 0, publishing a sale listing is refused (listing_fee_not_ready) until a payment flow exists.';

-- ---------------------------------------------------------------------------
-- 2. Sale listings on the listings table.
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'rent';
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS sale_price_cents bigint;
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS lot_sq_ft integer;
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS year_built smallint;
ALTER TABLE public.rental_listings ALTER COLUMN unit_id DROP NOT NULL;
ALTER TABLE public.rental_listings ALTER COLUMN rent_cents DROP NOT NULL;
ALTER TABLE public.rental_listings ALTER COLUMN available_on DROP NOT NULL;

ALTER TABLE public.rental_listings DROP CONSTRAINT IF EXISTS rental_listings_kind_check;
ALTER TABLE public.rental_listings ADD CONSTRAINT rental_listings_kind_check CHECK (kind IN ('rent', 'sale'));
ALTER TABLE public.rental_listings DROP CONSTRAINT IF EXISTS rental_listings_status_check;
ALTER TABLE public.rental_listings ADD CONSTRAINT rental_listings_status_check
  CHECK (status IN ('draft', 'live', 'paused', 'leased', 'sold', 'removed'));
ALTER TABLE public.rental_listings DROP CONSTRAINT IF EXISTS rental_listings_sale_facts;
ALTER TABLE public.rental_listings ADD CONSTRAINT rental_listings_sale_facts CHECK (
  (sale_price_cents IS NULL OR sale_price_cents BETWEEN 1000000 AND 10000000000)
  AND (lot_sq_ft IS NULL OR lot_sq_ft BETWEEN 100 AND 50000000)
  AND (year_built IS NULL OR year_built BETWEEN 1700 AND 2100));
-- Each kind has its own shape: a rent listing is a unit with rent and a date;
-- a sale listing is the whole property with a price. 'leased' is rent's end,
-- 'sold' is sale's.
ALTER TABLE public.rental_listings DROP CONSTRAINT IF EXISTS rental_listings_kind_shape;
ALTER TABLE public.rental_listings ADD CONSTRAINT rental_listings_kind_shape CHECK (
  (kind = 'rent' AND unit_id IS NOT NULL AND rent_cents IS NOT NULL AND available_on IS NOT NULL
     AND sale_price_cents IS NULL AND status <> 'sold')
  OR
  (kind = 'sale' AND unit_id IS NULL AND sale_price_cents IS NOT NULL AND rent_cents IS NULL
     AND status <> 'leased'));
-- One open sale listing per property.
CREATE UNIQUE INDEX IF NOT EXISTS rental_listings_one_open_sale_per_property
  ON public.rental_listings (property_id) WHERE kind = 'sale' AND status IN ('draft', 'live', 'paused');

-- ---------------------------------------------------------------------------
-- 3. Sale wording: the fair-housing phrases plus the haggling ones. Pure.
CREATE OR REPLACE FUNCTION public.homes_sale_wording_flags(p_text text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT public.rentals_listing_wording_flags(p_text) || COALESCE(
    (SELECT array_agg(w.phrase ORDER BY w.ord)
       FROM (VALUES
         (1, 'or best offer', '\mobo\M|\mor\s+best\s+offers?\M|\mbest\s+offer\M'),
         (2, 'negotiable',    '\mnegotiab\w*|\mnegotiat\w*|\mhaggl\w*'),
         (3, 'make an offer', '\mmake\s+(me\s+)?(an\s+)?offers?\M|\mtaking\s+offers\M|\mall\s+offers\M|\msubmit\s+(an\s+)?offers?\M')
       ) AS w(ord, phrase, re)
      -- A firm price is the rule, not a breach: "non-negotiable", "not negotiable", "no haggling" are removed first.
      WHERE regexp_replace(lower(COALESCE(p_text, '')),
                           '\m(non-?\s*negotiab\w*|not\s+negotiab\w*|no\s+haggl\w*|no\s+negotiat\w*)', ' ', 'g') ~ w.re),
    '{}'::text[]);
$fn$;
REVOKE ALL ON FUNCTION public.homes_sale_wording_flags(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homes_sale_wording_flags(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Save a sale listing (create a draft for a property, or edit the caller's
--    own). p_fields keys: headline, description, sale_price_cents, beds, baths,
--    sq_ft, lot_sq_ft, year_built, parking, accessibility.
CREATE OR REPLACE FUNCTION public.rentals_save_sale_listing(p_listing_id uuid, p_property_id uuid, p_fields jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_property uuid;
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
   WHERE k NOT IN ('headline', 'description', 'sale_price_cents', 'beds', 'baths', 'sq_ft', 'lot_sq_ft', 'year_built',
                   'parking', 'accessibility')
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'bad_listing' USING ERRCODE = '22023', DETAIL = v_bad;
  END IF;

  IF p_listing_id IS NULL THEN
    v_property := p_property_id;
  ELSE
    v_l := public.rentals_lock_own_listing(p_listing_id, v_uid);
    -- A rent listing is edited by rentals_save_listing; a stranger's id was already P0002.
    IF v_l.kind <> 'sale' THEN
      RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_l.status IN ('removed', 'sold') THEN
      RAISE EXCEPTION 'listing_not_editable' USING ERRCODE = '22023';
    END IF;
    v_property := v_l.property_id;
  END IF;
  SELECT ownership_status INTO v_prop_status FROM public.rental_properties WHERE id = v_property AND owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_prop_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'ownership_not_approved' USING ERRCODE = '42501';
  END IF;

  v_flags := public.homes_sale_wording_flags(concat_ws(' ', p_fields ->> 'headline', p_fields ->> 'description'));
  -- A live listing never gains a flagged phrase: such an edit is refused.
  IF p_listing_id IS NOT NULL AND v_l.status = 'live' AND cardinality(v_flags) > 0 THEN
    RAISE EXCEPTION 'sale_wording_flagged' USING ERRCODE = '22023', DETAIL = array_to_string(v_flags, ', ');
  END IF;

  BEGIN
    IF p_listing_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.rental_listings
                  WHERE property_id = v_property AND kind = 'sale' AND status IN ('draft', 'live', 'paused')) THEN
        RAISE EXCEPTION 'property_already_listed' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.rental_listings (
        kind, unit_id, property_id, owner_id, headline, description, sale_price_cents, beds, baths, sq_ft, lot_sq_ft,
        year_built, parking, accessibility, wording_flags)
      VALUES (
        'sale', NULL, v_property, v_uid,
        btrim(p_fields ->> 'headline'),
        COALESCE(btrim(p_fields ->> 'description'), ''),
        (p_fields ->> 'sale_price_cents')::bigint,
        (p_fields ->> 'beds')::numeric,
        (p_fields ->> 'baths')::numeric,
        (p_fields ->> 'sq_ft')::integer,
        (p_fields ->> 'lot_sq_ft')::integer,
        (p_fields ->> 'year_built')::smallint,
        COALESCE(p_fields ->> 'parking', 'none'),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_fields -> 'accessibility')), '{}'),
        v_flags)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.rental_listings SET
        headline = btrim(p_fields ->> 'headline'),
        description = COALESCE(btrim(p_fields ->> 'description'), ''),
        sale_price_cents = (p_fields ->> 'sale_price_cents')::bigint,
        beds = (p_fields ->> 'beds')::numeric,
        baths = (p_fields ->> 'baths')::numeric,
        sq_ft = (p_fields ->> 'sq_ft')::integer,
        lot_sq_ft = (p_fields ->> 'lot_sq_ft')::integer,
        year_built = (p_fields ->> 'year_built')::smallint,
        parking = COALESCE(p_fields ->> 'parking', 'none'),
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
      RAISE EXCEPTION 'property_already_listed' USING ERRCODE = '22023';
  END;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_save_sale_listing(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_save_sale_listing(uuid, uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Status. The body of 20261019061019 (the newest) with: 'sold' accepted
--    (sale only) and 'leased' rent only; a sale listing's publish runs the
--    sale wording check and the FEE GATE; a sold listing stays sold.
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
  v_fee integer;
  v_flags text[];
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF p_status IS NULL OR p_status NOT IN ('live', 'paused', 'leased', 'sold', 'removed') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
  END IF;
  v_l := public.rentals_lock_own_listing(p_listing_id, v_uid);
  IF v_l.status = 'removed' THEN
    RAISE EXCEPTION 'listing_not_editable' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'live' THEN
    -- A rented listing stays rented (lh-authz-rls review of 390bbc7a9 #3): the
    -- unit is listed again with a NEW listing, so the one-open-listing rule
    -- never surfaces as a raw unique violation. A sold one stays sold.
    IF v_l.status IN ('leased', 'sold') THEN
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
    IF v_l.kind = 'sale' THEN
      v_flags := public.homes_sale_wording_flags(concat_ws(' ', v_l.headline, v_l.description));
    ELSE
      v_flags := public.rentals_listing_wording_flags(concat_ws(' ', v_l.headline, v_l.description, v_l.pet_rules));
    END IF;
    IF cardinality(v_flags) > 0 THEN
      -- A sale listing's words are named in the sale copy (haggling or who may live there), a rent listing's in the
      -- fair-housing copy; both carry the phrases.
      IF v_l.kind = 'sale' THEN
        RAISE EXCEPTION 'sale_wording_flagged' USING ERRCODE = '22023', DETAIL = array_to_string(v_flags, ', ');
      END IF;
      RAISE EXCEPTION 'wording_flagged' USING ERRCODE = '22023', DETAIL = array_to_string(v_flags, ', ');
    END IF;
    SELECT count(*) INTO v_photos FROM public.rental_listing_photos WHERE listing_id = p_listing_id;
    IF v_photos < 5 THEN
      RAISE EXCEPTION 'too_few_photos' USING ERRCODE = '22023';
    END IF;
    -- THE FEE GATE (owner: flat fee, amount TBD). No payment flow exists, so a
    -- fee above 0 refuses the publish rather than letting it through unpaid.
    IF v_l.kind = 'sale' THEN
      -- Fail closed: no settings row (or no value) refuses too, never publishes free by accident.
      SELECT ps.homes_sale_listing_fee_cents INTO v_fee FROM public.platform_settings ps LIMIT 1;
      IF v_fee IS NULL OR v_fee > 0 THEN
        RAISE EXCEPTION 'listing_fee_not_ready' USING ERRCODE = '22023';
      END IF;
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
    IF v_l.kind <> 'rent' OR v_l.status NOT IN ('live', 'paused') THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings SET status = 'leased', updated_at = now() WHERE id = p_listing_id;
  ELSIF p_status = 'sold' THEN
    IF v_l.kind <> 'sale' OR v_l.status NOT IN ('live', 'paused') THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings SET status = 'sold', updated_at = now() WHERE id = p_listing_id;
  ELSE
    UPDATE public.rental_listings SET status = 'removed', updated_at = now() WHERE id = p_listing_id;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_listing_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_listing_status(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5b. The rent editor refuses a sale listing (it is edited by
--     rentals_save_sale_listing): 20261019061019's body with one check added.
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
    -- A sale listing is edited by rentals_save_sale_listing (20261019061241), never here.
    IF v_l.kind <> 'rent' THEN
      RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
    END IF;
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

-- 5c. Photos of a SOLD listing are final: 20261019043000's bodies with 'sold'
--     refused on add and remove.
CREATE OR REPLACE FUNCTION public.rentals_add_listing_photo(p_listing_id uuid, p_storage_path text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_l public.rental_listings%ROWTYPE;
  v_pos smallint;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  v_l := public.rentals_lock_own_listing(p_listing_id, v_uid);
  IF v_l.status IN ('removed', 'sold') THEN
    RAISE EXCEPTION 'listing_not_editable' USING ERRCODE = '22023';
  END IF;
  -- The caller's own folder for THIS listing, and the object is really there,
  -- uploaded by the caller, an image (job-photos also takes video, which keeps GPS).
  IF p_storage_path IS NULL
     OR p_storage_path !~ '^[0-9a-f-]{36}/rental-listings/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_storage_path, '/', 3) IS DISTINCT FROM p_listing_id::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rental_listing_photos WHERE storage_path = p_storage_path) THEN
    RAISE EXCEPTION 'photo_already_attached' USING ERRCODE = '22023';
  END IF;
  SELECT g.p INTO v_pos
    FROM generate_series(0, 24) AS g(p)
   WHERE NOT EXISTS (SELECT 1 FROM public.rental_listing_photos ph WHERE ph.listing_id = p_listing_id AND ph.position = g.p)
   ORDER BY g.p
   LIMIT 1;
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rental_listing_photos (listing_id, owner_id, storage_path, position)
  VALUES (p_listing_id, v_uid, p_storage_path, v_pos)
  RETURNING id INTO v_id;
  UPDATE public.rental_listings SET updated_at = now() WHERE id = p_listing_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_add_listing_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_add_listing_photo(uuid, text) TO authenticated, service_role;

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
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
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

-- 5d. Visible: 20261019043000's body; a sale listing also needs a verified
--     owner and a 0 listing fee (fail closed). Server-only, as before.
CREATE OR REPLACE FUNCTION public.rentals_listing_visible(p_listing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.rental_listings l
      JOIN public.rental_properties rp ON rp.id = l.property_id
     WHERE l.id = p_listing_id
       AND l.status = 'live'
       AND l.expires_at > now()
       AND rp.ownership_status = 'approved'
       -- A SALE listing also needs its owner still ID-verified ("Listed by its verified owner") and a listing
       -- fee of 0 (no payment flow exists; a fee raised later hides live sale listings until one does). A
       -- missing settings row hides them too (fail closed).
       AND (l.kind <> 'sale'
            OR (public.is_identity_verified(l.owner_id)
                AND COALESCE((SELECT ps.homes_sale_listing_fee_cents FROM public.platform_settings ps LIMIT 1), 1) = 0))
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr
                        WHERE pr.user_id = l.owner_id
                          AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                          AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL
                               OR pr.auto_suspended_until > now())));
$fn$;
REVOKE ALL ON FUNCTION public.rentals_listing_visible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_listing_visible(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Reads. rentals_browse_listings: the body of 20261019043000 with RENT only.
CREATE OR REPLACE FUNCTION public.rentals_browse_listings(
  p_city text DEFAULT NULL,
  p_min_beds numeric DEFAULT NULL,
  p_max_rent_cents integer DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  headline text,
  rent_cents integer,
  rent_frequency text,
  beds numeric,
  baths numeric,
  sq_ft integer,
  available_on date,
  pets text,
  city text,
  zip_code text,
  photo_paths text[],
  is_mine boolean,
  published_at timestamptz
)
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
  RETURN QUERY
  SELECT l.id, l.headline, l.rent_cents, l.rent_frequency, l.beds, l.baths, l.sq_ft, l.available_on, l.pets,
         rp.city, rp.zip_code,
         ARRAY(SELECT ph.storage_path FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position LIMIT 5),
         l.owner_id = v_uid,
         l.published_at
    FROM public.rental_listings l
    JOIN public.rental_properties rp ON rp.id = l.property_id
   WHERE l.kind = 'rent'
     AND public.rentals_listing_visible(l.id)
     AND (p_city IS NULL OR btrim(p_city) = '' OR lower(rp.city) = lower(btrim(p_city)) OR rp.zip_code = btrim(p_city))
     AND (p_min_beds IS NULL OR l.beds >= p_min_beds)
     AND (p_max_rent_cents IS NULL OR l.rent_cents <= p_max_rent_cents)
   ORDER BY l.published_at DESC, l.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 60)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_browse_listings(text, numeric, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_browse_listings(text, numeric, integer, integer, integer) TO authenticated, service_role;

-- Homes for sale: live SALE listings, coarse fields only.
CREATE OR REPLACE FUNCTION public.rentals_browse_sale_listings(
  p_city text DEFAULT NULL,
  p_min_beds numeric DEFAULT NULL,
  p_max_price_cents bigint DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  headline text,
  sale_price_cents bigint,
  beds numeric,
  baths numeric,
  sq_ft integer,
  city text,
  zip_code text,
  photo_paths text[],
  is_mine boolean,
  published_at timestamptz
)
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
  RETURN QUERY
  SELECT l.id, l.headline, l.sale_price_cents, l.beds, l.baths, l.sq_ft,
         rp.city, rp.zip_code,
         ARRAY(SELECT ph.storage_path FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position LIMIT 5),
         l.owner_id = v_uid,
         l.published_at
    FROM public.rental_listings l
    JOIN public.rental_properties rp ON rp.id = l.property_id
   WHERE l.kind = 'sale'
     AND public.rentals_listing_visible(l.id)
     AND (p_city IS NULL OR btrim(p_city) = '' OR lower(rp.city) = lower(btrim(p_city)) OR rp.zip_code = btrim(p_city))
     AND (p_min_beds IS NULL OR l.beds >= p_min_beds)
     AND (p_max_price_cents IS NULL OR l.sale_price_cents <= p_max_price_cents)
   ORDER BY l.published_at DESC, l.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 60)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_browse_sale_listings(text, numeric, bigint, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_browse_sale_listings(text, numeric, bigint, integer, integer) TO authenticated, service_role;

-- One listing (either kind), every public fact plus the photos. The body of
-- 20261019043000 with kind, sale_price_cents, lot_sq_ft and year_built added;
-- the return shape changes, so the old function is dropped first.
DROP FUNCTION IF EXISTS public.rentals_listing(uuid);
CREATE FUNCTION public.rentals_listing(p_listing_id uuid)
RETURNS TABLE (
  id uuid,
  kind text,
  status text,
  headline text,
  description text,
  rent_cents integer,
  rent_frequency text,
  deposit_cents integer,
  sale_price_cents bigint,
  beds numeric,
  baths numeric,
  sq_ft integer,
  lot_sq_ft integer,
  year_built smallint,
  available_on date,
  lease_months_min smallint,
  lease_months_max smallint,
  pets text,
  pet_rules text,
  parking text,
  utilities_included text[],
  accepts_vouchers text,
  accessibility text[],
  city text,
  zip_code text,
  photo_paths text[],
  is_mine boolean,
  published_at timestamptz,
  expires_at timestamptz
)
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
  IF NOT EXISTS (SELECT 1 FROM public.rental_listings l
                  WHERE l.id = p_listing_id
                    AND ((l.owner_id = v_uid AND l.status <> 'removed') OR public.rentals_listing_visible(l.id))) THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT l.id, l.kind, l.status, l.headline, l.description, l.rent_cents, l.rent_frequency, l.deposit_cents,
         l.sale_price_cents, l.beds, l.baths, l.sq_ft, l.lot_sq_ft, l.year_built, l.available_on, l.lease_months_min,
         l.lease_months_max, l.pets, l.pet_rules, l.parking, l.utilities_included, l.accepts_vouchers, l.accessibility,
         rp.city, rp.zip_code,
         ARRAY(SELECT ph.storage_path FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position),
         l.owner_id = v_uid, l.published_at, l.expires_at
    FROM public.rental_listings l
    JOIN public.rental_properties rp ON rp.id = l.property_id
   WHERE l.id = p_listing_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_listing(uuid) TO authenticated, service_role;
