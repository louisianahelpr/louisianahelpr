-- Declutter: a live listing's photos can be changed (audit DC-8 / Q2476).
--
-- WHY
--   declutter_add_item_photo and declutter_remove_item_photo took drafts only,
--   so a seller who wanted a better photo on a live listing was told to take it
--   down and relist, which loses its offers, questions and watchers (and the
--   take-down deletes the photos).
--
-- WHAT THIS DOES (both functions restated from their EFFECTIVE prod definition,
-- read with pg_get_functiondef on 2026-10-30; identical to their newest repo copy,
-- 20261014193955_declutter_foundation.sql; only the status rule and the
-- "send it back for the automatic check" step are new):
--   - A draft: unchanged.
--   - The seller's own LIVE listing: the photo is added / removed, and the
--     listing follows the same rule as a big edit (20261030043553,
--     declutter_edit_listing): it goes to pending_review (hidden from buyers),
--     the automatic check is cleared (the existing photo trigger,
--     trg_declutter_photos_void_ai_check, does that), each buyer with an open
--     offer is told it changed, and offers stay open. The app asks for the check
--     right after saving; declutter_record_ai_check puts a clean listing back
--     live by itself and holds a flagged one for an admin.
--   - A listing an edit already sent back and whose check is still pending
--     (pending_review, live_at set, no verdict and no flag): more photo changes
--     in the same edit are allowed; buyers were told once already.
--   - Anything else (a flagged listing held for an admin, paused, sold, ...)
--     is refused with item_not_editable, as before. A flag cannot be washed off
--     by swapping a photo: a flagged listing is refused here.
--   - Removing the LAST photo of a listed item is refused (too_few_photos): a
--     listing needs at least one photo (declutter_publish_item, 1..12).
--
-- Every client RPC starts with require_feature('declutter') and names
-- is_caller_banned() (Q281). Grants by role name: REVOKE ... FROM PUBLIC, anon.
-- Replay-safe: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.declutter_add_item_photo(p_item_id uuid, p_storage_path text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_pos smallint;
  v_id uuid;
  v_listed boolean;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- DC-8: a draft, the seller's live listing, or one an edit sent back whose check is still pending.
  v_listed := v_item.status = 'live'
    OR (v_item.status = 'pending_review' AND v_item.live_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.declutter_item_private pv
           WHERE pv.item_id = p_item_id AND pv.ai_checked_at IS NULL AND pv.ai_flag_reason IS NULL));
  IF v_item.status <> 'draft' AND NOT v_listed THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  -- The path is the caller's own folder for THIS item, and the object is
  -- really there, uploaded by the caller.
  IF p_storage_path IS NULL
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_storage_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_storage_path, '/', 3) IS DISTINCT FROM p_item_id::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          -- Images only: job-photos also takes video, and a video keeps its
          -- GPS atoms (the app's re-encode strips images only).
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;

  SELECT g.p INTO v_pos
    FROM generate_series(0, 11) AS g(p)
   WHERE NOT EXISTS (SELECT 1 FROM public.declutter_item_photos ph WHERE ph.item_id = p_item_id AND ph.position = g.p)
   ORDER BY g.p
   LIMIT 1;
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023', HINT = 'A listing has at most 12 photos.';
  END IF;

  INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
  VALUES (p_item_id, v_uid, p_storage_path, v_pos)
  RETURNING id INTO v_id;
  UPDATE public.declutter_items SET updated_at = now() WHERE id = p_item_id;

  -- A live listing's new photo: the same rule as a big edit (declutter_edit_listing, 20261030043553).
  IF v_item.status = 'live' THEN
    FOR r IN
      SELECT DISTINCT o.buyer_id FROM public.declutter_offers o
       WHERE o.item_id = p_item_id AND o.status = 'open'
    LOOP
      PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing updated',
        format('The seller updated "%s". Check it before your offer is answered.', v_item.title),
        '/declutter/item/' || p_item_id::text, v_uid);
    END LOOP;
    UPDATE public.declutter_items
       SET status = 'pending_review', submitted_at = now(), updated_at = now()
     WHERE id = p_item_id;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_add_item_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_add_item_photo(uuid, text) TO authenticated, service_role;

-- Detach a photo from the seller's own draft or live listing (DC-8). Returns
-- the storage path so the app removes the object (B5).
CREATE OR REPLACE FUNCTION public.declutter_remove_item_photo(p_photo_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_path text;
  v_item public.declutter_items%ROWTYPE;
  v_listed boolean;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT ph.storage_path INTO v_path
    FROM public.declutter_item_photos ph
    JOIN public.declutter_items i ON i.id = ph.item_id
   WHERE ph.id = p_photo_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT i.* INTO v_item
    FROM public.declutter_items i
   WHERE i.id = (SELECT ph.item_id FROM public.declutter_item_photos ph WHERE ph.id = p_photo_id)
   FOR UPDATE;
  v_listed := v_item.status = 'live'
    OR (v_item.status = 'pending_review' AND v_item.live_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.declutter_item_private pv
           WHERE pv.item_id = v_item.id AND pv.ai_checked_at IS NULL AND pv.ai_flag_reason IS NULL));
  IF v_item.id IS NULL OR (v_item.status <> 'draft' AND NOT v_listed) THEN
    -- As before: only a draft's photo (and now a live listing's) can be removed.
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- A listing on sale keeps at least one photo (declutter_publish_item asks for 1..12).
  IF v_listed AND (SELECT count(*) FROM public.declutter_item_photos ph WHERE ph.item_id = v_item.id) <= 1 THEN
    RAISE EXCEPTION 'too_few_photos' USING ERRCODE = '22023', HINT = 'A listing needs at least one photo.';
  END IF;

  DELETE FROM public.declutter_item_photos WHERE id = p_photo_id;
  UPDATE public.declutter_items SET updated_at = now() WHERE id = v_item.id;

  IF v_item.status = 'live' THEN
    FOR r IN
      SELECT DISTINCT o.buyer_id FROM public.declutter_offers o
       WHERE o.item_id = v_item.id AND o.status = 'open'
    LOOP
      PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing updated',
        format('The seller updated "%s". Check it before your offer is answered.', v_item.title),
        '/declutter/item/' || v_item.id::text, v_uid);
    END LOOP;
    UPDATE public.declutter_items
       SET status = 'pending_review', submitted_at = now(), updated_at = now()
     WHERE id = v_item.id;
  END IF;
  RETURN v_path;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_remove_item_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_remove_item_photo(uuid) TO authenticated, service_role;
