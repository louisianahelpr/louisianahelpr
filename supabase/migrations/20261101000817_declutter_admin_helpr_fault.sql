-- LEAD-ADMIN-HELPR-FAULT (owner rule 10-30 "Helpr's fault, Helpr bears it"; lead's item, for verdict): an admin deciding
-- a disputed "the Helpr didn't come" report had no "Helpr at fault" outcome. refund_buyer with fault none keeps the card
-- fee from the buyer. Now p_fault 'helpr' on declutter_admin_decide_problem: a full refund (delivery included), the card
-- fee a debt on the Helpr from their next payout (BUY-36's 'helpr_fault' refund reason, full_seller_pays_fee, whose debt
-- row declutter_record_refund puts on the task's Helpr, and helpr_task_confirm's capped take), no pay for the Helpr,
-- and the strike on the Helpr when the admin gives one. Only before the handover, on a delivery a Helpr took and never
-- picked up; after a pickup it is decided by declutter_admin_decide_stuck_delivery or as damaged.
-- RESTATED FROM THE NEWEST CREATE on this branch (wip/b36-buy36-1031 @ 6522c84afe, checked by name against origin/main):
--   declutter_admin_decide_problem  from 20261031231150_helpr_delivery_cant_finish (BUY-36; main's newest is
--                                   20261029231235, which 231150 restates) + the marked 'helpr' parts
--   declutter_close_paid_order      from its EFFECTIVE definition: 20261027170717_declutter_free_section (main's newest
--                                   CREATE) with 20261027172503's three notice rewrites applied (members see no fee
--                                   words; that migration edits the live body in place), + the buyer's
--                                   refund notice for 'helpr_fault' (it said "The card fee is not refunded"; BUY-36's
--                                   decide_stuck_delivery uses this path too)
-- MONEY: yes (refund reason routing, debt on the Helpr). REPLAY-SAFE (CREATE OR REPLACE only).
-- Proof: src/test/pglite/declutterAdminHelprFault.pglite.mjs (3x; NEW_MIGRATION=skip red).

DO $do$
BEGIN
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_problems.declutter_problems_fault_check
  -- ACK-REASON: re-added on the next line with every fault it allowed plus 'helpr'; the column is never unchecked once this block commits.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten, and every existing row's fault is still in the new list.
  ALTER TABLE public.declutter_problems DROP CONSTRAINT IF EXISTS declutter_problems_fault_check;
  ALTER TABLE public.declutter_problems ADD CONSTRAINT declutter_problems_fault_check
    CHECK (fault IS NULL OR fault IN ('seller', 'buyer', 'none', 'helpr'));
END;
$do$;

CREATE OR REPLACE FUNCTION public.declutter_close_paid_order(p_order_id uuid, p_reason text, p_strike_side text,
  p_strike_reason text, p_why text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_refund uuid;
  v_seller_fault boolean := p_reason IN ('seller_no_show', 'not_as_described', 'seller_backed_out');
  r record;
  v_struck boolean := false;
  v_task public.helpr_tasks;
  v_reserved integer;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  -- A free claim (20261027170717) has no payment to refund: it closes, the strike rules still apply.
  IF o.status IS NOT DISTINCT FROM 'paid' AND o.paid_with = 'free' THEN
    UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
    FOR r IN
      UPDATE public.declutter_cart_items c
         SET status = CASE WHEN v_seller_fault THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
       WHERE c.order_id = o.id AND c.status = 'paid'
      RETURNING c.item_id, c.id
    LOOP
      UPDATE public.declutter_items SET status = CASE WHEN v_seller_fault THEN 'withdrawn' ELSE 'live' END, updated_at = now()
       WHERE id = r.item_id AND status = 'sold';
      IF p_strike_side IS NOT NULL AND NOT v_struck THEN
        -- The callers' words speak of refunds and card fees; a free pickup has neither.
        PERFORM public.declutter_give_strike(CASE WHEN p_strike_side = 'seller' THEN o.seller_id ELSE o.buyer_id END,
          p_strike_side, p_strike_reason, r.item_id,
          CASE WHEN p_strike_side = 'seller' THEN 'You did not show up for a booked free Declutter pickup.'
               ELSE 'You missed a booked free Declutter pickup.' END, r.id);
        v_struck := true;
      END IF;
    END LOOP;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Free pickup cancelled',
      'This free pickup was cancelled. Nothing was charged.', '/declutter?view=cart', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Free pickup cancelled',
      CASE WHEN v_seller_fault THEN 'This free pickup was cancelled.'
           ELSE 'This free pickup was cancelled. Your item is back up.' END,
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'cancelled', 'free', true);
  END IF;
  IF o.status IS DISTINCT FROM 'paid' OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = o.id) THEN
    RAISE EXCEPTION 'already_paid_out' USING ERRCODE = '55000';
  END IF;
  -- Slice 5: the order's Helpr task.
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF t;
  IF v_task.id IS NOT NULL THEN
    IF v_task.status IN ('picked_up', 'delivered') THEN
      PERFORM public.helpr_task_confirm(v_task.id, 'admin', NULL);
    ELSIF v_task.status IN ('open', 'accepted') THEN
      PERFORM public.helpr_task_close(v_task.id, 'cancelled', p_reason);
    END IF;
  END IF;
  v_reserved := public.declutter_delivery_reserved_cents(o.id);
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents - v_reserved, o.card_fee_cents);
  UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
  FOR r IN
    UPDATE public.declutter_cart_items c
       SET status = CASE WHEN v_seller_fault THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
     WHERE c.order_id = o.id AND c.status = 'paid'
    RETURNING c.item_id, c.id
  LOOP
    UPDATE public.declutter_items SET status = CASE WHEN v_seller_fault THEN 'withdrawn' ELSE 'live' END, updated_at = now()
     WHERE id = r.item_id AND status = 'sold';
    -- One strike per order, recorded against its first line.
    IF p_strike_side IS NOT NULL AND NOT v_struck THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_strike_side = 'seller' THEN o.seller_id ELSE o.buyer_id END,
        p_strike_side, p_strike_reason, r.item_id, p_why, r.id);
      v_struck := true;
    END IF;
  END LOOP;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    CASE WHEN v_seller_fault AND v_reserved > 0
         THEN format('$%s is coming back to your card. What you paid for delivery went to the Helpr who made the trip.',
                     to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN v_seller_fault
         THEN format('All $%s is coming back to your card.', to_char(o.total_cents / 100.0, 'FM999990.00'))
         -- CHANGED (LEAD-ADMIN-HELPR-FAULT): the Helpr's fault refunds everything, delivery included (the task failed,
         -- so nothing is reserved); it said "The card fee is not refunded".
         WHEN p_reason = 'helpr_fault'
         THEN format('All $%s is coming back to your card, delivery included.', to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault')
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card.'
                          ELSE 'The item price, $%s, is coming back to your card.' END,
                     to_char((o.total_cents - v_reserved - o.premium_cents) / 100.0, 'FM999990.00'))
         ELSE 'Your refund is on its way.' END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Sale cancelled',
    CASE WHEN v_seller_fault THEN 'This sale was cancelled and the buyer refunded.'
         ELSE 'This sale was cancelled and the buyer refunded. Your item is back on sale.' END,
    '/declutter?view=sales', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_decide_problem(p_problem_id uuid, p_decision text, p_fault text,
  p_strike boolean, p_note text, p_false_report boolean DEFAULT false, p_part_cents integer DEFAULT NULL)
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
  v_out jsonb;
  v_task public.helpr_tasks;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- D2-14 (owner 2026-10-29: allow partial): 'refund_part' gives back exactly p_part_cents of the item price.
  IF p_decision IS NULL OR p_decision NOT IN ('refund_buyer', 'pay_seller', 'refund_part')
     OR (p_decision = 'refund_part') <> (p_part_cents IS NOT NULL)
     -- CHANGED (LEAD-ADMIN-HELPR-FAULT): 'helpr', the Helpr's fault in a delivery they never brought (checked below).
     OR p_fault IS NULL OR p_fault NOT IN ('seller', 'buyer', 'none', 'helpr')
     OR p_strike IS NULL OR (p_strike AND p_fault = 'none')
     -- AL-5: a false report is its own explicit choice, never NULL; its strike is the false-report strike, not a
     -- second one on top.
     OR p_false_report IS NULL OR (p_false_report AND p_strike) THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF v_uid IN (o.buyer_id, o.seller_id) THEN
    -- Another admin decides a sale you are part of (both reviews, 2026-10-15).
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a sale you are part of.';
  END IF;
  -- Slice 5: the order's Helpr task, if any.
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id;
  IF v_task.id IS NOT NULL AND v_uid IS NOT DISTINCT FROM v_task.helpr_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a delivery you made.';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  -- AL-5 (anti-lying #5, owner 2026-10-28): "The report was false" goes against the person who reported it. Only
  -- a buyer's or a seller's report (a Helpr's report is a delivery matter, struck on the Helpr's own record); the
  -- reporter's side is at fault; and the decision goes the other way: a buyer's false report pays the seller, a
  -- seller's false report refunds the buyer.
  IF p_false_report AND (p.reporter_side NOT IN ('buyer', 'seller') OR p.reporter_id IS NULL
                         OR p_fault IS DISTINCT FROM p.reporter_side
                         OR p_decision IS DISTINCT FROM CASE p.reporter_side WHEN 'buyer' THEN 'pay_seller' ELSE 'refund_buyer' END) THEN
    RAISE EXCEPTION 'false_report_mismatch' USING ERRCODE = '22023',
      HINT = 'A false report goes against whoever reported it: their side is at fault, and the decision goes the other way.';
  END IF;
  -- Slice 5 (lh-money-escrow review #1): refunding the buyer on a delivery the
  -- Helpr already has pays the Helpr for the trip (B69). For an item reported
  -- damaged or not received that would pay the Helpr who may have caused it,
  -- so the admin decides it explicitly instead: "Damaged in delivery" (row 43,
  -- declutter_admin_decide_delivery_damage: the Helpr is not paid) or
  -- "Pay the seller".
  -- B77: after a Helpr's "the seller wasn't there" the item never left the
  -- seller, so "Pay the seller" would close a sale the buyer never received
  -- (lh-money-escrow re-review #2). The admin refunds the buyer instead (whose
  -- fault decides the card fee); the item stays with the seller.
  IF p_decision = 'pay_seller' AND p.reporter_side = 'helpr' THEN
    -- CHANGED (BUY-36): those words are only true before the Helpr picked it up.
    IF v_task.status IN ('picked_up', 'delivered') THEN
      RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
        HINT = 'The Helpr has this item. Decide it as nobody''s fault, the Helpr''s fault, or damaged in delivery.';
    END IF;
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The item never left the seller. Refund the buyer, and say whose fault it was.';
  END IF;
  -- CHANGED (BUY-36): a delivery reported as can't finish is decided by fault too: a plain refund would pay the Helpr.
  IF p_decision IN ('refund_buyer', 'refund_part') AND v_task.status = 'picked_up' AND v_task.stuck_at IS NOT NULL THEN
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The Helpr has this item. Decide it as nobody''s fault, the Helpr''s fault, or damaged in delivery.';
  END IF;
  IF p_decision IN ('refund_buyer', 'refund_part') AND p.reason IN ('damaged', 'not_received')
     AND v_task.status IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The Helpr has this item. Decide it as damaged in delivery, or pay the seller.';
  END IF;
  -- CHANGED (LEAD-ADMIN-HELPR-FAULT, owner rule 10-30 "Helpr's fault, Helpr bears it"): a disputed "the Helpr didn't
  -- come" is decided as the Helpr's fault only as a full refund before the handover, on a delivery a Helpr took and
  -- never picked up. The buyer gets everything back, delivery included; the card fee is a debt on that Helpr, taken
  -- from their next payout (declutter_record_refund 'helpr_fault'); they are not paid; the strike is theirs. After a
  -- pickup the delivery is decided as can't finish (declutter_admin_decide_stuck_delivery) or as damaged.
  IF p_fault = 'helpr' AND (p_decision <> 'refund_buyer' OR o.status <> 'paid' OR p_false_report
                            OR v_task.id IS NULL OR v_task.helpr_id IS NULL OR v_task.status <> 'accepted') THEN
    RAISE EXCEPTION 'helpr_fault_not_possible' USING ERRCODE = '22023',
      HINT = 'The Helpr''s fault is a full refund, before the handover, on a delivery a Helpr took and never picked up.';
  END IF;
  -- D2-14: a part refund exists only after the handover (the buyer keeps the item; before it, the order is refunded
  -- in full or the sale goes ahead), above $0 and below the item price (declutter_refund_after_handover checks again).
  IF p_decision = 'refund_part' AND o.status <> 'handed_over' THEN
    RAISE EXCEPTION 'part_refund_after_handover_only' USING ERRCODE = '55000',
      HINT = 'A part refund is for an item the buyer keeps. Before the handover, refund in full or pay the seller.';
  END IF;
  IF p_decision = 'refund_part' AND (p_part_cents <= 0 OR p_part_cents >= o.items_cents) THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023',
      HINT = 'A part refund is above $0 and below the item price. To give it all back, choose Refund the buyer.';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = p_decision, fault = p_fault, strike_given = p_strike,
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  IF o.status = 'handed_over' THEN
    -- 141d: a problem reported in the window after the handover. The payout is still held (never sent).
    IF p_decision = 'refund_part' THEN
      -- D2-14: exactly the amount decided, the buyer keeps the item; the rest of the payout still goes to the seller.
      v_out := public.declutter_refund_after_handover(o.id, 'refund_request_part', p_part_cents);
    ELSIF p_decision = 'pay_seller' THEN
      v_out := jsonb_build_object('result', 'seller_keeps', 'order_id', o.id);
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Louisiana Helpr decided',
        'We looked at both sides. The seller keeps the payment, and the sale is final.', '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'Louisiana Helpr decided',
        'We looked at both sides. You keep the payment; we send it to your payout account.', '/declutter?view=selling', o.buyer_id);
    ELSE
      v_out := public.declutter_refund_after_handover(o.id,
        CASE p_fault WHEN 'seller' THEN 'not_as_described' WHEN 'buyer' THEN 'admin_buyer_fault' ELSE 'admin_no_fault' END, NULL);
    END IF;
    IF p_strike THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_fault = 'seller' THEN o.seller_id ELSE o.buyer_id END, p_fault,
        CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
        (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
        'Louisiana Helpr decided a reported problem on a Declutter sale against you.',
        (SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1));
    END IF;
  ELSIF p_decision = 'pay_seller' THEN
    v_out := public.declutter_complete_handover(o.id, 'admin');
    IF p_strike THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_fault = 'seller' THEN o.seller_id ELSE o.buyer_id END, p_fault,
        CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
        (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
        'Louisiana Helpr decided a reported problem on a Declutter sale against you.', NULL);
    END IF;
  ELSIF p_fault = 'helpr' THEN
    -- CHANGED (LEAD-ADMIN-HELPR-FAULT): the task fails first (it keeps its Helpr, so the refund's debt finds them, and
    -- declutter_close_paid_order neither pays nor reopens it), then the full refund.
    UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'Decided as the Helpr''s fault', updated_at = now()
     WHERE id = v_task.id;
    PERFORM public.helpr_task_log(v_task.id, 'failed', v_uid, 'decided: helpr fault');
    IF p_strike THEN
      PERFORM public.helpr_task_give_job_strike(v_task.helpr_id, 'delivery_no_show', v_task.id, 'Louisiana Helpr decided you did not come for a Helpr delivery');
    END IF;
    v_out := public.declutter_close_paid_order(o.id, 'helpr_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(v_task.helpr_id, 'warning', 'Delivery decided',
      format('Louisiana Helpr decided "%s" wasn''t delivered because of you. You are not paid for this delivery, and what the buyer''s card payment cost comes out of your next payout.', v_task.title),
      '/declutter?tab=deliver', NULL);
  ELSE
    v_out := public.declutter_close_paid_order(o.id,
      CASE p_fault WHEN 'seller' THEN 'not_as_described' WHEN 'buyer' THEN 'admin_buyer_fault' ELSE 'admin_no_fault' END,
      CASE WHEN p_strike THEN p_fault END,
      CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
      'Louisiana Helpr decided a reported problem on a Declutter sale against you.');
  END IF;
  -- D2-5 (audit 1b #5): a refund request that came to the admin with this problem ends with the decision, so
  -- neither refund panel keeps saying "Louisiana Helpr is looking". A refund closes it as agreed (with the
  -- refund), paying the seller closes it as declined. Only on a handed-over sale: a request exists only there.
  IF o.status = 'handed_over' THEN
    UPDATE public.declutter_refund_requests
       SET status = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN 'agreed' ELSE 'declined' END,
           refund_id = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN (v_out->>'refund_id')::uuid ELSE refund_id END,
           settled_at = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN now() ELSE settled_at END,
           declined_at = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN declined_at ELSE now() END
     WHERE order_id = o.id AND problem_id = p.id AND status = 'to_admin';
  END IF;
  -- A2-14 (20261028223738): both sides are told the decision. The one path that already said it (a sale already
  -- handed over, "Pay the seller", above) is left as it is; every other path only sent the handover or refund
  -- notice, which never said Louisiana Helpr had decided. A refund's amount stays in its own notice.
  IF NOT (o.status = 'handed_over' AND p_decision = 'pay_seller') THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Louisiana Helpr decided',
      format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),
        CASE WHEN o.paid_with = 'free' AND p_decision = 'pay_seller' THEN 'The handover stands.'
             WHEN o.paid_with = 'free' THEN 'This free pickup is cancelled.'
             WHEN p_decision = 'pay_seller' THEN 'The seller keeps the payment, and the sale is final.'
             WHEN p_decision = 'refund_part' THEN 'We are refunding you part of the price, and you keep the item. A separate notice says how much.'
             WHEN p_fault = 'helpr' THEN 'It was the Helpr''s fault, so all of your money is coming back, delivery included.'
             ELSE 'We are refunding you. A separate notice says how much.' END),
      '/declutter?tab=buying', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Louisiana Helpr decided',
      format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),
        CASE WHEN o.paid_with = 'free' AND p_decision = 'pay_seller' THEN 'The handover stands.'
             WHEN o.paid_with = 'free' THEN 'This free pickup is cancelled.'
             WHEN p_decision = 'pay_seller' THEN 'You keep the payment.'
             WHEN p_decision = 'refund_part' THEN 'We are refunding the buyer part of the price; it comes out of your payout for this sale, and the buyer keeps the item.'
             ELSE 'We are refunding the buyer, so this sale is cancelled.' END),
      '/declutter?tab=selling', o.buyer_id);
  END IF;
  -- AL-5: the reporter's Declutter strike for a proven false report (3 active strikes = locked out of Declutter,
  -- declutter_assert_member). Given after the decision, so a refusal above gives none; recorded on the problem
  -- (strike_given) and in the audit row.
  IF p_false_report THEN
    UPDATE public.declutter_problems SET strike_given = true WHERE id = p.id;
    PERFORM public.declutter_give_strike(p.reporter_id, p.reporter_side, 'false_report',
      (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
      'Louisiana Helpr looked at the problem you reported on a Declutter sale and found it was not true.', NULL);
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_problem_decided', 'declutter_problem', p.id::text,
          jsonb_build_object('order_id', o.id, 'decision', p_decision, 'fault', p_fault, 'strike', p_strike,
                             'false_report', p_false_report, 'part_cents', p_part_cents, 'result', v_out));
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean, integer) TO authenticated, service_role;
