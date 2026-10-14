-- DECLUTTER, SLICE 2: the slice-1 follow-ups the screens need before testers
-- (docs/specs/declutter-auctions.md, "Build decisions (agent)" B4, B5, B8, B9,
-- B16, the area_label review note, and B18-B24 added by this slice).
--
-- WHAT WAS MISSING (each measured in slice 1's migration, 20261014193955):
--   * no way to edit a draft: create_item took every field once (B18);
--   * a seller could not delete their own Declutter photos: job-photos has no
--     DELETE policy for a member's own <uid>/ folder (live pg_policies read
--     2026-10-14: the only DELETE policy is for <job id>/ folders of owned
--     jobs), so the remove call the app makes after
--     declutter_remove_item_photo was a silent no-op and the photo stayed
--     public by URL (B5);
--   * no admin approve/reject: a pending_review listing stayed pending (B8);
--   * the AI banned-item flag (row 34) had nowhere to land and publish did not
--     read it (B19);
--   * area_label is free text shown to every buyer: nothing stopped a seller
--     typing the exact address there (review note);
--   * no is_seed column, so test listings would count as real ones (B16);
--   * Download My Data left out every Declutter table (B9).
--
-- WHAT THIS DOES
--   1. declutter_items.is_seed, derived at birth from the seller's profile.
--   2. declutter_item_private: ai_checked_at / ai_flag_reason (written only by
--      the declutter-ai-draft edge function with the service role) and
--      review_note (the admin's reason). Any photo added or removed clears
--      the AI result, so a flag cannot be dodged by swapping photos.
--   3. declutter_area_label_problem(): refuses a label with a house number,
--      a street word, or the pickup address's first line in it.
--   4. declutter_create_item (area check) and declutter_publish_item (AI
--      gate: unchecked OR flagged -> pending_review, fail-safe) redefined;
--      declutter_update_draft and declutter_withdraw_item added.
--   5. Storage DELETE policy: a seller deletes their own job-photos/<uid>/
--      declutter/ objects that no declutter_item_photos row points at.
--   6. Admin: declutter_admin_pending_items() and declutter_admin_review_item();
--      the seller's declutter_my_item_review().
--   7. export_my_data: nine Declutter sections.
--
-- Every client RPC starts with require_feature('declutter'); every VOLATILE
-- one names is_caller_banned() in its own body (Q281). Grants by role name:
-- REVOKE ... FROM PUBLIC, anon (and authenticated for internal helpers).
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS. Applied 3x in
-- PGlite by src/test/pglite/declutterSlice2.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 1. is_seed (B16): test listings are seed data from birth.
ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS is_seed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.declutter_items_seed_from_seller()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  -- Every Declutter write is an RPC run as the signed-in seller, so the
  -- seller's own profile decides (a seed account's listing is seed).
  IF NOT NEW.is_seed AND EXISTS (
       SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.seller_id AND p.is_seed
     ) THEN
    NEW.is_seed := true;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_seed_from_seller() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_items_seed_from_seller ON public.declutter_items;
CREATE TRIGGER trg_declutter_items_seed_from_seller
  BEFORE INSERT ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_items_seed_from_seller();

-- ---------------------------------------------------------------------------
-- 2. AI result + admin note, on the PRIVATE half (no client privilege).
ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS ai_checked_at timestamptz;
ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS ai_flag_reason text;
ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS review_note text;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_item_private_ai_flag_len') THEN
    ALTER TABLE public.declutter_item_private
      ADD CONSTRAINT declutter_item_private_ai_flag_len CHECK (ai_flag_reason IS NULL OR char_length(ai_flag_reason) <= 300);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_item_private_review_note_len') THEN
    ALTER TABLE public.declutter_item_private
      ADD CONSTRAINT declutter_item_private_review_note_len CHECK (review_note IS NULL OR char_length(review_note) <= 500);
  END IF;
END
$do$;

-- A photo added or removed voids the AI check: the photos it judged changed.
CREATE OR REPLACE FUNCTION public.declutter_photos_void_ai_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.declutter_item_private
     SET ai_checked_at = NULL, ai_flag_reason = NULL, updated_at = now()
   WHERE item_id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END)
     AND (ai_checked_at IS NOT NULL OR ai_flag_reason IS NOT NULL);
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_photos_void_ai_check() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_photos_void_ai_check ON public.declutter_item_photos;
CREATE TRIGGER trg_declutter_photos_void_ai_check
  AFTER INSERT OR DELETE ON public.declutter_item_photos
  FOR EACH ROW EXECUTE FUNCTION public.declutter_photos_void_ai_check();

-- ---------------------------------------------------------------------------
-- 3. area_label is shown to every buyer (row 27: area + miles only). Returns
--    why the label looks like an address, or NULL. A town or neighbourhood
--    ("Mid-City, Baton Rouge", "St. Francisville", "Metairie 70005") passes.
CREATE OR REPLACE FUNCTION public.declutter_area_label_problem(p_area text, p_pickup_address text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_area text := lower(btrim(COALESCE(p_area, '')));
  v_line1 text := lower(btrim(split_part(COALESCE(p_pickup_address, ''), ',', 1)));
  v_street text;
BEGIN
  -- A house number followed (within three words) by a street word:
  -- "1234 Example St", "55 Magnolia Dr". A ZIP ("70005 Metairie"), a road
  -- name alone ("River Road area", "Airline Hwy, Metairie") or "I-10" pass.
  IF v_area ~ '(^|[^0-9a-z-])[0-9]+[a-z]?\s+([a-z.''-]+\s+){0,3}(street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|boulevard|parkway|pkwy|hwy|highway|cir|circle|court|ct|way|place|pl|trail|trl)\M' THEN
    RETURN 'house_number';
  END IF;
  -- The pickup address's own street, with or without its house number
  -- ("Example St" when the address is "1234 Example St"; "1234example").
  v_street := btrim(regexp_replace(v_line1, '^[0-9]+[a-z]?\s*', ''));
  IF char_length(v_line1) >= 5 AND position(regexp_replace(v_line1, '\s+', '', 'g') IN regexp_replace(v_area, '\s+', '', 'g')) > 0 THEN
    RETURN 'pickup_address';
  END IF;
  IF char_length(v_street) >= 4 AND v_street <> v_line1 AND position(v_street IN v_area) > 0 THEN
    RETURN 'pickup_street';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_area_label_problem(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_area_label_problem(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4a. Create a DRAFT listing: slice 1's body plus the area-label check.
CREATE OR REPLACE FUNCTION public.declutter_create_item(
  p_title text,
  p_description text,
  p_category text,
  p_condition_stars integer,
  p_delivery_size text,
  p_price_cents integer,
  p_floor_price_cents integer,
  p_area_label text,
  p_pickup_address text,
  p_pickup_lat numeric,
  p_pickup_lng numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  IF p_price_cents IS NULL OR p_floor_price_cents IS NULL
     OR p_floor_price_cents < 100 OR p_floor_price_cents > p_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price'
      USING ERRCODE = '22023', HINT = 'The lowest price must be at least $1 and no more than the price.';
  END IF;
  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL THEN
    RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
  END IF;
  IF public.declutter_area_label_problem(p_area_label, p_pickup_address) IS NOT NULL THEN
    RAISE EXCEPTION 'area_looks_like_address'
      USING ERRCODE = '22023', HINT = 'Use your neighborhood or town, not a street address.';
  END IF;

  INSERT INTO public.declutter_items (
    seller_id, sale_mode, status, title, description, category, condition_stars,
    delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng)
  VALUES (
    v_uid, 'offers', 'draft', btrim(p_title), COALESCE(btrim(p_description), ''), p_category,
    p_condition_stars, p_delivery_size, p_price_cents, p_price_cents, btrim(p_area_label),
    round(p_pickup_lat, 2), round(p_pickup_lng, 2))
  RETURNING id INTO v_id;

  INSERT INTO public.declutter_item_private (item_id, seller_id, floor_price_cents, pickup_address, pickup_lat, pickup_lng)
  VALUES (v_id, v_uid, p_floor_price_cents, btrim(p_pickup_address), p_pickup_lat, p_pickup_lng);

  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_create_item(text, text, text, integer, text, integer, integer, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_create_item(text, text, text, integer, text, integer, integer, text, text, numeric, numeric) TO authenticated, service_role;

-- 4b. Edit the seller's own DRAFT (B18). Every field, as create takes them.
CREATE OR REPLACE FUNCTION public.declutter_update_draft(
  p_item_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_condition_stars integer,
  p_delivery_size text,
  p_price_cents integer,
  p_floor_price_cents integer,
  p_area_label text,
  p_pickup_address text,
  p_pickup_lat numeric,
  p_pickup_lng numeric
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_at timestamptz := now();
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
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF p_price_cents IS NULL OR p_floor_price_cents IS NULL
     OR p_floor_price_cents < 100 OR p_floor_price_cents > p_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price'
      USING ERRCODE = '22023', HINT = 'The lowest price must be at least $1 and no more than the price.';
  END IF;
  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL THEN
    RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
  END IF;
  IF public.declutter_area_label_problem(p_area_label, p_pickup_address) IS NOT NULL THEN
    RAISE EXCEPTION 'area_looks_like_address'
      USING ERRCODE = '22023', HINT = 'Use your neighborhood or town, not a street address.';
  END IF;

  -- lh-authz-rls review must-fix 3: the AI judged THIS text; changed text is
  -- unjudged (B19). And the four confirmations were made for the item as it
  -- was described: an edit asks for them again (review nit 7).
  IF v_item.title IS DISTINCT FROM btrim(p_title)
     OR v_item.description IS DISTINCT FROM COALESCE(btrim(p_description), '')
     OR v_item.category IS DISTINCT FROM p_category THEN
    UPDATE public.declutter_item_private
       SET ai_checked_at = NULL, ai_flag_reason = NULL
     WHERE item_id = p_item_id;
    DELETE FROM public.declutter_tax_attestations WHERE item_id = p_item_id;
  END IF;

  UPDATE public.declutter_items
     SET title = btrim(p_title),
         description = COALESCE(btrim(p_description), ''),
         category = p_category,
         condition_stars = p_condition_stars,
         delivery_size = p_delivery_size,
         price_cents = p_price_cents,
         current_price_cents = p_price_cents,
         area_label = btrim(p_area_label),
         area_lat = round(p_pickup_lat, 2),
         area_lng = round(p_pickup_lng, 2),
         updated_at = v_at
   WHERE id = p_item_id;
  UPDATE public.declutter_item_private
     SET floor_price_cents = p_floor_price_cents,
         pickup_address = btrim(p_pickup_address),
         pickup_lat = p_pickup_lat,
         pickup_lng = p_pickup_lng,
         updated_at = v_at
   WHERE item_id = p_item_id AND seller_id = v_uid;
  RETURN v_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_update_draft(uuid, text, text, text, integer, text, integer, integer, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_update_draft(uuid, text, text, text, integer, text, integer, integer, text, text, numeric, numeric) TO authenticated, service_role;

-- 4c. Publish: slice 1's body, plus the AI gate (row 34, B19): a listing the
--     AI never checked, or flagged, waits for an admin like a new seller's.
CREATE OR REPLACE FUNCTION public.declutter_publish_item(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_floor integer;
  v_ai_checked timestamptz;
  v_ai_flag text;
  v_photos integer;
  v_payout text;
  v_approved integer;
  v_status text;
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
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_a_draft' USING ERRCODE = '22023';
  END IF;
  IF v_item.sale_mode <> 'offers' THEN
    -- Row 55: bidding waits for the auctioneer licence.
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;

  -- Row 23: payout setup before the first listing, the Helprs' gate.
  v_payout := public.helper_award_block_reason(v_uid);
  IF v_payout IS NOT NULL THEN
    RAISE EXCEPTION 'payout_setup_incomplete'
      USING ERRCODE = '42501', HINT = 'Finish your payout setup before you list an item.';
  END IF;

  SELECT count(*)::integer INTO v_photos FROM public.declutter_item_photos WHERE item_id = p_item_id;
  IF v_photos < 3 OR v_photos > 12 THEN
    RAISE EXCEPTION 'photos_required'
      USING ERRCODE = '22023', HINT = 'Add at least 3 photos (up to 12).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.declutter_tax_attestations a WHERE a.item_id = p_item_id AND a.seller_id = v_uid) THEN
    RAISE EXCEPTION 'attestation_required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.declutter_pickup_windows w WHERE w.seller_id = v_uid) THEN
    RAISE EXCEPTION 'pickup_windows_required' USING ERRCODE = '22023';
  END IF;

  SELECT floor_price_cents, ai_checked_at, ai_flag_reason INTO v_floor, v_ai_checked, v_ai_flag
    FROM public.declutter_item_private WHERE item_id = p_item_id FOR UPDATE;
  IF v_floor IS NULL OR v_floor > v_item.current_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price' USING ERRCODE = '22023';
  END IF;

  -- Row 33: until 3 of the seller's listings have an admin's OK, each waits.
  -- Row 34 / B19: so does any listing the AI flagged or never checked.
  SELECT count(*)::integer INTO v_approved
    FROM public.declutter_items
   WHERE seller_id = v_uid AND admin_approved_at IS NOT NULL;
  v_status := CASE
    WHEN v_approved < 3 THEN 'pending_review'
    WHEN v_ai_checked IS NULL OR v_ai_flag IS NOT NULL THEN 'pending_review'
    ELSE 'live'
  END;

  UPDATE public.declutter_items
     SET status = v_status,
         submitted_at = now(),
         live_at = CASE WHEN v_status = 'live' THEN now() END,
         updated_at = now()
   WHERE id = p_item_id;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_publish_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_publish_item(uuid) TO authenticated, service_role;

-- 4d. Take a listing down (B20). A draft is deleted outright; a pending or
--     live one becomes 'withdrawn'. Either way its photo rows go, and the
--     storage paths come back so the app deletes the objects (policy 5).
--     Reserved/sold items are not the seller's to pull (later slices).
CREATE OR REPLACE FUNCTION public.declutter_withdraw_item(p_item_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.declutter_items%ROWTYPE;
  v_paths text[];
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Not the selling gate on purpose: an under-18 or struck member may still
  -- take their own listing down.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- rejected / removed / ended: off sale already, but their photos were
  -- still attached and public by URL (lh-authz-rls review should-fix 2), so
  -- they may be detached too. Reserved / sold / completed are not the
  -- seller's to pull (later slices).
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'rejected', 'removed', 'ended') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(storage_path ORDER BY position), ARRAY[]::text[]) INTO v_paths
    FROM public.declutter_item_photos WHERE item_id = p_item_id;

  IF v_item.status = 'draft' THEN
    DELETE FROM public.declutter_items WHERE id = p_item_id;
  ELSE
    DELETE FROM public.declutter_item_photos WHERE item_id = p_item_id;
    DELETE FROM public.declutter_watchlist WHERE item_id = p_item_id;
    UPDATE public.declutter_items
       SET status = CASE WHEN v_item.status IN ('pending_review', 'live') THEN 'withdrawn' ELSE v_item.status END,
           updated_at = now()
     WHERE id = p_item_id;
  END IF;
  RETURN v_paths;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_withdraw_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_item(uuid) TO authenticated, service_role;

-- 4e. Record the AI verdict (row 34, B19), service role only: the
--     declutter-ai-draft edge function calls it after judging. lh-authz-rls
--     review should-fix 1: the verdict lands only if the photos and text it
--     judged are still exactly the listing's, under the items row lock that
--     add_photo / update_draft / publish also take, so a swap between the
--     judgement and the write cannot inherit a pass.
CREATE OR REPLACE FUNCTION public.declutter_record_ai_check(
  p_item_id uuid,
  p_seller_id uuid,
  p_judged_photo_ids uuid[],
  p_judged_title text,
  p_judged_description text,
  p_judged_category text,
  p_flag_reason text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_item public.declutter_items%ROWTYPE;
  v_current uuid[];
  v_at timestamptz := now();
BEGIN
  SELECT * INTO v_item FROM public.declutter_items
   WHERE id = p_item_id AND seller_id = p_seller_id AND status = 'draft' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_current
    FROM public.declutter_item_photos WHERE item_id = p_item_id;
  IF v_current IS DISTINCT FROM (SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(p_judged_photo_ids) AS x)
     OR v_item.title IS DISTINCT FROM p_judged_title
     OR v_item.description IS DISTINCT FROM p_judged_description
     OR v_item.category IS DISTINCT FROM p_judged_category THEN
    RAISE EXCEPTION 'ai_check_stale' USING ERRCODE = '40001';
  END IF;
  UPDATE public.declutter_item_private
     SET ai_checked_at = v_at,
         ai_flag_reason = NULLIF(left(btrim(COALESCE(p_flag_reason, '')), 300), ''),
         updated_at = v_at
   WHERE item_id = p_item_id;
  RETURN v_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_record_ai_check(uuid, uuid, uuid[], text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_ai_check(uuid, uuid, uuid[], text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. B5: a seller deletes their OWN Declutter photo objects once no listing
--    row points at them (removed from a draft, or the listing was withdrawn).
--    An attached photo cannot be deleted from under a listing. The NOT EXISTS
--    reads declutter_item_photos as the caller, who reads every photo row of
--    their own items (the seller branch of the items policy).
DROP POLICY IF EXISTS "Sellers delete own unattached declutter photos" ON storage.objects;
CREATE POLICY "Sellers delete own unattached declutter photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[2] = 'declutter'
    AND NOT EXISTS (SELECT 1 FROM public.declutter_item_photos p WHERE p.storage_path = objects.name)
  );

-- ---------------------------------------------------------------------------
-- 6. Admin review (row 33, B8). Admins only, switch on (admins are in the
--    testers audience), every decision in admin_audit_log.
CREATE OR REPLACE FUNCTION public.declutter_admin_pending_items()
RETURNS TABLE(
  item_id uuid, seller_id uuid, title text, description text, category text,
  condition_stars smallint, delivery_size text, price_cents integer, area_label text,
  submitted_at timestamptz, ai_checked_at timestamptz, ai_flag_reason text,
  approved_listings integer, photo_paths text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT i.id, i.seller_id, i.title, i.description, i.category, i.condition_stars, i.delivery_size,
           i.price_cents, i.area_label, i.submitted_at, p.ai_checked_at, p.ai_flag_reason,
           (SELECT count(*)::integer FROM public.declutter_items a
             WHERE a.seller_id = i.seller_id AND a.admin_approved_at IS NOT NULL),
           (SELECT COALESCE(array_agg(ph.storage_path ORDER BY ph.position), ARRAY[]::text[])
              FROM public.declutter_item_photos ph WHERE ph.item_id = i.id)
      FROM public.declutter_items i
      JOIN public.declutter_item_private p ON p.item_id = i.id
     WHERE i.status = 'pending_review'
     ORDER BY i.submitted_at NULLS LAST, i.id
     LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_pending_items() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_pending_items() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_review_item(p_item_id uuid, p_approve boolean, p_note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_seller uuid;
  v_status text;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND v_note IS NULL THEN
    RAISE EXCEPTION 'review_note_required'
      USING ERRCODE = '22023', HINT = 'Say why the listing is not approved.';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT seller_id INTO v_seller FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = 'P0002';
  END IF;
  -- lh-authz-rls review must-fix 1: an admin never reviews their own listing.
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_listing' USING ERRCODE = '42501', HINT = 'Another admin must review your own listing.';
  END IF;
  -- Must-fix 2: approval puts the listing in front of buyers NOW, so the
  -- seller must still be allowed to sell now: not banned, fewer than 3
  -- active Declutter strikes, not under 18, payout setup done.
  IF p_approve AND (
       EXISTS (SELECT 1 FROM public.profiles pr
                WHERE pr.user_id = v_seller
                  AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                  AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
       OR public.declutter_active_strike_count(v_seller) >= 3
       OR public.member_under_18(v_seller)
       OR public.helper_award_block_reason(v_seller) IS NOT NULL) THEN
    RAISE EXCEPTION 'seller_not_eligible'
      USING ERRCODE = '22023', HINT = 'The seller cannot sell right now (restricted, strikes, age or payouts). Reject it instead.';
  END IF;

  v_status := CASE WHEN p_approve THEN 'live' ELSE 'rejected' END;
  UPDATE public.declutter_items
     SET status = v_status,
         admin_approved_at = CASE WHEN p_approve THEN now() ELSE admin_approved_at END,
         live_at = CASE WHEN p_approve THEN now() ELSE live_at END,
         updated_at = now()
   WHERE id = p_item_id AND status = 'pending_review';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.declutter_item_private SET review_note = v_note, updated_at = now() WHERE item_id = p_item_id;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_approve THEN 'declutter_listing_approved' ELSE 'declutter_listing_rejected' END,
          'declutter_item', p_item_id::text, jsonb_build_object('note', v_note));
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_review_item(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_review_item(uuid, boolean, text) TO authenticated, service_role;

-- The seller's own listing review state: the admin's note on a rejected
-- listing, and whether the AI flagged it. Seller only; anyone else gets
-- item_not_found.
CREATE OR REPLACE FUNCTION public.declutter_my_item_review(p_item_id uuid)
RETURNS TABLE(review_note text, ai_flagged boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  RETURN QUERY
    SELECT p.review_note, (p.ai_flag_reason IS NOT NULL)
      FROM public.declutter_item_private p
     WHERE p.item_id = p_item_id
       AND p.seller_id = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_item_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_item_review(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Download My Data (B9). Body verbatim from 20261007113957, the newest
--    definition (live md5(prosrc) read 2026-10-14 =
--    8bcb90613735784b83f0836361890a31, 19094 chars, equal to that file's
--    body), plus the nine Declutter sections before RETURN. Staff ids are
--    dropped from the strike and flag rows, as other sections drop them.
--    Grants restated (service_role only, Q408); the no-argument door stays
--    dropped.
DROP FUNCTION IF EXISTS public.export_my_data();

CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  -- Q1390: a crew block fee is the member's money record. The member only:
  -- the ledger has no client read policy, and an export never gives a poster
  -- a row the app's own SELECT rules would not (Q739); the poster's side of
  -- it is the notification block_user_and_settle sends.
  v_out := v_out || jsonb_build_object('crew_block_fees', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_block_fees t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'issued_by'), '[]'::jsonb) FROM public.user_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_requests t
      WHERE t.requested_by = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_answers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_answers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  -- Declutter (20261014200728, B9).
  v_out := v_out || jsonb_build_object('declutter_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_items t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason'), '[]'::jsonb) FROM public.declutter_item_private t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_item_photos t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_pickup_windows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_pickup_windows t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_questions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_questions t
      WHERE t.asker_id = v_uid OR t.item_id IN (SELECT i.id FROM public.declutter_items i WHERE i.seller_id = v_uid)));
  v_out := v_out || jsonb_build_object('declutter_watchlist', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_watchlist t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_tax_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_tax_attestations t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by' - 'appeal_decided_by'), '[]'::jsonb) FROM public.declutter_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_seller_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'set_by'), '[]'::jsonb) FROM public.declutter_seller_flags t
      WHERE t.user_id = v_uid));

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;
