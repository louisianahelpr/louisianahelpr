-- Shops gets its OWN strike count (owner decision via the lead, 2026-10-18:
-- strikes and bans are PER SECTION; this overrides L45 "one marketplace strike
-- count shared with Declutter"). Whole-account bans stay as they are
-- (is_caller_banned / ban_status) for fraud, scams, harassment and safety.
--
-- Before: every Shops gate read declutter_active_strike_count, so 3 Declutter
-- strikes locked a member out of Shops. Shops itself writes no strike yet (M3
-- will: a maker who cancels after accepting), so nothing ever counted the other
-- way. Now:
--   * public.shop_strikes: the Shops section's strikes (written by service-role
--     code only; no member grant). Shaped like declutter_strikes; M3 adds its
--     writers, appeals and the admin removal.
--   * public.shop_active_strike_count(uuid): active (not removed, not expired)
--     Shops strikes. Internal: service_role only, like the gates that call it.
--   * The four Shops gates are restated from their NEWEST bodies VERBATIM with
--     declutter_active_strike_count swapped for shop_active_strike_count and the
--     hint saying "Shops strikes":
--       shop_owner_in_good_standing (20261017061155), shops_assert_owner_eligible
--       (20261017061155), shop_owner_sell_block_reason (20261017061157),
--       shops_request_order (20261017225605).
--   Declutter's count and gates are untouched: a Shops strike never counts there.
--
-- Replay-safe: CREATE TABLE / INDEX IF NOT EXISTS (RLS on with NO policy:
-- service_role only), CREATE OR REPLACE for every function, grants restated exactly.

CREATE TABLE IF NOT EXISTS public.shop_strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offender_side text NOT NULL CHECK (offender_side IN ('buyer', 'shop')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 64),
  order_id uuid REFERENCES public.shop_orders(id) ON DELETE SET NULL,
  given_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  removed_at timestamptz,
  removed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_seed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS shop_strikes_user_active_idx ON public.shop_strikes (user_id, expires_at) WHERE removed_at IS NULL;
ALTER TABLE public.shop_strikes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_strikes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_strikes TO service_role;
COMMENT ON TABLE public.shop_strikes IS
  'Shops strikes, the Shops section''s own count (owner 2026-10-18: strikes are per section). Never read by Declutter.';

CREATE OR REPLACE FUNCTION public.shop_active_strike_count(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT count(*)::integer
    FROM public.shop_strikes s
   WHERE s.user_id = p_user_id
     AND s.removed_at IS NULL
     AND s.expires_at > now();
$fn$;
REVOKE ALL ON FUNCTION public.shop_active_strike_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_active_strike_count(uuid) TO service_role;

-- shop_owner_in_good_standing: newest body 20261017061155_shops_profiles.sql, strike count swapped.
CREATE OR REPLACE FUNCTION public.shop_owner_in_good_standing(p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- Answers only for a member who has a shop, so it reveals nothing a
  -- shop's own visibility does not already show.
  SELECT p_owner_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.shops s WHERE s.owner_id = p_owner_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.user_id = p_owner_id
          AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
          AND (p.ban_status <> 'temp_banned' OR p.auto_suspended_until IS NULL OR p.auto_suspended_until > now()))
     AND public.shop_active_strike_count(p_owner_id) < 3;
$fn$;
REVOKE ALL ON FUNCTION public.shop_owner_in_good_standing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owner_in_good_standing(uuid) TO service_role;

-- shops_assert_owner_eligible: newest body 20261017061155_shops_profiles.sql, strike count swapped.
CREATE OR REPLACE FUNCTION public.shops_assert_owner_eligible()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted'
      USING ERRCODE = '42501', HINT = 'This account is suspended or banned. See /account-banned for details.';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to have a shop.';
  END IF;
  -- Per section (owner 2026-10-18, overrides L45): Shops strikes only.
  IF public.shop_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'shop_strikes_blocked'
      USING ERRCODE = '42501', HINT = 'You have 3 Shops strikes. Shops open again when one expires.';
  END IF;
  -- L3: Stripe payout setup finished.
  IF public.helper_award_block_reason(v_uid) IS NOT NULL THEN
    RAISE EXCEPTION 'payout_setup_incomplete'
      USING ERRCODE = '42501', HINT = 'Finish payout setup before opening a shop.';
  END IF;
  RETURN v_uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_assert_owner_eligible() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_assert_owner_eligible() TO service_role;

-- shop_owner_sell_block_reason: newest body 20261017061157_shops_items.sql, strike count swapped.
CREATE OR REPLACE FUNCTION public.shop_owner_sell_block_reason(p_owner_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_owner_id IS NULL THEN 'no_owner'
    WHEN EXISTS (SELECT 1 FROM public.profiles pr
                  WHERE pr.user_id = p_owner_id
                    AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                    AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
      THEN 'account_restricted'
    WHEN public.shop_active_strike_count(p_owner_id) >= 3 THEN 'shop_strikes_blocked'
    WHEN public.member_under_18(p_owner_id) THEN 'under_18'
    WHEN public.helper_award_block_reason(p_owner_id) IS NOT NULL THEN 'payout_setup_incomplete'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_owner_sell_block_reason(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owner_sell_block_reason(uuid) TO service_role;

-- shops_request_order: newest body 20261017225605_shops_orders_checkout.sql, strike count swapped.
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
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
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
    IF v_item.kind NOT IN ('made', 'home_food', 'farm') THEN
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
REVOKE ALL ON FUNCTION public.shops_request_order(uuid, jsonb, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_request_order(uuid, jsonb, date, text) TO authenticated, service_role;

-- Q807: every public table carries the unconfirmed-email statement gate (shop_strikes is new here).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
