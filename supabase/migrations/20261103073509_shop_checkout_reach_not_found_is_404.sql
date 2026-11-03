-- Q2390 packet 18 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for the four functions the shop-checkout edge function reaches that
-- still raised P0002:
--   shops_order_terms              (STABLE read; called directly by shop-checkout)
--   shops_cancel_order_request     (buyer closes a held request; called directly)
--   shops_decline_order            (shop declines a held order; called directly)
--   shop_lock_open_charged_order   (order row lock helper, service_role only; reached through
--                                   shops_buyer_cancel_order, shops_shop_cancel_order,
--                                   shops_report_no_show, shops_admin_refund_order (shop-checkout),
--                                   shop_refund_sweep (declutter-money) and shops_admin_pay_shop)
-- The edge function's rpcRefusal map answers 404 for P0002 AND PT404 in the
-- same change (supabase/functions/shop-checkout/index.ts), so its answer for
-- these refusals stays 404. Each raise fires before its function or its
-- callers write. None creates an order, moves money or calls pg_net itself.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   shops_order_terms                      20261019015018 0c82cc94acf8ace613d5b61cf3280a72
--   shops_cancel_order_request             20261018164442 c4aa580f9c1fad6e29408253ac9433be
--   shops_decline_order                    20261018164442 ed27571ea24ceb060762cd94c802f2c7
--   shop_lock_open_charged_order           20261019071055 564f943e5d0b95a78d974011cca6583d
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (4 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.shops_order_terms(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  s public.shops;
  v_today date := public.shop_local_today();
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.shops WHERE id = p_shop_id;
  -- A member the owner blocked (or who blocked the owner) sees no terms, as
  -- shops_request_order refuses them (lh-authz-rls review, 2026-10-18).
  IF NOT FOUND OR NOT public.shop_visible_to(p_shop_id, v_uid) OR public.are_users_blocked(v_uid, s.owner_id) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN jsonb_build_object(
    'cancel_policy', s.cancel_policy,
    'ready_tap_cancel', s.ready_tap_cancel,
    'paused', s.paused,
    'open_weekdays', (SELECT COALESCE(jsonb_agg(DISTINCT h.weekday ORDER BY h.weekday), '[]'::jsonb)
                        FROM public.shop_hours h WHERE h.shop_id = s.id),
    'daily_order_cap', s.daily_order_cap,
    'today', v_today,
    'last_day', v_today + 90,
    'full_days', CASE WHEN s.daily_order_cap IS NULL THEN '[]'::jsonb ELSE (
      SELECT COALESCE(jsonb_agg(d ORDER BY d), '[]'::jsonb) FROM (
        SELECT o.ready_date AS d FROM public.shop_orders o
         WHERE o.seller_id = s.owner_id AND o.ready_date BETWEEN v_today AND v_today + 90
           AND o.status IN ('held', 'accepted', 'handed_over')
         GROUP BY o.ready_date HAVING count(*) >= s.daily_order_cap) f) END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_order_terms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_order_terms(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_cancel_order_request(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'already_cancelled', 'order_id', o.id);
  END IF;
  IF o.status IN ('accepted', 'handed_over') THEN
    RAISE EXCEPTION 'order_accepted' USING ERRCODE = '55000',
      HINT = 'The shop already accepted this order; its cancel policy applies.';
  END IF;
  IF o.status NOT IN ('awaiting_hold', 'held') THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000';
  END IF;
  UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled', closed_at = now() WHERE id = o.id;
  IF o.status = 'held' THEN
    PERFORM public.declutter_notify(o.seller_id, 'info', 'Order withdrawn',
      format('The buyer withdrew their order for %s before you answered.', to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
  END IF;
  RETURN jsonb_build_object('result', 'cancelled', 'order_id', o.id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_cancel_order_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_cancel_order_request(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shops_decline_order(p_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_leak text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023', HINT = 'Keep the reason under 200 characters.';
  END IF;
  v_leak := public.contact_leak_reason(v_reason);
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = v_leak || ' in the reason. Keep phone numbers, emails and websites out; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'declined' THEN
    RETURN jsonb_build_object('result', 'already_declined', 'order_id', o.id);
  END IF;
  IF o.status <> 'held' THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000', HINT = 'This order is no longer waiting for an answer.';
  END IF;
  UPDATE public.shop_orders SET status = 'declined', close_reason = 'declined', decline_reason = v_reason, closed_at = now()
   WHERE id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order declined',
    'The shop could not take this order. Nothing was charged, and the hold on your card is released.'
      || CASE WHEN v_reason IS NOT NULL THEN ' Their note: ' || v_reason ELSE '' END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'declined', 'order_id', o.id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_decline_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_decline_order(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shop_lock_open_charged_order(p_order_id uuid, p_allow_problem boolean)
RETURNS public.shop_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status IN ('handed_over') THEN
    RAISE EXCEPTION 'order_final' USING ERRCODE = '55000', HINT = 'This order was picked up and is final.';
  END IF;
  IF o.status <> 'accepted' THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000', HINT = 'This order is already closed.';
  END IF;
  IF o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'The card is still being charged. Try again in a few minutes.';
  END IF;
  -- A refund made by hand in Stripe stands on this order (section 13): nobody refunds or
  -- pays from it automatically; an admin decides through the held-for-review tools.
  IF public.shop_order_unaccounted_hand_refund(o.id) THEN
    RAISE EXCEPTION 'refunded_in_stripe' USING ERRCODE = '55000',
      HINT = 'This order was refunded in Stripe. Louisiana Helpr decides it.';
  END IF;
  IF NOT COALESCE(p_allow_problem, false)
     AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this order. Louisiana Helpr decides it.';
  END IF;
  RETURN o;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shop_lock_open_charged_order(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_lock_open_charged_order(uuid, boolean) TO service_role;

