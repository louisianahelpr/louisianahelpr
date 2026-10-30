-- Declutter: a seller can change the order of photos already on a listing (audit posting 1030 #9).
--
-- WHY
--   Photos are shown by position and position 0 is the cover, but nothing could change a position: a seller's only way
--   to change an uploaded photo's place was to remove photos and add them again.
--
-- WHAT THIS DOES
--   1. declutter_item_photos_position_key becomes DEFERRABLE INITIALLY IMMEDIATE. Read on prod 2026-10-30 (pg_constraint):
--      UNIQUE (item_id, position), not deferrable, with CHECK (position BETWEEN 0 AND 11). A swap can't pass a
--      per-row unique check, and 12 photos leave no free place to move through. Every other statement behaves as
--      before: it stays immediate unless a transaction defers it, and no statement in the migrations or the app uses
--      it as an ON CONFLICT target (a deferrable constraint can't be one). Prod has no foreign key into this table.
--   2. declutter_reorder_item_photos(item, ids in the new order): the seller's own, and the same statuses as adding
--      a photo (20261030061927): a draft, a live listing, or one an edit sent back whose check is still pending. A
--      flagged, paused, sold or removed listing is refused with item_not_editable.
--
--   The ids must be exactly the listing's photos, each once. If they aren't (a photo was added or removed in another
--   window) it refuses with photos_changed and moves nothing. Positions become 0..n-1, which also closes gaps a removal
--   left.
--
--   A live listing stays live, nothing is re-checked and no buyer is told: the same pictures were already checked.
--   trg_declutter_photos_void_ai_check fires on INSERT and DELETE only, and declutter_record_ai_check compares the photo
--   ids sorted (20261030071816), so a reorder during a check doesn't void it.
--
--   Runs under the item's row lock, as declutter_add_item_photo and declutter_remove_item_photo do, so neither can
--   change the set between the check and the update. Grants by role name. Replay-safe.

-- @constraint-step
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.declutter_item_photos'::regclass
       AND conname = 'declutter_item_photos_position_key'
       AND NOT condeferrable
  ) THEN
    ALTER TABLE public.declutter_item_photos DROP CONSTRAINT declutter_item_photos_position_key;
    ALTER TABLE public.declutter_item_photos
      ADD CONSTRAINT declutter_item_photos_position_key UNIQUE (item_id, position) DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$do$;
-- @function-step

CREATE OR REPLACE FUNCTION public.declutter_reorder_item_photos(p_item_id uuid, p_photo_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_listed boolean;
  v_n integer;
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
  -- The same statuses as declutter_add_item_photo (20261030061927).
  v_listed := v_item.status = 'live'
    OR (v_item.status = 'pending_review' AND v_item.live_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.declutter_item_private pv
           WHERE pv.item_id = p_item_id AND pv.ai_checked_at IS NULL AND pv.ai_flag_reason IS NULL));
  IF v_item.status <> 'draft' AND NOT v_listed THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  -- Exactly this listing's photos, each once. A NULL array, a NULL id, a repeat, a stranger's id or a missing id all differ.
  SELECT count(*)::integer INTO v_n FROM public.declutter_item_photos ph WHERE ph.item_id = p_item_id;
  IF p_photo_ids IS NULL
     OR cardinality(p_photo_ids) IS DISTINCT FROM v_n
     OR EXISTS (SELECT 1 FROM unnest(p_photo_ids) AS x WHERE x IS NULL)
     OR (SELECT count(DISTINCT x) FROM unnest(p_photo_ids) AS x) IS DISTINCT FROM v_n::bigint
     OR EXISTS (SELECT 1 FROM unnest(p_photo_ids) AS x
                 WHERE NOT EXISTS (SELECT 1 FROM public.declutter_item_photos ph WHERE ph.id = x AND ph.item_id = p_item_id)) THEN
    RAISE EXCEPTION 'photos_changed' USING ERRCODE = '22023';
  END IF;

  SET CONSTRAINTS public.declutter_item_photos_position_key DEFERRED;
  UPDATE public.declutter_item_photos ph
     SET position = (o.ord - 1)::smallint
    FROM unnest(p_photo_ids) WITH ORDINALITY AS o(id, ord)
   WHERE ph.id = o.id AND ph.item_id = p_item_id AND ph.position IS DISTINCT FROM (o.ord - 1)::smallint;
  -- Checked here, not left to the caller's commit, and the rest of the transaction is back to the normal rule.
  SET CONSTRAINTS public.declutter_item_photos_position_key IMMEDIATE;

  UPDATE public.declutter_items SET updated_at = now() WHERE id = p_item_id;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_reorder_item_photos(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_reorder_item_photos(uuid, uuid[]) TO authenticated, service_role;
