-- S049 (Shops audit 11-12, Low): an at-home service's buyer who isn't there left the shop only "cancel and take a
-- strike", because a no-show needed a ready mark and services never get one (their step is "Mark complete").
-- shops_report_no_show RESTATED from 20261112075006_shops_audit_mediums.sql (newest CREATE): a service or at-home order
-- (shop_order_is_service, 20261112081213) needs no ready mark; every other rule stands (in person, not a Helpr
-- delivery, only after the ready date is over). The buyer's notice gets a service's words ("Missed appointment").
-- MONEY: who is paid on a no-show (the late-cancel rule, unchanged amounts; lh-money-escrow). AUTHZ: CREATE OR REPLACE
-- keeps grants (lh-authz-rls). REPLAY-SAFE: CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsServiceNoShow.pglite.mjs (3x; NEW_MIGRATION=skip red).

CREATE OR REPLACE FUNCTION public.shops_report_no_show(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  v_owed integer;
BEGIN
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
  o := public.shop_lock_open_charged_order(o.id, false);
  -- S004 (Shops audit 11-12, High): a Helpr-delivered order's handover is the Helpr's drop-off, not the buyer coming
  -- to the shop, so the shop can never call it the buyer's no-show (a Helpr who never came would strike the buyer and
  -- pay the shop). Only an order that fell back to pickup (no Helpr took it: helpr_unfilled_at) can be one.
  IF o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN
    RAISE EXCEPTION 'helpr_delivery_no_show' USING ERRCODE = '55000',
      HINT = 'A Helpr delivers this order, so it can''t be a buyer no-show. If the Helpr didn''t come, report it on the order.';
  END IF;
  IF o.handover_mode <> 'in_person' THEN
    RAISE EXCEPTION 'not_in_person' USING ERRCODE = '55000',
      HINT = 'A left-out order cannot be a no-show; it finishes on its own after the ready date.';
  END IF;
  -- Only an order the shop marked ready (/code-review of shops-m3-v1 #2): a shop
  -- that never said "it's ready" cannot say the buyer failed to come for it.
  -- S049 (Shops audit 11-12): a service or at-home order has no ready tap (its step is "Mark complete"), so it can be a
  -- no-show without one, once its day is over (checked below), as a goods order needs its ready mark.
  IF NOT public.shop_order_is_service(o.id)
     AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.ready_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_ready' USING ERRCODE = '55000',
      HINT = 'Mark the order ready first. A no-show can only be reported for an order you had ready.';
  END IF;
  IF now() < ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') THEN
    RAISE EXCEPTION 'too_early_for_no_show' USING ERRCODE = '55000',
      HINT = 'You can report a no-show once the ready date is over.';
  END IF;
  UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_no_show', closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  v_owed := public.shop_owe_shop(o.id);
  PERFORM public.shop_give_strike(o.buyer_id, 'buyer', 'buyer_no_show', o.id);
  -- Delivery (20261106180902): a shop-delivered order was not received, not "not picked up".
  PERFORM public.declutter_notify(o.buyer_id, 'warning',
    CASE WHEN public.shop_order_is_service(o.id) THEN 'Missed appointment' WHEN o.fulfillment = 'shop_delivers' THEN 'Missed delivery' ELSE 'Missed pickup' END,
    CASE WHEN public.shop_order_is_service(o.id) THEN
      -- S049: a service's words (no pickup, nothing delivered).
      format('The shop says you weren''t there for your order on %s. A missed appointment counts as a late cancel: nothing is refunded and the shop is paid. If you were there, contact Louisiana Helpr support.',
             to_char(o.ready_date, 'FMMonth FMDD'))
    WHEN o.fulfillment = 'shop_delivers' THEN
      -- S019 (Shops audit 11-12): the words read backwards ("says you didn't receive it ... if you did receive it").
      format('The shop says you weren''t there for the delivery of your order for %s. A missed delivery counts as a late cancel: nothing is refunded and the shop is paid. If you were there, contact Louisiana Helpr support.',
             to_char(o.ready_date, 'FMMonth FMDD'))
    ELSE
      format('The shop says you did not pick up your order for %s. A missed pickup counts as a late cancel: nothing is refunded and the shop is paid. If you did pick it up, contact Louisiana Helpr support.',
             to_char(o.ready_date, 'FMMonth FMDD'))
    END,
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'No-show recorded',
    format('You are paid for the order ($%s).', to_char(v_owed / 100.0, 'FM999999990.00')),
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'no_show', 'order_id', o.id, 'refund_id', NULL, 'refund_cents', 0);
END;
$fn$;

