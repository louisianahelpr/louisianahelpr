-- BUY-2 (owner 10-31 morning): when no Helpr takes a delivery, the buyer is switched to a pickup at the seller's home
-- (declutter_delivery_on_task_event 'unfilled', 20261030031642: the delivery fee comes back in full, handover becomes
-- 'pickup_home'). Neither side may have wanted that. The owner's rule: the buyer may instead cancel for a refund, and
-- on that refund the BUYER bears the card fee.
--
-- NEW (nothing restated; no existing function body changes):
--   declutter_no_helpr_choice(p_order_id)        the buyer's read: is this order one no Helpr took, still waiting for a
--                                                pickup to be booked, and what the cancel would give back (the same
--                                                sums declutter_record_refund records). NULL for anyone/anything else.
--   declutter_cancel_after_no_helpr(p_order_id)  the buyer's cancel. Closes through declutter_close_paid_order with
--                                                reason 'buyer_cancelled' (declutter_record_refund, newest
--                                                20261031105148: policy keep_card_fee = everything back except the
--                                                card fee), no strike, the items back on sale. Its notices are the
--                                                existing ones ("Your refund is on its way. The card fee is not
--                                                refunded." / "This sale was cancelled ... Your item is back on sale.").
-- Read for this (origin/main newest, 10-31): declutter_close_paid_order 20261027170717, declutter_record_refund
-- 20261031105148, declutter_delivery_refund + declutter_delivery_reserved_cents 20261017055505,
-- declutter_report_no_show 20261031004529 (the checks mirrored here).
-- Which orders: paid, not free, handover 'pickup_home', a declutter_delivery_refunds row with reason 'no_helpr' (only
-- the 'unfilled' event writes one), no pickup time booked yet (booking a time is choosing the pickup), nothing handed
-- over or confirmed, no open problem.
-- REPLAY-SAFE: CREATE OR REPLACE only; grants restated by role name. Proof: src/test/pglite/declutterNoHelprBuyerRefund.pglite.mjs (3x).

-- The rule both functions share. Caller holds the order lock (the cancel) or only reads (the choice).
CREATE OR REPLACE FUNCTION public.declutter_no_helpr_refusal(p_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.declutter_orders;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.id IS NULL THEN
    RETURN 'item_not_found';
  END IF;
  IF o.status IS DISTINCT FROM 'paid' OR o.paid_with = 'free' OR o.stripe_payment_intent_id IS NULL THEN
    RETURN 'order_not_paid';
  END IF;
  IF o.handover IS DISTINCT FROM 'pickup_home'
     OR NOT EXISTS (SELECT 1 FROM public.declutter_delivery_refunds d WHERE d.order_id = o.id AND d.reason = 'no_helpr') THEN
    RETURN 'not_a_no_helpr_order';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RETURN 'problem_open';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
    RETURN 'pickup_booked';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id
              AND (h.seller_confirmed_at IS NOT NULL OR h.picked_up_at IS NOT NULL OR h.confirmed_at IS NOT NULL)) THEN
    RETURN 'already_handed_over';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = o.id) THEN
    RETURN 'already_paid_out';
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_no_helpr_refusal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_no_helpr_refusal(uuid) TO service_role;

-- The buyer's read. Sums as declutter_close_paid_order + declutter_record_refund would record them: paid = total minus
-- the delivery fee already refunded (declutter_delivery_reserved_cents); the card fee kept (at least 1 cent goes back).
CREATE OR REPLACE FUNCTION public.declutter_no_helpr_choice(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_paid integer;
  v_fee integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.id IS NULL OR o.buyer_id IS DISTINCT FROM v_uid OR public.declutter_no_helpr_refusal(o.id) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  v_paid := o.total_cents - public.declutter_delivery_reserved_cents(o.id);
  v_fee := least(v_paid, greatest(0, COALESCE(o.card_fee_cents, public.declutter_card_fee_estimate(v_paid))));
  v_fee := least(v_fee, v_paid - 1);
  RETURN jsonb_build_object(
    'refund_cents', v_paid - v_fee,
    'card_fee_cents', v_fee,
    'delivery_refunded_cents', o.delivery_cents,
    'pickup_by', o.paid_at + interval '7 days');
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_no_helpr_choice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_no_helpr_choice(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_cancel_after_no_helpr(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_why text;
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_side <> 'buyer' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- A second tap after the cancel went through answers the same.
  IF o.status = 'refunded' AND EXISTS (SELECT 1 FROM public.declutter_refunds r WHERE r.order_id = o.id AND r.reason = 'buyer_cancelled')
     AND EXISTS (SELECT 1 FROM public.declutter_delivery_refunds d WHERE d.order_id = o.id AND d.reason = 'no_helpr') THEN
    RETURN jsonb_build_object('result', 'already');
  END IF;
  v_why := public.declutter_no_helpr_refusal(o.id);
  IF v_why = 'pickup_booked' THEN
    RAISE EXCEPTION 'pickup_booked' USING ERRCODE = '55000',
      HINT = 'You booked a pickup time, so this sale goes ahead. If something is wrong, report a problem.';
  ELSIF v_why = 'problem_open' THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  ELSIF v_why IS NOT NULL THEN
    RAISE EXCEPTION 'not_a_no_helpr_order' USING ERRCODE = '55000',
      HINT = 'This sale can''t be cancelled here.';
  END IF;
  -- Owner 10-31: the buyer chose to cancel, so the buyer bears the card fee (keep_card_fee). No strike: no one's fault.
  RETURN public.declutter_close_paid_order(o.id, 'buyer_cancelled', NULL, NULL, NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_cancel_after_no_helpr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_cancel_after_no_helpr(uuid) TO authenticated, service_role;
