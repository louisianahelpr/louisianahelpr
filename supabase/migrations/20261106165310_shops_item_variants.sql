-- Shops variants (owner 11-05, answer 4: "several option lists per item, with a
-- price and stock for each combination"). Builder 5, 11-06.
--
-- An item gets up to 3 option lists (shop_items.option_names, e.g. Size,
-- Scent), and one shop_item_variants row per offered combination with its own
-- price and stock. Decided by recommendation (OWNER-DECISIONS 11-06): at most
-- 3 lists, 10 values a list, 100 combinations an item.
--
-- The item row stays the summary every list and card already reads: while an
-- item has option lists, price_cents is its lowest active combination price
-- ("From $X") and stock_count the sum of the active combinations' stock (NULL
-- when any has no limit). shop_items_variant_rollup keeps both in step, so the
-- item-level stock check in shops_request_order stays a true lower bound.
--
-- The money path: shop_line_unit_cents (the ONE price read) now prices a
-- variant; shops_request_order freezes the variant, its label and its price
-- on the line; shops_accept_order takes the combination's stock and
-- shop_return_stock / shop_order_capture_failed give it back. shop-checkout
-- is unchanged: it prices from the frozen lines and tax_kind is per item.

-- ---------------------------------------------------------------------------
-- 1. Tables.
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS option_names text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.shop_items DROP CONSTRAINT IF EXISTS shop_items_option_names_valid;
ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_option_names_valid
  CHECK (cardinality(option_names) <= 3 AND array_position(option_names, NULL) IS NULL);

CREATE TABLE IF NOT EXISTS public.shop_item_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.shop_items(id) ON DELETE CASCADE,
  -- One value per option list, in the list order of shop_items.option_names.
  option_values text[] NOT NULL CHECK (cardinality(option_values) BETWEEN 1 AND 3
                                       AND array_position(option_values, NULL) IS NULL),
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 100 AND 500000),
  stock_count integer CHECK (stock_count IS NULL OR stock_count BETWEEN 0 AND 9999),
  active boolean NOT NULL DEFAULT true,
  position smallint NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 99),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_item_variants_one_combination UNIQUE (item_id, option_values)
);
ALTER TABLE public.shop_item_variants ENABLE ROW LEVEL SECURITY;
-- Read only through shops_item_variants; written only by shops_set_item_variants
-- and the order RPCs (stock).
REVOKE ALL ON TABLE public.shop_item_variants FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_item_variants TO service_role;
COMMENT ON TABLE public.shop_item_variants IS
  'Shops variants: one row per offered option combination of a shop item, with its own price and stock. Purged with its item (ON DELETE CASCADE).';

DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- is_seed follows the item.
CREATE OR REPLACE FUNCTION public.shop_item_variants_seed_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  NEW.is_seed := COALESCE((SELECT i.is_seed FROM public.shop_items i WHERE i.id = NEW.item_id), false);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_item_variants_seed_from_item() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_item_variants_seed ON public.shop_item_variants;
CREATE TRIGGER trg_shop_item_variants_seed BEFORE INSERT ON public.shop_item_variants
  FOR EACH ROW EXECUTE FUNCTION public.shop_item_variants_seed_from_item();

-- Order lines name their combination (a snapshot label, like the title).
ALTER TABLE public.shop_order_lines ADD COLUMN IF NOT EXISTS variant_label text;
ALTER TABLE public.shop_order_lines DROP CONSTRAINT IF EXISTS shop_order_lines_variant_label_len;
ALTER TABLE public.shop_order_lines ADD CONSTRAINT shop_order_lines_variant_label_len
  CHECK (variant_label IS NULL OR char_length(variant_label) BETWEEN 1 AND 100);
ALTER TABLE public.shop_order_lines DROP CONSTRAINT IF EXISTS shop_order_lines_variant_id_fkey;
ALTER TABLE public.shop_order_lines ADD CONSTRAINT shop_order_lines_variant_id_fkey
  FOREIGN KEY (variant_id) REFERENCES public.shop_item_variants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS shop_order_lines_variant_idx ON public.shop_order_lines (variant_id) WHERE variant_id IS NOT NULL;
-- The same item twice in one order, as two combinations: each combination
-- once, each plain item once. (Not one NULLS NOT DISTINCT key: an item's
-- deletion sets item_id and variant_id NULL on every line it had, and two
-- combinations of one deleted item must not collide.)
ALTER TABLE public.shop_order_lines DROP CONSTRAINT IF EXISTS shop_order_lines_one_item;
CREATE UNIQUE INDEX IF NOT EXISTS shop_order_lines_one_variant
  ON public.shop_order_lines (order_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shop_order_lines_one_plain_item
  ON public.shop_order_lines (order_id, item_id) WHERE variant_id IS NULL;
GRANT SELECT (variant_label) ON TABLE public.shop_order_lines TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The item row follows its combinations.
CREATE OR REPLACE FUNCTION public.shop_items_variant_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_min integer;
  v_unlimited boolean;
  v_sum bigint;
BEGIN
  IF cardinality(NEW.option_names) = 0 THEN
    RETURN NEW;
  END IF;
  SELECT min(v.price_cents), bool_or(v.stock_count IS NULL), sum(v.stock_count)
    INTO v_min, v_unlimited, v_sum
    FROM public.shop_item_variants v WHERE v.item_id = NEW.id AND v.active;
  IF v_min IS NOT NULL THEN
    NEW.price_cents := v_min;
    NEW.stock_count := CASE WHEN v_unlimited THEN NULL ELSE least(v_sum, 9999)::integer END;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_items_variant_rollup() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_items_variant_rollup ON public.shop_items;
CREATE TRIGGER trg_shop_items_variant_rollup BEFORE UPDATE ON public.shop_items
  FOR EACH ROW EXECUTE FUNCTION public.shop_items_variant_rollup();

CREATE OR REPLACE FUNCTION public.shop_item_variants_touch_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  UPDATE public.shop_items SET updated_at = now()
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_item_variants_touch_item() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_item_variants_touch_item ON public.shop_item_variants;
CREATE TRIGGER trg_shop_item_variants_touch_item AFTER INSERT OR UPDATE OR DELETE ON public.shop_item_variants
  FOR EACH ROW EXECUTE FUNCTION public.shop_item_variants_touch_item();

-- ---------------------------------------------------------------------------
-- 3. The owner sets an item's option lists and combinations (the whole set).
-- p_variants: [{"values": ["Large", "Vanilla"], "price_cents": 1800,
--               "stock_count": 4 | null, "active": true}, ...]
-- A combination kept from before keeps its id (open orders point at it). One
-- left out is deleted, or only switched off while an order line names it.
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

  UPDATE public.shop_items SET updated_at = now() WHERE id = v_item.id;
  RETURN jsonb_build_object('item_id', v_item.id, 'option_names', to_jsonb(v_names), 'variant_count', cardinality(v_keep));
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_item_variants(uuid, text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_item_variants(uuid, text[], jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The read: every item's option lists and combinations for one shop, with
-- the visibility of shops_shop_items (owner: all but withdrawn items, with the
-- switched-off combinations; visitor: live items' active combinations only).
CREATE OR REPLACE FUNCTION public.shops_item_variants(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_mine boolean;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.shop_visible_to(p_shop_id, v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_mine := EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop_id AND s.owner_id = v_uid);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'item_id', i.id,
             'option_names', to_jsonb(i.option_names),
             'variants', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                        'id', v.id, 'values', to_jsonb(v.option_values), 'price_cents', v.price_cents,
                        'stock_count', v.stock_count, 'active', v.active)
                      ORDER BY v.position, v.id)
                 FROM public.shop_item_variants v
                WHERE v.item_id = i.id AND (v_mine OR v.active)), '[]'::jsonb))
           ORDER BY i.id)
      FROM public.shop_items i
     WHERE i.shop_id = p_shop_id
       AND cardinality(i.option_names) > 0
       AND (CASE WHEN v_mine THEN i.status <> 'withdrawn'
                 ELSE i.status = 'live' AND EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop_id AND s.offers_selling) END)),
    '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_item_variants(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_item_variants(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Prices: the ONE place a checkout reads a unit price, now with variants.
-- Restated from 20261018164442_shops_orders_checkout.sql.
CREATE OR REPLACE FUNCTION public.shop_line_unit_cents(p_item_id uuid, p_variant_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_cents integer;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT v.price_cents INTO v_cents FROM public.shop_item_variants v
     WHERE v.id = p_variant_id AND v.item_id = p_item_id AND v.active;
    IF v_cents IS NULL THEN
      RAISE EXCEPTION 'variant_not_available' USING ERRCODE = '22023';
    END IF;
    RETURN v_cents;
  END IF;
  -- An item with option lists is priced only through one of its combinations.
  IF EXISTS (SELECT 1 FROM public.shop_items WHERE id = p_item_id AND cardinality(option_names) > 0) THEN
    RAISE EXCEPTION 'variant_required' USING ERRCODE = '22023';
  END IF;
  SELECT price_cents INTO v_cents FROM public.shop_items WHERE id = p_item_id;
  RETURN v_cents;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_line_unit_cents(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_line_unit_cents(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. shops_request_order: restated from 20261105235833_shops_every_category_sells.sql
-- (a line may name a variant_id; priced, stock-checked and labelled per variant).
CREATE OR REPLACE FUNCTION public.shops_request_order(p_shop_id uuid, p_lines jsonb, p_ready_date date, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  s public.shops;
  v_today date := public.shop_local_today();
  v_line jsonb;
  v_item public.shop_items;
  v_qty integer;
  v_unit integer;
  v_items integer := 0;
  v_lead integer := 0;
  v_home_food boolean := false;
  v_order uuid;
  v_old_session text;
  v_note text := btrim(COALESCE(p_note, ''));
  v_leak text;
  v_seen text[] := ARRAY[]::text[];
  v_variant public.shop_item_variants;
  v_variant_id uuid;
  v_label text;
  v_resolved jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501',
      HINT = 'This account is suspended or banned. See /account-banned for details.';
  END IF;
  IF public.shop_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'shop_strikes_blocked' USING ERRCODE = '42501',
      HINT = 'You have 3 Shops strikes. Shops opens again when one expires.';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to order from Shops.';
  END IF;
  -- The RPC is callable straight through the API (past shop-checkout's rate
  -- limit), and each call writes an order row: at most 30 orders asked for in
  -- an hour per member (lh-authz-rls review, 2026-10-18).
  IF (SELECT count(*) FROM public.shop_orders x WHERE x.buyer_id = v_uid AND x.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'too_many_order_requests' USING ERRCODE = '54000',
      HINT = 'You have started a lot of orders in the last hour. Wait a while and try again.';
  END IF;

  -- The shop: locked so a pause or a close cannot slip between the checks and the insert.
  SELECT * INTO s FROM public.shops WHERE id = p_shop_id FOR SHARE;
  IF NOT FOUND OR NOT public.shop_visible_to(p_shop_id, v_uid) OR public.are_users_blocked(v_uid, s.owner_id) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF s.owner_id = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023', HINT = 'You cannot order from your own shop.';
  END IF;
  IF s.paused THEN
    RAISE EXCEPTION 'shop_paused' USING ERRCODE = '55000', HINT = 'This shop is taking a break and is not taking new orders.';
  END IF;
  IF NOT s.offers_selling OR public.shop_owner_sell_block_reason(s.owner_id) IS NOT NULL THEN
    RAISE EXCEPTION 'shop_not_selling' USING ERRCODE = '55000', HINT = 'This shop is not taking orders right now.';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_order_lines' USING ERRCODE = '22023', HINT = 'An order has 1 to 20 items.';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Keep the note under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_note);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;

  -- Every line: a live item of THIS shop, never a rental (S5), in stock.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_qty := (v_line ->> 'quantity')::integer;
      SELECT * INTO v_item FROM public.shop_items WHERE id = (v_line ->> 'item_id')::uuid;
      v_variant_id := NULLIF(v_line ->> 'variant_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_order_lines' USING ERRCODE = '22023';
    END;
    IF v_qty IS NULL OR v_qty NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023', HINT = 'Order 1 to 20 of each item.';
    END IF;
    IF v_item.id IS NULL OR v_item.shop_id <> s.id OR v_item.status <> 'live' THEN
      RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '55000', HINT = 'An item in this order is no longer listed.';
    END IF;
    -- Variants (owner 11-05): an item with option lists is ordered as one of
    -- its active combinations; an item without them takes no variant.
    v_label := NULL;
    v_variant := NULL;
    IF cardinality(v_item.option_names) > 0 THEN
      IF v_variant_id IS NULL THEN
        RAISE EXCEPTION 'variant_required' USING ERRCODE = '22023', HINT = format('Pick an option for "%s".', v_item.title);
      END IF;
      SELECT * INTO v_variant FROM public.shop_item_variants WHERE id = v_variant_id;
      IF v_variant.id IS NULL OR v_variant.item_id <> v_item.id OR NOT v_variant.active THEN
        RAISE EXCEPTION 'variant_not_available' USING ERRCODE = '55000', HINT = 'That option is no longer offered.';
      END IF;
      IF v_variant.stock_count IS NOT NULL AND v_variant.stock_count < v_qty THEN
        RAISE EXCEPTION 'out_of_stock' USING ERRCODE = '55000',
          HINT = format('Only %s of "%s (%s)" left.', v_variant.stock_count, v_item.title, array_to_string(v_variant.option_values, ' / '));
      END IF;
      v_label := array_to_string(v_variant.option_values, ' / ');
    ELSIF v_variant_id IS NOT NULL THEN
      RAISE EXCEPTION 'variant_not_available' USING ERRCODE = '55000', HINT = 'That option is no longer offered.';
    END IF;
    IF (v_item.id::text || ':' || COALESCE(v_variant_id::text, '')) = ANY (v_seen) THEN
      RAISE EXCEPTION 'invalid_order_lines' USING ERRCODE = '22023', HINT = 'Each item once, with a quantity.';
    END IF;
    v_seen := v_seen || (v_item.id::text || ':' || COALESCE(v_variant_id::text, ''));
    IF v_item.kind NOT IN ('made', 'home_food', 'farm', 'service', 'rental') THEN
      RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '55000';
    END IF;
    IF v_item.stock_count IS NOT NULL AND v_item.stock_count < v_qty THEN
      RAISE EXCEPTION 'out_of_stock' USING ERRCODE = '55000',
        HINT = format('Only %s of "%s" left.', v_item.stock_count, v_item.title);
    END IF;
    v_unit := public.shop_line_unit_cents(v_item.id, v_variant_id);
    v_items := v_items + v_unit * v_qty;
    v_resolved := v_resolved || jsonb_build_object(
      'item_id', v_item.id, 'variant_id', v_variant_id, 'quantity', v_qty, 'unit_cents', v_unit,
      'title', CASE WHEN v_label IS NULL THEN v_item.title ELSE left(v_item.title || ' (' || v_label || ')', 120) END,
      'variant_label', v_label);
    v_lead := greatest(v_lead, v_item.lead_time_days);
    v_home_food := v_home_food OR v_item.kind = 'home_food';
  END LOOP;

  -- The ready date (L21, D4): after every item's lead time, at most 90 days out, on an open day.
  IF p_ready_date IS NULL OR p_ready_date < v_today + v_lead THEN
    RAISE EXCEPTION 'ready_date_too_soon' USING ERRCODE = '22023',
      HINT = format('The earliest date for this order is %s.', to_char(v_today + v_lead, 'FMMonth FMDD'));
  END IF;
  IF p_ready_date > v_today + 90 THEN
    RAISE EXCEPTION 'ready_date_too_far' USING ERRCODE = '22023', HINT = 'Pick a date in the next 90 days.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shop_hours h WHERE h.shop_id = s.id AND h.weekday = extract(dow FROM p_ready_date)::smallint) THEN
    RAISE EXCEPTION 'shop_closed_that_day' USING ERRCODE = '22023', HINT = 'The shop does not fill orders on that day.';
  END IF;
  -- L22: a full day greys out (held orders take a slot until they are answered).
  IF s.daily_order_cap IS NOT NULL
     AND public.shop_day_count(s.owner_id, p_ready_date, ARRAY['held', 'accepted', 'handed_over']) >= s.daily_order_cap THEN
    RAISE EXCEPTION 'day_full' USING ERRCODE = '55000', HINT = 'That day is full. Pick another day.';
  END IF;
  -- L8: no new home-food orders once the yearly limit is reached.
  IF v_home_food AND public.shop_cottage_cap_reached(s.owner_id) THEN
    RAISE EXCEPTION 'cottage_limit_reached' USING ERRCODE = '55000',
      HINT = 'This home kitchen has reached its yearly sales limit and cannot take home-food orders this year.';
  END IF;

  -- Asking again before paying replaces the unpaid page (its page is expired by shop-checkout).
  UPDATE public.shop_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
   WHERE buyer_id = v_uid AND seller_id = s.owner_id AND status = 'awaiting_hold'
  RETURNING stripe_checkout_session_id INTO v_old_session;

  INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, ready_date, cancel_policy, note,
                                  items_cents, premium_cents, tax_cents, total_cents)
  VALUES (v_uid, s.owner_id, s.id, p_ready_date, s.cancel_policy, v_note,
          v_items, public.declutter_buyer_fee_cents(v_items), 0, v_items + public.declutter_buyer_fee_cents(v_items))
  RETURNING id INTO v_order;
  -- The lines exactly as checked and priced above (one price read per line).
  INSERT INTO public.shop_order_lines (order_id, item_id, variant_id, variant_label, title, kind, unit_cents,
                                       quantity, line_cents, is_seed)
  SELECT v_order, r.item_id, r.variant_id, r.variant_label, r.title, i.kind, r.unit_cents, r.quantity::smallint,
         r.unit_cents * r.quantity, (SELECT o.is_seed FROM public.shop_orders o WHERE o.id = v_order)
    FROM jsonb_to_recordset(v_resolved)
           AS r(item_id uuid, variant_id uuid, quantity integer, unit_cents integer, title text, variant_label text)
    JOIN public.shop_items i ON i.id = r.item_id;

  RETURN jsonb_build_object('order_id', v_order, 'items_cents', v_items,
    'premium_cents', public.declutter_buyer_fee_cents(v_items),
    'ready_date', p_ready_date, 'superseded_session_id', v_old_session);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_request_order(p_shop_id uuid, p_lines jsonb, p_ready_date date, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_request_order(p_shop_id uuid, p_lines jsonb, p_ready_date date, p_note text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. shops_accept_order: restated from 20261104175521_q2390_last_member_not_found_is_404.sql
-- (the combination's stock is taken too).
CREATE OR REPLACE FUNCTION public.shops_accept_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_cap smallint;
  l record;
  v_block text;
  v_home_food bigint;
  v_cottage_cap bigint;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'accepted' THEN
    -- A retry after the capture step failed to answer: the edge function captures again (idempotent).
    -- Not re-checked for a block made since: the order was accepted (hired) before it, as for every hire.
    RETURN jsonb_build_object('result', 'already_accepted', 'order_id', o.id, 'captured', o.captured_at IS NOT NULL);
  END IF;
  IF o.status <> 'held' THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000', HINT = 'This order is no longer waiting for an answer.';
  END IF;
  IF now() > o.accept_by THEN
    RAISE EXCEPTION 'order_expired' USING ERRCODE = '55000', HINT = 'The 24 hours to accept have passed.';
  END IF;
  -- The maker must be able to be paid at handover (L3: payout setup) and in good standing.
  v_block := public.shop_owner_sell_block_reason(v_uid);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION '%', v_block USING ERRCODE = '42501';
  END IF;
  -- The buyer must still be able to buy from this maker (a block or a ban
  -- since the order was sent): the maker declines instead, and the hold drops.
  -- A block is refused on its own, before any write, with the code every hire
  -- RPC uses (Q345, hireRefusedAcrossBlock; its words never say who blocked).
  IF public.are_users_blocked(v_uid, o.buyer_id) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501',
      HINT = 'This order can no longer be accepted. Decline it so the buyer''s hold is released.';
  END IF;
  IF o.buyer_id IS NULL OR EXISTS (
       SELECT 1 FROM public.profiles pr
        WHERE pr.user_id = o.buyer_id
          AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
          AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now())) THEN
    RAISE EXCEPTION 'buyer_unavailable' USING ERRCODE = '55000',
      HINT = 'This order can no longer be accepted. Decline it so the buyer''s hold is released.';
  END IF;
  -- Every accept of this shop is serialized on the shop row (FOR UPDATE), so
  -- two accepts at once cannot both take the day's last slot (L22) or both
  -- fit under the home-food yearly limit (L8). Only accepted orders count now.
  SELECT daily_order_cap INTO v_cap FROM public.shops WHERE id = o.shop_id FOR UPDATE;
  -- A shop Louisiana Helpr hid takes no money (lh-authz-rls review, 2026-10-18).
  IF EXISTS (SELECT 1 FROM public.shops WHERE id = o.shop_id AND hidden_at IS NOT NULL) THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501',
      HINT = 'Louisiana Helpr hid your shop, so it cannot accept orders. Decline them so the buyers'' holds are released.';
  END IF;
  IF v_cap IS NOT NULL AND public.shop_day_count(v_uid, o.ready_date, ARRAY['accepted', 'handed_over']) >= v_cap THEN
    RAISE EXCEPTION 'day_full' USING ERRCODE = '55000', HINT = 'You already accepted your most orders for that day.';
  END IF;
  -- L8 at acceptance: sales already counted + accepted orders not yet charged
  -- + this order's home-food lines must stay within the yearly limit.
  SELECT COALESCE(sum(line_cents), 0) INTO v_home_food FROM public.shop_order_lines
   WHERE order_id = o.id AND kind = 'home_food';
  IF v_home_food > 0 THEN
    SELECT c.cap_cents INTO v_cottage_cap FROM public.shop_cottage_settings c WHERE c.id;
    IF v_cottage_cap IS NULL OR public.shop_cottage_sales_cents(v_uid)
         + (SELECT COALESCE(sum(ol.line_cents), 0) FROM public.shop_orders x
              JOIN public.shop_order_lines ol ON ol.order_id = x.id AND ol.kind = 'home_food'
             WHERE x.seller_id = v_uid AND x.status = 'accepted' AND x.captured_at IS NULL AND x.id <> o.id)
         + v_home_food > v_cottage_cap THEN
      RAISE EXCEPTION 'cottage_limit_reached' USING ERRCODE = '55000',
        HINT = 'Accepting this order would go over your yearly home-food sales limit. Decline it so the buyer''s hold is released.';
    END IF;
  END IF;
  -- L20: stock is taken at acceptance, items locked in id order (no deadlock between two accepts).
  FOR l IN
    SELECT ol.item_id, ol.quantity, i.stock_count, i.title
      FROM public.shop_order_lines ol JOIN public.shop_items i ON i.id = ol.item_id
     WHERE ol.order_id = o.id
     ORDER BY ol.item_id
       FOR UPDATE OF i
  LOOP
    IF l.stock_count IS NOT NULL AND l.stock_count < l.quantity THEN
      RAISE EXCEPTION 'out_of_stock' USING ERRCODE = '55000',
        HINT = format('You have %s of "%s" left; this order needs %s.', l.stock_count, l.title, l.quantity);
    END IF;
  END LOOP;
  -- Variants: each combination's own stock, locked in id order after the items.
  FOR l IN
    SELECT ol.variant_id, ol.quantity, v.stock_count, ol.title
      FROM public.shop_order_lines ol JOIN public.shop_item_variants v ON v.id = ol.variant_id
     WHERE ol.order_id = o.id
     ORDER BY ol.variant_id
       FOR UPDATE OF v
  LOOP
    IF l.stock_count IS NOT NULL AND l.stock_count < l.quantity THEN
      RAISE EXCEPTION 'out_of_stock' USING ERRCODE = '55000',
        HINT = format('You have %s of "%s" left; this order needs %s.', l.stock_count, l.title, l.quantity);
    END IF;
  END LOOP;
  UPDATE public.shop_item_variants v SET stock_count = v.stock_count - ol.quantity, updated_at = now()
    FROM public.shop_order_lines ol
   WHERE ol.order_id = o.id AND ol.variant_id = v.id AND v.stock_count IS NOT NULL;
  -- An item with variants takes its stock from them (shop_items_variant_rollup).
  UPDATE public.shop_items i SET stock_count = i.stock_count - ol.quantity, updated_at = now()
    FROM public.shop_order_lines ol
   WHERE ol.order_id = o.id AND ol.item_id = i.id AND i.stock_count IS NOT NULL AND ol.variant_id IS NULL;
  UPDATE public.shop_orders SET status = 'accepted', accepted_at = now() WHERE id = o.id;
  RETURN jsonb_build_object('result', 'accepted', 'order_id', o.id, 'captured', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_accept_order(p_order_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_accept_order(p_order_id uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Stock back: restated from 20261019071055_shops_refunds_cancels_strikes.sql
-- (items, then variants, each locked in id order, as shops_accept_order).
CREATE OR REPLACE FUNCTION public.shop_return_stock(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM 1 FROM public.shop_items i JOIN public.shop_order_lines ol ON ol.item_id = i.id
   WHERE ol.order_id = p_order_id ORDER BY i.id FOR UPDATE OF i;
  PERFORM 1 FROM public.shop_item_variants v JOIN public.shop_order_lines ol ON ol.variant_id = v.id
   WHERE ol.order_id = p_order_id ORDER BY v.id FOR UPDATE OF v;
  UPDATE public.shop_item_variants v SET stock_count = least(v.stock_count + ol.quantity, 9999), updated_at = now()
    FROM public.shop_order_lines ol
   WHERE ol.order_id = p_order_id AND ol.variant_id = v.id AND v.stock_count IS NOT NULL;
  UPDATE public.shop_items i SET stock_count = i.stock_count + ol.quantity, updated_at = now()
    FROM public.shop_order_lines ol
   WHERE ol.order_id = p_order_id AND ol.item_id = i.id AND i.stock_count IS NOT NULL AND ol.variant_id IS NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_return_stock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_return_stock(uuid) TO service_role;

-- 9. shop_order_capture_failed: restated from 20261018164442_shops_orders_checkout.sql
-- (its stock return goes through shop_return_stock, so variants come back too).
CREATE OR REPLACE FUNCTION public.shop_order_capture_failed(p_order_id uuid, p_error text, p_final boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.status <> 'accepted' OR o.captured_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'nothing_to_do');
  END IF;
  IF NOT COALESCE(p_final, false) AND now() < o.held_at + interval '6 days' THEN
    UPDATE public.shop_orders SET capture_attempts = capture_attempts + 1, capture_last_error = left(p_error, 500),
                                  capture_last_attempt_at = now()
     WHERE id = o.id;
    RETURN jsonb_build_object('result', 'will_retry', 'attempts', o.capture_attempts + 1);
  END IF;
  -- Stock back (items, then variants, locked in id order like shops_accept_order).
  PERFORM public.shop_return_stock(o.id);
  UPDATE public.shop_orders
     SET status = 'cancelled',
         close_reason = CASE WHEN COALESCE(p_final, false) THEN 'hold_lost' ELSE 'capture_gave_up' END,
         closed_at = now(),
         hold_released_at = CASE WHEN COALESCE(p_final, false) THEN now() ELSE NULL END,
         capture_attempts = capture_attempts + 1, capture_last_error = left(p_error, 500), capture_last_attempt_at = now()
   WHERE id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order could not go through',
    'Your card could not be charged for this order, so it is cancelled. Nothing was charged, and any hold on your card is released.',
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order cancelled',
    format('The buyer''s card could not be charged for the order for %s, so it is cancelled. Do not make it.',
           to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'cancelled', 'order_id', o.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_capture_failed(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_capture_failed(uuid, text, boolean) TO service_role;

