-- The seller's cards show the one-time setup fee on the one sale that will take it (owner 11-11 ~3:25 PM, Builder 1).
--
-- WHAT WAS BROKEN: the owner's rule is "the one-time setup fee comes out of the FIRST payout actually sent; every
-- seller card shows it on that sale only". declutter_payout_take_setup_fee already takes it at the send of the first
-- row the payout run reaches (declutter_payouts_due ORDER BY next_attempt_at), but the client could not see
-- next_attempt_at or the holds, so with two unsent payouts it hid the figure on both (setupFeeUnsureOrders), and before
-- the handover "You get $X after the handover" never took the fee off at all. The client also decided the fee itself:
-- it exempted profiles.is_seed alone, while the server (identity_check_exempt) needs is_seed AND test_accounts, which
-- the client cannot read, so a seeded account not enrolled in test_accounts saw no fee and then lost it.
--
-- THE FIX: one caller-only read, declutter_my_setup_fee(), that answers from the SAME rules the send uses:
--   fee_cents = declutter_setup_fee_from_payout_cents(auth.uid()) (0 for an admin, an exempt seller, one who paid it,
--               and everyone while the ID check is off: the switch, the exemption and the amount all decided here);
--   order_id  = the sale that will take it:
--     1. among the caller's payout rows the fee can still come out of (exactly declutter_payout_take_setup_fee's own
--        test: pending/failed, no fee yet, no try, never send_tried, no send mark, at least $1 left), the one the
--        payout run sends first: rows due now (declutter_payouts_due's own WHERE, restated below) before rows still
--        held, then next_attempt_at, then id; or, when there is none,
--     2. a BEST GUESS before any handover: the caller's paid sale still to hand over with the earliest booked time
--        (declutter_bookings.slot_start, then the order's pickup_slot_start, unbooked last), then paid_at, then id,
--        whose items plus a seller delivery's rate leave at least $1. The real taker is the first sale handed over AND
--        final; step 1 takes over as soon as its payout row exists. Not mirrored: a manager's share or a fee debt
--        (known only at the handover), so a managed or indebted sale can be named and then be too small.
--   null when no sale of the caller's can take it.
-- Also not mirrored (lh-money-escrow review 11-11): a row the run defers on its own (mixed parties, wholeCharge, a
-- damage-refund read, a gift not covered) lets the next row take the fee in that run; the answer follows on the next
-- read. declutter_payouts_due orders by next_attempt_at only (no id tie-break; ties are not produced by any writer).
-- The answer is "as of now": a hold that appears later (a problem, a refund request) moves the fee to the sale that is
-- then sent first, and the card follows on its next read. Nothing here writes or moves money; the send is unchanged.
-- Not counted (said, not hidden): a Helpr delivery payout or a Shops payout sent first takes the same one-time fee
-- (the shared profiles.onboarding_fee_paid flag); the fee read then answers 0 and every card drops it.
--
-- Caller-only: auth.uid(), no id parameter; authenticated only (REVOKE FROM PUBLIC, anon). Replay-safe: CREATE OR
-- REPLACE, every object read exists at this point in the timeline.
CREATE OR REPLACE FUNCTION public.declutter_my_setup_fee()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_fee integer;
  v_order uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_fee := COALESCE(public.declutter_setup_fee_from_payout_cents(v_uid), 0);
  IF v_fee <= 0 THEN
    RETURN jsonb_build_object('fee_cents', 0, 'order_id', NULL);
  END IF;
  -- 1. A payout row the fee can still come out of (declutter_payout_take_setup_fee's own test), the run's order.
  SELECT p.order_id INTO v_order
    FROM public.declutter_payouts p
    JOIN public.declutter_orders o ON o.id = p.order_id
   WHERE p.seller_id = v_uid
     AND p.status IN ('pending', 'failed') AND p.setup_fee_cents = 0 AND p.attempts = 0 AND NOT p.send_tried
     AND NOT EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'declutter' AND m.payout_id = p.id)
     AND p.amount_cents - v_fee >= 100
   ORDER BY
     -- Due now: declutter_payouts_due's WHERE (20261111211749), restated.
     (p.next_attempt_at <= now() AND p.attempts < 12
      AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = p.order_id AND x.status = 'open')
      AND public.declutter_sale_final(p.order_id)
      AND NOT EXISTS (SELECT 1 FROM public.declutter_refunds rf
                       WHERE rf.order_id = p.order_id AND rf.stripe_payment_intent_id = o.stripe_payment_intent_id
                         AND rf.reason = 'refund_request_part' AND rf.status IN ('pending', 'failed'))
      AND NOT EXISTS (SELECT 1 FROM public.declutter_refunds rh WHERE rh.order_id = p.order_id AND rh.status = 'held_for_review'
                       AND rh.stripe_payment_intent_id IS NOT DISTINCT FROM o.stripe_payment_intent_id AND rh.reason <> 'delivery_damage')) DESC,
     p.next_attempt_at, p.id
   LIMIT 1;
  -- 2. No payout row yet that can take it: the sale paid first that is still to hand over.
  IF v_order IS NULL THEN
    SELECT o.id INTO v_order
      FROM public.declutter_orders o
      LEFT JOIN public.declutter_bookings b ON b.order_id = o.id
     WHERE o.seller_id = v_uid AND o.status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = o.id)
       AND o.items_cents + CASE WHEN o.handover = 'seller_delivery' THEN COALESCE(o.delivery_cents, 0) ELSE 0 END - v_fee >= 100
     ORDER BY COALESCE(b.slot_start, o.pickup_slot_start) NULLS LAST, o.paid_at NULLS LAST, o.id
     LIMIT 1;
  END IF;
  RETURN jsonb_build_object('fee_cents', v_fee, 'order_id', v_order);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_setup_fee() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_setup_fee() TO authenticated;
