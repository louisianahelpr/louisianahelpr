-- B45 (lead decision 10-31, open from Builder 39): "the Helpr didn't come" reported or decided AFTER the Helpr was
-- released (helpr_task_reopen: the task goes back up for another Helpr with helpr_id NULL) had no Helpr to fault, so
-- declutter_admin_decide_problem refused p_fault 'helpr' (helpr_fault_not_possible). The released Helpr's id is kept
-- now, and the 'helpr' fault uses it when helpr_id is NULL.
--   helpr_tasks.released_helpr_id: nullable, set from helpr_id whenever a Helpr is released or unassigned.
-- RESTATED FROM THE NEWEST CREATE of each function on origin/main 01a694ae8a (after #3915; rebuilt by B48 10-31
-- from B45's a039fafd57, which had restated return_finish from an older 231150; checked by name: no newer CREATE):
--   helpr_task_reopen                 from 20261031134217_helpr_delivery_seller_reports_no_show (main's newest)
--   declutter_delivery_return_finish  from 20261031231150_helpr_delivery_cant_finish (FINAL, as merged; only CREATE)
--   declutter_admin_decide_problem    from 20261101000817_declutter_admin_helpr_fault (newest; extends it)
--   declutter_admin_problem_case      from 20261029011313_declutter_admin_problem_case (only CREATE; B48 adds a column)
-- Only the lines marked CHANGED (B45 / B48) differ. MONEY: yes (who bears a refund's card fee, who is struck).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, and DROP FUNCTION IF EXISTS + CREATE for problem_case.
-- Proof: src/test/pglite/declutterAdminHelprFault.pglite.mjs (3x; NEW_MIGRATION=skip red on the released case).

ALTER TABLE public.helpr_tasks
  ADD COLUMN IF NOT EXISTS released_helpr_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.helpr_tasks.released_helpr_id IS
  'The Helpr most recently released or unassigned from this task (B45): a later "the Helpr didn''t come" is decided against them.';

-- Restated from 20261031134217; the marked line changes.
CREATE OR REPLACE FUNCTION public.helpr_task_reopen(p_task uuid, p_kind text, p_actor uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  UPDATE public.helpr_tasks
     -- CHANGED (B45, lead 10-31): the released Helpr's id is kept, so a "the Helpr didn't come" decided later still finds them.
     SET status = 'open', released_helpr_id = helpr_id, helpr_id = NULL, accepted_at = NULL, pickup_slot_start = NULL, releases = least(releases + 1, 100),
         open_until = least(greatest(open_until, now() + interval '24 hours'), latest_pickup_at - interval '2 hours'),
         wrong_codes = 0, updated_at = now(),
         -- CHANGED (soldstates-5): the seller's report on the old Helpr goes with them.
         seller_no_show_reported_at = NULL, seller_no_show_answer_by = NULL, seller_no_show_answered_at = NULL,
         seller_no_show_settled_at = NULL
   WHERE id = t.id AND status = 'accepted';
  IF NOT FOUND THEN
    -- Every caller checked 'accepted' under the lock; a miss is a bug, never a silent notice (lh-silent-failure #9).
    RAISE EXCEPTION 'task_not_active' USING ERRCODE = '55000';
  END IF;
  PERFORM public.helpr_task_log(t.id, p_kind, p_actor, p_note);
  PERFORM public.helpr_task_source_event(t.id, 'released', p_kind);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_reopen(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_reopen(uuid, text, uuid, text) TO service_role;

-- Restated from main's FINAL 20261031231150 (after #3915: notices are 'declutter_pickups'); only the SET gains
-- released_helpr_id = helpr_id.
CREATE OR REPLACE FUNCTION public.declutter_delivery_return_finish(p_task uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.helpr_tasks;
  o public.declutter_orders;
  v_out jsonb;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  IF t.stuck_fault = 'none' THEN
    -- The Helpr is paid for the trip (declutter_close_paid_order confirms a picked-up task, and keeps the delivery fee back).
    v_out := public.declutter_close_paid_order(o.id, 'admin_no_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'Your delivery couldn''t be finished',
      format('%s went back to the seller, so this sale is cancelled. You get back what you paid, less what the delivery cost, which paid the Helpr for the trip, and less the small part the card network kept for the payment, which it doesn''t give back.',
             public.declutter_order_items_named(o.id)),
      '/declutter?tab=buying', t.helpr_id);
    RETURN v_out;
  END IF;
  IF t.stuck_choice = 'refund' THEN
    UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'The Helpr could not finish', updated_at = now() WHERE id = t.id;
    PERFORM public.helpr_task_log(t.id, 'failed', NULL, 'helpr fault: returned, buyer refunded');
    PERFORM public.declutter_notify(t.helpr_id, 'warning', 'Delivery closed',
      format('"%s" is back with the seller. You are not paid for this delivery.', t.title), '/declutter?tab=deliver', NULL);
    RETURN public.declutter_close_paid_order(o.id, 'helpr_fault', NULL, NULL, NULL);
  END IF;
  IF t.stuck_choice = 'repost' THEN
    UPDATE public.helpr_tasks
       -- CHANGED (B45, lead 10-31): the released Helpr's id is kept.
       SET status = 'open', released_helpr_id = helpr_id, helpr_id = NULL, accepted_at = NULL, pickup_slot_start = NULL, picked_up_at = NULL, pickup_photo_path = NULL,
           handed_over_at = NULL, handed_over_to = NULL, releases = least(releases + 1, 100),
           latest_pickup_at = greatest(latest_pickup_at, now() + interval '72 hours'),
           open_until = greatest(open_until, now() + interval '48 hours'),
           stuck_at = NULL, stuck_reason = NULL, stuck_note = NULL, stuck_fault = NULL, stuck_stage = NULL, stuck_fix_by = NULL, stuck_fix_note = NULL,
           stuck_return_by = NULL, stuck_choice = NULL, stuck_choice_by = NULL, stuck_collect_note = NULL,
           returned_at = NULL, return_photo_path = NULL, return_distance_m = NULL, return_answer_by = NULL, in_hand_nudged_at = NULL,
           updated_at = now()
     WHERE id = t.id;
    PERFORM public.helpr_task_log(t.id, 'released', t.helpr_id, 'helpr fault: returned, buyer re-posted');
    PERFORM public.helpr_task_source_event(t.id, 'released', 'repost');
    RETURN jsonb_build_object('result', 'reposted');
  END IF;
  -- Nothing chosen yet: the money stays held and the buyer has 48 hours, then Louisiana Helpr decides.
  UPDATE public.helpr_tasks SET stuck_stage = 'awaiting_choice', stuck_choice_by = now() + interval '48 hours', updated_at = now() WHERE id = t.id;
  PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'Your item is back with the seller',
    format('Choose what happens with %s in Buying: a full refund, or re-post it for another Helpr.', public.declutter_order_items_named(o.id)),
    '/declutter?tab=buying', t.helpr_id);
  RETURN jsonb_build_object('result', 'awaiting_choice');
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_delivery_return_finish(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_return_finish(uuid) TO service_role;

-- Restated from 20261101000817; the marked lines change.
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
  -- CHANGED (B45): the Helpr a 'helpr' fault falls on: the task's Helpr, or, once released, the one released.
  v_fault_helpr uuid;
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
  v_fault_helpr := COALESCE(v_task.helpr_id, v_task.released_helpr_id);
  -- CHANGED (B45): nor a delivery you were released from.
  IF v_task.id IS NOT NULL AND (v_uid IS NOT DISTINCT FROM v_task.helpr_id OR v_uid IS NOT DISTINCT FROM v_task.released_helpr_id) THEN
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
                            OR v_task.id IS NULL OR v_fault_helpr IS NULL
                            -- CHANGED (B45, lead 10-31): or released after the Helpr didn't come and not taken again (back up
                            -- for another Helpr, helpr_id NULL): the released Helpr's id decides it.
                            OR NOT (v_task.status = 'accepted' OR (v_task.status = 'open' AND v_task.helpr_id IS NULL))) THEN
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
    -- CHANGED (B45): a released task gets its released Helpr back first, so the refund's debt (declutter_record_refund
    -- reads the task's Helpr) falls on them and the task stops being offered to other Helprs.
    UPDATE public.helpr_tasks SET status = 'failed', helpr_id = v_fault_helpr, closed_at = now(), close_note = 'Decided as the Helpr''s fault', updated_at = now()
     WHERE id = v_task.id;
    PERFORM public.helpr_task_log(v_task.id, 'failed', v_uid, 'decided: helpr fault');
    IF p_strike THEN
      PERFORM public.helpr_task_give_job_strike(v_fault_helpr, 'delivery_no_show', v_task.id, 'Louisiana Helpr decided you did not come for a Helpr delivery');
    END IF;
    v_out := public.declutter_close_paid_order(o.id, 'helpr_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(v_fault_helpr, 'warning', 'Delivery decided',
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

-- B48 (lead 10-31): the admin's decision screen warns when the Helpr this delivery would fault (the Helpr on it, or
-- the released one) already has a strike for THIS delivery: the seller's no-show report gives one (delivery_no_show,
-- helpr_task_give_job_strike, one per task), so ticking Strike again gives nothing more ('duplicate').
-- Restated from 20261029011313 (only CREATE); the new last column is the only change. A RETURNS TABLE shape cannot
-- change under CREATE OR REPLACE, so it is dropped and created again in this one transaction, grants restated. An app
-- that does not know the column ignores it. Still admin-only, still no names or ids out.
DROP FUNCTION IF EXISTS public.declutter_admin_problem_case(uuid);
CREATE OR REPLACE FUNCTION public.declutter_admin_problem_case(p_problem_id uuid)
RETURNS TABLE(handover text, order_status text, slot_start timestamptz, pickup_day date,
  seller_delivery_status text, seller_delivery_slot_start timestamptz, seller_delivered_at timestamptz,
  helpr_accepted_at timestamptz, helpr_picked_up_at timestamptz, helpr_pickup_photo_path text,
  helpr_delivered_at timestamptz, helpr_dropoff_photo_path text, helpr_dropoff_distance_m integer,
  helpr_has_delivery_strike boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.id = p_problem_id) THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT o.handover, o.status, b.slot_start, b.pickup_day,
           sd.status, sd.slot_start, sd.delivered_at,
           t.accepted_at, t.picked_up_at, t.pickup_photo_path,
           t.delivered_at, t.dropoff_photo_path, t.dropoff_distance_m,
           -- CHANGED (B48): the same test helpr_task_give_job_strike uses to refuse a second one.
           (t.id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.user_violations v
               WHERE v.user_id = COALESCE(t.helpr_id, t.released_helpr_id)
                 AND v.violation_type = 'delivery_no_show'
                 AND v.description LIKE '%(task ' || t.id::text || ')'))
      FROM public.declutter_problems p
      JOIN public.declutter_orders o ON o.id = p.order_id
      LEFT JOIN public.declutter_bookings b ON b.order_id = o.id
      LEFT JOIN public.declutter_seller_deliveries sd ON sd.order_id = o.id
      LEFT JOIN public.declutter_order_deliveries od ON od.order_id = o.id
      LEFT JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE p.id = p_problem_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_problem_case(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_problem_case(uuid) TO authenticated, service_role;
