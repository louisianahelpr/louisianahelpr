-- Shops variants: option words hold an item the same way a live title edit does (Builder 4, 11-06; the lead's two
-- review follow-ups on ready/b4-shops-variant-textflag@3e3df6a539, lh-authz-rls PASS).
--   1. When new option words hold a live item: submitted_at moves to now and live_at clears; the AI verdict (it judged
--      the old words) and the admin approval clear, as shops_update_item does (20261105173912).
--   2. Only new words re-run the check: a price, stock or on/off change that leaves the words a buyer reads the same
--      never re-holds an item an admin approved.
--   RESTATED shops_set_item_variants from its NEWEST CREATE, 20261106194243_shops_option_words_checked.sql (only the
--   word-check block, three new variables and the returned held_for_review change).
-- AUTHZ: one restated member RPC (lh-authz-rls); grants unchanged. MONEY: no.
-- REPLAY-SAFE: CREATE OR REPLACE only.
-- Proof: src/test/pglite/shopsItemVariants.pglite.mjs (section 8c; FOLLOWUP_MIGRATION=skip leaves it RED).

-- RESTATED from 20261106194243_shops_option_words_checked.sql.
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
  v_old_words text;
  v_words_changed boolean;
  v_status text;
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

  -- The words a buyer reads before this save (review follow-up 2: only new words re-run the check).
  v_old_words := public.shop_item_option_words(v_item.id);

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
  -- lists and choices are words a buyer reads, so they pass the same word check as the title and description, with
  -- the same rule as a live title edit (shops_update_item, 20261105173912). Review follow-ups (11-06):
  --   1. New option words that hold a live item move submitted_at to now and clear live_at; the AI verdict (it judged
  --      the old words) and any admin approval are cleared, as shops_update_item does.
  --   2. Only NEW words re-run the check: a price, stock or on/off change that leaves the words a buyer reads the
  --      same never re-holds an item an admin approved.
  -- A live item with new words also waits after a rejection in the last 30 days, as a live title edit does.
  -- A draft is checked when it is listed (shops_publish_item reads the options too).
  v_words_changed := v_old_words IS DISTINCT FROM public.shop_item_option_words(v_item.id);
  v_status := v_item.status;
  IF v_words_changed THEN
    v_flag := public.shop_item_text_flag(v_item.kind, v_item.title,
                COALESCE(v_item.description, '') || ' ' || public.shop_item_option_words(v_item.id));
    IF v_item.status = 'live' AND (v_flag IS NOT NULL OR EXISTS (
         SELECT 1 FROM public.admin_audit_log l
          WHERE l.action = 'shop_item_rejected'
            AND l.details->>'owner_id' = v_uid::text
            AND l.created_at > now() - interval '30 days')) THEN
      v_status := 'pending_review';
    END IF;
    UPDATE public.shop_item_private
       SET ai_checked_at = NULL, ai_flag_reason = NULL,
           text_flag_reason = CASE WHEN v_item.status = 'draft' THEN text_flag_reason ELSE v_flag END,
           updated_at = now()
     WHERE item_id = v_item.id;
    UPDATE public.shop_items
       SET admin_approved_at = NULL,
           status = v_status,
           submitted_at = CASE WHEN v_status = 'pending_review' AND v_item.status = 'live' THEN now() ELSE submitted_at END,
           live_at = CASE WHEN v_status = 'live' THEN live_at END
     WHERE id = v_item.id;
  END IF;

  UPDATE public.shop_items SET updated_at = now() WHERE id = v_item.id;
  RETURN jsonb_build_object('item_id', v_item.id, 'option_names', to_jsonb(v_names), 'variant_count', cardinality(v_keep),
    'held_for_review', v_item.status = 'live' AND v_status = 'pending_review');
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_item_variants(uuid, text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_item_variants(uuid, text[], jsonb) TO authenticated, service_role;
