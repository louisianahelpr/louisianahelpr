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
  PERFORM public.require_feature('rentals');
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
  IF NOT FOUND OR v_l.status = 'removed' THEN
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
-- 3. Visible to the public: the signed-in rule plus the switch not being off.
--    (rentals_listing_visible already excludes removed: it requires 'live'.)
CREATE OR REPLACE FUNCTION public.rentals_public_listing_visible(p_listing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT public.rentals_listing_visible(p_listing_id)
     AND EXISTS (SELECT 1 FROM public.feature_switches s WHERE s.key = 'rentals' AND s.audience <> 'off');
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
  SELECT l.kind, l.headline, l.description, l.rent_cents, l.rent_frequency, l.deposit_cents, l.sale_price_cents,
         l.beds, l.baths, l.sq_ft, l.lot_sq_ft, l.year_built, l.available_on, l.lease_months_min, l.lease_months_max,
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
