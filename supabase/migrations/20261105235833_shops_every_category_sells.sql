-- Shops H8 (audit ~/.lh-shots/audit-1105-shops.md H8; OWNER ANSWERS 11-05 #1: "LET THEM SELL TOO at launch (every
-- category can list sellable items/services with a price)"): a service or rental shop lists what it sells, with a
-- price, through the same item, order, hold, handover and payout flow as a maker.
--
-- 1. Two kinds sell: 'service' (work the shop does) and 'rental' (a thing the shop rents out, one price per rental;
--    the terms are in the description). The rentals calendar, deposits and late fees stay NOT-LAUNCHED Q1949.
--    No inflatable: a bounce house needs state inspection paperwork (Q1949's gate), so the word check sends one to
--    an admin; there is no inflatable subtype.
-- 2. Sales tax follows Jobs (salesTax.ts laborTaxCode; La. R.S. 47:301.3, the enumerated-services list): a service is
--    untaxed unless it is a repair of a movable item, cleaning of carpet/furniture, clothes cleaning or alterations.
--    Each service subtype carries that answer as shop_item_subtypes.tax_kind (the jobs.tax_kind words), and a
--    BEFORE INSERT trigger copies it onto the order line (shop_order_lines.tax_kind), so a later subtype change never
--    moves an order's tax. A rental is the lease of tangible personal property (taxed like a sale:
--    shopTaxCodes.ts). The txcd_ codes live only in salesTax.ts.
-- 3. The kind CHECKs widen (names read on prod 2026-11-05: shop_item_subtypes_kind_check, shop_items_kind_check,
--    shop_order_lines_kind_check); shop_order_lines' price CHECK is the caps migration's (20261105191330).
-- 4. The newest bodies are restated with only their kind lines changed (below).
-- Replay-safe: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD, ON CONFLICT DO NOTHING, CREATE OR REPLACE.
-- Shops stays behind its switch (require_feature('shops'), audience testers).
-- Proof: src/test/pglite/shopsEveryCategorySells.pglite.mjs. Guard: src/test/shopsEveryCategorySells.test.ts.

ALTER TABLE public.shop_item_subtypes DROP CONSTRAINT IF EXISTS shop_item_subtypes_kind_check;
ALTER TABLE public.shop_item_subtypes ADD CONSTRAINT shop_item_subtypes_kind_check
  CHECK (kind IN ('made', 'home_food', 'farm', 'service', 'rental'));
ALTER TABLE public.shop_item_subtypes ADD COLUMN IF NOT EXISTS tax_kind text;
ALTER TABLE public.shop_item_subtypes DROP CONSTRAINT IF EXISTS shop_item_subtypes_tax_kind_valid;
ALTER TABLE public.shop_item_subtypes ADD CONSTRAINT shop_item_subtypes_tax_kind_valid
  CHECK (tax_kind IS NULL OR (kind = 'service' AND tax_kind IN ('item_repair', 'fabric_cleaning', 'clothes_cleaning', 'clothing_alterations')));

ALTER TABLE public.shop_items DROP CONSTRAINT IF EXISTS shop_items_kind_check;
ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_kind_check
  CHECK (kind IN ('made', 'home_food', 'farm', 'service', 'rental'));

ALTER TABLE public.shop_order_lines DROP CONSTRAINT IF EXISTS shop_order_lines_kind_check;
ALTER TABLE public.shop_order_lines ADD CONSTRAINT shop_order_lines_kind_check
  CHECK (kind IN ('made', 'home_food', 'farm', 'service', 'rental'));
ALTER TABLE public.shop_order_lines ADD COLUMN IF NOT EXISTS tax_kind text;
ALTER TABLE public.shop_order_lines DROP CONSTRAINT IF EXISTS shop_order_lines_tax_kind_valid;
ALTER TABLE public.shop_order_lines ADD CONSTRAINT shop_order_lines_tax_kind_valid
  CHECK (tax_kind IS NULL OR (kind = 'service' AND tax_kind IN ('item_repair', 'fabric_cleaning', 'clothes_cleaning', 'clothing_alterations')));

-- The service and rental types. Labels follow the shop category groups (20261017224153_shop_categories_v2.sql).
INSERT INTO public.shop_item_subtypes (slug, kind, label, position, tax_kind) VALUES
  ('home_service', 'service', 'Home services', 400, NULL),
  ('trade_work', 'service', 'Trade work', 401, NULL),
  ('beauty_service', 'service', 'Beauty and grooming', 402, NULL),
  ('fitness_service', 'service', 'Health and fitness', 403, NULL),
  ('pet_care', 'service', 'Pet care', 404, NULL),
  ('lessons', 'service', 'Lessons and classes', 405, NULL),
  ('pro_service', 'service', 'Professional services', 406, NULL),
  ('outdoor_work', 'service', 'Yard and outdoor work', 407, NULL),
  ('event_service', 'service', 'Events and parties', 408, NULL),
  -- The four taxed services (R.S. 47:301.3; the same answers as Post a Job's tax question, Q2083).
  ('item_repair', 'service', 'Repair of an item', 420, 'item_repair'),
  ('fabric_cleaning', 'service', 'Carpet or furniture cleaning', 421, 'fabric_cleaning'),
  ('clothes_cleaning', 'service', 'Laundry or dry cleaning', 422, 'clothes_cleaning'),
  ('clothing_alterations', 'service', 'Clothing alterations', 423, 'clothing_alterations'),
  ('equipment_rental', 'rental', 'Equipment and tools', 500, NULL),
  ('party_rental', 'rental', 'Tables, chairs and tents', 501, NULL)
ON CONFLICT (slug) DO NOTHING;

-- The order line keeps its item's tax answer from the moment it is written.
CREATE OR REPLACE FUNCTION public.shop_order_line_snapshot_tax_kind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.tax_kind := CASE WHEN NEW.kind = 'service' THEN
    (SELECT st.tax_kind FROM public.shop_items i JOIN public.shop_item_subtypes st ON st.slug = i.subtype
      WHERE i.id = NEW.item_id) END;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_line_snapshot_tax_kind() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS shop_order_lines_snapshot_tax_kind ON public.shop_order_lines;
CREATE TRIGGER shop_order_lines_snapshot_tax_kind BEFORE INSERT ON public.shop_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.shop_order_line_snapshot_tax_kind();

-- 4. The newest bodies, restated (only the kind lines change).

-- Restated from shops_check_item_fields (20261105191330_shops_caps.sql; 500000 kept).
CREATE OR REPLACE FUNCTION public.shops_check_item_fields(
  p_kind text, p_subtype text, p_title text, p_description text, p_price_cents integer,
  p_lead_time_days integer, p_stock_count integer)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('made', 'home_food', 'farm', 'service', 'rental') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF p_subtype IS NULL OR NOT EXISTS (SELECT 1 FROM public.shop_item_subtypes s WHERE s.slug = p_subtype AND s.kind = p_kind) THEN
    RAISE EXCEPTION 'invalid_subtype' USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 3 AND 80 THEN
    RAISE EXCEPTION 'invalid_title' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(p_description, '')) > 2000 THEN
    RAISE EXCEPTION 'description_too_long' USING ERRCODE = '22023';
  END IF;
  -- Owner 11-05 (answer 5): up to $5,000 an item, for catering and big orders.
  IF p_price_cents IS NULL OR p_price_cents NOT BETWEEN 100 AND 500000 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023', HINT = 'Set a price from $1 to $5,000.';
  END IF;
  IF p_lead_time_days IS NULL OR p_lead_time_days NOT BETWEEN 0 AND 60 THEN
    RAISE EXCEPTION 'invalid_lead_time' USING ERRCODE = '22023';
  END IF;
  IF p_stock_count IS NOT NULL AND p_stock_count NOT BETWEEN 0 AND 9999 THEN
    RAISE EXCEPTION 'invalid_stock' USING ERRCODE = '22023';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_check_item_fields(text, text, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_check_item_fields(text, text, text, text, integer, integer, integer) TO service_role;

-- Restated from shops_publish_item (20261105173912_shops_items_live_at_once.sql).
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

-- Restated from shops_request_order (20261104175521_q2390_last_member_not_found_is_404.sql).
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
  v_seen uuid[] := ARRAY[]::uuid[];
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
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_order_lines' USING ERRCODE = '22023';
    END;
    IF v_qty IS NULL OR v_qty NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023', HINT = 'Order 1 to 20 of each item.';
    END IF;
    IF v_item.id IS NULL OR v_item.shop_id <> s.id OR v_item.status <> 'live' THEN
      RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '55000', HINT = 'An item in this order is no longer listed.';
    END IF;
    IF v_item.id = ANY (v_seen) THEN
      RAISE EXCEPTION 'invalid_order_lines' USING ERRCODE = '22023', HINT = 'Each item once, with a quantity.';
    END IF;
    v_seen := v_seen || v_item.id;
    IF v_item.kind NOT IN ('made', 'home_food', 'farm', 'service', 'rental') THEN
      RAISE EXCEPTION 'item_unavailable' USING ERRCODE = '55000';
    END IF;
    IF v_item.stock_count IS NOT NULL AND v_item.stock_count < v_qty THEN
      RAISE EXCEPTION 'out_of_stock' USING ERRCODE = '55000',
        HINT = format('Only %s of "%s" left.', v_item.stock_count, v_item.title);
    END IF;
    v_unit := public.shop_line_unit_cents(v_item.id, NULL);
    v_items := v_items + v_unit * v_qty;
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
  INSERT INTO public.shop_order_lines (order_id, item_id, title, kind, unit_cents, quantity, line_cents, is_seed)
  SELECT v_order, i.id, i.title, i.kind, public.shop_line_unit_cents(i.id, NULL), (l ->> 'quantity')::smallint,
         public.shop_line_unit_cents(i.id, NULL) * (l ->> 'quantity')::integer,
         (SELECT o.is_seed FROM public.shop_orders o WHERE o.id = v_order)
    FROM jsonb_array_elements(p_lines) l
    JOIN public.shop_items i ON i.id = (l ->> 'item_id')::uuid;

  RETURN jsonb_build_object('order_id', v_order, 'items_cents', v_items,
    'premium_cents', public.declutter_buyer_fee_cents(v_items),
    'ready_date', p_ready_date, 'superseded_session_id', v_old_session);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_request_order(p_shop_id uuid, p_lines jsonb, p_ready_date date, p_note text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_request_order(p_shop_id uuid, p_lines jsonb, p_ready_date date, p_note text) TO authenticated, service_role;

-- Restated from shop_item_required_statements (20261017061157_shops_items.sql).
CREATE OR REPLACE FUNCTION public.shop_item_required_statements(p_kind text, p_subtype text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE p_kind
    WHEN 'made' THEN ARRAY['made_by_me', 'new_not_used', 'not_for_children', 'not_skin_product', 'not_banned']
    WHEN 'home_food' THEN ARRAY['made_in_my_home_kitchen', 'low_risk_no_meat_fish', 'label_says_home_kitchen',
                                'kitchen_rules', 'no_cbd_or_alcohol', 'sales_tax_registered', 'not_banned']
    WHEN 'farm' THEN CASE p_subtype
      WHEN 'eggs' THEN ARRAY['own_hens', 'kept_cold', 'no_cracked_dirty', 'not_banned']
      WHEN 'produce' THEN ARRAY['home_grown', 'whole_uncut', 'not_banned']
    END
    -- H8 (owner 11-05, answer 1): services and rentals sell too.
    WHEN 'service' THEN ARRAY['i_do_this_work', 'licensed_if_needed', 'not_banned']
    WHEN 'rental' THEN ARRAY['i_own_it', 'safe_to_use', 'not_inflatable', 'not_banned']
  END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_item_required_statements(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_item_required_statements(text, text) TO service_role;

-- Restated from shop_item_text_flag (20261017061157_shops_items.sql).
CREATE OR REPLACE FUNCTION public.shop_item_text_flag(p_kind text, p_title text, p_description text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v text := lower(COALESCE(p_title, '') || ' ' || COALESCE(p_description, ''));
BEGIN
  IF v ~ '\m(beer|wine|liquor|whiskey|whisky|vodka|moonshine|alcohol|alcoholic|rum|bourbon|tequila|daiquiri|spirits)\M' THEN
    RETURN 'Mentions alcohol (not allowed in Shops).';
  END IF;
  IF v ~ '\m(cbd|thc|delta[- ]?8|delta[- ]?9|hemp|cannabis|marijuana|kratom)\M' THEN
    RETURN 'Mentions CBD, THC or hemp (not allowed in Shops).';
  END IF;
  IF v ~ '\m(vape|vapes|vaping|e-cig|e-cigarette|nicotine|tobacco|cigars?)\M' THEN
    RETURN 'Mentions vapes or tobacco (not allowed in Shops).';
  END IF;
  IF v ~ '\m(raw milk|unpasteurized)\M' THEN
    RETURN 'Mentions raw or unpasteurized milk (not allowed in Shops).';
  END IF;
  IF v ~ '\m(supplements?|vitamins?|medicine|medicinal|remedy|remedies|cures?|tinctures?)\M' THEN
    RETURN 'Mentions medicines or supplements (not allowed in Shops).';
  END IF;
  IF p_kind NOT IN ('service', 'rental') AND v ~ '\m(puppy|puppies|kitten|kittens|chicks|ducklings|live animals?|piglets?)\M' THEN
    RETURN 'Mentions live animals (not allowed in Shops).';
  END IF;
  IF v ~ '\m(gun|guns|firearms?|ammo|ammunition|rifle|pistol|knives)\M' THEN
    RETURN 'Mentions weapons (not allowed in Shops).';
  END IF;
  IF p_kind NOT IN ('service', 'rental') AND v ~ '\m(used|pre-owned|preowned|secondhand|second-hand|gently worn|thrifted|vintage)\M' THEN
    RETURN 'Sounds used. Shops sell new things the maker made; used things go in Declutter.';
  END IF;
  IF p_kind NOT IN ('service', 'rental') AND v ~ '\m(baby|babies|infant|toddler|kids|children''?s|toy|toys|crib|bib|onesie)\M' THEN
    RETURN 'Sounds like a children''s item (not at launch: federal safety testing).';
  END IF;
  IF p_kind NOT IN ('service', 'rental') AND v ~ '\m(soap|soaps|lotion|lotions|balm|balms|salve|salves|cosmetics?|skincare|skin care|lip gloss|scrub)\M' THEN
    RETURN 'Sounds like a skin product (soap, lotion and balms are not at launch).';
  END IF;
  IF p_kind NOT IN ('service', 'rental') AND v ~ '\m(seedlings?|plants?|succulents?|cut flowers|bouquets?|nursery)\M' THEN
    RETURN 'Sounds like plants or flowers (not at launch: plant dealer permit).';
  END IF;
  IF p_kind = 'home_food' AND v ~ '\m(meat|beef|pork|chicken|turkey|sausage|boudin|andouille|jerky|bacon|ham|crawfish|shrimp|crab|fish|seafood|oysters?|gumbo|jambalaya|tamales?|meat pies?|cracklins?|plate lunch)\M' THEN
    RETURN 'Home-kitchen food cannot contain meat or fish (needs a health permit).';
  END IF;
  IF p_kind = 'home_food' AND v ~ '\m(canned (vegetables|beans|corn|green beans|okra|tomatoes|meat)|home-canned)\M' THEN
    RETURN 'Home-canned vegetables or meat are not allowed (pickles and acidified foods are).';
  END IF;
  IF p_kind = 'rental' AND v ~ '\m(bounce houses?|bouncy castles?|bouncers?|inflatables?|moonwalks?|water slides?)\M' THEN
    RETURN 'Sounds like an inflatable (bounce houses need state inspection paperwork, coming later).';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_item_text_flag(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_item_text_flag(text, text, text) TO service_role;
