-- Buying audit BUY-25 and BUY-23 (owner's rulings through the lead, 10-30).
--   BUY-25: a buyer asked for a refund because they never got it, and the seller picks Refund in full: it is refunded at
--     once, with no return and no payout for that sale. There is nothing to bring back.
--   BUY-23: "the buyer brings it back" names the address. It exists only where the seller offered pickup (door, porch):
--     the seller's address stays private on a meeting-spot, delivered or shipped sale, and those use "I'll pick it up".
--     While a drop-off is open the buyer is told the address the photo must be taken at.
-- Restated from prod's effective definitions (md5 at read, 10-30): declutter_answer_refund c03de210,
-- declutter_accept_refund_with_return 0f21434c, declutter_refund_after_handover bae8c249, declutter_refund_request_view
-- b3e88450. Only the marked parts change.

CREATE OR REPLACE FUNCTION public.declutter_answer_refund(p_request_id uuid, p_answer text, p_offer_cents integer)
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
         WHEN v_never_got_it
         THEN format('$%s is coming back to your card for "%s". The seller agreed you never got it.%s',
                     to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'),
                     CASE WHEN v_reserved > 0 THEN ' What you paid for delivery went to the Helpr who made the trip.' ELSE '' END)
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
         WHEN v_never_got_it
         THEN format('You agreed the buyer never got "%s" and the buyer was refunded, so there is no payout for this sale.', COALESCE(v_title, 'your item'))
         WHEN p_reason = 'refund_request_full'
         THEN format('You have "%s" back and the buyer was refunded, so there is no payout for this sale.', COALESCE(v_title, 'your item'))
         ELSE format('The buyer was refunded for "%s", so there is no payout for this sale. The buyer gives the item back; message the buyer from your order.', COALESCE(v_title, 'your item'))
    END,
    '/declutter?view=selling', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund) || jsonb_build_object('refunded_items_cents', v_refunded);
END;
$function$;

CREATE OR REPLACE FUNCTION public.declutter_refund_request_view(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_side text;
  v_refund public.declutter_refunds;
  v_show_address boolean;
  v_drop_address text;
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
  v_show_address := COALESCE(r.status = 'returning' AND r.return_way = 'collect', false);
  -- CHANGED (BUY-23, owner 10-30): only while a drop-off is open, and only where the seller offered pickup: the same
  -- points the drop-off photo is measured from (declutter_return_dropped_off).
  IF r.status = 'returning' AND r.return_way = 'drop_off' AND o.handover IN ('pickup_home', 'porch') THEN
    SELECT string_agg(DISTINCT pt.address, '; ') INTO v_drop_address FROM public.declutter_order_pickup_points(o.id) pt;
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
    -- BUY-25: never got it, the seller refunds in full: everything back, less a delivery a Helpr already made.
    'never_got_it_refund_cents', o.total_cents - public.declutter_delivery_reserved_cents(o.id),
    'delivery_kept_cents', public.declutter_delivery_reserved_cents(o.id),
    'can_drop_off', o.handover IN ('pickup_home', 'porch'),
    'request', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', r.id, 'status', r.status, 'reason', r.reason, 'note', r.note, 'answer_by', r.answer_by,
      -- D2-3: the buyer's photos (both sides read them through declutter-handover's read rule: the two parties and admins).
      'photo_paths', COALESCE(r.photo_paths, '{}'),
      'offer_cents', r.offer_cents, 'offer_answer_by', r.offer_answer_by, 'declined_at', r.declined_at,
      'return_by', r.return_by, 'returned_at', r.returned_at,
      'report_until', CASE WHEN r.status = 'declined' THEN greatest(r.declined_at, o.handed_over_at) + interval '24 hours' END,
      'refund_cents', v_refund.refund_cents, 'refund_status', v_refund.status, 'created_at', r.created_at,
      -- D2-5: the request ended with Louisiana Helpr's decision (not the seller's answer), so the panel says so.
      'admin_decided', r.status IN ('agreed', 'declined')
                       AND EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.id = r.problem_id AND x.status = 'decided'),
      'return_way', r.return_way, 'return_day', r.return_day, 'return_at', r.return_at,
      'return_dropped_off_at', r.return_dropped_off_at,
      'return_deadline', CASE WHEN r.status = 'returning' THEN public.declutter_return_backstop_at(r) END,
      'return_address', CASE WHEN v_show_address THEN r.return_address END,
      'return_lat', CASE WHEN v_show_address THEN r.return_lat END,
      'return_lng', CASE WHEN v_show_address THEN r.return_lng END,
      'drop_off_address', v_drop_address) END);
END;
$function$;

-- Their grants, as prod's: members call these three; the refund itself stays internal.
REVOKE ALL ON FUNCTION public.declutter_answer_refund(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_refund(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_accept_refund_with_return(uuid, text, date, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_accept_refund_with_return(uuid, text, date, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.declutter_refund_request_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_refund_request_view(uuid) TO authenticated, service_role;
