-- Q2390 packet 36 (REGULAR packet: lead review): "not found" answers HTTP 404, not 500, for five Declutter functions
-- that still raised P0002, and one state refusal answers 400 (owner rule 11-03: Jobs and Declutter first; no
-- testers-only features). Each raise comes at the function's first existence check or locked read, BEFORE any write:
--   declutter_admin_review_item (admin): 'item_not_pending' (no item, or one no longer pending: the second raise
--   follows an UPDATE that matched no row, so nothing was written) is a STATE refusal, '22023' (400), as lead 11-03
--   ruled for rentals_admin_review_landlord_id's 'not_pending_review' (packet 34). declutter_ask_refund (not
--   the buyer), declutter_withdraw_problem (2; the problem read, then not its reporter), declutter_report_no_show (not a
--   side), declutter_seller_cancel_sale (2; not the seller's item, before and after the lock), declutter_book_pickup
--   (not a side).
-- The app maps all six by message; no edge function reads their code. No edge map changes, no deploy. PostgREST maps
-- P0002 to 500; RAISE ... USING ERRCODE = 'PT404' answers 404.
--
-- Each is restated VERBATIM from its newest migration copy, whose md5(prosrc) and md5(pg_get_functiondef) equal prod
-- (read 2026-11-03 by Builder 75; 1 overload each; grants as prod: authenticated, service_role). The ONLY change:
-- ERRCODE 'P0002' -> 'PT404', and declutter_admin_review_item's 'item_not_pending' -> '22023'.
--   declutter_admin_review_item   20261028200440 78d309eaf5b25f9d8780bfb19abdb52f
--   declutter_ask_refund          20261031100935 b4d2d25262026833b58200568351650d
--   declutter_withdraw_problem    20261031103443 8cae396d85260247b88d97a308fad329
--   declutter_report_no_show      20261031004529 458c0d62a5912f2063788aceb1ea9e25
--   declutter_seller_cancel_sale  20261030132149 dac3b3892a2389d33e8e1123cd076ee4
--   declutter_book_pickup         20261102005411 c8639bffa72fe721d1945eb9edb2111a

-- declutter_admin_review_item: restated from 20261028200440_declutter_audit3_notices_and_empty_cart.sql.
CREATE OR REPLACE FUNCTION public.declutter_admin_review_item(p_item_id uuid, p_approve boolean, p_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_seller uuid;
  v_status text;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_title text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND v_note IS NULL THEN
    RAISE EXCEPTION 'review_note_required'
      USING ERRCODE = '22023', HINT = 'Say why the listing is not approved.';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT seller_id INTO v_seller FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = '22023';
  END IF;
  -- lh-authz-rls review must-fix 1: an admin never reviews their own listing.
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_listing' USING ERRCODE = '42501', HINT = 'Another admin must review your own listing.';
  END IF;
  -- Must-fix 2: approval puts the listing in front of buyers NOW, so the
  -- seller must still be allowed to sell now: not banned, fewer than 3
  -- active Declutter strikes, not under 18, payout setup done.
  IF p_approve AND (
       EXISTS (SELECT 1 FROM public.profiles pr
                WHERE pr.user_id = v_seller
                  AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                  AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
       OR public.declutter_active_strike_count(v_seller) >= 3
       OR public.member_under_18(v_seller)) THEN
    -- No payout check (owner 2026-10-27, list first, set up at first sale).
    RAISE EXCEPTION 'seller_not_eligible'
      USING ERRCODE = '22023', HINT = 'The seller cannot sell right now (restricted, strikes or age). Reject it instead.';
  END IF;

  v_status := CASE WHEN p_approve THEN 'live' ELSE 'rejected' END;
  UPDATE public.declutter_items
     SET status = v_status,
         admin_approved_at = CASE WHEN p_approve THEN now() ELSE admin_approved_at END,
         live_at = CASE WHEN p_approve THEN now() ELSE live_at END,
         updated_at = now()
   WHERE id = p_item_id AND status = 'pending_review';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_item_private SET review_note = v_note, updated_at = now() WHERE item_id = p_item_id;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_approve THEN 'declutter_listing_approved' ELSE 'declutter_listing_rejected' END,
          'declutter_item', p_item_id::text, jsonb_build_object('note', v_note));
  -- Q2414 (owner walkthrough 2026-10-27): the seller hears the decision, as the
  -- Selling tab promises. Through declutter_notify (bell + push, respects prefs).
  SELECT title INTO v_title FROM public.declutter_items WHERE id = p_item_id;
  IF p_approve THEN
    PERFORM public.declutter_notify(v_seller, 'info', 'Your listing is live',
      '"' || COALESCE(v_title, 'Your item') || '" is approved. Buyers can see it now.',
      '/declutter?tab=selling', v_uid);
  ELSE
    PERFORM public.declutter_notify(v_seller, 'info', 'Your listing needs a change',
      '"' || COALESCE(v_title, 'Your item') || '" wasn''t approved: ' || v_note,
      '/declutter?tab=selling', v_uid);
  END IF;
  RETURN v_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_admin_review_item(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_review_item(uuid, boolean, text) TO authenticated, service_role;

-- declutter_ask_refund: restated from 20261031100935_declutter_problem_notices_name_the_item.sql.
CREATE OR REPLACE FUNCTION public.declutter_ask_refund(p_order_id uuid, p_reason text, p_note text,
  p_photo_paths text[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
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
      HINT = 'A problem was reported on this sale. Louisiana Helpr decides before anyone is paid.';
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
    format('The buyer asked for a refund on %s. Answer within 24 hours: refund it all, offer part, or say no. If you don''t answer, Louisiana Helpr decides. Your payout waits until then.',
           public.declutter_order_items_named(o.id)),
    '/declutter?tab=selling', v_uid);
  RETURN jsonb_build_object('result', 'asked', 'request_id', v_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_ask_refund(uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_ask_refund(uuid, text, text, text[]) TO authenticated, service_role;

-- declutter_withdraw_problem: restated from 20261031103443_declutter_taken_back_notice_opens_the_tab.sql.
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
      HINT = 'A return was agreed on this sale, so Louisiana Helpr decides it.';
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
$function$;

REVOKE ALL ON FUNCTION public.declutter_withdraw_problem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_problem(uuid) TO authenticated, service_role;

-- declutter_report_no_show: restated from 20261031004529_declutter_handover_both_confirm.sql.
CREATE OR REPLACE FUNCTION public.declutter_report_no_show(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
  h public.declutter_handovers;
  v_side text;
  v_from timestamptz;
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
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  IF b.order_id IS NULL OR b.slot_start IS NULL THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  -- CHANGED (owner 10-30): one side's word against the other's goes to Louisiana Helpr. The seller said it was handed
  -- over: the buyer reports a problem. The buyer reported the seller: the seller answers that, and can't report back.
  IF v_side = 'buyer' AND h.seller_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'seller_confirmed' USING ERRCODE = '55000',
      HINT = 'The seller says it was handed over. If you don''t have it, report a problem.';
  END IF;
  IF v_side = 'seller' AND h.seller_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_confirmed' USING ERRCODE = '55000',
      HINT = 'You said it was handed over. If that''s wrong, report a problem.';
  END IF;
  IF v_side = 'seller' AND h.no_show_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'no_show_reported' USING ERRCODE = '55000',
      HINT = 'The buyer says you didn''t show. Answer that report on this order.';
  END IF;
  -- A porch DAY (20261028225038): the seller has all day to put it out, so the buyer's report opens when the day
  -- ends (declutter_pickup_anchor); a booked time keeps its 15 minutes.
  v_from := CASE WHEN b.pickup_day IS NOT NULL THEN public.declutter_pickup_anchor(b.slot_start, b.pickup_day)
                 ELSE b.slot_start + interval '15 minutes' END;
  IF o.handover = 'porch' AND v_side = 'seller' THEN
    IF h.picked_up_at IS NOT NULL THEN
      RAISE EXCEPTION 'already_picked_up' USING ERRCODE = '55000';
    END IF;
    v_from := COALESCE(b.porch_until,
      ((b.slot_start AT TIME ZONE 'America/Chicago')::date + 1)::timestamp AT TIME ZONE 'America/Chicago');
  ELSIF o.handover = 'porch' AND v_side = 'buyer' AND h.set_out_at IS NOT NULL THEN
    RAISE EXCEPTION 'seller_set_out' USING ERRCODE = '55000',
      HINT = 'The seller set the item out. If it is not there, report a problem.';
  END IF;
  IF now() < v_from THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = '55000',
      HINT = CASE WHEN b.pickup_day IS NOT NULL THEN 'Wait until the pickup day is over.' ELSE 'Wait 15 minutes after the booked time.' END;
  END IF;
  IF v_side = 'buyer' THEN
    -- CHANGED (owner 10-30): no refund and no strike on one tap. The sweep closes it if the seller doesn't answer.
    RETURN public.declutter_start_no_show_answer(o.id);
  END IF;
  IF b.buyer_missed_at IS NULL AND now() + interval '30 minutes' <= o.paid_at + interval '7 days' THEN
    UPDATE public.declutter_bookings
       SET buyer_missed_at = now(), slot_start = NULL, slot_end = NULL, porch_mode = NULL, porch_until = NULL, updated_at = now()
     WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'warning', 'You missed your pickup',
      'The seller says you did not show up. You can book one new time before your 7-day pickup deadline. Miss again and the sale is cancelled with a strike.',
      '/declutter?view=cart', o.seller_id);
    RETURN jsonb_build_object('result', 'buyer_may_rebook');
  END IF;
  RETURN public.declutter_close_paid_order(o.id, 'buyer_no_show', 'buyer', 'not_picked_up',
    'You missed a booked Declutter pickup again. The item price was refunded.');
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_report_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_report_no_show(uuid) TO authenticated, service_role;

-- declutter_seller_cancel_sale: restated from 20261030132149_declutter_free_claim_cancel_no_strike.sql.
CREATE OR REPLACE FUNCTION public.declutter_seller_cancel_sale(p_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item record;
  v_line record;
BEGIN
  -- Not strike/age/switch-gated: anyone may back out (and takes the strike, unless the line is free: B100).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- Ownership before any lock (lh-authz-rls review 3b #4): with no switch gate,
  -- a stranger must not be able to lock someone else's items, even briefly.
  IF NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id = p_item_id
      OR i.id IN (SELECT c2.item_id FROM public.declutter_cart_items c2
                   WHERE c2.order_id = (SELECT c.order_id FROM public.declutter_cart_items c
                                         WHERE c.item_id = p_item_id AND c.status = 'in_cart'))
   ORDER BY i.id FOR UPDATE;
  SELECT i.id, i.status, i.title INTO v_item FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT c.* INTO v_line FROM public.declutter_cart_items c
   WHERE c.item_id = p_item_id AND c.status IN ('in_cart', 'paid');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_sale_to_cancel' USING ERRCODE = '55000';
  END IF;
  IF v_line.status = 'paid' THEN
    RAISE EXCEPTION 'sale_already_paid' USING ERRCODE = '55000',
      HINT = 'The buyer already paid. Contact support to cancel.';
  END IF;
  IF v_line.order_id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'expired', close_reason = 'seller_cancelled', closed_at = now()
     WHERE id = v_line.order_id AND status = 'awaiting_payment';
  END IF;
  UPDATE public.declutter_cart_items SET status = 'cancelled_by_seller', closed_at = now()
   WHERE id = v_line.id AND status = 'in_cart';
  IF v_line.order_id IS NOT NULL THEN
    UPDATE public.declutter_cart_items SET order_id = NULL
     WHERE order_id = v_line.order_id AND status = 'in_cart';
  END IF;
  -- B100: a free claim goes back up with no strike for anyone (a seller who is out of Declutter cannot have a live
  -- listing, so theirs comes down as before), and the person who claimed it is told so.
  IF v_line.price_cents = 0 THEN
    IF public.declutter_seller_out(v_uid) THEN
      UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
       WHERE id = p_item_id AND status = 'reserved';
      PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'The giver cancelled',
        format('The giver cancelled your claim on "%s". Nothing was charged and you get no strike.', v_item.title),
        '/declutter?tab=buying', v_uid);
    ELSE
      UPDATE public.declutter_items SET status = 'live', updated_at = now()
       WHERE id = p_item_id AND status = 'reserved';
      PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_sales', 'The giver cancelled',
        format('The giver cancelled your claim on "%s", so it went back up. Nothing was charged and you get no strike.', v_item.title),
        '/declutter/item/' || p_item_id::text, v_uid);
    END IF;
    RETURN public.declutter_active_strike_count(v_uid);
  END IF;
  UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
   WHERE id = p_item_id AND status = 'reserved';
  -- D2-16: only an unpaid sale gets here (sale_already_paid above), so nothing was charged.
  PERFORM public.declutter_notify(v_line.buyer_id, 'payment', 'The seller cancelled',
    format('The seller cancelled the sale of "%s". Nothing was charged.', v_item.title), '/declutter?view=cart', v_uid);
  -- D2-10: "after accepting it" only when the seller accepted an offer; a Buy now had nothing to accept.
  RETURN public.declutter_give_strike(v_uid, 'seller', 'cancelled_after_offers', p_item_id,
    CASE WHEN v_line.source = 'offer'
         THEN format('You cancelled the sale of "%s" after accepting it.', v_item.title)
         ELSE format('You cancelled the sale of "%s".', v_item.title) END, v_line.id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_seller_cancel_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_cancel_sale(uuid) TO authenticated, service_role;

-- declutter_book_pickup: restated from 20261102005411_declutter_moved_pickup_keeps_the_window.sql.
CREATE OR REPLACE FUNCTION public.declutter_book_pickup(p_order_id uuid, p_slot_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
  v_side text;
  v_kind text;
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
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_slot_start IS NULL OR p_slot_start <= now() OR p_slot_start + interval '30 minutes' > o.paid_at + interval '7 days' THEN
    RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023',
      HINT = 'Pick a time in the future, before the 7-day pickup deadline.';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  IF v_side = 'buyer' THEN
    IF NOT public.declutter_order_slot_in_windows(o.id, o.seller_id, p_slot_start) THEN
      RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023', HINT = 'Pick a time inside the seller''s pickup times.';
    END IF;
    IF b.order_id IS NULL THEN
      v_kind := 'booked';
    ELSIF b.slot_start IS NULL THEN
      IF b.buyer_rebooked THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000';
      END IF;
      v_kind := 'rebooked';
    ELSE
      IF b.buyer_reschedules >= 1 THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
      END IF;
      v_kind := 'rescheduled';
    END IF;
  ELSE
    IF b.order_id IS NULL OR b.slot_start IS NULL THEN
      RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'The buyer books the pickup first.';
    END IF;
    IF b.seller_reschedules >= 1 THEN
      RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
    END IF;
    v_kind := 'seller_rescheduled';
  END IF;
  IF b.order_id IS NULL THEN
    INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
    VALUES (o.id, o.buyer_id, o.seller_id, p_slot_start, p_slot_start + interval '30 minutes');
    INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
    ON CONFLICT (order_id) DO NOTHING;
  ELSE
    UPDATE public.declutter_bookings
       SET slot_start = p_slot_start, slot_end = p_slot_start + interval '30 minutes', updated_at = now(),
           -- a moved porch slot asks the seller again (row 97)
           porch_mode = NULL, porch_until = NULL,
           buyer_reschedules = buyer_reschedules + CASE WHEN v_kind = 'rescheduled' THEN 1 ELSE 0 END,
           seller_reschedules = seller_reschedules + CASE WHEN v_kind = 'seller_rescheduled' THEN 1 ELSE 0 END,
           buyer_rebooked = buyer_rebooked OR v_kind = 'rebooked'
     WHERE order_id = o.id;
  END IF;
  -- A3-63 follow-up (lead 11-01): the order's chosen time follows the booking, so a moved (or later-booked) pickup
  -- keeps the checkout's shape: a porch pickup is the 2-hour window the seller leaves it out for, cut at the end of
  -- the seller's hours (declutter_checkout_pickup_end, 20261101191500); a door pickup or a meetup is the 30-minute
  -- time. A start outside every window (the seller's free-typed move) keeps 30 minutes.
  IF o.handover IN ('porch', 'pickup_home', 'meetup') THEN
    UPDATE public.declutter_orders
       SET pickup_slot_start = p_slot_start,
           pickup_slot_end = COALESCE(public.declutter_checkout_pickup_end(o.id, o.seller_id, o.handover, p_slot_start),
                                      p_slot_start + interval '30 minutes')
     WHERE id = o.id;
  END IF;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'payment',
    CASE v_kind WHEN 'booked' THEN 'Pickup booked' ELSE 'Pickup time changed' END,
    -- A porch pickup says its window ("Sat 11/7, 3–5 PM", declutter_pickup_when); the others say the time as before.
    format('Pickup is %s.', CASE WHEN o.handover = 'porch' THEN COALESCE(public.declutter_pickup_when(o.id),
                                   to_char(p_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM'))
                                 ELSE to_char(p_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM') END),
    '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'sales' ELSE 'cart' END,
    v_uid);
  RETURN jsonb_build_object('result', v_kind, 'slot_start', p_slot_start);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_book_pickup(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_book_pickup(uuid, timestamptz) TO authenticated, service_role;
