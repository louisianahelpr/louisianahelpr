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
--      SELECT  the owner's own folder only, never a taken-down listing's
--              (admins read no originals: the purge cron runs as the server,
--              lead review round 3 #3);
--      DELETE  the owner, their own UNATTACHED object only (the purge cron
--              deletes the rest, as the server).
-- 3. Every read returns PHOTO REFS, never paths: "<photo id>.<scope>.<exp>.<sig>",
--    signed in the database with a secret no client can read
--    (rentals_photo_serve_keys: RLS on, no policy, no grant). The scope says
--    which rule the proxy re-checks on every fetch:
--      p  the public link (rentals_public_listing): rentals_public_listing_visible
--      m  a member's browse / listing page: rentals_listing_visible, switch not off
--      o  the owner's own listing (their page and editor): not removed, switch not off
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
-- 5. The admin take-down (on the property, 20261019062540) HIDES the photos of
--    every listing it removes and keeps them, so a mistaken take-down is fully
--    reversible (lead review round 3 #1): no ref resolves for a removed
--    listing, and the owner can no longer read (sign) or delete the objects of
--    a taken-down listing's folder. Each photo is queued in
--    rental_photo_purge_queue for 30 days later; the listing-photo-purge cron
--    (service role) deletes it then through the Storage API, unless the
--    take-down was lifted (round 3 #2: never a storage.objects row deleted in
--    SQL, which would orphan bytes the account purge cannot find). EVERY
--    object under a removed listing's folder is queued, attached or not (lead
--    round 3 #4). Purge vs lift (lead round 3 #1): the purge CLAIMS what it
--    hands out (row-locked, re-checked: still taken down); the lift locks the
--    property's entries, refuses while a claim is fresh (photos_purging) and
--    otherwise drops them; purge_done acts only on claimed entries.
-- 6. rentals_public_listing_photo_path (20261019062540, the id-only lookup) is
--    dropped: the public link now returns refs like every other read.
--
-- EXISTING PHOTOS: measured read-only on prod 2026-10-19 07:10Z:
-- rental_listings 0 rows, rental_listing_photos 0 rows, job-photos objects
-- under */rental-listings/* 0. A database migration cannot move Storage bytes,
-- so any listing photo still in the PUBLIC job-photos bucket is detached here
-- (no read serves it) and queued for the purge cron, which removes the object
-- through the Storage API; until then its old public URL may still answer (and
-- a CDN may keep a copy for a while after): no 404 is promised by this file. A
-- live listing left short of photos is paused for its owner to add them again.
-- With 0 rows that is a no-op on prod.
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
  ELSIF p_action = 'select' THEN
    -- The owner reads (signs) their own folder, except a taken-down listing's photos (round 3 #1). Admins read
    -- no originals (round 3 #3): moderation sees what members see, and the purge runs as the server.
    RETURN split_part(p_name, '/', 1) = v_uid::text
       AND NOT EXISTS (SELECT 1 FROM public.rental_listings l
                        WHERE l.id = split_part(p_name, '/', 3)::uuid AND l.removed_by_admin);
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
DROP POLICY IF EXISTS "listing-photos: the owner reads" ON storage.objects;
CREATE POLICY "listing-photos: the owner reads" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'listing-photos' AND public.rentals_listing_photo_access(name, 'select'));

-- May the CALLER delete this object? Only from their own folder, only when it is attached to nothing, and
-- never a taken-down listing's (kept for a lift). Answered as the definer, never through the caller's
-- switch-gated RLS (review #4), and scoped to the caller's own folder so it tells nobody anything about
-- another member's listings (round 3 #4). Admins delete nothing here: the purge cron does, as the server.
CREATE OR REPLACE FUNCTION public.rentals_listing_photo_deletable(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND public.rentals_listing_photo_access(p_name, 'select')
     AND split_part(p_name, '/', 1) = (SELECT auth.uid())::text
     AND NOT EXISTS (SELECT 1 FROM public.rental_listing_photos p WHERE p.storage_path = p_name);
$fn$;
REVOKE ALL ON FUNCTION public.rentals_listing_photo_deletable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_listing_photo_deletable(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "listing-photos: the owner or an admin deletes an unattached photo" ON storage.objects;
DROP POLICY IF EXISTS "listing-photos: the owner deletes an unattached photo" ON storage.objects;
CREATE POLICY "listing-photos: the owner deletes an unattached photo" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'listing-photos' AND public.rentals_listing_photo_deletable(name));

-- ---------------------------------------------------------------------------
-- 2b. The purge queue: objects the listing-photo-purge cron deletes through the
--     Storage API once due (a take-down's photos 30 days on, legacy ones at once).
CREATE TABLE IF NOT EXISTS public.rental_photo_purge_queue (
  bucket_id text NOT NULL CHECK (bucket_id IN ('listing-photos', 'job-photos')),
  storage_path text NOT NULL,
  due_at timestamptz NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set when rentals_photo_purge_due hands the entry to the cron (round 3 #1): a lift refuses while a claim is
  -- fresh (the cron may be deleting those objects right now), and a stale claim is handed out again.
  claimed_at timestamptz,
  PRIMARY KEY (bucket_id, storage_path)
);
ALTER TABLE public.rental_photo_purge_queue ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.rental_photo_purge_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_photo_purge_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rental_photo_purge_queue TO service_role;
COMMENT ON TABLE public.rental_photo_purge_queue IS
  'Listing photo objects the listing-photo-purge cron deletes through the Storage API (20261019071203). Server-only.';

-- The listing a listing-photos path belongs to (<owner>/rental-listings/<listing>/<file>), else NULL.
CREATE OR REPLACE FUNCTION public.rentals_photo_path_listing(p_path text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN split_part(p_path, '/', 2) = 'rental-listings'
                AND split_part(p_path, '/', 3) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN split_part(p_path, '/', 3)::uuid END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_photo_path_listing(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_photo_path_listing(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Listing photos still in the PUBLIC job-photos bucket: out of it (see header).
DO $mig$
DECLARE
  v_paths text[];
BEGIN
  WITH legacy AS (
    DELETE FROM public.rental_listing_photos ph
     WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'listing-photos' AND o.name = ph.storage_path)
    RETURNING ph.storage_path, ph.listing_id
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
  SELECT array_agg(storage_path ORDER BY storage_path) INTO v_paths FROM legacy;
  IF v_paths IS NOT NULL THEN
    -- Removed through the Storage API by the purge cron (never a storage.objects row deleted in SQL).
    INSERT INTO public.rental_photo_purge_queue (bucket_id, storage_path, due_at, reason)
    SELECT 'job-photos', x, now(), 'legacy public listing photo' FROM unnest(v_paths) x
    ON CONFLICT (bucket_id, storage_path) DO NOTHING;
    RAISE NOTICE 'rentals_listing_photos_private: % listing photo(s) detached from job-photos and queued for the purge: %', cardinality(v_paths), v_paths;
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
  -- The Homes switch is a kill switch for every ref (lead review of Q2211 #2): switched off, nothing is served.
  -- p already requires Homes open to everyone (rentals_public_listing_visible).
  IF v_scope IN ('m', 'o')
     AND NOT EXISTS (SELECT 1 FROM public.feature_switches fs WHERE fs.key = 'rentals' AND fs.audience <> 'off') THEN
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
  -- Nor a headline or description that could name the street, the year or the lot (must-fix 4): for a home
  -- for sale a stranger gets a plain headline and no description; signed-in members read the owner's words.
  SELECT l.kind,
         CASE WHEN l.kind = 'sale' THEN trim_scale(l.beds)::text || ' bed, ' || trim_scale(l.baths)::text || ' bath home for sale'
              ELSE l.headline END,
         CASE WHEN l.kind = 'sale' THEN NULL ELSE l.description END,
         l.rent_cents, l.rent_frequency, l.deposit_cents, l.sale_price_cents,
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
-- 9. The admin take-down: the newest body (20261019062540, on the property),
--    and it queues the photos of every listing it removes for the purge cron
--    30 days on (held, not deleted: a lift restores them), paths in the audit log.
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
  v_ids uuid[];
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Only a listing people can see or the owner can put back up (live or paused); history (sold, leased,
  -- removed) is not taken down (lead review must-fix 6).
  IF v_l.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'listing_not_live' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.rental_properties WHERE id = v_l.property_id FOR UPDATE;
  UPDATE public.rental_properties
     SET listings_taken_down_at = now(), listings_taken_down_reason = v_reason
   WHERE id = v_l.property_id;
  -- Every OPEN listing on the property goes, either kind, any unit (must-fix 2).
  WITH gone AS (
    UPDATE public.rental_listings
       SET removed_from_status = status, status = 'removed', removed_by_admin = true, removed_reason = v_reason,
           updated_at = now()
     WHERE property_id = v_l.property_id AND status IN ('draft', 'live', 'paused')
    RETURNING id
  )
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM gone;
  -- Q2211 (round 3 #1, #2): the photos stay attached but unreachable (no ref resolves for a removed
  -- listing; the owner can no longer sign them), so a lift restores them. They are queued for the purge
  -- cron 30 days on; the cron skips (and drops) any whose listing was restored by a lift.
  -- Round 3 #4: EVERY object under each removed listing's folder is queued, attached or not (an upload never
  -- attached would otherwise stay forever: its owner can no longer read or delete it). Reading
  -- storage.objects is fine; only the cron deletes, through the Storage API.
  SELECT array_agg(DISTINCT x.path ORDER BY x.path) INTO v_paths
    FROM (SELECT ph.storage_path AS path FROM public.rental_listing_photos ph WHERE ph.listing_id = ANY (v_ids)
          UNION
          SELECT o.name FROM storage.objects o
            JOIN public.rental_listings l ON l.id = ANY (v_ids)
           WHERE o.bucket_id = 'listing-photos'
             AND o.name LIKE l.owner_id::text || '/rental-listings/' || l.id::text || '/%') x;
  IF v_paths IS NOT NULL THEN
    INSERT INTO public.rental_photo_purge_queue (bucket_id, storage_path, due_at, reason)
    SELECT 'listing-photos', x, now() + interval '30 days', 'take-down of listing ' || p_listing_id::text FROM unnest(v_paths) x
    ON CONFLICT (bucket_id, storage_path) DO UPDATE SET due_at = EXCLUDED.due_at, reason = EXCLUDED.reason, claimed_at = NULL;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'rentals_listing_removed', 'rental_listing', p_listing_id::text,
          jsonb_build_object('reason', v_reason, 'kind', v_l.kind, 'status_before', v_l.status,
                             'property_id', v_l.property_id, 'listings_removed', to_jsonb(v_ids),
                             'photos_held', to_jsonb(coalesce(v_paths, ARRAY[]::text[])),
                             'photos_purge_after', now() + interval '30 days'));
  PERFORM public.rentals_notify(v_l.owner_id, 'Listing removed',
    'Louisiana Helpr removed your listing "' || v_l.headline || '": ' || v_reason, '/rentals', true, true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_remove_listing(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_remove_listing(uuid, text) TO authenticated, service_role;

-- 9b. The lift: the newest body (20261019062540), and it drops the property's purge-queue entries under a lock,
--     refusing while the purge cron holds a fresh claim on any of them (round 3 #1).
CREATE OR REPLACE FUNCTION public.rentals_admin_lift_takedown(p_property_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_p public.rental_properties%ROWTYPE;
  v_note text := btrim(coalesce(p_note, ''));
  v_ids uuid[];
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) < 5 OR char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_p FROM public.rental_properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND OR v_p.listings_taken_down_at IS NULL THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Round 3 #1 (purge vs lift): lock this property's queue entries first. A claim younger than 15 minutes
  -- means the purge cron may be deleting those objects right now: refuse (nothing changes; try again later)
  -- rather than restore listings whose photos are going. An older claim (a run that died part way, lead
  -- round 4 #2) may have removed some objects already: refuse too unless every claimed object is still in
  -- Storage (its storage.objects row; read only, never deleted here). Otherwise the entries are dropped.
  PERFORM 1 FROM public.rental_photo_purge_queue q
    JOIN public.rental_listings l ON l.id = public.rentals_photo_path_listing(q.storage_path)
   WHERE q.bucket_id = 'listing-photos' AND l.property_id = p_property_id
     FOR UPDATE OF q;
  IF EXISTS (SELECT 1 FROM public.rental_photo_purge_queue q
               JOIN public.rental_listings l ON l.id = public.rentals_photo_path_listing(q.storage_path)
              WHERE q.bucket_id = 'listing-photos' AND l.property_id = p_property_id
                AND (q.claimed_at > now() - interval '15 minutes'
                     OR (q.claimed_at IS NOT NULL
                         AND NOT EXISTS (SELECT 1 FROM storage.objects o
                                          WHERE o.bucket_id = 'listing-photos' AND o.name = q.storage_path)))) THEN
    RAISE EXCEPTION 'photos_purging' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.rental_photo_purge_queue q
   USING public.rental_listings l
   WHERE q.bucket_id = 'listing-photos' AND l.id = public.rentals_photo_path_listing(q.storage_path)
     AND l.property_id = p_property_id;
  UPDATE public.rental_properties SET listings_taken_down_at = NULL, listings_taken_down_reason = NULL WHERE id = p_property_id;
  WITH back AS (
    UPDATE public.rental_listings
       SET status = CASE WHEN removed_from_status = 'draft' THEN 'draft' ELSE 'paused' END,
           removed_by_admin = false, removed_reason = NULL, removed_from_status = NULL, updated_at = now()
     WHERE property_id = p_property_id AND removed_by_admin AND status = 'removed' AND removed_from_status IS NOT NULL
    RETURNING id
  )
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM back;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'rentals_takedown_lifted', 'rental_property', p_property_id::text,
          jsonb_build_object('note', v_note, 'reason_was', v_p.listings_taken_down_reason, 'listings_restored', to_jsonb(v_ids)));
  PERFORM public.rentals_notify(v_p.owner_id, 'Listing back',
    'Louisiana Helpr lifted the removal of your listings at ' || v_p.label || '. Open them to publish again.', '/rentals', true, true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_lift_takedown(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_lift_takedown(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. The purge (server only; the listing-photo-purge edge function, daily).
--     Due entries, oldest first. A take-down entry whose listing was restored by
--     a lift is dropped here and never returned (its photo stays).
CREATE OR REPLACE FUNCTION public.rentals_photo_purge_due(p_limit integer DEFAULT 200)
RETURNS TABLE (bucket_id text, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- A lift drops its own entries; any left whose listing is no longer taken down are dropped here too.
  DELETE FROM public.rental_photo_purge_queue q
   USING public.rental_listings l
   WHERE q.bucket_id = 'listing-photos'
     AND l.id = public.rentals_photo_path_listing(q.storage_path)
     AND NOT l.removed_by_admin;
  -- Round 3 #1: CLAIM what is due, row-locked (SKIP LOCKED: an entry a lift is holding is not handed out), each
  -- re-checked: a listing-photos entry only while its listing is still taken down (or gone with its account).
  -- A lift refuses while a claim is fresh, so nothing handed out here is restored before the cron removes it.
  -- A claim older than 15 minutes (a run that died) is handed out again.
  RETURN QUERY
  WITH pick AS (
    SELECT q.bucket_id AS b, q.storage_path AS sp
      FROM public.rental_photo_purge_queue q
     WHERE q.due_at <= now()
       AND (q.claimed_at IS NULL OR q.claimed_at <= now() - interval '15 minutes')
       AND (q.bucket_id <> 'listing-photos'
            OR NOT EXISTS (SELECT 1 FROM public.rental_listings l
                            WHERE l.id = public.rentals_photo_path_listing(q.storage_path) AND NOT l.removed_by_admin))
     ORDER BY q.due_at, q.storage_path
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
       FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE public.rental_photo_purge_queue q
     SET claimed_at = now()
    FROM pick
   WHERE q.bucket_id = pick.b AND q.storage_path = pick.sp
  RETURNING q.bucket_id, q.storage_path;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_photo_purge_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_photo_purge_due(integer) TO service_role;

-- After Storage removed them: the photo rows of a still-taken-down listing go, and the CLAIMED queue entries
-- (an entry re-queued by a new take-down since, claimed_at NULL again, stays for its own turn).
CREATE OR REPLACE FUNCTION public.rentals_photo_purge_done(p_bucket text, p_paths text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_done text[];
BEGIN
  -- Only what this purge claimed (row-locked): a path reported done that was never handed out changes nothing.
  WITH gone AS (
    DELETE FROM public.rental_photo_purge_queue q
     WHERE q.bucket_id = p_bucket AND q.storage_path = ANY (p_paths) AND q.claimed_at IS NOT NULL
    RETURNING q.storage_path
  )
  SELECT array_agg(storage_path) INTO v_done FROM gone;
  IF p_bucket = 'listing-photos' AND v_done IS NOT NULL THEN
    DELETE FROM public.rental_listing_photos ph
     USING public.rental_listings l
     WHERE l.id = ph.listing_id AND l.removed_by_admin AND ph.storage_path = ANY (v_done);
  END IF;
  RETURN coalesce(cardinality(v_done), 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_photo_purge_done(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_photo_purge_done(text, text[]) TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('listing-photo-purge', interval '26 hours',
            'Homes (Q2211): daily, deletes through the Storage API the listing photos of a take-down not lifted within 30 days, and any listing photo left in the public job-photos bucket.',
            'exempt',
            'With no take-down older than 30 days and no legacy photo, a run that deletes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('listing-photo-purge', '41 9 * * *', $c$SELECT public.cron_http_tag(q.request_id, 'listing-photo-purge')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 90000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/listing-photo-purge',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      )
) AS q(request_id);$c$);
  END IF;
END
$do$;

-- cronCatchUpPolicy (Q30) reads the NEWEST migration that seeds public.cron_catchup_policy as the whole
-- policy, so this restates every row of 20261018035944 verbatim plus listing-photo-purge (never re-run late).
DO $do$
BEGIN
  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    EXECUTE $pol$
INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason) VALUES
  ('ops-daily-digest',                true,  interval '20 hours', 'Slack digest of the last 24h of ops alerts; writes only its own delivery receipt. A late digest is the Q30 case itself: 09-22 went 38h with none.'),
  ('sweep-daily-job-digest',          true,  interval '6 hours',  'In-app "New jobs in <parish>" digest; its own NOT EXISTS skips anyone digested in the last 23h, so it cannot double-send. Capped at 6h because a late run shifts the next day''s by that 23h dedupe.'),
  ('push-token-health',               true,  interval '20 hours', 'Monitor (Q82): counts push tokens and writes at most one error_logs row per UTC day. Read-only otherwise.'),
  ('marketing-token-health',          true,  interval '20 hours', 'Monitor: checks the Meta token and that the publish queue drains; reads and alerts only.'),
  ('money-reconciliation',            true,  interval '20 hours', 'STRICTLY READ-ONLY by design (header of supabase/functions/money-reconciliation/index.ts): selects and Stripe paymentIntents.retrieve only. Reports money drift, never moves money.'),
  ('detect-suspicious-user-patterns', true,  interval '20 hours', 'Inserts a fraud_flags row only when no unresolved flag of that type exists for the user; its windows are relative to now(). Re-running is idempotent.'),
  ('sweep-old-email-send-log',        true,  interval '20 hours', 'Age-based TTL delete: a late run deletes exactly what the next run would. Idempotent.'),
  ('sweep-old-notifications',         true,  interval '20 hours', 'Age-based TTL delete of old notifications. Idempotent.'),
  ('sweep-old-error-logs',            true,  interval '20 hours', 'Age-based TTL delete of old error_logs. Idempotent.'),
  ('prune-cron-run-details',          true,  interval '20 hours', 'Deletes cron.job_run_details older than 7 days; the catch-up reads only the latest slot. Idempotent.'),
  ('prune-cron-run-log',              true,  interval '20 hours', 'Age-based prune of cron_run_log. Idempotent.'),
  ('prune-edge-rate-limit-log',       true,  interval '20 hours', 'Age-based prune of the edge rate-limit log. Idempotent.'),
  ('cleanup-notifications',           true,  interval '20 hours', 'Deletes READ notifications older than 30 days (age-based). Idempotent.'),
  ('stalled-completion-reminder',     true,  interval '6 hours',  'User nudge with its own per-job ledger (first_sent_at / second_sent_at / escalated_at, upsert ignoreDuplicates): a stage is never sent twice. 6h cap keeps it inside daytime.'),
  ('review-nag-cron',                 true,  interval '6 hours',  'User nudge with its own dedupe count per user and job inside WINDOW_HOURS, failing closed (unreadable count = already nagged). 6h cap keeps it inside daytime.'),
  ('engagement-automations',          true,  interval '6 hours',  'Lifecycle emails spaced by last_drip_at / last_approval_email_at, which it stamps on send: a late run cannot send a step twice. 6h cap keeps it inside daytime.'),
  ('charge-recurring-visits',         false, interval '1 hour',   'CHARGES CARDS for recurring visits. Money is never auto-rerun: a person checks what the missed day should have charged.'),
  ('expire-subscriptions',            false, interval '1 hour',   'Ends paid entitlements (one-time passes, lapsed tiers). Changes what a paying user has; a person decides.'),
  ('subscription-reconciliation',     false, interval '1 hour',   'REPAIRS tier state from Stripe (its header: "why this one repairs"). An automated entitlement writer is not re-run blind; a person decides.'),
  ('cleanup-abandoned-accounts',      false, interval '1 hour',   'DELETES accounts. Destructive; never re-run automatically.'),
  ('weekly-helper-report',            true,  interval '6 hours',  'Q188: weekly in-app report now skips any helper who already has one from the last 6 days (supabase/functions/weekly-helper-report, tested in src/test/edge/weekly-helper-report.test.ts), so a late run cannot send twice. 6h cap keeps it inside daytime.'),
  ('cleanup-stripe-webhook-events',   true,  interval '20 hours', 'Q167: deletes stripe_webhook_events processed over 30 days ago; the window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('cleanup-observability-tables',    true,  interval '20 hours', 'Q167: deletes analytics_events over 90 days and error_logs over 30; relative windows, idempotent, so a late run is the same prune.'),
  ('prune-retention-tables',          true,  interval '20 hours', 'CJ-003/CS-003: age-based deletes (login_history, notification_logs, profile_views, job_views, rate logs, W-9s over 4 years); every window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('purge-old-seed-data',             true,  interval '20 hours', 'Q65: age-based purge of is_seed test jobs (never money, never a fixture id, never profiles) and seed notifications; the window is relative to now() and every run is bounded and recorded, so a late run is the same purge.'),
  ('unfilled-series-visit-reminders', false, interval '1 hour',   'Tells a poster an empty series visit is TOMORROW (20261012195747). The text is relative to the run''s own day, so a late run past midnight would name the wrong day; its own once-per-visit ledger already stops a double send. Not re-run late.'),
  ('declutter-price-drops',           false, interval '1 hour',   'Declutter evening price drop (20261014210518): once per Louisiana day; a missed evening is simply skipped and the next evening drops 5% as usual. Not re-run late: a late run past midnight would spend the NEXT day''s drop.'),
  ('listing-photo-purge', false, interval '1 hour', 'Homes listing photo purge (20261019071203): deletes taken-down listings'' photos through the Storage API. Deletion is never re-run late; the next daily run deletes whatever is due.')
ON CONFLICT (jobname) DO UPDATE
  SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
      reason = EXCLUDED.reason, updated_at = now();
    $pol$;
  END IF;
END
$do$;
