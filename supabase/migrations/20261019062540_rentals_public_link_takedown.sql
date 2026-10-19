-- HOMES: the public listing link (D12) and the admin take-down (Q2187).
--
-- D12 (owner 2026-10-18): a listing's link is viewable by ANYONE who has it
-- (signed out too), shows no exact address, and stays hidden from search
-- engines until Homes opens (the page sets noindex; robots.txt and the sitemap
-- leave /r/ out). The link is /r/<slug>, the listing's random 12-hex code.
--
--   rentals_public_listing(p_slug)  anon + authenticated. The same coarse
--     fields as the signed-in page (city + ZIP, never the street, Q12), no
--     owner id, no listing id, and PHOTO IDS instead of storage paths: a path
--     starts with the landlord's user id (Q2188), so a stranger gets ids only
--     and the photos are served by id through the listing-photo proxy.
--     Shown only while the listing is visible (live, not expired, ownership
--     approved, owner not banned, not taken down) and the 'rentals' switch is
--     not off. A stranger is never told a hidden listing exists (P0002).
--   rentals_public_listing_photo_path(p_photo_id)  service_role only: the
--     proxy's lookup. NULL unless the photo's listing is publicly visible.
--
-- Q2187: rentals_admin_remove_listing(p_listing_id, p_reason) lets an admin
-- remove ANY listing (rent or sale), writes admin_audit_log and tells the
-- owner why. A removed listing is terminal for its owner (every owner RPC
-- refuses status 'removed'), so a take-down cannot be undone by re-publishing.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, constraints dropped before added,
-- CREATE OR REPLACE, grants restated by role name. Proof:
-- src/test/pglite/homesPublicLink.pglite.mjs (3x).

-- ---------------------------------------------------------------------------
-- 1. Who took a listing down, and why (the owner sees the reason).
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS removed_by_admin boolean NOT NULL DEFAULT false;
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS removed_reason text;
ALTER TABLE public.rental_listings DROP CONSTRAINT IF EXISTS rental_listings_removed_reason_len;
ALTER TABLE public.rental_listings ADD CONSTRAINT rental_listings_removed_reason_len
  CHECK (removed_reason IS NULL OR char_length(removed_reason) BETWEEN 5 AND 500);

-- ---------------------------------------------------------------------------
-- 2. The admin take-down (Q2187).
CREATE OR REPLACE FUNCTION public.rentals_admin_remove_listing(p_listing_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_l public.rental_listings%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  -- Moderation is never gated by the feature switch (review fix #7): an admin can take a listing down
  -- whatever the 'rentals' audience is.
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 5 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_l FROM public.rental_listings WHERE id = p_listing_id FOR UPDATE;
  -- An owner-removed listing can still be taken down (it records who, why, and blocks re-posting);
  -- one already taken down cannot be taken down twice.
  IF NOT FOUND OR v_l.removed_by_admin THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.rental_listings
     SET status = 'removed', removed_by_admin = true, removed_reason = v_reason, updated_at = now()
   WHERE id = p_listing_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'rentals_listing_removed', 'rental_listing', p_listing_id::text,
          jsonb_build_object('reason', v_reason, 'kind', v_l.kind, 'status_before', v_l.status));
  PERFORM public.rentals_notify(v_l.owner_id, 'Listing removed',
    'Louisiana Helpr removed your listing "' || v_l.headline || '": ' || v_reason, '/rentals', true, true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_remove_listing(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_remove_listing(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Visible to the public: the signed-in rule, Homes open to everyone, a real (not test/seed) owner.
--    (rentals_listing_visible already excludes removed: it requires 'live'.)
CREATE OR REPLACE FUNCTION public.rentals_public_listing_visible(p_listing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- Public only once Homes is open to EVERYONE (not while testers-only), and never a test account's or
  -- seed account's listing (review fix #6).
  SELECT public.rentals_listing_visible(p_listing_id)
     AND EXISTS (SELECT 1 FROM public.feature_switches s WHERE s.key = 'rentals' AND s.audience = 'everyone')
     AND NOT EXISTS (SELECT 1 FROM public.rental_listings l
                      WHERE l.id = p_listing_id
                        AND (EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = l.owner_id)
                             OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = l.owner_id AND pr.is_seed IS TRUE)));
$fn$;
REVOKE ALL ON FUNCTION public.rentals_public_listing_visible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_public_listing_visible(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The public read (D12). No require_feature: the link works for anyone
--    while the switch is not off (a signed-out visitor has no audience).
CREATE OR REPLACE FUNCTION public.rentals_public_listing(p_slug text)
RETURNS TABLE (
  kind text,
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
  photo_ids uuid[],
  published_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT l.id INTO v_id FROM public.rental_listings l WHERE l.slug = p_slug;
  IF v_id IS NULL OR NOT public.rentals_public_listing_visible(v_id) THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  -- A stranger never gets home size + lot size + year built next to the ZIP of a home FOR SALE: together
  -- they name the parcel in the assessor's records (review fix #5). Signed-in members see them on the page.
  SELECT l.kind, l.headline, l.description, l.rent_cents, l.rent_frequency, l.deposit_cents, l.sale_price_cents,
         l.beds, l.baths,
         CASE WHEN l.kind = 'sale' THEN NULL ELSE l.sq_ft END,
         CASE WHEN l.kind = 'sale' THEN NULL ELSE l.lot_sq_ft END,
         CASE WHEN l.kind = 'sale' THEN NULL::smallint ELSE l.year_built END,
         l.available_on, l.lease_months_min, l.lease_months_max,
         l.pets, l.pet_rules, l.parking, l.utilities_included, l.accepts_vouchers, l.accessibility,
         rp.city, rp.zip_code,
         ARRAY(SELECT ph.id FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position),
         l.published_at
    FROM public.rental_listings l
    JOIN public.rental_properties rp ON rp.id = l.property_id
   WHERE l.id = v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_public_listing(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rentals_public_listing(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The photo proxy's lookup (server only): the object path for a photo of a
--    publicly visible listing, else NULL.
CREATE OR REPLACE FUNCTION public.rentals_public_listing_photo_path(p_photo_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT ph.storage_path
    FROM public.rental_listing_photos ph
   WHERE ph.id = p_photo_id
     AND public.rentals_public_listing_visible(ph.listing_id);
$fn$;
REVOKE ALL ON FUNCTION public.rentals_public_listing_photo_path(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_public_listing_photo_path(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Status: 20261019061241's body with one check added: publishing is
--    refused for a unit (rent) or property (sale) whose listing an admin took
--    down ('listing_taken_down').
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
    -- A take-down cannot be dodged by listing the same unit (rent) or property (sale) again (Q2187 review #4):
    -- a unit/property with a listing an admin took down never shows again without an admin.
    IF EXISTS (SELECT 1 FROM public.rental_listings x
                WHERE x.removed_by_admin
                  AND x.kind = v_l.kind
                  AND ((v_l.kind = 'rent' AND x.unit_id = v_l.unit_id)
                       OR (v_l.kind = 'sale' AND x.property_id = v_l.property_id))) THEN
      RAISE EXCEPTION 'listing_taken_down' USING ERRCODE = '42501';
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
