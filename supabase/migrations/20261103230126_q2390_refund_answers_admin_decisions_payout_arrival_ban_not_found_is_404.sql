-- Q2390 packet 40 (REGULAR packet: lead review; MONEY functions, ERRCODE only): "not found" answers HTTP 404, not
-- 500, for nine Jobs/Declutter functions that still raised P0002 (owner rule 11-03: Jobs and Declutter first; no
-- testers-only features):
--   declutter_accept_refund_with_return (2: the refund ask is gone; the caller is not the order's seller),
--   declutter_answer_refund (2: the same two), declutter_admin_decide_problem, declutter_admin_decide_delivery_damage and
--   declutter_admin_decide_stuck_delivery (the problem is gone), declutter_rebook_payout (service_role: the order has no
--   payout row), enforce_job_tracking_arrival_gate (trigger: the tracking row's job is gone), admin_apply_account_action
--   (service_role, 2: no user id; no profile), enforce_retained_payment_ban (service_role: no profile).
-- Left for later (restated on pending branches): declutter_apply_seller_fault and declutter_setup_job_fee_debt (after
-- wip/b65-low lands), redeem_gift_card (after wip/b71-tax lands).
-- An exception rolls back the whole statement, so the code change moves no write. Every caller (the app,
-- stripe-webhook, void-cancelled-payments, admin-user-actions) maps by message, never by code; no migration catches
-- P0002/no_data_found. No edge map changes, no deploy. PostgREST maps P0002 to 500; RAISE ... USING ERRCODE = 'PT404'
-- answers 404.
--
-- Each is restated VERBATIM from its newest migration copy, whose md5(prosrc) and md5(pg_get_functiondef) equal prod
-- (read 2026-11-03 by Builder 79; 1 overload each; grants as prod: authenticated + service_role for the five
-- member/admin RPCs, service_role only for the other four). The ONLY change: ERRCODE 'P0002' -> 'PT404'.

--   declutter_accept_refund_with_return      20261031010243 f91317fddc78a9fbd5209ea44de08259
--   declutter_answer_refund                  20261102041000 7359ff062e38573bebc385f93d98966c
--   declutter_admin_decide_problem           20261101020052 aaa8ec010a9cf8d1a61a5ef4b3015e2f
--   declutter_admin_decide_delivery_damage   20261031184929 a23562a137f49d8113883fcdce72b297
--   declutter_admin_decide_stuck_delivery    20261031231150 14e1d508c18fca48e6635ab63e936bd5
--   declutter_rebook_payout                  20261101233256 7d51ecb5a13e0627d80d64b564009074
--   enforce_job_tracking_arrival_gate        20261008203441 0976aad686e0ff092b281b7059f4caee
--   admin_apply_account_action               20261012185742 b0fbfb630829e382e00a8a09701b5d4b
--   enforce_retained_payment_ban             20261030150104 6d5d34cb6dc4dc3aa30b446712e1819b

-- declutter_accept_refund_with_return: restated from 20261031010243_declutter_never_got_it_no_return.sql.
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
      HINT = 'The 24 hours to answer are over, so Louisiana Helpr decides this one.';
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
    'When you have the item back, tap "I got it back" and the refund is sent. If you don''t confirm in time, Louisiana Helpr decides.',
    '/declutter?view=selling', o.buyer_id);
  RETURN jsonb_build_object('result', 'returning', 'return_way', p_way, 'return_day', v_day,
    'full_refund_cents', public.declutter_full_refund_cents(o.id));
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_accept_refund_with_return(uuid, text, date, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_accept_refund_with_return(uuid, text, date, timestamp with time zone) TO authenticated, service_role;

-- declutter_answer_refund: restated from 20261102041000_declutter_refund_seller_side.sql.
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
      HINT = 'The 24 hours to answer are over, so Louisiana Helpr decides this one.';
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
$function$;
REVOKE ALL ON FUNCTION public.declutter_answer_refund(uuid, text, integer, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_refund(uuid, text, integer, text, text[]) TO authenticated, service_role;

-- declutter_admin_decide_problem: restated from 20261101020052_helpr_task_released_helpr.sql.
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

-- declutter_admin_decide_delivery_damage: restated from 20261031184929_declutter_damage_notices_name_the_item.sql.
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
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'PT404';
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

-- declutter_admin_decide_stuck_delivery: restated from 20261031231150_helpr_delivery_cant_finish.sql.
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
      format('We looked at the problem with %s. It was nobody''s fault, so the sale is cancelled. You get back what you paid, less what the delivery cost, which paid the Helpr for the trip, and less the small part the card network kept for the payment, which it doesn''t give back.',
             public.declutter_order_items_named(o.id)), '/declutter?tab=buying', o.seller_id);
  ELSE
    UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'Decided as the Helpr''s fault', updated_at = now() WHERE id = v_task.id;
    PERFORM public.helpr_task_log(v_task.id, 'failed', v_uid, 'decided: helpr fault');
    PERFORM public.helpr_task_give_job_strike(v_task.helpr_id, 'delivery_backed_out', v_task.id, 'Could not finish a Helpr delivery after picking it up');
    v_out := public.declutter_close_paid_order(o.id, 'helpr_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(v_task.helpr_id, 'warning', 'Delivery decided',
      format('Louisiana Helpr decided "%s" wasn''t finished because of you. You are not paid for this delivery.', v_task.title), '/declutter?tab=deliver', NULL);
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
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_decide_stuck_delivery(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_decide_stuck_delivery(uuid, text, text) TO authenticated, service_role;

-- declutter_rebook_payout: restated from 20261101233256_declutter_manager_payout_kind.sql.
CREATE OR REPLACE FUNCTION public.declutter_rebook_payout(p_order_id uuid, p_refunded_cents integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p public.declutter_payouts;
  v_ref text := 'declutter_order_' || p_order_id::text;
  v_debt integer;
  v_fee integer;
  -- Manager mode phase 2: the share at the time of sale, cut in proportion to what is refunded.
  v_m public.declutter_manager_payouts;
  v_share integer := 0;
BEGIN
  SELECT * INTO p FROM public.declutter_payouts WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_missing' USING ERRCODE = 'PT404';
  END IF;
  IF p_refunded_cents IS NULL OR p_refunded_cents < 0 OR p_refunded_cents > p.items_cents + p.delivery_cents THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF NOT public.declutter_payout_unsent(p_order_id) THEN
    RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_m FROM public.declutter_manager_payouts WHERE order_id = p_order_id FOR UPDATE;
  IF v_m.id IS NOT NULL THEN
    -- declutter_payout_unsent also answers false once the manager's transfer may have started. The share is a share of
    -- the ITEMS (lead condition b, 87b3df401b): only the items part of the refund cuts it, never a delivery rate that
    -- went back. Callers refund the items first (a part refund is below items_cents; a full one is items + any seller
    -- delivery rate), so the items part is least(refunded, items): floor(share * (items - items refunded) / items).
    v_share := CASE WHEN p.items_cents = 0 THEN 0
                    ELSE floor(v_m.share_cents::numeric * (p.items_cents - least(p_refunded_cents, p.items_cents))
                               / p.items_cents)::integer END;
  END IF;
  -- A refund between the fee's claim and the send (declutter_payout_unsent says nothing has gone out). The debt below is
  -- recomputed from fee debts alone, so the fee would drop out of debt_cents while setup_fee_cents and the paid flag
  -- stayed: never collected. So it is put back whole: the row carries no fee, the account owes it again, and
  -- declutter_payout_take_setup_fee takes it at the send if what is left still sends $1, else from a later sale.
  -- Only a row carrying the fee clears the flag, and that row is what set it.
  v_fee := p.setup_fee_cents;
  IF v_fee > 0 AND p.seller_id IS NOT NULL THEN
    UPDATE public.profiles SET onboarding_fee_paid = false, onboarding_fee_charged_at = NULL
     WHERE user_id = p.seller_id;
    PERFORM public.declutter_notify(p.seller_id, 'declutter_sales', 'One-time setup fee put back',
      format('A refund changed your payout for %s, so we put back the one-time $%s account setup fee. It comes out of this payout or a later one instead, and it is only ever charged once.',
             public.declutter_order_items_named(p_order_id), to_char(v_fee / 100.0, 'FM999990.00')),
      '/declutter?tab=selling', NULL);
  END IF;
  IF p.seller_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('declutter_fee_debt:' || p.seller_id::text, 0));
    UPDATE public.declutter_seller_fee_debts d
       SET remaining_cents = d.remaining_cents + x.deducted_cents
      FROM public.declutter_fee_debt_deductions x
     WHERE x.debt_id = d.id AND x.payout_ref = v_ref AND d.seller_id = p.seller_id;
    DELETE FROM public.declutter_fee_debt_deductions x
     USING public.declutter_seller_fee_debts d
     WHERE x.debt_id = d.id AND x.payout_ref = v_ref AND d.seller_id = p.seller_id;
    v_debt := public.declutter_consume_fee_debt(p.seller_id, v_ref, p.items_cents + p.delivery_cents - p_refunded_cents - v_share);
  ELSE
    -- The seller's account is gone: nothing can be put back to them.
    v_debt := least(p.debt_cents - v_fee, p.items_cents + p.delivery_cents - p_refunded_cents - v_share);
  END IF;
  UPDATE public.declutter_payouts
     SET refunded_cents = p_refunded_cents, debt_cents = v_debt, setup_fee_cents = 0, manager_share_cents = v_share,
         amount_cents = items_cents + delivery_cents - p_refunded_cents - v_share - v_debt,
         status = CASE WHEN items_cents + delivery_cents - p_refunded_cents - v_share - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END,
         -- A rebooked payout starts a fresh run of tries (B24, 10-31): one rebooked after its last try would
         -- otherwise sit 'pending' forever (declutter_payouts_due takes attempts < 12).
         attempts = 0, next_attempt_at = now()
   WHERE id = p.id;
  IF v_m.id IS NOT NULL THEN
    UPDATE public.declutter_manager_payouts
       SET amount_cents = v_share, status = CASE WHEN v_share = 0 THEN 'nothing_due' ELSE 'pending' END,
           attempts = 0, next_attempt_at = now()
     WHERE id = v_m.id;
  END IF;
  RETURN p.items_cents + p.delivery_cents - p_refunded_cents - v_share - v_debt;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_rebook_payout(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_rebook_payout(uuid, integer) TO service_role;

-- enforce_job_tracking_arrival_gate: restated from 20261008203441_arrival_gps_or_poster_and_step_order.sql.
CREATE OR REPLACE FUNCTION public.enforce_job_tracking_arrival_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs;
  -- Scalars, not a record: a %ROWTYPE of group_job_helpers would bind at CREATE
  -- time, and an unassigned `record` raises on field access when the SELECT
  -- finds nothing — which is exactly the case this has to test for.
  v_slot_id                  uuid;
  v_slot_arrived_at          timestamptz;
  v_slot_poster_arrival_at   timestamptz;
  v_slot_verified_at         timestamptz;
  v_slot_completed_at        timestamptz;
  v_slot_proof_before        text[];
  -- The app's own rule (src/lib/photoProofPolicy.ts requiredProof().before)
  -- for a job with one Helpr: the job-level before photo.
  v_needs_before_photo       boolean;
  -- The same rule for one crew member: that member's own roster photo.
  v_slot_needs_before_photo  boolean;
BEGIN
  -- Server-side writers (service role) are not constrained. The helper's
  -- on-the-way RPC writes 'on_the_way', which is not gated here. A NULL uid
  -- alone is not the service role — anon has one too (20260915101102).
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  -- FOR SHARE: the stamps this decides from must not change under it (the race
  -- class fixed in 20260913014328). helper_mark_on_the_way holds this jobs row
  -- FOR UPDATE when it writes 'on_the_way' here; a share lock taken by the same
  -- transaction does not wait on its own row lock.
  SELECT * INTO v_job FROM public.jobs WHERE id = NEW.job_id FOR SHARE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404';
  END IF;

  -- MIRROR OF requiredProof(job).before && (beforeUrls?.length ?? 0) === 0.
  -- Read off the row this function already holds FOR SHARE, so the photo it
  -- judges cannot be deleted out from under the decision.
  v_needs_before_photo :=
    COALESCE(v_job.require_photo_proof, true)
    AND COALESCE(array_length(v_job.proof_before_urls, 1), 0) = 0;

  -- ── THE SINGLE-HELPER PATH, UNCHANGED ────────────────────────────────────
  -- FIRST in the function on purpose: the standing parity guard
  -- (src/test/jobsGuardRpcParity.test.ts) reads the FIRST Working branch in
  -- this body as THE Working predicate, so it must keep landing on the rule
  -- every real job runs, not on the crew rule below.
  IF v_job.is_group_job IS NOT TRUE THEN
    -- The row must belong to the job's assigned helper — on EVERY client write,
    -- position pings included.
    IF v_job.helper_id IS DISTINCT FROM NEW.helper_id THEN
      RAISE EXCEPTION 'tracker_not_assigned_helper' USING ERRCODE = '42501',
        HINT = 'Only the Helpr assigned to this job can update its tracker.';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      -- Position pings (latitude/longitude/updated_at) never move a step.
      RETURN NEW;
    END IF;
    IF NEW.status NOT IN ('arrived', 'working', 'done') THEN
      RETURN NEW;
    END IF;

    IF NEW.status = 'arrived' AND v_job.helper_arrived_at IS NULL THEN
      RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
        HINT = 'Mark arrival at the job site first.';
    END IF;

    -- THE WORKING UNLOCK. Owner, 2026-09-19: "they can not start working until
    -- the poster confirms they are there … even if gps does confirm they are
    -- there the poster still needs ro cfnrm wither way". So this reads ONE
    -- stamp. The GPS half (helper_arrival_verified_at / the near-miss columns)
    -- is evidence shown to both parties, and not part of this predicate.
    -- GPS SKIPS THE POSTER'S TAP (owner, 2026-10-08): a verified arrival
    -- unlocks Working on its own; an unverified one still needs the poster.
    IF NEW.status = 'working'
       AND v_job.helper_completed_at IS NULL
       AND v_job.poster_confirmed_arrival_at IS NULL
       AND v_job.helper_arrival_verified_at IS NULL THEN
      RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
        HINT = 'The person who posted this job has to tap Confirm They Arrived before you can start working.';
    END IF;

    -- THE BEFORE PHOTO (owner, 2026-09-19). Second, deliberately — see the
    -- header. `helper_completed_at IS NULL` carried over from the arrival gate
    -- for the same reason it is there: a job already marked complete is not
    -- re-gated by its tracker, so a late tracker write cannot strand a finished
    -- job behind a photo nobody can add any more.
    IF NEW.status = 'working'
       AND v_job.helper_completed_at IS NULL
       AND v_needs_before_photo THEN
      RAISE EXCEPTION 'tracker_requires_before_photo' USING ERRCODE = '23514',
        HINT = 'Tap Before Photo on this job and add one before you start working.';
    END IF;

    IF NEW.status = 'done'
       AND v_job.helper_completed_at IS NULL
       AND v_job.poster_completed_at IS NULL
       AND v_job.status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'tracker_requires_completion' USING ERRCODE = '23514',
        HINT = 'Mark the job complete first.';
    END IF;

    RETURN NEW;
  END IF;

  -- ── THE CREW BRANCH ──────────────────────────────────────────────────────
  SELECT g.id, g.helper_arrived_at, g.poster_confirmed_arrival_at, g.helper_completed_at,
         g.proof_before_urls, g.helper_arrival_verified_at
    INTO v_slot_id, v_slot_arrived_at, v_slot_poster_arrival_at, v_slot_completed_at,
         v_slot_proof_before, v_slot_verified_at
  FROM public.group_job_helpers g
  WHERE g.job_id = NEW.job_id AND g.helper_id = NEW.helper_id
  FOR SHARE;

  IF v_slot_id IS NULL THEN
    RAISE EXCEPTION 'tracker_not_assigned_helper' USING ERRCODE = '42501',
      HINT = 'Only a Helpr on this job''s crew can update its tracker.';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('arrived', 'working', 'done') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'arrived' AND v_slot_arrived_at IS NULL THEN
    RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
      HINT = 'Mark arrival at the job site first.';
  END IF;

  IF NEW.status = 'working'
     AND v_slot_completed_at IS NULL
     AND v_slot_poster_arrival_at IS NULL
     AND v_slot_verified_at IS NULL THEN
    RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
      HINT = 'The person who posted this job has to tap Confirm They Arrived before you can start working.';
  END IF;

  -- Each member's before photo is their own (rpc_group_member_set_proof writes
  -- it to their roster row, and enforce_group_member_completion_gates reads it
  -- there), the lead's included. One member's photo never clears another
  -- member's step, and the job-level photo clears nobody's: it may belong to
  -- a lead who has since left.
  v_slot_needs_before_photo :=
    COALESCE(v_job.require_photo_proof, true)
    AND COALESCE(array_length(v_slot_proof_before, 1), 0) = 0;

  IF NEW.status = 'working'
     AND v_slot_completed_at IS NULL
     AND v_slot_needs_before_photo THEN
    RAISE EXCEPTION 'tracker_requires_before_photo' USING ERRCODE = '23514',
      HINT = 'Tap Before Photo on this job and add one before you start working.';
  END IF;

  IF NEW.status = 'done'
     AND v_slot_completed_at IS NULL
     AND v_job.poster_completed_at IS NULL
     AND v_job.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'tracker_requires_completion' USING ERRCODE = '23514',
      HINT = 'Mark your part complete first.';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_job_tracking_arrival_gate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_job_tracking_arrival_gate() TO service_role;

-- admin_apply_account_action: restated from 20261012185742_ban_actions_atomic_and_remaining_strikes.sql.
CREATE OR REPLACE FUNCTION public.admin_apply_account_action(
  p_user_id uuid,
  p_admin_id uuid,
  p_action text,
  p_reason text,
  p_suspended_until timestamptz DEFAULT NULL,
  p_record_strike boolean DEFAULT true
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_old     text;
  v_status  text;
  v_until   timestamptz;
  v_reason  text := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Admin action');
  v_ban_row boolean := false;
  v_lift    jsonb;
BEGIN
  IF p_admin_id IS NULL OR NOT COALESCE(public.has_role(p_admin_id, 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p_user_id = p_admin_id THEN
    RAISE EXCEPTION 'self_action' USING ERRCODE = '22023';
  END IF;
  -- warning / temporary / permanent: BanDialog. formal_warning /
  -- final_warning / suspension: the three strikes of admin-user-actions'
  -- formal_warning (no user_bans row; the suspension is 7 days).
  IF p_action IS NULL OR p_action NOT IN ('warning', 'temporary', 'permanent',
                                          'formal_warning', 'final_warning', 'suspension') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;
  IF p_action IN ('temporary', 'suspension')
     AND (p_suspended_until IS NULL OR p_suspended_until <= now() OR p_suspended_until > now() + interval '366 days') THEN
    RAISE EXCEPTION 'invalid_suspension_end' USING ERRCODE = '22023';
  END IF;

  -- One action per account at a time; a ladder strike or another admin waits.
  SELECT p.ban_status, p.auto_suspended_until INTO v_old, v_until
    FROM public.profiles p WHERE p.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ban_settlement_queue r
              WHERE r.user_id = p_user_id AND r.review_state = 'open') THEN
    RAISE EXCEPTION 'ban_review_open'
      USING ERRCODE = '42501',
            HINT = 'This account is under a ban settlement review. Confirm or lift it in the fraud console.';
  END IF;

  v_status := CASE p_action WHEN 'warning' THEN 'final_warning'
                            WHEN 'final_warning' THEN 'final_warning'
                            WHEN 'formal_warning' THEN 'warned'
                            WHEN 'temporary' THEN 'temp_banned'
                            WHEN 'suspension' THEN 'temp_banned'
                            ELSE 'permanently_banned' END;
  -- A warning leaves the suspension end alone (as the admin tools always did).
  v_until := CASE WHEN p_action IN ('temporary', 'suspension') THEN p_suspended_until
                  WHEN p_action = 'permanent' THEN NULL
                  ELSE v_until END;

  -- The ban row before the standing: the profile update's
  -- trg_retain_ban_on_ban reads the newest active user_bans row for the
  -- retained reason and type. Any refusal below rolls this back with it.
  IF p_action = 'temporary' THEN
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by, expires_at)
    VALUES (p_user_id, 'temporary', v_reason, p_admin_id, p_suspended_until);
    v_ban_row := true;
  ELSIF p_action = 'permanent'
        AND NOT EXISTS (SELECT 1 FROM public.user_bans b
                         WHERE b.user_id = p_user_id AND b.ban_type = 'permanent' AND b.is_active) THEN
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by)
    VALUES (p_user_id, 'permanent', v_reason, p_admin_id);
    v_ban_row := true;
  END IF;

  -- A warning out of a ban ends a CONFIRMED review the way set_ban_status
  -- always did (an open one was refused above): the lift clears its Q1324
  -- payout hold and card/bank match, and may keep a harsher standing the
  -- ladder earned during the review, which is then what is applied.
  IF COALESCE(v_old, 'active') IN ('banned', 'temp_banned', 'permanently_banned')
     AND v_status NOT IN ('banned', 'temp_banned', 'permanently_banned') THEN
    v_lift := public.lift_ban_settlement_review(p_user_id, p_admin_id, v_status);
    IF COALESCE((v_lift ->> 'lifted')::boolean, false) THEN
      v_status := v_lift ->> 'ban_status';
      v_until := (v_lift ->> 'suspended_until')::timestamptz;
    END IF;
  END IF;

  -- Never as a ladder write (that would keep the old standing silently).
  PERFORM set_config('app.trusted_ladder_write', 'off', true);
  UPDATE public.profiles
     SET ban_status = v_status, auto_suspended_until = v_until
   WHERE user_id = p_user_id;

  IF p_record_strike THEN
    INSERT INTO public.user_violations (user_id, violation_type, description, action_taken, reported_by)
    VALUES (p_user_id,
            CASE WHEN p_action IN ('temporary', 'permanent') THEN 'admin_action' ELSE 'admin_warning' END,
            v_reason,
            CASE p_action WHEN 'warning' THEN 'warning' WHEN 'formal_warning' THEN 'warning'
                          WHEN 'final_warning' THEN 'final_warning' WHEN 'suspension' THEN 'suspension'
                          WHEN 'temporary' THEN 'temp_ban' ELSE 'permanent_ban' END,
            p_admin_id);
    -- The strike's ladder trigger turned this on for the rest of the transaction.
    PERFORM set_config('app.trusted_ladder_write', 'off', true);
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (p_admin_id, 'set_ban_status', p_user_id::text, 'user',
          jsonb_build_object('ban_status', v_status, 'auto_suspended_until', v_until,
                             'action', p_action, 'ban_row_written', v_ban_row,
                             'strike_recorded', p_record_strike, 'previous_ban_status', v_old));

  RETURN jsonb_build_object('ban_status', v_status, 'suspended_until', v_until,
                            'ban_row_written', v_ban_row,
                            'state_changed', v_ban_row OR v_old IS DISTINCT FROM v_status);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_apply_account_action(uuid, uuid, text, text, timestamp with time zone, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_apply_account_action(uuid, uuid, text, text, timestamp with time zone, boolean) TO service_role;

-- enforce_retained_payment_ban: restated from 20261030150104_admin_alerts_skip_test_gaps.sql.
CREATE OR REPLACE FUNCTION public.enforce_retained_payment_ban(
  p_user_id            uuid,
  p_kind               text,
  p_stripe_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_h        text;
  v_email    text;
  v_status   text;
  v_own_h    text;
  v_row      RECORD;
  v_already  boolean;
  v_test     boolean;
  v_own_reason CONSTANT text :=
    'A payment method on this account is linked to an account closed for breaking our Platform Rules. '
    || 'Contact support if you think this is a mistake.';
BEGIN
  -- Caller errors are errors: an edge function that passes nothing must hear
  -- about it, not get a quiet "not banned".
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'enforce_retained_payment_ban: p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('card', 'bank') THEN
    RAISE EXCEPTION 'enforce_retained_payment_ban: kind must be card or bank, got %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_stripe_fingerprint IS NULL OR btrim(p_stripe_fingerprint) = '' THEN
    RAISE EXCEPTION 'enforce_retained_payment_ban: a Stripe fingerprint is required' USING ERRCODE = '22023';
  END IF;

  -- Raises if the Vault salt is missing (ban_fingerprint_salt), which the
  -- caller reports. Never an unsalted hash.
  v_h := public.ban_fingerprint(p_kind, p_stripe_fingerprint);

  SELECT email, ban_status INTO v_email, v_status
    FROM public.profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enforce_retained_payment_ban: no profile for %', p_user_id USING ERRCODE = 'PT404';
  END IF;

  INSERT INTO public.payment_fingerprints (user_id, fingerprint_kind, fingerprint_sha256)
  VALUES (p_user_id, p_kind, v_h)
  ON CONFLICT (user_id, fingerprint_kind, fingerprint_sha256) DO UPDATE SET last_seen_at = now();

  v_already := COALESCE(v_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned');
  v_own_h := CASE WHEN v_email IS NULL OR btrim(v_email) = '' THEN NULL
                  ELSE encode(sha256(lower(btrim(v_email))::bytea), 'hex') END;

  -- A banned account that attaches a new card or bank: its own retained row
  -- picks the new key up, so the NEXT account to use it is caught.
  IF v_already THEN
    PERFORM public.retain_ban_for_user(p_user_id, 'ban');
  END IF;

  SELECT * INTO v_row
    FROM public.retained_bans rb
   WHERE ((p_kind = 'card' AND v_h = ANY (rb.card_sha256))
       OR (p_kind = 'bank' AND v_h = ANY (rb.bank_sha256)))
     AND rb.email_sha256 IS DISTINCT FROM v_own_h
     -- An admin looked at this account with this card / bank and lifted the
     -- ban: the same payment method does not ban it again (every retained
     -- row that holds it, including later accounts banned on it).
     AND NOT EXISTS (
       SELECT 1 FROM public.ban_evasion_matches m
        WHERE m.user_id = p_user_id AND m.matched_on = p_kind
          AND m.match_sha256 = v_h AND m.cleared_at IS NOT NULL
     )
   -- The OLDEST live retained ban on it: the account that first used this
   -- card / bank and was banned, not a later account banned only for it.
   ORDER BY (rb.expires_at IS NULL) DESC, rb.retained_at ASC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL);
  END IF;

  -- A spent suspension is retired on sight, as on every other key.
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    DELETE FROM public.retained_bans WHERE id = v_row.id;
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL, 'retired', true);
  END IF;

  -- Apply the retained judgment, exactly as enforce_retained_ban does, unless
  -- the account is already banned (never soften or re-date an existing ban).
  --
  -- user_bans BEFORE the profile write: the profile write fires
  -- trg_retain_ban_on_ban, whose retain_ban_for_user reads the newest active
  -- user_bans row for the reason this account's own retained row will carry.
  IF NOT v_already THEN
    PERFORM set_config('app.retained_ban_reapply', 'on', true);

    -- The reason the person sees on /account-banned (and in their data
    -- export) is about THEM, never the other account's ban reason: a shared
    -- card or bank account may belong to someone else entirely.
    -- 'banned' with no end date while the review is open (authz review,
    -- 2026-10-05): a temporary judgment must not expire and lift the account
    -- (sweep_expired_auto_bans) before an admin has decided. The retained
    -- judgment itself is kept on the review and applied by the confirm.
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by, expires_at, is_active)
    SELECT p_user_id,
           'banned',
           v_own_reason,
           p_user_id,
           NULL,
           true
     WHERE NOT EXISTS (
       SELECT 1 FROM public.user_bans
        WHERE user_id = p_user_id AND is_active
          AND reason = v_own_reason
     );

    PERFORM set_config('app.retained_ban_reapply', 'off', true);

    INSERT INTO public.ban_settlement_queue (user_id, matched_on, original_ban_status, original_expires_at)
    VALUES (p_user_id, p_kind, v_row.ban_status, v_row.expires_at)
    ON CONFLICT (user_id) WHERE review_state = 'open' DO NOTHING;

    -- BAN NOW, ADMIN SETTLES (owner 2026-10-05): the profile write below fires
    -- the permanent-ban settlement triggers; this transaction-local flag makes
    -- them leave the jobs to the review instead of cancelling them.
    PERFORM set_config('app.ban_settlement_review', 'on', true);
    UPDATE public.profiles
       SET ban_status           = 'banned',
           auto_suspended_until = NULL
     WHERE user_id = p_user_id;
    PERFORM set_config('app.ban_settlement_review', 'off', true);

    -- Every admin hears of it now (the hourly ban-review-watch pages again
    -- once it has waited 24 hours). Not for a test account (owner
    -- 2026-10-30): no admin bell, and its error_logs row is seed-tagged, so it
    -- goes to the daily digest instead of paging.
    v_test := public.is_test_subject(p_user_id);
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT ur.user_id,
             'Ban settlement review: an account was banned automatically',
             'It matched a banned account''s ' || p_kind || '. Its jobs and escrow are frozen until you confirm or lift the ban in the fraud console.',
             'admin_alert',
             '/admin?view=fraud'
        FROM public.user_roles ur
       WHERE ur.role = 'admin'
         AND NOT v_test;
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error',
              format('Ban settlement review opened: account %s banned automatically on a %s match. Its jobs and escrow are frozen until an admin confirms or lifts it (docs/OPEN.md Q1324).', p_user_id, p_kind),
              jsonb_build_object('source', 'ban-settlement-review-opened', 'area', 'money', 'seed', v_test),
              jsonb_build_object('user_id', p_user_id));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enforce_retained_payment_ban: review alert failed for %: %', p_user_id, SQLERRM;
    END;

    -- "Can't get paid": a payout hold stops every transfer to the account
    -- (Q764) and freezes its Stripe automatic payouts (Q1221). A hold an
    -- admin already placed is left as it is.
    INSERT INTO public.payout_holds (helper_id, reason, held_by, held_at)
    VALUES (p_user_id,
            'Q1324: banned automatically (a banned account''s ' || p_kind || ' matched). Ban settlement review open.',
            NULL, now())
    ON CONFLICT (helper_id) DO NOTHING;
  END IF;

  -- The other account's ban details, for admins only (never exported).
  INSERT INTO public.ban_evasion_matches (
    user_id, matched_on, match_sha256, retained_ban_id, original_ban_status, original_reason,
    original_recorded_at, original_expires_at, auto_banned
  )
  VALUES (p_user_id, p_kind, v_h, v_row.id, v_row.ban_status, v_row.reason,
          v_row.retained_at, v_row.expires_at, NOT v_already)
  ON CONFLICT (user_id, matched_on, retained_ban_id) DO NOTHING;

  -- The fraud console notice. It holds nothing about the OTHER account: this
  -- row is exported to the person it is about (export_my_data).
  BEGIN
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    SELECT
      p_user_id,
      'ban_evasion_attempt',
      format(
        'Payment method blocked: this account''s %s matched one retained from a banned account. %s '
        || 'Account email: %s.',
        p_kind,
        CASE WHEN v_already THEN 'It was already banned; its ban was left as it was.'
             ELSE 'It was banned automatically; its jobs wait for an admin decision.' END,
        COALESCE(v_email, '(unknown)')
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.fraud_flags f
       WHERE f.user_id = p_user_id
         AND f.flag_type = 'ban_evasion_attempt'
         AND NOT f.resolved
         AND f.details LIKE 'Payment method blocked: this account''s ' || p_kind || ' matched%'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enforce_retained_payment_ban: fraud flag failed for %: %', p_user_id, SQLERRM;
  END;

  UPDATE public.retained_bans SET reapplied_at = now() WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'banned',         true,
    'matched_on',     p_kind,
    'already_banned', v_already,
    'ban_status',     v_row.ban_status,
    'expires_at',     v_row.expires_at,
    'retained_id',    v_row.id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_retained_payment_ban(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_retained_payment_ban(uuid, text, text) TO service_role;
