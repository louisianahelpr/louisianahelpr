-- Q1956 (lh-authz-rls review of shops slice 1, 2026-10-16; Builder 1 11-12 r4): a shop photo's type check trusted
-- the uploaded object's metadata. shops_attach_photo (logo / cover / gallery) and shops_add_item_photo accepted any
-- path whose storage.objects mimetype said image/jpeg, png or webp, and that mimetype is whatever the uploader's
-- browser sent: a non-image body under an image content type passed, and job-photos is a PUBLIC bucket.
-- FIX: the new edge function shop-photo-check (supabase/functions/shop-photo-check) reads the object's first 16 bytes as
-- service_role with the same Range read as shop-digital, matches them with _shared/digitalFileCheck.ts
-- (imageKindFromBytes: PNG / JPEG signatures from SIGNATURES, plus WebP RIFF....WEBP), deletes a mismatch, and stamps a
-- match in shop_photo_byte_checks (path, object id, owner, time) through shop_photo_stamp. Both RPCs now also require
-- a stamp by the caller from the last hour for the object now at that path (same storage.objects id), and use it up.
-- The id binding closes the swap the authz review found: stamp a real JPEG, delete it (the owner may delete an
-- unattached photo), upload other bytes to the same path, attach. The edge function takes the id BEFORE it reads
-- the bytes (shop_photo_object_id) and shop_photo_stamp writes only while that same object is still at the path, so
-- the bytes read are the stamped object's (job-photos has no member UPDATE policy on these folders). Members can neither read nor write the stamp table (RLS on, no policy, no grant).
-- The clients already re-encode to JPEG (cleanListingPhoto) and now call shop-photo-check between upload and attach.
-- Follow-up (authz re-review note 1): the object-id binding relies on no member UPDATE policy covering
-- <uid>/shops/ or <uid>/shop-items/ in job-photos (none today) and the clients uploading with upsert: false.
-- RESTATED FROM THE NEWEST CREATE, checked by name, verbatim plus the stamp condition and the DELETE, and (Q1957
-- review) a refusal 'shop_hidden' while shop_photos_held (defined in 20261112100000; resolved when called):
--   shops_attach_photo     from 20261103173728 (newest)
--   shops_add_item_photo   from 20261017061157 (newest; 20261103071058 only names it in a comment)
-- REPLAY-SAFE: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE. Grants unchanged on the RPCs (authenticated +
-- service_role, never PUBLIC or anon); the table is service_role only. MONEY: none. AUTHZ: lh-authz-rls.
-- Proof: src/test/pglite/shopsPhotoByteCheck.pglite.mjs (3x; NEW_MIGRATION=skip red).

CREATE TABLE IF NOT EXISTS public.shop_photo_byte_checks (
  storage_path text PRIMARY KEY,
  object_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.shop_photo_byte_checks IS
  'Q1956: a shop photo object whose first bytes the shop-photo-check edge function read as PNG, JPEG or WebP. Written by service_role only; shops_attach_photo / shops_add_item_photo require and use up a stamp from the last hour.';
ALTER TABLE public.shop_photo_byte_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_photo_byte_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_photo_byte_checks TO service_role;

-- The object now at a shop photo path, uploaded by this owner (the edge function asks BEFORE it reads the bytes).
CREATE OR REPLACE FUNCTION public.shop_photo_object_id(p_path text, p_owner uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT o.id FROM storage.objects o
   WHERE o.bucket_id = 'job-photos' AND o.name = p_path
     AND (o.owner_id = p_owner::text OR o.owner = p_owner)
   LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.shop_photo_object_id(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_photo_object_id(text, uuid) TO service_role;

-- Stamps the object whose bytes were read, only while that same object (id) is still at the path; true when stamped.
CREATE OR REPLACE FUNCTION public.shop_photo_stamp(p_path text, p_owner uuid, p_object_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_path IS NULL OR p_owner IS NULL OR p_object_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.id = p_object_id AND o.bucket_id = 'job-photos' AND o.name = p_path
          AND (o.owner_id = p_owner::text OR o.owner = p_owner)) THEN
    RETURN false;
  END IF;
  INSERT INTO public.shop_photo_byte_checks (storage_path, object_id, owner_id, checked_at)
  VALUES (p_path, p_object_id, p_owner, now())
  ON CONFLICT (storage_path) DO UPDATE
    SET object_id = EXCLUDED.object_id, owner_id = EXCLUDED.owner_id, checked_at = EXCLUDED.checked_at;
  -- Stamps never used (the attach was abandoned) are only rows; a day-old one is dropped here.
  DELETE FROM public.shop_photo_byte_checks WHERE checked_at < now() - interval '1 day';
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_photo_stamp(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_photo_stamp(text, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.shops_attach_photo(p_kind text, p_storage_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_shop uuid;
  v_pos smallint;
  v_old text;
  v_id uuid;
  v_constraint text;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT id INTO v_shop FROM public.shops WHERE owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- CHANGED (Q1957 review): a held shop (hidden, or its owner not in good standing) adds no photo: its photos sit in
  -- the private shop-photos-held bucket (20261112100000), and a new one would serve publicly until the mover ran.
  IF public.shop_photos_held(v_shop) THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('logo', 'cover', 'gallery') THEN
    RAISE EXCEPTION 'invalid_photo_kind' USING ERRCODE = '22023';
  END IF;
  -- The caller's own shops folder, and the object is really there, uploaded
  -- by the caller, an image (job-photos also takes video, which keeps GPS).
  IF p_storage_path IS NULL
     OR p_storage_path !~ '^[0-9a-f-]{36}/shops/[A-Za-z0-9._-]{1,100}$'
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640)
     -- CHANGED (Q1956): the mimetype above is what the uploader's browser said. The shop-photo-check edge function
     -- read the object's own first bytes (PNG, JPEG or WebP signature) and stamped THIS object (its id: a delete and
     -- re-upload at the same path is a new object, and the old stamp no longer matches) for this owner.
     OR NOT EXISTS (
       SELECT 1 FROM public.shop_photo_byte_checks c
         JOIN storage.objects so ON so.id = c.object_id
        WHERE c.storage_path = p_storage_path
          AND c.owner_id = v_uid
          AND c.checked_at > now() - interval '1 hour'
          AND so.bucket_id = 'job-photos'
          AND so.name = p_storage_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  -- The stamp is used once.
  DELETE FROM public.shop_photo_byte_checks WHERE storage_path = p_storage_path;

  IF p_kind = 'gallery' THEN
    SELECT g.p INTO v_pos
      FROM generate_series(0, 11) AS g(p)
     WHERE NOT EXISTS (SELECT 1 FROM public.shop_photos ph
                        WHERE ph.shop_id = v_shop AND ph.photo_kind = 'gallery' AND ph.position = g.p)
     ORDER BY g.p
     LIMIT 1;
    IF v_pos IS NULL THEN
      RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023', HINT = 'A shop has at most 12 photos.';
    END IF;
  ELSE
    v_pos := 0;
    DELETE FROM public.shop_photos
     WHERE shop_id = v_shop AND photo_kind = p_kind
     RETURNING storage_path INTO v_old;
  END IF;

  -- A path already attached (to this shop) is bad input, not a raw 23505:
  -- review finding 4. Only the storage_path key maps to it; any other unique
  -- violation (a position clash would be a bug: the shop row is locked FOR
  -- UPDATE above) is re-raised as it is (re-review note 3).
  BEGIN
    INSERT INTO public.shop_photos (shop_id, owner_id, photo_kind, storage_path, position)
    VALUES (v_shop, v_uid, p_kind, p_storage_path, v_pos)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'shop_photos_storage_path_key' THEN
      RAISE EXCEPTION 'photo_already_attached' USING ERRCODE = '22023';
    END IF;
    RAISE;
  END;
  UPDATE public.shops SET updated_at = now() WHERE id = v_shop;
  RETURN jsonb_build_object('id', v_id, 'replaced_path', v_old);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_attach_photo(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_attach_photo(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_add_item_photo(p_item_id uuid, p_storage_path text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.shop_items%ROWTYPE;
  v_pos smallint;
  v_id uuid;
  v_constraint text;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  v_item := public.shops_lock_own_item(p_item_id, v_uid);
  -- CHANGED (Q1957 review): a held shop adds no item photo either (see shops_attach_photo).
  IF public.shop_photos_held(v_item.shop_id) THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501';
  END IF;
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  -- The caller's own folder for THIS item, and the object is really there,
  -- uploaded by the caller, an image (job-photos also takes video, which keeps GPS).
  IF p_storage_path IS NULL
     OR p_storage_path !~ '^[0-9a-f-]{36}/shop-items/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_storage_path, '/', 3) IS DISTINCT FROM p_item_id::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640)
     -- CHANGED (Q1956): the mimetype above is what the uploader's browser said. The shop-photo-check edge function
     -- read the object's own first bytes (PNG, JPEG or WebP signature) and stamped THIS object (its id: a delete and
     -- re-upload at the same path is a new object, and the old stamp no longer matches) for this owner.
     OR NOT EXISTS (
       SELECT 1 FROM public.shop_photo_byte_checks c
         JOIN storage.objects so ON so.id = c.object_id
        WHERE c.storage_path = p_storage_path
          AND c.owner_id = v_uid
          AND c.checked_at > now() - interval '1 hour'
          AND so.bucket_id = 'job-photos'
          AND so.name = p_storage_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  -- The stamp is used once.
  DELETE FROM public.shop_photo_byte_checks WHERE storage_path = p_storage_path;
  SELECT g.p INTO v_pos
    FROM generate_series(0, 11) AS g(p)
   WHERE NOT EXISTS (SELECT 1 FROM public.shop_item_photos ph WHERE ph.item_id = p_item_id AND ph.position = g.p)
   ORDER BY g.p
   LIMIT 1;
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023', HINT = 'An item has at most 12 photos.';
  END IF;
  BEGIN
    INSERT INTO public.shop_item_photos (item_id, owner_id, storage_path, position)
    VALUES (p_item_id, v_uid, p_storage_path, v_pos)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'shop_item_photos_storage_path_key' THEN
      RAISE EXCEPTION 'photo_already_attached' USING ERRCODE = '22023';
    END IF;
    RAISE;
  END;
  UPDATE public.shop_items SET updated_at = now() WHERE id = p_item_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_add_item_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_add_item_photo(uuid, text) TO authenticated, service_role;
