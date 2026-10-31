-- AUD31-34 (Declutter emails and notices audit, 10-31): the delivery-damage decision's two notices named no item.
-- Every other refund, problem and cancel notice the audit listed already names it at run time: each sender locks the
-- order (declutter_lock_order records it for the transaction) and passes the order's other party, so
-- declutter_notify_strict puts the item's name in front (declutter_notice_names_item, 20261028191646). Measured on the
-- newest definitions of declutter_ask_refund, declutter_answer_refund, declutter_accept_refund_with_return,
-- declutter_report_problem, declutter_admin_decide_problem and declutter_close_paid_order; guarded by
-- src/test/declutterNoticesNameTheItemSweepRemindTask.test.ts. Two notices here had no counterpart, so nothing named:
--   * the Helpr's "Delivery decided: damaged" (a Helpr notice is never named by the central rule): the message names
--     the order's items and opens Deliver (?tab=deliver; ?view= is retired);
--   * the buyer's "Refund on its way": names the items, passes the seller as counterpart (the seed rule and the order
--     link apply as on every buyer notice) and opens Buying (?tab=buying).
-- Titles unchanged (declutter_notice_type files notices by title).
--
-- Restated verbatim from origin/main's NEWEST CREATE, 20261028232338_declutter_damage_no_enjoy_notice.sql, equal to
-- prod (md5(prosrc) c8258ff749382ae570fd16e32b3f8d2c, read-only, 2026-10-31). The ONLY changes are the two notify
-- calls (marked AUD31-34). Every check, lock, write, the strike, the handover and the refund are as before.
--
-- REPLAY-SAFE: CREATE OR REPLACE; grants restated as on prod.
-- Proof: src/test/pglite/declutterDamageNoticesNameTheItem.pglite.mjs (3x; NEW_MIGRATION=skip is red).

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
  -- AUD31-34: the Helpr is told which item.
  PERFORM public.declutter_notify(v_task.helpr_id, 'warning', 'Delivery decided: damaged',
    format('Louisiana Helpr decided %s was damaged during your delivery. You are not paid for this delivery.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=deliver', NULL);
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
  -- AUD31-34: the buyer is told which item, with the seller as counterpart, on their own tab.
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    format('We''re refunding %s: it was damaged in delivery. All $%s is coming back to your card.',
           public.declutter_order_items_named(o.id), to_char(o.total_cents / 100.0, 'FM999990.00')),
    '/declutter?tab=buying', o.seller_id);  -- AUD31-34: the seller is the counterpart.
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
