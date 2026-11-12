-- Shops audit 11-12 S009 (Medium): a seller can add and remove photos on a LIVE item.
--
-- Before: shops_add_item_photo and shops_remove_item_photo refused anything but a draft and the editor hid the
-- photo section, so the only way to change a live item's photos was to take it down and list it again.
--
-- Now (restated verbatim from their newest bodies, only the marked blocks change):
--   shops_add_item_photo (20261112095000): draft or live. The Q1956 byte-check stamp, the shop_hidden (Q1957) and
--     own-item rules are unchanged. pending_review (waiting for an admin) still refuses.
--   shops_remove_item_photo (20261103083559): draft or live; a live item keeps at least 3 photos (photos_required),
--     the floor shops_publish_item asks for.
--   shops_record_item_ai_check (20261103084609): may judge a LIVE item whose verdict was cleared (the photo trigger
--     shop_item_photos_void_ai_check clears the verdict and any admin approval on every added or removed photo),
--     never one already judged or approved since. A flag takes the live item off the shop for an admin
--     (pending_review, as a flagged live title edit does) and tells the seller. No flag: it stays live.
--   The declutter-ai-draft edge function reads a draft or live shop item for a check (draft only for suggestions).
--   This is how Declutter treats a live listing (declutter_record_ai_check): live at once, held only on a flag.
-- AUTHZ: two member RPCs and one service_role RPC restated; grants unchanged. MONEY: no.
-- REPLAY-SAFE: CREATE OR REPLACE only.
-- Proof: src/test/pglite/shopsLiveItemPhotos.pglite.mjs.

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
  -- CHANGED (S009): a LIVE item takes new photos too. The photo trigger (shop_item_photos_void_ai_check) clears the
  -- AI verdict and any admin approval, so the editor re-runs the photo check on the live item and
  -- shops_record_item_ai_check holds it only on a flag. An item waiting for an admin (pending_review) still cannot
  -- change its photos: the flag the admin is looking at must not be washed off.
  IF v_item.status NOT IN ('draft', 'live') THEN
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

CREATE OR REPLACE FUNCTION public.shops_remove_item_photo(p_photo_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item_id uuid;
  v_item public.shop_items%ROWTYPE;
  v_path text;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT item_id INTO v_item_id FROM public.shop_item_photos WHERE id = p_photo_id AND owner_id = v_uid;
  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_item := public.shops_lock_own_item(v_item_id, v_uid);
  -- CHANGED (S009): a LIVE item can drop a photo too, but keeps the 3 that publishing asks for. Not while it waits
  -- for an admin (pending_review).
  IF v_item.status NOT IN ('draft', 'live') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF v_item.status = 'live' AND (SELECT count(*) FROM public.shop_item_photos WHERE item_id = v_item_id) <= 3 THEN
    RAISE EXCEPTION 'photos_required' USING ERRCODE = '22023', HINT = 'A live item keeps at least 3 photos.';
  END IF;
  DELETE FROM public.shop_item_photos WHERE id = p_photo_id AND owner_id = v_uid
  RETURNING storage_path INTO v_path;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'PT404';
  END IF;
  UPDATE public.shop_items SET updated_at = now() WHERE id = v_item_id;
  RETURN v_path;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_remove_item_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_remove_item_photo(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_record_item_ai_check(
  p_item_id uuid,
  p_owner_id uuid,
  p_judged_photo_ids uuid[],
  p_judged_kind text,
  p_judged_subtype text,
  p_judged_title text,
  p_judged_description text,
  p_flag_reason text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_item public.shop_items%ROWTYPE;
  v_current uuid[];
  v_at timestamptz := now();
  v_flag text := NULLIF(left(btrim(COALESCE(p_flag_reason, '')), 300), '');
BEGIN
  -- CHANGED (S009): a draft, or a LIVE item whose photos changed (the photo trigger cleared its verdict and any
  -- approval). A live item already judged, or one an admin approved since, is never re-judged, so a verdict cannot
  -- be swapped by asking again. Same rule as declutter_record_ai_check for a live listing.
  SELECT i.* INTO v_item FROM public.shop_items i
   WHERE i.id = p_item_id AND i.owner_id = p_owner_id
     AND (i.status = 'draft'
          OR (i.status = 'live' AND i.admin_approved_at IS NULL
              AND EXISTS (SELECT 1 FROM public.shop_item_private pv WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL)))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_current
    FROM public.shop_item_photos WHERE item_id = p_item_id;
  IF v_current IS DISTINCT FROM (SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(p_judged_photo_ids) AS x)
     OR v_item.kind IS DISTINCT FROM p_judged_kind
     OR v_item.subtype IS DISTINCT FROM p_judged_subtype
     OR v_item.title IS DISTINCT FROM p_judged_title
     OR v_item.description IS DISTINCT FROM p_judged_description THEN
    RAISE EXCEPTION 'ai_check_stale' USING ERRCODE = '40001';
  END IF;
  UPDATE public.shop_item_private
     SET ai_checked_at = v_at,
         ai_flag_reason = v_flag,
         updated_at = v_at
   WHERE item_id = p_item_id;
  -- NEW (S009): a live item flagged now comes off the shop for an admin, as a flagged live title edit does
  -- (shops_update_item: pending_review, submitted now, live_at cleared), and the seller is told why. Orders already
  -- placed stand, as they do for a held title edit.
  IF v_item.status = 'live' AND v_flag IS NOT NULL THEN
    UPDATE public.shop_items
       SET status = 'pending_review', submitted_at = v_at, live_at = NULL, updated_at = v_at
     WHERE id = p_item_id AND status = 'live';
    PERFORM public.declutter_notify(v_item.owner_id, 'warning', 'Your item is waiting for a check',
      left(format('Our automatic check flagged a photo of "%s" (%s). Our team will look at it. Buyers can''t see it until then.',
                  v_item.title, v_flag), 1000), '/shops/mine');
  END IF;
  RETURN v_at;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) TO service_role;
