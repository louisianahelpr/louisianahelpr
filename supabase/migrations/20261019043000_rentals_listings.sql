-- HOMES -> RENT, listings (Rentals RL1a; spec ~/.lh-wt/handoffs-1017/rentals-full-spec.md
-- section 1a, owner 2026-10-18: the section is "Homes", tabs Rent | Buy).
--
-- A landlord whose property's ownership an admin approved lists one of its
-- units for rent: headline, description, rent, deposit, beds/baths, size,
-- availability, lease length, pets, parking, utilities, vouchers, accessibility
-- and 5-25 photos. Members with the 'rentals' switch browse LIVE listings.
--
-- What this slice deliberately does NOT do yet (each its own later slice):
-- the map and the public /r/<slug> link (D12: viewable by anyone with the link,
-- no exact address, hidden from Google until Homes opens), tours, applications,
-- messages. The slug is generated now so no backfill is needed later.
--
-- Fair housing (spec 6a): there is no field, filter or sort about who may
-- live here; the free text (headline, description, pet rules) runs through
-- rentals_listing_wording_flags() and a flagged listing cannot go live (the
-- landlord sees the phrases and rewrites them). Vouchers: Yes / Ask only (Q61).
-- The browse never returns the street address (Q12): city + ZIP only. A signed-in
-- member CAN learn which account listed a home (the photo paths start with the
-- owner's id; Q8 shows the landlord on the listing anyway). The future public
-- /r/<slug> page must not carry those paths (Q2188).
--
-- Reads and writes:
--   * rental_listings / rental_listing_photos: RLS SELECT for the OWNER (and
--     admins) only, with the switch on. Browsing is through the definer RPCs
--     rentals_browse_listings / rentals_listing, which return the coarse
--     fields only. No client role writes either table.
--   * Every write is a SECURITY DEFINER RPC that starts
--     PERFORM public.require_feature('rentals'), checks is_caller_banned(),
--     runs rentals_assert_member() (signed in, not banned, 18+), and acts only
--     on the caller's own rows (auth.uid(), never an argument).
--   * Grants by role name: REVOKE ... FROM PUBLIC, anon (internal helpers also
--     FROM authenticated).
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS; grants
-- restated. Applied 3x in PGlite by src/test/pglite/rentalsListings.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 1. Listings.
CREATE TABLE IF NOT EXISTS public.rental_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.rental_units(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.rental_properties(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The future public link's code (D12): random, never the address.
  slug text NOT NULL UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
    CHECK (slug ~ '^[0-9a-f]{12}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'paused', 'leased', 'removed')),
  headline text NOT NULL CHECK (char_length(btrim(headline)) BETWEEN 5 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  rent_cents integer NOT NULL CHECK (rent_cents BETWEEN 5000 AND 5000000),
  rent_frequency text NOT NULL DEFAULT 'monthly' CHECK (rent_frequency IN ('monthly', 'biweekly', 'weekly')),
  deposit_cents integer CHECK (deposit_cents IS NULL OR deposit_cents BETWEEN 0 AND 5000000),
  beds numeric(3,1) NOT NULL CHECK (beds BETWEEN 0 AND 20 AND beds * 2 = round(beds * 2)),
  baths numeric(3,1) NOT NULL CHECK (baths BETWEEN 0.5 AND 20 AND baths * 2 = round(baths * 2)),
  sq_ft integer CHECK (sq_ft IS NULL OR sq_ft BETWEEN 100 AND 20000),
  available_on date NOT NULL,
  lease_months_min smallint CHECK (lease_months_min IS NULL OR lease_months_min BETWEEN 1 AND 36),
  lease_months_max smallint CHECK (lease_months_max IS NULL OR lease_months_max BETWEEN 1 AND 36),
  pets text NOT NULL DEFAULT 'ask' CHECK (pets IN ('none', 'cats', 'dogs', 'cats_dogs', 'ask')),
  pet_rules text NOT NULL DEFAULT '' CHECK (char_length(pet_rules) <= 300),
  parking text NOT NULL DEFAULT 'none' CHECK (parking IN ('none', 'street', 'driveway', 'garage', 'lot')),
  utilities_included text[] NOT NULL DEFAULT '{}'
    CHECK (utilities_included <@ ARRAY['water', 'sewer', 'trash', 'electricity', 'gas', 'internet', 'lawn_care']::text[]
           AND cardinality(utilities_included) <= 7),
  -- Q61: no "No" option.
  accepts_vouchers text NOT NULL DEFAULT 'ask' CHECK (accepts_vouchers IN ('yes', 'ask')),
  -- Q63: a fixed list, facts about the HOME, never about who may live there.
  accessibility text[] NOT NULL DEFAULT '{}'
    CHECK (accessibility <@ ARRAY['step_free_entrance', 'ground_floor', 'elevator', 'wide_doorways', 'roll_in_shower',
                                  'grab_bars', 'accessible_parking']::text[]
           AND cardinality(accessibility) <= 7),
  -- The phrases the fair-housing check found in the free text at the last save; a listing with any cannot go live.
  wording_flags text[] NOT NULL DEFAULT '{}',
  published_at timestamptz,
  -- Q64: a live listing shows for 30 days, then the landlord renews it.
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_listings_lease_range CHECK (lease_months_min IS NULL OR lease_months_max IS NULL
                                                OR lease_months_min <= lease_months_max),
  CONSTRAINT rental_listings_live_has_expiry CHECK (status <> 'live' OR (published_at IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS rental_listings_owner_idx ON public.rental_listings (owner_id);
CREATE INDEX IF NOT EXISTS rental_listings_property_idx ON public.rental_listings (property_id);
CREATE INDEX IF NOT EXISTS rental_listings_live_idx ON public.rental_listings (expires_at) WHERE status = 'live';
-- One open listing per unit (a leased or removed one does not count).
CREATE UNIQUE INDEX IF NOT EXISTS rental_listings_one_open_per_unit
  ON public.rental_listings (unit_id) WHERE status IN ('draft', 'live', 'paused');

-- 2. Photos: 5-25 to go live (Q11), in job-photos under
--    <owner uid>/rental-listings/<listing id>/<file> (a PUBLIC bucket, like
--    Declutter and Shops photos: the app re-encodes them so no GPS tag
--    survives, cleanListingPhoto). Purged with the account
--    (_shared/purgeBuckets.ts IDENTITY_SUBFOLDERS).
CREATE TABLE IF NOT EXISTS public.rental_listing_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.rental_listings(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE
    CHECK (storage_path ~ '^[0-9a-f-]{36}/rental-listings/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 24),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_listing_photos_position_key UNIQUE (listing_id, position)
);
CREATE INDEX IF NOT EXISTS rental_listing_photos_owner_idx ON public.rental_listing_photos (owner_id);

-- 3. RLS: the owner (and admins) read their own rows, switch on. No client writes.
ALTER TABLE public.rental_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_listing_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_listings, public.rental_listing_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.rental_listings TO authenticated;
GRANT SELECT ON TABLE public.rental_listing_photos TO authenticated;
GRANT ALL ON TABLE public.rental_listings TO service_role;
GRANT ALL ON TABLE public.rental_listing_photos TO service_role;

DROP POLICY IF EXISTS "rental listings: owner or admin" ON public.rental_listings;
CREATE POLICY "rental listings: owner or admin" ON public.rental_listings
  FOR SELECT TO authenticated
  USING (
    (SELECT public.feature_enabled_for('rentals'))
    AND (owner_id = (SELECT auth.uid())
         OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  );

DROP POLICY IF EXISTS "rental listing photos: with their listing" ON public.rental_listing_photos;
-- The owner's own rows are readable WITHOUT the switch (lh-authz-rls review of
-- 390bbc7a9 #1): the storage DELETE policy below asks "is this object
-- attached?" as the caller, and a switch-gated answer would say "no" once the
-- owner's switch is off, letting them delete the files behind a live listing.
CREATE POLICY "rental listing photos: with their listing" ON public.rental_listing_photos
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.rental_listings l WHERE l.id = rental_listing_photos.listing_id));

-- The owner removes their own listing photo objects once the server detached
-- them (or refused to attach them). An ATTACHED photo cannot be deleted this
-- way. Modelled on "Owners delete own unattached shop item photos".
DROP POLICY IF EXISTS "Owners delete own unattached rental listing photos" ON storage.objects;
CREATE POLICY "Owners delete own unattached rental listing photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[2] = 'rental-listings'
    AND NOT EXISTS (SELECT 1 FROM public.rental_listing_photos p WHERE p.storage_path = objects.name)
  );

COMMENT ON TABLE public.rental_listings IS
  'Homes -> Rent listings (RL1a, 20261019043000). Written only by rentals_* RPCs; browsed through rentals_browse_listings.';

-- ---------------------------------------------------------------------------
-- 4. The fair-housing wording check (spec 6a; 42 U.S.C. 3604(c), La. R.S.
--    51:2606). Pure. Returns the phrases found (lower case), in list order.
--    A plain phrase list, not a judgement: it catches the common
--    "who may live here" phrasings so the landlord rewrites them. It is easy
--    to evade on purpose; an admin take-down of a listing is queued (Q2187).
CREATE OR REPLACE FUNCTION public.rentals_listing_wording_flags(p_text text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(array_agg(w.phrase ORDER BY w.ord), '{}'::text[])
    FROM (VALUES
      (1,  'no kids',              '\mno\s+(kids|children|child)\M'),
      (2,  'adults only',          '\madults?\s+only\M'),
      (3,  'no families',          '\mno\s+famil(y|ies)\M'),
      (4,  'singles only',         '\msingles?\s+only\M|\msingle\s+(person|professional)\s+only\M'),
      (5,  'couples only',         '\mcouples?\s+only\M|\mmarried\s+couples?\M'),
      (6,  'perfect for',          '\m(ideal|perfect)\s+for\s+(a\s+)?(single|couple|bachelor|retiree|professional|student|young)'),
      (7,  'mature',               '\mmature\s+(person|persons|adult|adults|tenant|tenants|couple)\M'),
      (8,  'seniors only',         '\m(seniors?|retirees?|55\+?)\s+only\M'),
      (9,  'men or women only',    '\m(male|female|men|women|ladies|gentlemen|girls|guys)\s+only\M'),
      (10, 'religion',             '\m(christian|catholic|jewish|muslim|baptist)\s+(only|preferred|tenants?|home|household|family|families)\M|\mchurch\s*goers?\M|\mchurchgoing\M'),
      (11, 'race or origin',       '\m(white|black|hispanic|latino|asian|mexican|african|caucasian)\s+(only|preferred|tenants?|neighborhood|family|families|people)\M'),
      (12, 'citizens only',        '\m(citizens?|americans?)\s+only\M|\mno\s+(immigrants?|foreigners?)\M'),
      (13, 'english only',         '\menglish\s+(only|speakers?|speaking)\M'),
      (14, 'no disabilities',      '\mno\s+(disabled|handicapped|wheelchairs?)\M|\mable[-\s]+bodied\M|\mmust\s+(be\s+able\s+to\s+)?(climb|walk)\M'),
      (15, 'no vouchers',          '\mno\s+(section\s*8|vouchers?|hud)\M'),
      (16, 'no military',          '\mno\s+(military|soldiers|service\s+members)\M'),
      (17, 'hairstyle',            '\mno\s+(dreadlocks|locs|braids|afros?)\M'),
      (18, 'no pregnant',          '\mno\s+(pregnant|babies|infants|teenagers|teens)\M')
    ) AS w(ord, phrase, re)
   WHERE lower(COALESCE(p_text, '')) ~ w.re;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_listing_wording_flags(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_listing_wording_flags(text) TO service_role;

-- The caller's own listing, locked (P0002 for anything else: a stranger is never told it exists).
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
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_l;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lock_own_listing(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_lock_own_listing(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Save a listing (create a draft, or edit the caller's own). Returns the id.
--    p_fields keys: headline, description, rent_cents, rent_frequency,
--    deposit_cents, beds, baths, sq_ft, available_on, lease_months_min,
--    lease_months_max, pets, pet_rules, parking, utilities_included,
--    accepts_vouchers, accessibility. Unknown keys are refused, so no
--    "who may live here" field can be smuggled in.
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
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_uid AND p.idv_status = 'verified') THEN
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

-- ---------------------------------------------------------------------------
-- 6. Photos: attach an uploaded photo to the caller's own listing; detach one.
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
  IF v_l.status = 'removed' THEN
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

-- Returns the detached object's path so the app removes the object.
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

-- ---------------------------------------------------------------------------
-- 7. Status: live (publish, or renew for another 30 days), paused, leased, removed.
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
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_uid AND p.idv_status = 'verified') THEN
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

-- ---------------------------------------------------------------------------
-- 8. Reads. Coarse fields only: city + ZIP, never the street (Q12).
--    Shown: live, not expired, the owner's ownership still approved, the owner
--    not banned. The owner's own listing (any state but removed) through
--    rentals_listing as well, so they can preview it.
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
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr
                        WHERE pr.user_id = l.owner_id
                          AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                          AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL
                               OR pr.auto_suspended_until > now())));
$fn$;
REVOKE ALL ON FUNCTION public.rentals_listing_visible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_listing_visible(uuid) TO service_role;

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
   WHERE public.rentals_listing_visible(l.id)
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

-- One listing, every public fact plus the photos, for its page. A stranger
-- gets nothing for a listing that is not visible (P0002, never "exists but hidden").
CREATE OR REPLACE FUNCTION public.rentals_listing(p_listing_id uuid)
RETURNS TABLE (
  id uuid,
  status text,
  headline text,
  description text,
  rent_cents integer,
  rent_frequency text,
  deposit_cents integer,
  beds numeric,
  baths numeric,
  sq_ft integer,
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
  SELECT l.id, l.status, l.headline, l.description, l.rent_cents, l.rent_frequency, l.deposit_cents, l.beds, l.baths,
         l.sq_ft, l.available_on, l.lease_months_min, l.lease_months_max, l.pets, l.pet_rules, l.parking,
         l.utilities_included, l.accepts_vouchers, l.accessibility, rp.city, rp.zip_code,
         ARRAY(SELECT ph.storage_path FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position),
         l.owner_id = v_uid, l.published_at, l.expires_at
    FROM public.rental_listings l
    JOIN public.rental_properties rp ON rp.id = l.property_id
   WHERE l.id = p_listing_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_listing(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Q807: the unconfirmed-email statement gate on the two new tables (written
-- only by the definer RPCs above; the trigger fires on those writes too).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- The section is "Homes" now: the switch's description (shown on the admin
-- switches card) says so. Data only, one row; an admin-edited description is
-- left alone.
UPDATE public.feature_switches
   SET description = 'Homes (Rent | Buy; route /rentals): landlords list homes for rent and invite tenants, and tenants '
                     'send maintenance requests that become Helpr jobs. Gates every rentals_* RPC and the Homes table reads.'
 WHERE key = 'rentals'
   AND description LIKE 'Rentals:%';
