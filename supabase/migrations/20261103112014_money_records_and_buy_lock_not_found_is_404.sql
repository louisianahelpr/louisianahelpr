-- Q2390 packet 26 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for six money functions that still raised P0002:
--   helpr_task_payout_executed, declutter_delivery_raise_refund_executed
--       (service_role; declutter-money records Stripe's answer. The raise comes
--        only after the UPDATE matched no row and a re-read found none, so it
--        leaves nothing written. declutter-money handles any rpc error by its
--        message only.)
--   shop_order_captured (service_role; _shared/shopHolds.ts. Raises at the
--        locked read, before its UPDATE/INSERT/notify. The caller wraps any
--        error in a new Error with only the message.)
--   declutter_setup_fee_refunded (service_role; stripe-webhook declutterCheckout.
--        Raises at the locked read, before its UPDATE/notify. The webhook throws
--        on ANY error and Stripe redelivers: identical for PT404.)
--   declutter_admin_apply_seller_fault (admin / server; raises on a NULL refund
--        id, after the role check and before any write. No app or edge caller.)
--   declutter_lock_buyable_item (service_role helper; its two callers,
--        declutter_buy_now and declutter_make_offer, call it before any write
--        and have no EXCEPTION handler, so the raise passes through unchanged.
--        The app maps by message; declutter-checkout's map already answers
--        P0002 and PT404 alike.)
-- No edge map changes, no deploy.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   helpr_task_payout_executed             20261017055505 2331f8ffc999a990c56c8678de022379
--   declutter_delivery_raise_refund_executed 20261021185418 7338118cbc2bb914c3c0d4b6436257ba
--   shop_order_captured                    20261018164442 10e732f960b6a1538d8b8bcce821e402
--   declutter_setup_fee_refunded           20261026154738 20c40d8122b4c29b248656a00d395136
--   declutter_admin_apply_seller_fault     20261017073146 7fc180a5e86e1f4578e8a076075ff65d
--   declutter_lock_buyable_item            20261020033623 65250e320fea0fa1fb426f880ad21ff0
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (6 lines). With
-- PT404 swapped back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.helpr_task_payout_executed(p_payout_id uuid, p_transfer_id text, p_succeeded boolean,
  p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_succeeded IS NULL THEN
    RAISE EXCEPTION 'invalid_result' USING ERRCODE = '22023';
  END IF;
  IF p_succeeded AND (p_transfer_id IS NULL OR p_transfer_id !~ '^tr_') THEN
    RAISE EXCEPTION 'invalid_transfer' USING ERRCODE = '22023';
  END IF;
  UPDATE public.helpr_task_payouts
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_transfer_id = CASE WHEN p_succeeded THEN p_transfer_id ELSE stripe_transfer_id END,
         executed_at = now(),
         last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         attempts = CASE WHEN p_succeeded THEN attempts ELSE least(attempts + 1, 100) END,
         next_attempt_at = CASE WHEN p_succeeded THEN next_attempt_at
                                ELSE now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '1 day') END
   WHERE id = p_payout_id AND status IN ('pending', 'failed')
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.helpr_task_payouts WHERE id = p_payout_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'PT404';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;

REVOKE ALL ON FUNCTION public.helpr_task_payout_executed(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_payout_executed(uuid, text, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_refund_executed(p_raise_id uuid, p_stripe_refund_id text,
  p_succeeded boolean, p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_succeeded IS NULL OR (p_succeeded AND (p_stripe_refund_id IS NULL OR p_stripe_refund_id !~ '^(re|pyr)_')) THEN
    RAISE EXCEPTION 'invalid_result' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_delivery_raises
     SET status = CASE WHEN p_succeeded THEN 'refunded' ELSE 'refunding' END,
         stripe_refund_ref = CASE WHEN p_succeeded THEN p_stripe_refund_id ELSE stripe_refund_ref END,
         refunded_at = CASE WHEN p_succeeded THEN now() ELSE refunded_at END,
         refund_last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         refund_attempts = CASE WHEN p_succeeded THEN refund_attempts ELSE least(refund_attempts + 1, 100) END,
         refund_next_attempt_at = CASE WHEN p_succeeded THEN refund_next_attempt_at
                                       ELSE now() + least(interval '10 minutes' * power(2, least(refund_attempts, 8)), interval '1 day') END,
         updated_at = now()
   WHERE id = p_raise_id AND status = 'refunding'
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.declutter_delivery_raises WHERE id = p_raise_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'raise_not_found' USING ERRCODE = 'PT404';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_delivery_raise_refund_executed(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_refund_executed(uuid, text, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.shop_order_captured(p_order_id uuid, p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.shop_orders;
  v_home_food integer;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.captured_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_captured', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' THEN
    RAISE EXCEPTION 'order_not_accepted' USING ERRCODE = '55000';
  END IF;
  UPDATE public.shop_orders
     SET captured_at = now(), capture_last_error = NULL,
         card_fee_cents = least(o.total_cents, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents)))
   WHERE id = o.id;
  -- L8: the app counts its own home-food sales (once per order: source_ref UNIQUE).
  SELECT COALESCE(sum(line_cents), 0)::integer INTO v_home_food FROM public.shop_order_lines
   WHERE order_id = o.id AND kind = 'home_food';
  IF v_home_food > 0 THEN
    INSERT INTO public.shop_cottage_sales (owner_id, source_ref, amount_cents, is_seed)
    VALUES (o.seller_id, o.id, v_home_food, o.is_seed)
    ON CONFLICT (source_ref) DO NOTHING;
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order accepted',
    format('The shop accepted your order for %s and your card was charged $%s.', to_char(o.ready_date, 'FMMonth FMDD'),
           to_char(o.total_cents / 100.0, 'FM999999990.00')),
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'captured', 'order_id', o.id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.shop_order_captured(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_captured(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_setup_fee_refunded(p_order_id uuid, p_stripe_refund_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o record;
BEGIN
  IF p_stripe_refund_id IS NULL OR p_stripe_refund_id !~ '^re_' THEN
    RAISE EXCEPTION 'invalid_refund' USING ERRCODE = '22023';
  END IF;
  SELECT d.id, d.buyer_id, d.seller_id, d.setup_fee_cents, d.setup_fee_state, d.setup_fee_refund_id INTO o
    FROM public.declutter_orders d WHERE d.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.setup_fee_state = 'refunded' THEN
    RETURN CASE WHEN o.setup_fee_refund_id = p_stripe_refund_id THEN 'already' ELSE 'other_refund' END;
  END IF;
  IF o.setup_fee_state IS DISTINCT FROM 'refund_due' THEN
    RETURN 'not_due';
  END IF;
  UPDATE public.declutter_orders
     SET setup_fee_state = 'refunded', setup_fee_refund_id = p_stripe_refund_id
   WHERE id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Setup fee coming back',
    format('You had already paid the one-time account setup fee, so the $%s charged with this order is coming back to your card.',
           to_char(o.setup_fee_cents / 100.0, 'FM999990.00')),
    '/declutter?view=cart', o.seller_id);
  RETURN 'recorded';
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_setup_fee_refunded(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_setup_fee_refunded(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_apply_seller_fault(p_refund_id uuid, p_include_committed boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_n integer;
BEGIN
  IF NOT (public.is_server_context() OR (v_uid IS NOT NULL AND public.has_role(v_uid, 'admin'::app_role))) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_refund_id IS NULL THEN
    RAISE EXCEPTION 'not_seller_fault' USING ERRCODE = 'PT404';
  END IF;
  v_n := public.declutter_apply_seller_fault(p_refund_id, COALESCE(p_include_committed, false));
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (v_uid, 'declutter_apply_seller_fault', 'declutter_refund', p_refund_id::text,
            jsonb_build_object('include_committed', COALESCE(p_include_committed, false), 'cancelled', v_n));
  END IF;
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_admin_apply_seller_fault(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_apply_seller_fault(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_lock_buyable_item(p_item_id uuid, p_buyer uuid, OUT o_seller_id uuid, OUT o_price_cents integer, OUT o_title text)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_mode text;
  v_seed boolean;
BEGIN
  SELECT i.seller_id, i.current_price_cents, i.title, i.status, i.sale_mode, i.is_seed
    INTO o_seller_id, o_price_cents, o_title, v_status, v_mode, v_seed
    FROM public.declutter_items i
   WHERE i.id = p_item_id
   FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('live', 'reserved')
     OR public.are_users_blocked(o_seller_id, p_buyer)
     OR public.declutter_seller_out(o_seller_id)
     OR (v_seed AND public.seed_hidden_for(p_buyer)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o_seller_id = p_buyer THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  IF v_mode <> 'offers' THEN
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available'
      USING ERRCODE = '55000', HINT = 'Someone else got this item first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_buyer_cards c WHERE c.user_id = p_buyer) THEN
    RAISE EXCEPTION 'card_required'
      USING ERRCODE = '42501', HINT = 'Save a card first. It is never charged until you check out.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_lock_buyable_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_lock_buyable_item(uuid, uuid) TO service_role;

