-- Shops custom orders, slice 1b: the buyer takes the shop's price, and it becomes an ordinary one-line order (Builder 4,
-- 11-06; plan ~/.lh-shots/handoffs-1106/builder4-shops.md). Stacked on slice 1a (20261106202917).
-- Money here is ONLY the full-payment plan, today's order flow unchanged: request -> card hold at Checkout -> the shop
-- accepts (full capture) -> handover -> the shop is paid. A shop on the 50% deposit plan is refused with
-- deposit_not_ready until slice 2 builds the deposit money, so nothing is ever charged in full on a deposit promise.
--
-- What this adds:
--   1. shop_custom_requests.subtype (what is being made: a shop_item_subtypes slug, never a rental, S5) and order_id
--      (the order the price became). The shop names the subtype when it quotes, because the line's kind sets its tax
--      code (shopTaxCode) and a home-food order counts toward the cottage limit.
--   2. shop_order_lines.custom_request_id: the line a custom order is made of (item_id NULL; every stock step joins
--      shop_items on item_id, so a custom line takes and returns no stock; the cottage steps read ol.kind).
--   3. shops_quote_custom_request(request, cents, note, subtype, statements): REPLACES slice 1a's 3-argument version
--      (dropped). Lead decision 11-06: the shop ticks the same seller statements as listing that kind of item
--      (shop_item_required_statements(kind, subtype), e.g. the cottage-food statements for home food), checked exactly
--      as shops_attest_item checks them, and stored on the request (statements, statements_at); a quote without every
--      one is refused (attestation_incomplete). shops_order_custom_quote re-checks them. Also
--      re-checks the shop still takes custom orders and is not paused (authz review note b on 6888a63602). A home-food
--      price needs this year's cottage confirmation and the limit not reached, as listing a home-food item does.
--   4. shops_decline_custom_request RESTATED from 20261106202917 (authz review note a): a banned caller is refused, and
--      a blocked pair closes the request without a notice.
--   5. shops_order_custom_quote(request, shop, ready_date, note): the buyer takes an open, unexpired price of that shop. The same gates as
--      shops_request_order (20261106165310) for the buyer and the shop; the ready date is an open day from tomorrow
--      to 90 days out, not on a full day; the cottage limit for home food. It retires the buyer's unpaid page with
--      this shop (as shops_request_order does) and writes one order and one line at the quoted price; premium is the
--      buyer fee on it (declutter_buyer_fee_cents), tax 0 until shop-checkout's tax step.
--   6. shop_order_line_snapshot_tax_kind RESTATED from 20261106164313 (H8 at_buyer kept): a custom service line takes its tax answer from
--      the request's subtype (an item line is unchanged).
--   7. trg_shop_orders_custom_request_accepted: when the order's hold is placed (status -> 'held'), its request is marked
--      'accepted' with order_id, so the price never expires under a paid order and cannot be ordered twice.
-- MONEY: yes (lh-money-escrow): a new order writer and the line tax answer. AUTHZ: one replaced and one new member RPC,
--   one restated member RPC, one trigger (lh-authz-rls).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, DROP FUNCTION IF EXISTS (the 1a signature, never landed with callers), DROP
--   TRIGGER IF EXISTS, CREATE OR REPLACE.
-- Edge: shop-checkout's 'order' action takes custom_request_id (no lines) and calls shops_order_custom_quote as the buyer;
--   everything after it (terms check, delivery, tax, Checkout page) is the ordinary order path.
-- Proof: src/test/pglite/shopsCustomRequests.pglite.mjs sections 7-9 (CUSTOM_ORDER_MIGRATION=skip red).

-- 1-2. Columns.
ALTER TABLE public.shop_custom_requests
  ADD COLUMN IF NOT EXISTS subtype text REFERENCES public.shop_item_subtypes(slug),
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.shop_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS statements text[],
  ADD COLUMN IF NOT EXISTS statements_at timestamptz;
ALTER TABLE public.shop_order_lines
  ADD COLUMN IF NOT EXISTS custom_request_id uuid REFERENCES public.shop_custom_requests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS shop_order_lines_custom_request_idx ON public.shop_order_lines (custom_request_id)
  WHERE custom_request_id IS NOT NULL;

-- 3. The shop's price names what is being made.
DROP FUNCTION IF EXISTS public.shops_quote_custom_request(uuid, integer, text);
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
    IF public.shop_cottage_cap_reached(v_uid) THEN
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

-- 4. RESTATED from 20261106202917_shops_custom_requests.sql (the ban check and the blocked-pair notice change).
CREATE OR REPLACE FUNCTION public.shops_decline_custom_request(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  r public.shop_custom_requests%ROWTYPE;
  s public.shops%ROWTYPE;
  v_status text;
  v_blocked boolean;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.shop_custom_requests WHERE id = p_request_id FOR UPDATE;
  SELECT * INTO s FROM public.shops WHERE id = r.shop_id;
  IF r.id IS NULL OR v_uid NOT IN (r.buyer_id, s.owner_id) THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF r.status NOT IN ('requested', 'quoted') OR (r.status = 'quoted' AND r.expires_at <= now()) THEN
    RAISE EXCEPTION 'request_not_open' USING ERRCODE = '55000', HINT = 'This request is already closed.';
  END IF;
  v_status := CASE WHEN v_uid = r.buyer_id THEN 'withdrawn' ELSE 'declined' END;
  UPDATE public.shop_custom_requests SET status = v_status, closed_at = now(), updated_at = now() WHERE id = r.id;
  -- A blocked pair still closes it (closing is harmless), but neither side is sent a notice by the other.
  v_blocked := public.are_users_blocked(r.buyer_id, s.owner_id);
  IF v_status = 'declined' AND NOT v_blocked THEN
    PERFORM public.declutter_notify(r.buyer_id, 'info', 'Custom order declined',
      format('%s cannot take your custom order. Nothing was charged.', s.name), '/shops/orders', v_uid);
  ELSIF v_status = 'withdrawn' AND NOT v_blocked THEN
    PERFORM public.declutter_notify(s.owner_id, 'info', 'Custom order request withdrawn',
      'The buyer withdrew their custom order request. There is nothing to do.', '/shops/dashboard', v_uid);
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_decline_custom_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_decline_custom_request(uuid) TO authenticated, service_role;

-- 5. The buyer takes the price: one order, one line.
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
  IF NOT s.offers_selling OR public.shop_owner_sell_block_reason(s.owner_id) IS NOT NULL THEN
    RAISE EXCEPTION 'shop_not_selling' USING ERRCODE = '55000', HINT = 'This shop is not taking orders right now.';
  END IF;
  -- Slice 2 builds the deposit money. Until then a deposit price is never charged in full.
  IF r.payment_plan <> 'full_hold' THEN
    RAISE EXCEPTION 'deposit_not_ready' USING ERRCODE = '55000',
      HINT = 'Paying a deposit opens soon. Ask the shop to send the price again with full payment.';
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
  IF v_kind = 'home_food' AND public.shop_cottage_cap_reached(s.owner_id) THEN
    RAISE EXCEPTION 'cottage_limit_reached' USING ERRCODE = '55000',
      HINT = 'This home kitchen has reached its yearly sales limit and cannot take home-food orders this year.';
  END IF;

  -- Asking again before paying replaces the unpaid page (its page is expired by shop-checkout).
  UPDATE public.shop_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
   WHERE buyer_id = v_uid AND seller_id = s.owner_id AND status = 'awaiting_hold'
  RETURNING stripe_checkout_session_id INTO v_old_session;

  v_items := r.quote_cents;
  INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, ready_date, cancel_policy, note,
                                  items_cents, premium_cents, tax_cents, total_cents)
  VALUES (v_uid, s.owner_id, s.id, p_ready_date, s.cancel_policy, v_note,
          v_items, public.declutter_buyer_fee_cents(v_items), 0, v_items + public.declutter_buyer_fee_cents(v_items))
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

-- 6. RESTATED from 20261106164313_shops_service_at_buyer.sql (its at_buyer line kept): a custom service line reads its request's subtype.
CREATE OR REPLACE FUNCTION public.shop_order_line_snapshot_tax_kind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.tax_kind := CASE WHEN NEW.kind = 'service' THEN
    COALESCE(
      (SELECT st.tax_kind FROM public.shop_items i JOIN public.shop_item_subtypes st ON st.slug = i.subtype
        WHERE i.id = NEW.item_id),
      (SELECT st.tax_kind FROM public.shop_custom_requests cr JOIN public.shop_item_subtypes st ON st.slug = cr.subtype
        WHERE NEW.item_id IS NULL AND cr.id = NEW.custom_request_id)) END;
  -- H8 (b), kept from 20261106164313: done at the buyer's place, only for carpet or furniture cleaning. A custom
  -- line has no item, so it is never at the buyer's place.
  NEW.at_buyer := COALESCE(NEW.tax_kind = 'fabric_cleaning' AND
    (SELECT i.at_buyer FROM public.shop_items i WHERE i.id = NEW.item_id), false);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_line_snapshot_tax_kind() FROM PUBLIC, anon, authenticated;

-- 7. The hold is placed: the request is accepted and points at its order.
CREATE OR REPLACE FUNCTION public.shop_orders_custom_request_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF NEW.status = 'held' AND OLD.status IS DISTINCT FROM 'held' THEN
    UPDATE public.shop_custom_requests cr
       SET status = 'accepted', order_id = NEW.id, closed_at = now(), updated_at = now()
      FROM public.shop_order_lines ol
     WHERE ol.order_id = NEW.id AND ol.custom_request_id = cr.id AND cr.status IN ('quoted', 'expired');
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_orders_custom_request_accepted() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_orders_custom_request_accepted ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_custom_request_accepted AFTER UPDATE OF status ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_custom_request_accepted();
