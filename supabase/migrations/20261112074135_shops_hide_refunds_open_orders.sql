-- S001 (Shops audit 11-12, High, launch blocker; spec L75): hiding a shop ends its open orders. Before, shops_admin_set_hidden
-- only set hidden_at: waiting orders lapsed after 24 h, and accepted, charged orders carried on, so a hidden shop could still
-- hand them over and be paid.
-- Now (on the hide itself): every charged open order is refunded IN FULL ('shop_removed': the shop pays the card cost, as
-- for its own cancel) and closed; every waiting order (held / awaiting_hold) is declined / closed with no charge; the
-- buyers and the shop are told. An order still being charged, or refunded by hand in Stripe, refuses the whole hide
-- (shop_lock_open_charged_order's own words), so no order is ever left open on a hidden shop.
-- shops_admin_set_hidden RESTATED from 20261110195956_shops_paperwork_queue.sql (newest CREATE); only the S001 lines
-- (the order step, its locals and the audit counts) are new.
-- MONEY: refunds (lh-money-escrow). AUTHZ: unchanged admin-only check; CREATE OR REPLACE keeps its grants (lh-authz-rls).
-- REPLAY-SAFE: CREATE OR REPLACE. Proof: src/test/pglite/shopsHideRefunds.pglite.mjs (3x; NEW_MIGRATION=skip red; mutants).

CREATE OR REPLACE FUNCTION public.shops_admin_set_hidden(p_shop_id uuid, p_hidden boolean, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  c record;
  o public.shop_orders;
  r public.shop_refunds;
  v_refunded integer := 0;
  v_closed integer := 0;
  v_fee integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    PERFORM public.require_feature('shops');
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_hidden IS NULL THEN
    RAISE EXCEPTION 'invalid_hidden' USING ERRCODE = '22023';
  END IF;
  IF p_hidden AND (p_reason IS NULL OR char_length(btrim(p_reason)) < 3) THEN
    RAISE EXCEPTION 'hide_reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT owner_id INTO v_owner FROM public.shops WHERE id = p_shop_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops
     SET hidden_at = CASE WHEN p_hidden THEN now() END,
         hidden_by = CASE WHEN p_hidden THEN v_uid END,
         hidden_reason = CASE WHEN p_hidden THEN left(btrim(p_reason), 500) END,
         updated_at = now()
   WHERE id = p_shop_id;
  -- S001 (Shops audit 11-12, High; spec L75 "open orders refunded IN FULL"): hiding a shop ends every open order.
  --   * charged (accepted + captured): refunded in full as 'shop_removed' (the shop pays the card cost, like its own
  --     cancel: shop_refund_fee_policy), closed admin_refunded; the buyer is told (and emailed: "Order refunded").
  --   * waiting for an answer (held) or for its page (awaiting_hold): declined / closed, so no charge is ever made and
  --     the hold goes back (shop_holds_to_release; a late page is cancel_hold in shop_mark_order_held).
  --   * accepted but still being charged, or refunded by hand in Stripe: shop_lock_open_charged_order refuses, so the
  --     whole hide is refused with its words ("try again in a few minutes" / "our team decides it"): an order is never
  --     left open on a hidden shop, and nothing is refunded twice.
  -- Handed-over orders are final and stay as they are. Every hide runs it (a repeat hide finds nothing open, so it is
  -- idempotent, and it also closes an order left open on a shop hidden before this migration); an unhide does not.
  IF p_hidden THEN
    FOR c IN SELECT so.id FROM public.shop_orders so
              WHERE so.shop_id = p_shop_id AND so.status = 'accepted' ORDER BY so.id
    LOOP
      o := public.shop_lock_open_charged_order(c.id, true);
      UPDATE public.shop_orders SET status = 'refunded', close_reason = 'admin_refunded', closed_at = now()
       WHERE id = o.id AND status = 'accepted';
      r := public.shop_write_refund(o.id, 'shop_removed', left(btrim(p_reason), 500));
      -- The stock it took at accept goes back, as on the shop's own cancel (review note).
      PERFORM public.shop_return_stock(o.id);
      v_refunded := v_refunded + 1;
      v_fee := v_fee + CASE WHEN r.fee_policy = 'full_shop_pays_fee' THEN r.card_fee_cents ELSE 0 END;
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order refunded',
        format('This shop is no longer on Louisiana Helpr, so your order for %s is cancelled and $%s is on its way back to your card. Card refunds usually show up in 5 to 10 business days.',
               to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.refund_cents / 100.0, 'FM999999990.00')),
        '/shops/orders', o.seller_id);
    END LOOP;
    FOR c IN SELECT so.id, so.buyer_id, so.seller_id, so.status FROM public.shop_orders so
              WHERE so.shop_id = p_shop_id AND so.status IN ('held', 'awaiting_hold') ORDER BY so.id FOR UPDATE
    LOOP
      UPDATE public.shop_orders
         SET status = CASE WHEN c.status = 'held' THEN 'declined' ELSE 'cancelled' END,
             close_reason = CASE WHEN c.status = 'held' THEN 'declined' ELSE 'order_closed' END,
             closed_at = now()
       WHERE id = c.id AND status = c.status;
      v_closed := v_closed + 1;
      IF c.status = 'held' THEN
        PERFORM public.declutter_notify(c.buyer_id, 'info', 'Order cancelled',
          'This shop is no longer on Louisiana Helpr, so your order is cancelled. Nothing was charged and the hold on your card is released.',
          '/shops/orders', c.seller_id);
      END IF;
    END LOOP;
    IF v_refunded + v_closed > 0 THEN
      PERFORM public.declutter_notify(v_owner, 'warning', 'Open orders closed',
        format('Louisiana Helpr hid your shop, so its open orders were closed: %s refunded to the buyers in full and %s not charged.', v_refunded, v_closed)
          || CASE WHEN v_fee > 0 THEN format(' The $%s card cost comes out of your next payout.', to_char(v_fee / 100.0, 'FM999990.00')) ELSE '' END,
        '/shops/mine', NULL);
    END IF;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_hidden THEN 'shop_hidden' ELSE 'shop_unhidden' END, 'shop', p_shop_id::text,
          jsonb_build_object('reason', p_reason, 'orders_refunded', v_refunded, 'orders_closed', v_closed));
  RETURN p_hidden;
END;
$fn$;
