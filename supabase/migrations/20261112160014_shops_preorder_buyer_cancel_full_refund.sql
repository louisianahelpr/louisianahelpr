-- S2-019 (Shops audit 2, 11-12; owner-approved preorder rule, OWNER-DECISIONS "buyer cancel = full refund until marked
-- ready" and "the shop (not Helpr) bears Stripe's kept card fee on refunds ... buyer still gets every cent"; coordinator
-- confirmed 11-12): a buyer who cancels a paid preorder before the shop marks it ready gets EVERYTHING back. Before, the
-- cancel was filed as 'buyer_cancelled' (keep_card_fee), so the card fee and its tax were kept from the buyer.
--   1. A new refund reason 'preorder_buyer_cancelled' under full_shop_pays_fee: shop_write_refund then refunds every cent
--      (the one-time setup fee too, S035's full_shop_pays_fee rule) and books the card fee as seller fee debt
--      (declutter_seller_fee_debts), the same mechanism as every shop-pays refund (S039).
--      shop_refund_fee_policy RESTATED from 20261108184654_shops_preorders.sql (newest CREATE); one reason added.
--   2. shop_refunds_reason_check restated with the new reason (DROP + ADD; every old row's reason is still listed).
--   3. shops_cancel_preorder RESTATED from 20261108184654 (newest CREATE): its ELSE branch files the new reason; the
--      order's close_reason stays 'preorder_cancelled'. The notice's "less what the card company kept" part now never
--      shows on this path (kept_cents = 0).
-- MONEY: yes (lh-money-escrow). AUTHZ: grants restated unchanged (lh-authz-rls).
-- REPLAY-SAFE: CREATE OR REPLACE, DROP CONSTRAINT IF EXISTS + ADD.
-- Proof: src/test/pglite/shopsPreorderBuyerCancelFull.pglite.mjs (3x; NEW_MIGRATION=skip red).

-- 1.
CREATE OR REPLACE FUNCTION public.shop_refund_fee_policy(p_reason text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_reason IN ('shop_cancelled', 'no_ready_photo', 'shop_removed', 'problem_shop_fault') THEN 'full_shop_pays_fee'
    -- unpaid_close_tax: the buyer's own close (late cancel, lapse, no-show). The card fee stays kept: the deposit's
    -- whole card fee was already kept (nothing else of the deposit comes back), so the row keeps 0 more of it.
    WHEN p_reason IN ('buyer_cancelled', 'problem_no_fault', 'unpaid_close_tax') THEN 'keep_card_fee'
    -- Preorders (20261108184654): the buyer gets every cent back on each automatic preorder refund, and the card fee
    -- is the shop's: its own lateness, its pushed date, or the goal it set and did not reach (owner 10-14 "we never
    -- absorb any fee"; only our own mistake is ours).
    -- S2-019 (owner-approved preorder rule): the buyer's own cancel before ready is a full refund too; the shop carries
    -- the card fee as seller fee debt.
    WHEN p_reason IN ('preorder_shop_late', 'preorder_date_moved', 'preorder_goal_missed', 'preorder_buyer_cancelled') THEN 'full_shop_pays_fee'
    WHEN p_reason = 'problem_our_mistake' THEN 'full_platform_absorbs'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_fee_policy(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_fee_policy(text) TO service_role;

-- 2.
ALTER TABLE public.shop_refunds DROP CONSTRAINT IF EXISTS shop_refunds_reason_check;
ALTER TABLE public.shop_refunds ADD CONSTRAINT shop_refunds_reason_check CHECK (reason IN (
  'buyer_cancelled', 'shop_cancelled', 'no_ready_photo', 'shop_removed',
  'problem_shop_fault', 'problem_no_fault', 'problem_our_mistake', 'unpaid_close_tax',
  'preorder_goal_missed', 'preorder_shop_late', 'preorder_date_moved', 'preorder_buyer_cancelled'));

-- 3.
CREATE OR REPLACE FUNCTION public.shops_cancel_preorder(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  r public.shop_refunds;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- No ban check and no switch check: cancelling only lets the buyer's money go (as shop-checkout's cancel, L91).
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR o.buyer_id IS DISTINCT FROM v_uid OR o.preorder_item_id IS NULL THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.shop_lock_open_charged_order(o.id, false);
  IF EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.ready_at IS NOT NULL) THEN
    RAISE EXCEPTION 'preorder_ready' USING ERRCODE = '55000',
      HINT = 'The shop already marked this order ready, so it can no longer be cancelled.';
  END IF;
  -- Money review 11-08: a cancel that lands after the sweep's own trigger is filed as the sweep would file it, so the
  -- shop carries the card fee: the goal-missed stamp is set (the sweep refunds every paid order of the item), or the
  -- late refund time (end of ready-by + 7, Louisiana time) has passed. Then a pushed date; else the buyer's own cancel.
  v_reason := CASE
    WHEN EXISTS (SELECT 1 FROM public.shop_items i WHERE i.id = o.preorder_item_id AND i.preorder_goal_missed_at IS NOT NULL)
      THEN 'preorder_goal_missed'
    WHEN ((o.ready_date + 8)::timestamp AT TIME ZONE 'America/Chicago') <= now() THEN 'preorder_shop_late'
    WHEN o.preorder_moved_at IS NOT NULL THEN 'preorder_date_moved'
    ELSE 'preorder_buyer_cancelled' END;
  UPDATE public.shop_orders SET status = 'refunded',
         close_reason = CASE WHEN v_reason = 'preorder_buyer_cancelled' THEN 'preorder_cancelled' ELSE v_reason END,
         closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  r := public.shop_write_refund(o.id, v_reason, NULL);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Preorder cancelled',
    format('A buyer cancelled their preorder for %s.', to_char(o.ready_date, 'FMMonth FMDD')), '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Preorder cancelled',
    format('$%s is on its way back to your card%s. Card refunds usually show up in 5 to 10 business days.',
           to_char(r.refund_cents / 100.0, 'FM999999990.00'),
           CASE WHEN r.kept_cents > 0 THEN ', less what the card company kept' ELSE '' END
           || CASE WHEN r.tax_kept_cents > 0 THEN ' and the sales tax on it' ELSE '' END),
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'cancelled', 'order_id', o.id, 'refund_id', r.id, 'refund_cents', r.refund_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_cancel_preorder(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_cancel_preorder(uuid) TO authenticated, service_role;
