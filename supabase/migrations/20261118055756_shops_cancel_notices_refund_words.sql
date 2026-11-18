-- Shops launch pass 2 (2026-11-18): the cancel notices follow the buyer's words. Since pass 1 (S2-030) the app says
-- "free" only for until_accept and "refund" for the date rules, because the buyer still pays a card cost; an
-- accepted order can only be cancelled under a date rule, yet shops_buyer_cancel_order's hint and its three notices
-- still said "free-cancel time". Buyer-facing text now says "cancel-for-a-refund time" (src/lib/shops/orders.ts
-- orderCancelLine), shop-facing text says "refund time" (READY_TAP_CANCEL_TEXT). Wording only: the body is
-- restated verbatim from its newest CREATE (20261109224952_notices_card_fee_and_our_team) with those four strings
-- changed. Replay-safe: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.shops_buyer_cancel_order(p_order_id uuid, p_expect text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_until timestamptz;
  v_free boolean;
  r public.shop_refunds;
  v_owed integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_expect IS NULL OR p_expect NOT IN ('free', 'late') THEN
    RAISE EXCEPTION 'invalid_expect' USING ERRCODE = '22023';
  END IF;
  -- 1. The row lock FIRST (the ready tap and the clock take the same lock).
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.shop_lock_open_charged_order(o.id, false);
  -- 2. ONE reading of the window, under the lock.
  v_until := public.shop_order_free_cancel_until(o.id);
  v_free := v_until IS NOT NULL AND now() < v_until;
  IF (p_expect = 'free') IS DISTINCT FROM v_free THEN
    RAISE EXCEPTION 'cancel_terms_changed' USING ERRCODE = '55000',
      HINT = 'The cancel-for-a-refund time for this order has changed. Look again before cancelling.';
  END IF;
  -- 3. Recorded on the order before commit; Stripe runs after it.
  IF v_free THEN
    UPDATE public.shop_orders SET status = 'refunded', close_reason = 'buyer_cancelled_free', closed_at = now()
     WHERE id = o.id AND status = 'accepted';
    r := public.shop_write_refund(o.id, 'buyer_cancelled', NULL);
    PERFORM public.shop_return_stock(o.id);
    PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order cancelled',
      format('The buyer cancelled the order for %s inside your refund time. Do not make it.', to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order cancelled',
      format('$%s is on its way back to your card, less the card cost%s. Card refunds usually show up in 5 to 10 business days.',
             to_char(r.refund_cents / 100.0, 'FM999999990.00'),
             CASE WHEN r.tax_kept_cents > 0 THEN ' and the sales tax on it' ELSE '' END),
      '/shops/orders', o.seller_id);
    RETURN jsonb_build_object('result', 'cancelled_free', 'order_id', o.id, 'refund_id', r.id, 'refund_cents', r.refund_cents);
  END IF;
  UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late', closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  v_owed := public.shop_owe_shop(o.id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Order cancelled late',
    format('The buyer cancelled the order for %s after your refund time, so you are paid for it ($%s).',
           to_char(o.ready_date, 'FMMonth FMDD'), to_char(v_owed / 100.0, 'FM999999990.00')),
    '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order cancelled',
    'You cancelled after the shop''s cancel-for-a-refund time, so nothing is refunded and the shop is paid.',
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'cancelled_late', 'order_id', o.id, 'refund_id', NULL, 'refund_cents', 0);
END;
$function$
;

REVOKE ALL ON FUNCTION public.shops_buyer_cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_buyer_cancel_order(uuid, text) TO authenticated, service_role;
