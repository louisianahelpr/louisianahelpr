-- A3-112 follow-up (audit 2026-11-01, B128 plan, B137): Money > Spent and Receipts
-- show a Declutter order at what the card was charged (declutter_my_paid_cents),
-- and a fully refunded order as "Refunded". A PART refund left the order's
-- status alone (paid / handed_over), so both screens kept the whole charge:
-- an agreed $15 back on a $42.70 order still read $42.70 spent. Two of the
-- three places a refund lives have no member read policy at all
-- (declutter_delivery_refunds, declutter_hand_refunds), so the client cannot
-- add it up itself.
--
-- declutter_my_refunded_cents(order ids): for each of the CALLER's own orders as
-- buyer (another member's ids, and the seller's view of the same ids, answer
-- nothing), the money actually sent back to the card for the ORDER'S OWN
-- payment (stripe_payment_intent_id = the order's; a refund of a duplicate or
-- superseded payment is a different charge and is not netted here):
--   * its declutter_refunds row, when 'succeeded' and NOT settled by a hand
--     refund (then the hand refunds below already are that money);
--   * every live hand refund on the payment (declutter_hand_refunds,
--     failed_at IS NULL): whether it settled the row, fell short of it, or came
--     on top of a row already sent (the money left the card each time);
--   * the delivery fee sent back (declutter_delivery_refunds), when 'succeeded'.
-- Pending and failed rows count nothing: no money has gone back yet. Orders
-- with nothing refunded are returned with 0, so the client can tell "none"
-- from "not read". The screens subtract it from the charge (never below 0)
-- and say "$15.00 refunded"; a fully refunded order keeps "Refunded".
--
-- Read-only: STABLE, no write, no lock. Same gates as declutter_my_paid_cents
-- (20261029161237): the Declutter switch, a signed-in caller, at most 200 ids.
--
-- Replay-safe: CREATE OR REPLACE with one signature; grants restated by role
-- name (REVOKE FROM PUBLIC, anon). Proof:
-- src/test/pglite/declutterMyRefundedCents.pglite.mjs (applied 3x).

CREATE OR REPLACE FUNCTION public.declutter_my_refunded_cents(p_order_ids uuid[])
RETURNS TABLE (order_id uuid, refunded_cents integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_order_ids), 0) > 200 THEN
    RAISE EXCEPTION 'too_many_orders' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT o.id,
           (COALESCE((SELECT sum(r.refund_cents) FROM public.declutter_refunds r
                       WHERE r.order_id = o.id
                         AND r.stripe_payment_intent_id = o.stripe_payment_intent_id
                         AND r.status = 'succeeded'
                         AND NOT EXISTS (SELECT 1 FROM public.declutter_hand_refunds h
                                          WHERE h.stripe_refund_id = r.stripe_refund_ref)), 0)
            + COALESCE((SELECT sum(h.amount_cents) FROM public.declutter_hand_refunds h
                         WHERE h.stripe_payment_intent_id = o.stripe_payment_intent_id
                           AND h.failed_at IS NULL), 0)
            + COALESCE((SELECT sum(d.refund_cents) FROM public.declutter_delivery_refunds d
                         WHERE d.order_id = o.id
                           AND d.stripe_payment_intent_id = o.stripe_payment_intent_id
                           AND d.status = 'succeeded'), 0))::integer
      FROM public.declutter_orders o
     WHERE o.id = ANY (p_order_ids)
       AND o.buyer_id = v_uid
       AND o.stripe_payment_intent_id IS NOT NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_refunded_cents(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_refunded_cents(uuid[]) TO authenticated, service_role;
