-- Q443: "a payment we actually collected", in the database, for the admin money reads.
--
-- Q233 made every admin money KPI require jobs.stripe_payment_intent_id next to a
-- held payment_status. A job a gift card pays IN FULL never gets a job PI:
-- redeem_gift_card sets payment_status = 'escrow' and the money came through
-- gift_cards.stripe_payment_intent_id. Such a job fell out of Payments
-- Collected, the revenue windows, the tax-quarter fees and per-user pay.
-- Admins cannot read gift_cards (party-only RLS), so the client cannot add the
-- second branch itself.
--
-- payment_captured(jobs) is a PostgREST computed field: the admin reads select
-- and filter it (`.filter("payment_captured", "eq", true)`) like a column. The gift-card
-- branch answers only for admins; anyone else gets the PI-only answer, so the
-- function never tells a non-admin whether a job was gift-funded.
--
-- The gift row is not required to carry its own PI: a remainder card minted by
-- redeem_gift_card (parent_credit_id) has none, and its money came through the
-- parent's PI. payment_status = 'paid' is the evidence there.
--
-- REPLAY-SAFETY: has_role and gift_cards both exist long before this version;
-- CREATE OR REPLACE makes a re-run a no-op.

CREATE OR REPLACE FUNCTION public.payment_captured(j public.jobs)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.payment_status IN ('escrow', 'payout_pending', 'released')
     AND (
       j.stripe_payment_intent_id IS NOT NULL
       OR (
         public.has_role(auth.uid(), 'admin')
         AND EXISTS (
           SELECT 1 FROM public.gift_cards g
            WHERE g.job_id = j.id
              AND g.status = 'redeemed'
              AND g.payment_status = 'paid'
         )
       )
     );
$$;

REVOKE ALL ON FUNCTION public.payment_captured(public.jobs) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_captured(public.jobs) TO authenticated, service_role;
