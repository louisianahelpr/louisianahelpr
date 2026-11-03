-- Q2390 packet 12: "not found" answers HTTP 404, not 500, for Shops'
-- shops_publish_item (publish an item). It moves no money, deletes no rows,
-- creates no order and is not on the checkout, seller-delivery or payment
-- path; no edge function calls it (declutter-ai-draft names it only in a
-- comment). EXECUTE to authenticated and service_role, as on prod.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   shops_publish_item                     20261017061157 82def77d029883f38c1cee13b93333aa
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (1 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.shops_publish_item(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.shop_items%ROWTYPE;
  v_shop public.shops%ROWTYPE;
  v_priv public.shop_item_private%ROWTYPE;
  v_photos integer;
  v_approved integer;
  v_text_flag text;
  v_status text;
  v_recent_rejection boolean;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  v_item := public.shops_lock_own_item(p_item_id, v_uid);
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_a_draft' USING ERRCODE = '22023';
  END IF;
  IF v_item.kind NOT IN ('made', 'home_food', 'farm') THEN
    RAISE EXCEPTION 'rental_not_available' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_shop FROM public.shops WHERE id = v_item.shop_id;
  IF NOT v_shop.offers_selling THEN
    RAISE EXCEPTION 'shop_not_selling' USING ERRCODE = '22023', HINT = 'Turn on selling for your shop first.';
  END IF;
  -- L21: buyers pick a ready date from the shop's open days.
  IF NOT EXISTS (SELECT 1 FROM public.shop_hours h WHERE h.shop_id = v_shop.id) THEN
    RAISE EXCEPTION 'order_days_required' USING ERRCODE = '22023',
      HINT = 'Add the days your shop fills orders (opening hours) first.';
  END IF;

  SELECT count(*)::integer INTO v_photos FROM public.shop_item_photos WHERE item_id = p_item_id;
  IF v_photos < 3 OR v_photos > 12 THEN
    RAISE EXCEPTION 'photos_required' USING ERRCODE = '22023', HINT = 'Add at least 3 photos (up to 12).';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.shop_item_attestations a
        WHERE a.item_id = p_item_id AND a.owner_id = v_uid
          AND a.statements = (SELECT array_agg(DISTINCT y ORDER BY y)
                                FROM unnest(public.shop_item_required_statements(v_item.kind, v_item.subtype)) y)) THEN
    RAISE EXCEPTION 'attestation_required' USING ERRCODE = '22023';
  END IF;

  IF v_item.kind = 'home_food' THEN
    -- L8: the yearly confirmation, and not at the limit.
    IF NOT EXISTS (SELECT 1 FROM public.shop_cottage_confirmations c
                    WHERE c.owner_id = v_uid AND c.limit_year = public.shop_cottage_year()) THEN
      RAISE EXCEPTION 'cottage_confirmation_required' USING ERRCODE = '22023';
    END IF;
    IF public.shop_cottage_cap_reached(v_uid) THEN
      RAISE EXCEPTION 'cottage_cap_reached' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_priv FROM public.shop_item_private WHERE item_id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Every item is created with its private row (shops_create_item); a
    -- missing one is a bug, never a pass (lh-silent-failure review nit 11).
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_text_flag := public.shop_item_text_flag(v_item.kind, v_item.title, v_item.description);

  -- L52: until 3 of the shop's items have an admin's OK, each waits; so does
  -- one the AI flagged or never checked, and one the word check flagged.
  SELECT count(*)::integer INTO v_approved
    FROM public.shop_items WHERE shop_id = v_item.shop_id AND admin_approved_at IS NOT NULL;
  -- Hold after a rejection (owner 2026-10-17): any of this owner's items
  -- rejected by an admin in the last 30 days sends every publish to an admin,
  -- so taking a rejected item down and listing it again never skips review.
  v_recent_rejection := EXISTS (
    SELECT 1 FROM public.admin_audit_log l
     WHERE l.action = 'shop_item_rejected'
       AND l.details->>'owner_id' = v_uid::text
       AND l.created_at > now() - interval '30 days');
  v_status := CASE
    WHEN v_approved < 3 THEN 'pending_review'
    WHEN v_priv.admin_rejected_at IS NOT NULL THEN 'pending_review'
    WHEN v_recent_rejection THEN 'pending_review'
    WHEN v_priv.ai_checked_at IS NULL OR v_priv.ai_flag_reason IS NOT NULL THEN 'pending_review'
    WHEN v_text_flag IS NOT NULL THEN 'pending_review'
    ELSE 'live'
  END;

  UPDATE public.shop_item_private
     SET text_flag_reason = v_text_flag, review_note = NULL, updated_at = now()
   WHERE item_id = p_item_id;
  UPDATE public.shop_items
     SET status = v_status,
         submitted_at = now(),
         live_at = CASE WHEN v_status = 'live' THEN now() END,
         updated_at = now()
   WHERE id = p_item_id;
  RETURN v_status;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_publish_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_publish_item(uuid) TO authenticated, service_role;

