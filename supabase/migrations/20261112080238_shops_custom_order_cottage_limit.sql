-- S033 follow-up (Shops audit 11-12, reviewer note on adfd0149a9): a custom order checked the home-food yearly limit
-- with shop_cottage_cap_reached, which asks only whether the sales so far have reached it. A $5,000 home-food price for
-- a kitchen at $99,000 passed the quote and the buyer's card was held, only to be refused at accept (shops_accept_order
-- counts the order's own lines). Now the quote and the order take the price into account, exactly as the accept does:
-- sales counted + accepted orders not yet charged + this price must stay UNDER the limit (">=" refuses, La. R.S.
-- 40:4.9(B), Act 801 of 2026: the exemption ends when sales "equal $100,000 or more").
--   1. shop_cottage_would_reach(owner, add_cents): TRUE = this amount would bring the year to the limit or past it.
--      Fails safe (NULL owner, no limit row, NULL amount = TRUE). service_role only (callers are SECURITY DEFINER).
--   2. shops_quote_custom_request RESTATED from 20261106205852_shops_custom_order_accept.sql (newest CREATE).
--   3. shops_order_custom_quote RESTATED from 20261106212437_shops_custom_deposit_split.sql (newest CREATE).
-- Only the cottage line changes in each. MONEY: who can be charged (lh-money-escrow). AUTHZ: one new definer helper,
-- grants restated as before (lh-authz-rls). REPLAY-SAFE: CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsCustomCottageLimit.pglite.mjs (3x; NEW_MIGRATION=skip red).

-- 1.
CREATE OR REPLACE FUNCTION public.shop_cottage_would_reach(p_owner_id uuid, p_add_cents bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_owner_id IS NULL OR p_add_cents IS NULL
      OR COALESCE((SELECT public.shop_cottage_sales_cents(p_owner_id)
                          + (SELECT COALESCE(sum(ol.line_cents), 0) FROM public.shop_orders x
                               JOIN public.shop_order_lines ol ON ol.order_id = x.id AND ol.kind = 'home_food'
                              WHERE x.seller_id = p_owner_id AND x.status = 'accepted' AND x.captured_at IS NULL)
                          + p_add_cents >= c.cap_cents
                     FROM public.shop_cottage_settings c WHERE c.id), true);
$fn$;
REVOKE ALL ON FUNCTION public.shop_cottage_would_reach(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_cottage_would_reach(uuid, bigint) TO service_role;

-- 2.
CREATE OR REPLACE FUNCTION public.shops_quote_custom_request(p_request_id uuid, p_quote_cents integer, p_note text,
  p_subtype text, p_statements text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  r public.shop_custom_requests%ROWTYPE;
  s public.shops%ROWTYPE;
  v_kind text;
  v_need text[];
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_leak text;
  v_now timestamptz := now();
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT * INTO r FROM public.shop_custom_requests WHERE id = p_request_id FOR UPDATE;
  SELECT * INTO s FROM public.shops WHERE id = r.shop_id;
  IF r.id IS NULL OR s.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF s.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501';
  END IF;
  IF public.are_users_blocked(v_uid, r.buyer_id) THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF s.custom_orders = 'off' OR s.paused THEN
    RAISE EXCEPTION 'custom_orders_off' USING ERRCODE = '55000',
      HINT = 'Turn custom orders on (and your shop back on) before you send a price.';
  END IF;
  IF r.status <> 'requested' THEN
    RAISE EXCEPTION 'request_not_open' USING ERRCODE = '55000', HINT = 'This request has already been answered or closed.';
  END IF;
  IF p_quote_cents IS NULL OR p_quote_cents NOT BETWEEN 100 AND 500000 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023', HINT = 'Set a price from $1 to $5,000.';
  END IF;
  SELECT st.kind INTO v_kind FROM public.shop_item_subtypes st WHERE st.slug = p_subtype;
  IF v_kind IS NULL OR v_kind NOT IN ('made', 'home_food', 'farm', 'service') THEN
    RAISE EXCEPTION 'invalid_subtype' USING ERRCODE = '22023', HINT = 'Pick what you are making for this order.';
  END IF;
  -- Lead decision 11-06: the same seller statements as listing this kind, checked as shops_attest_item checks them.
  v_need := public.shop_item_required_statements(v_kind, p_subtype);
  IF v_need IS NULL OR p_statements IS NULL
     OR EXISTS (SELECT 1 FROM unnest(p_statements) x WHERE x IS NULL)
     OR (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(p_statements) x)
        IS DISTINCT FROM (SELECT array_agg(DISTINCT y ORDER BY y) FROM unnest(v_need) y) THEN
    RAISE EXCEPTION 'attestation_incomplete' USING ERRCODE = '22023',
      HINT = 'Tick every statement for this kind of order.';
  END IF;
  IF v_kind = 'home_food' THEN
    IF NOT EXISTS (SELECT 1 FROM public.shop_cottage_confirmations c
                    WHERE c.owner_id = v_uid AND c.limit_year = public.shop_cottage_year()) THEN
      RAISE EXCEPTION 'cottage_confirmation_required' USING ERRCODE = '22023';
    END IF;
    -- S033 follow-up: the price itself must fit under the limit, not only the sales so far.
    IF public.shop_cottage_would_reach(v_uid, p_quote_cents) THEN
      RAISE EXCEPTION 'cottage_cap_reached' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF char_length(COALESCE(v_note, '')) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Keep the note under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(COALESCE(v_note, ''));
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;

  UPDATE public.shop_custom_requests
     SET status = 'quoted', quote_cents = p_quote_cents, quote_note = v_note, subtype = p_subtype,
         statements = (SELECT array_agg(DISTINCT y ORDER BY y) FROM unnest(v_need) y), statements_at = v_now,
         quoted_at = v_now, expires_at = v_now + interval '7 days', updated_at = v_now
   WHERE id = r.id;
  PERFORM public.declutter_notify(r.buyer_id, 'info', 'Your custom order has a price',
    format('%s sent a price of %s for your custom order. It stands for 7 days.', s.name,
           to_char(p_quote_cents / 100.0, 'FM$999,990.00')),
    '/shops/orders', v_uid);
  RETURN jsonb_build_object('request_id', r.id, 'status', 'quoted', 'quote_cents', p_quote_cents,
    'subtype', p_subtype, 'expires_at', v_now + interval '7 days');
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_quote_custom_request(uuid, integer, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_quote_custom_request(uuid, integer, text, text, text[]) TO authenticated, service_role;

-- 3.
CREATE OR REPLACE FUNCTION public.shops_order_custom_quote(p_request_id uuid, p_shop_id uuid, p_ready_date date, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  r public.shop_custom_requests%ROWTYPE;
  s public.shops;
  v_kind text;
  v_today date := public.shop_local_today();
  v_note text := btrim(COALESCE(p_note, ''));
  v_leak text;
  v_items integer;
  v_order uuid;
  v_old_session text;
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
  -- The same budget as shops_request_order: each call writes an order row.
  IF (SELECT count(*) FROM public.shop_orders x WHERE x.buyer_id = v_uid AND x.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'too_many_order_requests' USING ERRCODE = '54000',
      HINT = 'You have started a lot of orders in the last hour. Wait a while and try again.';
  END IF;

  SELECT * INTO r FROM public.shop_custom_requests WHERE id = p_request_id FOR UPDATE;
  -- p_shop_id is the shop shop-checkout read the terms, the Stripe mode and the tax address from: it must be this
  -- request's shop.
  IF r.id IS NULL OR r.buyer_id IS DISTINCT FROM v_uid OR r.shop_id IS DISTINCT FROM p_shop_id THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF r.status <> 'quoted' OR r.expires_at <= now() THEN
    RAISE EXCEPTION 'quote_not_open' USING ERRCODE = '55000', HINT = 'This price is no longer open. Ask the shop again.';
  END IF;
  SELECT st.kind INTO v_kind FROM public.shop_item_subtypes st WHERE st.slug = r.subtype;
  IF v_kind IS NULL OR v_kind NOT IN ('made', 'home_food', 'farm', 'service') THEN
    RAISE EXCEPTION 'quote_not_open' USING ERRCODE = '55000', HINT = 'This price is no longer open. Ask the shop again.';
  END IF;
  -- The shop's statements for this kind, as a listed item needs them at publish (lead decision 11-06).
  IF r.statements IS DISTINCT FROM (SELECT array_agg(DISTINCT y ORDER BY y)
                                      FROM unnest(public.shop_item_required_statements(v_kind, r.subtype)) y) THEN
    RAISE EXCEPTION 'quote_not_open' USING ERRCODE = '55000', HINT = 'This price is no longer open. Ask the shop again.';
  END IF;

  -- The shop: locked so a pause or a close cannot slip between the checks and the insert.
  SELECT * INTO s FROM public.shops WHERE id = r.shop_id FOR SHARE;
  IF NOT FOUND OR NOT public.shop_visible_to(s.id, v_uid) OR public.are_users_blocked(v_uid, s.owner_id) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF s.paused THEN
    RAISE EXCEPTION 'shop_paused' USING ERRCODE = '55000', HINT = 'This shop is taking a break and is not taking new orders.';
  END IF;
  -- Slice 2 (review follow-up b on 9abcc8018a): the shop must still take custom orders when the buyer pays.
  IF s.custom_orders = 'off' THEN
    RAISE EXCEPTION 'custom_orders_off' USING ERRCODE = '55000', HINT = 'This shop is not taking custom orders right now.';
  END IF;
  IF NOT s.offers_selling OR public.shop_owner_sell_block_reason(s.owner_id) IS NOT NULL THEN
    RAISE EXCEPTION 'shop_not_selling' USING ERRCODE = '55000', HINT = 'This shop is not taking orders right now.';
  END IF;
  -- Slice 2a: the deposit split, gates and payout are built; the balance charge (2b) is not, so a deposit price is
  -- still refused and nothing is ever taken on a deposit promise. The plan is frozen on the request when it is
  -- sent, so only a new request can change it (review follow-up c on 9abcc8018a).
  IF r.payment_plan <> 'full_hold' THEN
    RAISE EXCEPTION 'deposit_not_ready' USING ERRCODE = '55000',
      HINT = 'Paying a deposit opens soon. Send the shop a new request after it opens.';
  END IF;

  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Keep the note under 500 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_note);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the note. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;

  -- The ready date (L21, D4): from tomorrow, at most 90 days out, on an open day, not on a full day.
  IF p_ready_date IS NULL OR p_ready_date < v_today + 1 THEN
    RAISE EXCEPTION 'ready_date_too_soon' USING ERRCODE = '22023',
      HINT = format('The earliest date for this order is %s.', to_char(v_today + 1, 'FMMonth FMDD'));
  END IF;
  IF p_ready_date > v_today + 90 THEN
    RAISE EXCEPTION 'ready_date_too_far' USING ERRCODE = '22023', HINT = 'Pick a date in the next 90 days.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shop_hours h WHERE h.shop_id = s.id AND h.weekday = extract(dow FROM p_ready_date)::smallint) THEN
    RAISE EXCEPTION 'shop_closed_that_day' USING ERRCODE = '22023', HINT = 'The shop does not fill orders on that day.';
  END IF;
  IF s.daily_order_cap IS NOT NULL
     AND public.shop_day_count(s.owner_id, p_ready_date, ARRAY['held', 'accepted', 'handed_over']) >= s.daily_order_cap THEN
    RAISE EXCEPTION 'day_full' USING ERRCODE = '55000', HINT = 'That day is full. Pick another day.';
  END IF;
  -- S033 follow-up: this order's own price counts, so a quote that would bring the year to the limit is refused before
  -- the buyer's card is held (shops_accept_order would refuse it later anyway).
  IF v_kind = 'home_food' AND public.shop_cottage_would_reach(s.owner_id, r.quote_cents) THEN
    RAISE EXCEPTION 'cottage_limit_reached' USING ERRCODE = '55000',
      HINT = 'This home kitchen has reached its yearly sales limit and cannot take home-food orders this year.';
  END IF;

  -- Asking again before paying replaces the unpaid page (its page is expired by shop-checkout).
  UPDATE public.shop_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
   WHERE buyer_id = v_uid AND seller_id = s.owner_id AND status = 'awaiting_hold'
  RETURNING stripe_checkout_session_id INTO v_old_session;

  v_items := r.quote_cents;
  INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, ready_date, cancel_policy, note,
                                  items_cents, premium_cents, tax_cents, total_cents, payment_plan)
  VALUES (v_uid, s.owner_id, s.id, p_ready_date, s.cancel_policy, v_note,
          v_items, public.declutter_buyer_fee_cents(v_items), 0, v_items + public.declutter_buyer_fee_cents(v_items),
          r.payment_plan)
  RETURNING id INTO v_order;
  INSERT INTO public.shop_order_lines (order_id, item_id, variant_id, variant_label, title, kind, unit_cents,
                                       quantity, line_cents, custom_request_id, is_seed)
  VALUES (v_order, NULL, NULL, NULL, left('Custom order: ' || r.description, 120), v_kind, v_items,
          1, v_items, r.id, (SELECT o.is_seed FROM public.shop_orders o WHERE o.id = v_order));
  UPDATE public.shop_custom_requests SET order_id = v_order, updated_at = now() WHERE id = r.id;

  RETURN jsonb_build_object('order_id', v_order, 'items_cents', v_items,
    'premium_cents', public.declutter_buyer_fee_cents(v_items),
    'ready_date', p_ready_date, 'superseded_session_id', v_old_session);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_order_custom_quote(uuid, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_order_custom_quote(uuid, uuid, date, text) TO authenticated, service_role;
