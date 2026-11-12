-- Shops audit 11-12 (~/.lh-shots/shops-audit-1112/FINDINGS.tsv) Mediums, Builder 1, by recommendation.
--   S015 shops_mark_handed_over refuses a Helpr-delivered order (not fallen back to pickup): the shop's tap would start
--        the 48-hour auto-pay with no delivery. The button is hidden on such orders.
--   S019 the buyer's "Missed delivery" notice says "The shop says you weren't there for the delivery ... If you were
--        there, contact Louisiana Helpr support." (it read backwards).
-- Each function RESTATED VERBATIM from its newest CREATE (named per section) plus only the lines marked S0nn.
-- MONEY: S015 stops a payout path (lh-money-escrow). AUTHZ: no grant/RLS change; CREATE OR REPLACE keeps grants.
-- REPLAY-SAFE: CREATE OR REPLACE. Proof: src/test/pglite/shopsAuditMediums.pglite.mjs (3x; skip red; mutants).

-- 1. S015: shops_mark_handed_over RESTATED from 20261105182903_shops_handover_rule.sql (only the helpr_delivers refusal is new).
CREATE OR REPLACE FUNCTION public.shops_mark_handed_over(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  h public.shop_handovers;
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
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'The buyer''s card is not charged yet, so this order cannot be handed over.';
  END IF;
  -- S015 (Shops audit 11-12): on a Helpr-delivered order the Helpr's drop-off is the handover (the buyer's or the
  -- task's confirm completes it), so the shop's own "Handed over" tap would start the 48-hour auto-pay even if the
  -- Helpr never delivered. Refused, unless no Helpr took it and it became a pickup (helpr_unfilled_at).
  IF o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN
    RAISE EXCEPTION 'helpr_delivers_handover' USING ERRCODE = '55000',
      HINT = 'A Helpr delivers this order. It finishes when the buyer has it, so there is nothing to mark.';
  END IF;
  IF o.handover_mode = 'porch' THEN
    RAISE EXCEPTION 'porch_uses_photo' USING ERRCODE = '22023',
      HINT = 'This order is left out for pickup. Take the ready photo instead; it tells the buyer.';
  END IF;
  IF public.shop_local_today() < o.ready_date THEN
    RAISE EXCEPTION 'not_ready_date_yet' USING ERRCODE = '55000',
      HINT = 'You can mark it handed over from the ready date on.';
  END IF;
  SELECT * INTO h FROM public.shop_handovers WHERE order_id = o.id;
  IF h.problem_at IS NOT NULL THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'The buyer reported a problem with this order. Louisiana Helpr looks at it before anyone is paid.';
  END IF;
  IF h.shop_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_marked', 'order_id', o.id);
  END IF;
  INSERT INTO public.shop_handovers (order_id, shop_confirmed_at) VALUES (o.id, now())
  ON CONFLICT (order_id) DO UPDATE SET shop_confirmed_at = now()
   WHERE public.shop_handovers.shop_confirmed_at IS NULL AND public.shop_handovers.confirmed_at IS NULL;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The shop says you have your order',
    format('The shop marked your order for %s as handed over. If you have it, tap "I got it". If you didn''t get it, tap "I didn''t get it" within 48 hours; after that the shop is paid.',
           to_char(o.ready_date, 'FMMonth FMDD')),
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'marked', 'order_id', o.id);
END;
$fn$;

-- 2. S019: shops_report_no_show RESTATED from 20261112073633_shops_audit_highs.sql (only the missed-delivery words change).
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
  IF NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.ready_at IS NOT NULL) THEN
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
  PERFORM public.declutter_notify(o.buyer_id, 'warning', CASE WHEN o.fulfillment = 'shop_delivers' THEN 'Missed delivery' ELSE 'Missed pickup' END,
    CASE WHEN o.fulfillment = 'shop_delivers' THEN
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
