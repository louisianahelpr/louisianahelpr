-- "Damaged in delivery" no longer tells the buyer "Enjoy your item ... the sale is final" (lead 2026-10-28, found
-- while doing A2-14).
--
-- WHAT WAS WRONG: declutter_admin_decide_delivery_damage pays the seller through declutter_complete_handover(o.id,
-- 'admin'), whose buyer notice reads "The handover of "Lamp" is done and the sale is final. Leave the seller a
-- review." Right after it the buyer reads "Refund on its way: ... damaged in delivery. All $X is coming back" and
-- "Louisiana Helpr decided: ... all of your money is coming back". The first contradicts the other two.
--
-- WHAT THIS DOES: the damage decision names its order in a transaction-local setting (declutter.no_enjoy_notice,
-- set_config(..., true), cleared right after the call; PostgREST gives a member no way to set it), and
-- declutter_complete_handover skips the buyer's "Enjoy your item" for exactly that order. Every other caller, and
-- every other notice, payout and refund, is unchanged.
-- Restated from their EFFECTIVE definitions: declutter_complete_handover (20261028223036_declutter_notice_links_open_the_right_tab.sql), declutter_admin_decide_
-- delivery_damage (20261028223738_declutter_problem_decision_notices.sql). Grants as before.
-- REPLAY-SAFETY: CREATE OR REPLACE. Proof: src/test/pglite/declutterDamageNoEnjoyNotice.pglite.mjs.

CREATE OR REPLACE FUNCTION public.declutter_complete_handover(p_order_id uuid, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_debt integer;
  v_payout uuid;
  v_task public.helpr_tasks;
  v_task_out jsonb;
  v_rate integer;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Louisiana Helpr decides before anyone is paid.';
  END IF;
  -- Slice 5: a delivery.
  IF o.handover = 'delivery' THEN
    SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE od.order_id = o.id FOR UPDATE OF t;
    IF v_task.status IN ('picked_up', 'delivered') THEN
      v_task_out := public.helpr_task_confirm(v_task.id,
        CASE p_by WHEN 'code' THEN 'code' WHEN 'buyer' THEN 'customer' WHEN 'admin' THEN 'admin' ELSE 'auto' END, NULL);
    ELSIF v_task.status = 'confirmed' OR (p_by = 'admin' AND v_task.status = 'failed') THEN
      -- Already confirmed, or the damage decision (row 43) that failed the
      -- task itself and refunds the whole order on its own: nothing more here.
      NULL;
    ELSIF p_by = 'admin' AND (v_task.id IS NULL OR v_task.status IN ('open', 'accepted')) THEN
      IF v_task.id IS NOT NULL THEN
        PERFORM public.helpr_task_close(v_task.id, 'cancelled', 'The sale was decided without a delivery');
      END IF;
      PERFORM public.declutter_delivery_refund(o.id, 'delivery_not_done');
    ELSE
      RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000',
        HINT = 'The Helpr has not picked the item up yet.';
    END IF;
  END IF;
  -- Seller delivery: the rate is the seller's, paid with the items.
  v_rate := CASE WHEN o.handover = 'seller_delivery' THEN o.delivery_cents ELSE 0 END;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.declutter_handovers SET confirmed_at = now(), confirmed_by = p_by WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.declutter_orders SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'paid';
  UPDATE public.declutter_items SET status = 'completed', updated_at = now()
   WHERE id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'paid')
     AND status = 'sold';
  -- A free claim (20261027170717): no money is owed either way, so no payout row and no payout words.
  IF o.paid_with = 'free' THEN
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
      format('Thank you for giving away %s. It has a new home.', public.declutter_order_items_named(o.id)),
      '/declutter?tab=selling', o.buyer_id);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
      format('The handover of %s is done. Leave the giver a review.', public.declutter_order_items_named(o.id)),
      '/declutter?view=cart', o.seller_id);
    RETURN jsonb_build_object('result', 'handed_over', 'payout_id', NULL, 'by', p_by, 'free', true);
  END IF;
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents + v_rate);
  INSERT INTO public.declutter_payouts (order_id, seller_id, items_cents, delivery_cents, debt_cents, amount_cents, status)
  VALUES (o.id, o.seller_id, o.items_cents, v_rate, v_debt, o.items_cents + v_rate - v_debt,
          CASE WHEN o.items_cents + v_rate - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The words depend on what is due and whether the seller can be paid (lh-money-escrow review 2.1).
  -- 141d: the payout waits until the sale is final, 24 hours after the handover (an admin's decision is final at once).
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
    format('The handover of %s is done. ', public.declutter_order_items_named(o.id)) ||
    CASE
      WHEN o.items_cents + v_rate - v_debt = 0 THEN
        format('This sale paid off the $%s you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format(CASE WHEN p_by = 'admin' THEN 'Set up payouts in Settings to get your $%s. We send it as soon as you do.'
                    ELSE 'Set up payouts in Settings to get your $%s. We send it once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.' END,
               to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
      WHEN p_by = 'admin' THEN format('$%s is on its way to your payout account.', to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
      ELSE format('We send your $%s once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.',
                  to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/declutter?tab=selling', o.buyer_id);
  -- 20261028232338: a caller that tells the buyer its own outcome (declutter_admin_decide_delivery_damage: refunded in full)
  -- names this order in declutter.no_enjoy_notice for its transaction, so the buyer never also reads "the sale is final".
  IF COALESCE(current_setting('declutter.no_enjoy_notice', true), '') IS DISTINCT FROM o.id::text THEN
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
    format('The handover of %s is done', public.declutter_order_items_named(o.id)) ||
    CASE WHEN p_by = 'admin' THEN ' and the sale is final. Leave the seller a review.'
         ELSE '. If something is wrong with it, you can ask the seller for a refund within 24 hours. Leave the seller a review.' END
    || CASE WHEN public.declutter_delivery_tip_open(o.id) THEN ' You can add a tip for your Helpr in Buying.' ELSE '' END,
    '/declutter?view=cart', o.seller_id);
  END IF;
  RETURN jsonb_build_object('result', 'handed_over', 'payout_id', v_payout, 'by', p_by)
         || CASE WHEN v_task_out IS NOT NULL THEN jsonb_build_object('helpr_payout_id', v_task_out->'helpr_payout_id') ELSE '{}'::jsonb END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_complete_handover(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_decide_delivery_damage(p_problem_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  p public.declutter_problems;
  o public.declutter_orders;
  v_order uuid;
  v_task public.helpr_tasks;
  v_hand jsonb;
  v_refund uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF v_uid IN (o.buyer_id, o.seller_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a sale you are part of.';
  END IF;
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF t;
  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'not_a_delivery_in_transit' USING ERRCODE = '55000',
      HINT = 'Only a delivery the Helpr picked up can be decided as damaged in delivery.';
  END IF;
  IF v_uid = v_task.helpr_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a delivery you made.';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'delivery' OR v_task.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'not_a_delivery_in_transit' USING ERRCODE = '55000',
      HINT = 'Only a delivery the Helpr picked up can be decided as damaged in delivery.';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = 'delivery_damage', fault = 'none', strike_given = false,
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  -- The Helpr: not paid, a delivery strike (row 43).
  UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'Damaged in delivery', updated_at = now()
   WHERE id = v_task.id;
  PERFORM public.helpr_task_log(v_task.id, 'failed', v_uid, 'damaged in delivery');
  PERFORM public.helpr_task_give_job_strike(v_task.helpr_id, 'delivery_damage', v_task.id,
    'An item was damaged during a Helpr delivery you made');
  PERFORM public.declutter_notify(v_task.helpr_id, 'warning', 'Delivery decided: damaged',
    'Louisiana Helpr decided the item was damaged during your delivery. You are not paid for this delivery.',
    '/declutter?view=deliver', NULL);
  -- The seller: paid (the handover completes as an admin decision; the task is
  -- already 'failed', so no Helpr payout is written).
  -- 20261028232338: the buyer is refunded in full, so the handover's "Enjoy your item ... the sale is final" is not sent
  -- (transaction-local: set_config(..., true); PostgREST gives a member no way to call set_config).
  PERFORM set_config('declutter.no_enjoy_notice', o.id::text, true);
  v_hand := public.declutter_complete_handover(o.id, 'admin');
  PERFORM set_config('declutter.no_enjoy_notice', '', true);
  -- The buyer: everything back (full_platform_absorbs). Held until the
  -- seller's payout has gone (declutter_refunds_due).
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, 'delivery_damage', o.total_cents, o.card_fee_cents);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    format('Your item was damaged in delivery. All $%s is coming back to your card.', to_char(o.total_cents / 100.0, 'FM999990.00')),
    '/declutter?view=cart', NULL);
  -- A2-14 (20261028223738): both sides are told the decision (before, the seller heard only "Handover done").
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Louisiana Helpr decided',
    format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),
      'It was damaged in delivery, so all of your money is coming back.'),
    '/declutter?tab=buying', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Louisiana Helpr decided',
    format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),
      'It was damaged in delivery, which is not on you: you keep the payment.'),
    '/declutter?tab=selling', o.buyer_id);
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_problem_decided', 'declutter_problem', p.id::text,
          jsonb_build_object('order_id', o.id, 'decision', 'delivery_damage', 'task_id', v_task.id,
                             'handover', v_hand, 'refund_id', v_refund));
  RETURN jsonb_build_object('result', 'delivery_damage', 'refund_id', v_refund, 'payout_id', v_hand->'payout_id');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_decide_delivery_damage(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_decide_delivery_damage(uuid, text) TO authenticated, service_role;
