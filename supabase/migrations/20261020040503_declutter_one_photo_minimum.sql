-- Declutter: ONE photo is enough to list (owner decision, 2026-10-20 pop-up on
-- the Cowork design audit; it was 3). Up to 12 as before.
--
-- declutter_publish_item restated from its live definition (pg_get_functiondef,
-- 2026-10-20) with only the photo count and its hint changed. The app's number
-- is src/lib/declutter/photoRules.ts (DECLUTTER_MIN_PHOTOS); the two are held
-- equal by src/test/declutterPhotoMinimum.test.ts. Grants restated as live
-- (authenticated + service_role, no anon). Replay-safe: CREATE OR REPLACE.
-- Shops keeps its own 3 (shops_publish_item, not in this decision).
CREATE OR REPLACE FUNCTION public.declutter_publish_item(p_item_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF v_photos < 1 OR v_photos > 12 THEN
    RAISE EXCEPTION 'photos_required'
      USING ERRCODE = '22023', HINT = 'Add at least 1 photo (up to 12).';
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
$function$;
REVOKE ALL ON FUNCTION public.declutter_publish_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_publish_item(uuid) TO authenticated, service_role;
