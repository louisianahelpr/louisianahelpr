-- Shops custom orders, slice 2b part 2: the SQL the edge side needs (Builder 4, 11-06; plan
-- ~/.lh-shots/handoffs-1106/builder4-shops.md; OWNER 11-06 balance-failure rule; LEAD 11-06 tax rule).
-- Stacked on 2b part 1 (20261106215722). Built by scratchpad/b4edge/gen.py (head.sql + the quote body cut from 2a).
--   1. A new Shops refund reason, unpaid_close_tax (fee policy full_platform_absorbs): on a close where no item changes
--      hands with the rest unpaid (the lapse, the buyer's late cancel, a no-show; trg_shop_orders_mark_unpaid_close),
--      the deposit's sales tax goes back to the buyer. The row is the order's one shop_refunds row: paid_cents is the
--      deposit's tax, tax_cents 0 (the money returned IS the tax, so none of it is "tax inside" to keep), nothing kept.
--      MONEY REVIEW: flagged (new reason, and its tax_cents = 0 reading).
--   2. shop_lapse_tax_done: the edge calls it after Stripe Tax's FULL reversal of the order's transaction; it writes
--      that refund row (sent by declutter-money's shop_refunds_due like every other) and marks the step done, at once.
--   3. shops_order_custom_quote: the deposit_not_ready refusal is dropped (the rest's charge, page and lapse now exist).
-- MONEY: yes (lh-money-escrow). AUTHZ: service-only except shops_order_custom_quote (member, gates unchanged).
-- REPLAY-SAFE: constraint swapped only when its text lacks the reason, CREATE OR REPLACE, grants restated.

-- 1. The reason and its fee policy. RESTATED from 20261019071055 (shop_refund_fee_policy; its only body).
CREATE OR REPLACE FUNCTION public.shop_refund_fee_policy(p_reason text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_reason IN ('shop_cancelled', 'no_ready_photo', 'shop_removed', 'problem_shop_fault') THEN 'full_shop_pays_fee'
    WHEN p_reason IN ('buyer_cancelled', 'problem_no_fault') THEN 'keep_card_fee'
    -- unpaid_close_tax: the tax goes back whole; no card fee is ever kept out of tax.
    WHEN p_reason IN ('problem_our_mistake', 'unpaid_close_tax') THEN 'full_platform_absorbs'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_fee_policy(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_fee_policy(text) TO service_role;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shop_refunds_reason_check'
                    AND conrelid = 'public.shop_refunds'::regclass
                    AND pg_get_constraintdef(oid) LIKE '%unpaid_close_tax%') THEN
    ALTER TABLE public.shop_refunds DROP CONSTRAINT IF EXISTS shop_refunds_reason_check;
    ALTER TABLE public.shop_refunds ADD CONSTRAINT shop_refunds_reason_check CHECK (reason IN (
      'buyer_cancelled', 'shop_cancelled', 'no_ready_photo', 'shop_removed',
      'problem_shop_fault', 'problem_no_fault', 'problem_our_mistake', 'unpaid_close_tax'));
  END IF;
END;
$do$;

-- 2. The tax step is done: Stripe Tax's transaction was reversed in full (the edge, before this call); the deposit's
--    tax goes back through the order's refund row. RESTATED from 20261106215722 (signature unchanged).
CREATE OR REPLACE FUNCTION public.shop_lapse_tax_done(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_tax integer;
  v_refund uuid;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.balance_lapsed_at IS NULL OR o.lapse_tax_done_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'not_owed', 'order_id', p_order_id);
  END IF;
  -- The deposit's tax: what the deposit capture took of the tax (the rest held floor(tax / 2), 2a).
  v_tax := o.tax_cents - o.tax_cents / 2;
  IF v_tax > 0 AND o.stripe_payment_intent_id IS NOT NULL THEN
    INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents,
                                     card_fee_cents, kept_cents, tax_kept_cents, refund_cents, note)
    VALUES (o.id, o.stripe_payment_intent_id, 'unpaid_close_tax', 'full_platform_absorbs', v_tax, 0,
            0, 0, 0, v_tax, 'Sales tax on the deposit: the order closed with no item handed over.')
    ON CONFLICT (order_id) DO NOTHING
    RETURNING id INTO v_refund;
    IF v_refund IS NULL THEN
      -- The order already has its one refund row (an earlier refund): a person settles the tax by hand.
      PERFORM public.log_cron_defect('shop_lapse_tax_done', o.id::text, 'order already has a refund row; deposit tax not queued');
    END IF;
  END IF;
  UPDATE public.shop_orders SET lapse_tax_done_at = now() WHERE id = o.id;
  RETURN jsonb_build_object('result', 'done', 'order_id', o.id, 'refund_id', v_refund, 'tax_cents', v_tax);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_lapse_tax_done(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_lapse_tax_done(uuid) TO service_role;

-- 3. shops_order_custom_quote: RESTATED from 20261106212437 with the deposit_not_ready refusal removed.
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
  -- Slice 2b: a deposit price is taken (half at accept, the rest from the ready date: 20261106215722 + this file).

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
