-- Shops variants: option names and choices pass the item word check (Builder 4, 11-06; handoff item 2 part 3).
-- Recommendation logged in ~/.lh-shots/OWNER-DECISIONS.md (owner may override): follow the existing item rule, not a
-- refusal. Owner rule: content goes live at once and only a failed automatic check goes to an admin. So option text
-- that fails shop_item_text_flag (alcohol, CBD, weapons, used, children's, ...) sets text_flag_reason and sends a LIVE
-- item to pending_review, exactly as a live title edit does; a draft is checked when it is listed.
--   1. shop_item_option_words(item): the item's option list names and the choices of its offered combinations, as one
--      string (service role only; the two callers are SECURITY DEFINER).
--   2. RESTATED shops_set_item_variants from its NEWEST CREATE, 20261106165310_shops_item_variants.sql (only the word
--      check and the returned held_for_review change).
--   3. RESTATED shops_publish_item from its NEWEST CREATE, 20261105235833_shops_every_category_sells.sql (only the
--      word check reads the options too).
-- AUTHZ: one new service-only helper, two restated member RPCs (lh-authz-rls). MONEY: no.
-- REPLAY-SAFE: CREATE OR REPLACE only.
-- Proof: src/test/pglite/shopsItemVariants.pglite.mjs (the option word check section).

-- 1. The words a buyer reads in the options.
CREATE OR REPLACE FUNCTION public.shop_item_option_words(p_item_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT btrim(
    COALESCE((SELECT array_to_string(i.option_names, ' ') FROM public.shop_items i WHERE i.id = p_item_id), '') || ' ' ||
    COALESCE((SELECT string_agg(DISTINCT x, ' ')
                FROM public.shop_item_variants v, unnest(v.option_values) x
               WHERE v.item_id = p_item_id AND v.active), ''));
$fn$;
REVOKE ALL ON FUNCTION public.shop_item_option_words(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_item_option_words(uuid) TO service_role;

-- 2. RESTATED from 20261106165310_shops_item_variants.sql.
CREATE OR REPLACE FUNCTION public.shops_set_item_variants(p_item_id uuid, p_option_names text[], p_variants jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.shop_items%ROWTYPE;
  v_names text[] := ARRAY[]::text[];
  v_name text;
  v_n integer;
  v_row jsonb;
  v_values text[];
  v_value text;
  v_price integer;
  v_stock integer;
  v_active boolean;
  v_keep uuid[] := ARRAY[]::uuid[];
  v_id uuid;
  v_pos integer := 0;
  v_leak text;
  k integer;
  v_flag text;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  v_item := public.shops_lock_own_item(p_item_id, v_uid);
  IF v_item.status NOT IN ('draft', 'pending_review', 'live') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  -- The lists: 0 to 3 names, 1 to 30 characters, no two alike.
  IF cardinality(COALESCE(p_option_names, ARRAY[]::text[])) > 3 THEN
    RAISE EXCEPTION 'too_many_option_lists' USING ERRCODE = '22023', HINT = 'An item has at most 3 option lists.';
  END IF;
  FOREACH v_name IN ARRAY COALESCE(p_option_names, ARRAY[]::text[]) LOOP
    v_name := btrim(COALESCE(v_name, ''));
    IF char_length(v_name) NOT BETWEEN 1 AND 30 THEN
      RAISE EXCEPTION 'invalid_option_name' USING ERRCODE = '22023', HINT = 'Name each option list in 1 to 30 characters.';
    END IF;
    IF lower(v_name) IN (SELECT lower(x) FROM unnest(v_names) x) THEN
      RAISE EXCEPTION 'invalid_option_name' USING ERRCODE = '22023', HINT = 'Give each option list its own name.';
    END IF;
    v_leak := public.contact_leak_reason(v_name);
    IF v_leak IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = v_leak || ' in an option. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
    END IF;
    v_names := v_names || v_name;
  END LOOP;
  v_n := cardinality(v_names);
  IF p_variants IS NULL OR jsonb_typeof(p_variants) <> 'array' THEN
    RAISE EXCEPTION 'invalid_variants' USING ERRCODE = '22023';
  END IF;
  IF v_n = 0 AND jsonb_array_length(p_variants) > 0 THEN
    RAISE EXCEPTION 'invalid_variants' USING ERRCODE = '22023', HINT = 'Add an option list first.';
  END IF;
  IF v_n > 0 AND jsonb_array_length(p_variants) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'too_many_variants' USING ERRCODE = '22023', HINT = 'An item has 1 to 100 combinations.';
  END IF;

  -- The item row is locked (shops_lock_own_item): write the names first, so
  -- the rollup sees them.
  UPDATE public.shop_items SET option_names = v_names, updated_at = now() WHERE id = v_item.id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
    IF jsonb_typeof(v_row) <> 'object' OR jsonb_typeof(v_row -> 'values') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_row -> 'values') <> v_n THEN
      RAISE EXCEPTION 'invalid_variants' USING ERRCODE = '22023', HINT = 'Each combination has one value for each option list.';
    END IF;
    v_values := ARRAY[]::text[];
    FOR v_value IN SELECT jsonb_array_elements_text(v_row -> 'values') LOOP
      v_value := btrim(COALESCE(v_value, ''));
      IF char_length(v_value) NOT BETWEEN 1 AND 30 THEN
        RAISE EXCEPTION 'invalid_option_value' USING ERRCODE = '22023', HINT = 'Keep each option from 1 to 30 characters.';
      END IF;
      v_leak := public.contact_leak_reason(v_value);
      IF v_leak IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
          MESSAGE = v_leak || ' in an option. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
      END IF;
      v_values := v_values || v_value;
    END LOOP;
    BEGIN
      v_price := (v_row ->> 'price_cents')::integer;
      v_stock := (v_row ->> 'stock_count')::integer;
      v_active := COALESCE((v_row ->> 'active')::boolean, true);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_variants' USING ERRCODE = '22023';
    END;
    IF v_price IS NULL OR v_price NOT BETWEEN 100 AND 500000 THEN
      RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023', HINT = 'Set a price from $1 to $5,000.';
    END IF;
    IF v_stock IS NOT NULL AND v_stock NOT BETWEEN 0 AND 9999 THEN
      RAISE EXCEPTION 'invalid_stock' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.shop_item_variants (item_id, option_values, price_cents, stock_count, active, position)
    VALUES (v_item.id, v_values, v_price, v_stock, v_active, v_pos)
    ON CONFLICT (item_id, option_values) DO UPDATE
      SET price_cents = EXCLUDED.price_cents, stock_count = EXCLUDED.stock_count,
          active = EXCLUDED.active, position = EXCLUDED.position, updated_at = now()
    RETURNING id INTO v_id;
    IF v_id = ANY (v_keep) THEN
      RAISE EXCEPTION 'invalid_variants' USING ERRCODE = '22023', HINT = 'Each combination once.';
    END IF;
    v_keep := v_keep || v_id;
    v_pos := v_pos + 1;
  END LOOP;

  -- Each list holds at most 10 values.
  FOR k IN 1 .. v_n LOOP
    IF (SELECT count(DISTINCT v.option_values[k]) FROM public.shop_item_variants v
         WHERE v.id = ANY (v_keep)) > 10 THEN
      RAISE EXCEPTION 'too_many_option_values' USING ERRCODE = '22023', HINT = 'Each option list has at most 10 choices.';
    END IF;
  END LOOP;
  IF v_n > 0 AND NOT EXISTS (SELECT 1 FROM public.shop_item_variants v WHERE v.id = ANY (v_keep) AND v.active) THEN
    RAISE EXCEPTION 'invalid_variants' USING ERRCODE = '22023', HINT = 'Offer at least one combination.';
  END IF;

  -- The rest: kept switched off while an order line names it, else removed.
  UPDATE public.shop_item_variants v SET active = false, updated_at = now()
   WHERE v.item_id = v_item.id AND NOT (v.id = ANY (v_keep)) AND v.active
     AND EXISTS (SELECT 1 FROM public.shop_order_lines ol WHERE ol.variant_id = v.id);
  DELETE FROM public.shop_item_variants v
   WHERE v.item_id = v_item.id AND NOT (v.id = ANY (v_keep))
     AND NOT EXISTS (SELECT 1 FROM public.shop_order_lines ol WHERE ol.variant_id = v.id);

  -- Q-variant-words (owner rule: content goes live at once; only a failed automatic check goes to an admin): the option
  -- lists and choices are words a buyer reads, so they pass the same word check as the title and description. A live
  -- item whose options fail it waits for an admin, the same as a live title edit (20261105173912 shops_update_item).
  -- A draft is checked when it is listed (shops_publish_item, below, reads the options too).
  v_flag := public.shop_item_text_flag(v_item.kind, v_item.title,
              COALESCE(v_item.description, '') || ' ' || public.shop_item_option_words(v_item.id));
  IF v_flag IS NOT NULL AND v_item.status IN ('live', 'pending_review') THEN
    UPDATE public.shop_item_private
       SET text_flag_reason = v_flag, updated_at = now()
     WHERE item_id = v_item.id;
    IF v_item.status = 'live' THEN
      UPDATE public.shop_items SET status = 'pending_review', admin_approved_at = NULL WHERE id = v_item.id;
    END IF;
  END IF;

  UPDATE public.shop_items SET updated_at = now() WHERE id = v_item.id;
  RETURN jsonb_build_object('item_id', v_item.id, 'option_names', to_jsonb(v_names), 'variant_count', cardinality(v_keep),
    'held_for_review', v_flag IS NOT NULL AND v_item.status = 'live');
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_item_variants(uuid, text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_item_variants(uuid, text[], jsonb) TO authenticated, service_role;

-- 3. RESTATED from 20261105235833_shops_every_category_sells.sql.
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
  IF v_item.kind NOT IN ('made', 'home_food', 'farm', 'service', 'rental') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
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
  -- The option lists and choices are checked with the title and description (shop_item_option_words, above).
  v_text_flag := public.shop_item_text_flag(v_item.kind, v_item.title,
                   COALESCE(v_item.description, '') || ' ' || public.shop_item_option_words(v_item.id));

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
