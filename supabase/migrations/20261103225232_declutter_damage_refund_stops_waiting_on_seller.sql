-- Q1934 (lh-money-escrow@88fa498a4#3; lead design 11-03): a damaged-in-delivery refund
-- (reason 'delivery_damage', the platform absorbs it, row 43) waited in the queue until the
-- order's seller payout had gone, so the seller's transfer could still draw on the charge.
-- A seller on a payout hold, without a usable payout account, or whose payout kept failing
-- kept the buyer's promised refund out of the queue for good.
--
-- Restated from 20261019070737 with ONE change: a delivery_damage refund is also due
--   * at once when the order's seller payout waits because it is held (an admin payout hold,
--     or a wait recorded as 'held'), or Stripe rejected the seller's account ('rejected'), or
--     the account can no longer be used ('unusable');
--   * 3 days after the refund was recorded, whatever the seller payout is still waiting on.
-- declutter-money then sends that order's seller payout from the platform balance (no
-- source_transaction: the charge went back), and pages ops once when such a refund goes out
-- before the seller was paid. The total is unchanged: the platform absorbs this refund.
CREATE OR REPLACE FUNCTION public.declutter_refunds_due(p_limit integer)
RETURNS TABLE (refund_id uuid, reason text, order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text,
               refund_cents integer, attempts integer, livemode boolean, checkout_session_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- buyer/seller pick the Stripe mode (test accounts on the test key) in declutter-money.
  SELECT r.id, r.reason, r.order_id, o.buyer_id, o.seller_id, r.stripe_payment_intent_id, r.refund_cents, r.attempts,
         r.payment_livemode, o.stripe_checkout_session_id
    FROM public.declutter_refunds r
    LEFT JOIN public.declutter_orders o ON o.id = r.order_id
   WHERE ((r.status = 'pending' AND r.created_at <= now() - interval '2 minutes' AND r.next_attempt_at <= now())
          OR (r.status = 'failed' AND r.next_attempt_at <= now()))
     AND r.attempts < 12
     AND (r.reason <> 'delivery_damage'
          OR EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = r.order_id
                       AND p.status IN ('succeeded', 'nothing_due', 'settled_by_hand'))
          OR r.created_at <= now() - interval '3 days'
          OR EXISTS (SELECT 1 FROM public.declutter_payouts p
                       JOIN public.payout_payee_waits w ON w.payout_kind = 'declutter' AND w.payout_id = p.id
                      WHERE p.order_id = r.order_id AND w.category IN ('held', 'rejected', 'unusable'))
          OR EXISTS (SELECT 1 FROM public.declutter_payouts p
                       JOIN public.payout_holds ph ON ph.helper_id = p.seller_id
                      WHERE p.order_id = r.order_id))
   ORDER BY r.created_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refunds_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refunds_due(integer) TO service_role;
