-- Part 3 message review (owner UI audit 11-09; lead 11-09: "wording only, from LIVE definitions; every money
-- function gets an lh-money-escrow review and a diff proof that only strings changed").
--
-- F197: the card cost was named five ways ("less the small part the card network kept for the payment, which it doesn't
-- give back", "minus what your card company charged", "what the buyer's card payment cost", "the card-processing cost",
-- "what the card company keeps"). One term everywhere now: "the card fee". No amount changes: the same figures, the
-- same people pay them; only the words.
-- F198: "Your strike was removed" put three facts in one sentence. Now one fact each, and the block is named as what it
-- is, the reason the card fee is kept (this line is only sent when the buyer blocked the seller): "You paid in time, so
-- the missed-checkout strike is gone. The item's hold had already ended, so we're refunding your payment. You blocked
-- the seller, so the card fee isn't refunded."
-- F193 (rest): who decides a problem was named four ways ("Louisiana Helpr decides", "a real person at Helpr will
-- decide", "goes to Helpr to decide", "Someone from Louisiana Helpr will look at it"); "goes to Helpr" read like the
-- member's Helpr. One phrase: "our team" ("Our team decides", "our team will decide the refund", "Our team will look at
-- it"; title "Your refund request goes to our team").
--
-- Each body is the LIVE definition: md5(prosrc) on prod 11-09 equals the newest repo definition byte for byte (36
-- checked; rpc_answer_refund_request differs from LIVE and is NOT here). Only string literals changed
-- (src/test/pglite/noticesCardFeeOurTeam.pglite.mjs proves it per function, --before red). Headers are the previous
-- definitions'; grants restated as live proacl. Replay-safe: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.declutter_accept_refund_with_return(p_request_id uuid, p_way text, p_day date, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_day date;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_way IS NULL OR p_way NOT IN ('drop_off', 'collect') THEN
    RAISE EXCEPTION 'invalid_return_way' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Lock order: the order (and its items) first, then the request, as every other path.
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'open' THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  IF now() >= r.answer_by THEN
    RAISE EXCEPTION 'refund_answer_late' USING ERRCODE = '55000',
      HINT = 'The 24 hours to answer are over, so our team decides this one.';
  END IF;
  -- CHANGED (BUY-25, owner 10-30): nothing comes back on a sale the buyer never got (declutter_answer_refund refunds it).
  IF r.reason = 'not_received' THEN
    RAISE EXCEPTION 'no_return_needed' USING ERRCODE = '55000',
      HINT = 'The buyer says they never got it, so there is nothing to bring back.';
  END IF;
  -- CHANGED (BUY-23, owner 10-30): a drop-off shows the buyer the address, so only where the seller offered pickup.
  IF p_way = 'drop_off' AND o.handover NOT IN ('pickup_home', 'porch') THEN
    RAISE EXCEPTION 'drop_off_not_offered' USING ERRCODE = '55000',
      HINT = 'Your address stays private on this sale, so you pick it up from the buyer.';
  END IF;
  -- The day (Louisiana time): today or within the next 7 days. A collect time is in the future, inside those days.
  IF p_way = 'drop_off' THEN
    IF p_at IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_return_time' USING ERRCODE = '22023';
    END IF;
    v_day := p_day;
  ELSE
    IF p_at IS NULL OR p_at <= now() THEN
      RAISE EXCEPTION 'invalid_return_time' USING ERRCODE = '22023', HINT = 'Pick a time from now on.';
    END IF;
    v_day := (p_at AT TIME ZONE 'America/Chicago')::date;
    IF p_day IS NOT NULL AND p_day <> v_day THEN
      RAISE EXCEPTION 'invalid_return_time' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_day IS NULL OR v_day < v_today OR v_day > v_today + 7 THEN
    RAISE EXCEPTION 'invalid_return_day' USING ERRCODE = '22023', HINT = 'Pick a day in the next 7 days.';
  END IF;
  -- The 'full' arm of declutter_answer_refund (prod body, 20261029224147): nothing is refunded yet; the payout stays held.
  PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
  IF NOT public.declutter_payout_unsent(o.id) THEN
    RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000',
      HINT = 'The seller was already paid for this sale. Louisiana Helpr settles it by hand.';
  END IF;
  UPDATE public.declutter_refund_requests
     SET status = 'returning', return_agreed_at = now(), return_by = now() + interval '72 hours',
         return_way = p_way, return_day = v_day, return_at = CASE WHEN p_way = 'collect' THEN p_at END
   WHERE id = r.id;
  IF p_way = 'drop_off' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The seller agreed to a full refund',
      format('Bring the item back to the seller''s pickup address on %s or after, and take a photo there. Your refund of $%s is sent as soon as the seller confirms they have it back.',
             to_char(v_day, 'FMDay, FMMonth FMDD'), to_char(public.declutter_full_refund_cents(o.id) / 100.0, 'FM999990.00')),
      '/declutter?view=buying', v_uid);
  ELSE
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The seller agreed to a full refund',
      format('The seller will come for the item on %s. Add the address where they should pick it up. Your refund of $%s is sent as soon as the seller confirms they have it back.',
             to_char(p_at AT TIME ZONE 'America/Chicago', 'FMDay, FMMonth FMDD "at" FMHH12:MI AM'),
             to_char(public.declutter_full_refund_cents(o.id) / 100.0, 'FM999990.00')),
      '/declutter?view=buying', v_uid);
  END IF;
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Full refund agreed',
    'When you have the item back, tap "I got it back" and the refund is sent. If you don''t confirm in time, our team decides.',
    '/declutter?view=selling', o.buyer_id);
  RETURN jsonb_build_object('result', 'returning', 'return_way', p_way, 'return_day', v_day,
    'full_refund_cents', public.declutter_full_refund_cents(o.id));
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_accept_refund_with_return(uuid, text, date, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_accept_refund_with_return(uuid, text, date, timestamp with time zone) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_decide_problem(p_problem_id uuid, p_decision text, p_fault text,
  p_strike boolean, p_note text, p_false_report boolean DEFAULT false, p_part_cents integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
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
        'Our team decided a reported problem on a Declutter sale against you.',
        (SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1));
    END IF;
  ELSIF p_decision = 'pay_seller' THEN
    v_out := public.declutter_complete_handover(o.id, 'admin');
    IF p_strike THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_fault = 'seller' THEN o.seller_id ELSE o.buyer_id END, p_fault,
        CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
        (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
        'Our team decided a reported problem on a Declutter sale against you.', NULL);
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
      PERFORM public.helpr_task_give_job_strike(v_fault_helpr, 'delivery_no_show', v_task.id, 'Our team decided you did not come for a Helpr delivery');
    END IF;
    v_out := public.declutter_close_paid_order(o.id, 'helpr_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(v_fault_helpr, 'warning', 'Delivery decided',
      format('Our team decided "%s" wasn''t delivered because of you. You are not paid for this delivery, and the buyer''s card fee comes out of your next payout.', v_task.title),
      '/declutter?tab=deliver', NULL);
  ELSE
    v_out := public.declutter_close_paid_order(o.id,
      CASE p_fault WHEN 'seller' THEN 'not_as_described' WHEN 'buyer' THEN 'admin_buyer_fault' ELSE 'admin_no_fault' END,
      CASE WHEN p_strike THEN p_fault END,
      CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
      'Our team decided a reported problem on a Declutter sale against you.');
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
$function$
;

REVOKE ALL ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_decide_stuck_delivery(p_problem_id uuid, p_fault text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  p public.declutter_problems;
  o public.declutter_orders;
  v_order uuid;
  v_task public.helpr_tasks;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_fault IS NULL OR p_fault NOT IN ('none', 'helpr') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF v_uid IN (o.buyer_id, o.seller_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a sale you are part of.';
  END IF;
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF t;
  IF v_task.id IS NULL OR v_task.status <> 'picked_up' OR o.status <> 'paid' THEN
    RAISE EXCEPTION 'not_a_delivery_in_transit' USING ERRCODE = '55000', HINT = 'Only a delivery a Helpr has picked up can be decided here.';
  END IF;
  IF v_uid = v_task.helpr_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a delivery you made.';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = 'refund_buyer', fault = 'none', strike_given = (p_fault = 'helpr'),
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  IF p_fault = 'none' THEN
    v_out := public.declutter_close_paid_order(o.id, 'admin_no_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Louisiana Helpr decided',
      format('We looked at the problem with %s. It was nobody''s fault, so the sale is cancelled. You get back what you paid, less what the delivery cost, which paid the Helpr for the trip, and less the card fee.',
             public.declutter_order_items_named(o.id)), '/declutter?tab=buying', o.seller_id);
  ELSE
    UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'Decided as the Helpr''s fault', updated_at = now() WHERE id = v_task.id;
    PERFORM public.helpr_task_log(v_task.id, 'failed', v_uid, 'decided: helpr fault');
    PERFORM public.helpr_task_give_job_strike(v_task.helpr_id, 'delivery_backed_out', v_task.id, 'Could not finish a Helpr delivery after picking it up');
    v_out := public.declutter_close_paid_order(o.id, 'helpr_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(v_task.helpr_id, 'warning', 'Delivery decided',
      format('Our team decided "%s" wasn''t finished because of you. You are not paid for this delivery.', v_task.title), '/declutter?tab=deliver', NULL);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Louisiana Helpr decided',
      format('We looked at the problem with %s. All of your money is coming back, delivery included.', public.declutter_order_items_named(o.id)),
      '/declutter?tab=buying', o.seller_id);
  END IF;
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Louisiana Helpr decided',
    format('We looked at the problem with %s. The sale is cancelled and the buyer refunded.', public.declutter_order_items_named(o.id)),
    '/declutter?tab=selling', o.buyer_id);
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_problem_decided', 'declutter_problem', p.id::text,
          jsonb_build_object('order_id', o.id, 'decision', 'stuck_delivery', 'fault', p_fault, 'task_id', v_task.id, 'result', v_out));
  RETURN v_out;
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_admin_decide_stuck_delivery(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_decide_stuck_delivery(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_answer_refund(p_request_id uuid, p_answer text, p_offer_cents integer,
                                                         p_note text DEFAULT NULL, p_photo_paths text[] DEFAULT '{}')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_out jsonb;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_path text;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_answer IS NULL OR p_answer NOT IN ('full', 'part', 'decline') THEN
    RAISE EXCEPTION 'invalid_answer' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Lock order: the order (and its items) first, then the request, as every other path.
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'open' THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  IF now() >= r.answer_by THEN
    RAISE EXCEPTION 'refund_answer_late' USING ERRCODE = '55000',
      HINT = 'The 24 hours to answer are over, so our team decides this one.';
  END IF;
  -- CHANGED (A3-74): the seller's side on "I don't agree" and on a part offer: an optional note (up to 1,000
  -- characters) and up to 3 photos, only from the seller's own problem folder for this order and already uploaded (the
  -- rule of declutter_problem_add_side, 20261029225634). Stored on the request; when it reaches Louisiana Helpr it
  -- becomes the seller's side of the problem (declutter_refund_seller_side_to_problem). "Refund in full" takes none.
  IF p_answer IN ('part', 'decline') THEN
    IF char_length(COALESCE(v_note, '')) > 1000 THEN
      RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023', HINT = 'Keep it to 1,000 characters.';
    END IF;
    IF cardinality(COALESCE(p_photo_paths, '{}')) > 3 THEN
      RAISE EXCEPTION 'too_many_problem_photos' USING ERRCODE = '22023', HINT = 'Add up to 3 photos.';
    END IF;
    FOREACH v_path IN ARRAY COALESCE(p_photo_paths, '{}') LOOP
      IF v_path IS NULL
         OR split_part(v_path, '/', 1) IS DISTINCT FROM v_uid::text
         OR split_part(v_path, '/', 2) IS DISTINCT FROM 'declutter'
         OR split_part(v_path, '/', 3) IS DISTINCT FROM 'problem'
         OR split_part(v_path, '/', 4) IS DISTINCT FROM o.id::text
         OR split_part(v_path, '/', 5) = ''
         OR split_part(v_path, '/', 6) <> ''
         OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = v_path) THEN
        RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    UPDATE public.declutter_refund_requests
       SET seller_note = v_note, seller_photo_paths = COALESCE(p_photo_paths, '{}'),
           seller_side_at = CASE WHEN v_note IS NOT NULL OR cardinality(COALESCE(p_photo_paths, '{}')) > 0 THEN now() END
     WHERE id = r.id;
  END IF;
  IF p_answer = 'full' THEN
    -- #3558 answer 2: nothing is refunded yet. The refund is sent when the seller confirms the item is back
    -- (declutter_refund_item_returned); the payout stays held (declutter_sale_final reads 'returning').
    PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
    IF NOT public.declutter_payout_unsent(o.id) THEN
      RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000',
        HINT = 'The seller was already paid for this sale. Louisiana Helpr settles it by hand.';
    END IF;
    -- CHANGED (BUY-25, owner 10-30): the buyer never got it, so there is nothing to bring back: refunded now, with the
    -- payout taken to nothing. Lead 10-30: reason seller_no_show, so fee policy full_seller_pays_fee: the buyer gets
    -- everything back, and the seller owes the card fee (declutter_record_refund's debt row, out of their next payout).
    -- A delivery fee that already paid a Helpr for the trip stays with the Helpr, as on every refund (B69).
    IF r.reason = 'not_received' THEN
      v_out := public.declutter_refund_after_handover(o.id, 'seller_no_show', NULL);
      UPDATE public.declutter_refund_requests
         SET status = 'agreed', refund_id = (v_out->>'refund_id')::uuid, settled_at = now()
       WHERE id = r.id;
      RETURN v_out || jsonb_build_object('result', 'refunded');
    END IF;
    UPDATE public.declutter_refund_requests
       SET status = 'returning', return_agreed_at = now(), return_by = now() + interval '72 hours'
     WHERE id = r.id;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The seller agreed to a full refund',
      format('Give the item back to the seller; message the seller from your order. Your refund of $%s is sent as soon as the seller confirms they have it back.',
             to_char(public.declutter_full_refund_cents(o.id) / 100.0, 'FM999990.00')),
      '/declutter?view=buying', v_uid);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Full refund agreed',
      'When the buyer gives the item back, tap "I got it back" and the refund is sent. If you don''t confirm within 3 days, our team decides.',
      '/declutter?view=selling', o.buyer_id);
    RETURN jsonb_build_object('result', 'returning', 'full_refund_cents', public.declutter_full_refund_cents(o.id));
  ELSIF p_answer = 'part' THEN
    IF o.tax_cents <> 0 THEN
      RAISE EXCEPTION 'part_refund_unavailable' USING ERRCODE = '55000';
    END IF;
    IF p_offer_cents IS NULL OR p_offer_cents <= 0 OR p_offer_cents >= o.items_cents THEN
      RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023',
        HINT = 'Offer an amount above $0 and below the item price. To give it all back, choose Refund in full.';
    END IF;
    UPDATE public.declutter_refund_requests
       SET status = 'offered', offer_cents = p_offer_cents, offered_at = now(), offer_answer_by = now() + interval '24 hours'
     WHERE id = r.id;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The seller offered a part refund',
      format('The seller offered $%s back. Take it, or ask our team to decide, within 24 hours. If you don''t answer, our team decides.',
             to_char(p_offer_cents / 100.0, 'FM999990.00')),
      '/declutter?view=cart', v_uid);
    RETURN jsonb_build_object('result', 'offered', 'offer_cents', p_offer_cents);
  END IF;
  UPDATE public.declutter_refund_requests SET status = 'declined', declined_at = now() WHERE id = r.id;
  PERFORM public.declutter_notify(o.buyer_id, 'warning', 'The seller said no',
    'The seller didn''t agree to a refund. If you still think something is wrong, report a problem within 24 hours and our team decides.',
    '/declutter?view=cart', v_uid);
  RETURN jsonb_build_object('result', 'declined');
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_answer_refund(uuid, text, integer, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_refund(uuid, text, integer, text, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_answer_refund_offer(p_request_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_out jsonb;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'invalid_answer' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'offered' THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  IF now() >= r.offer_answer_by THEN
    RAISE EXCEPTION 'refund_answer_late' USING ERRCODE = '55000',
      HINT = 'The 24 hours to answer are over, so our team decides this one.';
  END IF;
  IF p_accept THEN
    v_out := public.declutter_refund_after_handover(o.id, 'refund_request_part', r.offer_cents);
    UPDATE public.declutter_refund_requests
       SET status = 'agreed', refund_id = (v_out->>'refund_id')::uuid, settled_at = now()
     WHERE id = r.id;
    RETURN v_out || jsonb_build_object('result', 'refunded');
  END IF;
  PERFORM public.declutter_refund_request_to_admin(r.id,
    format('the seller offered $%s back and the buyer asked Louisiana Helpr to decide', to_char(r.offer_cents / 100.0, 'FM999990.00')));
  RETURN jsonb_build_object('result', 'to_admin');
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_answer_refund_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_refund_offer(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_ask_refund(p_order_id uuid, p_reason text, p_note text,
  p_photo_paths text[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_id uuid;
  v_path text;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status <> 'handed_over' THEN
    RAISE EXCEPTION 'refund_before_handover' USING ERRCODE = '55000',
      HINT = 'You can ask for a refund once you have the item. Before that, report a problem.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_refund_requests r WHERE r.order_id = o.id) THEN
    RAISE EXCEPTION 'refund_already_asked' USING ERRCODE = '55000';
  END IF;
  IF o.handed_over_at IS NULL OR now() >= o.handed_over_at + interval '24 hours' OR public.declutter_sale_decided(o.id) THEN
    RAISE EXCEPTION 'refund_window_over' USING ERRCODE = '55000',
      HINT = 'The 24 hours to ask for a refund are over, so this sale is final.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Our team decides before anyone is paid.';
  END IF;
  PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
  IF NOT public.declutter_payout_unsent(o.id) THEN
    RAISE EXCEPTION 'refund_window_over' USING ERRCODE = '55000',
      HINT = 'The 24 hours to ask for a refund are over, so this sale is final.';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('not_as_described', 'damaged', 'not_received') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell the seller what''s wrong (up to 1,000 characters).';
  END IF;
  IF cardinality(COALESCE(p_photo_paths, '{}')) > 3 THEN
    RAISE EXCEPTION 'too_many_problem_photos' USING ERRCODE = '22023', HINT = 'Add up to 3 photos.';
  END IF;
  FOREACH v_path IN ARRAY COALESCE(p_photo_paths, '{}') LOOP
    IF v_path IS NULL
       OR split_part(v_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(v_path, '/', 2) IS DISTINCT FROM 'declutter'
       OR split_part(v_path, '/', 3) IS DISTINCT FROM 'problem'
       OR split_part(v_path, '/', 4) IS DISTINCT FROM o.id::text
       OR split_part(v_path, '/', 5) = ''
       OR split_part(v_path, '/', 6) <> ''
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = v_path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.declutter_refund_requests (order_id, reason, note, answer_by, photo_paths)
  VALUES (o.id, p_reason, btrim(p_note), now() + interval '24 hours', COALESCE(p_photo_paths, '{}'))
  RETURNING id INTO v_id;
  -- BUY-30: the notice names the item and opens Selling (the retired ?view= link went).
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Refund request',
    format('The buyer asked for a refund on %s. Answer within 24 hours: refund it all, offer part, or say no. If you don''t answer, our team decides. Your payout waits until then.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=selling', v_uid);
  RETURN jsonb_build_object('result', 'asked', 'request_id', v_id);
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_ask_refund(uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_ask_refund(uuid, text, text, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_complete_handover(p_order_id uuid, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.declutter_orders;
  v_debt integer;
  v_payout uuid;
  v_task public.helpr_tasks;
  v_task_out jsonb;
  v_rate integer;
  -- Manager mode phase 2: the manager's share of this sale (0 when none was locked at payment).
  v_share integer := 0;
  v_ms public.declutter_order_manager_shares;
  v_mpay uuid;
  v_split text := '';
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
      HINT = 'A problem was reported on this sale. Our team decides before anyone is paid.';
  END IF;
  -- Slice 5: a delivery.
  IF o.handover = 'delivery' THEN
    SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE od.order_id = o.id FOR UPDATE OF t;
    IF v_task.status IN ('picked_up', 'delivered') THEN
      v_task_out := public.helpr_task_confirm(v_task.id,
        CASE p_by WHEN 'code' THEN 'code' WHEN 'buyer' THEN 'customer' WHEN 'admin' THEN 'admin' ELSE 'auto' END, NULL);
    -- CHANGED (BUY-36): or the buyer collected it from a Helpr who couldn't finish (helpr_task_customer_confirm failed the task, unpaid).
    ELSIF v_task.status = 'confirmed' OR (p_by = 'admin' AND v_task.status = 'failed')
          OR (v_task.status = 'failed' AND v_task.stuck_stage = 'collecting') THEN
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
  -- Manager mode phase 2 (lead 11-01): the share comes off first (items + rate - share), then the fee debt and the
  -- setup fee from what is left, so the seller's row is never negative and a debt never reduces the manager's share.
  SELECT * INTO v_ms FROM public.declutter_order_manager_shares s WHERE s.order_id = o.id;
  v_share := public.declutter_manager_share_cents(o.id);
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents + v_rate - v_share);
  INSERT INTO public.declutter_payouts (order_id, seller_id, items_cents, delivery_cents, manager_share_cents, debt_cents, amount_cents, status)
  VALUES (o.id, o.seller_id, o.items_cents, v_rate, v_share, v_debt, o.items_cents + v_rate - v_share - v_debt,
          CASE WHEN o.items_cents + v_rate - v_share - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The manager's own row: a SEPARATE transfer to their own payout account (declutter-money), never through the seller.
  IF v_payout IS NOT NULL AND v_ms.order_id IS NOT NULL AND v_ms.manager_id IS NOT NULL THEN
    INSERT INTO public.declutter_manager_payouts (order_id, seller_payout_id, grant_id, seller_id, manager_id, share_cents, amount_cents, status)
    VALUES (o.id, v_payout, v_ms.grant_id, o.seller_id, v_ms.manager_id, v_share, v_share,
            CASE WHEN v_share = 0 THEN 'nothing_due' ELSE 'pending' END)
    ON CONFLICT (order_id) DO NOTHING
    RETURNING id INTO v_mpay;
    IF v_mpay IS NOT NULL AND v_share > 0 THEN
      v_split := format('$%s sale · $%s to %s%s · $%s to you. ',
        to_char((o.items_cents + v_rate) / 100.0, 'FM999990.00'), to_char(v_share / 100.0, 'FM999990.00'),
        public.declutter_manager_first_name(v_ms.manager_id),
        CASE WHEN v_ms.share_type = 'percent' THEN ' (' || v_ms.share_pct::text || '%)' ELSE '' END,
        to_char((o.items_cents + v_rate - v_share) / 100.0, 'FM999990.00'));
      -- declutter_sales, by choice (declutterNoticeKinds): the manager's share is a sale notice, under the Declutter switch.
      PERFORM public.declutter_notify(v_ms.manager_id, 'declutter_sales', 'You earned a share',
        format('You earned $%s from %s''s sale of %s. ', to_char(v_share / 100.0, 'FM999990.00'),
               public.declutter_manager_first_name(o.seller_id), public.declutter_order_items_named(o.id)) ||
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = v_ms.manager_id AND pr.stripe_account_id IS NOT NULL) THEN
            'Next: set up payouts in Settings to get it. We send it as soon as you do and the sale is final.'
          WHEN p_by = 'admin' THEN 'It is on its way to your payout account.'
          ELSE 'We send it once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.'
        END,
        '/declutter?tab=selling', o.seller_id);
    END IF;
  END IF;
  -- The words depend on what is due and whether the seller can be paid (lh-money-escrow review 2.1).
  -- 141d: the payout waits until the sale is final, 24 hours after the handover (an admin's decision is final at once).
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
    format('The handover of %s is done. ', public.declutter_order_items_named(o.id)) || v_split ||
    CASE
      WHEN o.items_cents + v_rate - v_share - v_debt = 0 THEN
        format('This sale paid off the $%s you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format(CASE WHEN p_by = 'admin' THEN 'Set up payouts in Settings to get your $%s. We send it as soon as you do.'
                    ELSE 'Set up payouts in Settings to get your $%s. We send it once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.' END,
               to_char((o.items_cents + v_rate - v_share - v_debt) / 100.0, 'FM999990.00'))
      WHEN p_by = 'admin' THEN format('$%s is on its way to your payout account.', to_char((o.items_cents + v_rate - v_share - v_debt) / 100.0, 'FM999990.00'))
      ELSE format('We send your $%s once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.',
                  to_char((o.items_cents + v_rate - v_share - v_debt) / 100.0, 'FM999990.00'))
    END
    -- Kept from B49's 20261031214749 (train 5). Owner 2026-10-30: said before the money moves. Taken when the payout is sent (declutter_payout_take_setup_fee).
    || CASE WHEN public.declutter_setup_fee_from_payout_cents(o.seller_id) > 0
              AND o.items_cents + v_rate - v_share - v_debt - public.declutter_setup_fee_from_payout_cents(o.seller_id) >= 100 THEN
         format(' Your one-time $%s account setup fee comes out of your payout. It is only ever charged once.',
                to_char(public.declutter_setup_fee_from_payout_cents(o.seller_id) / 100.0, 'FM999990.00'))
       ELSE '' END,
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
$function$
;

REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_complete_handover(uuid, text) TO service_role;

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
      format('%s went back to the seller, so this sale is cancelled. You get back what you paid, less what the delivery cost, which paid the Helpr for the trip, and less the card fee.',
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
$function$
;

REVOKE ALL ON FUNCTION public.declutter_delivery_return_finish(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_return_finish(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_handover_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  o public.declutter_orders;
  v_auto integer := 0;
  v_noshow integer := 0;
  v_sd_auto integer := 0;
  v_sd_unbooked integer := 0;
  v_reminders integer := 0;
  v_unanswered integer := 0;
  v_nudged integer := 0;
  v_to_admin integer := 0;
  v_delivery boolean;
  v_closed boolean;
  a record;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_h integer;
BEGIN
  -- Shipping S2: a shipped order is never finished or closed here; it finishes on the USPS
  -- delivered scan + 48 h (S7), and never books a slot (declutter_bookings_not_delivery).
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery', 'ship') AND b.slot_start IS NOT NULL AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
       -- CHANGED (review of 7496d29c8b #3): a porch sale waits 24 hours from the later of the pickup time and the photo.
       AND (o2.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                               WHERE h.order_id = o2.id AND h.set_out_photo_path IS NOT NULL
                                                 AND h.set_out_at + interval '24 hours' <= now()))
       -- CHANGED (owner 10-30): never while the seller's 24 hours to answer run. A door or meeting-spot sale needs the
       -- seller's "Picked up", 24 hours old (declutter_sale_final's 24 hours follow: paid about 48 hours after it). If
       -- neither side says anything the money is held until someone does: no auto-pay, refund, strike or admin problem.
       AND NOT EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o2.id AND h.no_show_reported_at IS NOT NULL)
       AND (o2.handover = 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o2.id
                                              AND h.seller_confirmed_at + interval '24 hours' <= now()))
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery', 'ship')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL
                       AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now())
         AND NOT EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.no_show_reported_at IS NOT NULL)
         AND (o.handover = 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id
                                               AND h.seller_confirmed_at + interval '24 hours' <= now()))
         -- Porch (owner 2026-10-18): no "Left on porch" photo, no auto-pay.
         AND (o.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                                WHERE h.order_id = o.id AND h.set_out_photo_path IS NOT NULL
                                                  AND h.set_out_at + interval '24 hours' <= now())) THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; it is logged and retried next run.
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      LEFT JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery', 'ship') AND o2.paid_at + interval '7 days' <= now()
       AND (b.order_id IS NULL OR b.slot_start IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery', 'ship')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
        PERFORM public.declutter_close_paid_order(o.id, 'buyer_no_show', 'buyer', 'not_picked_up',
          'You did not pick up a paid Declutter item within 7 days. The item price was refunded.');
        v_noshow := v_noshow + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (b2) CHANGED (A3-72, lead 11-01 5:34 PM + 9:05 PM): a seller-delivered order whose delivery lost its time
  -- (needs_time: the slot went to another buyer at payment) and still has none at book_by (paid + 7 days) is closed
  -- and the buyer's full payment refunded (reason delivery_never_booked: full_platform_absorbs, no seller debt).
  -- No strike for either side (p_strike_side NULL): neither set a time. An open problem holds it, as in (b).
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_seller_deliveries d ON d.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'seller_delivery' AND d.status = 'needs_time'
       AND o2.book_by IS NOT NULL AND o2.book_by <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover = 'seller_delivery' AND o.book_by <= now()
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_seller_deliveries d WHERE d.order_id = o.id AND d.status = 'needs_time') THEN
        PERFORM public.declutter_close_paid_order(o.id, 'delivery_never_booked', NULL, NULL, NULL);
        v_sd_unbooked := v_sd_unbooked + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (c) Seller delivery: 24 h after the seller's "Delivered" (a photo, when left at the
  -- door) or "Handed over", unless a problem is open.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_seller_deliveries d ON d.order_id = o2.id
      JOIN public.declutter_handovers h ON h.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'seller_delivery' AND d.status = 'booked'
       AND d.delivered_at IS NOT NULL AND (d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)
       AND d.delivered_at + make_interval(hours => (v_rules ->> 'auto_confirm_hours')::integer) <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover = 'seller_delivery'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_handovers h JOIN public.declutter_seller_deliveries d ON d.order_id = h.order_id
                      WHERE h.order_id = o.id AND d.delivered_at IS NOT NULL AND (d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)
                        AND d.delivered_at + make_interval(hours => (v_rules ->> 'auto_confirm_hours')::integer) <= now()) THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_sd_auto := v_sd_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (d) Reminders before a booked delivery (24 h and 1 h, from the rules). One
  -- per run per order: the nearest one due; any earlier one not sent yet is
  -- marked sent too, so a late booking never gets "tomorrow" after "soon".
  FOR r IN
    SELECT d.order_id, d.buyer_id, d.seller_id, d.slot_start, d.dropoff_area, d.reminded_hours
      FROM public.declutter_seller_deliveries d
      JOIN public.declutter_orders o2 ON o2.id = d.order_id
     WHERE d.status = 'booked' AND o2.status = 'paid' AND d.slot_start > now()
       AND d.slot_start <= now() + make_interval(hours => (SELECT max(x::integer) FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x))
     ORDER BY d.slot_start LIMIT 500
  LOOP
    BEGIN
      -- CHANGED (20261031181404): lock the order first, as every other loop here does. The lock records this order
      -- for the notices below (declutter_notice_about), so "Delivery coming up" names THIS order's item; without it
      -- the setting still held the previous order the sweep locked (another order's item for the same pair, or none).
      -- The booking is re-read under the lock: a reminder another run already sent is not sent twice.
      o := public.declutter_lock_order(r.order_id);
      SELECT d.slot_start, d.reminded_hours INTO r.slot_start, r.reminded_hours
        FROM public.declutter_seller_deliveries d
       WHERE d.order_id = r.order_id AND d.status = 'booked' AND d.slot_start > now();
      IF o.status <> 'paid' OR NOT FOUND THEN
        v_h := NULL;
      ELSE
        SELECT min(x::integer) INTO v_h FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x
         WHERE r.slot_start <= now() + make_interval(hours => x::integer)
           AND NOT x::integer = ANY (r.reminded_hours);
      END IF;
      IF v_h IS NOT NULL THEN
        UPDATE public.declutter_seller_deliveries d
           SET reminded_hours = (SELECT array_agg(DISTINCT y ORDER BY y)
                                   FROM unnest(d.reminded_hours || ARRAY(SELECT x::integer FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x
                                                                         WHERE x::integer >= v_h)) y),
               updated_at = now()
         WHERE d.order_id = r.order_id;
        -- Q2465: strict, so a reminder that cannot be written rolls this block back (the reminded_hours mark with it)
        -- and the next run retries it.
        PERFORM public.declutter_notify_strict(r.seller_id, 'payment', 'Delivery coming up',
          format('You deliver to %s on %s.', r.dropoff_area, public.declutter_delivery_when(r.slot_start)),
          '/declutter?tab=selling', r.buyer_id);
        PERFORM public.declutter_notify_strict(r.buyer_id, 'payment', 'Delivery coming up',
          format('The seller delivers on %s.', public.declutter_delivery_when(r.slot_start)),
          '/declutter?view=cart', r.seller_id);
        v_reminders := v_reminders + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.order_id::text, SQLERRM);
    END;
  END LOOP;
  -- (e) CHANGED (owner 10-30): the buyer's no-show report, 24 hours on with no answer: refund + strike, as the one tap did.
  -- An open problem (the seller's answer, or either side's report) holds it; a problem taken back lets it run again.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_handovers h ON h.order_id = o2.id
     WHERE o2.status = 'paid' AND h.no_show_reported_at IS NOT NULL AND h.no_show_answer_by <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.no_show_answer_by <= now()) THEN
        PERFORM public.declutter_close_paid_order(o.id, 'seller_no_show', 'seller', 'seller_no_show',
          CASE WHEN o.handover = 'seller_delivery'
               THEN 'You did not deliver a booked Declutter order. The buyer got everything back, delivery included; the cost of that refund comes out of your next Declutter payout.'
               ELSE 'You did not show up for a booked Declutter pickup. The buyer got everything back; the cost of that refund comes out of your next Declutter payout.' END);
        v_unanswered := v_unanswered + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (f) CHANGED (lead and owner 10-30): a sale whose time has passed with nobody having said anything. The money stays
  -- held. Both are nudged 24 hours after the time, then weekly; at 60 days it goes to admin to decide, and no money moves.
  FOR r IN
    SELECT o2.id, o2.buyer_id, o2.seller_id, o2.handover, h.held_nudged_at,
           COALESCE(public.declutter_pickup_anchor(b.slot_start, b.pickup_day), d.slot_end) AS held_from
      FROM public.declutter_orders o2
      LEFT JOIN public.declutter_bookings b ON b.order_id = o2.id AND o2.handover IN ('pickup_home', 'meetup', 'porch')
      LEFT JOIN public.declutter_seller_deliveries d ON d.order_id = o2.id AND o2.handover = 'seller_delivery'
                                                     AND d.status = 'booked' AND d.delivered_at IS NULL
      LEFT JOIN public.declutter_handovers h ON h.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover IN ('pickup_home', 'meetup', 'porch', 'seller_delivery')
       AND COALESCE(public.declutter_pickup_anchor(b.slot_start, b.pickup_day), d.slot_end) + interval '24 hours' <= now()
       AND h.seller_confirmed_at IS NULL AND h.no_show_reported_at IS NULL AND h.set_out_at IS NULL
       AND (h.held_nudged_at IS NULL OR h.held_nudged_at + interval '7 days' <= now()
            OR COALESCE(public.declutter_pickup_anchor(b.slot_start, b.pickup_day), d.slot_end) + interval '60 days' <= now())
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
       -- Owner rule: test data never reaches a member or admin.
       AND o2.is_seed IS NOT TRUE
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id IN (o2.buyer_id, o2.seller_id))
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id IN (o2.buyer_id, o2.seller_id) AND pr.is_seed)
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      CONTINUE WHEN o.status <> 'paid';
      v_delivery := r.handover = 'seller_delivery';
      IF r.held_from + interval '60 days' <= now() THEN
        -- Once: if an admin's problem was ever opened here, someone has already looked.
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.reporter_side = 'system');
        INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
        VALUES (o.id, NULL, 'system', 'other',
                'Nobody has said anything about this handover for 60 days, so the money is still held. Neither side confirmed it or reported a problem. Decide who gets the money.',
                '{}');
        PERFORM public.declutter_notify(o.buyer_id, 'declutter_refunds', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until our team decides. You can add your side on the order.',
          '/declutter?tab=buying', o.seller_id);
        PERFORM public.declutter_notify(o.seller_id, 'declutter_refunds', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until our team decides. You can add your side on the order.',
          '/declutter?tab=selling', o.buyer_id);
        -- A cron has no caller for the gate to read, so test data is skipped here too (20261030150104's rule).
        IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
          FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
            PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter sale held 60 days',
              'Nobody has confirmed a paid handover for 60 days. The money is held until you decide it.', '/admin');
          END LOOP;
        END IF;
        v_to_admin := v_to_admin + 1;
      ELSE
        UPDATE public.declutter_handovers SET held_nudged_at = now() WHERE order_id = o.id;
        IF NOT FOUND THEN
          INSERT INTO public.declutter_handovers (order_id, code, held_nudged_at)
          VALUES (o.id, public.declutter_new_handover_code(), now());
        END IF;
        v_closed := public.declutter_held_address_closed(o.id);
        -- The member's own Pickups switch: off means none of this.
        IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = o.buyer_id AND np.declutter_pickups IS FALSE) THEN
          PERFORM public.declutter_pickup_remind(o.buyer_id,
            CASE WHEN v_delivery THEN 'Did your delivery come?' ELSE 'Did you get your item?' END,
            'If you have it, tap "I got it" in Buying. If not, report it there.'
              || CASE WHEN o.paid_with = 'free' THEN '' ELSE ' Your money stays held until one of you says.' END
              || CASE WHEN v_closed THEN ' The pickup address has closed, so ask the seller in your messages.' ELSE '' END,
            '/declutter?tab=buying', o.seller_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = o.seller_id AND np.declutter_pickups IS FALSE) THEN
          PERFORM public.declutter_pickup_remind(o.seller_id,
            CASE WHEN v_delivery THEN 'Did you make this delivery?' ELSE 'Did the buyer get this item?' END,
            CASE WHEN v_delivery THEN 'If you delivered it, mark it delivered in Selling.'
                 WHEN r.handover = 'porch' THEN 'If it''s out, post the porch photo in Selling.'
                 ELSE 'If they have it, tap "Picked up" in Selling.' END
              || CASE WHEN o.paid_with = 'free' THEN '' ELSE ' You aren''t paid until one of you says.' END,
            '/declutter?tab=selling', o.buyer_id);
        END IF;
        v_nudged := v_nudged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('auto_paid', v_auto, 'not_picked_up', v_noshow,
                            'delivery_auto_paid', v_sd_auto, 'delivery_reminders', v_reminders,
                            'no_show_unanswered', v_unanswered, 'held_nudged', v_nudged, 'held_to_admin', v_to_admin,
                            'delivery_never_booked', v_sd_unbooked);
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_handover_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_hold_unchecked_listings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n integer := 0;
  r record;
  v_order uuid;
BEGIN
  FOR r IN
    UPDATE public.declutter_items i
       SET status = 'pending_review', updated_at = now()
     WHERE i.status = 'live'
       AND i.live_at < now() - interval '15 minutes'
       -- Review of 41771724f3 (1): an admin's approval since it went live stands (approval sets no ai_checked_at).
       AND (i.admin_approved_at IS NULL OR i.admin_approved_at < i.live_at)
       -- Never checked; or flagged and back on sale (re-review of e23f131d97): a flag (or the "didn't finish" mark
       -- below) on a reserved or sold listing leaves it up while the sale stands, and if that sale falls through (the
       -- buyer removes it, 20261028221904; a missed checkout, 20261030152217) it is live again. It is held here.
       -- LEAD-CHECK-SWEEP (owner 10-31: "everyday items must never be held just because a check didn't run"): an
       -- unchecked listing is held only once the check has FAILED 3 times (ai_check_attempts, counted by the server
       -- sweep below), never because no check ran yet.
       AND EXISTS (SELECT 1 FROM public.declutter_item_private pv
                    WHERE pv.item_id = i.id
                      AND ((pv.ai_checked_at IS NULL AND pv.ai_check_attempts >= 3) OR pv.ai_flag_reason IS NOT NULL))
    RETURNING i.id, i.seller_id, i.title,
              (SELECT pv.ai_flag_reason FROM public.declutter_item_private pv WHERE pv.item_id = i.id) AS flag
  LOOP
    v_n := v_n + 1;
    IF r.flag IS NULL OR r.flag = 'The automatic check didn''t finish.' THEN
      PERFORM public.declutter_notify(r.seller_id, 'declutter_listings', 'Your listing is waiting for a check',
        format('Our automatic check of "%s" didn''t finish, so someone from Louisiana Helpr will look at it. Buyers can''t see it until then.', r.title),
        '/declutter?tab=selling', NULL);
    ELSE
      PERFORM public.declutter_notify(r.seller_id, 'declutter_listings', 'Your listing is waiting for a check',
        format('Our automatic check flagged "%s" (%s). Our team will look at it. Buyers can''t see it until then.', r.title, r.flag),
        '/declutter?tab=selling', NULL);
    END IF;
  END LOOP;

  -- Review of 62f90f3368 (3): a buyer reserved or paid for it before any check came back, and none has 15 minutes
  -- after it went live. The sale stands; the seller's payouts wait for an admin (payout_holds, which every payout
  -- path checks) and every admin is alerted, as a late flag on a sold listing does (record_ai_check). The item is
  -- marked judged ("didn't finish") so this runs once per item, and an admin's lift of the hold stays lifted; an
  -- admin approval since it went live stands. Lock order as everywhere in Declutter: items first.
  FOR r IN
    SELECT i.id, i.seller_id, i.title
      FROM public.declutter_items i
     WHERE i.status IN ('reserved', 'sold')
       AND i.live_at < now() - interval '15 minutes'
       AND (i.admin_approved_at IS NULL OR i.admin_approved_at < i.live_at)
       -- LEAD-CHECK-SWEEP: only after 3 failed checks; until then the sweep keeps checking it and the sale stands.
       AND EXISTS (SELECT 1 FROM public.declutter_item_private pv
                    WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL AND pv.ai_check_attempts >= 3)
     FOR UPDATE OF i SKIP LOCKED
  LOOP
    UPDATE public.declutter_item_private
       SET ai_checked_at = now(), ai_flag_reason = 'The automatic check didn''t finish.', updated_at = now()
     WHERE item_id = r.id AND ai_checked_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    v_n := v_n + 1;
    SELECT c.order_id INTO v_order
      FROM public.declutter_cart_items c
     WHERE c.item_id = r.id AND c.status IN ('in_cart', 'paid')
     ORDER BY c.created_at DESC LIMIT 1;
    INSERT INTO public.payout_holds (helper_id, reason, held_by, held_at)
    VALUES (r.seller_id,
            left(format('Declutter: the automatic check of "%s" didn''t finish before a buyer reserved or bought it (order %s). Lift this hold to pay the seller, or refund the buyer.',
                        r.title, COALESCE(v_order::text, 'none')), 1000),
            NULL, now())
    ON CONFLICT (helper_id) DO NOTHING;
    -- Every admin, never for a test account (owner 2026-10-30).
    IF NOT public.is_test_subject(r.seller_id) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT ur.user_id,
             'A sold Declutter listing was never checked',
             left(format('The automatic check of "%s" didn''t finish before a buyer reserved or bought it. The seller''s payouts are on hold: look at the listing, then lift the hold to pay them, or refund the buyer.', r.title), 1000),
             'admin_alert',
             '/admin?view=payouts'
        FROM public.user_roles ur
       WHERE ur.role = 'admin';
    END IF;
    PERFORM public.declutter_notify(r.seller_id, 'declutter_listings', 'Your sale is waiting for a check',
      format('Our automatic check of "%s" didn''t finish, so someone from Louisiana Helpr will look at it before you''re paid.', r.title),
      '/declutter?tab=selling', NULL);
  END LOOP;
  RETURN v_n;
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_hold_unchecked_listings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_hold_unchecked_listings() TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_mark_order_paid(p_order_id uuid, p_payment_intent_id text, p_amount_cents integer,
  p_paid_at timestamptz, p_card_fee_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o record;
  v_lines integer;
  v_live integer;
  v_deadline timestamptz;
  v_refund uuid;
  v_reason text;
  v_found boolean;
  r record;
  v_void record;
  v_cant boolean;
  v_items_ok boolean;
  v_pickup text;
  -- CHANGED (Q2106): a call with NO payment intent and 0 cents is the gift-paid step: redeem_gift_card_for_declutter_order
  -- calls it, in its own transaction, once the buyer's gift card covers the whole order. It never records a refund (no
  -- card money moved): any answer but 'paid' raises, so the redeem rolls back and the gift is untouched.
  v_gift_only boolean := p_payment_intent_id IS NULL;
BEGIN
  IF (v_gift_only AND p_amount_cents IS DISTINCT FROM 0)
     OR (NOT v_gift_only AND (p_payment_intent_id !~ '^pi_' OR p_amount_cents IS NULL OR p_amount_cents <= 0))
     OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;

  -- Lock order: items -> order -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  v_found := FOUND;
  -- A payment already answered with a refund keeps that answer (replays).
  SELECT r2.id INTO v_refund FROM public.declutter_refunds r2 WHERE r2.stripe_payment_intent_id = p_payment_intent_id;
  IF v_refund IS NOT NULL THEN
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  -- CHANGED (Q2106): the gift-paid step only ever pays an open order whose whole price its redeemed gift covers.
  IF v_gift_only AND (NOT v_found OR o.status <> 'awaiting_payment'
      OR o.gift_cents IS DISTINCT FROM o.total_cents + o.setup_fee_cents
      OR NOT EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.id = o.gift_card_id AND g.declutter_order_id = o.id
                        AND g.status = 'redeemed')) THEN
    RAISE EXCEPTION 'gift_payment_not_payable' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_found THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(NULL, p_payment_intent_id, 'order_missing', p_amount_cents, p_card_fee_cents));
  END IF;
  -- 141d: a replayed payment event for a HANDED-OVER sale is the same payment, never a new one to refund
  -- (before this it fell through to 'order_closed' and refunded the whole sale while the seller was paid).
  IF o.status IN ('paid', 'refunded', 'handed_over') THEN
    IF o.stripe_payment_intent_id IS NOT DISTINCT FROM p_payment_intent_id THEN
      RETURN jsonb_build_object('result', 'already_paid');
    END IF;
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'duplicate_payment', p_amount_cents, p_card_fee_cents));
  END IF;
  -- Q2352: the page charged the sale plus the one-time setup fee frozen on the order, or the sale alone: a page
  -- opened by a declutter-checkout that did not know the fee yet (the migration deploys before the edge,
  -- functions-deploy.yml waits for db-deploy; lh-money-escrow review of the Q2352 branch #1). Then the fee was
  -- not charged: it is marked so, nothing is claimed, and the account pays it at its next first-time step.
  -- CHANGED (Q2106): the card pays what the order's gift card did not (o.gift_cents, 0 with no gift). The
  -- setup-fee-not-known page predates gift cards at checkout, so it is only ever an order with no gift.
  IF p_amount_cents + o.gift_cents IS DISTINCT FROM o.total_cents + o.setup_fee_cents
     AND NOT (o.setup_fee_cents > 0 AND o.gift_cents = 0 AND p_amount_cents = o.total_cents) THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'amount_mismatch', p_amount_cents, p_card_fee_cents));
  END IF;
  IF o.setup_fee_cents > 0 AND o.gift_cents = 0 AND p_amount_cents = o.total_cents AND o.setup_fee_state IS NULL THEN
    UPDATE public.declutter_orders SET setup_fee_state = 'not_charged' WHERE id = p_order_id;
  END IF;
  PERFORM 1 FROM public.declutter_cart_items c WHERE c.order_id = p_order_id ORDER BY c.item_id FOR UPDATE;
  SELECT min(c.checkout_by) INTO v_deadline FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Read once (lh-money-escrow review of 1da32feffe #3): can the seller sell.
  v_cant := public.declutter_seller_out(o.seller_id);

  IF o.status = 'superseded' THEN
    -- B40 (lh-money-escrow review 3b #2): the app expires the old page BEFORE
    -- a restarted checkout can replace it, and refuses to replace a page that
    -- was already paid, so a payment on an order the BUYER restarted means
    -- they went around the app: their own doing, the card fee is kept. A page
    -- that Stripe itself timed out ('session_expired') cannot take a payment;
    -- if one lands anyway, that is ours.
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id,
        CASE WHEN o.close_reason = 'superseded' THEN 'buyer_restarted_checkout' ELSE 'superseded' END,
        p_amount_cents, p_card_fee_cents));
  END IF;

  IF o.status = 'expired' THEN
    IF o.close_reason IN ('seller_cancelled', 'seller_blocked') THEN
      -- Row 60: the seller backed out of a sale the buyer paid for. Paid before
      -- the cancel, or after it on a page the cancel should have closed (the
      -- app expires it; a seller who cancels around the app leaves it open):
      -- either way the seller caused it and pays the card fee (lh-money-escrow
      -- review 3b #5).
      v_reason := 'seller_backed_out';
    ELSIF o.close_reason = 'seller_out' THEN
      -- Owner 2026-10-17 (answer 7): the deadline sweep closed this checkout
      -- because the seller could no longer sell (banned, suspended, 3 Declutter
      -- strikes, an under-18 birthday or flagged business-like), and the buyer
      -- paid anyway: every cent back, and the card fee is the SELLER's debt.
      v_reason := 'seller_out';
    ELSIF o.close_reason = 'missed_checkout' AND v_deadline IS NOT NULL
          AND p_paid_at <= v_deadline + interval '1 hour' THEN
      -- B41: paid in time, recorded late. The strike goes. BUY-1: the sale no
      -- longer stands; the hold was released, so the payment is refunded in full.
      UPDATE public.declutter_strikes s
         SET removed_at = now()
       WHERE s.cart_line_id IN (SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
         AND s.reason = 'missed_checkout' AND s.removed_at IS NULL;
      SELECT count(*), count(*) FILTER (WHERE c.status = 'missed') INTO v_lines, v_live
        FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
      -- The items part apart from the blocks part (lh-money-escrow review of
      -- 905501cb2 #1): whether the seller being out is the one thing that
      -- stops the sale is judged on the items alone, as path (c) does.
      v_items_ok := v_lines > 0 AND v_live = v_lines
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                         WHERE c.order_id = p_order_id AND i.status NOT IN ('live', 'paused'))
        AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_cart_items c2 ON c2.item_id = c.item_id AND c2.id <> c.id
                         WHERE c.order_id = p_order_id AND c2.status IN ('in_cart', 'paid'));
      -- BUY-1 (lead 10-31): the hold was already released (the item went back on sale and the offers it closed
      -- reopened), so the sale is never brought back. The strike still goes (paid in time). The buyer's notice is
      -- sent below, once the reason is known (CHANGED, Q1926 buyer half).
      -- Owner 2026-10-17 (answer 7): when the seller being out is the ONLY
      -- thing that stops the sale, the seller (not us) owes the card fee; the
      -- buyer still gets every cent. Anything else is ours.
      -- CHANGED (Q1926): a SELLER who blocked the buyer backed out, as on an open checkout (path c): the reason is
      -- seller_backed_out (the seller owes the card fee), not order_closed (we paid it). Like seller_out, only when
      -- the items alone would still let the sale stand; if they went to someone else the block stopped nothing.
      v_reason := CASE WHEN v_items_ok AND EXISTS (SELECT 1 FROM public.user_blocks b
                                                    WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                       THEN 'seller_backed_out'
                       WHEN v_items_ok AND v_cant THEN 'seller_out'
                       -- CHANGED (Q1926 buyer half, owner 2026-11-03): a BUYER who blocked the seller ended the sale
                       -- themselves, as on an open checkout (path c): buyer_cancelled, the card fee is kept.
                       WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                     WHERE b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)
                       THEN 'buyer_cancelled'
                       ELSE 'order_closed' END;
      -- CHANGED (Q1926 buyer half): "every cent" only when every cent comes back.
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your strike was removed',
        CASE WHEN v_reason = 'buyer_cancelled'
             THEN 'You paid in time, so the missed-checkout strike is gone. The item''s hold had already ended, so we''re refunding your payment. You blocked the seller, so the card fee isn''t refunded.'
             ELSE 'You paid in time, so the missed-checkout strike is gone. The hold on the item had already ended, so every cent is coming back to your card.' END,
        '/declutter?view=cart', o.seller_id);
      v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
      IF v_reason = 'seller_out' THEN
        PERFORM public.declutter_seller_out_fee_notice(v_refund);
      END IF;
      RETURN public.declutter_refund_answer(v_refund);
    ELSE
      v_reason := 'order_closed';
    END IF;
    IF v_reason IS NOT NULL THEN
      v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
      IF v_reason = 'seller_out' THEN
        PERFORM public.declutter_seller_out_fee_notice(v_refund);
      END IF;
      RETURN public.declutter_refund_answer(v_refund);
    END IF;
  END IF;

  IF o.status <> 'awaiting_payment' THEN
    RETURN public.declutter_refund_answer(
      public.declutter_record_refund(o.id, p_payment_intent_id, 'order_closed', p_amount_cents, p_card_fee_cents));
  END IF;
  SELECT count(*), count(*) FILTER (WHERE c.status = 'in_cart') INTO v_lines, v_live
    FROM public.declutter_cart_items c WHERE c.order_id = p_order_id;
  -- Every line must still be in the cart, every item still reserved, and the
  -- seller still able to sell to this buyer.
  v_items_ok := v_lines > 0 AND v_live = v_lines
     AND NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
                      WHERE c.order_id = p_order_id AND i.status <> 'reserved');
  IF NOT v_items_ok
     OR v_cant
     OR EXISTS (SELECT 1 FROM public.user_blocks b
                 WHERE (b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                    OR (b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)) THEN
    -- CHANGED (Q2106): no card money moved on the gift-paid step, so nothing is refunded: refuse, and the redeem
    -- rolls back (the buyer keeps the gift and the order stays as it was).
    IF v_gift_only THEN
      RAISE EXCEPTION 'gift_payment_not_payable' USING ERRCODE = 'P0001';
    END IF;
    -- Who made it unpayable decides who bears the card fee (lh-authz-rls
    -- review 3b #1): a seller who blocked the buyer backed out (row 60); a
    -- BUYER who blocked the seller cancelled it themselves, so the card fee is
    -- kept (owner: never absorb a fee; otherwise blocking would be a free way to
    -- make us pay it); anything else is ours.
    v_reason := CASE WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id)
                     THEN 'seller_backed_out'
                     -- Owner 2026-10-17 (answer 7): a seller who can no longer
                     -- sell owes the card fee and the buyer gets every cent,
                     -- even if the buyer also blocked them; only when the
                     -- sale was otherwise still whole.
                     WHEN v_cant AND v_items_ok THEN 'seller_out'
                     WHEN EXISTS (SELECT 1 FROM public.user_blocks b
                                   WHERE b.blocker_id = o.buyer_id AND b.blocked_id = o.seller_id)
                     THEN 'buyer_cancelled'
                     ELSE 'order_closed' END;
    UPDATE public.declutter_orders SET status = 'expired', close_reason = 'not_payable', closed_at = now() WHERE id = p_order_id;
    UPDATE public.declutter_cart_items SET order_id = NULL WHERE order_id = p_order_id AND status = 'in_cart';
    v_refund := public.declutter_record_refund(o.id, p_payment_intent_id, v_reason, p_amount_cents, p_card_fee_cents);
    IF v_reason = 'seller_out' THEN
      PERFORM public.declutter_seller_out_fee_notice(v_refund);
    END IF;
    RETURN public.declutter_refund_answer(v_refund);
  END IF;
  UPDATE public.declutter_orders
     SET status = 'paid', paid_at = now(), stripe_paid_at = p_paid_at, stripe_payment_intent_id = p_payment_intent_id,
         -- CHANGED (Q2106): the card fee is the card's share only: none on a gift-paid order, and on a mixed order the
         -- estimate is of what the card paid. An order with no gift is exactly as before.
         card_fee_cents = CASE WHEN v_gift_only THEN 0
                               WHEN o.gift_cents > 0 THEN least(p_amount_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(p_amount_cents))))
                               ELSE least(o.total_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(o.total_cents)))) END
   WHERE id = p_order_id AND status = 'awaiting_payment';
  FOR r IN
    UPDATE public.declutter_cart_items c SET status = 'paid', closed_at = now()
     WHERE c.order_id = p_order_id AND c.status = 'in_cart'
    RETURNING c.item_id
  LOOP
    UPDATE public.declutter_items SET status = 'sold', updated_at = now()
     WHERE id = r.item_id AND status = 'reserved';
  END LOOP;
  -- B110 (owner 11-01): the pickup time the buyer chose at checkout is booked now, exactly as declutter_book_pickup's
  -- 'booked' branch (a 30-minute booking at the start, and the handover code), when it is still ahead and inside the
  -- 7-day deadline. One already past (a late payment) is not booked: the buyer picks a time after paying, as before.
  IF o.handover IN ('porch', 'pickup_home', 'meetup') AND o.pickup_slot_start IS NOT NULL
     AND o.pickup_slot_start > now() AND o.pickup_slot_start + interval '30 minutes' <= now() + interval '7 days' THEN
    INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
    VALUES (o.id, o.buyer_id, o.seller_id, o.pickup_slot_start, o.pickup_slot_start + interval '30 minutes')
    ON CONFLICT (order_id) DO NOTHING;
    INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
    ON CONFLICT (order_id) DO NOTHING;
    v_pickup := public.declutter_pickup_time_words(o.id);
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Payment received',
    -- CHANGED (Q2106): what the buyer paid in all, the gift card's share included (p_amount_cents is the card's).
    format('You paid %s for %s. %s', public.declutter_price_text(p_amount_cents + o.gift_cents), public.declutter_order_items_named(p_order_id),
           public.declutter_paid_next_step(p_order_id)),
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer paid',
    format('The buyer paid %s for %s. %sYou get paid after the handover.', public.declutter_price_text(o.items_cents),
           public.declutter_order_items_named(p_order_id), COALESCE(v_pickup || ' ', '')),
    '/declutter?view=selling', o.buyer_id);
  PERFORM public.declutter_claim_setup_fee(p_order_id);
  RETURN jsonb_build_object('result', 'paid');
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_mark_order_paid(uuid, text, integer, timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_porch_photo(p_order_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_m integer;
  v_done jsonb;
  v_day date;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'handed_over' AND o.handover = 'porch' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  -- Audit 1a #4 (20261029201542): the seller puts it out ON the buyer's booked day, never before, so the buyer is
  -- not told to come early and the payout clock does not start early. The day is the booking's porch day, else the
  -- Louisiana date of an older timed booking's slot.
  IF v_side = 'seller' THEN
    SELECT COALESCE(b.pickup_day, (b.slot_start AT TIME ZONE 'America/Chicago')::date) INTO v_day
      FROM public.declutter_bookings b WHERE b.order_id = o.id;
    -- Fail closed: no day read (not_booked_yet above should make that impossible) is refused too, never waved through.
    IF v_day IS NULL OR (now() AT TIME ZONE 'America/Chicago')::date < v_day THEN
      RAISE EXCEPTION 'porch_day_not_yet' USING ERRCODE = '55000',
        HINT = format('Put it out on %s, the day the buyer picked.', to_char(v_day, 'FMDay, Mon FMDD'));
    END IF;
  END IF;
  -- BUY-17 (owner 11-03, lead call the same hour): the buyer's "Picked up" photo finishes the sale and pays the
  -- seller like "I got it" does, so it waits for the seller's porch photo too (same refusal, same reason).
  IF v_side = 'buyer' AND NOT EXISTS (
       SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_at IS NOT NULL) THEN
    RAISE EXCEPTION 'porch_photo_not_in' USING ERRCODE = '22023',
      HINT = 'You can take your pickup photo once the seller posts the porch photo.';
  END IF;
  IF p_photo_path IS NULL
     OR split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
  IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
    RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
      HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
  END IF;
  -- Both sides' photos are taken at the address (20261028235709): the seller's "Left on porch" as the buyer's
  -- "Picked up".
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  -- Haversine, metres, to the NEAREST pickup point of the ORDER (D-NEW14, 20261030164712): the porch place frozen
  -- on it at checkout, else (an order with no place) every item's own point, as before (authz review 2.7).
  SELECT min(round(2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians((p_lat - pt.lat) / 2)), 2)
           + cos(radians(pt.lat)) * cos(radians(p_lat)) * power(sin(radians((p_lng - pt.lng) / 2)), 2)))))::integer)
    INTO v_m
    FROM public.declutter_order_pickup_points(o.id) pt;
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  IF v_side = 'seller' THEN
    UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path, set_out_at = now(), set_out_distance_m = v_m
     WHERE order_id = o.id;
    -- The buyer's signal to go (20261028225038): its own title, the Pickups switch, Buying.
    PERFORM public.declutter_notice_ref(p_order_id); -- Q2659
    PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'It''s on the porch: pick it up today',
      'The seller put your item out. Take a photo when you pick it up.', '/declutter?tab=buying', o.seller_id);
    RETURN jsonb_build_object('result', 'set_out', 'distance_m', v_m);
  END IF;
  UPDATE public.declutter_handovers
     SET picked_up_photo_path = p_photo_path, picked_up_at = now(), picked_up_distance_m = v_m
   WHERE order_id = o.id;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Your item was picked up',
      'The buyer picked up the item from your porch. A problem report is open, so our team decides before anyone is paid.',
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m, 'paid', false);
  END IF;
  v_done := public.declutter_complete_handover(o.id, 'porch');
  RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m, 'paid', true, 'payout_id', v_done->'payout_id');
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_porch_photo(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_photo(uuid, text, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_record_ai_check(p_item_id uuid, p_seller_id uuid, p_judged_photo_ids uuid[], p_judged_title text, p_judged_description text, p_judged_category text, p_flag_reason text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.declutter_items%ROWTYPE;
  v_current uuid[];
  v_at timestamptz := now();
  v_flag text := NULLIF(left(btrim(COALESCE(p_flag_reason, '')), 300), '');
  r record;
  v_line record;
BEGIN
  -- A draft (before publishing), or a listing an edit sent back for this check:
  -- it was live before (live_at set) and its result was cleared by the edit. A
  -- listing already judged (flagged, waiting for an admin) is never re-judged,
  -- so a flag cannot be washed off by asking again.
  SELECT i.* INTO v_item FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = p_seller_id
     AND (i.status = 'draft'
          -- LEAD-POST-SLOW: the check that runs right after Post, on a live listing not judged yet, or one a buyer
          -- reserved or paid for before it landed (review of 41771724f3). Never one an admin approved since it
          -- went live: the admin's decision stands.
          OR (i.status IN ('live', 'reserved', 'sold') AND i.live_at IS NOT NULL
              AND (i.admin_approved_at IS NULL OR i.admin_approved_at < i.live_at)
              AND EXISTS (SELECT 1 FROM public.declutter_item_private pv
                           WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL))
          OR (i.status = 'pending_review' AND i.live_at IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.declutter_item_private pv
                           WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL)))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_current
    FROM public.declutter_item_photos WHERE item_id = p_item_id;
  IF v_current IS DISTINCT FROM (SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(p_judged_photo_ids) AS x)
     OR v_item.title IS DISTINCT FROM p_judged_title
     OR v_item.description IS DISTINCT FROM p_judged_description
     OR v_item.category IS DISTINCT FROM p_judged_category THEN
    RAISE EXCEPTION 'ai_check_stale' USING ERRCODE = '40001';
  END IF;
  UPDATE public.declutter_item_private
     SET ai_checked_at = v_at,
         ai_flag_reason = v_flag,
         updated_at = v_at
   WHERE item_id = p_item_id;

  -- LEAD-POST-SLOW: a listing that went live at Post and is flagged now comes down at once: held for an admin, its
  -- open offers closed (buyers told, nothing charged), and the seller told why.
  IF v_item.status = 'live' AND v_flag IS NOT NULL THEN
    UPDATE public.declutter_items
       SET status = 'pending_review', updated_at = v_at
     WHERE id = p_item_id AND status = 'live';
    FOR r IN
      UPDATE public.declutter_offers
         SET status = 'voided', closed_at = v_at, updated_at = v_at
       WHERE item_id = p_item_id AND status = 'open'
      RETURNING id, buyer_id
    LOOP
      INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
      PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing changed',
        format('"%s" was taken down for a check, so your offer is closed. Nothing was charged.', v_item.title),
        '/declutter?tab=buying', v_item.seller_id);
    END LOOP;
    PERFORM public.declutter_notify(v_item.seller_id, 'declutter_listings', 'Your listing is waiting for a check',
      format('Our automatic check flagged "%s" (%s). Our team will look at it. Buyers can''t see it until then.', v_item.title, v_flag),
      '/declutter?tab=selling', NULL);
  END IF;

  -- Review of 41771724f3 (2): flagged after a buyer reserved or paid for it.
  IF v_item.status IN ('reserved', 'sold') AND v_flag IS NOT NULL THEN
    -- Lock order as everywhere in Declutter: items (above) -> orders -> lines.
    SELECT c.id, c.status, c.buyer_id, c.order_id, o.status AS order_status INTO v_line
      FROM public.declutter_cart_items c LEFT JOIN public.declutter_orders o ON o.id = c.order_id
     WHERE c.item_id = p_item_id AND c.status IN ('in_cart', 'paid')
     ORDER BY c.created_at DESC LIMIT 1;
    IF v_line.order_id IS NOT NULL THEN
      PERFORM 1 FROM public.declutter_orders o WHERE o.id = v_line.order_id FOR UPDATE;
    END IF;
    IF v_line.id IS NOT NULL AND v_line.status = 'in_cart' AND COALESCE(v_line.order_status, 'awaiting_payment') = 'awaiting_payment' THEN
      -- Not paid: let the line go with no strike, held for an admin.
      UPDATE public.declutter_cart_items SET status = 'removed', closed_at = v_at
       WHERE id = v_line.id AND status = 'in_cart';
      IF v_line.order_id IS NOT NULL THEN
        -- 'not_payable', never 'superseded' (= the buyer restarted checkout, card fee kept): a payment that still
        -- lands on this checkout is refunded in full, the card fee ours, as the buyer's notice below promises.
        UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'not_payable', closed_at = v_at
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET order_id = NULL
         WHERE order_id = v_line.order_id AND status = 'in_cart';
      END IF;
      UPDATE public.declutter_items SET status = 'pending_review', updated_at = v_at
       WHERE id = p_item_id AND status = 'reserved';
      PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_offers', 'Listing changed',
        format('"%s" was taken down for a check, so it left your cart. Nothing was charged.', v_item.title),
        '/declutter?tab=buying', v_item.seller_id);
      PERFORM public.declutter_notify(v_item.seller_id, 'declutter_listings', 'Your listing is waiting for a check',
        format('Our automatic check flagged "%s" (%s). Our team will look at it. Buyers can''t see it until then.', v_item.title, v_flag),
        '/declutter?tab=selling', NULL);
    ELSE
      -- Paid (or the order is past paying): the sale stands until an admin decides; the seller's payouts wait.
      INSERT INTO public.payout_holds (helper_id, reason, held_by, held_at)
      VALUES (v_item.seller_id,
              left(format('Declutter: the automatic check flagged "%s" (%s) after it sold (order %s). Lift this hold to pay the seller, or refund the buyer.',
                          v_item.title, v_flag, COALESCE(v_line.order_id::text, 'none')), 1000),
              NULL, v_at)
      ON CONFLICT (helper_id) DO NOTHING;
      -- Every admin, never for a test account (owner 2026-10-30).
      IF NOT public.is_test_subject(v_item.seller_id) THEN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        SELECT ur.user_id,
               'A sold Declutter listing failed its check',
               left(format('"%s" was flagged (%s) after a buyer paid. The seller''s payouts are on hold: lift the hold to pay them, or refund the buyer.', v_item.title, v_flag), 1000),
               'admin_alert',
               '/admin?view=payouts'
          FROM public.user_roles ur
         WHERE ur.role = 'admin';
      END IF;
      PERFORM public.declutter_notify(v_item.seller_id, 'declutter_listings', 'Your sale is waiting for a check',
        format('Our automatic check flagged "%s" (%s). Our team will look at it before you''re paid.', v_item.title, v_flag),
        '/declutter?tab=selling', NULL);
    END IF;
  END IF;

  IF v_item.status = 'pending_review' THEN
    IF v_flag IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr
                        WHERE pr.user_id = v_item.seller_id
                          AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                          AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
       AND public.declutter_active_strike_count(v_item.seller_id) < 3
       AND NOT public.member_under_18(v_item.seller_id) THEN
      -- Clean: back in front of buyers, its open offers still open.
      UPDATE public.declutter_items
         SET status = 'live', updated_at = v_at
       WHERE id = p_item_id AND status = 'pending_review';
    ELSIF v_flag IS NOT NULL THEN
      -- Flagged: held for an admin, and its open offers close (buyers told, nothing charged).
      FOR r IN
        UPDATE public.declutter_offers
           SET status = 'voided', closed_at = v_at, updated_at = v_at
         WHERE item_id = p_item_id AND status = 'open'
        RETURNING id, buyer_id
      LOOP
        INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
        PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing changed',
          format('The seller changed "%s", so your offer is closed. Nothing was charged.', v_item.title),
          '/declutter?tab=buying', v_item.seller_id);
      END LOOP;
    END IF;
  END IF;
  RETURN v_at;
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_record_ai_check(uuid, uuid, uuid[], text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_ai_check(uuid, uuid, uuid[], text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_after_handover(p_order_id uuid, p_reason text, p_part_cents integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.declutter_orders;
  v_reserved integer;
  v_paid integer;
  v_refund uuid;
  v_refunded integer;
  v_cents integer;
  v_title text;
  v_policy text;
  v_never_got_it boolean;
  -- Shipping S6 2g: the shipping a buyer-fault refund of a delivered parcel keeps back (the label was spent).
  v_ship integer := 0;
  -- CHANGED (Q1928 gap 3): the reason the refund is recorded under.
  v_fee_reason text := p_reason;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('refund_request_full', 'refund_request_part', 'not_as_described', 'admin_no_fault', 'admin_buyer_fault', 'seller_no_show') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  IF o.status <> 'handed_over' OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_handed_over' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = o.stripe_payment_intent_id) THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
  IF NOT public.declutter_payout_unsent(o.id) THEN
    RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000',
      HINT = 'The seller was already paid for this sale. Louisiana Helpr settles it by hand.';
  END IF;
  -- CHANGED (BUY-25, owner 10-30): only declutter_answer_refund's "never got it" sends this reason here.
  v_never_got_it := p_reason = 'seller_no_show';
  -- A delivery fee that paid a Helpr for the trip stays with the Helpr (owner #5, B69).
  v_reserved := public.declutter_delivery_reserved_cents(o.id);
  -- CHANGED (Shipping S6 2g): an admin buyer-fault refund of a shipped order leaves its bought label's shipping out
  -- (spec 5.3: a spent label is whoever caused it; declutter_record_refund's keep_buyer_fee check counts shipping -
  -- shipping reserved, so passing the whole total raised refund_amount_unknown). Every other reason is unchanged.
  IF p_reason = 'admin_buyer_fault' THEN
    v_ship := COALESCE(public.declutter_shipping_reserved_cents(o.id), 0);
  END IF;
  v_paid := o.total_cents - v_reserved - v_ship;
  -- CHANGED (Q1928 gap 3, lead 11-02): a nobody's-fault refund while the seller can no longer sell is the seller's
  -- card fee (seller_out), as at payment (owner answer 7). The buyer's notice reads the policy, so it drops the
  -- card-network sentence by itself.
  IF p_reason = 'admin_no_fault' AND public.declutter_seller_out(o.seller_id) THEN
    v_fee_reason := 'seller_out';
  END IF;
  IF p_reason = 'refund_request_part' THEN
    -- Q1998: tax on a part refund is never guessed. Declutter charges no tax today (declutter-checkout refuses it).
    IF o.tax_cents <> 0 THEN
      RAISE EXCEPTION 'part_refund_unavailable' USING ERRCODE = '55000';
    END IF;
    IF p_part_cents IS NULL OR p_part_cents <= 0 OR p_part_cents >= o.items_cents THEN
      RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents,
                                          kept_cents, refund_cents)
    VALUES (o.id, o.stripe_payment_intent_id, 'refund_request_part', 'agreed_part', v_paid, 0, 0, p_part_cents)
    RETURNING id INTO v_refund;
    v_refunded := p_part_cents;
  ELSE
    -- CHANGED (Q1935, restored: 2g was restated from a base before 20261102040952): the card fee prorated to the part
    -- refunded. CHANGED (Q1928 gap 3): recorded under v_fee_reason.
    v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, v_fee_reason, v_paid,
      public.declutter_card_fee_left(o.card_fee_cents, o.total_cents, v_reserved));
    -- The whole sale is undone for the seller: nothing of the item price is theirs, and the item goes back.
    -- A seller delivery's rate went back to the buyer with it (no Helpr was paid for the trip), so it
    -- leaves the seller's payout too: their payout for this sale is 0 (20261027153244).
    v_refunded := o.items_cents + CASE WHEN o.handover = 'seller_delivery' THEN o.delivery_cents ELSE 0 END;
    UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
     WHERE id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'paid')
       AND status = 'completed';
  END IF;
  PERFORM public.declutter_rebook_payout(o.id, v_refunded);
  SELECT r.refund_cents, r.fee_policy INTO v_cents, v_policy FROM public.declutter_refunds r WHERE r.id = v_refund;
  SELECT string_agg(i.title, ', ' ORDER BY i.title) INTO v_title
    FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id WHERE c.order_id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    CASE WHEN p_reason = 'refund_request_part'
         THEN format('$%s is coming back to your card for "%s". Keep the item.', to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'))
         WHEN v_never_got_it
         THEN format('$%s is coming back to your card for "%s". The seller agreed you never got it.%s',
                     to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'),
                     CASE WHEN v_reserved > 0 THEN ' What you paid for delivery went to the Helpr who made the trip.' ELSE '' END)
         WHEN p_reason = 'refund_request_full'
         THEN format('$%s is coming back to your card for "%s". The seller confirmed they have the item back.%s%s',
                     to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'),
                     CASE WHEN v_policy = 'keep_card_fee' THEN ' That''s all you paid, less the card fee.' ELSE '' END,
                     CASE WHEN v_reserved > 0 THEN ' What you paid for delivery went to the Helpr who made the trip.' ELSE '' END)
         ELSE format('$%s is coming back to your card for "%s".%s%s Please give the item back to the seller; message the seller from your order.',
                     to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'),
                     CASE WHEN p_reason = 'admin_buyer_fault' AND v_ship > 0
                          THEN format(' The $%s for shipping is not refunded: the parcel was sent.', to_char(v_ship / 100.0, 'FM999990.00'))
                          WHEN p_reason = 'admin_buyer_fault' THEN ''
                          WHEN v_policy = 'keep_card_fee' THEN ' That''s all you paid, less the card fee.'
                          ELSE '' END,
                     CASE WHEN v_reserved > 0 THEN ' What you paid for delivery went to the Helpr who made the trip.' ELSE '' END)
    END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer refunded',
    CASE WHEN p_reason = 'refund_request_part'
         THEN format('The buyer got $%s back for "%s". It comes out of your payout for this sale.', to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'))
         WHEN v_never_got_it
         THEN format('You agreed the buyer never got "%s" and the buyer was refunded, so there is no payout for this sale.', COALESCE(v_title, 'your item'))
         WHEN p_reason = 'refund_request_full'
         THEN format('You have "%s" back and the buyer was refunded, so there is no payout for this sale.', COALESCE(v_title, 'your item'))
         ELSE format('The buyer was refunded for "%s", so there is no payout for this sale. The buyer gives the item back; message the buyer from your order.', COALESCE(v_title, 'your item'))
    END,
    '/declutter?view=selling', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund) || jsonb_build_object('refunded_items_cents', v_refunded);
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_refund_after_handover(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_after_handover(uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_seller_picked_up(p_order_id uuid, p_photo_path text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_out jsonb;
  v_m integer;
  h public.declutter_handovers;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'seller' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- Q2425: handing it over at a safe meeting spot is the same act as at the door.
  IF o.handover NOT IN ('pickup_home', 'meetup') THEN
    RAISE EXCEPTION 'not_a_door_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  -- Not before the booked time (lh-money-escrow review #1): the seller cannot
  -- mark it picked up, and be paid, before the buyer could have come.
  IF EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start > now()) THEN
    RAISE EXCEPTION 'before_pickup_time' USING ERRCODE = '55000',
      HINT = 'You can mark it picked up from the booked pickup time.';
  END IF;
  p_photo_path := NULLIF(btrim(p_photo_path), '');
  IF p_photo_path IS NOT NULL THEN
    IF split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
       OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
       OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
       OR split_part(p_photo_path, '/', 5) = ''
       OR split_part(p_photo_path, '/', 6) <> ''
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
    -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
    IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
      RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
        HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
    END IF;
    -- A photo is taken where the handover is (20261028235709): the meeting spot frozen on the order, or the
    -- nearest item pickup point of a door pickup.
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
    END IF;
    IF o.handover = 'meetup' THEN
      SELECT public.helpr_task_distance_m(p_lat, p_lng, m.spot_lat, m.spot_lng) INTO v_m
        FROM public.declutter_order_meetups m WHERE m.order_id = o.id;
      IF v_m IS NULL OR v_m > 200 THEN
        RAISE EXCEPTION 'not_at_meetup' USING ERRCODE = '22023', HINT = 'Take the photo at the meeting spot.';
      END IF;
    ELSE
      SELECT min(public.helpr_task_distance_m(p_lat, p_lng, p.pickup_lat, p.pickup_lng)) INTO v_m
        FROM public.declutter_cart_items c
        JOIN public.declutter_item_private p ON p.item_id = c.item_id
       WHERE c.order_id = o.id;
      IF v_m IS NULL OR v_m > 200 THEN
        RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
      END IF;
    END IF;
  END IF;
  -- CHANGED (owner 10-30): a paid sale waits for the buyer. A free claim moves no money, so it finishes as before.
  IF o.paid_with = 'free' THEN
    -- complete_handover first (it refuses an open problem); then the photo is kept with the handover.
    v_out := public.declutter_complete_handover(o.id, 'seller');
    IF p_photo_path IS NOT NULL THEN
      UPDATE public.declutter_handovers SET picked_up_photo_path = p_photo_path, picked_up_at = now(), picked_up_distance_m = v_m
       WHERE order_id = o.id AND picked_up_photo_path IS NULL;
    END IF;
    RETURN v_out;
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Our team decides before anyone is paid.';
  END IF;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  IF h.no_show_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'no_show_reported' USING ERRCODE = '55000',
      HINT = 'The buyer says you didn''t show. Answer that report on this order.';
  END IF;
  IF h.seller_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'seller_confirmed');
  END IF;
  UPDATE public.declutter_handovers
     SET seller_confirmed_at = now(),
         picked_up_photo_path = COALESCE(picked_up_photo_path, p_photo_path),
         picked_up_at = CASE WHEN picked_up_photo_path IS NULL AND p_photo_path IS NOT NULL THEN now() ELSE picked_up_at END,
         picked_up_distance_m = CASE WHEN picked_up_photo_path IS NULL AND p_photo_path IS NOT NULL THEN v_m ELSE picked_up_distance_m END
   WHERE order_id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'The seller says you have it',
    format('About %s. Tap "I got it" in Buying. If you don''t have it, report a problem there. If we don''t hear from you, the seller is paid in 48 hours.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=buying', o.seller_id);
  RETURN jsonb_build_object('result', 'seller_confirmed');
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_seller_picked_up(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_picked_up(uuid, text, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_ship_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  o public.declutter_orders;
  v_done integer := 0;
  v_never integer := 0;
  v_mode text;
  v_lost integer := 0;
BEGIN
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.shipments s ON s.declutter_order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'ship' AND o2.ship_capture = 'captured'
       AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL
       AND s.delivered_at + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover = 'ship' AND o.ship_capture = 'captured'
         AND EXISTS (SELECT 1 FROM public.shipments s
                      WHERE s.declutter_order_id = o.id AND s.tracking_status = 'delivered' AND s.delivered_at IS NOT NULL
                        AND s.delivered_at + interval '24 hours' <= now())
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_done := v_done + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_ship_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;

  -- S6 2b: never shipped by ship-by.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.shipments s ON s.declutter_order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'ship' AND o2.ship_capture = 'captured'
       AND s.label_state = 'bought' AND s.accepted_at IS NULL
       AND now() >= public.declutter_ship_by(o2.paid_at)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      SELECT s.label_mode INTO v_mode FROM public.shipments s
       WHERE s.declutter_order_id = o.id AND s.label_state = 'bought' AND s.accepted_at IS NULL
       FOR UPDATE;
      IF FOUND AND o.status = 'paid' AND o.handover = 'ship' AND o.ship_capture = 'captured'
         AND now() >= public.declutter_ship_by(o.paid_at)
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
        IF v_mode = 'test' THEN
          UPDATE public.shipments SET label_state = 'void_requested', last_error = NULL, next_attempt_at = now()
           WHERE declutter_order_id = o.id AND label_state = 'bought' AND accepted_at IS NULL;
        ELSE
          PERFORM public.log_cron_defect('declutter_ship_sweep-live-void', o.id::text,
            format('order %s was never shipped by its ship-by and was refunded; its LIVE label must be voided by hand', o.id));
        END IF;
        PERFORM public.declutter_close_paid_order(o.id, 'seller_backed_out', 'seller', 'item_gone_after_sale',
          'You did not ship a paid Declutter order by its ship-by date. The buyer got everything back, shipping included; the cost of that refund comes out of your next Declutter payout.');
        v_never := v_never + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_ship_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;

  -- Shipping lost sweep (20261103203204): handed to the carrier 10 days ago and still no delivered scan.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.shipments s ON s.declutter_order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'ship' AND o2.ship_capture = 'captured'
       AND s.label_state = 'bought' AND s.accepted_at IS NOT NULL AND s.accepted_at + interval '10 days' <= now()
       AND s.delivered_at IS NULL AND s.tracking_status IS DISTINCT FROM 'delivered'
       AND s.tracking_status IS DISTINCT FROM 'available_for_pickup'
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      PERFORM 1 FROM public.shipments s
       WHERE s.declutter_order_id = o.id AND s.label_state = 'bought' AND s.accepted_at IS NOT NULL
         AND s.accepted_at + interval '10 days' <= now() AND s.delivered_at IS NULL
         AND s.tracking_status IS DISTINCT FROM 'delivered' AND s.tracking_status IS DISTINCT FROM 'available_for_pickup'
       FOR UPDATE;
      IF FOUND AND o.status = 'paid' AND o.handover = 'ship' AND o.ship_capture = 'captured'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
        PERFORM public.declutter_close_paid_order(o.id, 'ship_lost', NULL, NULL,
          'Your package was never delivered, 10 days after the carrier took it. The buyer got everything back, shipping included; the label and the buyer''s card fee come out of your next Declutter payout.');
        v_lost := v_lost + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_ship_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('delivered_handed_over', v_done, 'never_shipped_closed', v_never, 'lost_closed', v_lost);
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_ship_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_ship_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_withdraw_problem(p_problem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  p public.declutter_problems;
  v_side text;
  v_withdrawn integer := 0;
  a record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Lock order: the order first, then the problem, as the decision does.
  o := public.declutter_lock_order(v_order);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  -- Only the member who reported it, still that side of the sale; anyone else is not told it exists.
  IF v_side IS NULL OR v_side NOT IN ('buyer', 'seller')
     OR p.reporter_id IS DISTINCT FROM v_uid OR p.reporter_side IS DISTINCT FROM v_side THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p.status = 'withdrawn' THEN
    RETURN jsonb_build_object('result', 'already', 'problem_id', p.id);
  END IF;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  -- A refund request that went to Louisiana Helpr with this report.
  IF EXISTS (SELECT 1 FROM public.declutter_refund_requests r
              WHERE r.problem_id = p.id AND r.status = 'to_admin' AND r.return_agreed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_has_return' USING ERRCODE = '55000',
      HINT = 'A return was agreed on this sale, so our team decides it.';
  END IF;
  IF v_side = 'seller' AND EXISTS (SELECT 1 FROM public.declutter_refund_requests r
                                    WHERE r.problem_id = p.id AND r.status = 'to_admin') THEN
    RAISE EXCEPTION 'problem_has_refund_request' USING ERRCODE = '55000',
      HINT = 'The buyer''s refund request went to Louisiana Helpr with your report, so it stays with them.';
  END IF;
  UPDATE public.declutter_refund_requests SET status = 'withdrawn'
   WHERE problem_id = p.id AND status = 'to_admin' AND v_side = 'buyer';
  GET DIAGNOSTICS v_withdrawn = ROW_COUNT;
  UPDATE public.declutter_problems SET status = 'withdrawn', withdrawn_at = now() WHERE id = p.id;
  -- CHANGED (T9, review of 7496d29c8b #1): whatever problem the buyer takes back, the no-show clock ends with it: the seller
  -- may have answered on it. Left set, the sweep would read the passed 24 hours as no answer and refund, with a strike, a
  -- seller who did answer, and the buyer could force that past Louisiana Helpr. The seller taking back their OWN response
  -- doesn't touch the buyer's report: the clock runs on.
  IF v_side = 'buyer' THEN
    UPDATE public.declutter_handovers SET no_show_reported_at = NULL, no_show_answer_by = NULL WHERE order_id = o.id;
  END IF;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'declutter_refunds',
    'Problem report taken back',
    format('The %s took back their problem report on %s. Nothing is held for it any more.',
           v_side, public.declutter_order_items_named(o.id)),
    -- CHANGED (LEAD-TAKENBACK-LINK): the tab address, not the old ?view= one.
    '/declutter?tab=' || CASE WHEN v_side = 'buyer' THEN 'selling' ELSE 'buying' END, v_uid);
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.declutter_notify(a.user_id, 'info', 'Declutter problem taken back',
      'A member took back a Declutter problem they reported. It has left the problems queue.', '/admin');
  END LOOP;
  RETURN jsonb_build_object('result', 'withdrawn', 'problem_id', p.id, 'refund_requests_withdrawn', v_withdrawn);
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_withdraw_problem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_problem(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_cant_finish(p_task_id uuid, p_reason text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  o public.declutter_orders;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_item text;
  v_problem uuid;
  a record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Membership before any lock (authz review 10-31): a stranger never locks someone else's delivery.
  IF NOT EXISTS (SELECT 1 FROM public.helpr_tasks x WHERE x.id = p_task_id AND x.helpr_id = v_uid) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.status <> 'picked_up' THEN
    RAISE EXCEPTION 'not_picked_up_yet' USING ERRCODE = '55000', HINT = 'Take the "Picked up" photo first.';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF t.stuck_stage IS NOT NULL AND t.stuck_stage <> 'retrying' THEN
    RAISE EXCEPTION 'already_reported' USING ERRCODE = '55000', HINT = 'You already reported this delivery. Follow the steps on it.';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('wrong_address', 'cant_get_in', 'nobody_there', 'wont_fit', 'cant_finish', 'damaged', 'other') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF p_reason IN ('damaged', 'other') AND v_note IS NULL THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  IF char_length(COALESCE(v_note, '')) > 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  v_item := public.declutter_order_items_named(o.id);
  PERFORM public.helpr_task_log(t.id, 'cant_finish', v_uid, p_reason);
  IF p_reason IN ('damaged', 'other') THEN
    -- Louisiana Helpr decides, with the money held.
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
    VALUES (o.id, v_uid, 'helpr', p_reason, v_note, '{}')
    RETURNING id INTO v_problem;
    UPDATE public.helpr_tasks SET stuck_at = now(), stuck_reason = p_reason, stuck_note = v_note, updated_at = now() WHERE id = t.id;
    PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Your delivery is on hold',
      format('The Helpr reported a problem with %s. Louisiana Helpr looks at it and tells you what it decides. The money stays held until then.', v_item),
      '/declutter?tab=buying', v_uid);
    PERFORM public.declutter_notify(o.seller_id, 'declutter_sales', 'This delivery is on hold',
      format('The Helpr reported a problem with %s. Louisiana Helpr looks at it and tells you what it decides. The money stays held until then.', v_item),
      '/declutter?tab=selling', v_uid);
    -- Test stuff never reaches an admin (owner 2026-10-30; 20261030150104).
    IF NOT (t.is_seed OR o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id) OR public.is_test_subject(t.helpr_id)) THEN
      FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
        PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter problem reported',
          'A Helpr with an item reported a problem on a delivery. The money is held until you decide it.', '/admin');
      END LOOP;
    END IF;
    RETURN jsonb_build_object('result', 'with_admin', 'problem_id', v_problem);
  END IF;
  IF p_reason = 'cant_finish' THEN
    UPDATE public.helpr_tasks
       SET stuck_at = now(), stuck_reason = p_reason, stuck_note = v_note, stuck_fault = 'helpr', stuck_stage = 'returning',
           stuck_return_by = now() + interval '48 hours', updated_at = now()
     WHERE id = t.id;
    PERFORM public.helpr_task_give_job_strike(v_uid, 'delivery_backed_out', t.id, 'Could not finish a Helpr delivery after picking it up');
    PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'Your Helpr can''t finish this delivery',
      format('They have to take %s back to the seller within 48 hours. In Buying, choose a full refund, re-posting it for another Helpr, or collecting it from them.', v_item),
      '/declutter?tab=buying', v_uid);
    PERFORM public.declutter_notify(o.seller_id, 'declutter_sales', 'Your item is coming back',
      format('The Helpr can''t finish the delivery of %s and has to bring it back within 48 hours. Confirm in Selling when you have it.', v_item),
      '/declutter?tab=selling', v_uid);
    RETURN jsonb_build_object('result', 'returning', 'strike', true);
  END IF;
  -- Nobody's fault: one retry. A second report after it sends the item back.
  IF t.stuck_stage = 'retrying' THEN
    UPDATE public.helpr_tasks
       SET stuck_reason = p_reason, stuck_note = v_note, stuck_fault = 'none', stuck_stage = 'returning',
           stuck_return_by = now() + interval '48 hours', updated_at = now()
     WHERE id = t.id;
    PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'The delivery couldn''t be finished',
      format('The Helpr tried again and couldn''t leave %s, so it goes back to the seller and the sale is cancelled. You get back what you paid, less what the delivery cost, which pays the Helpr for the trip, and less the card fee. If you disagree, report a problem in Buying.', v_item),
      '/declutter?tab=buying', v_uid);
    PERFORM public.declutter_notify(o.seller_id, 'declutter_sales', 'Your item is coming back',
      format('The Helpr couldn''t leave %s and brings it back within 48 hours. Confirm in Selling when you have it.', v_item),
      '/declutter?tab=selling', v_uid);
    RETURN jsonb_build_object('result', 'returning', 'strike', false);
  END IF;
  UPDATE public.helpr_tasks
     SET stuck_at = now(), stuck_reason = p_reason, stuck_note = v_note, stuck_fault = 'none', stuck_stage = 'waiting_fix',
         stuck_fix_by = now() + interval '24 hours', updated_at = now()
   WHERE id = t.id;
  PERFORM public.declutter_notify(o.buyer_id, 'declutter_pickups', 'Your Helpr can''t get to you',
    format('About %s. Fix it in Buying within 24 hours, and they try once more. If it isn''t fixed, it goes back to the seller and the sale is cancelled.', v_item),
    '/declutter?tab=buying', v_uid);
  RETURN jsonb_build_object('result', 'waiting_fix', 'strike', false);
END;
$function$
;

REVOKE ALL ON FUNCTION public.helpr_task_cant_finish(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_cant_finish(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_confirm(p_task uuid, p_by text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.helpr_tasks;
  v_payout uuid;
  v_amount integer;
  v_debt integer := 0;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000',
      HINT = 'The Helpr has not picked the item up yet.';
  END IF;
  IF p_by IS NULL OR p_by NOT IN ('customer', 'auto', 'admin') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  IF p_by <> 'admin' AND public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported. Our team decides before anyone is paid.';
  END IF;
  UPDATE public.helpr_tasks
     SET status = 'confirmed', confirmed_at = now(), confirmed_by = p_by, closed_at = now(), updated_at = now()
   WHERE id = t.id AND status IN ('picked_up', 'delivered');
  v_amount := public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents);
  -- CHANGED (BUY-36): a card fee the Helpr owes (declutter_seller_fee_debts, reason helpr_fault) comes off this payout.
  -- Capped (money review 10-31, the Jobs helprFaultFeeCapCents rule): the raises are sent whole from their own charges
  -- (helprPayoutParts throws when the order part goes below 0), so the take leaves the order part at $1 or more; the
  -- rest of the debt waits for the next payout.
  IF t.helpr_id IS NOT NULL AND v_amount > 0 THEN
    v_debt := public.declutter_consume_fee_debt(t.helpr_id, 'helpr_task_' || t.id::text,
      greatest(0, v_amount - COALESCE(t.raised_cents, 0) - 100));
  END IF;
  v_amount := v_amount - v_debt;
  INSERT INTO public.helpr_task_payouts (task_id, helpr_id, pay_cents, fee_cents, debt_cents, amount_cents, status)
  VALUES (t.id, t.helpr_id, t.pay_cents, t.fee_cents, v_debt, v_amount,
          CASE WHEN v_amount = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (task_id) DO NOTHING
  RETURNING id INTO v_payout;
  PERFORM public.helpr_task_log(t.id, 'confirmed', p_actor, p_by);
  PERFORM public.declutter_notify(t.helpr_id, 'payment', 'Delivery done',
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL)
         THEN format('"%s" is delivered. Set up payouts in Settings to get your $%s. We send it as soon as you do.',
                     t.title, to_char(v_amount / 100.0, 'FM999990.00'))
         ELSE format('"%s" is delivered. $%s is on its way to your payout account.', t.title, to_char(v_amount / 100.0, 'FM999990.00')) END,
    '/declutter?tab=deliver', t.customer_id);
  RETURN jsonb_build_object('result', 'confirmed', 'helpr_payout_id', v_payout, 'by', p_by);
END;
$function$
;

REVOKE ALL ON FUNCTION public.helpr_task_confirm(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_confirm(uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_customer_confirm(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000', HINT = 'The Helpr has not picked the item up yet.';
  END IF;
  -- CHANGED (BUY-36): the item is on its way back, so there is nothing to confirm.
  IF t.stuck_stage IN ('returning', 'returned', 'awaiting_choice') THEN
    RAISE EXCEPTION 'item_going_back' USING ERRCODE = '55000', HINT = 'This item is going back to the seller.';
  END IF;
  -- BUY-39: on the road is not "I got it". From the drop-off, or after 24 h in the Helpr's hands.
  -- CHANGED (BUY-36): except when the buyer collected it from a Helpr at fault (below).
  IF t.status = 'picked_up' AND t.stuck_stage IS DISTINCT FROM 'collecting'
     AND (t.picked_up_at IS NULL OR t.picked_up_at > now() - interval '24 hours') THEN
    RAISE EXCEPTION 'delivery_on_the_way' USING ERRCODE = '55000', HINT = 'The Helpr is bringing it. Tap I got it once it is dropped off.';
  END IF;
  -- CHANGED (BUY-36): the buyer collected it from a Helpr at fault: the sale goes ahead, the Helpr is unpaid, the delivery fee goes back.
  IF t.stuck_stage = 'collecting' THEN
    IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
      RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
        HINT = 'A problem was reported. Our team decides before anyone is paid.';
    END IF;
    UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'The buyer collected it from the Helpr', updated_at = now() WHERE id = t.id;
    PERFORM public.helpr_task_log(t.id, 'failed', v_uid, 'helpr fault: buyer collected');
    IF t.source_kind = 'shop_delivery' THEN
      PERFORM public.shop_delivery_refund(t.source_id, 'delivery_not_done');
    ELSE
      PERFORM public.declutter_delivery_refund(t.source_id, 'delivery_not_done');
    END IF;
    PERFORM public.declutter_notify(t.helpr_id, 'warning', 'Delivery closed',
      format('The buyer has "%s". You are not paid for this delivery.', t.title), '/declutter?tab=deliver', NULL);
  END IF;
  RETURN public.helpr_task_source_event(t.id, 'confirmed', 'customer');
END;
$function$
;

REVOKE ALL ON FUNCTION public.helpr_task_customer_confirm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_customer_confirm(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  t public.helpr_tasks;
  v_unfilled integer := 0;
  v_noshow integer := 0;
  v_auto integer := 0;
  v_in_hand integer := 0;
  v_stuck integer := 0;
  v_o public.declutter_orders;
  a record;
  v_no_answer integer := 0;
BEGIN
  -- NEW (soldstates-5): the seller said the Helpr didn't come and the Helpr didn't answer in 24 hours. A strike, and a
  -- task still booked goes back up for another Helpr. The buyer's money is not refunded: the delivery goes on. An open
  -- problem on the order means Louisiana Helpr already has it: nothing here.
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.seller_no_show_answer_by <= now() AND x.seller_no_show_answered_at IS NULL
              AND x.seller_no_show_settled_at IS NULL ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.seller_no_show_answer_by <= now() AND t.seller_no_show_answered_at IS NULL AND t.seller_no_show_settled_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = t.source_id AND p.status = 'open')
         AND NOT (t.source_kind = 'shop_delivery' AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = t.source_id AND h.problem_at IS NOT NULL)) THEN
        UPDATE public.helpr_tasks SET seller_no_show_settled_at = now(), updated_at = now() WHERE id = t.id;
        -- Review #4: only a Helpr still booked for it (picked up, cancelled or closed since: no strike).
        IF t.status = 'accepted' THEN
          PERFORM public.helpr_task_give_job_strike(t.helpr_id, 'delivery_no_show', t.id,
            'The seller said you didn''t come for a Helpr delivery pickup, and you didn''t answer within 24 hours');
          -- helpr_task_reopen clears the report, so the next Helpr starts clean (review #3).
          PERFORM public.helpr_task_reopen(t.id, 'helpr_no_show', t.helpr_id, 'the seller said the Helpr did not come; no answer in 24 h');
        END IF;
        v_no_answer := v_no_answer + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x WHERE x.status = 'open' AND x.open_until <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      -- An open problem freezes the task: the admin decides the money, never
      -- this sweep (lh-money-escrow re-review #1, 2026-10-16: the late
      -- fall-through close would otherwise refund under the no-fault rule and
      -- leave the problem undecidable).
      IF t.status = 'open' AND t.open_until <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_close(t.id, 'unfilled', 'No Helpr took it in time');
        PERFORM public.helpr_task_source_event(t.id, 'unfilled', NULL);
        v_unfilled := v_unfilled + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'accepted' AND x.pickup_slot_start + interval '2 hours' <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      -- A problem on the source (e.g. the Helpr's "the seller wasn't there")
      -- freezes the task: an admin decides, the Helpr is not a no-show.
      IF t.status = 'accepted' AND t.pickup_slot_start + interval '2 hours' <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_reopen(t.id, 'helpr_no_show', t.helpr_id, 'not picked up 2 h after the pickup time');
        PERFORM public.helpr_task_give_job_strike(t.helpr_id, 'delivery_no_show', t.id,
          'Did not pick up a Helpr delivery within 2 hours of the pickup time');
        v_noshow := v_noshow + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'delivered' AND x.delivered_at + interval '24 hours' <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.status = 'delivered' AND t.delivered_at + interval '24 hours' <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_source_event(t.id, 'confirmed', 'auto');
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- BUY-37: picked up, never marked delivered, nobody has said anything. Nudged 24 hours after the pickup, then weekly.
  -- No money moves and no strike: the money stays held (owner 10-30, "Nobody taps at all: hold the money"). An open
  -- problem means an admin already has it. Test data reaches nobody.
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'picked_up' AND x.picked_up_at + interval '24 hours' <= now()
              AND x.stuck_stage IS NULL
              AND (x.in_hand_nudged_at IS NULL OR x.in_hand_nudged_at + interval '7 days' <= now())
              AND NOT public.helpr_task_source_held(x.source_kind, x.source_id)
              AND x.is_seed IS NOT TRUE
              AND NOT EXISTS (SELECT 1 FROM public.test_accounts ta WHERE ta.user_id IN (x.customer_id, x.pickup_contact_id, x.helpr_id))
              AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id IN (x.customer_id, x.pickup_contact_id, x.helpr_id) AND pr.is_seed)
            ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.status = 'picked_up' AND t.picked_up_at + interval '24 hours' <= now()
         AND (t.in_hand_nudged_at IS NULL OR t.in_hand_nudged_at + interval '7 days' <= now())
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        UPDATE public.helpr_tasks SET in_hand_nudged_at = now() WHERE id = t.id;
        PERFORM public.helpr_task_source_event(t.id, 'still_in_hand', NULL);
        v_in_hand := v_in_hand + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- BUY-36: the clocks on a delivery the Helpr can't finish. A problem freezes them all: an admin decides.
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'picked_up'
              AND ((x.stuck_stage = 'waiting_fix' AND x.stuck_fix_by <= now())
                OR (x.stuck_stage = 'returned' AND x.return_answer_by <= now())
                OR (x.stuck_stage IN ('returning', 'collecting') AND x.stuck_return_by <= now())
                OR (x.stuck_stage = 'awaiting_choice' AND x.stuck_choice_by <= now()))
              AND NOT public.helpr_task_source_held(x.source_kind, x.source_id)
            ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      CONTINUE WHEN t.status <> 'picked_up' OR public.helpr_task_source_held(t.source_kind, t.source_id);
      IF t.stuck_stage = 'waiting_fix' AND t.stuck_fix_by <= now() THEN
        -- Not fixed in 24 hours: as a failed retry.
        UPDATE public.helpr_tasks SET stuck_stage = 'returning', stuck_return_by = now() + interval '48 hours', updated_at = now() WHERE id = t.id;
        PERFORM public.declutter_notify(t.helpr_id, 'info', 'Take it back to the seller',
          format('The buyer didn''t fix the delivery of "%s". Take it back to the seller within 48 hours, and you''re paid for the trip.', t.title),
          '/declutter?tab=deliver', t.customer_id);
        PERFORM public.declutter_notify(t.customer_id, 'declutter_pickups', 'The delivery couldn''t be finished',
          format('"%s" goes back to the seller and the sale is cancelled. You get back what you paid, less what the delivery cost, which pays the Helpr for the trip, and less the card fee.', t.title),
          '/declutter?tab=buying', t.helpr_id);
        PERFORM public.declutter_notify(t.pickup_contact_id, 'declutter_sales', 'Your item is coming back',
          format('The Helpr couldn''t leave "%s" and brings it back within 48 hours. Confirm in Selling when you have it.', t.title),
          '/declutter?tab=selling', t.helpr_id);
        v_stuck := v_stuck + 1;
      ELSIF t.stuck_stage = 'returned' AND t.return_answer_by <= now() THEN
        PERFORM public.declutter_delivery_return_finish(t.id);
        v_stuck := v_stuck + 1;
      ELSIF (t.stuck_stage IN ('returning', 'collecting') AND t.stuck_return_by <= now())
         OR (t.stuck_stage = 'awaiting_choice' AND t.stuck_choice_by <= now()) THEN
        -- Nobody finished it: Louisiana Helpr decides, the money held, and no second strike.
        SELECT * INTO v_o FROM public.declutter_orders WHERE id = t.source_id;
        INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
        VALUES (t.source_id, t.helpr_id, 'helpr', 'other',
                CASE WHEN t.stuck_stage = 'awaiting_choice' THEN 'The item is back with the seller, and the buyer hasn''t chosen a refund or re-posting in 48 hours.'
                     WHEN t.stuck_stage = 'collecting' THEN 'The buyer was going to collect the item from the Helpr, and 48 hours have passed without it being confirmed.'
                     ELSE 'The Helpr reported they couldn''t finish, and hasn''t brought the item back to the seller in 48 hours.' END,
                '{}');
        PERFORM public.declutter_notify(t.customer_id, 'declutter_pickups', 'Louisiana Helpr is looking at this delivery',
          format('About "%s". The money stays held until it decides.', t.title), '/declutter?tab=buying', t.helpr_id);
        PERFORM public.declutter_notify(t.pickup_contact_id, 'declutter_sales', 'Louisiana Helpr is looking at this delivery',
          format('About "%s". The money stays held until it decides.', t.title), '/declutter?tab=selling', t.helpr_id);
        PERFORM public.declutter_notify(t.helpr_id, 'warning', 'Louisiana Helpr is looking at this delivery',
          format('About "%s". It decides what happens next.', t.title), '/declutter?tab=deliver', NULL);
        -- A cron has no caller for the gate to read, so test data is skipped here too (20261030150104's rule).
        IF NOT (t.is_seed OR public.is_test_subject(t.customer_id) OR public.is_test_subject(t.pickup_contact_id) OR public.is_test_subject(t.helpr_id)) THEN
          FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
            PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter delivery stuck',
              'A delivery a Helpr couldn''t finish has stalled. The money is held until you decide it.', '/admin');
          END LOOP;
        END IF;
        v_stuck := v_stuck + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('unfilled', v_unfilled, 'helpr_no_show', v_noshow, 'auto_confirmed', v_auto,
                            'still_in_hand_nudged', v_in_hand, 'seller_report_unanswered', v_no_answer,
                            'stuck_steps', v_stuck);
END;
$function$
;

REVOKE ALL ON FUNCTION public.helpr_task_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.refund_agreements_due(p_limit integer DEFAULT 20)
 RETURNS TABLE(request_id uuid, dispute_id uuid, job_id uuid, held boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_status text;
  v_title text;
BEGIN
  FOR v_row IN
    SELECT r.id, r.job_id, r.dispute_id, r.refund_scope, r.requester_id, r.answered_by
      FROM public.refund_requests r
      JOIN public.disputes d ON d.id = r.dispute_id
     WHERE r.status = 'agreed'
       AND d.status = 'decided'
       AND d.decided_via = 'agreement'
       AND d.execution_status IN ('pending', 'failed')
       AND r.settle_attempts < 3
       AND (r.last_settle_at IS NULL OR r.last_settle_at < now() - interval '30 minutes')
     ORDER BY r.answered_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
  LOOP
    -- Lock order jobs -> refund_requests; SKIP LOCKED so two sweeps never
    -- hand out the same agreement. The job's status is read under the lock.
    SELECT j.status::text, j.title INTO v_status, v_title
      FROM public.jobs j
     WHERE j.id = v_row.job_id
       FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    UPDATE public.refund_requests r
       SET settle_attempts = r.settle_attempts + 1, last_settle_at = now()
     WHERE r.id = v_row.id
       AND r.status = 'agreed'
       AND r.settle_attempts < 3
       AND (r.last_settle_at IS NULL OR r.last_settle_at < now() - interval '30 minutes');
    CONTINUE WHEN NOT FOUND;

    IF v_status IN ('accepted', 'in_progress', 'revision_requested') THEN
      UPDATE public.jobs
         SET status = (CASE WHEN v_row.refund_scope = 'all' THEN 'cancelled' ELSE 'completed' END)::public.job_status,
             dispute_resolved_at = now(),
             dispute_status = 'resolved'
       WHERE id = v_row.job_id
         AND status::text IN ('accepted', 'in_progress', 'revision_requested');
    END IF;

    request_id := v_row.id;
    dispute_id := v_row.dispute_id;
    job_id := v_row.job_id;
    held := false;
    -- No money moves automatically for a party who is banned, suspended,
    -- under a ban review or on a payout hold (lead, 2026-10-21). The decided
    -- dispute goes to an admin instead, as any unsettled decision does: it is
    -- marked failed with REFUND_AGREEMENT_HELD_ERROR (the admin queue lists it
    -- UNSETTLED; auto-resolve-disputes sets it aside rather than paging every
    -- run), it is never handed out again, and the sweep pages ops once.
    -- Only an untouched decision is marked (lh-money-escrow review,
    -- 2026-10-21): one an earlier attempt already started keeps its own error,
    -- so a half-moved split stays in the stuck set auto-resolve-disputes pages
    -- for, never hidden behind the held marker.
    IF public.refund_party_held(v_row.requester_id) OR public.refund_party_held(v_row.answered_by) THEN
      UPDATE public.disputes d
         SET execution_status = 'failed',
             execution_error = 'refund agreement held for admin review: a party is banned, suspended, under a ban review or on a payout hold'
       WHERE d.id = v_row.dispute_id
         AND d.status = 'decided'
         AND d.execution_status = 'pending'
         AND d.execution_started_at IS NULL
         AND d.execution_refund_id IS NULL
         AND d.execution_transfer_id IS NULL;
      UPDATE public.refund_requests r SET settle_attempts = 3 WHERE r.id = v_row.id;
      held := true;
      -- Both told it now waits on a person, not "on its way".
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      SELECT u.user_id, v_row.job_id,
             'Your refund is waiting on Helpr',
             format('The refund you agreed on "%s" needs our team to finish it. The payment stays on hold until then.',
                    COALESCE(v_title, 'the job')),
             'payment',
             u.link || v_row.job_id::text
        FROM (VALUES (v_row.requester_id, '/posts?job='), (v_row.answered_by, '/jobs?job=')) AS u(user_id, link)
       WHERE u.user_id IS NOT NULL;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$function$
;

REVOKE ALL ON FUNCTION public.refund_agreements_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_agreements_due(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.refund_requests_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_req record;
  v_job record;
  v_dispute uuid;
  v_helpr text;
  v_closed integer := 0;
  v_expired integer := 0;
  v_declined integer := 0;
  v_back integer := 0;
  v_failed integer := 0;
  v_errors text[] := ARRAY[]::text[];
  v_sc record;
BEGIN
  FOR v_id IN
    SELECT r.id FROM public.refund_requests r
     WHERE r.status IN ('open', 'finish_offered', 'coming_back')
        OR (r.status = 'declined' AND r.dispute_id IS NULL)
     ORDER BY r.answer_by
     LIMIT 500
  LOOP
    BEGIN
      SELECT j.id, j.title, j.helper_id, j.customer_id, j.status::text AS status INTO v_job
        FROM public.jobs j
       WHERE j.id = (SELECT r.job_id FROM public.refund_requests r WHERE r.id = v_id)
       FOR UPDATE;
      SELECT r.* INTO v_req FROM public.refund_requests r WHERE r.id = v_id FOR UPDATE;
      CONTINUE WHEN v_req.id IS NULL
                 OR NOT (v_req.status IN ('open', 'finish_offered', 'coming_back')
                         OR (v_req.status = 'declined' AND v_req.dispute_id IS NULL));

      -- Q2326, "Come back and finish" ACCEPTED ('coming_back', or an accepted
      -- time the answer did not hand over). Handled FIRST, before any exit
      -- below (lh-money-escrow review, 2026-10-21): a dispute opened or the
      -- job moved between the accept and this pass must not leave the earlier
      -- "done" stamps standing, or a withdrawn dispute would make the payout
      -- due at once on them. Clears both done stamps (server context: the only
      -- one enforce_completion_on_live_job lets clear the Helpr's), so no
      -- payout clock runs until the work is marked done again, which
      -- refuse_done_before_come_back holds until the agreed time. Then closes.
      IF v_req.status = 'finish_offered' THEN
        SELECT sc.status, sc.expires_at INTO v_sc
          FROM public.job_schedule_change_requests sc
         WHERE sc.id = v_req.schedule_change_id
           FOR UPDATE;
        IF v_sc.status = 'accepted' THEN
          v_req.status := 'coming_back';
        END IF;
      END IF;
      IF v_req.status = 'coming_back' THEN
        UPDATE public.jobs
           SET helper_completed_at = NULL, poster_completed_at = NULL
         WHERE id = v_req.job_id
           AND status::text IN ('accepted', 'in_progress', 'revision_requested', 'disputed')
           AND (helper_completed_at IS NOT NULL OR poster_completed_at IS NOT NULL);
        UPDATE public.refund_requests
           SET status = 'closed', closed_reason = 'coming_back'
         WHERE id = v_id;
        v_back := v_back + 1;
        CONTINUE;
      END IF;

      -- Nobody left to file for: close, never a platform filing.
      IF v_req.requester_id IS NULL OR v_req.requester_id IS DISTINCT FROM v_job.customer_id THEN
        UPDATE public.refund_requests
           SET status = 'closed', closed_reason = 'refund_request_poster_gone'
         WHERE id = v_id;
        v_closed := v_closed + 1;
        CONTINUE;
      END IF;
      -- The Helpr asked is no longer the job's Helpr (lh-money-escrow review,
      -- #2): the request was theirs, never the new Helpr's to answer or pay for.
      IF v_req.responder_id IS DISTINCT FROM v_job.helper_id THEN
        UPDATE public.refund_requests
           SET status = 'closed', closed_reason = 'refund_request_helpr_changed'
         WHERE id = v_id;
        v_closed := v_closed + 1;
        CONTINUE;
      END IF;

      BEGIN
        PERFORM public.refund_request_assert_job_open(v_req.job_id);
      EXCEPTION WHEN raise_exception THEN
        UPDATE public.refund_requests
           SET status = 'closed', closed_reason = left(SQLERRM, 100)
         WHERE id = v_id;
        v_closed := v_closed + 1;
        CONTINUE;
      END;

      -- Q2326, a come-back offered and still waiting on the poster: nothing
      -- to do yet. Declined, replaced or lapsed: on to Helpr.
      IF v_req.status = 'finish_offered' THEN
        CONTINUE WHEN v_sc.status = 'pending' AND v_sc.expires_at > now();
        IF v_sc.status = 'pending' THEN
          UPDATE public.job_schedule_change_requests
             SET status = 'expired', decided_at = now()
           WHERE id = v_req.schedule_change_id;
        END IF;
        UPDATE public.refund_requests SET status = 'declined' WHERE id = v_id;
        v_req.status := 'declined';
      END IF;

      IF v_req.status = 'declined' THEN
        v_dispute := public.open_dispute_as(v_req.job_id, v_req.requester_id, v_req.reason, '{}'::text[]);
        UPDATE public.refund_requests SET dispute_id = v_dispute WHERE id = v_id;
        v_declined := v_declined + 1;
      ELSIF now() >= v_req.answer_by THEN
        v_dispute := public.open_dispute_as(v_req.job_id, v_req.requester_id, v_req.reason, '{}'::text[]);
        UPDATE public.refund_requests
           SET status = 'expired', dispute_id = v_dispute
         WHERE id = v_id;
        SELECT public.member_display_name(p.full_name, 'Your Helpr') INTO v_helpr
          FROM public.profiles p WHERE p.user_id = v_job.helper_id;
        IF v_req.requester_id IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
          VALUES (
            v_req.requester_id, v_req.job_id,
            'Your refund request goes to our team',
            format('%s didn''t answer within 2 days, so our team will decide the refund on "%s". The payment stays on hold until then.',
                   COALESCE(v_helpr, 'Your Helpr'), COALESCE(v_job.title, 'your job')),
            'payment',
            '/posts?job=' || v_req.job_id::text
          );
        END IF;
        v_expired := v_expired + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_errors := v_errors || (v_id::text || ': ' || left(SQLERRM, 200));
    END;
  END LOOP;
  RETURN jsonb_build_object('closed', v_closed, 'expired', v_expired, 'declined', v_declined, 'coming_back', v_back,
                            'failed', v_failed, 'errors', to_jsonb(v_errors));
END;
$function$
;

REVOKE ALL ON FUNCTION public.refund_requests_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_requests_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.respond_job_schedule_change(p_request_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
  v_job record;
  v_status text;
  v_reason text;
  v_refund_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  -- Job first, then the request: the same order request_job_schedule_change
  -- takes (job FOR UPDATE, then the pending row).
  SELECT r.job_id INTO v_req FROM public.job_schedule_change_requests r WHERE r.id = p_request_id;
  IF v_req.job_id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.date_needed, j.start_time,
         j.estimated_hours
    INTO v_job
    FROM public.jobs j
   WHERE j.id = v_req.job_id
   FOR UPDATE;
  SELECT r.* INTO v_req FROM public.job_schedule_change_requests r WHERE r.id = p_request_id FOR UPDATE;
  -- Q2326: the refund request this one answers ("Come back and finish"), if
  -- any. Locked after the job and this row (refund writers lock jobs ->
  -- refund_requests and never take a schedule-change row).
  SELECT rr.id INTO v_refund_id
    FROM public.refund_requests rr
   WHERE rr.schedule_change_id = p_request_id AND rr.status = 'finish_offered'
   FOR UPDATE;

  -- Only the party the request is addressed to, and only while they are still
  -- that party on the job.
  IF v_uid IS DISTINCT FROM v_req.responder_id
     OR v_uid IS DISTINCT FROM (CASE WHEN v_req.requested_by = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('status', v_req.status);
  END IF;

  -- Expired (unanswered by the original start), or the job moved on since it
  -- was asked: nothing changes. Q2326: a come-back offer is judged on a job
  -- under way too; lapsed or moved on, its refund request goes on to Helpr.
  IF now() >= v_req.expires_at
     OR (v_job.status::text <> 'accepted' AND NOT (v_refund_id IS NOT NULL AND v_job.status::text = 'in_progress'))
     OR v_job.date_needed IS DISTINCT FROM v_req.old_date
     OR v_job.start_time IS DISTINCT FROM v_req.old_start_time THEN
    UPDATE public.job_schedule_change_requests SET status = 'expired', decided_at = now() WHERE id = v_req.id;
    IF v_refund_id IS NOT NULL THEN
      -- A come-back offer that lapsed or whose job moved on: its refund
      -- request goes on to Helpr. Said as that, never as "the original start
      -- arrived" (lh-authz-rls review, 2026-10-21); the sweep files it.
      UPDATE public.refund_requests SET status = 'declined' WHERE id = v_refund_id;
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (
        v_req.requested_by, v_job.id,
        'Offer to come back not answered in time',
        format('Your offer to come back and finish "%s" was not accepted in time, so our team will decide the refund.',
               COALESCE(v_job.title, 'the job')),
        'job_updates',
        '/jobs?job=' || v_job.id::text
      );
      RETURN jsonb_build_object('status', 'expired', 'reason', 'come_back_lapsed');
    END IF;
    v_reason := CASE WHEN now() >= v_req.expires_at THEN 'job_started' ELSE 'job_changed' END;
    PERFORM public.notify_schedule_change_expired(v_req.id, v_reason);
    RETURN jsonb_build_object('status', 'expired', 'reason', v_reason);
  END IF;

  IF p_accept THEN
    -- The new start must still be ahead.
    IF ((v_req.new_date + COALESCE(v_req.new_start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago') <= now() THEN
      UPDATE public.job_schedule_change_requests SET status = 'expired', decided_at = now() WHERE id = v_req.id;
      PERFORM public.notify_schedule_change_expired(v_req.id, 'new_time_passed');
      IF v_refund_id IS NOT NULL THEN
        UPDATE public.refund_requests SET status = 'declined' WHERE id = v_refund_id;
      END IF;
      RETURN jsonb_build_object('status', 'expired', 'reason', 'new_time_passed');
    END IF;

    -- Q925: the same clash check request_job_schedule_change runs, again at
    -- accept time. The request-time check is an unlocked read, and the Helpr
    -- can have been hired elsewhere in the days the request sat pending, so
    -- accepting could double-book them. Runs under the subject job's FOR
    -- UPDATE above and takes FOR SHARE on the overlapping bookings, so a
    -- cancel or completion of one waits for this accept instead of racing it.
    -- Q1262(2): a clash DECLINES the request (it can never be accepted while
    -- the Helpr is booked then) and tells whoever asked, instead of rolling
    -- back and leaving it pending with nobody told.
    -- A time-less new start ("any time that day") is flexible and never clashes.
    -- Two requests on two DIFFERENT jobs of the same Helpr, accepted at the same
    -- moment, each lock only their own job and would both pass the check (write
    -- skew; lh-authz-rls review 2026-10-04): one advisory lock per Helpr makes
    -- those accepts take turns, so the second sees the first's new slot.
    IF v_req.new_start_time IS NOT NULL THEN
      IF v_job.helper_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' || v_job.helper_id::text));
      END IF;
      PERFORM 1
        FROM public.jobs o
       WHERE o.id <> v_job.id
         AND o.date_needed = v_req.new_date
         AND o.start_time IS NOT NULL
         -- Q1676: the same booking rule as helpr_booking_clashes (see above).
         AND ((o.helper_id = v_job.helper_id
               AND o.status::text IN ('accepted', 'in_progress')
               AND o.helper_completed_at IS NULL)
              OR (o.status::text IN ('open', 'accepted', 'in_progress')
                  AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                               WHERE g.job_id = o.id AND g.helper_id = v_job.helper_id
                                 AND g.status = 'accepted'
                                 AND g.helper_completed_at IS NULL)))
         AND (v_req.new_date + v_req.new_start_time, v_req.new_date + v_req.new_start_time + make_interval(mins => round(COALESCE(v_job.estimated_hours, 1) * 60)::int))
             OVERLAPS
             (o.date_needed + o.start_time, o.date_needed + o.start_time + make_interval(mins => round(COALESCE(o.estimated_hours, 1) * 60)::int))
         FOR SHARE OF o;
      IF FOUND THEN
        UPDATE public.job_schedule_change_requests SET status = 'declined', decided_at = now() WHERE id = v_req.id;
        INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
        VALUES (
          v_req.requested_by, v_job.id,
          'New date or time not possible',
          format('"%s" stays on %s%s: the Helpr is already booked at the new time.', COALESCE(v_job.title, 'Your job'),
                 to_char(v_req.old_date, 'FMDy FMMon FMDD'),
                 CASE WHEN v_req.old_start_time IS NULL THEN '' ELSE ' at ' || to_char(v_req.old_start_time, 'FMHH12:MI AM') END),
          'job_updates',
          CASE WHEN v_req.requested_by = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
        );
        IF v_refund_id IS NOT NULL THEN
          UPDATE public.refund_requests SET status = 'declined' WHERE id = v_refund_id;
        END IF;
        RETURN jsonb_build_object('status', 'declined', 'reason', 'schedule_change_clash');
      END IF;
    END IF;

    PERFORM set_config('app.schedule_change_rpc', '1', true);
    UPDATE public.jobs
       SET date_needed = v_req.new_date,
           start_time = v_req.new_start_time,
           -- The day-of machinery runs fresh for the new day (as a reopened
           -- job does, helper_cancel_booking).
           dayof_confirm_reminder_sent_at = NULL,
           dayof_unanswered_poster_alert_sent_at = NULL,
           start_reminder_sent_at = NULL
     WHERE id = v_job.id;
    PERFORM set_config('app.schedule_change_rpc', '0', true);
    -- Q2326: coming back to finish. The request turns 'coming_back', which
    -- still holds every payout; refund_requests_sweep (a server context, the
    -- only one enforce_completion_on_live_job lets clear a "done" stamp) then
    -- clears the Helpr's earlier "done", so no payout clock runs until they
    -- mark it done again, and closes the request: nothing was refunded.
    IF v_refund_id IS NOT NULL THEN
      UPDATE public.refund_requests SET status = 'coming_back' WHERE id = v_refund_id;
    END IF;
    v_status := 'accepted';
  ELSE
    v_status := 'declined';
    -- Q2326: the poster declined the come-back time: the refund request goes
    -- on to Helpr (a normal dispute, filed by refund_requests_sweep).
    IF v_refund_id IS NOT NULL THEN
      UPDATE public.refund_requests SET status = 'declined' WHERE id = v_refund_id;
    END IF;
  END IF;

  UPDATE public.job_schedule_change_requests SET status = v_status, decided_at = now() WHERE id = v_req.id;

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_req.requested_by, v_job.id,
    CASE WHEN v_status = 'accepted' THEN 'New date or time accepted' ELSE 'New date or time declined' END,
    CASE WHEN v_status = 'accepted'
         THEN format('"%s" is now on %s%s.', COALESCE(v_job.title, 'Your job'),
                     to_char(v_req.new_date, 'FMDy FMMon FMDD'),
                     CASE WHEN v_req.new_start_time IS NULL THEN '' ELSE ' at ' || to_char(v_req.new_start_time, 'FMHH12:MI AM') END)
         WHEN v_refund_id IS NOT NULL
         THEN format('The new time to finish "%s" was declined, so our team will decide the refund.', COALESCE(v_job.title, 'your job'))
         ELSE format('"%s" stays on %s%s. The usual cancellation rules apply if either of you cancels.', COALESCE(v_job.title, 'Your job'),
                     to_char(v_req.old_date, 'FMDy FMMon FMDD'),
                     CASE WHEN v_req.old_start_time IS NULL THEN '' ELSE ' at ' || to_char(v_req.old_start_time, 'FMHH12:MI AM') END)
    END,
    'job_updates',
    CASE WHEN v_req.requested_by = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
  );

  RETURN jsonb_build_object('status', v_status,
                            'reason', CASE WHEN v_status = 'declined' AND v_refund_id IS NOT NULL THEN 'refund_escalated' END);
END;
$function$
;

REVOKE ALL ON FUNCTION public.respond_job_schedule_change(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_job_schedule_change(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_open_refund_request(
  p_job_id uuid,
  p_scope text,
  p_amount_cents integer,
  p_reason text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_budget integer;
  v_amount integer;
  v_reason text;
  v_asked integer;
  v_id uuid;
  v_poster text;
BEGIN
  PERFORM public.require_feature('refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_job_id IS NULL OR p_scope IS NULL OR p_scope NOT IN ('part', 'all') THEN
    RAISE EXCEPTION 'refund_request_invalid';
  END IF;

  -- Lock order jobs -> refund_requests (as every refund-request writer).
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.budget
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'refund_request_job_not_found';
  END IF;
  -- Only the person who posted (and paid for) this job asks.
  IF v_uid IS DISTINCT FROM v_job.customer_id THEN
    RAISE EXCEPTION 'refund_request_not_poster' USING ERRCODE = '42501';
  END IF;
  PERFORM public.refund_request_assert_job_open(p_job_id);
  -- The Helpr must have the switch too (lh-authz-rls review): a Helpr it is
  -- off for cannot see or answer a request, so it would only freeze their pay
  -- and file a dispute against them two days later.
  IF NOT COALESCE(public.feature_enabled_for_user('refund_requests', v_job.helper_id), false) THEN
    RAISE EXCEPTION 'refund_request_helpr_not_enabled' USING ERRCODE = '42501';
  END IF;

  -- One LIVE request per job, not just one 'open' one (both reviews,
  -- 2026-10-21): a come-back offered or accepted, a decline not yet filed and
  -- an agreement not yet settled all still hold the money for the first ask.
  IF EXISTS (SELECT 1 FROM public.refund_requests r
              WHERE r.job_id = p_job_id
                AND public.refund_request_is_live(r.status, r.dispute_id)) THEN
    RAISE EXCEPTION 'refund_request_already_open';
  END IF;
  SELECT count(*) INTO v_asked FROM public.refund_requests r WHERE r.job_id = p_job_id;
  IF v_asked >= 3 THEN
    RAISE EXCEPTION 'refund_request_limit';
  END IF;

  -- THE AMOUNT IS THE SERVER'S. The price is read from the job here; 'all' is
  -- the whole price whatever the client sent; 'part' must be at least $1 and
  -- less than the price. The shares the split moves are derived from these
  -- two stored figures when the Helpr agrees.
  v_budget := round(COALESCE(v_job.budget, 0) * 100)::integer;
  IF v_budget <= 0 THEN
    RAISE EXCEPTION 'refund_request_no_price';
  END IF;
  IF p_scope = 'all' THEN
    v_amount := v_budget;
  ELSE
    IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents >= v_budget THEN
      RAISE EXCEPTION 'refund_request_amount_invalid';
    END IF;
    v_amount := p_amount_cents;
  END IF;

  v_reason := btrim(COALESCE(p_reason, ''));
  IF char_length(v_reason) < 15 THEN
    RAISE EXCEPTION 'refund_request_needs_reason';
  END IF;
  IF char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'refund_request_reason_too_long';
  END IF;

  INSERT INTO public.refund_requests
    (job_id, requester_id, responder_id, refund_scope, amount_cents, budget_cents, reason, answer_by)
  VALUES
    (p_job_id, v_uid, v_job.helper_id, p_scope, v_amount, v_budget, v_reason, now() + interval '2 days')
  RETURNING id INTO v_id;

  SELECT public.member_display_name(p.full_name, 'The person who posted it') INTO v_poster
    FROM public.profiles p WHERE p.user_id = v_uid;
  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_job.helper_id, p_job_id,
    'Refund request',
    format('%s asked for %s back on "%s". Answer within 2 days, or our team decides.',
           COALESCE(v_poster, 'The person who posted it'),
           public.refund_request_dollars(v_amount),
           COALESCE(v_job.title, 'your job')),
    'payment',
    '/jobs?job=' || p_job_id::text
  );

  RETURN v_id;
END;
$function$
;

REVOKE ALL ON FUNCTION public.rpc_open_refund_request(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_open_refund_request(uuid, text, integer, text) TO authenticated, service_role;

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
  PERFORM public.declutter_notify(o.seller_id, 'payment', CASE WHEN o.is_digital THEN 'Download sale final' WHEN p_how = 'buyer' THEN 'Order picked up' ELSE 'Order finished' END,
    CASE
      WHEN (o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt = 0 THEN
        format('This order paid off the $%s card fee you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format('Set up payouts in Settings to get your $%s. We send it as soon as you do.', to_char(((o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt) / 100.0, 'FM999990.00'))
      WHEN v_debt > 0 THEN
        format('$%s is on its way to your payout account ($%s card fee you owed was taken out).',
               to_char(((o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt) / 100.0, 'FM999990.00'), to_char(v_debt / 100.0, 'FM999990.00'))
      ELSE format('$%s is on its way to your payout account.', to_char(((o.items_cents + CASE WHEN o.fulfillment = 'shop_delivers' THEN o.delivery_cents ELSE 0 END) - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/shops/dashboard', o.buyer_id);
  -- CHANGED (digital): the buyer already has the download (told at the charge); nothing more to say.
  IF o.is_digital THEN
    RETURN jsonb_build_object('result', 'handed_over', 'order_id', o.id, 'payout_id', v_payout, 'by', p_how);
  END IF;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', CASE WHEN p_how = 'buyer' THEN 'Enjoy your order' ELSE 'Order finished' END,
    CASE p_how
      WHEN 'buyer' THEN 'The pickup is done and the order is final. Thank you for buying local.'
      -- H5: the clock only runs after the shop said it was handed over (or left out with a photo).
      WHEN 'auto' THEN 'Nobody reported a problem in the 48 hours after the shop said your order was handed over, so the order is final and the shop is paid.'
      ELSE 'Louisiana Helpr finished this order, and the shop is paid.'
    END,
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'handed_over', 'order_id', o.id, 'payout_id', v_payout, 'by', p_how);
END;
$function$
;

REVOKE ALL ON FUNCTION public.shop_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_complete_handover(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.shop_handover_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  a record;
  v_auto integer := 0;
  v_nudged integer := 0;
  v_to_admin integer := 0;
  v_test boolean;
BEGIN
  -- (a) The shop said it is done and the buyer said nothing for 48 hours: the shop is paid. In person: the
  -- "Handed over" tap. Left out: the ready photo, counted from the later of the photo and the ready date's start.
  -- CHANGED (digital, owner 11-08): a download paid 72 hours ago with no problem reported is final and its shop is
  -- paid; a shop's "handed over" tap never shortens those 72 hours. A download has no handover row until it is
  -- finished, so the join is a LEFT JOIN (a made order still needs the shop's tap, which needs the row).
  FOR r IN
    SELECT o.id FROM public.shop_orders o
      LEFT JOIN public.shop_handovers h ON h.order_id = o.id
     WHERE o.status = 'accepted' AND o.captured_at IS NOT NULL
       AND h.problem_at IS NULL AND h.confirmed_at IS NULL
       AND ((NOT o.is_digital
             AND ((o.handover_mode = 'in_person' AND h.shop_confirmed_at IS NOT NULL
             AND h.shop_confirmed_at + interval '48 hours' <= now())
         OR (o.handover_mode = 'porch' AND h.ready_photo_path IS NOT NULL
             AND greatest(h.ready_at, (o.ready_date::timestamp AT TIME ZONE 'America/Chicago')) + interval '48 hours' <= now())))
         OR (o.is_digital AND o.captured_at + interval '72 hours' <= now()))
     ORDER BY o.ready_date, o.id LIMIT 200
  LOOP
    BEGIN
      -- shop_complete_handover re-reads the row under its lock and refuses an open problem.
      IF (public.shop_complete_handover(r.id, 'auto') ->> 'result') = 'handed_over' THEN
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; it is logged and retried next run.
      PERFORM public.log_cron_defect('shop_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (b) Nobody has said anything 24 hours after the ready date: the money stays held. Both sides are nudged, then
  -- weekly; at 60 days every admin is told once. No money moves here.
  FOR r IN
    SELECT o.id, o.buyer_id, o.seller_id, o.handover_mode, o.ready_date, o.is_seed,
           h.held_nudged_at, h.held_admin_at,
           ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') AS held_from
      FROM public.shop_orders o
      LEFT JOIN public.shop_handovers h ON h.order_id = o.id
     WHERE o.status = 'accepted' AND o.captured_at IS NOT NULL
       AND h.problem_at IS NULL AND h.confirmed_at IS NULL
       AND ((o.handover_mode = 'in_person' AND h.shop_confirmed_at IS NULL)
         OR (o.handover_mode = 'porch' AND h.ready_photo_path IS NULL))
       -- CHANGED (digital): nobody hands a download over, so nobody is nudged about it.
       AND NOT o.is_digital
       AND ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') + interval '24 hours' <= now()
       AND (h.held_nudged_at IS NULL OR h.held_nudged_at + interval '7 days' <= now()
            OR (h.held_admin_at IS NULL
                AND ((o.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') + interval '60 days' <= now()))
       -- Owner rule: test data never reaches a member or admin.
       AND o.is_seed IS NOT TRUE
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id IN (o.buyer_id, o.seller_id))
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id IN (o.buyer_id, o.seller_id) AND pr.is_seed)
     ORDER BY o.ready_date, o.id LIMIT 200
  LOOP
    BEGIN
      INSERT INTO public.shop_handovers (order_id) VALUES (r.id) ON CONFLICT (order_id) DO NOTHING;
      IF r.held_admin_at IS NULL AND r.held_from + interval '60 days' <= now() THEN
        -- H5 review note: like Declutter's system problem (20261102084222), the order gets an open problem, so it
        -- sits in admin > Shops orders' problems with the reason, and no tap pays or refunds it until an admin decides.
        UPDATE public.shop_handovers
           SET held_admin_at = now(), held_nudged_at = now(),
               problem_at = COALESCE(problem_at, now()),
               problem_note = COALESCE(problem_note,
                 'Nobody has said anything about this handover for 60 days, so the money is still held. Neither side confirmed it or reported a problem. Decide who gets the money.')
         WHERE order_id = r.id;
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until our team decides. You can add your side on the order.',
          '/shops/orders', r.seller_id);
        PERFORM public.declutter_notify(r.seller_id, 'payment', 'Louisiana Helpr is looking at this order',
          'Nobody has confirmed this handover for 60 days. The money stays held until our team decides. You can add your side on the order.',
          '/shops/dashboard', r.buyer_id);
        v_test := public.is_test_subject(r.buyer_id) OR public.is_test_subject(r.seller_id);
        IF NOT v_test THEN
          FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
            PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops order held 60 days',
              'Nobody has confirmed a paid Shops handover for 60 days. The money is held until you decide it: pay the shop or refund the buyer.', '/admin');
          END LOOP;
        END IF;
        v_to_admin := v_to_admin + 1;
      ELSE
        UPDATE public.shop_handovers SET held_nudged_at = now() WHERE order_id = r.id;
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Did you get your order?',
          'If you have it, tap "I got it" on the order in Shops. If not, report it there. Your money stays held until one of you says.',
          '/shops/orders', r.seller_id);
        PERFORM public.declutter_notify(r.seller_id, 'payment', 'Did the buyer get this order?',
          CASE WHEN r.handover_mode = 'porch'
            THEN 'If it''s out, take the ready photo on the order. You aren''t paid until one of you says.'
            ELSE 'If they have it, tap "Handed over" on the order. You aren''t paid until one of you says.' END,
          '/shops/dashboard', r.buyer_id);
        v_nudged := v_nudged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('auto_handed_over', v_auto, 'held_nudged', v_nudged, 'held_to_admin', v_to_admin);
END;
$function$
;

REVOKE ALL ON FUNCTION public.shop_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_handover_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.shop_lock_open_charged_order(p_order_id uuid, p_allow_problem boolean)
RETURNS public.shop_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.shop_orders;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF o.status IN ('handed_over') THEN
    RAISE EXCEPTION 'order_final' USING ERRCODE = '55000', HINT = 'This order was picked up and is final.';
  END IF;
  IF o.status <> 'accepted' THEN
    RAISE EXCEPTION 'order_not_open' USING ERRCODE = '55000', HINT = 'This order is already closed.';
  END IF;
  IF o.captured_at IS NULL THEN
    RAISE EXCEPTION 'order_not_charged_yet' USING ERRCODE = '55000',
      HINT = 'The card is still being charged. Try again in a few minutes.';
  END IF;
  -- A refund made by hand in Stripe stands on this order (section 13): nobody refunds or
  -- pays from it automatically; an admin decides through the held-for-review tools.
  IF public.shop_order_unaccounted_hand_refund(o.id) THEN
    RAISE EXCEPTION 'refunded_in_stripe' USING ERRCODE = '55000',
      HINT = 'This order was refunded in Stripe. Our team decides it.';
  END IF;
  -- CHANGED (digital, owner 11-08): a download is delivered the moment it is paid, so no member cancel, shop cancel or
  -- no-show refunds it. The only way back is a problem report (broken / not as described) that an admin decides; the
  -- admin's refund (shops_admin_refund_order) is the one caller that passes p_allow_problem = true.
  IF o.is_digital AND NOT COALESCE(p_allow_problem, false) THEN
    RAISE EXCEPTION 'digital_not_cancellable' USING ERRCODE = '55000',
      HINT = 'A download cannot be cancelled. If the file is broken or not as described, report a problem on the order.';
  END IF;
  IF NOT COALESCE(p_allow_problem, false)
     AND EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.problem_at IS NOT NULL) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this order. Our team decides it.';
  END IF;
  RETURN o;
END;
$function$
;

REVOKE ALL ON FUNCTION public.shop_lock_open_charged_order(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_lock_open_charged_order(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.shop_preorder_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  it record;
  c record;
  o public.shop_orders;
  r public.shop_refunds;
  v_now_local date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_met integer := 0;
  v_missed integer := 0;
  v_missed_refunds integer := 0;
  v_warned integer := 0;
  v_late_refunds integer := 0;
BEGIN
  -- Goal met (paid units only).
  FOR it IN
    SELECT i.id, i.title, i.owner_id, i.preorder_goal, i.preorder_ready_by FROM public.shop_items i
     WHERE i.preorder_goal IS NOT NULL AND i.preorder_goal_met_at IS NULL AND i.preorder_goal_missed_at IS NULL
       AND public.shop_preorder_units(i.id, true) >= i.preorder_goal
     ORDER BY i.id LIMIT 100
  LOOP
    BEGIN
      UPDATE public.shop_items SET preorder_goal_met_at = now()
       WHERE id = it.id AND preorder_goal_met_at IS NULL AND preorder_goal_missed_at IS NULL;
      IF NOT FOUND THEN CONTINUE; END IF;
      PERFORM public.declutter_notify(it.owner_id, 'payment', 'Preorder goal reached',
        format('"%s" reached its goal of %s. Make it by %s.', it.title, it.preorder_goal, to_char(it.preorder_ready_by, 'FMMonth FMDD')),
        '/shops/dashboard', NULL);
      FOR c IN
        SELECT so.id, so.buyer_id FROM public.shop_orders so
         WHERE so.preorder_item_id = it.id AND so.status = 'accepted' AND so.captured_at IS NOT NULL
      LOOP
        PERFORM public.declutter_notify(c.buyer_id, 'info', 'Your preorder is happening',
          format('"%s" reached its goal, so the shop is making it. It is ready by %s.', it.title, to_char(it.preorder_ready_by, 'FMMonth FMDD')),
          '/shops/orders', it.owner_id);
      END LOOP;
      v_met := v_met + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_preorder_sweep', it.id::text, 'goal met: ' || SQLERRM);
    END;
  END LOOP;

  -- Goal missed: the goal date has ended (Louisiana time) and the goal is not met.
  FOR it IN
    SELECT i.id, i.title, i.owner_id, i.preorder_goal, i.preorder_goal_by FROM public.shop_items i
     WHERE i.preorder_goal IS NOT NULL AND i.preorder_goal_met_at IS NULL AND i.preorder_goal_missed_at IS NULL
       AND i.preorder_goal_by < v_now_local
     ORDER BY i.id LIMIT 100
  LOOP
    BEGIN
      -- One last count under the item lock: a goal reached on its last day is met, not missed.
      PERFORM 1 FROM public.shop_items WHERE id = it.id FOR UPDATE;
      IF public.shop_preorder_units(it.id, true) >= it.preorder_goal THEN
        UPDATE public.shop_items SET preorder_goal_met_at = now() WHERE id = it.id AND preorder_goal_met_at IS NULL;
        CONTINUE;
      END IF;
      UPDATE public.shop_items SET preorder_goal_missed_at = now() WHERE id = it.id AND preorder_goal_missed_at IS NULL;
      PERFORM public.declutter_notify(it.owner_id, 'warning', 'Preorder goal not reached',
        format('"%s" did not reach %s by %s, so every buyer is refunded in full. You do not need to make it.',
               it.title, it.preorder_goal, to_char(it.preorder_goal_by, 'FMMonth FMDD')),
        '/shops/dashboard', NULL);
      v_missed := v_missed + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_preorder_sweep', it.id::text, 'goal missed: ' || SQLERRM);
    END;
  END LOOP;
  FOR c IN
    SELECT so.id FROM public.shop_orders so JOIN public.shop_items i ON i.id = so.preorder_item_id
     WHERE i.preorder_goal_missed_at IS NOT NULL AND so.status = 'accepted' AND so.captured_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = so.id AND h.problem_at IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.shop_refunds x WHERE x.order_id = so.id)
     ORDER BY so.id LIMIT 200
  LOOP
    BEGIN
      o := public.shop_lock_open_charged_order(c.id, false);
      UPDATE public.shop_orders SET status = 'refunded', close_reason = 'preorder_goal_missed', closed_at = now()
       WHERE id = o.id AND status = 'accepted';
      r := public.shop_write_refund(o.id, 'preorder_goal_missed', NULL);
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Preorder refunded',
        format('The preorder did not reach its goal, so all $%s is on its way back to your card. Card refunds usually show up in 5 to 10 business days.',
               to_char(r.refund_cents / 100.0, 'FM999999990.00')),
        '/shops/orders', o.seller_id);
      v_missed_refunds := v_missed_refunds + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_preorder_sweep', c.id::text, 'goal missed refund: ' || SQLERRM);
    END;
  END LOOP;

  -- Late warning: ready-by + 4 days has started, an open paid preorder is not marked ready.
  FOR it IN
    SELECT i.id, i.title, i.owner_id, i.preorder_ready_by FROM public.shop_items i
     WHERE i.preorder_ready_by IS NOT NULL AND i.preorder_late_warned_at IS NULL
       AND ((i.preorder_ready_by + 4)::timestamp AT TIME ZONE 'America/Chicago') <= now()
       AND EXISTS (SELECT 1 FROM public.shop_orders so
                    LEFT JOIN public.shop_handovers h ON h.order_id = so.id
                    WHERE so.preorder_item_id = i.id AND so.status = 'accepted' AND h.ready_at IS NULL)
     ORDER BY i.id LIMIT 100
  LOOP
    BEGIN
      UPDATE public.shop_items SET preorder_late_warned_at = now() WHERE id = it.id AND preorder_late_warned_at IS NULL;
      PERFORM public.declutter_notify(it.owner_id, 'warning', 'Preorder is late',
        format('"%s" was due by %s. Mark each order ready by %s, or those buyers are refunded automatically and the card fee on each refund comes out of your next payout.',
               it.title, to_char(it.preorder_ready_by, 'FMMonth FMDD'), to_char(it.preorder_ready_by + 7, 'FMMonth FMDD')),
        '/shops/dashboard', NULL);
      v_warned := v_warned + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_preorder_sweep', it.id::text, 'late warning: ' || SQLERRM);
    END;
  END LOOP;

  -- Late: 7 days after ready-by has ended, a paid preorder the shop never marked ready is refunded in full.
  FOR c IN
    SELECT so.id FROM public.shop_orders so JOIN public.shop_items i ON i.id = so.preorder_item_id
      LEFT JOIN public.shop_handovers h ON h.order_id = so.id
     WHERE so.status = 'accepted' AND so.captured_at IS NOT NULL AND h.ready_at IS NULL AND h.problem_at IS NULL
       AND ((so.ready_date + 8)::timestamp AT TIME ZONE 'America/Chicago') <= now()
       AND NOT EXISTS (SELECT 1 FROM public.shop_refunds x WHERE x.order_id = so.id)
     ORDER BY so.id LIMIT 200
  LOOP
    BEGIN
      o := public.shop_lock_open_charged_order(c.id, false);
      IF EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.ready_at IS NOT NULL) THEN
        CONTINUE;  -- marked ready since the scan
      END IF;
      UPDATE public.shop_orders SET status = 'refunded', close_reason = 'preorder_shop_late', closed_at = now()
       WHERE id = o.id AND status = 'accepted';
      r := public.shop_write_refund(o.id, 'preorder_shop_late', NULL);
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Preorder refunded',
        format('The shop did not have your preorder ready within 7 days of %s, so all $%s is on its way back to your card.',
               to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.refund_cents / 100.0, 'FM999999990.00')),
        '/shops/orders', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'warning', 'Preorder refunded',
        format('The preorder due by %s was not marked ready within 7 days, so the buyer was refunded in full. $%s the card company kept comes out of your next payout.',
               to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.card_fee_cents / 100.0, 'FM999990.00')),
        '/shops/dashboard', o.buyer_id);
      v_late_refunds := v_late_refunds + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_preorder_sweep', c.id::text, 'late refund: ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('goal_met', v_met, 'goal_missed', v_missed, 'goal_missed_refunds', v_missed_refunds,
                            'late_warned', v_warned, 'late_refunds', v_late_refunds);
END;
$function$
;

REVOKE ALL ON FUNCTION public.shop_preorder_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_preorder_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.shops_admin_refund_order(p_order_id uuid, p_reason text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders;
  r public.shop_refunds;
  v_note text := btrim(COALESCE(p_note, ''));
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('problem_shop_fault', 'problem_no_fault', 'problem_our_mistake', 'shop_removed') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  o := public.shop_lock_open_charged_order(p_order_id, true);
  UPDATE public.shop_orders SET status = 'refunded', close_reason = 'admin_refunded', closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  r := public.shop_write_refund(o.id, p_reason, v_note);
  IF p_reason = 'problem_shop_fault' THEN
    PERFORM public.shop_give_strike(o.seller_id, 'shop', 'problem_shop_fault', o.id);
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shops_admin_refund_order', 'shop_order', o.id::text,
          jsonb_build_object('reason', p_reason, 'note', v_note, 'refund_cents', r.refund_cents, 'refund_id', r.id));
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order refunded',
    format('Louisiana Helpr refunded your order for %s: $%s is on its way back to your card%s. Card refunds usually show up in 5 to 10 business days.',
           to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.refund_cents / 100.0, 'FM999999990.00'),
           CASE WHEN r.kept_cents > 0 THEN ', less the card fee' || CASE WHEN r.tax_kept_cents > 0 THEN ' and the sales tax on it' ELSE '' END ELSE '' END),
    '/shops/orders', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order refunded',
    format('Louisiana Helpr refunded the order for %s to the buyer, so it is not paid out.', to_char(o.ready_date, 'FMMonth FMDD'))
      || CASE WHEN r.fee_policy = 'full_shop_pays_fee'
              THEN format(' The $%s card fee comes out of your next payout.', to_char(r.card_fee_cents / 100.0, 'FM999990.00')) ELSE '' END
      || CASE WHEN p_reason = 'problem_shop_fault' THEN ' It counts as a Shops strike.' ELSE '' END,
    '/shops/dashboard', o.buyer_id);
  RETURN jsonb_build_object('result', 'refunded', 'order_id', o.id, 'refund_id', r.id, 'refund_cents', r.refund_cents);
END;
$function$
;

REVOKE ALL ON FUNCTION public.shops_admin_refund_order(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_refund_order(uuid, text, text) TO authenticated, service_role;

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
      HINT = 'The free-cancel time for this order has changed. Look again before cancelling.';
  END IF;
  -- 3. Recorded on the order before commit; Stripe runs after it.
  IF v_free THEN
    UPDATE public.shop_orders SET status = 'refunded', close_reason = 'buyer_cancelled_free', closed_at = now()
     WHERE id = o.id AND status = 'accepted';
    r := public.shop_write_refund(o.id, 'buyer_cancelled', NULL);
    PERFORM public.shop_return_stock(o.id);
    PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order cancelled',
      format('The buyer cancelled the order for %s inside your free-cancel time. Do not make it.', to_char(o.ready_date, 'FMMonth FMDD')),
      '/shops/dashboard', o.buyer_id);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order cancelled',
      format('$%s is on its way back to your card, less the card fee%s. Card refunds usually show up in 5 to 10 business days.',
             to_char(r.refund_cents / 100.0, 'FM999999990.00'),
             CASE WHEN r.tax_kept_cents > 0 THEN ' and the sales tax on it' ELSE '' END),
      '/shops/orders', o.seller_id);
    RETURN jsonb_build_object('result', 'cancelled_free', 'order_id', o.id, 'refund_id', r.id, 'refund_cents', r.refund_cents);
  END IF;
  UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late', closed_at = now()
   WHERE id = o.id AND status = 'accepted';
  v_owed := public.shop_owe_shop(o.id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Order cancelled late',
    format('The buyer cancelled the order for %s after your free-cancel time, so you are paid for it ($%s).',
           to_char(o.ready_date, 'FMMonth FMDD'), to_char(v_owed / 100.0, 'FM999999990.00')),
    '/shops/dashboard', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'info', 'Order cancelled',
    'You cancelled after the shop''s free-cancel time, so nothing is refunded and the shop is paid.',
    '/shops/orders', o.seller_id);
  RETURN jsonb_build_object('result', 'cancelled_late', 'order_id', o.id, 'refund_id', NULL, 'refund_cents', 0);
END;
$function$
;

REVOKE ALL ON FUNCTION public.shops_buyer_cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_buyer_cancel_order(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sweep_needs_you_reminders(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_sent integer := 0;
  v_rung smallint;
  v_day_start timestamptz := date_trunc('day', p_now AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago';
  v_by text;
  v_title text;
  v_body text;
BEGIN
  IF public.needs_you_reminder_quiet(p_now) THEN
    RETURN 0;
  END IF;

  FOR r IN
    -- An open offer: the side it waits on answers by respond_by.
    SELECT 'offer'::text AS step, o.id AS ref_id, o.respond_by AS deadline,
           CASE WHEN o.awaiting = 'seller' THEN o.seller_id ELSE o.buyer_id END AS to_id,
           CASE WHEN o.awaiting = 'seller' THEN o.buyer_id ELSE o.seller_id END AS other_id,
           o.awaiting AS side,
           COALESCE(NULLIF(btrim(i.title), ''), 'your Declutter item') AS what
      FROM public.declutter_offers o
      LEFT JOIN public.declutter_items i ON i.id = o.item_id
     WHERE o.status = 'open' AND o.awaiting IN ('seller', 'buyer')
       AND o.respond_by IS NOT NULL AND o.respond_by > p_now AND o.respond_by <= p_now + interval '12 hours'
       AND COALESCE(o.is_seed, false) = false
    UNION ALL
    -- A refund request waiting on the seller's answer, or a refund offer waiting on the buyer's.
    SELECT CASE WHEN q.status = 'open' THEN 'refund_answer' ELSE 'refund_offer' END,
           q.id,
           CASE WHEN q.status = 'open' THEN q.answer_by ELSE q.offer_answer_by END,
           CASE WHEN q.status = 'open' THEN d.seller_id ELSE d.buyer_id END,
           CASE WHEN q.status = 'open' THEN d.buyer_id ELSE d.seller_id END,
           CASE WHEN q.status = 'open' THEN 'seller' ELSE 'buyer' END,
           COALESCE((SELECT NULLIF(btrim(i2.title), '') FROM public.declutter_cart_items c
                       JOIN public.declutter_items i2 ON i2.id = c.item_id
                      WHERE c.order_id = d.id ORDER BY c.created_at, c.id LIMIT 1), 'your Declutter item')
      FROM public.declutter_refund_requests q
      JOIN public.declutter_orders d ON d.id = q.order_id
     WHERE COALESCE(q.is_seed, false) = false
       AND ((q.status = 'open' AND q.answer_by > p_now AND q.answer_by <= p_now + interval '12 hours')
         OR (q.status = 'offered' AND q.offer_answer_by > p_now AND q.offer_answer_by <= p_now + interval '12 hours'))
  LOOP
    CONTINUE WHEN r.to_id IS NULL;
    IF r.deadline <= p_now + interval '2 hours' THEN
      v_rung := 2;
    ELSE
      v_rung := 1;
    END IF;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.needs_you_reminder_sends s
                           WHERE s.user_id = r.to_id AND s.step = r.step AND s.ref_id = r.ref_id
                             AND s.deadline = r.deadline AND s.rung >= v_rung);
    -- At most 2 per member per item per Louisiana day (a reset deadline does not buy more).
    CONTINUE WHEN (SELECT count(*) FROM public.needs_you_reminder_sends s
                    WHERE s.user_id = r.to_id AND s.step = r.step AND s.ref_id = r.ref_id
                      AND s.sent_at >= v_day_start) >= 2;

    v_by := to_char(r.deadline AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM')
            || CASE WHEN (r.deadline AT TIME ZONE 'America/Chicago')::date = (p_now AT TIME ZONE 'America/Chicago')::date
                    THEN ' today' ELSE ' tomorrow' END;
    IF r.step = 'offer' THEN
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the offer' ELSE 'Offer closes soon' END;
      v_body := CASE WHEN r.side = 'seller'
        THEN format('An offer on "%s" is waiting on you. Next: accept, counter or decline by %s, or it expires.', r.what, v_by)
        ELSE format('The seller answered your offer on "%s". Next: accept, counter or decline by %s, or it expires.', r.what, v_by) END;
    ELSIF r.step = 'refund_answer' THEN
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the refund request' ELSE 'Refund request closes soon' END;
      v_body := format('The buyer asked for a refund on "%s". Next: answer by %s, or our team decides.', r.what, v_by);
    ELSE
      v_title := CASE WHEN v_rung = 1 THEN 'Answer the refund offer' ELSE 'Refund offer closes soon' END;
      v_body := format('The seller offered part of a refund on "%s". Next: take it or ask our team to decide by %s, or our team decides.', r.what, v_by);
    END IF;

    BEGIN
      INSERT INTO public.needs_you_reminder_sends (user_id, step, ref_id, deadline, rung, sent_at)
      VALUES (r.to_id, r.step, r.ref_id, r.deadline, v_rung, p_now);
      IF r.step = 'offer' THEN
        PERFORM public.declutter_notify_strict(r.to_id, 'declutter_offers', v_title, v_body,
          CASE WHEN r.side = 'seller' THEN '/declutter?tab=selling' ELSE '/declutter?tab=buying' END, r.other_id);
      ELSE
        PERFORM public.declutter_notify_strict(r.to_id, 'declutter_refunds', v_title, v_body,
          CASE WHEN r.side = 'seller' THEN '/declutter?tab=selling' ELSE '/declutter?tab=buying' END, r.other_id);
      END IF;
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      -- The claim above rolls back with the notice, so the next run retries; recorded where ops reads.
      PERFORM public.log_cron_defect('sweep_needs_you_reminders', r.step || ':' || r.ref_id::text, SQLERRM,
        jsonb_build_object('user_id', r.to_id, 'step', r.step, 'ref_id', r.ref_id, 'rung', v_rung));
    END;
  END LOOP;
  RETURN v_sent;
END;
$function$
;

REVOKE ALL ON FUNCTION public.sweep_needs_you_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_needs_you_reminders(timestamptz) TO service_role;
