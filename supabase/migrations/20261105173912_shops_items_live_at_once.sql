-- Shops H3 (audit ~/.lh-shots/audit-1105-shops.md; owner answer 2, 2026-11-05
-- ~2:20 PM): a shop item goes LIVE AT ONCE when the automatic checks pass, the
-- way Declutter listings have since the owner's 10-29 rule ("content goes live
-- at once; admin looks only on a report or a failed automatic check").
--
-- What was wrong:
--   1. shops_publish_item sent every item to an admin until the shop had 3
--      admin-approved items (L52's "first 3 wait"). Every new shop's first
--      three items sat in a queue the owner said not to build.
--   2. It also sent every item the photo (AI) check never answered for to an
--      admin, so one AI timeout held the item. Declutter fails open here: the
--      word check still runs, and only a check that came back flagged holds it.
--   3. shops_update_item took a LIVE item off the shop for ANY edit (price,
--      description, stock in the same form), until it was published again.
--      Owner answer 2: price, description and stock edits stay live.
--
-- What this does (both restated from prod; prod md5 of prosrc read
-- 2026-11-05 equals the newest migration copy: shops_publish_item
-- 20261103060314 3cc2e60243289bcc89f5f692f1a886cd, shops_update_item
-- 20261017061157 8667700bcfaea1ba4693b495ae813902):
--   shops_publish_item: the first-3 count and the "AI never answered" hold are
--     gone. Still held for an admin: an item an admin rejected, any publish by
--     an owner with a rejection in the last 30 days (owner 2026-10-17: kept,
--     it is triggered by a failure), an AI check that came back flagged, and a
--     word-check hit.
--   shops_update_item: an edit to a LIVE item that keeps its kind and type
--     stays live. A changed title or description re-runs the word check; a hit
--     (or the 30-day hold) sends it to an admin, and the AI verdict is cleared
--     because it judged the old words. A new kind or type still makes it a
--     draft: the confirmations the owner ticked belong to the old kind/type.
--     Every other case (a draft, a pending or rejected item) is unchanged.
--
-- No money moves, no order is created, and grants are restated as on prod.
-- Shops stays behind its switch (require_feature('shops'), audience testers).

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

  -- Owner 2026-11-05 (answer 2, the 10-29 rule): live at once when the
  -- automatic checks pass. Only a failed check, or a past rejection, waits.
  -- Hold after a rejection (owner 2026-10-17): any of this owner's items
  -- rejected by an admin in the last 30 days sends every publish to an admin,
  -- so taking a rejected item down and listing it again never skips review.
  v_recent_rejection := EXISTS (
    SELECT 1 FROM public.admin_audit_log l
     WHERE l.action = 'shop_item_rejected'
       AND l.details->>'owner_id' = v_uid::text
       AND l.created_at > now() - interval '30 days');
  -- An AI check that never answered fails open to the word check, as
  -- declutter_publish_item does; one that answered "flagged" holds it.
  v_status := CASE
    WHEN v_priv.admin_rejected_at IS NOT NULL THEN 'pending_review'
    WHEN v_recent_rejection THEN 'pending_review'
    WHEN v_priv.ai_checked_at IS NOT NULL AND v_priv.ai_flag_reason IS NOT NULL THEN 'pending_review'
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

CREATE OR REPLACE FUNCTION public.shops_update_item(
  p_item_id uuid,
  p_kind text,
  p_subtype text,
  p_title text,
  p_description text,
  p_price_cents integer,
  p_lead_time_days integer,
  p_stock_count integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.shop_items%ROWTYPE;
  v_words_changed boolean;
  v_text_flag text;
  v_status text;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  v_item := public.shops_lock_own_item(p_item_id, v_uid);
  IF v_item.status = 'withdrawn' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  PERFORM public.shops_check_item_fields(p_kind, p_subtype, p_title, p_description, p_price_cents, p_lead_time_days, p_stock_count);

  v_words_changed := v_item.title IS DISTINCT FROM btrim(p_title)
                  OR v_item.description IS DISTINCT FROM COALESCE(btrim(p_description), '');

  -- Owner 2026-11-05 (answer 2): a live item's price, description and stock
  -- edits stay live. Same kind and type, so the owner's confirmations still
  -- cover it; new words re-run the word check (and the 30-day hold).
  IF v_item.status = 'live'
     AND v_item.kind IS NOT DISTINCT FROM p_kind
     AND v_item.subtype IS NOT DISTINCT FROM p_subtype THEN
    v_status := 'live';
    IF v_words_changed THEN
      v_text_flag := public.shop_item_text_flag(p_kind, btrim(p_title), COALESCE(btrim(p_description), ''));
      IF v_text_flag IS NOT NULL OR EXISTS (
           SELECT 1 FROM public.admin_audit_log l
            WHERE l.action = 'shop_item_rejected'
              AND l.details->>'owner_id' = v_uid::text
              AND l.created_at > now() - interval '30 days') THEN
        v_status := 'pending_review';
      END IF;
      -- The AI verdict judged the old words; an approval covered what the admin saw.
      UPDATE public.shop_item_private
         SET ai_checked_at = NULL, ai_flag_reason = NULL, text_flag_reason = v_text_flag, updated_at = now()
       WHERE item_id = p_item_id;
      UPDATE public.shop_items SET admin_approved_at = NULL WHERE id = p_item_id;
    END IF;
    UPDATE public.shop_items
       SET title = btrim(p_title),
           description = COALESCE(btrim(p_description), ''),
           price_cents = p_price_cents,
           lead_time_days = p_lead_time_days,
           stock_count = p_stock_count,
           status = v_status,
           submitted_at = CASE WHEN v_status = 'pending_review' THEN now() ELSE submitted_at END,
           live_at = CASE WHEN v_status = 'live' THEN live_at END,
           updated_at = now()
     WHERE id = p_item_id;
    RETURN v_status;
  END IF;

  IF v_item.kind IS DISTINCT FROM p_kind
     OR v_item.subtype IS DISTINCT FROM p_subtype
     OR v_words_changed THEN
    UPDATE public.shop_item_private
       SET ai_checked_at = NULL, ai_flag_reason = NULL, text_flag_reason = NULL, updated_at = now()
     WHERE item_id = p_item_id;
    DELETE FROM public.shop_item_attestations WHERE item_id = p_item_id;
    -- lh-authz-rls review should-fix 4: an approval covers the item an admin
    -- saw, so a rewritten item no longer carries it.
    UPDATE public.shop_items SET admin_approved_at = NULL WHERE id = p_item_id;
  END IF;

  UPDATE public.shop_items
     SET kind = p_kind,
         subtype = p_subtype,
         title = btrim(p_title),
         description = COALESCE(btrim(p_description), ''),
         price_cents = p_price_cents,
         lead_time_days = p_lead_time_days,
         stock_count = p_stock_count,
         status = 'draft',
         live_at = NULL,
         updated_at = now()
   WHERE id = p_item_id;
  RETURN 'draft';
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_update_item(uuid, text, text, text, text, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_update_item(uuid, text, text, text, text, integer, integer, integer) TO authenticated, service_role;
