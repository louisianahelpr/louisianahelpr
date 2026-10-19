-- HOMES: listing photos move to a PRIVATE bucket and every read serves them by
-- photo id through the listing-photo proxy (Q2211, Q2212, Q2213; homes launch
-- blockers, lead 2026-10-19 06:45Z).
--
-- WHAT WAS WRONG:
--   Q2211  Listing photos sat in job-photos, a PUBLIC bucket. An admin
--          take-down (rentals_admin_remove_listing) hid the listing from every
--          read, but each photo stayed fetchable forever at its public URL.
--   Q2213  rentals_browse_listings, rentals_browse_sale_listings and
--          rentals_listing handed every signed-in member raw storage paths,
--          and a path starts with the landlord's user id
--          (<owner uid>/rental-listings/<listing>/<file>), so any member could
--          learn which account listed a home.
--   Q2212  Location tags were removed only in the app (cleanListingPhoto). A
--          crafted upload kept its GPS EXIF, and the bucket served it as is.
--
-- WHAT THIS DOES:
-- 1. A private bucket, listing-photos (public = false, JPEG only, 15 MB: the
--    attach rule's size cap). Objects keep the path the RPCs already require,
--    <owner uid>/rental-listings/<listing id>/<file>, so account deletion purges
--    them by folder (_shared/purgeBuckets.ts). That path is now never handed to
--    anyone but its owner: there is no public URL, members get no raw read.
-- 2. storage.objects policies for the bucket, decided by
--    rentals_listing_photo_access(name, action):
--      INSERT  the owner, into their OWN folder, for their own listing while it
--              is a draft, live or paused and was not taken down;
--      SELECT  the owner's own folder, and admins (storage needs SELECT to
--              delete);
--      DELETE  the owner or an admin, an UNATTACHED object only.
-- 3. Every read returns PHOTO REFS, never paths: "<photo id>.<scope>.<exp>.<sig>",
--    signed in the database with a secret no client can read
--    (rentals_photo_serve_keys: RLS on, no policy, no grant). The scope says
--    which rule the proxy re-checks on every fetch:
--      p  the public link (rentals_public_listing): rentals_public_listing_visible
--      m  a member's browse / listing page: rentals_listing_visible
--      o  the owner's own listing (their page and editor): not removed
--    exp is the end of the NEXT whole hour (1-2 h out), so a page's photo URLs
--    stay the same for an hour and browsers cache them.
--    rentals_listing_photo_object(ref) (service_role only) verifies the
--    signature and expiry, re-checks the scope's rule and returns the object
--    path; the listing-photo edge function streams the re-encoded image.
-- 4. The proxy re-encodes through Storage's image renderer (format=origin, the
--    JPEG stays a JPEG) and strips every metadata segment (EXIF/GPS, XMP, IPTC,
--    comments) from the bytes it serves, the rendered ones and the capped
--    fallback alike (_shared/jpegStripMetadata.ts): server-side, whatever the
--    upload carried (Q2212).
-- 5. The admin take-down now DETACHES the listing's photos (the rows go, so the
--    photo ids stop resolving at once) and returns their paths so the admin
--    screen deletes the objects (rentals_admin_remove_listing, return type
--    void -> text[]).
-- 6. rentals_public_listing_photo_path (20261019062540, the id-only lookup) is
--    dropped: the public link now returns refs like every other read.
--
-- EXISTING PHOTOS: measured read-only on prod 2026-10-19 07:10Z:
-- rental_listings 0 rows, rental_listing_photos 0 rows, job-photos objects
-- under */rental-listings/* 0. A database migration cannot move Storage bytes,
-- so a photo row whose object is NOT in listing-photos is moved, never lost,
-- into rental_listing_photo_legacy (server-only) and its live listing, now
-- short of photos, is paused for its owner to re-add them. With 0 rows that is
-- a no-op on prod; it keeps a replay or a late upload safe.
--
-- Replay-safe: ON CONFLICT on the bucket and the key, DROP POLICY IF EXISTS,
-- DROP FUNCTION IF EXISTS before each changed return shape, CREATE OR REPLACE,
-- grants restated by role name. Proof: src/test/pglite/homesListingPhotos.pglite.mjs (3x).

-- ---------------------------------------------------------------------------
-- 1. The private bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('listing-photos', 'listing-photos', false, 15 * 1024 * 1024, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Who may upload, read or delete an object of the bucket, from its path.
CREATE OR REPLACE FUNCTION public.rentals_listing_photo_access(p_name text, p_action text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL OR p_name IS NULL OR p_action IS NULL
     -- Exactly <uid>/rental-listings/<listing>/<file>: no extra or empty segments.
     OR p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/rental-listings/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,100}$' THEN
    RETURN false;
  END IF;
  IF p_action = 'insert' THEN
    -- Only into your own folder, for your own listing while it can still take photos.
    RETURN split_part(p_name, '/', 1) = v_uid::text
       AND NOT public.is_caller_banned()
       AND EXISTS (SELECT 1 FROM public.rental_listings l
                    WHERE l.id = split_part(p_name, '/', 3)::uuid
                      AND l.owner_id = v_uid
                      AND l.status IN ('draft', 'live', 'paused')
                      AND NOT l.removed_by_admin);
  ELSIF p_action IN ('select', 'delete') THEN
    RETURN split_part(p_name, '/', 1) = v_uid::text OR public.has_role(v_uid, 'admin'::public.app_role);
  END IF;
  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_listing_photo_access(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_listing_photo_access(text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "listing-photos: the owner uploads into their own listing folder" ON storage.objects;
CREATE POLICY "listing-photos: the owner uploads into their own listing folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'listing-photos' AND public.rentals_listing_photo_access(name, 'insert'));

DROP POLICY IF EXISTS "listing-photos: the owner and admins read" ON storage.objects;
CREATE POLICY "listing-photos: the owner and admins read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'listing-photos' AND public.rentals_listing_photo_access(name, 'select'));

DROP POLICY IF EXISTS "listing-photos: the owner or an admin deletes an unattached photo" ON storage.objects;
CREATE POLICY "listing-photos: the owner or an admin deletes an unattached photo" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'listing-photos'
    AND public.rentals_listing_photo_access(name, 'delete')
    AND NOT EXISTS (SELECT 1 FROM public.rental_listing_photos p WHERE p.storage_path = objects.name)
  );

-- ---------------------------------------------------------------------------
-- 3. Photos already attached from job-photos: kept, server-only (see header).
CREATE TABLE IF NOT EXISTS public.rental_listing_photo_legacy (
  storage_path text PRIMARY KEY,
  bucket_id text NOT NULL DEFAULT 'job-photos',
  moved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rental_listing_photo_legacy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_listing_photo_legacy FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rental_listing_photo_legacy TO service_role;
COMMENT ON TABLE public.rental_listing_photo_legacy IS
  'Listing photo rows whose object was still in the public job-photos bucket when listing photos went private (20261019071203). Server-only; remove the objects with the service role.';

DO $mig$
DECLARE
  v_moved integer;
BEGIN
  WITH legacy AS (
    DELETE FROM public.rental_listing_photos ph
     WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'listing-photos' AND o.name = ph.storage_path)
    RETURNING ph.storage_path, ph.listing_id, ph.owner_id
  ), kept AS (
    -- The path alone (it names the owner's folder; account deletion purges job-photos/<uid>/rental-listings/).
    INSERT INTO public.rental_listing_photo_legacy (storage_path)
    SELECT storage_path FROM legacy
    ON CONFLICT (storage_path) DO NOTHING
    RETURNING storage_path
  ), paused AS (
    -- A live listing keeps at least 5 photos (Q11); one that lost photos here waits for its owner.
    UPDATE public.rental_listings l SET status = 'paused', updated_at = now()
     WHERE l.status = 'live'
       AND l.id IN (SELECT listing_id FROM legacy)
       -- Every sub-statement sees the rows as they were before the DELETE, hence the subtraction.
       AND (SELECT count(*) FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id)
           - (SELECT count(*) FROM legacy g WHERE g.listing_id = l.id) < 5
    RETURNING l.id
  )
  SELECT (SELECT count(*) FROM kept) INTO v_moved;
  IF v_moved > 0 THEN
    RAISE NOTICE 'rentals_listing_photos_private: % legacy job-photos listing photo row(s) moved to rental_listing_photo_legacy', v_moved;
  END IF;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 4. The serve key: read by the definer functions below (and nothing a client can call).
CREATE TABLE IF NOT EXISTS public.rentals_photo_serve_keys (
  id smallint PRIMARY KEY CHECK (id = 1),
  secret bytea NOT NULL CHECK (octet_length(secret) >= 32),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rentals_photo_serve_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rentals_photo_serve_keys FROM PUBLIC, anon, authenticated;
-- The server role only (it bypasses RLS anyway); no client role ever reads the key.
GRANT SELECT ON TABLE public.rentals_photo_serve_keys TO service_role;
-- 2 x gen_random_uuid() (the strong random source, no extension needed) = 244 random bits.
INSERT INTO public.rentals_photo_serve_keys (id, secret)
VALUES (1, decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'))
ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public.rentals_photo_serve_keys IS
  'The secret that signs listing photo refs (20261019071203). No policy, no client grant: rentals_photo_ref / rentals_listing_photo_object read it.';

-- The signature of one ref's message: sha256(k || sha256(k || msg)), the nested form (no length extension), 128 bits.
CREATE OR REPLACE FUNCTION public.rentals_photo_sig(p_msg text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT left(encode(sha256(k.secret || sha256(k.secret || convert_to(p_msg, 'UTF8'))), 'hex'), 32)
    FROM public.rentals_photo_serve_keys k
   WHERE k.id = 1;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_photo_sig(text) FROM PUBLIC, anon, authenticated, service_role;

-- One photo's ref for a scope ('p', 'm' or 'o'); valid until the end of the next whole hour.
CREATE OR REPLACE FUNCTION public.rentals_photo_ref(p_photo_id uuid, p_scope text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT m.msg || '.' || public.rentals_photo_sig(m.msg)
    FROM (SELECT p_photo_id::text || '.' || p_scope || '.'
                 || ((floor(extract(epoch FROM now()) / 3600)::bigint + 2) * 3600)::text AS msg) m
   WHERE p_photo_id IS NOT NULL AND p_scope IN ('p', 'm', 'o');
$fn$;
REVOKE ALL ON FUNCTION public.rentals_photo_ref(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The proxy's lookup (server only): the object path for a valid, unexpired
--    ref whose scope's rule still holds, else NULL. One answer for every refusal.
CREATE OR REPLACE FUNCTION public.rentals_listing_photo_object(p_ref text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_parts text[];
  v_photo uuid;
  v_scope text;
  v_exp bigint;
  v_path text;
  v_listing uuid;
  v_ok boolean;
BEGIN
  v_parts := regexp_match(coalesce(p_ref, ''),
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([pmo])\.([0-9]{10})\.([0-9a-f]{32})$');
  IF v_parts IS NULL THEN
    RETURN NULL;
  END IF;
  v_photo := v_parts[1]::uuid;
  v_scope := v_parts[2];
  v_exp := v_parts[3]::bigint;
  -- Expired, or further out than any ref this database mints (2 h + a minute of clock slack).
  IF v_exp <= extract(epoch FROM now()) OR v_exp > extract(epoch FROM now()) + 7260 THEN
    RETURN NULL;
  END IF;
  IF public.rentals_photo_sig(v_parts[1] || '.' || v_scope || '.' || v_parts[3]) IS DISTINCT FROM v_parts[4] THEN
    RETURN NULL;
  END IF;
  SELECT ph.storage_path, ph.listing_id INTO v_path, v_listing
    FROM public.rental_listing_photos ph
    JOIN public.rental_listings l ON l.id = ph.listing_id
   WHERE ph.id = v_photo
     AND l.status <> 'removed'
     AND NOT l.removed_by_admin;
  IF v_path IS NULL THEN
    RETURN NULL;
  END IF;
  v_ok := CASE v_scope
            WHEN 'p' THEN public.rentals_public_listing_visible(v_listing)
            WHEN 'm' THEN public.rentals_listing_visible(v_listing)
            ELSE true
          END;
  RETURN CASE WHEN v_ok THEN v_path END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_listing_photo_object(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_listing_photo_object(text) TO service_role;

DROP FUNCTION IF EXISTS public.rentals_public_listing_photo_path(uuid);

-- ---------------------------------------------------------------------------
-- 6. Attach: the newest body (20261019061241) with the object in listing-photos
--    (JPEG only, as the bucket takes) instead of job-photos.
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
  -- The caller's own folder for THIS listing, and the object is really there in
  -- the PRIVATE listing-photos bucket, uploaded by the caller, a JPEG.
  IF p_storage_path IS NULL
     OR p_storage_path !~ '^[0-9a-f-]{36}/rental-listings/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_storage_path, '/', 3) IS DISTINCT FROM p_listing_id::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'listing-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          AND o.metadata ->> 'mimetype' = 'image/jpeg'
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

-- ---------------------------------------------------------------------------
-- 7. The owner's editor: their listing's photos as owner refs, in order. No path.
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
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
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

-- ---------------------------------------------------------------------------
-- 8. Reads: the newest bodies (20261019061241, 20261019062540) with photo_refs
--    in place of photo_paths / photo_ids. The return shape changes, so each is
--    dropped first.
DROP FUNCTION IF EXISTS public.rentals_browse_listings(text, numeric, integer, integer, integer);
CREATE FUNCTION public.rentals_browse_listings(
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
  photo_refs text[],
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
         ARRAY(SELECT public.rentals_photo_ref(ph.id, 'm') FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position LIMIT 5),
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

DROP FUNCTION IF EXISTS public.rentals_browse_sale_listings(text, numeric, bigint, integer, integer);
CREATE FUNCTION public.rentals_browse_sale_listings(
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
  photo_refs text[],
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
         ARRAY(SELECT public.rentals_photo_ref(ph.id, 'm') FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position LIMIT 5),
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
  photo_refs text[],
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
         -- The owner's own page shows a draft or paused listing too: owner refs; anyone else's are member refs.
         ARRAY(SELECT public.rentals_photo_ref(ph.id, CASE WHEN l.owner_id = v_uid THEN 'o' ELSE 'm' END)
                 FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position),
         l.owner_id = v_uid, l.published_at, l.expires_at
    FROM public.rental_listings l
    JOIN public.rental_properties rp ON rp.id = l.property_id
   WHERE l.id = p_listing_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_listing(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.rentals_public_listing(text);
CREATE FUNCTION public.rentals_public_listing(p_slug text)
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
  photo_refs text[],
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
         ARRAY(SELECT public.rentals_photo_ref(ph.id, 'p') FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position),
         l.published_at
    FROM public.rental_listings l
    JOIN public.rental_properties rp ON rp.id = l.property_id
   WHERE l.id = v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_public_listing(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rentals_public_listing(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. The admin take-down: the newest body (20261019062540), and it DETACHES
--    the listing's photos (their ids stop resolving at once) and returns the
--    object paths for the admin screen to delete. void -> text[], so dropped first.
DROP FUNCTION IF EXISTS public.rentals_admin_remove_listing(uuid, text);
CREATE FUNCTION public.rentals_admin_remove_listing(p_listing_id uuid, p_reason text)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_l public.rental_listings%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_paths text[];
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
  -- Q2211: the photos are detached (no ref resolves any more) and their objects handed back for deletion.
  WITH gone AS (
    DELETE FROM public.rental_listing_photos WHERE listing_id = p_listing_id RETURNING storage_path
  )
  SELECT coalesce(array_agg(storage_path ORDER BY storage_path), ARRAY[]::text[]) INTO v_paths FROM gone;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'rentals_listing_removed', 'rental_listing', p_listing_id::text,
          jsonb_build_object('reason', v_reason, 'kind', v_l.kind, 'status_before', v_l.status,
                             'photos_detached', cardinality(v_paths)));
  PERFORM public.rentals_notify(v_l.owner_id, 'Listing removed',
    'Louisiana Helpr removed your listing "' || v_l.headline || '": ' || v_reason, '/rentals', true, true);
  RETURN v_paths;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_remove_listing(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_remove_listing(uuid, text) TO authenticated, service_role;
