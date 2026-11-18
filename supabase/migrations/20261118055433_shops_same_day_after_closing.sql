-- Q2793 server half (Shops launch pass 2, 2026-11-18; decided by recommendation in pass 1): once the shop's
-- last closing time for today has passed in Louisiana, shops_request_order refuses today as the ready date
-- (ready_date_too_soon), the same rule the order sheet already applies (shopClosedForToday). A shop with no
-- hours row for today is unaffected here: shop_closed_that_day already refuses that day.
-- Restates shops_request_order from its newest CREATE (20261106165310_shops_item_variants) with one added check.
-- Replay-safe: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.shop_closed_for_today(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
           SELECT 1 FROM public.shop_hours h
            WHERE h.shop_id = p_shop_id
              AND h.weekday = extract(dow FROM (now() AT TIME ZONE 'America/Chicago'))::smallint)
     AND NOT EXISTS (
           SELECT 1 FROM public.shop_hours h
            WHERE h.shop_id = p_shop_id
              AND h.weekday = extract(dow FROM (now() AT TIME ZONE 'America/Chicago'))::smallint
              AND h.closes_local > (now() AT TIME ZONE 'America/Chicago')::time);
$fn$;
REVOKE ALL ON FUNCTION public.shop_closed_for_today(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_closed_for_today(uuid) TO authenticated, service_role;

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
  -- Q2793: a same-day order after the shop's last closing time today waits for the next open day (the order
  -- sheet greys today out the same way: src/lib/shops/orders.ts shopClosedForToday).
  IF p_ready_date = v_today AND public.shop_closed_for_today(s.id) THEN
    RAISE EXCEPTION 'ready_date_too_soon' USING ERRCODE = '22023',
      HINT = 'The shop has closed for today. Pick another day.';
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
