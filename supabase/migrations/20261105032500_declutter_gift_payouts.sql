-- Q2106 S2 (Builder 3, 11-04): declutter_payouts_due also returns the order's gift_cents, so declutter-money sends a
-- gift-paid order's seller payout from the platform balance (the card charge is smaller than the seller's share, and
-- Stripe refuses a source_transaction transfer above its charge). Restated VERBATIM from the newest definition
-- (20261026155251) plus that one column. The return type changes, so the function is dropped and made again, with the
-- same grants.
DROP FUNCTION IF EXISTS public.declutter_payouts_due(integer);
CREATE FUNCTION public.declutter_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
               stripe_account_id text, payment_intent_id text, attempts integer, refunds_recorded_cents integer,
               gift_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, p.order_id, o.buyer_id, p.seller_id, p.amount_cents, pr.stripe_account_id, o.stripe_payment_intent_id, p.attempts,
         public.declutter_order_refunds_recorded_cents(o.id), o.gift_cents
    FROM public.declutter_payouts p
    JOIN public.declutter_orders o ON o.id = p.order_id
    LEFT JOIN public.profiles pr ON pr.user_id = p.seller_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = p.order_id AND x.status = 'open')
     -- 141d: the buyer's 24 hours, a refund request or a seller's "no" still running holds the payout.
     AND public.declutter_sale_final(p.order_id)
     -- 141d (lh-money-escrow review, should-fix 1): after an agreed PART refund the seller is paid once the buyer's
     -- refund went through, so the payout run never reads the charge with a refund it has not recorded yet.
     AND NOT EXISTS (SELECT 1 FROM public.declutter_refunds rf
                      WHERE rf.order_id = p.order_id AND rf.stripe_payment_intent_id = o.stripe_payment_intent_id
                        AND rf.reason = 'refund_request_part' AND rf.status IN ('pending', 'failed'))
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payouts_due(integer) TO service_role;
