-- Declutter: Louisiana Helpr's decision ends the refund request it came with (audit 1b #5, #12; coordinator note
-- on the "arrange it in Messages" lines, 2026-10-29).
--
-- WHAT WAS BROKEN:
--   #5  When a refund request went to Louisiana Helpr (declutter_refund_request_to_admin, or a problem report that
--       joined it) and an admin decided the problem, the request row stayed 'to_admin' for good. Both refund panels
--       kept saying "Louisiana Helpr is looking at your refund request" after the refund went out (prod 2026-10-29,
--       order B, re_3UW0W2...).
--   #12 The two refund routes pay back different amounts for one purchase (seller at fault: everything back; no
--       fault or a full refund the seller agreed: all but the card network's part). Only the refund-request form
--       said why; the refund notice did not.
--   The refund notices told the two sides to "arrange it in Messages", and Messages has nothing for Declutter.
--
-- WHAT CHANGES (each function restated VERBATIM from its newest definition, with only these edits):
--   * declutter_admin_decide_problem (20261029000048): on a handed-over sale, the 'to_admin' request tied to this
--     problem becomes 'agreed' (refund_id, settled_at) when the admin refunds the buyer, or 'declined'
--     (declined_at) when the admin pays the seller. The order's status is unchanged: a refund after the handover
--     always leaves the order 'handed_over' (the seller's payout is rebooked on it), exactly as the seller-agreed
--     refund does.
--   * declutter_refund_after_handover (20261027153244 as rewritten in place by 20261027172503, the body the database
--     runs: no fee words in its notices): a refund that kept the card fee (fee_policy keep_card_fee:
--     an admin's no-fault refund, a full refund the seller agreed) adds the refund form's own sentence: "That's all
--     you paid, less the small part the card network kept for the payment, which it doesn't give back." The two
--     "arrange it in Messages" lines become "message the seller from your order" / "message the buyer from your
--     order" (the order chat, D2-1).
--   * declutter_answer_refund (20261026155251): the same Messages line in "The seller agreed to a full refund".
--   * declutter_refund_request_view (20261026155251): the request carries admin_decided (agreed or declined, and its
--     problem was decided), so the panel says Louisiana Helpr decided rather than "the seller said no".
--
-- Replay-safe: CREATE OR REPLACE with unchanged signatures; grants restated exactly as their newest definitions.
-- Proof: src/test/pglite/declutterAdminDecisionClosesRefund.pglite.mjs. Guard: src/test/declutterAdminDecisionClosesRefund.test.ts.

CREATE OR REPLACE FUNCTION public.declutter_admin_decide_problem(p_problem_id uuid, p_decision text, p_fault text,
  p_strike boolean, p_note text, p_false_report boolean DEFAULT false)
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
  IF p_decision IS NULL OR p_decision NOT IN ('refund_buyer', 'pay_seller')
     OR p_fault IS NULL OR p_fault NOT IN ('seller', 'buyer', 'none')
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
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The item never left the seller. Refund the buyer, and say whose fault it was.';
  END IF;
  IF p_decision = 'refund_buyer' AND p.reason IN ('damaged', 'not_received')
     AND v_task.status IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The Helpr has this item. Decide it as damaged in delivery, or pay the seller.';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = p_decision, fault = p_fault, strike_given = p_strike,
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  IF o.status = 'handed_over' THEN
    -- 141d: a problem reported in the window after the handover. The payout is still held (never sent).
    IF p_decision = 'pay_seller' THEN
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
       SET status = CASE WHEN p_decision = 'refund_buyer' THEN 'agreed' ELSE 'declined' END,
           refund_id = CASE WHEN p_decision = 'refund_buyer' THEN (v_out->>'refund_id')::uuid ELSE refund_id END,
           settled_at = CASE WHEN p_decision = 'refund_buyer' THEN now() ELSE settled_at END,
           declined_at = CASE WHEN p_decision = 'refund_buyer' THEN declined_at ELSE now() END
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
             ELSE 'We are refunding you. A separate notice says how much.' END),
      '/declutter?tab=buying', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Louisiana Helpr decided',
      format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),
        CASE WHEN o.paid_with = 'free' AND p_decision = 'pay_seller' THEN 'The handover stands.'
             WHEN o.paid_with = 'free' THEN 'This free pickup is cancelled.'
             WHEN p_decision = 'pay_seller' THEN 'You keep the payment.'
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
                             'false_report', p_false_report, 'result', v_out));
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_after_handover(p_order_id uuid, p_reason text, p_part_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_reserved integer;
  v_paid integer;
  v_refund uuid;
  v_refunded integer;
  v_cents integer;
  v_title text;
  v_policy text;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('refund_request_full', 'refund_request_part', 'not_as_described', 'admin_no_fault', 'admin_buyer_fault') THEN
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
  -- A delivery fee that paid a Helpr for the trip stays with the Helpr (owner #5, B69).
  v_reserved := public.declutter_delivery_reserved_cents(o.id);
  v_paid := o.total_cents - v_reserved;
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
    v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, v_paid, o.card_fee_cents);
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
         WHEN p_reason = 'refund_request_full'
         THEN format('$%s is coming back to your card for "%s". The seller confirmed they have the item back.%s%s',
                     to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'),
                     CASE WHEN v_policy = 'keep_card_fee' THEN ' That''s all you paid, less the small part the card network kept for the payment, which it doesn''t give back.' ELSE '' END,
                     CASE WHEN v_reserved > 0 THEN ' What you paid for delivery went to the Helpr who made the trip.' ELSE '' END)
         ELSE format('$%s is coming back to your card for "%s".%s%s Please give the item back to the seller; message the seller from your order.',
                     to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'),
                     CASE WHEN p_reason = 'admin_buyer_fault' THEN ''
                          WHEN v_policy = 'keep_card_fee' THEN ' That''s all you paid, less the small part the card network kept for the payment, which it doesn''t give back.'
                          ELSE '' END,
                     CASE WHEN v_reserved > 0 THEN ' What you paid for delivery went to the Helpr who made the trip.' ELSE '' END)
    END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer refunded',
    CASE WHEN p_reason = 'refund_request_part'
         THEN format('The buyer got $%s back for "%s". It comes out of your payout for this sale.', to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'))
         WHEN p_reason = 'refund_request_full'
         THEN format('You have "%s" back and the buyer was refunded, so there is no payout for this sale.', COALESCE(v_title, 'your item'))
         ELSE format('The buyer was refunded for "%s", so there is no payout for this sale. The buyer gives the item back; message the buyer from your order.', COALESCE(v_title, 'your item'))
    END,
    '/declutter?view=selling', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund) || jsonb_build_object('refunded_items_cents', v_refunded);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_after_handover(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_after_handover(uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_answer_refund(p_request_id uuid, p_answer text, p_offer_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
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
  IF p_answer IS NULL OR p_answer NOT IN ('full', 'part', 'decline') THEN
    RAISE EXCEPTION 'invalid_answer' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Lock order: the order (and its items) first, then the request, as every other path.
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'open' THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  IF now() >= r.answer_by THEN
    RAISE EXCEPTION 'refund_answer_late' USING ERRCODE = '55000',
      HINT = 'The 24 hours to answer are over, so Louisiana Helpr decides this one.';
  END IF;
  IF p_answer = 'full' THEN
    -- #3558 answer 2: nothing is refunded yet. The refund is sent when the seller confirms the item is back
    -- (declutter_refund_item_returned); the payout stays held (declutter_sale_final reads 'returning').
    PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
    IF NOT public.declutter_payout_unsent(o.id) THEN
      RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000',
        HINT = 'The seller was already paid for this sale. Louisiana Helpr settles it by hand.';
    END IF;
    UPDATE public.declutter_refund_requests
       SET status = 'returning', return_agreed_at = now(), return_by = now() + interval '72 hours'
     WHERE id = r.id;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The seller agreed to a full refund',
      format('Give the item back to the seller; message the seller from your order. Your refund of $%s is sent as soon as the seller confirms they have it back.',
             to_char(public.declutter_full_refund_cents(o.id) / 100.0, 'FM999990.00')),
      '/declutter?view=buying', v_uid);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Full refund agreed',
      'When the buyer gives the item back, tap "I got it back" and the refund is sent. If you don''t confirm within 3 days, Louisiana Helpr decides.',
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
      format('The seller offered $%s back. Take it, or ask Louisiana Helpr to decide, within 24 hours. If you don''t answer, Louisiana Helpr decides.',
             to_char(p_offer_cents / 100.0, 'FM999990.00')),
      '/declutter?view=cart', v_uid);
    RETURN jsonb_build_object('result', 'offered', 'offer_cents', p_offer_cents);
  END IF;
  UPDATE public.declutter_refund_requests SET status = 'declined', declined_at = now() WHERE id = r.id;
  PERFORM public.declutter_notify(o.buyer_id, 'warning', 'The seller said no',
    'The seller didn''t agree to a refund. If you still think something is wrong, report a problem within 24 hours and Louisiana Helpr decides.',
    '/declutter?view=cart', v_uid);
  RETURN jsonb_build_object('result', 'declined');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_answer_refund(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_refund(uuid, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_request_view(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_side text;
  v_refund public.declutter_refunds;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF o.id IS NULL OR v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE order_id = o.id;
  IF r.refund_id IS NOT NULL THEN
    SELECT * INTO v_refund FROM public.declutter_refunds WHERE id = r.refund_id;
  END IF;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'side', v_side,
    'handed_over', o.status = 'handed_over',
    'window_ends_at', CASE WHEN o.status = 'handed_over' THEN o.handed_over_at + interval '24 hours' END,
    'can_ask', COALESCE(v_side = 'buyer' AND o.status = 'handed_over' AND r.id IS NULL
               AND now() < o.handed_over_at + interval '24 hours'
               AND NOT public.declutter_sale_decided(o.id) AND public.declutter_payout_unsent(o.id)
               AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open'), false),
    'can_report', COALESCE(v_side = 'buyer' AND public.declutter_problem_window_open(o.id)
                  AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open'), false),
    'items_cents', o.items_cents,
    'full_refund_cents', public.declutter_full_refund_cents(o.id),
    'delivery_kept_cents', public.declutter_delivery_reserved_cents(o.id),
    'request', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', r.id, 'status', r.status, 'reason', r.reason, 'note', r.note, 'answer_by', r.answer_by,
      'offer_cents', r.offer_cents, 'offer_answer_by', r.offer_answer_by, 'declined_at', r.declined_at,
      'return_by', r.return_by, 'returned_at', r.returned_at,
      'report_until', CASE WHEN r.status = 'declined' THEN greatest(r.declined_at, o.handed_over_at) + interval '24 hours' END,
      'refund_cents', v_refund.refund_cents, 'refund_status', v_refund.status, 'created_at', r.created_at,
      -- D2-5: the request ended with Louisiana Helpr's decision (not the seller's answer), so the panel says so.
      'admin_decided', r.status IN ('agreed', 'declined')
                       AND EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.id = r.problem_id AND x.status = 'decided')) END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_request_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_refund_request_view(uuid) TO authenticated, service_role;
