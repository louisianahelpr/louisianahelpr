-- Shops: NO ID check, for sellers or buyers (owner 2026-11-20, matching Declutter's ruling in PR #4820).
-- Supersedes 20261105174853_shops_identity_check (Shops H4 part 1) and the Shops ID wait of 20261112081213 /
-- 20261112093000. Shops is testers-only; its launch switches and feature_switches rows are NOT touched.
--
--   1. The two refusals go: the seller's first live item (trg_shop_items_identity_before_list /
--      shop_identity_before_list, 'identity_required_to_list') and the buyer's first order
--      (trg_shop_orders_identity_before_buy / shop_identity_before_buy, 'identity_required_to_buy').
--      declutter_identity_gate itself is unchanged (Jobs-side callers keep it).
--   2. shop_complete_handover: the seller's "Verify your ID in Settings to get your $X" notice branch goes (Settings
--      cannot start the check, and the payout no longer waits on it: declutter-money skips the ID hold for kind
--      'shop'). Restated from its effective definition (20261112093000); ONLY that CASE branch and one comment
--      changed: every money step (debt, payout row, setup fee, fee-later words) is byte-identical. Same signature,
--      grants restated (service_role only).
--   The $2 one-time setup fee is unchanged (declutter_setup_fee_from_payout_cents still reads identity_check_exempt,
--   i.e. the identity_check SWITCH, not the ID step; listed for the owner).
-- Replay-safe: DROP ... IF EXISTS, CREATE OR REPLACE. Guard: src/test/shopsNoIdCheck.test.ts;
-- proof: src/test/pglite/shopsNoIdCheck.pglite.mjs.

-- 1. The Shops ID refusals.
DROP TRIGGER IF EXISTS trg_shop_items_identity_before_list ON public.shop_items;
DROP TRIGGER IF EXISTS trg_shop_orders_identity_before_buy ON public.shop_orders;
DROP FUNCTION IF EXISTS public.shop_identity_before_list();
DROP FUNCTION IF EXISTS public.shop_identity_before_buy();

-- 2. The payout notice without the ID wait.
CREATE OR REPLACE FUNCTION public.shop_complete_handover(p_order_id uuid, p_how text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.shop_orders;
  v_debt integer;
  v_payout uuid;
  v_send integer;
  v_setup_fee integer := 0;
  v_fee_later integer := 0;
BEGIN
  -- Never 'shop': the shop cannot complete its own order (owner 2026-10-18 ~21:00Z).
  IF p_how IS NULL OR p_how NOT IN ('buyer', 'auto', 'admin') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over', 'order_id', o.id);
  END IF;
  IF o.status <> 'accepted' OR o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'This order is not charged yet, so it cannot be handed over.';
  END IF;
  -- CHANGED (digital, owner 11-08): a download is final 72 hours after its charge (the sweep, 'auto'), or by an admin.
  -- The buyer's "I got it" and the shop's taps do not apply to a file.
  IF o.is_digital AND p_how = 'buyer' THEN
    RAISE EXCEPTION 'digital_no_pickup' USING ERRCODE = '55000', HINT = 'A download has no pickup to confirm.';
  END IF;
  IF o.is_digital AND p_how = 'auto' AND o.captured_at + interval '72 hours' > now() THEN
    RAISE EXCEPTION 'too_soon' USING ERRCODE = '55000', HINT = 'A download is paid out 72 hours after the sale.';
  END IF;
  IF p_how <> 'admin' AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this order. Our team decides before anyone is paid.';
  END IF;
  INSERT INTO public.shop_handovers (order_id) VALUES (o.id) ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.shop_handovers SET confirmed_at = now(), confirmed_how = p_how WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.shop_orders
     SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  -- Delivery (20261106180902, 20261106194913): the shop is paid its items, and its own delivery fee only when IT
  -- delivered (shop_delivers); a Helpr's pay comes from helpr_task_payouts. shop_payouts.items_cents carries what
  -- the shop is owed, so shop_payouts_amount (amount = items - debt) is unchanged.
  -- The seller's card-fee debt (Declutter and Shops share one ledger) comes out first.
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'shop_order_' || o.id::text, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END));
  INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at)
  VALUES (o.id, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END), v_debt, (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt,
          CASE WHEN (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END,
          now())
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The clock finishing an order is not a pickup anybody saw: say so (money review of 201265b4c).
  -- S011 (Shops audit 11-12): the amount the payout will really send. The one-time setup fee comes out of the first
  -- payout (shop_payout_take_setup_fee: same amount and same "never under $1" skip).
  v_send := (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt;
  IF v_send > 0 THEN
    v_setup_fee := COALESCE(public.declutter_setup_fee_from_payout_cents(o.seller_id), 0);
    IF v_setup_fee <= 0 OR v_send - v_setup_fee < 100
       OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.onboarding_fee_paid IS TRUE) THEN
      v_setup_fee := 0;
    END IF;
    -- NEW (S011 money note, 20261112093000): another unsent payout of this account (a shop order, a Declutter sale or a
    -- Helpr task) may be sent first and take the fee, so this notice does not subtract it; it says which payout pays it.
    IF v_setup_fee > 0 AND public.setup_fee_other_payout_first(o.seller_id, v_payout, v_setup_fee) THEN
      v_fee_later := v_setup_fee;
      v_setup_fee := 0;
    END IF;
  END IF;
  PERFORM public.declutter_notify(o.seller_id, 'payment', CASE WHEN o.is_digital THEN 'Download sale final' WHEN p_how = 'buyer' AND public.shop_order_is_service(o.id) THEN 'Order done' WHEN p_how = 'buyer' THEN 'Order picked up' ELSE 'Order finished' END,
    CASE
      WHEN v_send = 0 THEN
        format('This order paid off the $%s card cost you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format('Set up payouts in Settings to get your $%s. We send it as soon as you do.', to_char((v_send - v_setup_fee) / 100.0, 'FM999990.00'))
          || public.setup_fee_later_words(v_fee_later)
      -- CHANGED (owner 2026-11-20): no ID check for Shops, so a shop's payout never waits on it and the
      -- "Verify your ID in Settings" branch is gone.
      ELSE format('$%s is on its way to your payout account%s.', to_char((v_send - v_setup_fee) / 100.0, 'FM999990.00'),
        CASE
          WHEN v_debt > 0 AND v_setup_fee > 0 THEN format(' ($%s card cost you owed and the one-time $%s setup fee were taken out)',
                                                           to_char(v_debt / 100.0, 'FM999990.00'), to_char(v_setup_fee / 100.0, 'FM999990.00'))
          WHEN v_debt > 0 THEN format(' ($%s card cost you owed was taken out)', to_char(v_debt / 100.0, 'FM999990.00'))
          WHEN v_setup_fee > 0 THEN format(' (the one-time $%s setup fee was taken out)', to_char(v_setup_fee / 100.0, 'FM999990.00'))
          ELSE ''
        END) || public.setup_fee_later_words(v_fee_later)
    END,
    '/shops/dashboard', o.buyer_id);
  -- CHANGED (digital): the buyer already has the download (told at the charge); nothing more to say.
  IF o.is_digital THEN
    RETURN jsonb_build_object('result', 'handed_over', 'order_id', o.id, 'payout_id', v_payout, 'by', p_how);
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', CASE WHEN p_how = 'buyer' THEN 'Enjoy your order' ELSE 'Order finished' END,
    CASE p_how
      -- S017 (Shops audit 11-12): a service is done, a delivery delivered; a Helpr delivery confirms 24 h after delivered_at.
      WHEN 'buyer' THEN CASE
        WHEN public.shop_order_is_service(o.id) THEN 'The work is done and the order is final. Thank you for buying local.'
        WHEN o.fulfillment IN ('shop_delivers', 'helpr_delivers') THEN 'The delivery is done and the order is final. Thank you for buying local.'
        ELSE 'The pickup is done and the order is final. Thank you for buying local.' END
      -- H5: the clock only runs after the shop said it was handed over (or left out with a photo).
      WHEN 'auto' THEN CASE
        WHEN public.shop_order_is_service(o.id) THEN 'Nobody reported a problem in the 48 hours after the shop marked the work done, so the order is final and the shop is paid.'
        WHEN o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN 'Nobody reported a problem in the 24 hours after your Helpr delivered the order, so the order is final and the shop is paid.'
        WHEN o.fulfillment = 'shop_delivers' THEN 'Nobody reported a problem in the 48 hours after the shop said your order was delivered, so the order is final and the shop is paid.'
        ELSE 'Nobody reported a problem in the 48 hours after the shop said your order was handed over, so the order is final and the shop is paid.' END
      ELSE 'Louisiana Helpr finished this order, and the shop is paid.'
    END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'handed_over', 'order_id', o.id, 'payout_id', v_payout, 'by', p_how);
END;
$function$;

REVOKE ALL ON FUNCTION public.shop_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_complete_handover(uuid, text) TO service_role;
