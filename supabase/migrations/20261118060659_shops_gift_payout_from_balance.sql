-- Q2105 step 3, payout half (Shops launch pass 2, 2026-11-18; lh-money-escrow Medium 1 of the step-2 review):
-- a gift order's card charge is the order less the gift share, so a source_transaction transfer of the shop's full
-- payout is refused by Stripe (a transfer can never exceed its source charge). shop_payouts_due now returns the
-- order's gift_cents; declutter-money then sends that payout from the platform balance (where the gift card's money
-- already sits) after the same giftCovers check Declutter uses (Q2106), never with source_transaction.
-- Gift cards stay refused at Shops checkout unless SHOP_GIFT_CARDS=on (never set on prod), so on prod every row
-- returns 0 here and nothing changes until that switch is turned on after the refund half lands.
-- Restated from the newest CREATE (20261107162454_shops_custom_two_charge_payout); DROP first because its result
-- columns grow. Replay-safe: DROP FUNCTION IF EXISTS, then CREATE OR REPLACE.

DROP FUNCTION IF EXISTS public.shop_payouts_due(integer);
CREATE OR REPLACE FUNCTION public.shop_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
               stripe_account_id text, payment_intent_id text, livemode boolean, checkout_session_id text, attempts integer,
               refunds_recorded_cents integer, balance_payment_intent_id text, deposit_shop_cents integer,
               gift_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, p.order_id, o.buyer_id, o.seller_id, p.amount_cents, pr.stripe_account_id, o.stripe_payment_intent_id,
         o.payment_livemode, o.stripe_checkout_session_id, p.attempts,
         public.shop_order_refunds_recorded_cents(o.id),
         -- 11-07: an order paid in two charges is paid out from both (one leg each), never the deposit alone.
         CASE WHEN public.shop_order_two_charges(o) THEN o.balance_payment_intent_id END,
         public.shop_order_deposit_shop_cents(o),
         -- Q2105 step 3: the gift card's share of the order (20261111015126); declutter-money sends a gift order's
         -- payout from the platform balance, never source_transaction (the card charge is smaller than the payout).
         COALESCE(o.gift_cents, 0)
    FROM public.shop_payouts p
    JOIN public.shop_orders o ON o.id = p.order_id
    LEFT JOIN public.profiles pr ON pr.user_id = o.seller_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND (o.status = 'handed_over'
          OR (o.status = 'cancelled' AND o.close_reason IN ('buyer_cancelled_late', 'buyer_no_show')))
     AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = p.order_id AND h.problem_at IS NOT NULL
                       AND h.confirmed_how IS DISTINCT FROM 'admin')
     -- A charge refunded by hand in Stripe never pays the shop from here (section 13).
     AND NOT public.shop_order_unaccounted_hand_refund(p.order_id)
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.shop_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_payouts_due(integer) TO service_role;
